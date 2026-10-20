alter table public.tibo_signals
  add column if not exists formal_reply_admission_proof jsonb,
  add column if not exists ai_notice_timing_status text,
  add column if not exists source_context_generation bigint not null default 0;

comment on column public.tibo_signals.formal_reply_admission_proof is
  'Private server-generated proof for verified contextual Tibo reply completions; never expose through public DTOs.';

comment on column public.tibo_signals.source_context_generation is
  'Monotonic CAS generation for a Tibo post source-context graph, including ancestor changes.';

alter table public.tibo_signals
  drop constraint if exists tibo_signals_formal_reply_admission_proof_check;

update public.tibo_signals
   set formal_reply_admission_proof = null
 where formal_reply_admission_proof is not null
   and formal_reply_admission_proof ->> 'version' is distinct from 'tibo-formal-reply-admission-v3';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'tibo_signals_source_context_generation_check'
       and conrelid = 'public.tibo_signals'::regclass
  ) then
    alter table public.tibo_signals
      add constraint tibo_signals_source_context_generation_check
      check (source_context_generation >= 0);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'tibo_signals_ai_notice_timing_status_check'
       and conrelid = 'public.tibo_signals'::regclass
  ) then
    alter table public.tibo_signals
      add constraint tibo_signals_ai_notice_timing_status_check
      check (ai_notice_timing_status is null or ai_notice_timing_status in ('known', 'unknown'));
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'tibo_signals_formal_reply_admission_proof_check'
       and conrelid = 'public.tibo_signals'::regclass
  ) then
    alter table public.tibo_signals
      add constraint tibo_signals_formal_reply_admission_proof_check
      check (
        formal_reply_admission_proof is null
        or (
          jsonb_typeof(formal_reply_admission_proof) = 'object'
          and octet_length(formal_reply_admission_proof::text) <= 16384
          and formal_reply_admission_proof ->> 'version' = 'tibo-formal-reply-admission-v3'
          and formal_reply_admission_proof ->> 'admissionMethod' = 'validated_same_global_reset_reply'
          and formal_reply_admission_proof ->> 'contextualResetAssessment' = 'same_global_reset'
          and formal_reply_admission_proof ->> 'temporalDirection' = 'completed_now'
          and coalesce(formal_reply_admission_proof ->> 'resetMethod' = 'forced', false)
          and coalesce(
            formal_reply_admission_proof ->> 'resetScope' in ('all_paid_users', 'all_users'),
            false
          )
          and coalesce(jsonb_typeof(formal_reply_admission_proof -> 'resetMethodEvidence') = 'object', false)
          and coalesce(jsonb_typeof(formal_reply_admission_proof -> 'resetScopeEvidence') = 'object', false)
          and coalesce(
            length(formal_reply_admission_proof -> 'resetMethodEvidence' ->> 'quote') between 1 and 300,
            false
          )
          and coalesce(
            length(formal_reply_admission_proof -> 'resetScopeEvidence' ->> 'quote') between 1 and 300,
            false
          )
          and coalesce(
            (formal_reply_admission_proof -> 'resetMethodEvidence' ->> 'sourceTextHash') ~ '^[a-f0-9]{64}$',
            false
          )
          and coalesce(
            (formal_reply_admission_proof -> 'resetScopeEvidence' ->> 'sourceTextHash') ~ '^[a-f0-9]{64}$',
            false
          )
          and coalesce(
            (formal_reply_admission_proof ->> 'targetTextHash') ~ '^[a-f0-9]{64}$',
            false
          )
          and coalesce(
            jsonb_typeof(formal_reply_admission_proof -> 'sourceContextGeneration') = 'number'
            and (formal_reply_admission_proof ->> 'sourceContextGeneration') ~ '^[0-9]+$',
            false
          )
          and jsonb_typeof(formal_reply_admission_proof -> 'path') = 'array'
          and jsonb_typeof(formal_reply_admission_proof -> 'pathTweetIds') = 'array'
          and jsonb_typeof(formal_reply_admission_proof -> 'pathRelations') = 'array'
          and case
            when jsonb_typeof(formal_reply_admission_proof -> 'path') = 'array'
              and jsonb_typeof(formal_reply_admission_proof -> 'pathTweetIds') = 'array'
              and jsonb_typeof(formal_reply_admission_proof -> 'pathRelations') = 'array'
            then jsonb_array_length(formal_reply_admission_proof -> 'path') between 2 and 3
              and jsonb_array_length(formal_reply_admission_proof -> 'pathTweetIds') =
                jsonb_array_length(formal_reply_admission_proof -> 'path')
              and jsonb_array_length(formal_reply_admission_proof -> 'pathRelations') =
                jsonb_array_length(formal_reply_admission_proof -> 'path') - 1
            else false
          end
        )
      );
  end if;
end $$;

