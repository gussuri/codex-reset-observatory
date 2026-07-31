-- Migration: Add page reload monitoring tracking columns to tibo_heartbeat
ALTER TABLE public.tibo_heartbeat
  ADD COLUMN IF NOT EXISTS last_page_reload_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_page_reload_status text NULL,
  ADD COLUMN IF NOT EXISTS last_page_reload_error text NULL;
