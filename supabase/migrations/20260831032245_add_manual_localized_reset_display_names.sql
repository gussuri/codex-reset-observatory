alter table public.reset_display_names
  add column if not exists manual_name_en text,
  add column if not exists manual_name_zh text;
