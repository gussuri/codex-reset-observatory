create function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $function$
begin
  if p_ok is distinct from true then
    raise exception 'assertion failed: %', p_message;
  end if;
end;
$function$;

create function pg_temp.clear_fixture()
returns void language plpgsql as $function$
begin
  truncate table public.codex_usage_future_reply_claims,
    public.reset_execution_estimates,
    public.codex_recovery_observations,
    public.codex_usage_monitor_state,
    public.tibo_signals;
end;
$function$;

create function pg_temp.seed_state(p_observed_at timestamptz, p_resets_at bigint)
returns void language sql as $function$
  insert into public.codex_usage_monitor_state (
    source_key, observed_at, received_at, limit_id, plan_type,
    used_percent, window_duration_mins, resets_at, coverage_started_at,
    banked_reset_available_count, last_banked_grant_at, updated_at
  ) values (
    'local-codex-app-server', p_observed_at, p_observed_at + interval '1 second',
    'codex', 'plus', 100, 10080, p_resets_at, p_observed_at,
    0, null, p_observed_at + interval '1 second'
  )
$function$;

create function pg_temp.seed_notice(
  p_tweet_id text,
  p_parent_id text,
  p_verification_status text default 'auto_unverified'
)
returns void language plpgsql as $function$
declare
  v_reply_text text := 'Lands tomorrow before 10am PST.';
  v_parent_text text := 'Day 17/ Bet you thought we forgot, but no, it’s reset day today.';
  v_hash text := repeat('a', 64);
begin
  insert into public.tibo_signals (
    tweet_id, text, tweet_url, tweet_created_at, expires_at, signal_type,
    confidence, verification_status, classification_source, is_reply, is_quote,
    quote_context_text, quote_tweet_url, quote_author_handle, reply_to_handles,
    reply_context_text, source_context_snapshot, source_context_revision_hashes,
    source_context_classified_revision_hashes, source_context_generation,
    ai_confidence, ai_signal_type, ai_classification_status, ai_temporal_expression,
    ai_temporal_kind, ai_temporal_direction, ai_notice_timing_status, ai_evidence_quote,
    ai_contextual_reset_assessment, ai_contextual_reset_tweet_id, ai_temporal_precision,
    ai_temporal_timezone, ai_temporal_confidence, temporal_expression, temporal_kind,
    temporal_precision, temporal_timezone, temporal_confidence, temporal_resolution_source,
    temporal_resolution_version, expected_start_at, expected_end_at,
    temporal_resolution_status, logical_post_id, edit_history_tweet_ids, edit_version,
    edit_metadata_source
  ) values (
    p_tweet_id, v_reply_text,
    'https://x.com/thsottiaux/status/' || p_tweet_id,
    '2026-10-22T06:55:54Z', '2026-10-23T23:00:00Z', 'official_notice',
    0.98, p_verification_status, 'gemini', true, false,
    null, null, null, array['@thsottiaux']::text[], v_parent_text,
    jsonb_build_object('parent', jsonb_build_object(
      'tweetId', p_parent_id,
      'tweetUrl', 'https://x.com/thsottiaux/status/' || p_parent_id,
      'authorHandle', '@thsottiaux',
      'text', v_parent_text
    )),
    array[v_hash]::text[], array[v_hash]::text[], 1,
    0.98, 'official_notice', 'success', 'tomorrow before 10am PST',
    'range', 'future', 'known', v_reply_text, 'same_global_reset', p_parent_id,
    'range', 'PST', 0.95, 'tomorrow before 10am PST', 'range', 'range', 'PST', 0.95,
    'ai', 'tibo-temporal-v9-deadline-start-estimate',
    '2026-10-22T15:00:00Z', '2026-10-22T18:00:00Z', 'resolved', p_tweet_id,
    array[p_tweet_id]::text[], 1, 'none'
  );
end;
$function$;

create function pg_temp.reply_proof(p_tweet_id text)
returns jsonb language sql as $function$
  select to_jsonb(signal) from public.tibo_signals signal where signal.tweet_id = p_tweet_id
$function$;

