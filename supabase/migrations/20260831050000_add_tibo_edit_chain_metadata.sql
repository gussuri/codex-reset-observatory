ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS logical_post_id text,
  ADD COLUMN IF NOT EXISTS edit_history_tweet_ids text[],
  ADD COLUMN IF NOT EXISTS edit_version integer,
  ADD COLUMN IF NOT EXISTS edit_metadata_source text;

UPDATE public.tibo_signals
SET
  logical_post_id = COALESCE(logical_post_id, tweet_id),
  edit_history_tweet_ids = COALESCE(edit_history_tweet_ids, ARRAY[tweet_id]::text[]),
  edit_version = COALESCE(edit_version, 1),
  edit_metadata_source = COALESCE(edit_metadata_source, 'none')
WHERE logical_post_id IS NULL
   OR edit_history_tweet_ids IS NULL
   OR edit_version IS NULL
   OR edit_metadata_source IS NULL;

ALTER TABLE public.tibo_signals
  DROP CONSTRAINT IF EXISTS tibo_signals_edit_version_positive_check;

ALTER TABLE public.tibo_signals
  ADD CONSTRAINT tibo_signals_edit_version_positive_check
  CHECK (edit_version IS NULL OR edit_version > 0);

ALTER TABLE public.tibo_signals
  DROP CONSTRAINT IF EXISTS tibo_signals_edit_metadata_source_check;

ALTER TABLE public.tibo_signals
  ADD CONSTRAINT tibo_signals_edit_metadata_source_check
  CHECK (edit_metadata_source IS NULL OR edit_metadata_source IN ('x_api', 'none'));

CREATE INDEX IF NOT EXISTS tibo_signals_logical_post_id_idx
  ON public.tibo_signals (logical_post_id);
