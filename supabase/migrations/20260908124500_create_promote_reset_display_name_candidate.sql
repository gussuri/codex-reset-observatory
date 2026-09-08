create or replace function public.promote_reset_display_name_candidate(
  p_candidate_id uuid,
  p_canonical_event_key text,
  p_source_tweet_id text,
  p_promoted_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_candidate public.reset_display_name_candidates%rowtype;
  v_existing_name public.reset_display_names%rowtype;
  v_has_authoritative_evidence boolean := false;
  v_has_protected_name boolean := false;
  v_canonical_written boolean := false;
begin
  if p_candidate_id is null or
     nullif(pg_catalog.btrim(p_canonical_event_key), '') is null or
     p_promoted_at is null then
    raise exception using errcode = '22023', message = 'Invalid reset display name candidate promotion';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('reset-display-name-candidate-promotion:' || p_canonical_event_key)
  );

  select * into v_candidate
    from public.reset_display_name_candidates
   where candidate_id = p_candidate_id
   for update;
  if not found then
    return jsonb_build_object(
      'status', 'missing',
      'canonicalWrite', false,
      'canonicalEventKey', null
    );
  end if;

  if v_candidate.promoted_event_key is not null then
    if v_candidate.promoted_event_key <> p_canonical_event_key then
      return jsonb_build_object(
        'status', 'conflict',
        'canonicalWrite', false,
        'canonicalEventKey', v_candidate.promoted_event_key
      );
    end if;
  end if;

  select exists (
    select 1
      from public.tibo_formal_adoptions
     where reset_event_key = p_canonical_event_key
  ) or exists (
    select 1
      from public.reset_execution_estimates
     where reset_event_key = p_canonical_event_key
       and execution_time_source = 'usage_observation'
       and estimator_version = 'usage-execution-monitor-v1'
       and recovery_observation_id is not null
  ) into v_has_authoritative_evidence;

  if not v_has_authoritative_evidence then
    return jsonb_build_object(
      'status', 'not_authoritative',
      'canonicalWrite', false,
      'canonicalEventKey', null
    );
  end if;

  if v_candidate.promoted_event_key = p_canonical_event_key then
    return jsonb_build_object(
      'status', 'already_promoted',
      'canonicalWrite', false,
      'canonicalEventKey', p_canonical_event_key
    );
  end if;

  if v_candidate.lifecycle_status <> 'provisional' or
     v_candidate.ai_status <> 'accepted' or
     v_candidate.ai_input_mode <> 'notice-precompute-v1' or
     v_candidate.ai_prompt_version <> 'random-reset-name-v3' or
     nullif(pg_catalog.btrim(v_candidate.ai_name_ja), '') is null or
     nullif(pg_catalog.btrim(v_candidate.ai_name_en), '') is null or
     nullif(pg_catalog.btrim(v_candidate.ai_name_zh), '') is null or
     coalesce(pg_catalog.cardinality(v_candidate.ai_flags), 0) <> 0 then
    return jsonb_build_object(
      'status', 'not_accepted',
      'canonicalWrite', false,
      'canonicalEventKey', null
    );
  end if;

  select * into v_existing_name
    from public.reset_display_names
   where event_key = p_canonical_event_key
   for update;

  if found then
    v_has_protected_name :=
      nullif(pg_catalog.btrim(v_existing_name.manual_name_ja), '') is not null or
      nullif(pg_catalog.btrim(v_existing_name.manual_name_en), '') is not null or
      nullif(pg_catalog.btrim(v_existing_name.manual_name_zh), '') is not null or
      v_existing_name.ai_status = 'accepted';

    if not v_has_protected_name then
      update public.reset_display_names
         set source_tweet_id = coalesce(v_existing_name.source_tweet_id, p_source_tweet_id),
             ai_name_ja = coalesce(v_existing_name.ai_name_ja, v_candidate.ai_name_ja),
             ai_name_en = coalesce(v_existing_name.ai_name_en, v_candidate.ai_name_en),
             ai_name_zh = coalesce(v_existing_name.ai_name_zh, v_candidate.ai_name_zh),
             ai_confidence = v_candidate.ai_confidence,
             ai_evidence = v_candidate.ai_evidence,
             ai_reason = v_candidate.ai_reason,
             ai_model = v_candidate.ai_model,
             ai_prompt_version = v_candidate.ai_prompt_version,
             ai_input_mode = v_candidate.ai_input_mode,
             ai_status = 'accepted',
             ai_flags = v_candidate.ai_flags,
             ai_generated_at = v_candidate.last_generated_at,
             input_hash = v_candidate.input_hash,
             updated_at = p_promoted_at
       where event_key = p_canonical_event_key;
      v_canonical_written := true;
    end if;
  else
    insert into public.reset_display_names (
      event_key,
      source_tweet_id,
      manual_name_ja,
      manual_name_en,
      manual_name_zh,
      ai_name_ja,
      ai_name_en,
      ai_name_zh,
      ai_confidence,
      ai_evidence,
      ai_reason,
      ai_model,
      ai_prompt_version,
      ai_input_mode,
      ai_status,
      ai_flags,
      ai_generated_at,
      input_hash,
      updated_at
    ) values (
      p_canonical_event_key,
      p_source_tweet_id,
      null,
      null,
      null,
      v_candidate.ai_name_ja,
      v_candidate.ai_name_en,
      v_candidate.ai_name_zh,
      v_candidate.ai_confidence,
      v_candidate.ai_evidence,
      v_candidate.ai_reason,
      v_candidate.ai_model,
      v_candidate.ai_prompt_version,
      v_candidate.ai_input_mode,
      'accepted',
      v_candidate.ai_flags,
      v_candidate.last_generated_at,
      v_candidate.input_hash,
      p_promoted_at
    );
    v_canonical_written := true;
  end if;

  update public.reset_display_name_candidates
     set lifecycle_status = 'promoted',
         promoted_event_key = p_canonical_event_key,
         promoted_at = p_promoted_at,
         updated_at = p_promoted_at
   where candidate_id = p_candidate_id;

  return jsonb_build_object(
    'status', case when v_canonical_written then 'promoted' else 'reused' end,
    'canonicalWrite', v_canonical_written,
    'canonicalEventKey', p_canonical_event_key
  );
end;
$function$;

revoke all on function public.promote_reset_display_name_candidate(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.promote_reset_display_name_candidate(uuid, text, text, timestamptz)
  to service_role;
