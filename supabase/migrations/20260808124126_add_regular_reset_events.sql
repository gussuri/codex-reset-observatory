CREATE TABLE IF NOT EXISTS public.regular_reset_events (
  schedule_key text PRIMARY KEY,
  window_start_at timestamptz NOT NULL,
  window_end_at timestamptz NOT NULL,
  representative_at timestamptz NOT NULL,
  scheduled_at timestamptz NOT NULL UNIQUE,
  completed_at timestamptz NOT NULL,
  cycle_type text NOT NULL DEFAULT '定期リセット',
  reset_method text NOT NULL,
  scope text NOT NULL,
  record_kind text NOT NULL DEFAULT 'regular_completed',
  status text NOT NULL DEFAULT 'completed',
  correction_reason text,
  corrected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regular_reset_events_cycle_type_check
    CHECK (cycle_type = '定期リセット'),
  CONSTRAINT regular_reset_events_record_kind_check
    CHECK (record_kind = 'regular_completed'),
  CONSTRAINT regular_reset_events_status_check
    CHECK (status IN ('completed', 'corrected', 'voided')),
  CONSTRAINT regular_reset_events_window_check
    CHECK (window_start_at <= window_end_at),
  CONSTRAINT regular_reset_events_representative_check
    CHECK (representative_at >= window_start_at AND representative_at <= window_end_at)
);

CREATE INDEX IF NOT EXISTS regular_reset_events_completed_at_idx
  ON public.regular_reset_events (completed_at DESC);

ALTER TABLE public.regular_reset_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.regular_reset_events IS
  'Persistent scheduled regular reset waves. representative_at is a representative wave time, not a universal per-account execution instant.';
