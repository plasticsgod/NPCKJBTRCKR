-- ============================================================================
-- NutraPack Job Tracker — database setup
-- ----------------------------------------------------------------------------
-- HOW TO RUN THIS:
--   1. Open your project at https://supabase.com
--   2. Left sidebar -> "SQL Editor" -> "New query"
--   3. Paste this entire file in and click "Run"
-- It is safe to run more than once.
-- ============================================================================

-- The single table that holds every job.
create table if not exists public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  job_title          text not null,
  brand              text,
  facility           text,
  description        text,
  status             text not null default 'New',
  ship_to            text,
  po_number          text,
  printing_facility  text,
  shipping_address   text
);

-- Turn on Row Level Security. With RLS on and NO policies, the table is locked
-- to everyone — so the policies below are what grant access.
alter table public.jobs enable row level security;

-- POLICY: any signed-in employee can see and change every job.
-- (This matches "all employees see all jobs". When you later want roles like
--  admin vs. staff, you replace these policies — the app code stays the same.)
drop policy if exists "Employees can read all jobs"   on public.jobs;
drop policy if exists "Employees can insert jobs"      on public.jobs;
drop policy if exists "Employees can update all jobs"  on public.jobs;
drop policy if exists "Employees can delete all jobs"  on public.jobs;

create policy "Employees can read all jobs"
  on public.jobs for select
  to authenticated
  using (true);

create policy "Employees can insert jobs"
  on public.jobs for insert
  to authenticated
  with check (true);

create policy "Employees can update all jobs"
  on public.jobs for update
  to authenticated
  using (true)
  with check (true);

create policy "Employees can delete all jobs"
  on public.jobs for delete
  to authenticated
  using (true);

-- Let the app receive live updates when a teammate adds or changes a job.
alter publication supabase_realtime add table public.jobs;
