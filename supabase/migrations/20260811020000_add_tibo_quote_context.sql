ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS quote_context_text text,
  ADD COLUMN IF NOT EXISTS quote_tweet_url text,
  ADD COLUMN IF NOT EXISTS quote_author_handle text;
