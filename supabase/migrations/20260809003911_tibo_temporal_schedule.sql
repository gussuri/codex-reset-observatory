-- Nullable, additive temporal audit fields for official Tibo notices.
-- Existing classification columns and rows remain untouched.
ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS ai_temporal_expression text,
  ADD COLUMN IF NOT EXISTS ai_temporal_kind text,
  ADD COLUMN IF NOT EXISTS ai_temporal_precision text,
  ADD COLUMN IF NOT EXISTS ai_temporal_timezone text,
  ADD COLUMN IF NOT EXISTS ai_temporal_confidence numeric,
  ADD COLUMN IF NOT EXISTS expected_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS expected_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS temporal_resolution_status text,
  ADD COLUMN IF NOT EXISTS temporal_resolution_version text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tibo_signals_ai_temporal_kind_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_ai_temporal_kind_check
      CHECK (
        ai_temporal_kind IS NULL OR ai_temporal_kind IN
          ('none', 'absolute', 'weekday', 'relative_day', 'relative_duration', 'daypart', 'range', 'vague')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tibo_signals_ai_temporal_precision_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_ai_temporal_precision_check
      CHECK (
        ai_temporal_precision IS NULL OR ai_temporal_precision IN
          ('exact_time', 'day', 'daypart', 'range', 'unknown')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tibo_signals_ai_temporal_confidence_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_ai_temporal_confidence_check
      CHECK (
        ai_temporal_confidence IS NULL OR
        (ai_temporal_confidence >= 0 AND ai_temporal_confidence <= 1)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tibo_signals_temporal_resolution_status_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_temporal_resolution_status_check
      CHECK (
        temporal_resolution_status IS NULL OR
        temporal_resolution_status IN ('resolved', 'unresolved', 'rejected')
      );
  END IF;
END $$;
