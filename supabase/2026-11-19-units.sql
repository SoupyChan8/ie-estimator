-- 19 Nov 2026: no more lump-sum quantities for these items.
--   • 3D Design & Visualisation, Project Management & Supervision, Site Cleaning & Debris Removal
--     → priced per sq.ft, quantity = the client's carpet area
--   • Hidden Sliding Door → counted in nos (1, 2, …)
-- Updates the live rate book AND every saved rate book version. Safe to run more than once.
-- A non-zero lump-sum rate is turned into a per-sq.ft rate for a typical 1,100 sq.ft home.
-- Paste into Supabase → SQL Editor → New query → Run.

-- live rate book
update public.items
set unit = 'sqft',
    scales_with_area = true,
    rate_standard = case when rate_standard > 0 then round(rate_standard / 1100) else rate_standard end,
    rate_premium  = case when rate_premium  > 0 then round(rate_premium  / 1100) else rate_premium  end,
    rate_luxury   = case when rate_luxury   > 0 then round(rate_luxury   / 1100) else rate_luxury   end,
    qty_bhk1 = case when qty_bhk1 > 0 then 1 else 0 end,
    qty_bhk2 = case when qty_bhk2 > 0 then 1 else 0 end,
    qty_bhk3 = case when qty_bhk3 > 0 then 1 else 0 end,
    qty_bhk4 = case when qty_bhk4 > 0 then 1 else 0 end
where unit = 'lumpsum'
  and name in ('3D Design & Visualisation', 'Project Management & Supervision', 'Site Cleaning & Debris Removal');

update public.items set unit = 'nos'
where unit = 'lumpsum' and name = 'Hidden Sliding Door';

-- saved rate book versions (same change inside each snapshot)
update public.versions v
set data = jsonb_set(v.data, '{items}', (
      select coalesce(jsonb_agg(
        case
          when i->>'unit' = 'lumpsum'
           and i->>'name' in ('3D Design & Visualisation', 'Project Management & Supervision', 'Site Cleaning & Debris Removal')
          then i || jsonb_build_object(
            'unit', 'sqft',
            'scalesWithArea', true,
            'rateStandard', case when coalesce((i->>'rateStandard')::numeric, 0) > 0 then to_jsonb(round((i->>'rateStandard')::numeric / 1100)) else coalesce(i->'rateStandard', '0'::jsonb) end,
            'ratePremium',  case when jsonb_typeof(i->'ratePremium') = 'number' and (i->>'ratePremium')::numeric > 0 then to_jsonb(round((i->>'ratePremium')::numeric / 1100)) else coalesce(i->'ratePremium', 'null'::jsonb) end,
            'rateLuxury',   case when jsonb_typeof(i->'rateLuxury')  = 'number' and (i->>'rateLuxury')::numeric  > 0 then to_jsonb(round((i->>'rateLuxury')::numeric  / 1100)) else coalesce(i->'rateLuxury',  'null'::jsonb) end,
            'qtyBhk1', case when coalesce((i->>'qtyBhk1')::numeric, 0) > 0 then 1 else 0 end,
            'qtyBhk2', case when coalesce((i->>'qtyBhk2')::numeric, 0) > 0 then 1 else 0 end,
            'qtyBhk3', case when coalesce((i->>'qtyBhk3')::numeric, 0) > 0 then 1 else 0 end,
            'qtyBhk4', case when coalesce((i->>'qtyBhk4')::numeric, 0) > 0 then 1 else 0 end)
          when i->>'unit' = 'lumpsum' and i->>'name' = 'Hidden Sliding Door'
          then i || '{"unit": "nos"}'::jsonb
          else i
        end order by t.ord), '[]'::jsonb)
      from jsonb_array_elements(v.data->'items') with ordinality as t(i, ord))),
    hash = null   -- the app works the fingerprint out again
where v.kind = 'ratebook'
  and v.data->'items' @> '[{"unit": "lumpsum"}]';
