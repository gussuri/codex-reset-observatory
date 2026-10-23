create table if not exists public.codex_usage_future_reply_claims (
  event_key text primary key check (event_key ~ '^[0-9]{15,30}$'),
  reply_tweet_id text not null check (reply_tweet_id ~ '^[0-9]{15,30}$'),
  source_key text not null check (source_key = 'local-codex-app-server'),
  recovery_observed_at timestamptz not null,
  reset_event_key text not null,
  cache_invalidation_pending boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.codex_usage_future_reply_claims enable row level security;
revoke all privileges on table public.codex_usage_future_reply_claims from public, anon, authenticated;
grant all privileges on table public.codex_usage_future_reply_claims to service_role;

create or replace function public.apply_codex_usage_future_reply_webhook_write(p_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_claim jsonb;
  v_fallback_estimate jsonb;
  v_plan jsonb;
  v_event_key text;
  v_reply_tweet_id text;
  v_recovery_observed_at timestamptz;
  v_reset_event_key text;
  v_existing public.codex_usage_future_reply_claims%rowtype;
  v_existing_found boolean := false;
  v_reuse_blocked boolean := false;
  v_result jsonb;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception using errcode = '22023', message = 'Codex future-reply write plan must be a JSON object';
  end if;

  v_claim := p_plan -> 'future_reply_claim';
  v_fallback_estimate := p_plan -> 'future_reply_fallback_execution_estimate';
  if v_claim is null or jsonb_typeof(v_claim) <> 'object' or
     v_fallback_estimate is null or jsonb_typeof(v_fallback_estimate) <> 'object' or
     jsonb_typeof(p_plan -> 'execution_estimate') <> 'object' then
    raise exception using errcode = '22023', message = 'Future-reply claim requires an estimate and standalone fallback';
  end if;

  v_event_key := nullif(v_claim ->> 'event_key', '');
  v_reply_tweet_id := nullif(v_claim ->> 'reply_tweet_id', '');
  v_recovery_observed_at := (v_claim ->> 'recovery_observed_at')::timestamptz;
  v_reset_event_key := nullif(v_claim ->> 'reset_event_key', '');
  if v_event_key is null or v_event_key !~ '^[0-9]{15,30}$' or
     v_reply_tweet_id is null or v_reply_tweet_id !~ '^[0-9]{15,30}$' or
     v_recovery_observed_at is null or v_reset_event_key is null or
     v_fallback_estimate ->> 'reset_event_key' <> 'usage-reset-pending' or
     v_fallback_estimate ->> 'is_monitor_observed' <> 'true' then
    raise exception using errcode = '22023', message = 'Invalid future-reply event identity or standalone fallback';
  end if;

  -- All forward and reverse paths lock the event identity before monitor-state,
  -- observation, or estimate rows. The transaction remains scoped to this RPC.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('codex-usage-future-reply:' || v_event_key)
  );
  select * into v_existing
    from public.codex_usage_future_reply_claims
   where event_key = v_event_key;
  v_existing_found := found;
  v_reuse_blocked := v_existing_found and (
    v_existing.reply_tweet_id is distinct from v_reply_tweet_id or
    v_existing.source_key is distinct from 'local-codex-app-server' or
    v_existing.recovery_observed_at is distinct from v_recovery_observed_at or
    v_existing.reset_event_key is distinct from v_reset_event_key
  );

  v_plan := p_plan - 'future_reply_claim' - 'future_reply_fallback_execution_estimate';
  if v_reuse_blocked then
    v_plan := pg_catalog.jsonb_set(v_plan, '{execution_estimate}', v_fallback_estimate, true);
  end if;

  v_result := public.apply_codex_usage_webhook_write_v2(v_plan);
  if v_result ->> 'status' <> 'applied' then
    return v_result || pg_catalog.jsonb_build_object('future_reply_reuse_blocked', v_reuse_blocked);
  end if;

  if not v_existing_found then
    insert into public.codex_usage_future_reply_claims (
      event_key,
      reply_tweet_id,
      source_key,
      recovery_observed_at,
      reset_event_key
    ) values (
      v_event_key,
      v_reply_tweet_id,
      'local-codex-app-server',
      v_recovery_observed_at,
      v_reset_event_key
    );
  end if;

  return v_result || pg_catalog.jsonb_build_object('future_reply_reuse_blocked', v_reuse_blocked);
end;
$function$;

revoke all on function public.apply_codex_usage_future_reply_webhook_write(jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_codex_usage_future_reply_webhook_write(jsonb)
  to service_role;

create or replace function public.reconcile_codex_future_reply_notice(
  p_tweet_id text,
  p_expected_proof jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_signal public.tibo_signals%rowtype;
  v_monitor_state public.codex_usage_monitor_state%rowtype;
  v_observation public.codex_recovery_observations%rowtype;
  v_estimate public.reset_execution_estimates%rowtype;
  v_claim public.codex_usage_future_reply_claims%rowtype;
  v_event_key text;
  v_candidate record;
  v_candidate_count integer := 0;
  v_candidate_observation_id uuid;
  v_candidate_estimate_id uuid;
  v_monitor_state_found boolean := false;
  v_claim_found boolean := false;
  v_revision_count integer := 0;
  v_revision_unique_count integer := 0;
  v_snapshot_key_count integer := 0;
  v_parent_key_count integer := 0;
  v_already_linked boolean := false;
begin
  if p_tweet_id is null or p_tweet_id !~ '^[0-9]{15,30}$' or
     p_expected_proof is null or pg_catalog.jsonb_typeof(p_expected_proof) is distinct from 'object' or
     not (p_expected_proof ?& array[
       'tweet_id', 'text', 'tweet_url', 'tweet_created_at', 'signal_type', 'confidence',
       'verification_status', 'classification_source', 'ai_confidence', 'ai_signal_type',
       'ai_classification_status', 'ai_temporal_direction', 'ai_notice_timing_status',
       'ai_evidence_quote', 'ai_temporal_expression', 'ai_temporal_kind', 'ai_temporal_precision',
       'ai_temporal_timezone', 'ai_temporal_confidence', 'ai_contextual_reset_assessment',
       'ai_contextual_reset_tweet_id', 'is_reply', 'is_quote', 'quote_context_text',
       'quote_tweet_url', 'quote_author_handle', 'reply_to_handles', 'reply_context_text',
       'source_context_snapshot', 'source_context_revision_hashes',
       'source_context_classified_revision_hashes', 'source_context_generation',
       'temporal_expression', 'temporal_kind', 'temporal_precision', 'temporal_timezone',
       'temporal_confidence', 'expected_start_at', 'expected_end_at',
       'temporal_resolution_status', 'temporal_resolution_version'
     ]) then
    return pg_catalog.jsonb_build_object('status', 'invalid_proof', 'needs_cache_invalidation', false);
  end if;

  v_event_key := p_expected_proof ->> 'ai_contextual_reset_tweet_id';
  if v_event_key is null or v_event_key !~ '^[0-9]{15,30}$' then
    return pg_catalog.jsonb_build_object('status', 'invalid_proof', 'needs_cache_invalidation', false);
  end if;

  -- Forward and reverse writes serialize on the source parent before taking
  -- monitor, observation, estimate, or claim row locks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('codex-usage-future-reply:' || v_event_key)
  );

  select * into v_monitor_state
    from public.codex_usage_monitor_state
   where source_key = 'local-codex-app-server'
   for update;
  v_monitor_state_found := found;
  if not v_monitor_state_found then
    return pg_catalog.jsonb_build_object('status', 'no_candidate', 'needs_cache_invalidation', false);
  end if;

  select * into v_signal
    from public.tibo_signals
   where tweet_id = p_tweet_id
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'proof_changed', 'needs_cache_invalidation', false);
  end if;

  -- Compare every selected proof field using its database type. A new or
  -- edited classification must be validated again by the caller before retry.
  if v_signal.tweet_id is distinct from p_tweet_id or
     v_signal.tweet_id is distinct from p_expected_proof ->> 'tweet_id' or
     v_signal.text is distinct from p_expected_proof ->> 'text' or
     v_signal.tweet_url is distinct from p_expected_proof ->> 'tweet_url' or
     v_signal.tweet_created_at is distinct from nullif(p_expected_proof ->> 'tweet_created_at', '')::timestamptz or
     v_signal.signal_type is distinct from p_expected_proof ->> 'signal_type' or
     v_signal.confidence is distinct from nullif(p_expected_proof ->> 'confidence', '')::numeric or
     v_signal.verification_status is distinct from p_expected_proof ->> 'verification_status' or
     v_signal.classification_source is distinct from p_expected_proof ->> 'classification_source' or
     v_signal.ai_confidence is distinct from nullif(p_expected_proof ->> 'ai_confidence', '')::numeric or
     v_signal.ai_signal_type is distinct from p_expected_proof ->> 'ai_signal_type' or
     v_signal.ai_classification_status is distinct from p_expected_proof ->> 'ai_classification_status' or
     v_signal.ai_temporal_direction is distinct from p_expected_proof ->> 'ai_temporal_direction' or
     v_signal.ai_notice_timing_status is distinct from p_expected_proof ->> 'ai_notice_timing_status' or
     v_signal.ai_evidence_quote is distinct from p_expected_proof ->> 'ai_evidence_quote' or
     v_signal.ai_temporal_expression is distinct from p_expected_proof ->> 'ai_temporal_expression' or
     v_signal.ai_temporal_kind is distinct from p_expected_proof ->> 'ai_temporal_kind' or
     v_signal.ai_temporal_precision is distinct from p_expected_proof ->> 'ai_temporal_precision' or
     v_signal.ai_temporal_timezone is distinct from p_expected_proof ->> 'ai_temporal_timezone' or
     v_signal.ai_temporal_confidence is distinct from nullif(p_expected_proof ->> 'ai_temporal_confidence', '')::numeric or
     v_signal.ai_contextual_reset_assessment is distinct from p_expected_proof ->> 'ai_contextual_reset_assessment' or
     v_signal.ai_contextual_reset_tweet_id is distinct from p_expected_proof ->> 'ai_contextual_reset_tweet_id' or
     v_signal.is_reply is distinct from (p_expected_proof ->> 'is_reply')::boolean or
     v_signal.is_quote is distinct from (p_expected_proof ->> 'is_quote')::boolean or
     v_signal.quote_context_text is distinct from p_expected_proof ->> 'quote_context_text' or
     v_signal.quote_tweet_url is distinct from p_expected_proof ->> 'quote_tweet_url' or
     v_signal.quote_author_handle is distinct from p_expected_proof ->> 'quote_author_handle' or
     pg_catalog.to_jsonb(v_signal.reply_to_handles) is distinct from p_expected_proof -> 'reply_to_handles' or
     v_signal.reply_context_text is distinct from p_expected_proof ->> 'reply_context_text' or
     v_signal.source_context_snapshot is distinct from p_expected_proof -> 'source_context_snapshot' or
     pg_catalog.to_jsonb(v_signal.source_context_revision_hashes) is distinct from p_expected_proof -> 'source_context_revision_hashes' or
     pg_catalog.to_jsonb(v_signal.source_context_classified_revision_hashes) is distinct from p_expected_proof -> 'source_context_classified_revision_hashes' or
     v_signal.source_context_generation is distinct from nullif(p_expected_proof ->> 'source_context_generation', '')::integer or
     v_signal.temporal_expression is distinct from p_expected_proof ->> 'temporal_expression' or
     v_signal.temporal_kind is distinct from p_expected_proof ->> 'temporal_kind' or
     v_signal.temporal_precision is distinct from p_expected_proof ->> 'temporal_precision' or
     v_signal.temporal_timezone is distinct from p_expected_proof ->> 'temporal_timezone' or
     v_signal.temporal_confidence is distinct from nullif(p_expected_proof ->> 'temporal_confidence', '')::numeric or
     v_signal.expected_start_at is distinct from nullif(p_expected_proof ->> 'expected_start_at', '')::timestamptz or
     v_signal.expected_end_at is distinct from nullif(p_expected_proof ->> 'expected_end_at', '')::timestamptz or
     v_signal.temporal_resolution_status is distinct from p_expected_proof ->> 'temporal_resolution_status' or
     v_signal.temporal_resolution_version is distinct from p_expected_proof ->> 'temporal_resolution_version' then
    return pg_catalog.jsonb_build_object('status', 'proof_changed', 'needs_cache_invalidation', false);
  end if;

  if pg_catalog.jsonb_typeof(v_signal.source_context_snapshot) is distinct from 'object' then
    return pg_catalog.jsonb_build_object('status', 'proof_changed', 'needs_cache_invalidation', false);
  end if;
  select pg_catalog.count(*) into v_snapshot_key_count
    from pg_catalog.jsonb_object_keys(v_signal.source_context_snapshot);
  if v_snapshot_key_count <> 1 or not (v_signal.source_context_snapshot ? 'parent') or
     pg_catalog.jsonb_typeof(v_signal.source_context_snapshot -> 'parent') is distinct from 'object' then
    return pg_catalog.jsonb_build_object('status', 'proof_changed', 'needs_cache_invalidation', false);
  end if;
  select pg_catalog.count(*) into v_parent_key_count
    from pg_catalog.jsonb_object_keys(v_signal.source_context_snapshot -> 'parent');
  if v_parent_key_count <> 4 or
     not ((v_signal.source_context_snapshot -> 'parent') ?& array['tweetId', 'tweetUrl', 'authorHandle', 'text']) then
    return pg_catalog.jsonb_build_object('status', 'proof_changed', 'needs_cache_invalidation', false);
  end if;

  if v_signal.signal_type is distinct from 'official_notice' or
     v_signal.verification_status is distinct from 'auto_unverified' or
     v_signal.classification_source is distinct from 'gemini' or
     v_signal.ai_signal_type is distinct from 'official_notice' or
     v_signal.ai_classification_status is distinct from 'success' or
     v_signal.ai_temporal_direction is distinct from 'future' or
     v_signal.ai_notice_timing_status is distinct from 'known' or
     v_signal.ai_contextual_reset_assessment is distinct from 'same_global_reset' or
     v_signal.is_reply is distinct from true or v_signal.is_quote is distinct from false or
     v_signal.confidence < 0.95 or v_signal.ai_confidence < 0.95 or
     v_signal.tweet_url is null or
     pg_catalog.btrim(coalesce(v_signal.text, '')) = '' or
     pg_catalog.btrim(coalesce(v_signal.ai_evidence_quote, '')) = '' or
     pg_catalog.strpos(v_signal.text, v_signal.ai_evidence_quote) = 0 or
     v_signal.tweet_url !~* ('^https://(www\.)?(x\.com|twitter\.com)/thsottiaux/status/' || v_signal.tweet_id || '/?$') or
     v_signal.tweet_id !~ '^[0-9]{15,30}$' or
     v_signal.ai_contextual_reset_tweet_id !~ '^[0-9]{15,30}$' or
     pg_catalog.btrim(coalesce(v_signal.reply_context_text, '')) = '' or
     pg_catalog.length(v_signal.reply_context_text) > 1000 or
     coalesce(pg_catalog.btrim(v_signal.quote_context_text), '') <> '' or
     coalesce(pg_catalog.btrim(v_signal.quote_tweet_url), '') <> '' or
     coalesce(pg_catalog.btrim(v_signal.quote_author_handle), '') <> '' or
     pg_catalog.jsonb_typeof(pg_catalog.to_jsonb(v_signal.reply_to_handles)) is distinct from 'array' or
     pg_catalog.jsonb_array_length(pg_catalog.to_jsonb(v_signal.reply_to_handles)) = 0 or
     not exists (
       select 1
         from pg_catalog.jsonb_array_elements_text(pg_catalog.to_jsonb(v_signal.reply_to_handles)) as handle(value)
        where pg_catalog.lower(pg_catalog.btrim(handle.value, '@ ')) = 'thsottiaux'
     ) or
     pg_catalog.jsonb_typeof(v_signal.source_context_snapshot) is distinct from 'object' or
     pg_catalog.octet_length(v_signal.source_context_snapshot::text) > 8192 or
     not (v_signal.source_context_snapshot ? 'parent') or
     pg_catalog.jsonb_typeof(v_signal.source_context_snapshot -> 'parent') is distinct from 'object' or
     not ((v_signal.source_context_snapshot -> 'parent') ?& array['tweetId', 'tweetUrl', 'authorHandle', 'text']) or
     (v_signal.source_context_snapshot -> 'parent' ->> 'tweetId') !~ '^[0-9]{15,30}$' or
     (v_signal.source_context_snapshot -> 'parent' ->> 'tweetId') = v_signal.tweet_id or
     (v_signal.source_context_snapshot -> 'parent' ->> 'tweetId') is distinct from v_signal.ai_contextual_reset_tweet_id or
     (v_signal.source_context_snapshot -> 'parent' ->> 'tweetUrl') is null or
     (v_signal.source_context_snapshot -> 'parent' ->> 'tweetUrl') !~* (
       '^https://(www\.)?(x\.com|twitter\.com)/thsottiaux/status/' ||
       (v_signal.source_context_snapshot -> 'parent' ->> 'tweetId') || '/?$'
     ) or
     pg_catalog.lower(pg_catalog.btrim(v_signal.source_context_snapshot -> 'parent' ->> 'authorHandle', '@ ')) is distinct from 'thsottiaux' or
     pg_catalog.btrim(coalesce(v_signal.source_context_snapshot -> 'parent' ->> 'text', '')) = '' or
     pg_catalog.length(v_signal.source_context_snapshot -> 'parent' ->> 'text') > 1000 or
     v_signal.source_context_snapshot -> 'parent' ->> 'text' is distinct from v_signal.reply_context_text or
     (v_signal.source_context_snapshot -> 'parent' ->> 'text') !~* '(^|[^[:alnum:]_])(reset|usage[[:space:]]+limits?|rate[[:space:]]+limits?|quota)([^[:alnum:]_]|$)' or
     pg_catalog.cardinality(coalesce(v_signal.source_context_revision_hashes, '{}'::text[])) not between 1 and 3 or
     pg_catalog.cardinality(v_signal.source_context_classified_revision_hashes) <> pg_catalog.cardinality(v_signal.source_context_revision_hashes) or
     v_signal.source_context_classified_revision_hashes is distinct from v_signal.source_context_revision_hashes or
     v_signal.source_context_generation is null or v_signal.source_context_generation <= 0 or
     v_signal.temporal_resolution_status is distinct from 'resolved' or
     v_signal.temporal_resolution_version is distinct from 'tibo-temporal-v9-deadline-start-estimate' or
     v_signal.temporal_expression is null or pg_catalog.btrim(v_signal.temporal_expression) = '' or
     v_signal.temporal_kind is null or v_signal.temporal_kind not in ('none', 'absolute', 'weekday', 'relative_day', 'relative_duration', 'daypart', 'range', 'vague') or
     v_signal.temporal_precision is null or v_signal.temporal_precision not in ('exact_time', 'day', 'daypart', 'range', 'unknown', 'window') or
     v_signal.temporal_confidence is null or v_signal.temporal_confidence < 0 or v_signal.temporal_confidence > 1 or
     v_signal.expected_start_at is null or v_signal.expected_end_at is null or
     v_signal.expected_start_at >= v_signal.expected_end_at or
     v_signal.expected_end_at <= v_signal.tweet_created_at or
     v_signal.expected_start_at <> greatest(v_signal.tweet_created_at, v_signal.expected_end_at - interval '3 hours') or
     not (
       v_signal.temporal_expression ~* '(^|[^[:alnum:]_])(by|before|until)[[:space:]]+[^[:space:]].*' or
       v_signal.text ~* '(までに|まで[にへと]|本日中)'
     ) then
    return pg_catalog.jsonb_build_object('status', 'proof_changed', 'needs_cache_invalidation', false);
  end if;

  select pg_catalog.count(*), pg_catalog.count(distinct revision.value)
    into v_revision_count, v_revision_unique_count
    from pg_catalog.unnest(v_signal.source_context_revision_hashes) as revision(value)
   where revision.value ~ '^[a-f0-9]{64}$';
  if v_revision_count <> pg_catalog.cardinality(v_signal.source_context_revision_hashes) or
     v_revision_unique_count <> v_revision_count then
    return pg_catalog.jsonb_build_object('status', 'proof_changed', 'needs_cache_invalidation', false);
  end if;

  -- Count a bounded candidate set and fail closed unless there is exactly one.
  for v_candidate in
    select o.id as observation_id, e.id as estimate_id
      from public.codex_recovery_observations as o
      join public.reset_execution_estimates as e
        on e.recovery_observation_id = o.id
     where o.source_key = 'local-codex-app-server'
       and o.status = 'observed'
       and o.confidence = 'strong'
       and o.cycle_hint = 'unexpected'
       and o.matched_tibo_tweet_id is null
       and o.previous_observed_at is not null
       and o.previous_observed_at < o.observed_at
       and o.observed_at - o.previous_observed_at <= interval '10 minutes'
       and e.estimator_version = 'usage-execution-monitor-v1'
       and e.execution_time_source = 'usage_observation'
       and e.execution_time_confidence = 'high'
       and e.execution_time_precision = 'approximate'
       and e.recovery_previous_observed_at = o.previous_observed_at
       and e.recovery_observed_at = o.observed_at
       and e.execution_window_start_at is not null
       and e.execution_window_end_at is not null
       and e.execution_window_start_at < e.execution_window_end_at
       and e.display_execution_at = e.execution_window_end_at
       and (
         (
           e.tibo_announced_at is null
           and e.tibo_primary_tweet_id is null
           and coalesce(e.tibo_source_tweet_ids, '{}'::text[]) = '{}'::text[]
           and e.official_notice_tweet_id is null
           and e.official_notice_at is null
         ) or (
           e.tibo_announced_at = v_signal.tweet_created_at
           and e.tibo_primary_tweet_id = p_tweet_id
           and e.tibo_source_tweet_ids = array[p_tweet_id]::text[]
           and e.official_notice_tweet_id = p_tweet_id
           and e.official_notice_at = v_signal.tweet_created_at
         )
       )
       and e.manual_override_at is null
       and e.manual_override_by is null
       and e.manual_override_reason is null
       and e.manual_execution_at is null
       and e.manual_execution_precision is null
       and v_signal.tweet_created_at <= e.execution_window_start_at
       and v_signal.expected_start_at < e.execution_window_end_at
       and v_signal.expected_end_at > e.execution_window_start_at
     order by o.observed_at, o.id
     limit 51
  loop
    v_candidate_count := v_candidate_count + 1;
    if v_candidate_count = 1 then
      v_candidate_observation_id := v_candidate.observation_id;
      v_candidate_estimate_id := v_candidate.estimate_id;
    end if;
  end loop;

  if v_candidate_count <> 1 then
    return pg_catalog.jsonb_build_object(
      'status', case when v_candidate_count > 50 then 'candidate_limit' else 'no_candidate' end,
      'needs_cache_invalidation', false
    );
  end if;

  select * into v_observation
    from public.codex_recovery_observations
   where id = v_candidate_observation_id
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'no_candidate', 'needs_cache_invalidation', false);
  end if;

  select * into v_estimate
    from public.reset_execution_estimates
   where id = v_candidate_estimate_id
   for update;
  if not found or
     v_estimate.recovery_observation_id is distinct from v_observation.id or
     v_observation.source_key is distinct from 'local-codex-app-server' or
     v_observation.status is distinct from 'observed' or
     v_observation.confidence is distinct from 'strong' or
     v_observation.cycle_hint is distinct from 'unexpected' or
     v_observation.matched_tibo_tweet_id is not null or
     v_observation.previous_observed_at is null or
     v_observation.previous_observed_at >= v_observation.observed_at or
     v_observation.observed_at - v_observation.previous_observed_at > interval '10 minutes' or
     v_estimate.estimator_version is distinct from 'usage-execution-monitor-v1' or
     v_estimate.execution_time_source is distinct from 'usage_observation' or
     v_estimate.execution_time_confidence is distinct from 'high' or
     v_estimate.execution_time_precision is distinct from 'approximate' or
     v_estimate.recovery_previous_observed_at is distinct from v_observation.previous_observed_at or
     v_estimate.recovery_observed_at is distinct from v_observation.observed_at or
     v_estimate.execution_window_start_at is null or v_estimate.execution_window_end_at is null or
     v_estimate.execution_window_start_at >= v_estimate.execution_window_end_at or
     v_estimate.display_execution_at is distinct from v_estimate.execution_window_end_at or
     v_signal.tweet_created_at > v_estimate.execution_window_start_at or
     v_signal.expected_start_at >= v_estimate.execution_window_end_at or
     v_signal.expected_end_at <= v_estimate.execution_window_start_at or
     v_estimate.manual_override_at is not null or v_estimate.manual_override_by is not null or
     v_estimate.manual_override_reason is not null or v_estimate.manual_execution_at is not null or
     v_estimate.manual_execution_precision is not null then
    return pg_catalog.jsonb_build_object('status', 'no_candidate', 'needs_cache_invalidation', false);
  end if;

  select * into v_claim
    from public.codex_usage_future_reply_claims
   where event_key = v_event_key
   for update;
  v_claim_found := found;
  v_already_linked := v_estimate.tibo_announced_at = v_signal.tweet_created_at and
    v_estimate.tibo_primary_tweet_id = p_tweet_id and
    v_estimate.tibo_source_tweet_ids = array[p_tweet_id]::text[] and
    v_estimate.official_notice_tweet_id = p_tweet_id and
    v_estimate.official_notice_at = v_signal.tweet_created_at;

  if v_claim_found and (
    v_claim.reply_tweet_id is distinct from p_tweet_id or
    v_claim.source_key is distinct from 'local-codex-app-server' or
    v_claim.recovery_observed_at is distinct from v_observation.observed_at or
    v_claim.reset_event_key is distinct from v_estimate.reset_event_key
  ) then
    return pg_catalog.jsonb_build_object('status', 'claim_conflict', 'needs_cache_invalidation', false);
  end if;

  if v_claim_found then
    if not v_already_linked then
      return pg_catalog.jsonb_build_object('status', 'claim_conflict', 'needs_cache_invalidation', false);
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'already_linked',
      'needs_cache_invalidation', v_claim.cache_invalidation_pending,
      'event_key', v_event_key,
      'reply_tweet_id', p_tweet_id,
      'recovery_observed_at', v_observation.observed_at,
      'reset_event_key', v_estimate.reset_event_key
    );
  end if;

  if v_already_linked or v_estimate.tibo_announced_at is not null or
     v_estimate.tibo_primary_tweet_id is not null or
     coalesce(v_estimate.tibo_source_tweet_ids, '{}'::text[]) <> '{}'::text[] or
     v_estimate.official_notice_tweet_id is not null or v_estimate.official_notice_at is not null then
    return pg_catalog.jsonb_build_object('status', 'estimate_not_monitor_only', 'needs_cache_invalidation', false);
  end if;

  update public.reset_execution_estimates
     set tibo_announced_at = v_signal.tweet_created_at,
         tibo_primary_tweet_id = p_tweet_id,
         tibo_source_tweet_ids = array[p_tweet_id]::text[],
         official_notice_tweet_id = p_tweet_id,
         official_notice_at = v_signal.tweet_created_at,
         updated_at = pg_catalog.now()
   where id = v_estimate.id;

  insert into public.codex_usage_future_reply_claims (
    event_key,
    reply_tweet_id,
    source_key,
    recovery_observed_at,
    reset_event_key,
    cache_invalidation_pending
  ) values (
    v_event_key,
    p_tweet_id,
    'local-codex-app-server',
    v_observation.observed_at,
    v_estimate.reset_event_key,
    true
  );

  return pg_catalog.jsonb_build_object(
    'status', 'linked',
    'needs_cache_invalidation', true,
    'event_key', v_event_key,
    'reply_tweet_id', p_tweet_id,
    'recovery_observed_at', v_observation.observed_at,
    'reset_event_key', v_estimate.reset_event_key
  );
