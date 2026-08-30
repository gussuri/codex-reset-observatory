-- Effective temporal values are kept separate from Gemini audit fields.
-- Existing rows are intentionally not backfilled.
ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS temporal_expression text,
  ADD COLUMN IF NOT EXISTS temporal_kind text,
  ADD COLUMN IF NOT EXISTS temporal_precision text,
  ADD COLUMN IF NOT EXISTS temporal_timezone text,
  ADD COLUMN IF NOT EXISTS temporal_confidence numeric,
  ADD COLUMN IF NOT EXISTS temporal_resolution_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tibo_signals_temporal_kind_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_temporal_kind_check
      CHECK (
        temporal_kind IS NULL OR temporal_kind IN
          ('none', 'absolute', 'weekday', 'relative_day', 'relative_duration', 'daypart', 'range', 'vague')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tibo_signals_temporal_precision_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_temporal_precision_check
      CHECK (
        temporal_precision IS NULL OR temporal_precision IN
          ('exact_time', 'day', 'daypart', 'range', 'unknown')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tibo_signals_temporal_confidence_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_temporal_confidence_check
      CHECK (
        temporal_confidence IS NULL OR
        (temporal_confidence >= 0 AND temporal_confidence <= 1)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tibo_signals_temporal_resolution_source_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_temporal_resolution_source_check
      CHECK (
        temporal_resolution_source IS NULL OR
        temporal_resolution_source IN ('gemini', 'deterministic', 'merged')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.tibo_signals.temporal_expression IS
  'Effective source-grounded temporal expression; NULL means no effective resolution was stored.';
COMMENT ON COLUMN public.tibo_signals.temporal_resolution_source IS
  'Provenance of effective temporal resolution: gemini, deterministic, or merged.';
