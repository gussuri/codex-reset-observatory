ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS reply_to_handles text[],
  ADD COLUMN IF NOT EXISTS reply_context_text text,
  ADD COLUMN IF NOT EXISTS source_timeline text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tibo_signals_source_timeline_check'
      AND conrelid = 'public.tibo_signals'::regclass
  ) THEN
    ALTER TABLE public.tibo_signals
      ADD CONSTRAINT tibo_signals_source_timeline_check
      CHECK (
        source_timeline IS NULL
        OR source_timeline IN ('profile', 'with_replies')
      );
  END IF;
END $$;
