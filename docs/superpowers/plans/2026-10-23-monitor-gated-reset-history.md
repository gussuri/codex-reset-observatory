# Monitor-Gated Reset History Implementation Plan

> **For agentic workers:** Use this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Admit new automatic forced/random reset history only when an authoritative Usage Monitor recovery observation confirms the reset.

**Architecture:** Apply one pure recovery-evidence rule while projecting formal Tibo resets and while materializing usage-observation estimates. Reuse observations and estimates already loaded into `RadarData`; preserve source facts, the monitor-only path, BANKED semantics, and the existing static archive.

**Tech Stack:** TypeScript, Node test runner, pnpm, Supabase-backed history projections.

**Spec:** `docs/reset-history-normalization.md`

## Global Constraints

- Work from PR #163 merge commit `48f2ffbc4486f73798255f5dab450c4869801b77` in the isolated worktree.
- Do not change Production data, perform a migration/backfill, add database reads, or change cron/run/polling behavior.
- Do not modify the primary checkout or its existing dirty files.
- Do not change regular schedule/reference behavior or the BANKED observation/association path.
- Preserve static historical archive records; do not broadly exempt prior AI-confirmed Tibo rows.
- Commit locally after verification; hold push, PR, merge, and deploy for Sol review.

## Review Focus

- Tibo completion without a monitor observation cannot create history or move `lastRandomResetAt`.
- A raw/formal Tibo completion cannot consume an official notice or alter teaser lifecycle independently of canonical monitor-backed history.
- Monitor identity aliases must come from `getTrustedTiboEditIdentity`; the current validated reply-admission proof remains the only reply-path alias source.
- AI confidence, manual confirmation, completion wording, and an adoption ledger do not independently authorize history.
- A missing, stale, rejected, regular, weak, or unknown recovery observation cannot back a public execution estimate.
- A valid monitor observation works whether it arrives before or after a Tibo post, and duplicate deliveries remain one event.
- Exactly the three previously published Oct 13/15/17 announcement-fallback rows remain in the static archive with their existing key, precision, provenance, and localized presentation; no general AI-only legacy exception is added.
- BANKED/regular events retain their existing authority and identity.

---

### Task 1: Pin the Day 18 monitor gate

**Files:**
- Create: `tests/fixtures/tiboDay18MonitorGate.ts`
- Modify: `tests/tiboFormalHistory.test.ts`
- Modify: `tests/noticeBackedRecoveryConfirmation.test.ts`
- Modify: `tests/tiboCanonicalHistoryIdentity.test.ts`

- [x] Add the exact Day 18 parent/direct-reply IDs and source facts as a named fixture.
- [x] Add failing tests for no-monitor history/boundary suppression, insufficient AI/manual/adoption evidence, and estimate-with-missing-observation rejection.
- [x] Add passing-contract tests for a strong unexpected observation, input-order changes, duplicate delivery, and static archive preservation.
- [x] Run focused tests and confirm the new assertions fail on the current behavior.

### Task 2: Enforce authoritative monitor evidence

**Files:**
- Modify: `lib/radar/tiboHistory.ts`
- Modify: `lib/radar/resetExecution.ts` only if the focused tests show validation is missing at its shared boundary.

- [x] Require a strong, unexpected, non-rejected observation with an increasing observation interval, linked by the canonical Tibo alias or a public estimate's observation ID and source IDs.
- [x] Gate only new dynamic Tibo completed-history materialization; let existing static records and existing monitor-backed events remain canonical.
- [x] Require the referenced observation to exist and validate before a public estimate can produce a completed history event.
- [x] Keep monitor-only reset events eligible and leave BANKED and regular paths unchanged.

### Task 3: Record the contract and verify

**Files:**
- Modify: `docs/reset-history-normalization.md`
- Modify: `data/resetHistory.ts`
- Modify: `lib/radar/probability.ts`
- Modify: `lib/radar/tiboHistory.ts`
- Modify: `lib/radar.ts`
- Modify: `lib/radar/types.ts`
- Modify: `tests/officialNoticeConsumptionBoundary.test.ts`
- Modify: `tests/tiboCanonicalHistoryIdentity.test.ts`
- Modify: `tests/tiboFormalHistory.test.ts`

- [x] Document evidence requirements, read-side/order invariance, and the precise three-row legacy archive boundary.
- [x] Address Sol review finding 1: remove raw formal-signal cutoffs from official-notice consumption and teaser lifecycle.
- [x] Address Sol review finding 2: validate edit aliases through the trusted edit-identity helper while retaining validated reply proof aliases.
- [x] Address Sol review finding 3: freeze only the three previously published announcement-fallback rows with exact keys and provenance.
- [x] Run focused tests, full `pnpm test`, lint, typecheck, production build, and `git diff --check` on the final diff.
- [x] Review the complete diff and commit locally; leave remote publication and deployment for Sol review.
