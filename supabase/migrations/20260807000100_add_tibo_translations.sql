ALTER TABLE public.tibo_signals
  ADD COLUMN IF NOT EXISTS translated_text_ja text,
  ADD COLUMN IF NOT EXISTS translated_text_zh text;
