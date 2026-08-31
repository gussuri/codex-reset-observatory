create table if not exists public.tibo_formal_adoptions (
  id uuid primary key default extensions.gen_random_uuid(),
  logical_post_id text not null unique,
  logical_post_tweet_ids text[] not null,
  reset_event_key text not null unique,
  representative_tweet_id text not null,
  source_tweet_ids text[] not null,
  claim_source text not null,
  adopted_at timestamptz,
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tibo_formal_adoptions_logical_ids_check
    check (
      btrim(logical_post_id) <> '' and
      cardinality(logical_post_tweet_ids) > 0 and
      cardinality(logical_post_tweet_ids) <= 6 and
      array_position(logical_post_tweet_ids, null::text) is null and
      array_position(logical_post_tweet_ids, ''::text) is null and
      logical_post_id = logical_post_tweet_ids[1] and
      representative_tweet_id = any(logical_post_tweet_ids)
    ),
  constraint tibo_formal_adoptions_event_key_check
    check (btrim(reset_event_key) <> ''),
  constraint tibo_formal_adoptions_source_ids_check
    check (
      cardinality(source_tweet_ids) > 0 and
      array_position(source_tweet_ids, null::text) is null and
      array_position(source_tweet_ids, ''::text) is null
    ),
  constraint tibo_formal_adoptions_claim_source_check
    check (claim_source in (
      'new_adoption',
      'existing_estimate',
      'existing_history',
      'existing_dynamic'
    ))
);

create index if not exists tibo_formal_adoptions_logical_ids_idx
  on public.tibo_formal_adoptions using gin (logical_post_tweet_ids);

create index if not exists tibo_formal_adoptions_source_ids_idx
  on public.tibo_formal_adoptions using gin (source_tweet_ids);

alter table public.tibo_formal_adoptions enable row level security;

revoke all privileges on table public.tibo_formal_adoptions from public, anon, authenticated;
grant all privileges on table public.tibo_formal_adoptions to service_role;

