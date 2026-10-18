begin;
select plan(20);

select has_column('public', 'tibo_signals', 'source_context_snapshot', 'source context has a dedicated snapshot column');
select has_column('public', 'tibo_signals', 'source_context_revision_hashes', 'source context revisions are bounded separately');
select ok(has_function_privilege('service_role', 'public.merge_tibo_source_context_enrichment(text,text,timestamp with time zone,text,jsonb,text)', 'EXECUTE'), 'service_role can execute enrichment RPC');
select ok(not has_function_privilege('authenticated', 'public.merge_tibo_source_context_enrichment(text,text,timestamp with time zone,text,jsonb,text)', 'EXECUTE'), 'authenticated cannot execute enrichment RPC');
select ok(not has_function_privilege('anon', 'public.merge_tibo_source_context_enrichment(text,text,timestamp with time zone,text,jsonb,text)', 'EXECUTE'), 'anon cannot execute enrichment RPC');

insert into public.tibo_signals (
  id, tweet_id, signal_type, text, tweet_url, tweet_created_at, expires_at,
  verification_status, confidence, classification_reason
) values (
  '00000000-0000-0000-0000-000000000001', '912345678901234567', 'teaser', 'Stored root text',
  'https://x.com/thsottiaux/status/912345678901234567',
  '2026-10-18T00:00:00Z', '2026-10-19T00:00:00Z', 'confirmed', 0.93, 'manual review'
);

select is(
  public.merge_tibo_source_context_enrichment(
    '912345678901234567', 'https://x.com/thsottiaux/status/912345678901234567',
    '2026-10-18T00:00:00Z', 'Stored root text',
    '{"parent":{"tweetId":"812345678901234567","tweetUrl":"https://x.com/parent/status/812345678901234567","authorHandle":"@parent","text":"Parent evidence"}}'::jsonb,
    repeat('a', 64)
  ) ->> 'status', 'applied', 'first evidence applies to existing root'
);
select is(
  public.merge_tibo_source_context_enrichment(
    '912345678901234567', 'https://x.com/thsottiaux/status/912345678901234567',
    '2026-10-18T00:00:00Z', 'Stored root text',
    '{"parent":{"tweetId":"812345678901234567","tweetUrl":"https://x.com/parent/status/812345678901234567","authorHandle":"@parent","text":"Parent evidence"}}'::jsonb,
    repeat('a', 64)
  ) ->> 'status', 'duplicate', 'same revision is idempotent'
);
select is(
  public.merge_tibo_source_context_enrichment(
    '912345678901234567', 'https://x.com/thsottiaux/status/912345678901234567',
    '2026-10-18T00:00:00Z', 'Stored root text',
    '{"parent":{"tweetId":"812345678901234567","tweetUrl":"https://x.com/parent/status/812345678901234567","authorHandle":"@parent","text":"Different evidence"}}'::jsonb,
    repeat('b', 64)
  ) ->> 'status', 'conflict', 'conflicting parent evidence is held'
);
select is(
  public.merge_tibo_source_context_enrichment(
    '912345678901234567', 'https://x.com/thsottiaux/status/912345678901234567',
    '2026-10-18T00:00:00Z', 'Changed root text',
    '{"quote":{"tweetId":"712345678901234567","tweetUrl":"https://x.com/quote/status/712345678901234567","authorHandle":"@quote","text":"Quote evidence"}}'::jsonb,
    repeat('c', 64)
  ) ->> 'status', 'root_mismatch', 'changed root text is rejected'
);
select is(
  public.merge_tibo_source_context_enrichment(
    '912345678901234568', 'https://x.com/thsottiaux/status/912345678901234568',
    '2026-10-18T00:00:00Z', 'Missing root',
    '{"parent":{"tweetId":"812345678901234567","tweetUrl":"https://x.com/parent/status/812345678901234567","authorHandle":"@parent","text":"Parent evidence"}}'::jsonb,
    repeat('d', 64)
  ) ->> 'status', 'root_missing', 'missing root remains retryable'
);

update public.tibo_signals set verification_status = 'confirmed', classification_reason = 'manual review'
 where tweet_id = '912345678901234567';
