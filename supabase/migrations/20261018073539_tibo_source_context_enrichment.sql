alter table public.tibo_signals
  add column if not exists source_context_snapshot jsonb,
  add column if not exists source_context_revision_hashes text[] not null default '{}'::text[];

alter table public.tibo_signals
  add constraint tibo_signals_source_context_snapshot_check
    check (
      source_context_snapshot is null
      or (
        jsonb_typeof(source_context_snapshot) = 'object'
        and octet_length(source_context_snapshot::text) <= 8192
      )
    ),
  add constraint tibo_signals_source_context_revisions_check
    check (
      cardinality(source_context_revision_hashes) <= 3
      and array_position(source_context_revision_hashes, null) is null
    );

create or replace function public.merge_tibo_source_context_enrichment(
  p_tweet_id text,
  p_tweet_url text,
  p_tweet_created_at timestamptz,
  p_text text,
  p_snapshot jsonb,
  p_revision_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_signal public.tibo_signals%rowtype;
  v_merged jsonb;
  v_item jsonb;
  v_kind text;
  v_has_change boolean := false;
begin
  if p_tweet_id is null or p_tweet_id !~ '^[0-9]{15,25}$'
    or p_tweet_url is null
    or p_tweet_url !~ ('^https://(x|twitter)\.com/thsottiaux/status/' || p_tweet_id || '$')
    or p_tweet_created_at is null
    or p_text is null or length(btrim(p_text)) = 0 or length(p_text) > 25000
    or p_revision_hash is null or p_revision_hash !~ '^[a-f0-9]{64}$'
    then
    raise exception using errcode = '22023', message = 'Invalid source context enrichment';
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or octet_length(p_snapshot::text) > 8192 or p_snapshot = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Invalid source context snapshot';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_snapshot) as keys(key)
    where key not in ('parent', 'quote')
  ) then
    raise exception using errcode = '22023', message = 'Invalid source context kind';
  end if;

  for v_kind in select jsonb_object_keys(p_snapshot)
  loop
    v_item := p_snapshot -> v_kind;
    if jsonb_typeof(v_item) is distinct from 'object'
      or not (v_item ?& array['tweetId', 'tweetUrl', 'authorHandle', 'text']) then
      raise exception using errcode = '22023', message = 'Invalid source context item';
    end if;
    if (select count(*) from jsonb_object_keys(v_item)) <> 4
      or exists (
        select 1 from jsonb_object_keys(v_item) as item_keys(key)
        where key not in ('tweetId', 'tweetUrl', 'authorHandle', 'text')
      )
      or jsonb_typeof(v_item -> 'tweetId') is distinct from 'string'
      or jsonb_typeof(v_item -> 'tweetUrl') is distinct from 'string'
      or jsonb_typeof(v_item -> 'authorHandle') is distinct from 'string'
      or jsonb_typeof(v_item -> 'text') is distinct from 'string'
      or coalesce(v_item ->> 'tweetId', '') !~ '^[0-9]{1,30}$'
      or coalesce(v_item ->> 'authorHandle', '') !~ '^@[A-Za-z0-9_]{1,15}$'
      or coalesce(v_item ->> 'text', '') = ''
      or length(v_item ->> 'text') > 1000
      or v_item ->> 'tweetUrl' <> 'https://x.com/' || substring(v_item ->> 'authorHandle' from 2)
        || '/status/' || (v_item ->> 'tweetId') then
      raise exception using errcode = '22023', message = 'Invalid source context item';
    end if;
  end loop;

  select s.*
    into v_signal
    from public.tibo_signals as s
   where s.tweet_id = p_tweet_id
   for update;

  if not found then
    return jsonb_build_object('status', 'root_missing');
  end if;

  if v_signal.tweet_url <> p_tweet_url
    or v_signal.tweet_created_at <> p_tweet_created_at
    or btrim(v_signal.text) <> btrim(p_text) then
    return jsonb_build_object('status', 'root_mismatch');
  end if;

  if p_revision_hash = any(coalesce(v_signal.source_context_revision_hashes, '{}'::text[])) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  v_merged := coalesce(v_signal.source_context_snapshot, '{}'::jsonb);
  for v_kind in select jsonb_object_keys(p_snapshot)
  loop
    v_item := p_snapshot -> v_kind;
    if v_merged ? v_kind then
      if v_merged -> v_kind <> v_item then
        return jsonb_build_object('status', 'conflict');
      end if;
    else
      v_merged := v_merged || jsonb_build_object(v_kind, v_item);
      v_has_change := true;
    end if;
  end loop;

  if not v_has_change then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if cardinality(coalesce(v_signal.source_context_revision_hashes, '{}'::text[])) >= 3 then
    return jsonb_build_object('status', 'revision_limit');
  end if;

  update public.tibo_signals
     set source_context_snapshot = v_merged,
         source_context_revision_hashes = array_append(
           coalesce(v_signal.source_context_revision_hashes, '{}'::text[]),
           p_revision_hash
         )
   where id = v_signal.id;

  return jsonb_build_object('status', 'applied');
end;
$function$;

revoke all on function public.merge_tibo_source_context_enrichment(text, text, timestamptz, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.merge_tibo_source_context_enrichment(text, text, timestamptz, text, jsonb, text)
  to service_role;
