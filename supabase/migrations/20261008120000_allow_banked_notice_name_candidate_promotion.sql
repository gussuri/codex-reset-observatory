alter table public.reset_display_name_candidates
  add column if not exists candidate_event_kind text not null default 'reset_execution';

do $constraint$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'reset_display_name_candidates_event_kind_check'
       and conrelid = 'public.reset_display_name_candidates'::regclass
  ) then
    alter table public.reset_display_name_candidates
      add constraint reset_display_name_candidates_event_kind_check
      check (candidate_event_kind in ('reset_execution', 'banked_distribution'));
  end if;
end;
$constraint$;

create or replace function public.upsert_reset_display_name_candidate_seed(p_seed jsonb)
returns public.reset_display_name_candidates
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_notice_dedupe_key text;
  v_official_notice_tweet_id text;
  v_logical_post_id text;
  v_candidate_event_kind text;
  v_kind_changed boolean := false;
  v_notice_tweet_ids text[];
  v_source_tweet_ids text[];
  v_effective_logical_post_id text;
  v_alias_candidate_count integer;
  v_candidate public.reset_display_name_candidates%rowtype;
  v_by_official public.reset_display_name_candidates%rowtype;
  v_by_alias public.reset_display_name_candidates%rowtype;
  v_by_logical public.reset_display_name_candidates%rowtype;