select is((select verification_status from public.tibo_signals where tweet_id = '912345678901234567'), 'confirmed', 'manual verification remains unchanged');
select is((select classification_reason from public.tibo_signals where tweet_id = '912345678901234567'), 'manual review', 'manual classification reason remains unchanged');
insert into public.tibo_signals (
  id, tweet_id, signal_type, text, tweet_url, tweet_created_at, expires_at,
  verification_status, confidence, classification_reason
) values (
  '00000000-0000-0000-0000-000000000002', '912345678901234569', 'teaser', 'Rejected root text',
  'https://x.com/thsottiaux/status/912345678901234569',
  '2026-10-18T00:00:00Z', '2026-10-19T00:00:00Z', 'rejected', 0.11, 'manual rejection'
);
select is(
  public.merge_tibo_source_context_enrichment(
    '912345678901234569', 'https://x.com/thsottiaux/status/912345678901234569',
    '2026-10-18T00:00:00Z', 'Rejected root text',
    '{"quote":{"tweetId":"712345678901234567","tweetUrl":"https://x.com/quote/status/712345678901234567","authorHandle":"@quote","text":"Quote evidence"}}'::jsonb,
    repeat('9', 64)
  ) ->> 'status', 'applied', 'source context applies to rejected rows without changing them'
);
select is((select verification_status from public.tibo_signals where tweet_id = '912345678901234569'), 'rejected', 'manual rejection remains unchanged');

select throws_ok(
  $$select public.merge_tibo_source_context_enrichment('912345678901234567','https://x.com/thsottiaux/status/912345678901234567','2026-10-18T00:00:00Z','Stored root text','{"parent":null}'::jsonb,repeat('e',64))$$,
  '22023', 'Invalid source context item', 'null context item is rejected safely'
);
select throws_ok(
  $$select public.merge_tibo_source_context_enrichment('912345678901234567','https://x.com/thsottiaux/status/912345678901234567','2026-10-18T00:00:00Z','Stored root text','{"parent":{"tweetId":null,"tweetUrl":"https://x.com/parent/status/812345678901234567","authorHandle":"@parent","text":"Parent evidence"}}'::jsonb,repeat('f',64))$$,
  '22023', 'Invalid source context item', 'null required JSON field is rejected'
);
select throws_ok(
  $$select public.merge_tibo_source_context_enrichment('912345678901234567','https://x.com/thsottiaux/status/912345678901234567','2026-10-18T00:00:00Z','Stored root text','null'::jsonb,repeat('0',64))$$,
  '22023', 'Invalid source context snapshot', 'non-object snapshot is rejected before object iteration'
);
select throws_ok(
  $$select public.merge_tibo_source_context_enrichment('912345678901234567','https://x.com/thsottiaux/status/912345678901234567','2026-10-18T00:00:00Z','Stored root text',null,repeat('1',64))$$,
  '22023', 'Invalid source context snapshot', 'SQL NULL snapshot is rejected'
);
select throws_ok(
  $$select public.merge_tibo_source_context_enrichment('912345678901234567','https://x.com/thsottiaux/status/912345678901234567','2026-10-18T00:00:00Z','Stored root text','{"parent":{"tweetId":"812345678901234567","tweetUrl":"https://x.com/parent/status/812345678901234567","authorHandle":"@parent","text":"Parent evidence","extra":true}}'::jsonb,repeat('2',64))$$,
  '22023', 'Invalid source context item', 'extra JSON keys are rejected'
);

update public.tibo_signals set source_context_revision_hashes = array[repeat('3',64),repeat('4',64),repeat('5',64)]
 where tweet_id = '912345678901234567';
select is(
  public.merge_tibo_source_context_enrichment(
    '912345678901234567', 'https://x.com/thsottiaux/status/912345678901234567',
    '2026-10-18T00:00:00Z', 'Stored root text',
    '{"quote":{"tweetId":"712345678901234567","tweetUrl":"https://x.com/quote/status/712345678901234567","authorHandle":"@quote","text":"Quote evidence"}}'::jsonb,
    repeat('6', 64)
  ) ->> 'status', 'revision_limit', 'fourth distinct source revision is rejected'
);

select * from finish();
rollback;\n