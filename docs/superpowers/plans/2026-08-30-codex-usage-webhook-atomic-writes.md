# Codex Usage Webhook Atomic Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make one Codex Usage Monitor webhook snapshot persist its related observaton, regular event, execution estimate, BANKED estimate, deferred Tibo promotion, and monitor state in one transaction.

**Architecture:** Keep recovery, temporal, Tibo, and BANKED decisions in TypeScript. Build a JSONB webhook write plan from those decisions and apply it through one `SECURITY INVOKER` PostgreSQL RPC. The RPC takes the expected previous state version, locks the source stream, performs all requested writes, and returns an applied/stale result. Cache invalidation remains after a successful RPC only.

**Scope:** Webhook persistence only. Do not change recovery thresholds, classifier semantics, probability models, public DTOs, monitor payloads, or Supabase application data outside the new migration and the webhook's existing writes.

## Task 1: Freeze existing behavior and failure cases

- [ ] Add failing route-level assertions for a single RPC write plan, stale CAS behavior, and no direct webhook write requests.
- [ ] Add a real local-DB integration harness covering commit, rollback, idempotency, stale CAS, and BANKED rollback.
- [ ] Preserve existing route response statuses and query-only lookup behavior.

## Task 2: Add the webhook atomic RPC

- [ ] Add one timestamped migration defining a schema-qualified `SECURITY INVOKER` JSONB RPC.
- [ ] Validate the plan and expected state version, serialize the source stream, perform all optional writes, and let database constraints roll back the transaction on any later failure.
- [ ] Reproduce observation/regular/estimate/BANKED idempotency and metadata union semantics.
- [ ] Revoke PUBLIC/anon/authenticated execution and grant only `service_role` execution.

## Task 3: Switch the webhook to planned RPC writes

- [ ] Introduce a typed plan builder/client helper without moving decision logic into SQL.
- [ ] Replace sequential mutation calls in `app/api/webhook/codex-usage/route.ts` with one RPC call per accepted snapshot path.
- [ ] Move deferred Tibo promotion into the plan and use at most one read/recompute retry after an optimistic-concurrency conflict.
- [ ] Revalidate `radar-data` only after the RPC reports a committed write.

## Task 4: Verify locally and roll out safely

- [ ] Run local Supabase reset twice and the real database integration tests.
- [ ] Run focused tests, full tests, lint, typecheck, build, and `git diff --check`.
- [ ] Commit/push Phase A, deploy/apply and verify the RPC migration, then commit/push Phase B and verify route behavior in CI/Vercel/Production.