create function pg_temp.make_forward_plan(
  p_tweet_id text,
  p_event_key text,
  p_previous_at timestamptz,
  p_observed_at timestamptz,
  p_previous_resets_at bigint,
  p_proof jsonb
)
returns jsonb language plpgsql as $function$
declare
  v_reset_key text := 'tibo-reset-' || p_tweet_id;
  v_current_resets_at bigint := p_previous_resets_at + 86400;
  v_estimate jsonb;
  v_fallback jsonb;
begin
  v_estimate := jsonb_build_object(
    'reset_event_key', v_reset_key,
    'display_execution_at', p_observed_at,
    'execution_time_source', 'usage_observation',
    'execution_time_confidence', 'high',
    'execution_time_precision', 'approximate',
    'execution_window_start_at', p_previous_at,
    'execution_window_end_at', p_observed_at,
    'recovery_previous_observed_at', p_previous_at,
    'recovery_observed_at', p_observed_at,
    'tibo_announced_at', '2026-10-22T06:55:54Z',
    'tibo_primary_tweet_id', p_tweet_id,
    'tibo_source_tweet_ids', jsonb_build_array(p_tweet_id),
    'official_notice_tweet_id', p_tweet_id,
    'official_notice_at', '2026-10-22T06:55:54Z',
    'estimator_version', 'usage-execution-monitor-v1',
    'manual_override_at', null,
    'manual_override_by', null,
    'manual_override_reason', null,
    'manual_execution_at', null,
    'manual_execution_precision', null,
    'is_monitor_observed', false
  );
  v_fallback := jsonb_build_object(
    'reset_event_key', 'usage-reset-pending',
    'display_execution_at', p_observed_at,
    'execution_time_source', 'usage_observation',
    'execution_time_confidence', 'high',
    'execution_time_precision', 'approximate',
    'execution_window_start_at', p_previous_at,
    'execution_window_end_at', p_observed_at,
    'recovery_previous_observed_at', p_previous_at,
    'recovery_observed_at', p_observed_at,
    'tibo_announced_at', null,
    'tibo_primary_tweet_id', null,
    'tibo_source_tweet_ids', '[]'::jsonb,
    'official_notice_tweet_id', null,
    'official_notice_at', null,
    'estimator_version', 'usage-execution-monitor-v1',
    'manual_override_at', null,
    'manual_override_by', null,
    'manual_override_reason', null,
    'manual_execution_at', null,
    'manual_execution_precision', null,
    'is_monitor_observed', true
  );
  return jsonb_build_object(
    'source_key', 'local-codex-app-server',
    'expected_previous_observed_at', p_previous_at,
    'state', jsonb_build_object(
      'source_key', 'local-codex-app-server',
      'observed_at', p_observed_at,
      'received_at', p_observed_at + interval '1 second',
      'limit_id', 'codex', 'plan_type', 'plus', 'used_percent', 0,
      'window_duration_mins', 10080, 'resets_at', v_current_resets_at,
      'coverage_started_at', p_previous_at,
      'banked_reset_available_count', 0,
      'last_banked_grant_at', null,
      'updated_at', p_observed_at + interval '1 second'
    ),
    'observation', jsonb_build_object(
      'source_key', 'local-codex-app-server',
      'observed_at', p_observed_at,
      'previous_observed_at', p_previous_at,
      'previous_used_percent', 100, 'current_used_percent', 0,
      'previous_resets_at', p_previous_resets_at,
      'current_resets_at', v_current_resets_at,
      'cycle_hint', 'unexpected', 'confidence', 'strong', 'status', 'observed',
      'matched_tibo_tweet_id', null, 'confirmed_at', null,
      'updated_at', p_observed_at + interval '1 second'
    ),
    'execution_estimate', v_estimate,
    'future_reply_claim', jsonb_build_object(
      'event_key', p_event_key,
      'reply_tweet_id', p_tweet_id,
      'recovery_observed_at', p_observed_at,
      'reset_event_key', v_reset_key,
      'reply_proof', p_proof
    ),
    'future_reply_fallback_execution_estimate', v_fallback
  );
end;
$function$;

