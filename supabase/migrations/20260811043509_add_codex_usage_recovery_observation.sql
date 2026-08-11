create table if not exists public.codex_usage_monitor_state (
  source_key text primary key,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  limit_id text not null check (limit_id = 'codex'),
  plan_type text not null check (char_length(plan_type) between 1 and 64),
  used_percent numeric not null check (used_percent >= 0 and used_percent <= 100),
  window_duration_mins integer not null check (window_duration_mins = 10080),
  resets_at bigint not null check (resets_at > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.codex_recovery_observations (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  observed_at timestamptz not null,
  previous_used_percent numeric not null check (previous_used_percent >= 0 and previous_used_percent <= 100),
  current_used_percent numeric not null check (current_used_percent >= 0 and current_used_percent <= 100),
  previous_resets_at bigint not null check (previous_resets_at > 0),
  current_resets_at bigint not null check (current_resets_at > 0),
  cycle_hint text not null check (cycle_hint in ('regular', 'unexpected', 'unknown')),
  confidence text not null check (confidence in ('strong', 'medium')),
  status text not null check (status in ('observed', 'confirmed', 'rejected')),
  matched_tibo_tweet_id text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint codex_recovery_observations_source_event_key
    unique (source_key, observed_at, current_resets_at)
);

create index if not exists codex_recovery_observations_recent_idx
  on public.codex_recovery_observations (source_key, status, observed_at desc);

alter table public.codex_usage_monitor_state enable row level security;
alter table public.codex_recovery_observations enable row level security;

revoke all privileges on table public.codex_usage_monitor_state from public, anon, authenticated;
revoke all privileges on table public.codex_recovery_observations from public, anon, authenticated;

grant all privileges on table public.codex_usage_monitor_state to service_role;
grant all privileges on table public.codex_recovery_observations to service_role;
