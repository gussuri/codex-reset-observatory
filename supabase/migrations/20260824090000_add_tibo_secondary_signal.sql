ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS secondary_signal jsonb;

COMMENT ON COLUMN public.tibo_signals.secondary_signal IS
  'AI-classified safety-validated future signal that follows a completed primary reset, with an optional secondary-only manualOverride provenance object. NULL means no independent secondary signal.';
