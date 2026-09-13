-- Restore the audited weekly regular rows that the previous generic scope
-- normalization compressed into the random-reset partial label. Keep this
-- correction keyed to the known schedule records; do not infer scope from
-- unrelated regular or BANKED rows.
do $$
begin
  if to_regclass('public.regular_reset_events') is not null then
    update public.regular_reset_events as event
       set scope = '任意リセット未使用アカウント'
      from (values
        ('weekly-regular-reset:2026-08-08T03:32:00.000Z'),
        ('weekly-regular-reset:2026-08-15T03:32:00.000Z'),
        ('weekly-regular-reset:2026-08-20T03:34:43.341Z')
      ) as audited(schedule_key)
     where event.schedule_key = audited.schedule_key
       and event.cycle_type = '定期リセット'
       and event.reset_method = '強制リセット'
       and event.record_kind = 'regular_completed'
       and event.scope = '一部ユーザー';

    alter table public.regular_reset_events
      drop constraint if exists regular_reset_events_scope_check;
    alter table public.regular_reset_events
      add constraint regular_reset_events_scope_check
      check (scope in ('任意リセット未使用アカウント', '全有料プラン'));
  end if;
end
$$;
