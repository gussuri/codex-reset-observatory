create table if not exists public.reset_display_names (
  event_key text primary key,
  source_tweet_id text,
  manual_name_ja text,
  ai_name_ja text,
  ai_confidence double precision,
  ai_evidence text,
  ai_reason text,
  ai_model text,
  ai_prompt_version text,
  ai_input_mode text,
  ai_status text,
  ai_flags text[] default '{}'::text[],
  ai_generated_at timestamptz,
  input_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reset_display_names_ai_confidence_range
    check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1))
);

alter table public.reset_display_names enable row level security;

revoke all on table public.reset_display_names from public, anon, authenticated;
grant select, insert, update on table public.reset_display_names to service_role;

create index if not exists reset_display_names_source_tweet_id_idx
  on public.reset_display_names (source_tweet_id);
