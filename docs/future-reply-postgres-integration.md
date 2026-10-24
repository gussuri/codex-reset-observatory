# Future reply PostgreSQL integration

This regression uses a temporary, isolated PostgreSQL 17 cluster on loopback. It loads the actual `apply_codex_usage_webhook_write_v2` and `apply_codex_usage_webhook_write` function bodies from `20261008102302_separate_banked_observations_and_associations.sql`, applies `20261024100000_add_codex_future_reply_claim_guard.sql`, then runs the SQL assertions in `tests/integration/codexFutureReplyAtomic.assertions.sql`. The v2 function is not stubbed.

## Run

Install or unpack PostgreSQL 17 locally, then set `POSTGRES_BIN` to its `bin` directory. No Supabase project, network database, or credentials are used.

PowerShell:

```powershell
$env:POSTGRES_BIN = 'C:\path\to\postgresql-17\bin'
pnpm test:future-reply:postgres
```

The runner initializes a temporary cluster with trust authentication, binds only to `127.0.0.1`, loads the minimal schema in `tests/integration/codexFutureReplyAtomic.schema.sql`, and removes the cluster when it exits. It fails if the configured `pg_ctl` is not PostgreSQL 17.

## Coverage

- Separate PostgreSQL sessions read a reply, then reject or edit it, then send the stale proof to the forward RPC. The RPC detects both mutations under a row lock and writes the recovery as a standalone estimate without adding a notice claim.
- Valid reply adoption writes the estimate through actual v2/v1 functions and preserves its database estimate identity during a subsequent update.
- Reusing a claimed event key for a different reply falls back to a standalone estimate and preserves the original claim.
- Reverse reconciliation counts two authoritative observations even when one is assigned to another reply or one observation has no estimate.
- Reverse reconciliation rejects out-of-range or non-finite usage percentages, a usage drop under one percentage point, non-positive reset times, a reset advance under one hour, a non-exact estimate window or display time, and the manual observation exclusion. A single valid observation with an exact estimate still links.
- Two PostgreSQL sessions verify that actual v2 locks an immutable observation through the monitor-state advisory lock, waits while another transaction owns it, then persists the fact after the competing transaction releases it.

## Last local run

- PostgreSQL 17.11
- `pnpm test:future-reply:postgres` — passed; SQL assertions and two-session serialization completed.
- `pnpm exec tsx --test tests/codexUsageWebhookRoute.test.ts` — 46 passed, 0 failed.
