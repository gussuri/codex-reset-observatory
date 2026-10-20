alter table public.tibo_signals
  add column if not exists formal_reply_admission_proof jsonb;

comment on column public.tibo_signals.formal_reply_admission_proof is
  'Private server-generated proof for verified contextual Tibo reply completions; never expose through public DTOs.';

do $$
begin
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
          and formal_reply_admission_proof ->> 'version' = 'tibo-formal-reply-admission-v2'
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
  if old.formal_reply_admission_proof is not null
    and new.formal_reply_admission_proof is not distinct from old.formal_reply_admission_proof
    and (
      new.tweet_id is distinct from old.tweet_id
      or new.text is distinct from old.text
      or new.tweet_url is distinct from old.tweet_url
      or new.tweet_created_at is distinct from old.tweet_created_at
      or new.signal_type is distinct from old.signal_type
      or new.confidence is distinct from old.confidence
      or new.verification_status is distinct from old.verification_status
      or new.classification_reason is distinct from old.classification_reason
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
      or new.ai_confidence is distinct from old.ai_confidence
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
  if (
    new.tweet_id is distinct from old.tweet_id
    or new.text is distinct from old.text
    or new.tweet_url is distinct from old.tweet_url
    or new.tweet_created_at is distinct from old.tweet_created_at
    or new.signal_type is distinct from old.signal_type
    or new.confidence is distinct from old.confidence
    or new.verification_status is distinct from old.verification_status
    or new.classification_reason is distinct from old.classification_reason
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
    or new.ai_confidence is distinct from old.ai_confidence
    or new.ai_temporal_direction is distinct from old.ai_temporal_direction
    or new.ai_evidence_quote is distinct from old.ai_evidence_quote
    or new.ai_classification_status is distinct from old.ai_classification_status
    or new.logical_post_id is distinct from old.logical_post_id
    or new.edit_history_tweet_ids is distinct from old.edit_history_tweet_ids
    or new.edit_version is distinct from old.edit_version
    or new.edit_metadata_source is distinct from old.edit_metadata_source
  ) then
    update public.tibo_signals as dependent
       set formal_reply_admission_proof = null
     where dependent.id <> old.id
       and dependent.formal_reply_admission_proof is not null
       and dependent.formal_reply_admission_proof -> 'pathTweetIds' @> jsonb_build_array(old.tweet_id);
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