begin
  if p_seed is null or jsonb_typeof(p_seed) <> 'object' then
    raise exception using errcode = '22023', message = 'Candidate seed must be a JSON object';
  end if;

  v_official_notice_tweet_id := nullif(pg_catalog.btrim(p_seed ->> 'official_notice_tweet_id'), '');
  v_logical_post_id := nullif(pg_catalog.btrim(p_seed ->> 'logical_post_id'), '');
  v_candidate_event_kind := coalesce(
    nullif(pg_catalog.btrim(p_seed ->> 'candidate_event_kind'), ''),
    'reset_execution'
  );
  if v_official_notice_tweet_id is null then
    raise exception using errcode = '22023', message = 'Candidate seed requires an official notice tweet ID';
  end if;
  if v_candidate_event_kind not in ('reset_execution', 'banked_distribution') then
    raise exception using errcode = '22023', message = 'Candidate seed has an invalid event kind';
  end if;

  v_notice_tweet_ids := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_seed -> 'notice_tweet_ids', '[]'::jsonb))),
    '{}'::text[]
  );
  v_source_tweet_ids := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_seed -> 'source_tweet_ids', '[]'::jsonb))),
    '{}'::text[]
  );

  v_notice_dedupe_key := coalesce(
    case when v_logical_post_id is not null then 'logical-post:' || v_logical_post_id end,
    'official-notice:' || v_official_notice_tweet_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('reset-display-name-candidate-seed')
  );

  select * into v_by_official
    from public.reset_display_name_candidates
   where official_notice_tweet_id = v_official_notice_tweet_id
   for update;

  select count(*) into v_alias_candidate_count
    from public.reset_display_name_candidates
   where v_official_notice_tweet_id = any(notice_tweet_ids)
      or notice_tweet_ids && v_notice_tweet_ids;

  if v_alias_candidate_count > 1 then
    raise exception using errcode = '21000', message = 'Candidate seed identity conflict';
  elsif v_alias_candidate_count = 1 then
    select * into v_by_alias
      from public.reset_display_name_candidates
     where v_official_notice_tweet_id = any(notice_tweet_ids)
        or notice_tweet_ids && v_notice_tweet_ids
     for update;
  end if;

  if v_logical_post_id is not null then
    select * into v_by_logical
      from public.reset_display_name_candidates
     where logical_post_id = v_logical_post_id
     for update;
  end if;

  if v_by_official.candidate_id is not null
     and v_by_alias.candidate_id is not null
     and v_by_official.candidate_id <> v_by_alias.candidate_id then
    raise exception using errcode = '21000', message = 'Candidate seed identity conflict';
  end if;

  if v_by_alias.candidate_id is not null
     and v_by_logical.candidate_id is not null
     and v_by_alias.candidate_id <> v_by_logical.candidate_id then
    raise exception using errcode = '21000', message = 'Candidate seed identity conflict';
  end if;

  if v_by_official.candidate_id is not null
     and v_by_logical.candidate_id is not null
     and v_by_official.candidate_id <> v_by_logical.candidate_id then
    raise exception using errcode = '21000', message = 'Candidate seed identity conflict';
  end if;

  if v_by_official.candidate_id is not null then
    v_candidate := v_by_official;
  elsif v_by_alias.candidate_id is not null then
    v_candidate := v_by_alias;
  elsif v_by_logical.candidate_id is not null then
    v_candidate := v_by_logical;
  else
    select * into v_candidate
      from public.reset_display_name_candidates
     where notice_dedupe_key = v_notice_dedupe_key
     for update;
  end if;

  if v_candidate.candidate_id is null then
    insert into public.reset_display_name_candidates (
      notice_dedupe_key,
      official_notice_tweet_id,
      candidate_event_kind,
      logical_post_id,
      notice_tweet_ids,
      source_tweet_ids,
      ai_status,
      lifecycle_status
    ) values (
      v_notice_dedupe_key,
      v_official_notice_tweet_id,
      v_candidate_event_kind,
      v_logical_post_id,
      v_notice_tweet_ids,
      v_source_tweet_ids,
      'unprocessed',
      'provisional'
    ) returning * into v_candidate;
  else
    if v_candidate.logical_post_id is not null
       and v_logical_post_id is not null
       and v_candidate.logical_post_id <> v_logical_post_id then
      raise exception using errcode = '21000', message = 'Candidate seed identity conflict';
    end if;

    v_effective_logical_post_id := coalesce(v_candidate.logical_post_id, v_logical_post_id);
    v_notice_dedupe_key := coalesce(
      case when v_effective_logical_post_id is not null then 'logical-post:' || v_effective_logical_post_id end,
      'official-notice:' || v_official_notice_tweet_id
    );

    v_kind_changed :=
      v_candidate.lifecycle_status = 'provisional'
      and v_candidate.candidate_event_kind is distinct from v_candidate_event_kind;

    update public.reset_display_name_candidates
       set notice_dedupe_key = v_notice_dedupe_key,
           official_notice_tweet_id = v_candidate.official_notice_tweet_id,
           candidate_event_kind = case
             when v_candidate.lifecycle_status = 'provisional' then v_candidate_event_kind
             else v_candidate.candidate_event_kind
           end,
           source_snapshot_hash = case when v_kind_changed then null else v_candidate.source_snapshot_hash end,
           input_hash = case when v_kind_changed then null else v_candidate.input_hash end,
           next_retry_at = case when v_kind_changed then null else v_candidate.next_retry_at end,
           ai_name_ja = case when v_kind_changed then null else v_candidate.ai_name_ja end,
           ai_name_en = case when v_kind_changed then null else v_candidate.ai_name_en end,
           ai_name_zh = case when v_kind_changed then null else v_candidate.ai_name_zh end,
           ai_confidence = case when v_kind_changed then null else v_candidate.ai_confidence end,
           ai_evidence = case when v_kind_changed then null else v_candidate.ai_evidence end,
           ai_reason = case when v_kind_changed then null else v_candidate.ai_reason end,
           ai_flags = case when v_kind_changed then '{}'::text[] else v_candidate.ai_flags end,
           ai_model = case when v_kind_changed then null else v_candidate.ai_model end,
           ai_prompt_version = case when v_kind_changed then null else v_candidate.ai_prompt_version end,
           ai_input_mode = case when v_kind_changed then null else v_candidate.ai_input_mode end,
           ai_status = case when v_kind_changed then 'unprocessed' else v_candidate.ai_status end,
           generation_attempts = case when v_kind_changed then 0 else v_candidate.generation_attempts end,
           last_generated_at = case when v_kind_changed then null else v_candidate.last_generated_at end,
           logical_post_id = v_effective_logical_post_id,
           notice_tweet_ids = (
             select coalesce(array_agg(distinct item order by item), '{}'::text[])
               from unnest(v_candidate.notice_tweet_ids || v_notice_tweet_ids) as values(item)
           ),
           source_tweet_ids = (
             select coalesce(array_agg(distinct item order by item), '{}'::text[])
               from unnest(v_candidate.source_tweet_ids || v_source_tweet_ids) as values(item)
           ),
           updated_at = now()
     where candidate_id = v_candidate.candidate_id
     returning * into v_candidate;
  end if;

  return v_candidate;