end;
$function$;

revoke all on function public.reconcile_codex_future_reply_notice(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_codex_future_reply_notice(text, jsonb)
  to service_role;

create or replace function public.ack_codex_future_reply_cache_invalidation(
  p_event_key text,
  p_reply_tweet_id text,
  p_recovery_observed_at timestamptz,
  p_reset_event_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_claim public.codex_usage_future_reply_claims%rowtype;
begin
  if p_event_key is null or p_event_key !~ '^[0-9]{15,30}$' or
     p_reply_tweet_id is null or p_reply_tweet_id !~ '^[0-9]{15,30}$' or
     p_recovery_observed_at is null or p_reset_event_key is null then
    return pg_catalog.jsonb_build_object('status', 'mismatch');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('codex-usage-future-reply:' || p_event_key)
  );
  select * into v_claim
    from public.codex_usage_future_reply_claims
   where event_key = p_event_key
   for update;
  if not found or
     v_claim.reply_tweet_id is distinct from p_reply_tweet_id or
     v_claim.source_key is distinct from 'local-codex-app-server' or
     v_claim.recovery_observed_at is distinct from p_recovery_observed_at or
     v_claim.reset_event_key is distinct from p_reset_event_key then
    return pg_catalog.jsonb_build_object('status', 'mismatch');
  end if;

  if not v_claim.cache_invalidation_pending then
    return pg_catalog.jsonb_build_object('status', 'already_acknowledged');
  end if;

  update public.codex_usage_future_reply_claims
     set cache_invalidation_pending = false
   where event_key = p_event_key;
  return pg_catalog.jsonb_build_object('status', 'acknowledged');
end;
$function$;

revoke all on function public.ack_codex_future_reply_cache_invalidation(text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.ack_codex_future_reply_cache_invalidation(text, text, timestamptz, text)
  to service_role;