create function pg_temp.seed_recovery(
  p_id uuid,
  p_previous_at timestamptz,
  p_observed_at timestamptz,
  p_previous_used numeric default 100,
  p_current_used numeric default 0,
  p_previous_resets bigint default 1800000000,
  p_current_resets bigint default 1800086400,
  p_status text default 'observed',
  p_matched_tweet_id text default null
)
returns uuid language plpgsql as $function$
begin
  insert into public.codex_recovery_observations (
    id, source_key, observed_at, previous_observed_at, previous_used_percent,
    current_used_percent, previous_resets_at, current_resets_at, cycle_hint,
    confidence, status, matched_tibo_tweet_id, confirmed_at
  ) values (
    p_id, 'local-codex-app-server', p_observed_at, p_previous_at, p_previous_used,
    p_current_used, p_previous_resets, p_current_resets, 'unexpected', 'strong',
    p_status, p_matched_tweet_id, case when p_status = 'confirmed' then p_observed_at + interval '1 second' else null end
  );
  return p_id;
end;
$function$;

create function pg_temp.seed_estimate(
  p_observation_id uuid,
  p_previous_at timestamptz,
  p_observed_at timestamptz,
  p_event_key text,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_display_at timestamptz default null,
  p_assigned_tweet_id text default null
)
returns uuid language plpgsql as $function$
declare
  v_id uuid;
begin
  insert into public.reset_execution_estimates (
    reset_event_key, display_execution_at, execution_time_source,
    execution_time_confidence, execution_time_precision,
    execution_window_start_at, execution_window_end_at, recovery_observation_id,
    recovery_previous_observed_at, recovery_observed_at, tibo_announced_at,
    tibo_primary_tweet_id, tibo_source_tweet_ids, official_notice_tweet_id,
    official_notice_at, estimator_version
  ) values (
    p_event_key, coalesce(p_display_at, p_observed_at), 'usage_observation', 'high', 'approximate',
    coalesce(p_start_at, p_previous_at), coalesce(p_end_at, p_observed_at), p_observation_id,
    p_previous_at, p_observed_at,
    case when p_assigned_tweet_id is null then null else '2026-10-21T01:00:00Z'::timestamptz end,
    p_assigned_tweet_id,
    case when p_assigned_tweet_id is null then '{}'::text[] else array[p_assigned_tweet_id]::text[] end,
    p_assigned_tweet_id,
    case when p_assigned_tweet_id is null then null else '2026-10-21T01:00:00Z'::timestamptz end,
    'usage-execution-monitor-v1'
  ) returning id into v_id;
  return v_id;
end;
$function$;

do $integration$
declare
  v_proof jsonb;
  v_plan jsonb;
  v_result jsonb;
  v_estimate_id uuid;
  v_observation_id uuid;
  v_claim_count integer;
  v_tibo_primary text;
  v_display timestamptz;
  v_id1 uuid := '10000000-0000-4000-8000-000000000001';
  v_id2 uuid := '10000000-0000-4000-8000-000000000002';
  v_id3 uuid := '10000000-0000-4000-8000-000000000003';
  v_prev timestamptz := '2026-10-22T17:54:00Z';
  v_obs timestamptz := '2026-10-22T17:59:00Z';
  v_reply text := '2113162413008884099';
  v_parent text := '2113162277688070445';
  v_event text := '2113162277688070445';
  v_previous_resets bigint := 1800000000;
