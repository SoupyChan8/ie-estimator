-- Speed-up: rate book versions handled inside the database, so switching, saving and checking which
-- version is in use is ONE request instead of ~15. Paste into Supabase → SQL Editor → New query → Run.
-- Safe to run again.

-- The live rate book as JSON (same shape the app uses).
create or replace function public.live_rate_book() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sortOrder', sort_order)
                                             order by sort_order, id) from categories), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'categoryId', category_id, 'parentId', parent_id, 'name', name, 'description', description,
        'unit', unit, 'rateStandard', rate_standard, 'ratePremium', rate_premium, 'rateLuxury', rate_luxury,
        'qtyBhk1', qty_bhk1, 'qtyBhk2', qty_bhk2, 'qtyBhk3', qty_bhk3, 'qtyBhk4', qty_bhk4,
        'scalesWithArea', scales_with_area, 'active', active, 'sortOrder', sort_order) order by sort_order, id)
      from items), '[]'::jsonb));
$$;

-- Fingerprint of a rate book's content: normalised fields, in id order, so row order and number formatting
-- (80 vs 80.0) don't matter.
create or replace function public.book_hash(book jsonb) returns text
language sql immutable set search_path = public as $$
  select md5(jsonb_build_object(
    'c', coalesce((select jsonb_agg(jsonb_build_object(
            'id', (c->>'id')::bigint, 'name', coalesce(c->>'name', ''), 's', coalesce(nullif(c->>'sortOrder', '')::int, 0))
          order by (c->>'id')::bigint) from jsonb_array_elements(book->'categories') c), '[]'::jsonb),
    'i', coalesce((select jsonb_agg(jsonb_build_object(
            'id', (i->>'id')::bigint, 'c', (i->>'categoryId')::bigint, 'p', nullif(i->>'parentId', '')::bigint,
            'n', coalesce(i->>'name', ''), 'd', coalesce(i->>'description', ''), 'u', coalesce(i->>'unit', 'sqft'),
            'r1', trim_scale(coalesce(nullif(i->>'rateStandard', '')::numeric, 0)),
            'r2', trim_scale(nullif(i->>'ratePremium', '')::numeric),
            'r3', trim_scale(nullif(i->>'rateLuxury', '')::numeric),
            'q1', trim_scale(coalesce(nullif(i->>'qtyBhk1', '')::numeric, 0)),
            'q2', trim_scale(coalesce(nullif(i->>'qtyBhk2', '')::numeric, 0)),
            'q3', trim_scale(coalesce(nullif(i->>'qtyBhk3', '')::numeric, 0)),
            'q4', trim_scale(coalesce(nullif(i->>'qtyBhk4', '')::numeric, 0)),
            'a', coalesce((i->>'scalesWithArea')::boolean, false), 'v', coalesce((i->>'active')::boolean, true),
            's', coalesce(nullif(i->>'sortOrder', '')::int, 0))
          order by (i->>'id')::bigint) from jsonb_array_elements(book->'items') i), '[]'::jsonb))::text);
$$;

-- Keep each rate book version's fingerprint up to date automatically.
create or replace function public.versions_set_hash() returns trigger
language plpgsql set search_path = public as $$
begin
  new.hash := case when new.kind = 'ratebook' then public.book_hash(new.data) else null end;
  return new;
end $$;
drop trigger if exists versions_hash on public.versions;
create trigger versions_hash before insert or update of data, kind on public.versions
  for each row execute function public.versions_set_hash();
update public.versions set hash = public.book_hash(data) where kind = 'ratebook';

create or replace function public.rate_book_summary(book jsonb) returns text
language sql immutable as $$
  select jsonb_array_length(coalesce(book->'categories', '[]')) || ' categories · '
    || (select count(*) from jsonb_array_elements(coalesce(book->'items', '[]')) i where nullif(i->>'parentId', '') is null) || ' items · '
    || (select count(*) from jsonb_array_elements(coalesce(book->'items', '[]')) i where nullif(i->>'parentId', '') is not null) || ' add-ons';
$$;

-- Everything the Rate book screen needs: the live rate book plus every rate book version, marked with the
-- one in use (isActive) or, for unsaved custom rates, the one they were edited from (isBase).
create or replace function public.rate_book_state() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  live jsonb := public.live_rate_book();
  h text := public.book_hash(live);
  active_id bigint := nullif((select value from settings where key = 'active_ratebook_version'), '')::bigint;
  match_id bigint;
begin
  select id into match_id from versions
   where kind = 'ratebook' and hash = h
   order by (id = active_id) desc nulls last, (name ~ '^(Backup before|Custom rates before)') asc, id desc
   limit 1;
  if match_id is not null and match_id is distinct from active_id then
    insert into settings (key, value) values ('active_ratebook_version', match_id::text)
      on conflict (key) do update set value = excluded.value;
    active_id := match_id;
  end if;
  return jsonb_build_object(
    'catalog', live,
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'kind', v.kind, 'name', v.name, 'createdAt', v.created_at, 'updatedAt', v.updated_at,
        'createdBy', v.created_by, 'summary', v.summary, 'isDefault', false,
        'isActive', v.id = match_id, 'isBase', match_id is null and v.id = active_id,
        'edited', match_id is null and v.id = active_id) order by v.id desc)
      from versions v where v.kind = 'ratebook'), '[]'::jsonb));
end $$;

-- Switch the live rate book to a saved version. Unsaved custom rates are kept as a backup version first.
create or replace function public.switch_rate_book(version_id bigint, by_email text default '') returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  target versions%rowtype;
  live jsonb := public.live_rate_book();
  backup_id bigint;
begin
  select * into target from versions where id = version_id and kind = 'ratebook';
  if not found then raise exception 'That is not a rate book version.'; end if;
  if not exists (select 1 from versions where kind = 'ratebook' and hash = public.book_hash(live)) then
    insert into versions (kind, name, data, summary, created_by)
    values ('ratebook', 'Custom rates before switching to "' || target.name || '"', live, public.rate_book_summary(live), by_email)
    returning id into backup_id;
  end if;
  perform public.replace_rate_book(target.data);
  insert into settings (key, value) values ('active_ratebook_version', target.id::text)
    on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'backupId', backup_id, 'state', public.rate_book_state());
end $$;

-- Save the live rate book as a new version (version_id null) or overwrite an existing one ("Update …").
create or replace function public.save_rate_book_version(version_name text, version_id bigint default null, by_email text default '')
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  live jsonb := public.live_rate_book();
  vid bigint := version_id;
begin
  if vid is null then
    if coalesce(trim(version_name), '') = '' then raise exception 'Give the version a name.'; end if;
    insert into versions (kind, name, data, summary, created_by)
    values ('ratebook', left(trim(version_name), 80), live, public.rate_book_summary(live), by_email)
    returning id into vid;
  else
    update versions set data = live, summary = public.rate_book_summary(live), updated_at = now(),
                        name = coalesce(nullif(left(trim(version_name), 80), ''), name)
     where id = vid and kind = 'ratebook';
    if not found then raise exception 'Version not found.'; end if;
  end if;
  insert into settings (key, value) values ('active_ratebook_version', vid::text)
    on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('id', vid, 'state', public.rate_book_state());
end $$;

revoke all on function public.live_rate_book(), public.rate_book_state(), public.switch_rate_book(bigint, text),
  public.save_rate_book_version(text, bigint, text) from public, anon;
grant execute on function public.live_rate_book(), public.book_hash(jsonb), public.rate_book_summary(jsonb),
  public.rate_book_state(), public.switch_rate_book(bigint, text), public.save_rate_book_version(text, bigint, text)
  to authenticated, service_role;
