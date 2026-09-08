create table if not exists public.reset_display_name_candidates (
  candidate_id uuid primary key default gen_random_uuid(),
  notice_dedupe_key text not null unique,
  official_notice_tweet_id text not null,
  logical_post_id text,
  notice_tweet_ids text[] not null default '{}'::text[],
  source_tweet_ids text[] not null default '{}'::text[],
  source_snapshot_hash text,
  input_hash text,
  next_retry_at timestamptz,
  ai_name_ja text,
  ai_name_en text,
  ai_name_zh text,
  ai_confidence double precision,
  ai_evidence text,
  ai_reason text,
  ai_flags text[] not null default '{}'::text[],
  ai_model text,
  ai_prompt_version text,
  ai_input_mode text,
  ai_status text not null default 'unprocessed',
  lifecycle_status text not null default 'provisional',
  generation_attempts integer not null default 0,
  last_generated_at timestamptz,
  promoted_event_key text,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reset_display_name_candidates_ai_status_check
    check (ai_status in (
      'unprocessed', 'pending', 'accepted', 'null', 'review_required',
      'api_error', 'rate_limited', 'invalid_response'
    )),
  constraint reset_display_name_candidates_lifecycle_status_check
    check (lifecycle_status in ('provisional', 'promoted', 'superseded', 'expired')),
  constraint reset_display_name_candidates_ai_input_mode_check
    check (ai_input_mode is null or ai_input_mode = 'notice-precompute-v1'),
  constraint reset_display_name_candidates_ai_confidence_check
    check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  constraint reset_display_name_candidates_generation_attempts_check
    check (generation_attempts >= 0)
);

create unique index if not exists reset_display_name_candidates_official_notice_tweet_id_uidx
  on public.reset_display_name_candidates (official_notice_tweet_id)
  where official_notice_tweet_id is not null;

create unique index if not exists reset_display_name_candidates_logical_post_id_uidx
  on public.reset_display_name_candidates (logical_post_id)
  where logical_post_id is not null;

alter table public.reset_display_name_candidates enable row level security;

revoke all on table public.reset_display_name_candidates from public, anon, authenticated;
grant select, insert, update on table public.reset_display_name_candidates to service_role;

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
  if v_official_notice_tweet_id is null then
    raise exception using errcode = '22023', message = 'Candidate seed requires an official notice tweet ID';
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
      logical_post_id,
      notice_tweet_ids,
      source_tweet_ids,
      ai_status,
      lifecycle_status
    ) values (
      v_notice_dedupe_key,
      v_official_notice_tweet_id,
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

    update public.reset_display_name_candidates
       set notice_dedupe_key = v_notice_dedupe_key,
           official_notice_tweet_id = v_candidate.official_notice_tweet_id,
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
