-- 19 Nov 2026: allow 5+ BHK homes (up to 10 BHK) in signed contracts.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
alter table public.contracts drop constraint if exists contracts_bhk_check;
alter table public.contracts add constraint contracts_bhk_check check (bhk between 1 and 10);