create or replace function public.clear_stale_tibo_formal_reply_admission_proof()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.source_context_snapshot is distinct from old.source_context_snapshot
    or new.source_context_revision_hashes is distinct from old.source_context_revision_hashes then
    new.source_context_generation := old.source_context_generation + 1;
  elsif new.source_context_generation is distinct from old.source_context_generation
    and pg_trigger_depth() = 1 then
    new.source_context_generation := old.source_context_generation;
  end if;

  if old.formal_reply_admission_proof is not null
    and new.formal_reply_admission_proof is not distinct from old.formal_reply_admission_proof
    and (
      new.tweet_id is distinct from old.tweet_id
      or new.text is distinct from old.text
      or new.tweet_url is distinct from old.tweet_url
      or new.tweet_created_at is distinct from old.tweet_created_at
      or new.signal_type is distinct from old.signal_type
      or coalesce(new.confidence >= 0.95, false) is distinct from coalesce(old.confidence >= 0.95, false)
      or new.verification_status is distinct from old.verification_status
      or new.classification_source is distinct from old.classification_source
      or new.is_reply is distinct from old.is_reply
      or new.is_quote is distinct from old.is_quote
      or new.reply_to_handles is distinct from old.reply_to_handles
      or new.reply_context_text is distinct from old.reply_context_text
      or new.quote_context_text is distinct from old.quote_context_text
      or new.quote_tweet_url is distinct from old.quote_tweet_url
      or new.quote_author_handle is distinct from old.quote_author_handle
      or new.source_context_snapshot is distinct from old.source_context_snapshot
      or new.source_context_revision_hashes is distinct from old.source_context_revision_hashes
      or new.source_context_generation is distinct from old.source_context_generation
      or new.ai_signal_type is distinct from old.ai_signal_type
      or coalesce(new.ai_confidence >= 0.95, false) is distinct from coalesce(old.ai_confidence >= 0.95, false)
      or new.ai_temporal_direction is distinct from old.ai_temporal_direction
      or new.ai_evidence_quote is distinct from old.ai_evidence_quote
      or new.ai_classification_status is distinct from old.ai_classification_status
      or new.logical_post_id is distinct from old.logical_post_id
      or new.edit_history_tweet_ids is distinct from old.edit_history_tweet_ids
      or new.edit_version is distinct from old.edit_version
      or new.edit_metadata_source is distinct from old.edit_metadata_source
    ) then
    new.formal_reply_admission_proof := null;
  end if;
  return new;
end;
$function$;

create or replace function public.invalidate_tibo_formal_reply_proofs_for_source_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if (
    new.tweet_id is distinct from old.tweet_id
    or new.text is distinct from old.text
    or new.tweet_url is distinct from old.tweet_url
    or new.tweet_created_at is distinct from old.tweet_created_at
    or new.signal_type is distinct from old.signal_type
    or coalesce(new.confidence >= 0.95, false) is distinct from coalesce(old.confidence >= 0.95, false)
    or new.verification_status is distinct from old.verification_status
    or new.classification_source is distinct from old.classification_source
    or new.is_reply is distinct from old.is_reply
    or new.is_quote is distinct from old.is_quote
    or new.reply_to_handles is distinct from old.reply_to_handles
    or new.reply_context_text is distinct from old.reply_context_text
    or new.quote_context_text is distinct from old.quote_context_text
    or new.quote_tweet_url is distinct from old.quote_tweet_url
    or new.quote_author_handle is distinct from old.quote_author_handle
    or new.source_context_snapshot is distinct from old.source_context_snapshot
    or new.source_context_revision_hashes is distinct from old.source_context_revision_hashes
    or new.ai_signal_type is distinct from old.ai_signal_type
    or coalesce(new.ai_confidence >= 0.95, false) is distinct from coalesce(old.ai_confidence >= 0.95, false)
    or new.ai_temporal_direction is distinct from old.ai_temporal_direction
    or new.ai_evidence_quote is distinct from old.ai_evidence_quote
    or new.ai_classification_status is distinct from old.ai_classification_status
    or new.logical_post_id is distinct from old.logical_post_id
    or new.edit_history_tweet_ids is distinct from old.edit_history_tweet_ids
    or new.edit_version is distinct from old.edit_version
    or new.edit_metadata_source is distinct from old.edit_metadata_source
  ) then
    with recursive affected(tweet_id, depth, path) as (
      select dependent.tweet_id,
             1,
             array[old.tweet_id, dependent.tweet_id]::text[]
        from public.tibo_signals as dependent
       where dependent.id <> old.id
         and (
           exists (
             select 1
               from jsonb_each(coalesce(dependent.source_context_snapshot, '{}'::jsonb)) as context(kind, item)
              where context.item ->> 'tweetId' = old.tweet_id
           )
           or coalesce(dependent.formal_reply_admission_proof -> 'pathTweetIds', '[]'::jsonb)
              @> jsonb_build_array(old.tweet_id)
         )
      union all
      select dependent.tweet_id,
             affected.depth + 1,
             affected.path || dependent.tweet_id
        from affected
        join public.tibo_signals as dependent
          on not (dependent.tweet_id = any(affected.path))
       where affected.depth < 2
         and exists (
           select 1
             from jsonb_each(coalesce(dependent.source_context_snapshot, '{}'::jsonb)) as context(kind, item)
            where context.item ->> 'tweetId' = affected.tweet_id
         )
    )
    update public.tibo_signals as dependent
       set source_context_generation = dependent.source_context_generation + 1,
           source_context_classified_revision_hashes = '{}'::text[],
           formal_reply_admission_proof = null
      from (select distinct affected.tweet_id from affected) as changed
     where dependent.tweet_id = changed.tweet_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists tibo_signals_clear_stale_formal_reply_proof
  on public.tibo_signals;
create trigger tibo_signals_clear_stale_formal_reply_proof
before update on public.tibo_signals
for each row
execute function public.clear_stale_tibo_formal_reply_admission_proof();

drop trigger if exists tibo_signals_invalidate_dependent_formal_reply_proofs
  on public.tibo_signals;
create trigger tibo_signals_invalidate_dependent_formal_reply_proofs
after update on public.tibo_signals
for each row
execute function public.invalidate_tibo_formal_reply_proofs_for_source_change();