begin
  -- B1: simulate a manual rejection after the application read the row but
  -- before the forward RPC. The real v2 transaction must persist a standalone
  -- monitor estimate without creating a notice claim.
  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  update public.tibo_signals set verification_status = 'rejected' where tweet_id = v_reply;
  v_plan := pg_temp.make_forward_plan(v_reply, v_event, v_prev, v_obs, v_previous_resets, v_proof);
  v_result := public.apply_codex_usage_future_reply_webhook_write(v_plan);
  perform pg_temp.assert_true(v_result ->> 'status' = 'applied', 'manual-rejected proof still records the real monitor recovery');
  perform pg_temp.assert_true(v_result ->> 'future_reply_proof_changed' = 'true', 'manual rejection is detected under the row lock');
  select count(*) into v_claim_count from public.codex_usage_future_reply_claims;
  perform pg_temp.assert_true(v_claim_count = 0, 'stale manual proof creates no future-reply claim');
  select e.tibo_primary_tweet_id into v_tibo_primary
    from public.reset_execution_estimates e join public.codex_recovery_observations o on o.id = e.recovery_observation_id;
  perform pg_temp.assert_true(v_tibo_primary is null, 'stale manual proof writes a standalone estimate');

  -- Context can change without a manual status transition; the full selected
  -- row snapshot must still fail closed and use the standalone estimate.
  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  update public.tibo_signals
     set reply_context_text = 'An edited parent context.',
         source_context_snapshot = jsonb_set(source_context_snapshot, '{parent,text}', to_jsonb('An edited parent context.'::text))
   where tweet_id = v_reply;
  v_plan := pg_temp.make_forward_plan(v_reply, v_event, v_prev, v_obs, v_previous_resets, v_proof);
  v_result := public.apply_codex_usage_future_reply_webhook_write(v_plan);
  perform pg_temp.assert_true(v_result ->> 'future_reply_proof_changed' = 'true', 'context mutation is detected');
  select count(*) into v_claim_count from public.codex_usage_future_reply_claims;
  perform pg_temp.assert_true(v_claim_count = 0, 'context mutation creates no claim');

  -- B4: successful adoption uses actual v2/v1 functions, then an update to
  -- the same recovery observation preserves the existing estimate row id.
  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_plan := pg_temp.make_forward_plan(v_reply, v_event, v_prev, v_obs, v_previous_resets, v_proof);
  v_result := public.apply_codex_usage_future_reply_webhook_write(v_plan);
  perform pg_temp.assert_true(v_result ->> 'status' = 'applied', 'valid future reply is persisted through actual v2');
  perform pg_temp.assert_true(v_result ->> 'future_reply_proof_changed' = 'false', 'valid proof remains current');
  select e.id, e.display_execution_at, e.recovery_observation_id
    into v_estimate_id, v_display, v_observation_id
    from public.reset_execution_estimates e where e.reset_event_key = 'tibo-reset-' || v_reply;
  perform pg_temp.assert_true(v_estimate_id is not null, 'estimate was inserted by actual v1');
  perform pg_temp.assert_true((select tibo_primary_tweet_id = v_reply from public.reset_execution_estimates where id = v_estimate_id), 'estimate kept selected reply association');
  v_result := public.apply_codex_usage_webhook_write_v2(jsonb_build_object(
    'source_key', 'local-codex-app-server',
    'expected_previous_observed_at', v_obs,
    'state', jsonb_build_object(
      'source_key', 'local-codex-app-server', 'observed_at', v_obs + interval '1 minute',
      'received_at', v_obs + interval '61 seconds', 'limit_id', 'codex', 'plan_type', 'plus',
      'used_percent', 0, 'window_duration_mins', 10080,
      'resets_at', v_previous_resets + 86400, 'coverage_started_at', v_prev,
      'banked_reset_available_count', 0, 'last_banked_grant_at', null,
      'updated_at', v_obs + interval '61 seconds'
    ),
    'execution_estimate', jsonb_build_object(
      'reset_event_key', 'tibo-reset-' || v_reply,
      'display_execution_at', v_obs + interval '1 minute',
      'execution_time_source', 'usage_observation',
      'execution_time_confidence', 'high', 'execution_time_precision', 'approximate',
      'execution_window_start_at', v_prev, 'execution_window_end_at', v_obs,
      'recovery_observation_id', v_observation_id,
      'tibo_primary_tweet_id', v_reply, 'tibo_source_tweet_ids', jsonb_build_array(v_reply),
      'official_notice_tweet_id', v_reply, 'estimator_version', 'usage-execution-monitor-v1'
    )
  ));
  perform pg_temp.assert_true(v_result ->> 'status' = 'applied', 'actual v2 updates an existing observation estimate');
  perform pg_temp.assert_true((select id = v_estimate_id and display_execution_at = v_display from public.reset_execution_estimates where reset_event_key = 'tibo-reset-' || v_reply), 'estimate update preserves row identity and observed display time');

  -- Reusing the event key with a different reply falls back; the original
  -- persisted claim and notice-linked estimate remain unchanged.
  perform pg_temp.seed_notice('2113162413008884100', v_parent);
  v_plan := pg_temp.make_forward_plan(
    '2113162413008884100', v_event, v_obs + interval '1 minute', v_obs + interval '2 minutes',
    v_previous_resets + 86400, pg_temp.reply_proof('2113162413008884100')
  );
  v_result := public.apply_codex_usage_future_reply_webhook_write(v_plan);
  perform pg_temp.assert_true(v_result ->> 'future_reply_reuse_blocked' = 'true', 'conflicting claim reuse is detected');
  select count(*) into v_claim_count from public.codex_usage_future_reply_claims where event_key = v_event and reply_tweet_id = v_reply;
  perform pg_temp.assert_true(v_claim_count = 1, 'conflicting reuse preserves the original claim identity');
  perform pg_temp.assert_true((select tibo_primary_tweet_id is null from public.reset_execution_estimates where reset_event_key = 'usage-reset-' || (select id::text from public.codex_recovery_observations where observed_at = v_obs + interval '2 minutes')), 'conflicting reuse persists a standalone estimate');

  -- B2 counterexample: one estimate is assigned to another notice and the
  -- other is standalone. Both valid observations count, so adoption is denied.
  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev - interval '4 minutes', v_prev + interval '1 minute', 100, 0, v_previous_resets, v_previous_resets + 86400, 'confirmed', '2113162413008884100');
  v_id2 := pg_temp.seed_recovery(v_id2, v_prev, v_obs, 100, 0, v_previous_resets, v_previous_resets + 172800);
  perform pg_temp.seed_estimate(v_id1, v_prev - interval '4 minutes', v_prev + interval '1 minute', 'usage-reset-' || v_id1, null, null, null, '2113162413008884100');
  perform pg_temp.seed_estimate(v_id2, v_prev, v_obs, 'usage-reset-' || v_id2);
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'assigned plus standalone observations remain ambiguous');
  perform pg_temp.assert_true((select tibo_primary_tweet_id is null from public.reset_execution_estimates where recovery_observation_id = v_id2), 'ambiguity does not mutate the standalone estimate');

  -- B2 counterexample: two observations but only one estimate still count as
  -- ambiguous before the selected observation's estimate is loaded.
  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev - interval '4 minutes', v_prev + interval '1 minute');
  v_id2 := pg_temp.seed_recovery(v_id2, v_prev, v_obs, 100, 0, v_previous_resets, v_previous_resets + 86400);
  perform pg_temp.seed_estimate(v_id2, v_prev, v_obs, 'usage-reset-' || v_id2);
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'missing estimate does not erase a second valid observation');

  -- B3: the SQL gate must reject a sub-point used drop, insufficient reset
  -- advance, non-exact estimate bounds/display, and the manual exclusion.
  -- Drop fixture-only integrity checks so the SQL policy itself is exercised
  -- against corrupt rows that normal writes cannot create.
  execute 'alter table public.codex_recovery_observations drop constraint if exists codex_recovery_observations_previous_used_percent_check';
  execute 'alter table public.codex_recovery_observations drop constraint if exists codex_recovery_observations_current_used_percent_check';
  execute 'alter table public.codex_recovery_observations drop constraint if exists codex_recovery_observations_previous_resets_at_check';
  execute 'alter table public.codex_recovery_observations drop constraint if exists codex_recovery_observations_current_resets_at_check';

  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev, v_obs, 101, 0, v_previous_resets, v_previous_resets + 3600);
  perform pg_temp.seed_estimate(v_id1, v_prev, v_obs, 'usage-reset-' || v_id1);
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'used percentages outside 0..100 are rejected');

  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev, v_obs, 100, 'Infinity'::numeric, v_previous_resets, v_previous_resets + 3600);
  perform pg_temp.seed_estimate(v_id1, v_prev, v_obs, 'usage-reset-' || v_id1);
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'non-finite used percentage is rejected');

  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev, v_obs, 100, 0, -1, 3599);
  perform pg_temp.seed_estimate(v_id1, v_prev, v_obs, 'usage-reset-' || v_id1);
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'non-positive reset timestamp is rejected');

  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev, v_obs, 60.5, 60, v_previous_resets, v_previous_resets + 3600);
  perform pg_temp.seed_estimate(v_id1, v_prev, v_obs, 'usage-reset-' || v_id1);
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'used percent drop under one point is rejected');

  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev, v_obs, 100, 0, v_previous_resets, v_previous_resets + 3599);
  perform pg_temp.seed_estimate(v_id1, v_prev, v_obs, 'usage-reset-' || v_id1);
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'reset advance below one hour is rejected');

  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := '10000000-0000-4000-8000-000000000001';
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev, v_obs);
  perform pg_temp.seed_estimate(v_id1, v_prev, v_obs, 'usage-reset-' || v_id1, v_prev - interval '1 second', v_obs, v_obs);
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'estimate start must equal previous observation time');

  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev, v_obs);
  perform pg_temp.seed_estimate(v_id1, v_prev, v_obs, 'usage-reset-' || v_id1, v_prev, v_obs, v_obs - interval '1 second');
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'estimate display must equal observation time');

  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := pg_temp.seed_recovery('512a8b31-e43e-4f91-b5e6-7023b87e80ec', v_prev, v_obs);
  perform pg_temp.seed_estimate(v_id1, v_prev, v_obs, 'usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec');
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'no_candidate', 'manual recovery observation exclusion is applied');

  -- Positive reverse path links only provenance to the exact-window
  -- standalone estimate. Its canonical usage-reset identity and timing stay
  -- unchanged so downstream history uses the persisted event key.
  perform pg_temp.clear_fixture();
  perform pg_temp.seed_state(v_prev, v_previous_resets);
  perform pg_temp.seed_notice(v_reply, v_parent);
  v_proof := pg_temp.reply_proof(v_reply);
  v_id1 := '10000000-0000-4000-8000-000000000001';
  v_id1 := pg_temp.seed_recovery(v_id1, v_prev, v_obs);
  perform pg_temp.seed_estimate(v_id1, v_prev, v_obs, 'usage-reset-' || v_id1);
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'linked', 'one authoritative observation with exact estimate links: ' || v_result::text);
  perform pg_temp.assert_true(v_result ->> 'reset_event_key' = 'usage-reset-' || v_id1, 'monitor-first linking returns the existing usage-reset event key');
  perform pg_temp.assert_true(
    (select reset_event_key = 'usage-reset-' || v_id1 and tibo_primary_tweet_id = v_reply
             and recovery_observation_id = v_id1
             and execution_time_precision = 'approximate'
             and display_execution_at = v_obs
             and execution_window_start_at = v_prev
             and execution_window_end_at = v_obs
       from public.reset_execution_estimates where recovery_observation_id = v_id1),
    'monitor-first linking preserves estimate identity and timing while adding Tibo provenance'
  );
  perform pg_temp.assert_true(
    (select reset_event_key = 'usage-reset-' || v_id1 and reply_tweet_id = v_reply
       from public.codex_usage_future_reply_claims where event_key = v_event),
    'monitor-first claim stores the unchanged estimate event key'
  );

  -- Replaying the same verified notice keeps the original identity and
  -- requests cache invalidation without producing a second claim.
  v_result := public.reconcile_codex_future_reply_notice(v_reply, v_proof);
  perform pg_temp.assert_true(v_result ->> 'status' = 'already_linked', 'replaying a linked verified notice remains idempotent');
  perform pg_temp.assert_true(v_result ->> 'needs_cache_invalidation' = 'true', 'linked claim requests pending cache invalidation');
  perform pg_temp.assert_true(v_result ->> 'reset_event_key' = 'usage-reset-' || v_id1, 'replayed claim returns the original usage-reset event key');
  perform pg_temp.assert_true(
    (select reset_event_key = 'usage-reset-' || v_id1
       from public.reset_execution_estimates where recovery_observation_id = v_id1),
    'replay preserves the estimate event key'
  );
  perform pg_temp.assert_true(
    (select reset_event_key = 'usage-reset-' || v_id1
       from public.codex_usage_future_reply_claims where event_key = v_event),
    'replay preserves the persisted claim event key'
  );
  select count(*) into v_claim_count from public.codex_usage_future_reply_claims where event_key = v_event;
  perform pg_temp.assert_true(v_claim_count = 1, 'replay does not create a duplicate claim');

  raise notice 'codex future reply PostgreSQL assertions passed';
end;
$integration$;
