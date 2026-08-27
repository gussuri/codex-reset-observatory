alter table public.reset_display_names
  add column if not exists ai_name_en text,
  add column if not exists ai_name_zh text;
