# Monitor reset schedule follow-through implementation plan

> Inline test-first implementation and verification memo.

**Goal:** Confirm genuine weekly quota recovery when the provider advances its next-reset timestamp with each observation, while preserving fixed schedules and rejecting unsupported changes.

**Architecture:** Keep recovery confirmation and restoration on one schedule-state model. Candidate state begins ambiguous, then becomes fixed or rolling only when the observations distinguish them. A rolling schedule may transition to fixed after meaningful usage begins only when the prior rolling observation, usage increase, elapsed time, and freeze observation are retained and validated. Persist this evidence in candidate schema v2; continue reading the existing strict-fixed v1 format. Keep webhook protocol v2 and the database schema unchanged.

**Tech Stack:** TypeScript, Node test runner via tsx, pnpm, existing monitor JSONL diagnostic contracts.

**Spec:** User task in this conversation; `docs/codex-usage-monitor.md`; incident evidence at `C:/Users/Yura/.codex/visualizations/2026/10/01/01a0f4fb-964b-74a2-a7ab-1884d0adfa92/monitor-recovery-20261025.json`.

## Global constraints

- Weekly window identity remains limitId=codex and windowDurationMins=10080.
- Candidate start still requires at least a 1 percentage-point usage decrease and 3600 seconds of forward reset-time change.
- Confirmation remains an independent scheduled poll after at least 60000 ms; notifications cannot confirm.
- Comparison gaps over 10 minutes, stale observations, usage reversion, structure changes, and BANKED-count changes retain their existing handling.
- A confirmed recovery queues the first evidence snapshot exactly once with webhook protocol version 2 and postReason=recovery_candidate.
- No database writes, real provider calls, real webhook sends, LLM calls, polling, cron changes, GUI restarts, or deployment.
- Work only in the isolated worktree on `codex/monitor-reset-schedule`; primary and other worktrees remain read-only. Commit locally after verification; hold push and PR for Sol review.

## Schedule-state decisions

- `undetermined` remains while a short interval makes fixed and rolling both plausible. A fixed or rolling state is established only when the observations separate the two patterns.
- `fixed` retains the current ±30-second comparison to first evidence. A proven fixed schedule cannot later switch to rolling.
- `rolling` requires first/current timestamps to remain within ±30 seconds of the 10080-minute window, with reset-time movement matching observed-time movement within ±30 seconds.
- `fixed_after_usage` is allowed only after a rolling state was established, the freeze observation is more than 30 seconds after the last rolling observation, usage increased by at least 1 percentage point, and resetAt stayed within ±30 seconds. Later observations remain within ±30 seconds of that freeze anchor.
- Rolling is a supported interpretation of observed snapshots, not a verified statement about provider internals. The incident has three empty-window observations; behavior after usage begins is a conservative model and must not be described as proven upstream behavior.
- Schema v2 retains schedule mode and transition snapshots. Its loader revalidates all identities, order, comparison gaps, weekly alignment, meaningful usage/reset changes, and the rolling-to-freeze transition. Schema v1 remains readable under its former strict fixed-schedule rule; it does not gain fabricated transition evidence.
- The local Windows shortcut/runtime switch and rollback/queue preservation plan will be reported for review, but no live GUI, shortcut, or monitor is changed here.

## Task 1: Schedule state machine and regression coverage

**Files:** `tools/codex-usage-monitor.ts`, `tools/codex-usage-monitor-recovery-candidate.ts`, `tests/codexUsageMonitor.test.ts`, `tests/codexUsageMonitorDiagnostics.test.ts`.

- [x] Add RED coverage for the incident's 06:09:36 → 06:11:35 → 06:13:35 → 06:15:36 UTC sequence and preserve the first-evidence timestamp.
- [x] Cover fixed-vs-rolling ambiguity with short notifications; fixed schedule at +10s/+20s/+31s/+120s; rolling schedule with varied intervals and jitter; and rejection at ±31 seconds, arbitrary shifts, backwards movement, wrong window duration, or usage reversion.
- [x] Cover rolling → fixed-after-usage, no transition under 30 seconds or <1pp usage increase, fixed → rolling rejection, and confirmation only on poll after 60 seconds.
- [x] Implement shared schedule assessment, use the same result in diagnostics, and retain the original candidate/queue payload contract.

## Task 2: Persistence and queue recovery

**Files:** `tools/codex-usage-monitor-recovery-candidate.ts`, `tests/codexUsageMonitorRecoveryCandidate.test.ts`.

- [x] Add RED coverage for schema-v2 rolling and freeze-transition save/restore, semantic tampering rejection, same-identity/order/gap validation, and v1 fixed-candidate compatibility.
- [x] Extend restart integration coverage to retain a rolling-to-freeze candidate, enqueue the first evidence once, and safely retain/replay one failed webhook through the existing outbox.
- [x] Keep webhook/database schemas unchanged and ensure the candidate file never stores credentials.

## Task 3: Runbook, verification memo, local commit

**Files:** `docs/codex-usage-monitor.md`, this plan.

- [x] Document observed evidence, model limits, state transitions, old/new candidate format compatibility, and rollback/queue preservation guidance.
- [x] Run targeted monitor tests, full `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
- [x] Record RED/GREEN evidence, verification results, self-review, and unverified scope in this memo.
- [ ] Review the full diff and commit locally. Do not push, create a PR, or change the live shortcut/runtime before Sol review.

## Verification memo

### RED evidence

Before implementation, `corepack pnpm exec tsx --test tests/codexUsageMonitor.test.ts` failed the new incident rolling sequence and rolling-to-freeze transition cases because the old evaluator cleared candidates on resetAt movement. The diagnostic regression expected `candidate_confirmation_waiting` but observed `reset_at_reverted`. The short fixed-notification regression passed under the old implementation.

### GREEN evidence

- `corepack pnpm exec tsx --test tests/codexUsageMonitor.test.ts tests/codexUsageMonitorDiagnostics.test.ts tests/codexUsageMonitorRecoveryCandidate.test.ts`: 88 tests passed.
- `corepack pnpm test`: 2,658 tests passed, 0 failed. Existing status-page coverage logged an HTTP 503; tests completed successfully. Existing webhook test logs include expected mocked cache-revalidation warnings.
- `corepack pnpm lint`: passed.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm build`: passed. Static generation used its configured no-credential fallback and logged degraded live data; no production write was made.
- `git diff --check`: passed.

### Self-review and limits

- Candidate schema v2 persists schedule modes and rolling/freeze evidence; the v1 loader retains the old strict fixed timestamp rule and rejects moving v1 candidates without inventing missing observations.
- Confirmation still requires the independent scheduled poll after 60 seconds, the baseline usage decrease remains frozen, and the first-evidence snapshot is queued once in protocol v2. The restart/outbox integration test verifies one failed delivery stays queued and one accepted replay clears it with success diagnostics.
- No webhook/database schema or migration changed. No real monitor poll, webhook delivery, GUI restart, executable/shortcut switch, or deployment occurred. The local update/rollback and queue-preservation procedure is in `docs/codex-usage-monitor.md`.
- The three incident observations all showed 0% usage, with reset offsets 604802.032s, 604802.078s, and 604801.786s. Rolling behavior after usage begins remains a bounded calculation model, not a verified statement about upstream behavior.
- Full review is a self-review; Sol's review is still pending before push, PR, or live update.
