alter table public.codex_recovery_observations
  add column if not exists previous_observed_at timestamptz;

create table if not exists public.reset_execution_estimates (
  id uuid primary key default gen_random_uuid(),
  reset_event_key text not null unique,
  display_execution_at timestamptz not null,
  execution_time_source text not null check (
    execution_time_source in ('usage_observation', 'tibo_announcement_fallback', 'manual_override')
  ),
  execution_time_confidence text not null check (
    execution_time_confidence in ('high', 'medium', 'low')
  ),
  execution_time_precision text not null check (
    execution_time_precision in ('exact', 'approximate', 'window', 'announcement_fallback')
  ),
  execution_window_start_at timestamptz,
  execution_window_end_at timestamptz,
  recovery_observation_id uuid unique references public.codex_recovery_observations(id),
  recovery_previous_observed_at timestamptz,
  recovery_observed_at timestamptz,
  tibo_announced_at timestamptz,
  tibo_primary_tweet_id text,
  tibo_source_tweet_ids text[] not null default '{}',
  official_notice_tweet_id text,
  official_notice_at timestamptz,
  estimator_version text not null default 'usage-execution-v1',
  manual_override_at timestamptz,
  manual_override_by text,
  manual_override_reason text,
  manual_execution_at timestamptz,
  manual_execution_precision text check (
    manual_execution_precision is null or
    manual_execution_precision in ('exact', 'approximate', 'window')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reset_execution_estimates_tibo_ids_idx
  on public.reset_execution_estimates using gin (tibo_source_tweet_ids);

alter table public.reset_execution_estimates enable row level security;

revoke all privileges on table public.reset_execution_estimates from public, anon, authenticated;
grant all privileges on table public.reset_execution_estimates to service_role;
