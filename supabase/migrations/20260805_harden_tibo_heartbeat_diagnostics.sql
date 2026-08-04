-- Add the heartbeat diagnostics used to investigate monitor scans.
ALTER TABLE public.tibo_heartbeat
  ADD COLUMN IF NOT EXISTS last_scan_summary jsonb NULL,
  ADD COLUMN IF NOT EXISTS newest_seen_tweet_created_at timestamptz NULL;
