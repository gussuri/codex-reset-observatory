ALTER TABLE public.codex_usage_monitor_state
  ADD COLUMN IF NOT EXISTS banked_reset_available_count integer,
  ADD COLUMN IF NOT EXISTS last_banked_grant_at timestamptz;

COMMENT ON COLUMN public.codex_usage_monitor_state.banked_reset_available_count IS
  'Latest known personal banked reset available count for the monitored account.';

COMMENT ON COLUMN public.codex_usage_monitor_state.last_banked_grant_at IS
  'Timestamp when the last banked reset credit grant/increase was observed.';
