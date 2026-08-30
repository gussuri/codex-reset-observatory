-- Foundation for the schema that existed immediately before the first
-- historical migration (20260731000000). Later migrations remain incremental.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.tibo_heartbeat (
  id text PRIMARY KEY DEFAULT 'main',
  session_id text,
  session_started_at timestamptz DEFAULT now(),
  last_heartbeat_at timestamptz DEFAULT now(),
  last_successful_parse_at timestamptz,
  last_seen_tweet_id text,
  last_scan_error text,
  selector_version text DEFAULT 'v1',
  heartbeat_count integer DEFAULT 0,
  max_gap_seconds integer DEFAULT 0,
  last_gap_seconds integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tibo_signals (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tweet_id text NOT NULL UNIQUE,
  signal_type text NOT NULL,
  text text NOT NULL,
  tweet_url text NOT NULL,
  tweet_created_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verification_status text NOT NULL DEFAULT 'auto_unverified',
  confidence numeric NOT NULL DEFAULT 0.80,
  classification_reason text,
  is_reply boolean DEFAULT false,
  is_quote boolean DEFAULT false,
  CONSTRAINT tibo_signals_signal_type_check
    CHECK (signal_type IN ('official_notice', 'reset_executed', 'teaser', 'irrelevant')),
  CONSTRAINT tibo_signals_verification_status_check
    CHECK (verification_status IN ('auto_unverified', 'confirmed', 'rejected')),
  CONSTRAINT tibo_signals_confidence_check
    CHECK (confidence >= 0.0 AND confidence <= 1.0),
  CONSTRAINT tibo_signals_check
    CHECK (expires_at > tweet_created_at)
);

CREATE INDEX IF NOT EXISTS tibo_signals_tweet_created_at_idx
  ON public.tibo_signals (tweet_created_at DESC);

CREATE TABLE IF NOT EXISTS public.prediction_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  logged_hour timestamptz NOT NULL UNIQUE,
  probability_24h real NOT NULL,
  probability_48h real NOT NULL,
  expectation text NOT NULL,
  reasons text,
  official_notice boolean NOT NULL DEFAULT false,
  incident_hint integer NOT NULL DEFAULT 0,
  status_incidents integer NOT NULL DEFAULT 0,
  debug_info jsonb
);

-- These tables are server-side only. The later migrations add their own
-- table-specific grants, while the three foundation tables use the same
-- restricted Production access model.
ALTER TABLE public.tibo_heartbeat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tibo_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.tibo_heartbeat,
  public.tibo_signals,
  public.prediction_history
FROM public, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE public.tibo_heartbeat,
  public.tibo_signals,
  public.prediction_history
TO service_role;

GRANT USAGE, SELECT, UPDATE
ON SEQUENCE public.prediction_history_id_seq
TO service_role;
