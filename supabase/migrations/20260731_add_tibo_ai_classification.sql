-- Migration: Add AI shadow classification columns to tibo_signals
ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS rule_signal_type text CHECK (rule_signal_type IN ('official_notice', 'reset_executed', 'teaser', 'irrelevant')),
  ADD COLUMN IF NOT EXISTS rule_confidence numeric CHECK (rule_confidence >= 0.0 AND rule_confidence <= 1.0),
  ADD COLUMN IF NOT EXISTS ai_signal_type text CHECK (ai_signal_type IN ('official_notice', 'reset_executed', 'teaser', 'irrelevant')),
  ADD COLUMN IF NOT EXISTS ai_confidence numeric CHECK (ai_confidence IS NULL OR (ai_confidence >= 0.0 AND ai_confidence <= 1.0)),
  ADD COLUMN IF NOT EXISTS ai_temporal_direction text CHECK (ai_temporal_direction IN ('future', 'completed_now', 'historical', 'unclear')),
  ADD COLUMN IF NOT EXISTS ai_evidence_quote text,
  ADD COLUMN IF NOT EXISTS ai_reason_ja text,
  ADD COLUMN IF NOT EXISTS ai_reset_type_ja text,
  ADD COLUMN IF NOT EXISTS ai_notice_to_execution text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_classification_status text CHECK (ai_classification_status IN ('success', 'skipped', 'timeout', 'rate_limited', 'invalid_json', 'invalid_schema', 'invalid_evidence', 'api_error')),
  ADD COLUMN IF NOT EXISTS ai_classified_at timestamptz,
  ADD COLUMN IF NOT EXISTS classification_source text CHECK (classification_source IN ('rule', 'shadow'));
