truncate table public.codex_usage_future_reply_claims,
  public.reset_execution_estimates,
  public.codex_recovery_observations,
  public.codex_usage_monitor_state,
  public.tibo_signals;

insert into public.codex_usage_monitor_state (
  source_key, observed_at, received_at, limit_id, plan_type, used_percent,
  window_duration_mins, resets_at, coverage_started_at,
  banked_reset_available_count, last_banked_grant_at, updated_at
) values (
  'local-codex-app-server', '2026-10-22T17:54:00Z', '2026-10-22T17:54:01Z',
  'codex', 'plus', 100, 10080, 1800000000, '2026-10-22T17:54:00Z', 0, null,
  '2026-10-22T17:54:01Z'
);

insert into public.tibo_signals (
  tweet_id, text, tweet_url, tweet_created_at, expires_at, signal_type,
  confidence, verification_status, classification_source, is_reply, is_quote,
  quote_context_text, quote_tweet_url, quote_author_handle, reply_to_handles,
  reply_context_text, source_context_snapshot, source_context_revision_hashes,
  source_context_classified_revision_hashes, source_context_generation,
  ai_confidence, ai_signal_type, ai_classification_status, ai_temporal_expression,
  ai_temporal_kind, ai_temporal_direction, ai_notice_timing_status, ai_evidence_quote,
  ai_contextual_reset_assessment, ai_contextual_reset_tweet_id, ai_temporal_precision,
  ai_temporal_timezone, ai_temporal_confidence, temporal_expression, temporal_kind,
  temporal_precision, temporal_timezone, temporal_confidence, temporal_resolution_source,
  temporal_resolution_version, expected_start_at, expected_end_at,
  temporal_resolution_status, logical_post_id, edit_history_tweet_ids, edit_version,
  edit_metadata_source
) values (
  '2113162413008884099', 'Lands tomorrow before 10am PST.',
  'https://x.com/thsottiaux/status/2113162413008884099',
  '2026-10-22T06:55:54Z', '2026-10-23T23:00:00Z', 'official_notice',
  0.98, 'auto_unverified', 'gemini', true, false,
  null, null, null, array['@thsottiaux']::text[],
  'Day 17/ Bet you thought we forgot, but no, it’s reset day today.',
  jsonb_build_object('parent', jsonb_build_object(
    'tweetId', '2113162277688070445',
    'tweetUrl', 'https://x.com/thsottiaux/status/2113162277688070445',
    'authorHandle', '@thsottiaux',
    'text', 'Day 17/ Bet you thought we forgot, but no, it’s reset day today.'
  )),
  array[repeat('a', 64)]::text[], array[repeat('a', 64)]::text[], 1,
  0.98, 'official_notice', 'success', 'tomorrow before 10am PST',
  'range', 'future', 'known', 'Lands tomorrow before 10am PST.',
  'same_global_reset', '2113162277688070445', 'range', 'PST', 0.95,
  'tomorrow before 10am PST', 'range', 'range', 'PST', 0.95, 'ai',
  'tibo-temporal-v9-deadline-start-estimate', '2026-10-22T15:00:00Z',
  '2026-10-22T18:00:00Z', 'resolved', '2113162413008884099',
  array['2113162413008884099']::text[], 1, 'none'
);

select to_jsonb(signal)::text
  from public.tibo_signals signal
 where tweet_id = '2113162413008884099';
