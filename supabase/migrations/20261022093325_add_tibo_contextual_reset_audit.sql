alter table public.tibo_signals
  add column if not exists ai_contextual_reset_assessment text,
  add column if not exists ai_contextual_reset_tweet_id text;

comment on column public.tibo_signals.ai_contextual_reset_assessment is
  'Validated raw Gemini context assessment used for source-grounded reply notices; not formal reset admission proof.';

comment on column public.tibo_signals.ai_contextual_reset_tweet_id is
  'Source tweet ID named by Gemini for a contextual reset assessment; not formal reset admission proof.';

alter table public.tibo_signals
  drop constraint if exists tibo_signals_ai_contextual_reset_assessment_check,
  drop constraint if exists tibo_signals_ai_contextual_reset_tweet_id_check;

alter table public.tibo_signals
  add constraint tibo_signals_ai_contextual_reset_assessment_check
    check (
      ai_contextual_reset_assessment is null
      or ai_contextual_reset_assessment in (
        'same_global_reset',
        'same_banked_distribution',
        'same_personal_reset',
        'different_event',
        'negated',
        'uncertain',
        'not_applicable',
        'unknown'
      )
    ),
  add constraint tibo_signals_ai_contextual_reset_tweet_id_check
    check (
      ai_contextual_reset_tweet_id is null
      or ai_contextual_reset_tweet_id ~ '^[0-9]{1,30}$'
    );
