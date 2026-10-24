-- Normalize only known legacy canonical scope values. Raw source/evidence text,
-- event identity, chronology, and reset semantics are intentionally untouched.
do $$
begin
  if to_regclass('public.reset_display_names') is not null then
    update public.reset_display_names
       set event_scope = case
         when btrim(event_scope) in ('全有料プラン', '一部ユーザー')
           then btrim(event_scope)
         when lower(btrim(event_scope)) in (
           'all paid plans', 'all paid users', 'all users'
         ) or btrim(event_scope) in ('全ユーザー', '所有付费套餐', '所有付费用户', '所有用户')
           then '全有料プラン'
         when lower(btrim(event_scope)) in ('codex / chatgpt work', 'codex', 'chatgpt work')
           then null
         when btrim(event_scope) in (
           '任意リセット未使用アカウント',
           '任意リセットを使っていないアカウント',
           '不具合対象ユーザー（約50万人）'
         ) or lower(btrim(event_scope)) ~
           '^(some|affected|selected|limited|specific|subset) users?$'
           then '一部ユーザー'
         else null
       end
     where event_scope is not null
       and btrim(event_scope) not in ('全有料プラン', '一部ユーザー');

    alter table public.reset_display_names
      drop constraint if exists reset_display_names_event_scope_check;
    alter table public.reset_display_names
      add constraint reset_display_names_event_scope_check
      check (event_scope is null or event_scope in ('全有料プラン', '一部ユーザー'));
  end if;

  if to_regclass('public.regular_reset_events') is not null then
    update public.regular_reset_events
       set scope = case
         when btrim(scope) in ('全有料プラン', '一部ユーザー')
           then btrim(scope)
         when lower(btrim(scope)) in (
           'all paid plans', 'all paid users', 'all users'
         ) or btrim(scope) in ('全ユーザー', '所有付费套餐', '所有付费用户', '所有用户')
           then '全有料プラン'
         when btrim(scope) in (
           '任意リセット未使用アカウント',
           '任意リセットを使っていないアカウント'
         ) or lower(btrim(scope)) ~
           '^(some|affected|selected|limited|specific|subset) users?$'
           then '一部ユーザー'
         else scope
       end
     where btrim(scope) not in ('全有料プラン', '一部ユーザー');

    alter table public.regular_reset_events
      drop constraint if exists regular_reset_events_scope_check;
    alter table public.regular_reset_events
      add constraint regular_reset_events_scope_check
      check (scope in ('全有料プラン', '一部ユーザー'));
  end if;
end
$$;
