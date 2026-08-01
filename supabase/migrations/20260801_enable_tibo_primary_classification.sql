-- Allow the production Gemini-primary mode and its rule fallback source.
ALTER TABLE public.tibo_signals
  DROP CONSTRAINT IF EXISTS tibo_signals_classification_source_check,
  DROP CONSTRAINT IF EXISTS tibo_signals_ai_classification_status_check;

ALTER TABLE public.tibo_signals
  ADD CONSTRAINT tibo_signals_classification_source_check
    CHECK (classification_source IN ('rule', 'shadow', 'gemini', 'rule_fallback')),
  ADD CONSTRAINT tibo_signals_ai_classification_status_check
    CHECK (
      ai_classification_status IN (
        'success',
        'skipped',
        'timeout',
        'rate_limited',
        'invalid_json',
        'invalid_schema',
        'invalid_evidence',
        'api_error',
        'model_not_configured'
      )
    );
