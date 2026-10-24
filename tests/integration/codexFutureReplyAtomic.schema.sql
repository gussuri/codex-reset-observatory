-- Minimal local schema for the native PostgreSQL integration. The atomic write
-- function bodies are extracted verbatim from their production migration by
-- scripts/integration/codex-future-reply-postgres.mjs.
create role anon;
create role authenticated;
create role service_role;
create schema extensions;
create extension pgcrypto with schema extensions;

create table public.tibo_signals (
  tweet_id text primary key,
  text text,
  tweet_url text,
  tweet_created_at timestamptz,
  expires_at timestamptz,
  signal_type text,
  confidence numeric,
  verification_status text,
  classification_source text,
  is_reply boolean,
  is_quote boolean,
  quote_context_text text,
  quote_tweet_url text,
  quote_author_handle text,
  reply_to_handles text[],
  reply_context_text text,
  source_context_snapshot jsonb,
  source_context_revision_hashes text[],
  source_context_classified_revision_hashes text[],
  source_context_generation integer,
  ai_confidence numeric,
  ai_signal_type text,
  ai_classification_status text,
  ai_temporal_expression text,
  ai_temporal_kind text,
  ai_temporal_direction text,
  ai_notice_timing_status text,
  ai_evidence_quote text,
  ai_contextual_reset_assessment text,
  ai_contextual_reset_tweet_id text,
  ai_temporal_precision text,
  ai_temporal_timezone text,
  ai_temporal_confidence numeric,
  temporal_expression text,
  temporal_kind text,
  temporal_precision text,
  temporal_timezone text,
  temporal_confidence numeric,
  temporal_resolution_source text,
  temporal_resolution_version text,
  expected_start_at timestamptz,
  expected_end_at timestamptz,
  temporal_resolution_status text,
  logical_post_id text,
  edit_history_tweet_ids text[],
  edit_version integer,
  edit_metadata_source text,
  classification_reason text
);

create table public.codex_usage_monitor_state (
  source_key text primary key,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  limit_id text not null,
  plan_type text not null,
  used_percent numeric not null,
  window_duration_mins integer not null,
  resets_at bigint not null,
  coverage_started_at timestamptz,
  banked_reset_available_count integer,
  last_banked_grant_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.codex_recovery_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  source_key text not null,
  observed_at timestamptz not null,
  previous_observed_at timestamptz,
  previous_used_percent numeric not null check (previous_used_percent >= 0 and previous_used_percent <= 100),
  current_used_percent numeric not null check (current_used_percent >= 0 and current_used_percent <= 100),
  previous_resets_at bigint not null check (previous_resets_at > 0),
  current_resets_at bigint not null check (current_resets_at > 0),
  cycle_hint text not null,
  confidence text not null,
  status text not null,
  matched_tibo_tweet_id text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_key, observed_at, current_resets_at)
);

create table public.regular_reset_events (
  schedule_key text primary key,
  window_start_at timestamptz not null,
  window_end_at timestamptz not null,
  representative_at timestamptz not null,
  scheduled_at timestamptz not null,
  completed_at timestamptz not null,
  cycle_type text not null,
  reset_method text not null,
  scope text not null,
  record_kind text not null,
  status text not null,
  correction_reason text,
  corrected_at timestamptz
);

create table public.reset_execution_estimates (
  id uuid primary key default extensions.gen_random_uuid(),
  reset_event_key text not null unique,
  display_execution_at timestamptz not null,
  execution_time_source text not null,
  execution_time_confidence text not null,
  execution_time_precision text not null,
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
  manual_execution_precision text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.codex_banked_grant_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  observation_key text not null unique,
  reset_event_key text not null unique,
  source_key text not null,
  limit_id text not null,
  plan_type text not null,
  previous_observed_at timestamptz not null,
  observed_at timestamptz not null,
  received_at timestamptz not null,
  previous_available_count integer not null,
  current_available_count integer not null,
  observation_window_start_at timestamptz not null,
  observation_window_end_at timestamptz not null,
  execution_time_precision text not null,
  legacy_identity_status text not null default 'resolved',
  legacy_reset_event_key text
);
