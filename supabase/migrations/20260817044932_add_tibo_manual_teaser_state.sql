ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS teaser_strength text;

ALTER TABLE public.tibo_signals
  DROP CONSTRAINT IF EXISTS tibo_signals_teaser_strength_check;

ALTER TABLE public.tibo_signals
  ADD CONSTRAINT tibo_signals_teaser_strength_check
  CHECK (
    teaser_strength IS NULL
    OR teaser_strength IN ('strong', 'weak', 'none')
  );

ALTER TABLE public.tibo_signals
  DROP CONSTRAINT IF EXISTS tibo_signals_classification_source_check;

ALTER TABLE public.tibo_signals
  ADD CONSTRAINT tibo_signals_classification_source_check
  CHECK (
    classification_source IN ('rule', 'shadow', 'gemini', 'rule_fallback', 'manual')
  );

COMMENT ON COLUMN public.tibo_signals.teaser_strength IS
  'Final/effective teaser strength. NULL preserves the existing AI-derived value; manual corrections are kept separate from ai_teaser_strength.';