end;
$function$;

revoke all on function public.upsert_reset_display_name_candidate_seed(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_reset_display_name_candidate_seed(jsonb)
  to service_role;

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

  if v_candidate.promoted_event_key is not null and
     v_candidate.promoted_event_key <> p_canonical_event_key then
    return jsonb_build_object(
      'status', 'conflict',
      'canonicalWrite', false,
      'canonicalEventKey', v_candidate.promoted_event_key
    );
  end if;

  if v_candidate.candidate_event_kind = 'banked_distribution' then
    select exists (
      select 1
        from public.reset_execution_estimates e
       where e.reset_event_key = p_canonical_event_key
         and e.estimator_version = 'banked-distribution-observation-v2'
         and e.execution_time_source = 'usage_observation'
         and e.execution_time_confidence = 'high'
         and e.execution_time_precision = 'approximate'
         and e.recovery_observation_id is null
         and e.execution_window_start_at is null
         and e.execution_window_end_at is null
         and e.display_execution_at is not null
         and e.official_notice_at is not null
         and e.display_execution_at >= e.official_notice_at
         and e.official_notice_tweet_id = v_candidate.official_notice_tweet_id
         and e.official_notice_tweet_id = any(v_candidate.notice_tweet_ids)
         and e.official_notice_tweet_id = any(e.tibo_source_tweet_ids)
    ) into v_has_authoritative_evidence;
  else
    select exists (
      select 1
        from public.tibo_formal_adoptions
       where reset_event_key = p_canonical_event_key
    ) or exists (
      select 1
        from public.reset_execution_estimates e
       where e.reset_event_key = p_canonical_event_key
         and e.execution_time_source = 'usage_observation'
         and e.execution_time_confidence = 'high'
         and e.execution_time_precision = 'approximate'
         and e.recovery_observation_id is not null
         and e.estimator_version in (
           'usage-execution-v1',
           'usage-execution-teaser-v1',
           'usage-execution-monitor-v1'
         )
         and e.execution_window_start_at is not null
         and e.execution_window_end_at is not null
         and e.execution_window_start_at < e.execution_window_end_at
         and e.display_execution_at = e.execution_window_end_at
         and (
           (
             e.official_notice_tweet_id is not null
             and e.official_notice_tweet_id = any(v_candidate.notice_tweet_ids)
             and e.official_notice_tweet_id = any(e.tibo_source_tweet_ids)
           )
           or (
             e.official_notice_tweet_id is null
             and (
               (
                 e.estimator_version = 'usage-execution-teaser-v1'
                 and e.tibo_primary_tweet_id is not null
                 and e.tibo_primary_tweet_id = any(e.tibo_source_tweet_ids)
                 and e.tibo_primary_tweet_id = any(v_candidate.source_tweet_ids)
               )
               or (
                 e.estimator_version = 'usage-execution-monitor-v1'
                 and e.tibo_source_tweet_ids && v_candidate.source_tweet_ids
               )
             )
           )
         )
    ) into v_has_authoritative_evidence;
  end if;

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
             ai_name_ja = v_candidate.ai_name_ja,
             ai_name_en = v_candidate.ai_name_en,
             ai_name_zh = v_candidate.ai_name_zh,
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
