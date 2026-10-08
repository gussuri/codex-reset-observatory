create table if not exists public.codex_banked_grant_observations (
  id uuid primary key default gen_random_uuid(),
  observation_key text not null unique,
  reset_event_key text not null unique,
  source_key text not null check (source_key = 'local-codex-app-server'),
  limit_id text not null check (limit_id = 'codex'),
  plan_type text not null check (char_length(plan_type) between 1 and 64),
  previous_observed_at timestamptz not null,
  observed_at timestamptz not null,
  received_at timestamptz not null,
  previous_available_count integer not null check (previous_available_count >= 0),
  current_available_count integer not null,
  observation_window_start_at timestamptz not null,
  observation_window_end_at timestamptz not null,
  execution_time_precision text not null check (execution_time_precision = 'approximate'),
  legacy_identity_status text not null default 'resolved'
    check (legacy_identity_status in ('resolved', 'unresolved', 'legacy_exact')),
  legacy_reset_event_key text,
  association_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint codex_banked_grant_count_increased
    check (current_available_count > previous_available_count),
  constraint codex_banked_grant_window_order
    check (
      observation_window_start_at < observation_window_end_at and
      observation_window_end_at = observed_at and
      previous_observed_at = observation_window_start_at
    ),
  constraint codex_banked_grant_legacy_identity
    check (
      (legacy_identity_status = 'legacy_exact' and legacy_reset_event_key is not null) or
      (legacy_identity_status <> 'legacy_exact' and legacy_reset_event_key is null)
    ),
  constraint codex_banked_grant_source_occurrence
    unique (source_key, limit_id, observed_at)
);

create index if not exists codex_banked_grant_observations_recent_idx
  on public.codex_banked_grant_observations (observed_at desc, id);
create index if not exists codex_banked_grant_observations_reconcile_idx
  on public.codex_banked_grant_observations (association_checked_at, received_at, id);
create unique index if not exists codex_banked_grant_legacy_reset_event_key_unique
  on public.codex_banked_grant_observations (legacy_reset_event_key)
  where legacy_reset_event_key is not null;

alter table public.codex_banked_grant_observations enable row level security;
revoke all privileges on table public.codex_banked_grant_observations from public, anon, authenticated;
grant select, insert, update on table public.codex_banked_grant_observations to service_role;

create table if not exists public.codex_banked_post_association_decisions (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.codex_banked_grant_observations(id) on delete restrict,
  revision integer not null check (revision > 0),
  status text not null check (status in ('accepted', 'pending', 'conflict')),
  reason text not null check (char_length(reason) between 1 and 160),
  matcher_version text not null,
  decision_source text not null check (decision_source in ('automatic', 'manual')),
  publication_status text not null check (publication_status in ('withheld', 'published')),
  notice_tweet_id text,
  logical_post_id text,
  source_tweet_ids text[] not null default '{}',
  eligible_candidate_ids text[] not null default '{}',
  excluded_candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(excluded_candidates) = 'array'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  is_current boolean not null default true,
  decided_at timestamptz not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint codex_banked_association_accepted_claim
    check (status <> 'accepted' or (notice_tweet_id is not null and logical_post_id is not null)),
  constraint codex_banked_association_revision_unique
    unique (observation_id, revision)
);

create unique index if not exists codex_banked_association_current_unique
  on public.codex_banked_post_association_decisions (observation_id)
  where is_current;

create index if not exists codex_banked_association_pending_idx
  on public.codex_banked_post_association_decisions (decided_at, observation_id)
  where is_current and status in ('pending', 'conflict');

alter table public.codex_banked_post_association_decisions enable row level security;
revoke all privileges on table public.codex_banked_post_association_decisions from public, anon, authenticated;
grant select, insert, update on table public.codex_banked_post_association_decisions to service_role;

create or replace function public.read_banked_reset_publication_state(p_reset_event_keys text[])
returns table(reset_event_key text, published boolean)
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  with publication as (
    select observation.reset_event_key,
           observation.legacy_reset_event_key,
           coalesce(
             association.status = 'accepted' and
             association.publication_status = 'published' and
             association.is_current,
             false
           ) as published
      from public.codex_banked_grant_observations observation
      left join public.codex_banked_post_association_decisions association
        on association.observation_id = observation.id
       and association.is_current
  )
  select keys.reset_event_key, bool_and(publication.published)
    from publication
    cross join lateral (values
      (publication.reset_event_key),
      (publication.legacy_reset_event_key)
    ) as keys(reset_event_key)
   where keys.reset_event_key = any(coalesce(p_reset_event_keys, '{}'::text[]))
   group by keys.reset_event_key
