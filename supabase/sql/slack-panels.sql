-- Slack → Panel Builder bot (edge function slack-panels). Run once in the Supabase SQL editor.

-- Which Slack thread a panel came from, so a revised spec in that thread updates it.
alter table public.panel_projects
  add column if not exists slack_channel text,
  add column if not exists slack_thread_ts text;

create index if not exists panel_projects_slack_thread_idx
  on public.panel_projects (slack_channel, slack_thread_ts)
  where slack_thread_ts is not null;

-- Slack retries event deliveries; the bot records each event id so it handles it once.
-- Old rows are pruned by the function (older than 30 days).
create table if not exists public.slack_panel_events (
  event_id   text primary key,
  created_at timestamptz not null default now()
);
alter table public.slack_panel_events enable row level security;
-- No policies on purpose: only the edge function (service role) reads or writes it.
