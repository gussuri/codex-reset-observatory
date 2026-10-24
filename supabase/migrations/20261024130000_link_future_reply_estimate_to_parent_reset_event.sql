begin;

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
  v_canonical_reset_event_key text;
  v_needs_cache_invalidation boolean := false;
  v_candidate record;
  v_candidate_count integer := 0;
  v_candidate_observation_id uuid;
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
  v_canonical_reset_event_key := 'tibo-reset-' || v_event_key;

  -- Forward and reverse writes serialize on the source parent before taking
  -- monitor, observation, estimate, or claim row locks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('codex-usage-future-reply:' || v_event_key)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('codex-usage-webhook:local-codex-app-server')
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
     not pg_catalog.isfinite(v_signal.tweet_created_at) or
     not pg_catalog.isfinite(v_signal.expected_start_at) or
     not pg_catalog.isfinite(v_signal.expected_end_at) or
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

  -- Count authoritative observations across the entire reply window before
  -- inspecting estimates. An assigned or missing estimate still makes the
  -- evidence ambiguous, matching the monitor's read-side candidate gate.
  for v_candidate in
    select o.id as observation_id
      from public.codex_recovery_observations as o
     where o.source_key = 'local-codex-app-server'
       and o.status in ('observed', 'confirmed')
       and o.confidence = 'strong'
       and o.cycle_hint = 'unexpected'
       and o.id <> '512a8b31-e43e-4f91-b5e6-7023b87e80ec'::uuid
       and o.previous_observed_at is not null
       and pg_catalog.isfinite(o.previous_observed_at)
       and pg_catalog.isfinite(o.observed_at)
       and o.previous_observed_at < o.observed_at
       and o.observed_at - o.previous_observed_at <= interval '10 minutes'
       and o.previous_used_percent::text not in ('NaN', 'Infinity', '-Infinity')
       and o.current_used_percent::text not in ('NaN', 'Infinity', '-Infinity')
       and o.previous_used_percent between 0 and 100
       and o.current_used_percent between 0 and 100
       and o.previous_used_percent - o.current_used_percent >= 1
       and o.previous_resets_at > 0
       and o.current_resets_at > 0
       and o.current_resets_at - o.previous_resets_at >= 3600
       and v_signal.tweet_created_at <= o.previous_observed_at
       and v_signal.expected_start_at < o.observed_at
       and v_signal.expected_end_at > o.previous_observed_at
     order by o.observed_at, o.id
     limit 51
  loop
    v_candidate_count := v_candidate_count + 1;
    if v_candidate_count = 1 then
      v_candidate_observation_id := v_candidate.observation_id;
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
   where recovery_observation_id = v_observation.id
   for update;
  if not found or
     v_observation.source_key is distinct from 'local-codex-app-server' or
     v_observation.status not in ('observed', 'confirmed') or
     v_observation.confidence is distinct from 'strong' or
     v_observation.cycle_hint is distinct from 'unexpected' or
     v_observation.id = '512a8b31-e43e-4f91-b5e6-7023b87e80ec'::uuid or
     (v_observation.matched_tibo_tweet_id is not null and
      v_observation.matched_tibo_tweet_id is distinct from p_tweet_id) or
     v_observation.previous_observed_at is null or
     not pg_catalog.isfinite(v_observation.previous_observed_at) or
     not pg_catalog.isfinite(v_observation.observed_at) or
     v_observation.previous_observed_at >= v_observation.observed_at or
     v_observation.observed_at - v_observation.previous_observed_at > interval '10 minutes' or
     v_observation.previous_used_percent::text in ('NaN', 'Infinity', '-Infinity') or
     v_observation.current_used_percent::text in ('NaN', 'Infinity', '-Infinity') or
     v_observation.previous_used_percent < 0 or v_observation.previous_used_percent > 100 or
     v_observation.current_used_percent < 0 or v_observation.current_used_percent > 100 or
     v_observation.previous_used_percent - v_observation.current_used_percent < 1 or
     v_observation.previous_resets_at <= 0 or v_observation.current_resets_at <= 0 or
     v_observation.current_resets_at - v_observation.previous_resets_at < 3600 or
     v_estimate.estimator_version is distinct from 'usage-execution-monitor-v1' or
     v_estimate.execution_time_source is distinct from 'usage_observation' or
     v_estimate.execution_time_confidence is distinct from 'high' or
     v_estimate.execution_time_precision is distinct from 'approximate' or
     v_estimate.reset_event_key = 'usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec' or
     v_estimate.recovery_previous_observed_at is distinct from v_observation.previous_observed_at or
     v_estimate.recovery_observed_at is distinct from v_observation.observed_at or
     v_estimate.execution_window_start_at is null or v_estimate.execution_window_end_at is null or
     not pg_catalog.isfinite(v_estimate.execution_window_start_at) or
     not pg_catalog.isfinite(v_estimate.execution_window_end_at) or
     not pg_catalog.isfinite(v_estimate.display_execution_at) or
     v_estimate.execution_window_start_at >= v_estimate.execution_window_end_at or
     v_estimate.execution_window_start_at is distinct from v_observation.previous_observed_at or
     v_estimate.execution_window_end_at is distinct from v_observation.observed_at or
     v_estimate.display_execution_at is distinct from v_observation.observed_at or
     v_signal.tweet_created_at > v_observation.previous_observed_at or
     v_signal.expected_start_at >= v_observation.observed_at or
     v_signal.expected_end_at <= v_observation.previous_observed_at or
     v_estimate.manual_override_at is not null or v_estimate.manual_override_by is not null or
     v_estimate.manual_override_reason is not null or v_estimate.manual_execution_at is not null or
     v_estimate.manual_execution_precision is not null or
     not (
       (
         v_estimate.tibo_announced_at is null and
         v_estimate.tibo_primary_tweet_id is null and
         coalesce(v_estimate.tibo_source_tweet_ids, '{}'::text[]) = '{}'::text[] and
         v_estimate.official_notice_tweet_id is null and v_estimate.official_notice_at is null
       ) or (
         v_estimate.tibo_announced_at = v_signal.tweet_created_at and
         v_estimate.tibo_primary_tweet_id = p_tweet_id and
         v_estimate.tibo_source_tweet_ids = array[p_tweet_id]::text[] and
         v_estimate.official_notice_tweet_id = p_tweet_id and
         v_estimate.official_notice_at = v_signal.tweet_created_at
       )
     ) then
    return pg_catalog.jsonb_build_object('status', 'no_candidate', 'needs_cache_invalidation', false);
  end if;

  if exists (
    select 1
      from public.reset_execution_estimates
     where reset_event_key = v_canonical_reset_event_key
       and id <> v_estimate.id
  ) then
    return pg_catalog.jsonb_build_object('status', 'event_key_conflict', 'needs_cache_invalidation', false);
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
    if v_estimate.reset_event_key is distinct from v_canonical_reset_event_key then
      update public.reset_execution_estimates
         set reset_event_key = v_canonical_reset_event_key,
             updated_at = pg_catalog.now()
       where id = v_estimate.id;
      update public.codex_usage_future_reply_claims
         set reset_event_key = v_canonical_reset_event_key,
             cache_invalidation_pending = true
       where event_key = v_event_key;
      v_needs_cache_invalidation := true;
    else
      v_needs_cache_invalidation := v_claim.cache_invalidation_pending;
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'already_linked',
      'needs_cache_invalidation', v_needs_cache_invalidation,
      'event_key', v_event_key,
      'reply_tweet_id', p_tweet_id,
      'recovery_observed_at', v_observation.observed_at,
      'reset_event_key', v_canonical_reset_event_key
    );
  end if;

  if v_already_linked or v_estimate.tibo_announced_at is not null or
     v_estimate.tibo_primary_tweet_id is not null or
     coalesce(v_estimate.tibo_source_tweet_ids, '{}'::text[]) <> '{}'::text[] or
     v_estimate.official_notice_tweet_id is not null or v_estimate.official_notice_at is not null then
    return pg_catalog.jsonb_build_object('status', 'estimate_not_monitor_only', 'needs_cache_invalidation', false);
  end if;

  update public.reset_execution_estimates
     set reset_event_key = v_canonical_reset_event_key,
         tibo_announced_at = v_signal.tweet_created_at,
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
    v_canonical_reset_event_key,
    true
  );

  return pg_catalog.jsonb_build_object(
    'status', 'linked',
    'needs_cache_invalidation', true,
    'event_key', v_event_key,
    'reply_tweet_id', p_tweet_id,
    'recovery_observed_at', v_observation.observed_at,
    'reset_event_key', v_canonical_reset_event_key
  );
end;
$function$;

revoke all on function public.reconcile_codex_future_reply_notice(text, jsonb) from public, anon, authenticated;

grant execute on function public.reconcile_codex_future_reply_notice(text, jsonb) to service_role;

commit;
