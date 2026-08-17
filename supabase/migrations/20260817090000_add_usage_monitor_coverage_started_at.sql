ALTER TABLE public.codex_usage_monitor_state
  ADD COLUMN IF NOT EXISTS coverage_started_at timestamptz;

COMMENT ON COLUMN public.codex_usage_monitor_state.coverage_started_at IS
  'Beginning of the latest continuously observed interval. NULL means historical event-time coverage is unknown; existing rows are not backfilled.';
