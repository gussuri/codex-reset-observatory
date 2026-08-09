REVOKE ALL PRIVILEGES ON TABLE public.prediction_history
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.regular_reset_events
FROM anon, authenticated;
