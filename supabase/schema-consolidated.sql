-- ============================================================================
-- NutraPack App — CONSOLIDATED database schema (rebuild reference)
-- ----------------------------------------------------------------------------
-- This single file reproduces the full database that the 10 original migration
-- files build up (schema.sql + the nine add_*.sql files), in dependency order.
--
-- WHEN TO USE THIS:
--   • Setting up a brand-NEW Supabase project from scratch.
--   • As a single readable reference for the whole schema.
--
-- DO NOT run this against your EXISTING live project — it's already built from
-- the original migrations. This is for fresh setups / reference only.
--
-- HOW TO RUN (new project): Supabase -> SQL Editor -> New query -> paste -> Run.
-- It is written to be safe to run more than once.
-- ============================================================================


-- ============================================================================
-- 1. JOBS  (Work Orders)
-- ============================================================================
create table if not exists public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  job_title          text not null,
  brand              text,                 -- customer name
  facility           text,                 -- legacy; still written by JobModal, no UI field
  description        text,
  status             text not null default 'Not Submitted',
  ship_to            text,
  po_number          text,
  printing_facility  text,
  shipping_address   text,
  print_qty          integer not null default 0,
  sttark_order_id    text,                 -- links a job to its Sttark order
  files_delete_after date                  -- proof auto-delete date (set when Delivered)
);

alter table public.jobs enable row level security;

drop policy if exists "Employees can read all jobs"   on public.jobs;
drop policy if exists "Employees can insert jobs"      on public.jobs;
drop policy if exists "Employees can update all jobs"  on public.jobs;
drop policy if exists "Employees can delete all jobs"  on public.jobs;

create policy "Employees can read all jobs"
  on public.jobs for select to authenticated using (true);
create policy "Employees can insert jobs"
  on public.jobs for insert to authenticated with check (true);
create policy "Employees can update all jobs"
  on public.jobs for update to authenticated using (true) with check (true);
create policy "Employees can delete all jobs"
  on public.jobs for delete to authenticated using (true);

alter publication supabase_realtime add table public.jobs;


-- ============================================================================
-- 2. JOB FILES  (proof uploads — metadata; files live in the job-files bucket)
-- ============================================================================
create table if not exists public.job_files (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  name         text not null,
  size         bigint,
  mime_type    text,
  storage_path text not null,
  uploaded_by  text,
  file_type    text default 'proof'    -- 'proof' | 'approved' | 'other'
);

alter table public.job_files enable row level security;
drop policy if exists "rw_all" on public.job_files;
create policy "rw_all" on public.job_files
  for all to authenticated using (true) with check (true);
alter publication supabase_realtime add table public.job_files;


-- ============================================================================
-- 3. JOB ARTWORK  (links to approved artwork — URLs, not files)
-- ============================================================================
create table if not exists public.job_artwork (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  label       text not null,
  url         text not null,
  added_by    text
);

alter table public.job_artwork enable row level security;
drop policy if exists "rw_all" on public.job_artwork;
create policy "rw_all" on public.job_artwork
  for all to authenticated using (true) with check (true);
alter publication supabase_realtime add table public.job_artwork;


-- ============================================================================
-- 4. PRICING VERSIONS  (Plastics Estimator — append-only signed history)
-- ============================================================================
create table if not exists public.pricing_versions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  version_date date not null default current_date,
  label        text not null,
  signer       text,
  data         jsonb not null            -- { tubs:[], lids:[], sets:{}, freight:{} }
);

alter table public.pricing_versions enable row level security;
drop policy if exists "Employees read pricing"  on public.pricing_versions;
drop policy if exists "Employees insert pricing" on public.pricing_versions;
create policy "Employees read pricing"
  on public.pricing_versions for select to authenticated using (true);
create policy "Employees insert pricing"
  on public.pricing_versions for insert to authenticated with check (true);
alter publication supabase_realtime add table public.pricing_versions;

