-- Store only bounded, non-sensitive scan counters for monitor diagnosis.
ALTER TABLE public.tibo_heartbeat
  ADD COLUMN IF NOT EXISTS last_scan_summary jsonb NULL;
