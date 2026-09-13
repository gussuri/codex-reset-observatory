alter table if exists public.reset_display_names
  add column if not exists event_reason_type text,
  add column if not exists event_scope text,
  add column if not exists event_summary_ja text,
  add column if not exists event_summary_en text,
  add column if not exists event_summary_zh text,
  add column if not exists event_note_ja text,
  add column if not exists event_note_en text,
  add column if not exists event_note_zh text,
  add column if not exists event_metadata_model text,
  add column if not exists event_metadata_prompt_version text,
  add column if not exists event_metadata_status text,
  add column if not exists event_metadata_flags text[] default '{}'::text[],
  add column if not exists event_metadata_generated_at timestamptz,
  add column if not exists event_metadata_input_hash text;

do $$
begin
  if to_regclass('public.reset_display_names') is not null then
    alter table public.reset_display_names
      drop constraint if exists reset_display_names_event_reason_type_check;
    alter table public.reset_display_names
      add constraint reset_display_names_event_reason_type_check
      check (event_reason_type is null or event_reason_type in ('ご祝儀リセット', '詫びリセット'));

    alter table public.reset_display_names
      drop constraint if exists reset_display_names_event_scope_check;
    alter table public.reset_display_names
      add constraint reset_display_names_event_scope_check
      check (event_scope is null or event_scope in ('全有料プラン', '一部ユーザー'));

    alter table public.reset_display_names
      drop constraint if exists reset_display_names_event_metadata_status_check;
    alter table public.reset_display_names
      add constraint reset_display_names_event_metadata_status_check
      check (event_metadata_status is null or event_metadata_status in (
        'success', 'invalid_json', 'invalid_schema', 'api_error', 'rate_limited', 'timeout'
      ));
  end if;
end
$$;
