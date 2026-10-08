-- Local integration-test cleanup only. This file is always run with `supabase db query --local`.
begin;

delete from public.codex_banked_post_association_decisions decision
using public.codex_banked_grant_observations observation
where decision.observation_id = observation.id
  and observation.observation_key <> '__atomic_test_keep__';

delete from public.reset_execution_estimates
where reset_event_key <> '__atomic_test_keep__';

delete from public.codex_banked_grant_observations
where observation_key <> '__atomic_test_keep__';

delete from public.codex_recovery_observations
where source_key = 'local-codex-app-server';

delete from public.regular_reset_events
where schedule_key <> '__atomic_test_keep__';

delete from public.codex_usage_monitor_state
where source_key = 'local-codex-app-server';

delete from public.tibo_signals
where tweet_id <> '__atomic_test_keep__';

commit;