$function$;

revoke all on function public.read_banked_reset_publication_state(text[])
  from public, anon, authenticated;
grant execute on function public.read_banked_reset_publication_state(text[])
  to service_role;

create or replace function public.list_banked_grant_observations_for_reconciliation(
  p_now timestamptz default now(),
  p_limit integer default 10
)
returns table (
  observation_key text,
  reset_event_key text,
  source_key text,
  limit_id text,
  plan_type text,
  previous_observed_at timestamptz,
  observed_at timestamptz,
  received_at timestamptz,
  previous_available_count integer,
  current_available_count integer,
  observation_window_start_at timestamptz,
  observation_window_end_at timestamptz,
  execution_time_precision text,
  legacy_identity_status text,
  legacy_reset_event_key text,
  current_revision integer,
  current_decision_source text,
  current_notice_tweet_id text,
  current_logical_post_id text,
  current_eligible_candidate_ids text[],
  has_more boolean
)
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  with due as (
    select observation.*,
           coalesce(association.revision, 0) as current_revision,
           association.decision_source as current_decision_source,
           association.notice_tweet_id as current_notice_tweet_id,
           association.logical_post_id as current_logical_post_id,
           association.eligible_candidate_ids as current_eligible_candidate_ids,
           count(*) over () as total_due
      from public.codex_banked_grant_observations observation
      left join public.codex_banked_post_association_decisions association
        on association.observation_id = observation.id and association.is_current
     where coalesce(association.decision_source, 'automatic') <> 'manual'
       and (
         (association.id is null or association.status in ('pending', 'conflict')) and
         (observation.association_checked_at is null or
          observation.association_checked_at <= p_now - interval '15 minutes')
         or
         association.status = 'accepted' and
         (observation.association_checked_at is null or
          observation.association_checked_at <= p_now - interval '6 hours')
       )
  ), limited as (
    select *
      from due
     order by coalesce(association_checked_at, '-infinity'::timestamptz), received_at, id
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
  )
  select limited.observation_key,
         limited.reset_event_key,
         limited.source_key,
         limited.limit_id,
         limited.plan_type,
         limited.previous_observed_at,
         limited.observed_at,
         limited.received_at,
         limited.previous_available_count,
         limited.current_available_count,
         limited.observation_window_start_at,
         limited.observation_window_end_at,
         limited.execution_time_precision,
         limited.legacy_identity_status,
         limited.legacy_reset_event_key,
         limited.current_revision,
         limited.current_decision_source,
         limited.current_notice_tweet_id,
         limited.current_logical_post_id,
         coalesce(limited.current_eligible_candidate_ids, '{}'::text[]),
         limited.total_due > least(greatest(coalesce(p_limit, 10), 1), 50) as has_more
    from limited
   order by coalesce(limited.association_checked_at, '-infinity'::timestamptz), limited.received_at, limited.id
$function$;

