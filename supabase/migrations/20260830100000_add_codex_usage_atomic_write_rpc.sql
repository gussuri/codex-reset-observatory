create or replace function public.apply_codex_usage_webhook_write(p_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_source_key text;
  v_expected_previous_observed_at timestamptz;
  v_incoming_observed_at timestamptz;
  v_current_observed_at timestamptz;
  v_has_current_state boolean := false;
  v_observation_id uuid;
  v_observation jsonb;
  v_regular_reset_event jsonb;
  v_estimate jsonb;
  v_banked_estimate jsonb;
  v_estimate_key text;
  v_estimate_is_monitor_observed boolean;
  v_estimate_recovery_observation_id uuid;
  v_estimate_source_ids text[];
  v_banked_source_ids text[];
  v_existing_estimate public.reset_execution_estimates%rowtype;
  v_existing_estimate_found boolean := false;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception using errcode = '22023', message = 'Codex usage write plan must be a JSON object';
  end if;

  v_source_key := p_plan ->> 'source_key';
  if v_source_key <> 'local-codex-app-server' then
    raise exception using errcode = '22023', message = 'Unsupported Codex usage source key';
  end if;

  if jsonb_typeof(p_plan -> 'state') <> 'object' then
    raise exception using errcode = '22023', message = 'Codex usage write plan must include state';
  end if;

  if (p_plan -> 'state' ->> 'source_key') <> v_source_key then
    raise exception using errcode = '22023', message = 'State source key does not match the write plan';
  end if;

  v_expected_previous_observed_at := nullif(p_plan ->> 'expected_previous_observed_at', '')::timestamptz;
  v_incoming_observed_at := (p_plan -> 'state' ->> 'observed_at')::timestamptz;

  -- Serialize the single monitor source. The lock makes the expected version
  -- check and all subsequent writes one compare-and-swap transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('codex-usage-webhook:' || v_source_key)
  );

  select exists(
    select 1
    from public.codex_usage_monitor_state
    where source_key = v_source_key
  ) into v_has_current_state;

  if v_has_current_state then
    select observed_at
      into v_current_observed_at
      from public.codex_usage_monitor_state
      where source_key = v_source_key
      for update;
  end if;

  if v_has_current_state and v_expected_previous_observed_at is distinct from v_current_observed_at then
    return jsonb_build_object(
      'status', 'stale',
      'retry_required', v_incoming_observed_at > v_current_observed_at
    );
  end if;

  if not v_has_current_state and v_expected_previous_observed_at is not null then
    return jsonb_build_object('status', 'stale', 'retry_required', true);
  end if;

  if v_has_current_state and v_incoming_observed_at <= v_current_observed_at then
    return jsonb_build_object('status', 'stale', 'retry_required', false);
  end if;

  if p_plan ? 'promotion' then
    if jsonb_typeof(p_plan -> 'promotion') <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid deferred Tibo promotion';
    end if;

    update public.tibo_signals
       set signal_type = 'reset_executed',
           confidence = (p_plan -> 'promotion' ->> 'confidence')::numeric,
           classification_reason = p_plan -> 'promotion' ->> 'classification_reason'
     where tweet_id = p_plan -> 'promotion' ->> 'tweet_id'
       and signal_type = 'irrelevant'
       and verification_status <> 'rejected';
  end if;

  if p_plan ? 'observation' then
    v_observation := p_plan -> 'observation';
    if jsonb_typeof(v_observation) <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid recovery observation';
    end if;
    if (v_observation ->> 'source_key') <> v_source_key then
      raise exception using errcode = '22023', message = 'Observation source key does not match the write plan';
    end if;

    insert into public.codex_recovery_observations (
      source_key,
      observed_at,
      previous_observed_at,
      previous_used_percent,
      current_used_percent,
      previous_resets_at,
      current_resets_at,
      cycle_hint,
      confidence,
      status,
      matched_tibo_tweet_id,
      confirmed_at,
      updated_at
    ) values (
      v_observation ->> 'source_key',
      (v_observation ->> 'observed_at')::timestamptz,
      nullif(v_observation ->> 'previous_observed_at', '')::timestamptz,
      (v_observation ->> 'previous_used_percent')::numeric,
      (v_observation ->> 'current_used_percent')::numeric,
      (v_observation ->> 'previous_resets_at')::bigint,
      (v_observation ->> 'current_resets_at')::bigint,
      v_observation ->> 'cycle_hint',
      v_observation ->> 'confidence',
      v_observation ->> 'status',
      nullif(v_observation ->> 'matched_tibo_tweet_id', ''),
      nullif(v_observation ->> 'confirmed_at', '')::timestamptz,
      (v_observation ->> 'updated_at')::timestamptz
    )
    on conflict (source_key, observed_at, current_resets_at)
    do update set
      previous_observed_at = excluded.previous_observed_at,
      previous_used_percent = excluded.previous_used_percent,
      current_used_percent = excluded.current_used_percent,
      cycle_hint = excluded.cycle_hint,
      confidence = excluded.confidence,
      status = excluded.status,
      matched_tibo_tweet_id = excluded.matched_tibo_tweet_id,
      confirmed_at = excluded.confirmed_at,
      updated_at = excluded.updated_at
    returning id into v_observation_id;
  end if;

  if p_plan ? 'regular_reset_event' then
    v_regular_reset_event := p_plan -> 'regular_reset_event';
    if jsonb_typeof(v_regular_reset_event) <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid regular reset event';
    end if;

    insert into public.regular_reset_events (
      schedule_key,
      window_start_at,
      window_end_at,
      representative_at,
      scheduled_at,
      completed_at,
      cycle_type,
      reset_method,
      scope,
      record_kind,
      status,
      correction_reason,
      corrected_at
    ) values (
      v_regular_reset_event ->> 'schedule_key',
      (v_regular_reset_event ->> 'window_start_at')::timestamptz,
      (v_regular_reset_event ->> 'window_end_at')::timestamptz,
      (v_regular_reset_event ->> 'representative_at')::timestamptz,
      (v_regular_reset_event ->> 'scheduled_at')::timestamptz,
      (v_regular_reset_event ->> 'completed_at')::timestamptz,
      v_regular_reset_event ->> 'cycle_type',
      v_regular_reset_event ->> 'reset_method',
      v_regular_reset_event ->> 'scope',
      v_regular_reset_event ->> 'record_kind',
      v_regular_reset_event ->> 'status',
      nullif(v_regular_reset_event ->> 'correction_reason', ''),
      nullif(v_regular_reset_event ->> 'corrected_at', '')::timestamptz
    )
    on conflict (schedule_key) do nothing;
  end if;

  if p_plan ? 'execution_estimate' then
    v_estimate := p_plan -> 'execution_estimate';
    if jsonb_typeof(v_estimate) <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid reset execution estimate';
    end if;

    v_estimate_is_monitor_observed := coalesce((v_estimate ->> 'is_monitor_observed')::boolean, false);
    v_estimate_source_ids := array(
      select jsonb_array_elements_text(coalesce(v_estimate -> 'tibo_source_tweet_ids', '[]'::jsonb))
    );
    v_estimate_recovery_observation_id := v_observation_id;
    if v_estimate_recovery_observation_id is null and nullif(v_estimate ->> 'recovery_observation_id', '') is not null then
      v_estimate_recovery_observation_id := (v_estimate ->> 'recovery_observation_id')::uuid;
    end if;

    v_estimate_key := nullif(v_estimate ->> 'reset_event_key', '');
    if v_estimate_is_monitor_observed then
      if v_observation_id is null then
        raise exception using errcode = '22023', message = 'Monitor estimate requires a recovery observation';
      end if;
      v_estimate_key := 'usage-reset-' || v_observation_id::text;
    elsif v_estimate_key is null then
      raise exception using errcode = '22023', message = 'Reset execution estimate requires an event key';
    end if;

    select e.*
      into v_existing_estimate
      from public.reset_execution_estimates e
     where e.reset_event_key = v_estimate_key
     for update;
    v_existing_estimate_found := found;

    if not v_existing_estimate_found and v_estimate_recovery_observation_id is not null then
      select e.*
        into v_existing_estimate
        from public.reset_execution_estimates e
       where e.recovery_observation_id = v_estimate_recovery_observation_id
       for update;
      v_existing_estimate_found := found;
    end if;

    if not v_existing_estimate_found and array_length(v_estimate_source_ids, 1) is not null then
      select e.*
        into v_existing_estimate
        from public.reset_execution_estimates e
       where e.estimator_version = 'usage-execution-banked-v1'
         and e.tibo_source_tweet_ids && v_estimate_source_ids
       order by e.created_at asc
       limit 1
       for update;
      v_existing_estimate_found := found;
    end if;

    if v_existing_estimate_found then
      v_estimate_key := v_existing_estimate.reset_event_key;
      update public.reset_execution_estimates
         set display_execution_at = v_existing_estimate.display_execution_at,
             execution_time_source = v_existing_estimate.execution_time_source,
             execution_time_confidence = v_existing_estimate.execution_time_confidence,
             execution_time_precision = v_existing_estimate.execution_time_precision,
             execution_window_start_at = coalesce(v_existing_estimate.execution_window_start_at, nullif(v_estimate ->> 'execution_window_start_at', '')::timestamptz),
             execution_window_end_at = coalesce(v_existing_estimate.execution_window_end_at, nullif(v_estimate ->> 'execution_window_end_at', '')::timestamptz),
             recovery_observation_id = coalesce(v_existing_estimate.recovery_observation_id, v_estimate_recovery_observation_id),
             recovery_previous_observed_at = coalesce(v_existing_estimate.recovery_previous_observed_at, nullif(v_estimate ->> 'recovery_previous_observed_at', '')::timestamptz),
             recovery_observed_at = coalesce(v_existing_estimate.recovery_observed_at, nullif(v_estimate ->> 'recovery_observed_at', '')::timestamptz),
             tibo_announced_at = case
               when v_existing_estimate.tibo_announced_at is null then nullif(v_estimate ->> 'tibo_announced_at', '')::timestamptz
               when nullif(v_estimate ->> 'tibo_announced_at', '') is null then v_existing_estimate.tibo_announced_at
               else least(v_existing_estimate.tibo_announced_at, (v_estimate ->> 'tibo_announced_at')::timestamptz)
             end,
             tibo_primary_tweet_id = coalesce(v_estimate ->> 'tibo_primary_tweet_id', v_existing_estimate.tibo_primary_tweet_id),
             tibo_source_tweet_ids = array(
               select distinct source_id
               from unnest(
                 coalesce(v_existing_estimate.tibo_source_tweet_ids, '{}'::text[]) ||
                 coalesce(v_estimate_source_ids, '{}'::text[])
               ) as ids(source_id)
               order by source_id
             ),
             official_notice_tweet_id = coalesce(v_estimate ->> 'official_notice_tweet_id', v_existing_estimate.official_notice_tweet_id),
             official_notice_at = coalesce(nullif(v_estimate ->> 'official_notice_at', '')::timestamptz, v_existing_estimate.official_notice_at),
             estimator_version = coalesce(nullif(v_estimate ->> 'estimator_version', ''), v_existing_estimate.estimator_version),
             updated_at = now()
       where id = v_existing_estimate.id;
    else
      insert into public.reset_execution_estimates (
        reset_event_key,
        display_execution_at,
        execution_time_source,
        execution_time_confidence,
        execution_time_precision,
        execution_window_start_at,
        execution_window_end_at,
        recovery_observation_id,
        recovery_previous_observed_at,
        recovery_observed_at,
        tibo_announced_at,
        tibo_primary_tweet_id,
        tibo_source_tweet_ids,
        official_notice_tweet_id,
        official_notice_at,
        estimator_version,
        manual_override_at,
        manual_override_by,
        manual_override_reason,
        manual_execution_at,
        manual_execution_precision
      ) values (
        v_estimate_key,
        (v_estimate ->> 'display_execution_at')::timestamptz,
        v_estimate ->> 'execution_time_source',
        v_estimate ->> 'execution_time_confidence',
        v_estimate ->> 'execution_time_precision',
        nullif(v_estimate ->> 'execution_window_start_at', '')::timestamptz,
        nullif(v_estimate ->> 'execution_window_end_at', '')::timestamptz,
        v_estimate_recovery_observation_id,
        nullif(v_estimate ->> 'recovery_previous_observed_at', '')::timestamptz,
        nullif(v_estimate ->> 'recovery_observed_at', '')::timestamptz,
        nullif(v_estimate ->> 'tibo_announced_at', '')::timestamptz,
        nullif(v_estimate ->> 'tibo_primary_tweet_id', ''),
        coalesce(v_estimate_source_ids, '{}'::text[]),
        nullif(v_estimate ->> 'official_notice_tweet_id', ''),
        nullif(v_estimate ->> 'official_notice_at', '')::timestamptz,
        v_estimate ->> 'estimator_version',
        nullif(v_estimate ->> 'manual_override_at', '')::timestamptz,
        nullif(v_estimate ->> 'manual_override_by', ''),
        nullif(v_estimate ->> 'manual_override_reason', ''),
        nullif(v_estimate ->> 'manual_execution_at', '')::timestamptz,
        nullif(v_estimate ->> 'manual_execution_precision', '')
      );
    end if;
  end if;

  if p_plan ? 'banked_distribution_estimate' then
    v_banked_estimate := p_plan -> 'banked_distribution_estimate';
    if jsonb_typeof(v_banked_estimate) <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid BANKED distribution estimate';
    end if;
    v_banked_source_ids := array(
      select jsonb_array_elements_text(coalesce(v_banked_estimate -> 'tibo_source_tweet_ids', '[]'::jsonb))
    );

    select e.*
      into v_existing_estimate
      from public.reset_execution_estimates e
     where e.reset_event_key = v_banked_estimate ->> 'reset_event_key'
     for update;
    v_existing_estimate_found := found;

    if not v_existing_estimate_found and array_length(v_banked_source_ids, 1) is not null then
      select e.*
        into v_existing_estimate
        from public.reset_execution_estimates e
       where e.tibo_source_tweet_ids && v_banked_source_ids
       order by e.created_at asc
       limit 1
       for update;
      v_existing_estimate_found := found;
    end if;

    if v_existing_estimate_found then
      update public.reset_execution_estimates
         set tibo_announced_at = case
               when v_existing_estimate.tibo_announced_at is null then (v_banked_estimate ->> 'tibo_announced_at')::timestamptz
               when nullif(v_banked_estimate ->> 'tibo_announced_at', '') is null then v_existing_estimate.tibo_announced_at
               else least(v_existing_estimate.tibo_announced_at, (v_banked_estimate ->> 'tibo_announced_at')::timestamptz)
             end,
             tibo_primary_tweet_id = v_banked_estimate ->> 'tibo_primary_tweet_id',
             tibo_source_tweet_ids = array(
               select distinct source_id
               from unnest(
                 coalesce(v_existing_estimate.tibo_source_tweet_ids, '{}'::text[]) ||
                 coalesce(v_banked_source_ids, '{}'::text[])
               ) as ids(source_id)
               order by source_id
             ),
             official_notice_tweet_id = v_banked_estimate ->> 'official_notice_tweet_id',
             official_notice_at = (v_banked_estimate ->> 'official_notice_at')::timestamptz,
             estimator_version = 'usage-execution-banked-v1',
             updated_at = now()
       where id = v_existing_estimate.id;
    else
      insert into public.reset_execution_estimates (
        reset_event_key,
        display_execution_at,
        execution_time_source,
        execution_time_confidence,
        execution_time_precision,
        execution_window_start_at,
        execution_window_end_at,
        recovery_observation_id,
        recovery_previous_observed_at,
        recovery_observed_at,
        tibo_announced_at,
        tibo_primary_tweet_id,
        tibo_source_tweet_ids,
        official_notice_tweet_id,
        official_notice_at,
        estimator_version
      ) values (
        v_banked_estimate ->> 'reset_event_key',
        (v_banked_estimate ->> 'display_execution_at')::timestamptz,
        'usage_observation',
        'high',
        'approximate',
        null,
        null,
        null,
        null,
        null,
        (v_banked_estimate ->> 'tibo_announced_at')::timestamptz,
        v_banked_estimate ->> 'tibo_primary_tweet_id',
        coalesce(v_banked_source_ids, '{}'::text[]),
        v_banked_estimate ->> 'official_notice_tweet_id',
        (v_banked_estimate ->> 'official_notice_at')::timestamptz,
        'usage-execution-banked-v1'
      );
    end if;
  end if;

  insert into public.codex_usage_monitor_state (
    source_key,
    observed_at,
    received_at,
    limit_id,
    plan_type,
    used_percent,
    window_duration_mins,
    resets_at,
    coverage_started_at,
    banked_reset_available_count,
    last_banked_grant_at,
    updated_at
  ) values (
    v_source_key,
    (p_plan -> 'state' ->> 'observed_at')::timestamptz,
    (p_plan -> 'state' ->> 'received_at')::timestamptz,
    p_plan -> 'state' ->> 'limit_id',
    p_plan -> 'state' ->> 'plan_type',
    (p_plan -> 'state' ->> 'used_percent')::numeric,
    (p_plan -> 'state' ->> 'window_duration_mins')::integer,
    (p_plan -> 'state' ->> 'resets_at')::bigint,
    nullif(p_plan -> 'state' ->> 'coverage_started_at', '')::timestamptz,
    nullif(p_plan -> 'state' ->> 'banked_reset_available_count', '')::integer,
    nullif(p_plan -> 'state' ->> 'last_banked_grant_at', '')::timestamptz,
    (p_plan -> 'state' ->> 'updated_at')::timestamptz
  )
  on conflict (source_key)
  do update set
    observed_at = excluded.observed_at,
    received_at = excluded.received_at,
    limit_id = excluded.limit_id,
    plan_type = excluded.plan_type,
    used_percent = excluded.used_percent,
    window_duration_mins = excluded.window_duration_mins,
    resets_at = excluded.resets_at,
    coverage_started_at = excluded.coverage_started_at,
    banked_reset_available_count = excluded.banked_reset_available_count,
    last_banked_grant_at = excluded.last_banked_grant_at,
    updated_at = excluded.updated_at
  where public.codex_usage_monitor_state.observed_at < excluded.observed_at;

  return jsonb_build_object(
    'status', 'applied',
    'retry_required', false,
    'observation_id', v_observation_id
  );
end;
$function$;

revoke all on function public.apply_codex_usage_webhook_write(jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_codex_usage_webhook_write(jsonb)
  to service_role;