create or replace function public.claim_tibo_formal_adoption(
  p_logical_post_id text,
  p_logical_post_tweet_ids text[],
  p_reset_event_key text,
  p_representative_tweet_id text,
  p_source_tweet_ids text[],
  p_claim_source text,
  p_identity_source text,
  p_adopted_at timestamptz,
  p_claimed_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_existing public.tibo_formal_adoptions%rowtype;
  v_inserted public.tibo_formal_adoptions%rowtype;
  v_requested_existing public.tibo_formal_adoptions%rowtype;
  v_match_count integer := 0;
  v_distinct_key_count integer := 0;
  v_first_key text;
  v_requested_existing_found boolean := false;
  v_has_incompatible boolean := false;
  v_existing_ids text[];
  v_selected_ids text[];
  v_selected_root text;
  v_selected_sources text[];
  v_changed boolean := false;
  v_is_compatible boolean;
  v_incoming_is_shorter boolean;
begin
  if nullif(trim(p_logical_post_id), '') is null or
     nullif(trim(p_reset_event_key), '') is null or
     nullif(trim(p_representative_tweet_id), '') is null or
     p_logical_post_tweet_ids is null or
     cardinality(p_logical_post_tweet_ids) = 0 or
     cardinality(p_logical_post_tweet_ids) > 6 or
     p_source_tweet_ids is null or
     cardinality(p_source_tweet_ids) = 0 or
     p_claim_source is null or
     p_identity_source is null or
     p_claim_source not in ('new_adoption', 'existing_estimate', 'existing_history', 'existing_dynamic') or
     p_identity_source not in ('x_api', 'none') then
    raise exception using errcode = '22023', message = 'Invalid Tibo formal adoption claim';
  end if;

  -- X supports an original plus at most five edits. Keep malformed or
  -- duplicate logical aliases out of the ledger even at the RPC boundary.
  if exists (
       select 1
       from unnest(p_logical_post_tweet_ids) as items(value)
       where items.value is null or nullif(trim(items.value), '') is null
     ) or
     cardinality(p_logical_post_tweet_ids) <> cardinality(
       array(select distinct items.value from unnest(p_logical_post_tweet_ids) as items(value))
     ) then
    raise exception using errcode = '22023', message = 'Invalid Tibo logical post aliases';
  end if;

  if exists (
       select 1
       from unnest(p_source_tweet_ids) as items(value)
       where items.value is null or nullif(trim(items.value), '') is null
     ) or
     cardinality(p_source_tweet_ids) <> cardinality(
       array(select distinct items.value from unnest(p_source_tweet_ids) as items(value))
     ) then
    raise exception using errcode = '22023', message = 'Invalid Tibo source provenance';
  end if;

  if p_logical_post_id <> p_logical_post_tweet_ids[1] or
     not (p_representative_tweet_id = any(p_logical_post_tweet_ids)) then
    raise exception using errcode = '22023', message = 'Tibo formal adoption identity is inconsistent';
  end if;

  if p_identity_source = 'none' and cardinality(p_logical_post_tweet_ids) <> 1 then
    raise exception using errcode = '22023', message = 'Untrusted identity must be a self identity';
  end if;

  if p_identity_source = 'x_api' and exists (
       select 1
       from unnest(p_logical_post_tweet_ids) as items(value)
       where items.value !~ '^[0-9]+$'
     ) then
    raise exception using errcode = '22023', message = 'X API identity aliases must be numeric';
  end if;

  -- Adoption claims are rare. A single transaction lock makes alias discovery,
  -- self-identity upgrade, and the unique insert one atomic operation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('tibo-formal-adoption')
  );

  for v_existing in
    select *
    from public.tibo_formal_adoptions
    where logical_post_id = p_logical_post_id
       or logical_post_tweet_ids && p_logical_post_tweet_ids
       or reset_event_key = p_reset_event_key
    order by created_at, id
    for update
  loop
    v_match_count := v_match_count + 1;
    if v_first_key is null then
      v_first_key := v_existing.reset_event_key;
      v_distinct_key_count := 1;
    elsif v_first_key <> v_existing.reset_event_key then
      v_distinct_key_count := v_distinct_key_count + 1;
    end if;
    if v_existing.reset_event_key = p_reset_event_key then
      v_requested_existing := v_existing;
      v_requested_existing_found := true;
    end if;
    v_existing_ids := v_existing.logical_post_tweet_ids;
    v_is_compatible :=
      (cardinality(v_existing_ids) = 1 and v_existing_ids[1] = any(p_logical_post_tweet_ids)) or
      (cardinality(p_logical_post_tweet_ids) = 1 and p_logical_post_tweet_ids[1] = any(v_existing_ids)) or
      (v_existing_ids = p_logical_post_tweet_ids) or
      (cardinality(v_existing_ids) <= cardinality(p_logical_post_tweet_ids) and
        v_existing_ids = p_logical_post_tweet_ids[1:cardinality(v_existing_ids)]) or
      (cardinality(p_logical_post_tweet_ids) <= cardinality(v_existing_ids) and
        p_logical_post_tweet_ids = v_existing_ids[1:cardinality(p_logical_post_tweet_ids)]);
    if not v_is_compatible then
      v_has_incompatible := true;
    end if;
  end loop;

  if v_match_count = 0 then
    insert into public.tibo_formal_adoptions (
      logical_post_id,
      logical_post_tweet_ids,
      reset_event_key,
      representative_tweet_id,
      source_tweet_ids,
      claim_source,
      adopted_at,
      claimed_at
    ) values (
      p_logical_post_id,
      p_logical_post_tweet_ids,
      p_reset_event_key,
      p_representative_tweet_id,
      p_source_tweet_ids,
      p_claim_source,
      p_adopted_at,
      coalesce(p_claimed_at, now())
    )
    on conflict (logical_post_id) do nothing
    returning * into v_inserted;

    if found then
      return jsonb_build_object(
        'status', case when p_claim_source = 'new_adoption' then 'claimed_new' else 'existing' end,
        'record', to_jsonb(v_inserted)
      );
    end if;

    select * into v_existing
    from public.tibo_formal_adoptions
    where logical_post_id = p_logical_post_id
       or reset_event_key = p_reset_event_key
    order by created_at, id
    limit 1
    for update;
    if not found then
      raise exception using errcode = '23505', message = 'Tibo formal adoption claim conflicted';
    end if;
    v_match_count := 1;
    v_distinct_key_count := 1;
    v_has_incompatible := false;
  end if;

  if v_has_incompatible then
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'conflicting_trusted_identity',
      'record', to_jsonb(v_existing)
    );
  end if;

  if v_distinct_key_count > 1 then
    if p_claim_source <> 'new_adoption' and v_requested_existing_found then
      -- Existing evidence selected this immutable key; leave the other
      -- historical claim untouched rather than guessing which claim to delete.
      v_existing := v_requested_existing;
    else
      return jsonb_build_object(
        'status', 'conflict',
        'reason', 'ambiguous_existing_claims',
        'record', to_jsonb(v_existing)
      );
    end if;
  end if;

  v_existing_ids := v_existing.logical_post_tweet_ids;
  v_is_compatible :=
    (cardinality(v_existing_ids) = 1 and v_existing_ids[1] = any(p_logical_post_tweet_ids)) or
    (cardinality(p_logical_post_tweet_ids) = 1 and p_logical_post_tweet_ids[1] = any(v_existing_ids)) or
    (v_existing_ids = p_logical_post_tweet_ids) or
    (cardinality(v_existing_ids) <= cardinality(p_logical_post_tweet_ids) and
      v_existing_ids = p_logical_post_tweet_ids[1:cardinality(v_existing_ids)]) or
    (cardinality(p_logical_post_tweet_ids) <= cardinality(v_existing_ids) and
      p_logical_post_tweet_ids = v_existing_ids[1:cardinality(p_logical_post_tweet_ids)]);

  if not v_is_compatible then
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'conflicting_trusted_identity',
      'record', to_jsonb(v_existing)
    );
  end if;

  -- A later untrusted self identity must never shorten an authoritative chain.
  v_incoming_is_shorter := cardinality(p_logical_post_tweet_ids) < cardinality(v_existing_ids);
  v_selected_ids := case
    when v_incoming_is_shorter then v_existing_ids
    when cardinality(p_logical_post_tweet_ids) > cardinality(v_existing_ids) then p_logical_post_tweet_ids
    else v_existing_ids
  end;
  v_selected_root := v_selected_ids[1];

  -- Do not physically merge two previously claimed ledgers when external
  -- evidence selects the non-root row. Preserve both immutable event keys and
  -- report the collision instead of relying on the logical root UNIQUE error.
  if v_existing.logical_post_id <> v_selected_root and exists (
       select 1
       from public.tibo_formal_adoptions as collision
       where collision.logical_post_id = v_selected_root
         and collision.id <> v_existing.id
     ) then
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'canonical_existing_claims',
      'record', to_jsonb(v_existing)
    );
  end if;

  v_selected_sources := array(
     select distinct items.value
    from unnest(
      coalesce(v_existing.source_tweet_ids, '{}'::text[]) ||
      coalesce(p_source_tweet_ids, '{}'::text[])
    ) as items(value)
    order by items.value
  );

  if v_existing.logical_post_id <> v_selected_root or
     v_existing.logical_post_tweet_ids <> v_selected_ids or
     v_existing.source_tweet_ids <> v_selected_sources then
    v_changed := true;
  end if;

  if v_changed then
    -- reset_event_key is immutable and intentionally omitted from this update.
    update public.tibo_formal_adoptions
    set logical_post_id = v_selected_root,
        logical_post_tweet_ids = v_selected_ids,
        source_tweet_ids = v_selected_sources,
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;
    return jsonb_build_object('status', 'reconciled', 'record', to_jsonb(v_existing));
  end if;

  return jsonb_build_object('status', 'existing', 'record', to_jsonb(v_existing));
end;
$function$;

revoke all on function public.claim_tibo_formal_adoption(
  text, text[], text, text, text[], text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_tibo_formal_adoption(
  text, text[], text, text, text[], text, text, timestamptz, timestamptz
) to service_role;