revoke all on function public.list_banked_grant_observations_for_reconciliation(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_banked_grant_observations_for_reconciliation(timestamptz, integer)
  to service_role;

create or replace function public.prevent_reset_estimate_kind_conversion()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_old_banked boolean;
  v_new_banked boolean;
begin
  v_new_banked := new.estimator_version in ('banked-distribution-observation-v2', 'usage-execution-banked-v1');
  if tg_op = 'UPDATE' then
    v_old_banked := old.estimator_version in ('banked-distribution-observation-v2', 'usage-execution-banked-v1');
    if v_old_banked is distinct from v_new_banked then
      raise exception using errcode = '23514', message = 'Reset estimate kind conversion is not allowed';
    end if;
  end if;
  if v_new_banked and new.recovery_observation_id is not null then
    raise exception using errcode = '23514', message = 'BANKED estimate cannot own a recovery observation';
  end if;
  return new;
end;
$function$;

drop trigger if exists reset_execution_estimates_kind_guard on public.reset_execution_estimates;
create trigger reset_execution_estimates_kind_guard
before update of estimator_version, recovery_observation_id on public.reset_execution_estimates
for each row execute function public.prevent_reset_estimate_kind_conversion();
drop trigger if exists reset_execution_estimates_banked_recovery_insert_guard on public.reset_execution_estimates;
create trigger reset_execution_estimates_banked_recovery_insert_guard
before insert on public.reset_execution_estimates
for each row execute function public.prevent_reset_estimate_kind_conversion();

drop function if exists public.record_banked_grant_association_decision(text, jsonb, jsonb);

create or replace function public.record_banked_grant_association_decision(
  p_observation_key text,
  p_decision jsonb,
  p_estimate jsonb,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_observation public.codex_banked_grant_observations%rowtype;
  v_current public.codex_banked_post_association_decisions%rowtype;
  v_current_found boolean := false;
  v_revision integer;
  v_actual_revision integer := 0;
  v_status text;
  v_reason text;
  v_decision_source text := 'automatic';
  v_make_current boolean := true;
  v_notice_tweet_id text;
  v_logical_post_id text;
  v_source_ids text[];
  v_candidate_ids text[];
  v_excluded jsonb;
  v_evidence jsonb;
  v_decided_at timestamptz;
  v_estimate_to_write jsonb := p_estimate;
  v_estimate_key text;
  v_estimate_version text;
  v_existing_estimate public.reset_execution_estimates%rowtype;
  v_existing_estimate_found boolean := false;
  v_published boolean := false;
  v_publication_was boolean := false;
  v_publication_changed boolean := false;
  v_legacy_identity_status text;
  v_legacy_reset_event_key text;
  v_canonical_reset_event_key text;
  v_expected_publication_status text;
begin
  if p_observation_key is null or jsonb_typeof(p_decision) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid BANKED association decision';
  end if;

  select * into v_observation
    from public.codex_banked_grant_observations
   where observation_key = p_observation_key
   for update;
  if not found then
    raise exception using errcode = '23503', message = 'BANKED observation does not exist';
  end if;

  v_status := p_decision ->> 'status';
  v_reason := nullif(p_decision ->> 'reason', '');
  v_notice_tweet_id := nullif(p_decision ->> 'notice_tweet_id', '');
  v_logical_post_id := nullif(p_decision ->> 'logical_post_id', '');
  v_source_ids := array(
    select distinct source_id
      from jsonb_array_elements_text(coalesce(p_decision -> 'source_tweet_ids', '[]'::jsonb)) as ids(source_id)
     where source_id <> ''
     order by source_id
  );
  v_candidate_ids := array(
    select distinct candidate_id
      from jsonb_array_elements_text(coalesce(p_decision -> 'eligible_candidate_ids', '[]'::jsonb)) as ids(candidate_id)
     where candidate_id <> ''
     order by candidate_id
  );
  v_excluded := coalesce(p_decision -> 'excluded_candidates', '[]'::jsonb);
  v_legacy_identity_status := coalesce(
    nullif(p_decision ->> 'legacy_identity_status', ''),
    v_observation.legacy_identity_status
  );
  v_legacy_reset_event_key := nullif(p_decision ->> 'legacy_reset_event_key', '');
  v_canonical_reset_event_key := nullif(p_estimate ->> 'reset_event_key', '');
  v_evidence := jsonb_build_object(
    'observation_key', v_observation.observation_key,
    'observed_at', v_observation.observed_at,
    'previous_observed_at', v_observation.previous_observed_at,
    'previous_available_count', v_observation.previous_available_count,
    'current_available_count', v_observation.current_available_count,
    'matcher_reason', v_reason,
    'legacy_identity_status', v_legacy_identity_status,
    'legacy_reset_event_key', v_legacy_reset_event_key,
    'canonical_reset_event_key', v_canonical_reset_event_key
  );
  v_decided_at := coalesce(nullif(p_decision ->> 'decided_at', '')::timestamptz, now());

  if v_status not in ('accepted', 'pending', 'conflict') or v_reason is null or
     nullif(p_decision ->> 'matcher_version', '') is null or
     jsonb_typeof(coalesce(p_decision -> 'excluded_candidates', '[]'::jsonb)) <> 'array' or
     v_legacy_identity_status not in ('resolved', 'unresolved', 'legacy_exact') or
     ((v_legacy_identity_status = 'legacy_exact') is distinct from (v_legacy_reset_event_key is not null)) then
    raise exception using errcode = '22023', message = 'Invalid BANKED association decision fields';
  end if;
  if v_status = 'accepted' and (v_notice_tweet_id is null or v_logical_post_id is null) then
    raise exception using errcode = '22023', message = 'Accepted BANKED association requires a canonical notice';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'Expected BANKED association revision is required';
  end if;

  select * into v_current
    from public.codex_banked_post_association_decisions
   where observation_id = v_observation.id and is_current
   for update;
  v_current_found := found;
  v_actual_revision := case when v_current_found then v_current.revision else 0 end;
  if p_expected_revision <> v_actual_revision then
    return jsonb_build_object(
      'status', 'stale',
      'expected_revision', p_expected_revision,
      'actual_revision', v_actual_revision,
      'published', false
    );
  end if;
  v_publication_was := v_current_found and
    v_current.status = 'accepted' and v_current.publication_status = 'published';
  if v_current_found and v_current.decision_source = 'manual' then
    v_status := case
      when p_decision ->> 'status' = 'accepted' and v_notice_tweet_id = v_current.notice_tweet_id then 'accepted'
      else 'conflict'
    end;
    update public.codex_banked_grant_observations
       set association_checked_at = v_decided_at
     where id = v_observation.id;
    return jsonb_build_object(
      'status', v_status,
      'reason', case when v_status = 'accepted' then 'manual_association_preserved' else 'manual_association_protected' end,
      'observation_id', v_observation.id,
      'published', v_publication_was,
      'publication_changed', false,
      'unchanged', true
    );
  end if;

  v_expected_publication_status := case when v_status = 'accepted' then 'published' else 'withheld' end;
  if v_current_found and v_current.decision_source = 'automatic' and
     v_current.status = v_status and
     v_current.reason = v_reason and
     v_current.matcher_version = (p_decision ->> 'matcher_version') and
     v_current.notice_tweet_id is not distinct from v_notice_tweet_id and
     v_current.logical_post_id is not distinct from v_logical_post_id and
     v_current.source_tweet_ids is not distinct from coalesce(v_source_ids, '{}'::text[]) and
     v_current.eligible_candidate_ids is not distinct from coalesce(v_candidate_ids, '{}'::text[]) and
     v_current.excluded_candidates is not distinct from v_excluded and
     v_current.evidence is not distinct from v_evidence and
     v_current.publication_status = v_expected_publication_status then
    update public.codex_banked_grant_observations
       set legacy_identity_status = v_legacy_identity_status,
           legacy_reset_event_key = v_legacy_reset_event_key,
           association_checked_at = v_decided_at
     where id = v_observation.id;
    return jsonb_build_object(
      'status', v_status,
      'reason', v_reason,
      'observation_id', v_observation.id,
      'published', v_publication_was,
      'publication_changed', false,
      'unchanged', true
    );
  end if;

  if v_current_found then
    update public.codex_banked_post_association_decisions
       set is_current = false, superseded_at = v_decided_at
     where id = v_current.id;
  end if;

  select coalesce(max(revision), 0) + 1 into v_revision
    from public.codex_banked_post_association_decisions
   where observation_id = v_observation.id;

  if v_status = 'accepted' and v_make_current then
    if jsonb_typeof(v_estimate_to_write) <> 'object' then
      raise exception using errcode = '22023', message = 'Accepted BANKED association requires an estimate projection';
    end if;
    v_estimate_key := nullif(v_estimate_to_write ->> 'reset_event_key', '');
    if v_estimate_key is distinct from v_observation.reset_event_key and (
      v_legacy_identity_status <> 'legacy_exact' or
      v_legacy_reset_event_key is distinct from v_estimate_key or
      v_observation.legacy_identity_status not in ('unresolved', 'legacy_exact')
    ) then
      raise exception using errcode = '23514', message = 'BANKED estimate key lacks exact legacy identity evidence';
    end if;
    if nullif(v_estimate_to_write ->> 'official_notice_tweet_id', '') is distinct from v_notice_tweet_id then
      raise exception using errcode = '23514', message = 'BANKED estimate notice does not match its accepted association';
    end if;
    v_estimate_version := 'banked-distribution-observation-v2';
    select * into v_existing_estimate
      from public.reset_execution_estimates
     where reset_event_key = v_estimate_key
     for update;
    v_existing_estimate_found := found;
    if v_existing_estimate_found and v_existing_estimate.estimator_version not in (
      'banked-distribution-observation-v2', 'usage-execution-banked-v1'
    ) then
      raise exception using errcode = '23514', message = 'Reset estimate key belongs to another event kind';
    end if;

    if v_estimate_key is distinct from v_observation.reset_event_key and (
      not v_existing_estimate_found or
      v_existing_estimate.display_execution_at is distinct from v_observation.observed_at or
      v_existing_estimate.execution_time_source <> 'usage_observation' or
      v_existing_estimate.execution_time_precision <> 'approximate' or
      v_existing_estimate.recovery_observation_id is not null or
      v_existing_estimate.manual_override_at is not null or
      v_existing_estimate.manual_execution_at is not null
    ) then
      raise exception using errcode = '23514', message = 'Legacy BANKED identity is not an exact reusable observation';
    end if;

    if v_estimate_key = v_observation.reset_event_key and v_existing_estimate_found and (
      v_existing_estimate.display_execution_at is distinct from v_observation.observed_at or
      v_existing_estimate.execution_time_source <> 'usage_observation' or
      v_existing_estimate.execution_time_precision <> 'approximate' or
      v_existing_estimate.recovery_observation_id is not null or
      v_existing_estimate.manual_override_at is not null or
      v_existing_estimate.manual_execution_at is not null
    ) then
      raise exception using errcode = '23514', message = 'BANKED key is already owned by a different occurrence';
    end if;

    if v_existing_estimate_found then
      update public.reset_execution_estimates
         set tibo_announced_at = nullif(v_estimate_to_write ->> 'tibo_announced_at', '')::timestamptz,
             tibo_primary_tweet_id = nullif(v_estimate_to_write ->> 'tibo_primary_tweet_id', ''),
             tibo_source_tweet_ids = v_source_ids,
             official_notice_tweet_id = v_notice_tweet_id,
             official_notice_at = nullif(v_estimate_to_write ->> 'official_notice_at', '')::timestamptz,
             updated_at = v_decided_at
       where id = v_existing_estimate.id;
    else
      insert into public.reset_execution_estimates (
        reset_event_key, display_execution_at, execution_time_source,
        execution_time_confidence, execution_time_precision,
        execution_window_start_at, execution_window_end_at,
        recovery_observation_id, recovery_previous_observed_at, recovery_observed_at,
        tibo_announced_at, tibo_primary_tweet_id, tibo_source_tweet_ids,
        official_notice_tweet_id, official_notice_at, estimator_version
      ) values (
        v_estimate_key, v_observation.observed_at, 'usage_observation', 'high', 'approximate',
        null, null,
        null, null, null,
        nullif(v_estimate_to_write ->> 'tibo_announced_at', '')::timestamptz,
        nullif(v_estimate_to_write ->> 'tibo_primary_tweet_id', ''), v_source_ids,
        v_notice_tweet_id, nullif(v_estimate_to_write ->> 'official_notice_at', '')::timestamptz,
        v_estimate_version
      );
    end if;
    v_published := true;
  elsif v_status = 'accepted' then
    v_published := v_current.publication_status = 'published';
  elsif v_estimate_to_write is not null then
    raise exception using errcode = '23514', message = 'Pending BANKED observations cannot create a public estimate';
  end if;

  insert into public.codex_banked_post_association_decisions (
    observation_id, revision, status, reason, matcher_version, decision_source,
    publication_status,
    notice_tweet_id, logical_post_id, source_tweet_ids, eligible_candidate_ids,
    excluded_candidates, evidence, is_current, decided_at
  ) values (
    v_observation.id,
    v_revision,
    v_status,
    v_reason,
    p_decision ->> 'matcher_version',
    v_decision_source,
    case when v_published then 'published' else 'withheld' end,
    v_notice_tweet_id,
    v_logical_post_id,
    coalesce(v_source_ids, '{}'::text[]),
    coalesce(v_candidate_ids, '{}'::text[]),
    v_excluded,
    v_evidence,
    v_make_current,
    v_decided_at
  );

  update public.codex_banked_grant_observations
     set legacy_identity_status = v_legacy_identity_status,
         legacy_reset_event_key = v_legacy_reset_event_key,
         association_checked_at = v_decided_at
   where id = v_observation.id;

  v_publication_changed := v_publication_was is distinct from v_published or
    (v_publication_was and v_published and (
      v_current.notice_tweet_id is distinct from v_notice_tweet_id or
      v_current.logical_post_id is distinct from v_logical_post_id or
      v_current.source_tweet_ids is distinct from coalesce(v_source_ids, '{}'::text[])
    ));

  return jsonb_build_object(
    'status', v_status,
    'reason', v_reason,
    'observation_id', v_observation.id,
    'published', v_published,
    'publication_changed', v_publication_changed,
    'unchanged', false
  );
end;
$function$;

revoke all on function public.record_banked_grant_association_decision(text, jsonb, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.record_banked_grant_association_decision(text, jsonb, jsonb, integer)
  to service_role;

create or replace function public.apply_codex_usage_webhook_write_v2(p_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_inner_plan jsonb;
  v_observation jsonb;
  v_decision jsonb;
  v_estimate jsonb;
  v_observation_key text;
  v_result jsonb;
  v_existing public.codex_banked_grant_observations%rowtype;
  v_existing_found boolean := false;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception using errcode = '22023', message = 'Codex usage write plan must be a JSON object';
  end if;
  v_observation := p_plan -> 'banked_grant_observation';
  v_decision := p_plan -> 'banked_post_association_decision';
  v_estimate := p_plan -> 'banked_distribution_estimate';

  if v_observation is not null and jsonb_typeof(v_observation) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid durable BANKED grant observation';
  end if;
  if v_decision is not null and (v_observation is null or jsonb_typeof(v_decision) <> 'object') then
    raise exception using errcode = '22023', message = 'BANKED association requires a durable observation';
  end if;
  if v_decision is not null and v_decision ->> 'status' = 'accepted' and v_estimate is null then
    raise exception using errcode = '22023', message = 'Accepted BANKED association requires an estimate projection';
  end if;
  if v_decision is not null and v_decision ->> 'status' <> 'accepted' and v_estimate is not null then
    raise exception using errcode = '23514', message = 'Pending BANKED observations cannot be projected';
  end if;
  if v_observation is not null then
    v_observation_key := nullif(v_observation ->> 'observation_key', '');
    if v_observation_key is null or
       nullif(v_observation ->> 'reset_event_key', '') is null or
       (v_observation ->> 'source_key') <> 'local-codex-app-server' or
       (v_observation ->> 'limit_id') <> 'codex' or
       (v_observation ->> 'current_available_count')::integer <= (v_observation ->> 'previous_available_count')::integer or
       nullif(v_decision ->> 'observation_key', '') is distinct from v_observation_key then
      raise exception using errcode = '22023', message = 'Invalid durable BANKED observation identity or count transition';
    end if;

    -- Serialize fact identity checks with the existing monitor-state CAS. This
    -- makes an exact retry idempotent while a conflicting retry fails before
    -- an old/equal monitor timestamp can short-circuit the fact comparison.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('codex-usage-webhook:local-codex-app-server')
    );
    select * into v_existing
      from public.codex_banked_grant_observations
     where observation_key = v_observation_key
     for update;
    v_existing_found := found;
    if v_existing_found and (
      v_existing.reset_event_key is distinct from (v_observation ->> 'reset_event_key') or
      v_existing.source_key is distinct from (v_observation ->> 'source_key') or
      v_existing.limit_id is distinct from (v_observation ->> 'limit_id') or
      v_existing.plan_type is distinct from (v_observation ->> 'plan_type') or
      v_existing.previous_observed_at is distinct from (v_observation ->> 'previous_observed_at')::timestamptz or
      v_existing.observed_at is distinct from (v_observation ->> 'observed_at')::timestamptz or
      v_existing.previous_available_count is distinct from (v_observation ->> 'previous_available_count')::integer or
      v_existing.current_available_count is distinct from (v_observation ->> 'current_available_count')::integer or
      v_existing.observation_window_start_at is distinct from (v_observation ->> 'observation_window_start_at')::timestamptz or
      v_existing.observation_window_end_at is distinct from (v_observation ->> 'observation_window_end_at')::timestamptz or
      v_existing.execution_time_precision is distinct from (v_observation ->> 'execution_time_precision')
    ) then
      raise exception using errcode = '23514', message = 'Conflicting immutable BANKED grant observation retry';
    end if;
  end if;

  -- Preserve old callers. The v2 payload additions are removed before invoking
  -- the existing CAS transaction; PostgreSQL keeps both calls in one transaction.
  v_inner_plan := p_plan - 'banked_grant_observation' - 'banked_post_association_decision';
  if v_observation is not null then
    -- Persist facts and monitor state first. Association is a later retryable
    -- operation so a transient notice or projection failure cannot erase it.
    v_inner_plan := v_inner_plan - 'banked_distribution_estimate';
  end if;

  v_result := public.apply_codex_usage_webhook_write(v_inner_plan);
  if v_result ->> 'status' <> 'applied' or v_observation is null then
    return v_result;
  end if;

  insert into public.codex_banked_grant_observations (
    observation_key, reset_event_key, source_key, limit_id, plan_type,
    previous_observed_at, observed_at, received_at,
    previous_available_count, current_available_count,
    observation_window_start_at, observation_window_end_at, execution_time_precision,
    legacy_identity_status, legacy_reset_event_key
  ) values (
    v_observation ->> 'observation_key',
    v_observation ->> 'reset_event_key',
    v_observation ->> 'source_key',
    v_observation ->> 'limit_id',
    v_observation ->> 'plan_type',
    (v_observation ->> 'previous_observed_at')::timestamptz,
    (v_observation ->> 'observed_at')::timestamptz,
    (v_observation ->> 'received_at')::timestamptz,
    (v_observation ->> 'previous_available_count')::integer,
    (v_observation ->> 'current_available_count')::integer,
    (v_observation ->> 'observation_window_start_at')::timestamptz,
    (v_observation ->> 'observation_window_end_at')::timestamptz,
    v_observation ->> 'execution_time_precision',
    coalesce(nullif(v_observation ->> 'legacy_identity_status', ''), 'resolved'),
    nullif(v_observation ->> 'legacy_reset_event_key', '')
  ) on conflict (observation_key) do nothing;

  select * into v_existing
    from public.codex_banked_grant_observations
   where observation_key = v_observation_key
   for update;
  v_existing_found := found;
  if not v_existing_found or
     v_existing.reset_event_key is distinct from (v_observation ->> 'reset_event_key') or
     v_existing.source_key is distinct from (v_observation ->> 'source_key') or
     v_existing.limit_id is distinct from (v_observation ->> 'limit_id') or
     v_existing.plan_type is distinct from (v_observation ->> 'plan_type') or
     v_existing.previous_observed_at is distinct from (v_observation ->> 'previous_observed_at')::timestamptz or
     v_existing.observed_at is distinct from (v_observation ->> 'observed_at')::timestamptz or
     v_existing.previous_available_count is distinct from (v_observation ->> 'previous_available_count')::integer or
     v_existing.current_available_count is distinct from (v_observation ->> 'current_available_count')::integer or
     v_existing.observation_window_start_at is distinct from (v_observation ->> 'observation_window_start_at')::timestamptz or
     v_existing.observation_window_end_at is distinct from (v_observation ->> 'observation_window_end_at')::timestamptz then
    raise exception using errcode = '23514', message = 'Conflicting immutable BANKED grant observation retry';
  end if;

  if v_estimate is not null and v_decision is null then
    raise exception using errcode = '22023', message = 'BANKED estimate requires a durable association decision';
  end if;

  return jsonb_build_object(
    'status', 'applied',
    'retry_required', false,
    'observation_id', v_existing.id,
    'banked_association_pending', v_decision is not null
  );
end;
$function$;

revoke all on function public.apply_codex_usage_webhook_write_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_codex_usage_webhook_write_v2(jsonb)
  to service_role;

-- Kind-aware replacement for the legacy RPC. Old payloads remain compatible.
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
    if v_existing_estimate_found and v_existing_estimate.estimator_version in (
      'banked-distribution-observation-v2', 'usage-execution-banked-v1'
    ) then
      raise exception using errcode = '23514', message = 'Forced reset key or recovery observation belongs to a BANKED event';
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
    if v_existing_estimate_found and (
      v_existing_estimate.estimator_version not in ('banked-distribution-observation-v2', 'usage-execution-banked-v1') or
      v_existing_estimate.recovery_observation_id is not null
    ) then
      raise exception using errcode = '23514', message = 'BANKED reset key belongs to another event kind';
    end if;


    if v_existing_estimate_found then
      update public.reset_execution_estimates
         set tibo_announced_at = nullif(v_banked_estimate ->> 'tibo_announced_at', '')::timestamptz,
             tibo_primary_tweet_id = v_banked_estimate ->> 'tibo_primary_tweet_id',
             tibo_source_tweet_ids = coalesce(v_banked_source_ids, '{}'::text[]),
             official_notice_tweet_id = v_banked_estimate ->> 'official_notice_tweet_id',
             official_notice_at = nullif(v_banked_estimate ->> 'official_notice_at', '')::timestamptz,
             estimator_version = 'banked-distribution-observation-v2',
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
        'banked-distribution-observation-v2'
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
