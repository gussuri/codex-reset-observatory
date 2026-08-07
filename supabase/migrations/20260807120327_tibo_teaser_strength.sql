ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS ai_teaser_strength text,
  ADD COLUMN IF NOT EXISTS ai_teaser_strength_confidence numeric,
  ADD COLUMN IF NOT EXISTS ai_teaser_strength_evidence_quote text,
  ADD COLUMN IF NOT EXISTS ai_teaser_strength_reason_ja text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tibo_signals_ai_teaser_strength_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_ai_teaser_strength_check
      CHECK (
        ai_teaser_strength IS NULL
        OR ai_teaser_strength IN ('strong', 'weak', 'none')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tibo_signals_ai_teaser_strength_confidence_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_ai_teaser_strength_confidence_check
      CHECK (
        ai_teaser_strength_confidence IS NULL
        OR (
          ai_teaser_strength_confidence >= 0
          AND ai_teaser_strength_confidence <= 1
        )
      );
  END IF;
END $$;