-- Seed the first pricing version (only if none exist yet).
insert into public.pricing_versions (version_date, label, signer, data)
select '2026-06-11', 'June factory cost update (migrated)', null,
'{
  "tubs": [
    {"id":"8oz","name":"8oz Tub","pcs":129600,"ppp":6480,"factory":0.21,"tariff":0.014},
    {"id":"10oz","name":"10oz Tub","pcs":110160,"ppp":5508,"factory":0.234,"tariff":0.016},
    {"id":"20oz","name":"20oz Tub","pcs":51840,"ppp":2592,"factory":0.313,"tariff":0.019},
    {"id":"25oz","name":"25oz Tub","pcs":40320,"ppp":2016,"factory":0.43,"tariff":0.025},
    {"id":"32oz","name":"32oz Tub","pcs":34560,"ppp":1728,"factory":0.44,"tariff":0.026},
    {"id":"55oz","name":"55oz Tub","pcs":22680,"ppp":1134,"factory":0.52,"tariff":0.046}
  ],
  "lids": [
    {"id":"60mm","name":"60mm PP Lid (printed liner)","pcs":517440,"ppp":25872,"factory":0.1635,"tariff":0},
    {"id":"89mm","name":"89mm PP Lid (printed liner)","pcs":267300,"ppp":13365,"factory":0.2029,"tariff":0},
    {"id":"120mm","name":"120mm PP Lid (printed liner)","pcs":null,"ppp":null,"factory":0.2625,"tariff":0}
  ],
  "sets": {"8oz":"60mm","10oz":"60mm","20oz":"89mm","25oz":"89mm","32oz":"89mm","55oz":"120mm"},
  "freight": {
    "india": {"lalb":4000,"sea":4200,"hou":4500,"sav":4700,"nynj":4800},
    "china": {"lalb":3200,"sea":3300,"hou":3700,"sav":3900,"nynj":4000}
  }
}'::jsonb
where not exists (select 1 from public.pricing_versions);


-- ============================================================================
-- 5. PROFILES  (user roster so Projects can list / @mention people)
-- ============================================================================
create table if not exists public.profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text not null
);

alter table public.profiles enable row level security;
drop policy if exists "Anyone can read profiles"     on public.profiles;
drop policy if exists "Users can upsert own profile"  on public.profiles;
drop policy if exists "Users can update own profile"  on public.profiles;
create policy "Anyone can read profiles"
  on public.profiles for select to authenticated using (true);
create policy "Users can upsert own profile"
  on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Users can update own profile"
  on public.profiles for update to authenticated using (id = auth.uid());


-- ============================================================================
-- 6. PROJECTS + TASKS  (final shape: multi-assignee, no priority/notes)
-- ============================================================================
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  sort_order  integer not null default 0
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null,
  owner       text,                                  -- legacy single owner (kept as fallback)
  owners      text[] default '{}',                   -- current multi-assignee field
  status      text not null default 'To do',         -- To do / In progress / Stuck / Done
  due_date    date,
  sort_order  integer not null default 0
);

alter table public.projects enable row level security;
alter table public.tasks    enable row level security;
do $$
declare t text;
begin
  foreach t in array array['projects','tasks'] loop
    execute format('drop policy if exists "rw_all" on public.%I', t);
    execute format(
      'create policy "rw_all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.tasks;


-- ============================================================================
-- 7. TASK ACTIVITY FEED  (posts + threaded replies, with @mentions)
-- ============================================================================
create table if not exists public.task_posts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author      text not null,
  body        text not null,
  mentions    text[] default '{}'
);

create table if not exists public.task_replies (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  post_id     uuid not null references public.task_posts(id) on delete cascade,
  author      text not null,
  body        text not null,
  mentions    text[] default '{}'
);

alter table public.task_posts   enable row level security;
alter table public.task_replies enable row level security;
do $$
declare t text;
begin
  foreach t in array array['task_posts','task_replies'] loop
    execute format('drop policy if exists "rw_all" on public.%I', t);
    execute format(
      'create policy "rw_all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
alter publication supabase_realtime add table public.task_posts;
alter publication supabase_realtime add table public.task_replies;


-- ============================================================================
-- 8. STORAGE BUCKET  (job-files — private; holds proof uploads)
-- ============================================================================
insert into storage.buckets (id, name, public)
  values ('job-files', 'job-files', false)
  on conflict (id) do nothing;

drop policy if exists "Auth users can upload" on storage.objects;
drop policy if exists "Auth users can read"   on storage.objects;
drop policy if exists "Auth users can delete" on storage.objects;
create policy "Auth users can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files');
create policy "Auth users can read"
  on storage.objects for select to authenticated
  using (bucket_id = 'job-files');
create policy "Auth users can delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'job-files');

-- ============================================================================
-- Done. Edge functions (send-notification, cleanup-files, sttark-status) are
-- deployed separately with the Supabase CLI — see the README.
-- ============================================================================
