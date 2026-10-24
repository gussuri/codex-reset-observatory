# Future Reply Atomic Review Fixes

## Goal

Close review blockers B1–B4 for Codex future-reply recovery adoption while keeping all work local. No production access, migration application, deployment, push, LLM calls, or classifier CSV changes.

## Plan

1. Extend the forward atomic claim with the complete selected notice proof and validate it against the current locked `tibo_signals` row before adoption. Use a standalone monitor estimate and skip claim creation when the proof changed.
2. Align forward and reverse lock order, and change reverse ambiguity counting to count authoritative recovery observations before checking whether an estimate exists or is available for this notice.
3. Align SQL candidate and locked-row checks with the read-side monitor gate: status, time interval, finite percentage range/drop, reset timestamp advance, exclusions, and exact estimate window/display matching.
4. Add a reproducible isolated local PostgreSQL integration runner that loads the actual v1/v2 write functions, applies the future-reply migration, and exercises stale proof, ambiguity, estimate identity, conflict fallback, and two-session serialization cases.
5. Run focused tests, typecheck, lint, and the isolated PostgreSQL integration. Review all diffs and preserve the protected classifier CSV as untracked.
6. Create a local-only checkpoint commit, then send Sol the display-name lifecycle design and offline regression proposal. Do not push or apply the migration.

## Progress ledger

- [x] Inspect function/table contracts and identify SQL/read-side parity gaps.
- [x] Add failing regression coverage before implementation.
- [x] Implement B1–B3 and update route payload types.
- [x] Add and run the isolated native PostgreSQL integration for B4.
- [x] Run focused verification and self-review.
- [ ] Commit the scoped changes locally; preserve the unrelated classifier CSV.
- [ ] Send the design-only lifecycle proposal to the authorized source thread.

## Verification record

- `pnpm test:future-reply:postgres` on PostgreSQL 17.11 — passed; actual v1/v2 function bodies, proof drift across sessions, reverse-gate cases, identity preservation, conflict fallback, and lock serialization verified.
- `pnpm exec tsx --test tests/codexUsageWebhookRoute.test.ts` — 46 passed, 0 failed.
- `pnpm test` — 2,628 passed, 0 failed.
- `pnpm run lint` — passed.
- `pnpm run typecheck` — passed.
- `git diff --check` — passed.
