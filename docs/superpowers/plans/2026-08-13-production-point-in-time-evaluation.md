# Production Point-in-Time Evaluation Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the regime-elapsed evaluation use the same normalized dynamic RadarData as Production while projecting every source to the information available at each historical origin.

**Architecture:** Keep the Production probability calculation and public API unchanged. Add an uncached path through the existing Production data normalization, pass its RadarData into a pure evaluator, and extend the existing point-in-time projection to include recent signals, execution estimates, recovery observations, and regular-event correction availability. The canonical CLI must fail explicitly when the Production-like source is unavailable; offline fixtures remain available only to unit tests.

**Tech Stack:** TypeScript, Next.js RadarData types, Supabase server client, Node test runner via `tsx`, existing shadow probability and recovery-boundary helpers.

## Global Constraints

- Do not change `hazard-elapsed-v1`, `hazard-regime-elapsed-v1`, model parameters, public probability semantics, DB rows, public API schema, UI, or logging.
- Do not backfill or reuse future Supabase state for a historical origin.
- Availability must use source-specific timestamps such as `detectedAt`, `createdAt`, `observedAt`, `confirmedAt`, `updatedAt`, and `displayExecutionAt`.
- Canonical reports use `inputMode=production-point-in-time`; missing Supabase/configuration must fail instead of silently using `LOCAL_RESET_HISTORY` only.
- Preserve static `LOCAL_RESET_HISTORY` and existing dedupe semantics, including the 8/1 dynamic/static identity merge.

---

### Task 1: Share the Production-normalized raw RadarData path

**Files:**
- Modify: `lib/radarFetch.ts`
- Modify: `scripts/evaluateRegimeElapsedProbability.ts`
- Test: `tests/regimeElapsedEvaluation.test.ts`

**Interfaces:**
- `fetchCurrentRadarData({ calculationNow, cache, bypassCache })` continues to serve the Production path; `bypassCache: true` selects the existing raw fetchers without Next Data Cache wrappers.
- The evaluator accepts `RadarData` as an explicit source input instead of constructing a static-only source internally.

- [ ] **Step 1: Add a failing source-injection test**

  Build a small `RadarData` fixture with one dynamic formal signal and assert the evaluator receives it through its explicit source argument rather than silently replacing it with `LOCAL_RESET_HISTORY`.

- [ ] **Step 2: Run the focused test and confirm the expected API failure**

  Run `corepack pnpm exec tsx --test tests/regimeElapsedEvaluation.test.ts` and confirm the failure is caused by the missing injectable evaluator/uncached source behavior.

- [ ] **Step 3: Add the uncached Production fetch switch**

  Add an internal `bypassCache?: boolean` option to `fetchCurrentRadarData`. When true, call the existing raw Tibo, regular reset, recovery observation, execution estimate, and display-name readers directly while retaining the current cached wrappers for normal Production requests. Keep the same row normalization and `getLocalRadarData` assembly.

- [ ] **Step 4: Make the evaluator source-injectable**

  Change the pure evaluation function to consume `RadarData` plus `asOf`, and add an async CLI loader that calls `fetchCurrentRadarData({ cache: "no-store", bypassCache: true, calculationNow: asOf })`. Do not add a static fallback to the CLI path.

- [ ] **Step 5: Run the focused test and verify it passes**

  Run `corepack pnpm exec tsx --test tests/regimeElapsedEvaluation.test.ts` and confirm the injected dynamic event affects the evaluated source.

### Task 2: Complete point-in-time availability projection

**Files:**
- Modify: `lib/radar/prequentialCalibration.ts`
- Test: `tests/regimeElapsedEvaluation.test.ts`

**Interfaces:**
- Export small pure projection helpers for `ResetExecutionEstimate`, `CodexRecoveryObservation`, and `RegularResetEventRow` where unit tests need direct coverage.
- `getPointInTimeRadarData(data, origin)` returns a RadarData snapshot with only origin-available values and no current derived `codex_usage_recovery` object.

- [ ] **Step 1: Add failing leakage tests**

  Cover: estimate created after origin is excluded even when its display time is past; estimate created and completed before origin is included; future recovery observation is excluded; future confirmation/match is not projected as confirmed; future Tibo and regular events are excluded; adding a future estimate cannot change an old-origin prediction.

- [ ] **Step 2: Implement estimate projection**

  Require `createdAt <= origin`; require `updatedAt <= origin` when carrying the persisted state; require `displayExecutionAt <= origin` before it can form a completed boundary; conservatively omit unreconstructable future-updated/manual state. Preserve the exact normalized `ResetExecutionEstimate` shape.

- [ ] **Step 3: Implement recovery observation projection**

  Require `createdAt` and `observedAt` at or before origin. If confirmation or matching was only known after origin, retain only the observed state with `status: "observed"`, `confirmedAt: null`, and `matchedTiboTweetId: null`; never copy the current singular derived recovery object.

- [ ] **Step 4: Project all dynamic collections**

  Project `active_tibo_signals`, `recent_tibo_signals`, `formal_tibo_resets`, `rejected_tibo_resets`, `regular_reset_events`, `reset_execution_estimates`, and `codex_recovery_observations` using their relevant availability timestamps. Exclude future corrections/voids when their correction timestamp is after origin.

- [ ] **Step 5: Run focused leakage tests**

  Run `corepack pnpm exec tsx --test tests/regimeElapsedEvaluation.test.ts` and verify every case fails before the projection change and passes after it.

### Task 3: Canonical production-point-in-time report metadata and safety

**Files:**
- Modify: `scripts/evaluateRegimeElapsedProbability.ts`
- Modify: `reports/probability-model-evaluation-regime-elapsed-v1.json`
- Modify: `reports/probability-model-evaluation-regime-elapsed-v1.md`
- Modify: `reports/reset-regime-analysis.json`
- Modify: `reports/reset-regime-analysis.md`

**Interfaces:**
- Canonical evaluation metadata includes `inputMode: "production-point-in-time"`, `sourceAsOf`, `futureLeakagePolicyVersion`, and `backfilled: false`.
- Report schema is versioned if required; existing metrics and model settings remain unchanged.

- [ ] **Step 1: Add failing metadata tests**

  Assert an injected fixture report records production-point-in-time mode, source timestamp, leakage policy, and `backfilled: false`; assert the canonical loader rejects missing/degraded Production source instead of writing a static-only report.

- [ ] **Step 2: Implement metadata and explicit CLI failure**

  Add metadata to JSON/Markdown output, include the input mode in the report header, and make the async CLI throw a clear error when required Supabase/Production source health is not `ok`. Keep pure fixture evaluation usable from tests without network access.

- [ ] **Step 3: Run report unit tests**

  Run `corepack pnpm exec tsx --test tests/regimeElapsedEvaluation.test.ts` and verify metadata and failure behavior.

### Task 4: Fixed-origin Production parity fixture and regression coverage

**Files:**
- Create: `tests/fixtures/productionPointInTimeRadarData.ts`
- Modify: `tests/regimeElapsedEvaluation.test.ts`
- Modify: `scripts/evaluateRegimeElapsedProbability.ts`

**Interfaces:**
- The fixture represents the 2026-08-13T06:20:00Z availability state with dynamic 8/8, 8/11, and 8/13 records plus `LOCAL_RESET_HISTORY`, without querying Supabase.

- [ ] **Step 1: Add the failing parity assertions**

  Assert boundary counts 26 random, 5 regular, 30 recovery; latest random/recovery `2026-08-13T03:34:43.341Z`; full regime multiplier near `1.628`; full 24h/48h near `0.3300`/`0.6599`; elapsed-only is calculated from the same source. Assert 8/1 static/dynamic identity dedupes to one event.

- [ ] **Step 2: Implement the fixture and parity audit output**

  Add only the normalized fields needed by the existing production history combiner and model. Emit boundary IDs and diagnostics in the evaluation report so the source can be audited without changing public DTOs.

- [ ] **Step 3: Run focused parity tests**

  Run `corepack pnpm exec tsx --test tests/regimeElapsedEvaluation.test.ts` and verify the fixture reproduces the audit values within floating-point tolerance.

### Task 5: Live evaluation, regression checks, and publication

**Files:**
- Modify: `reports/probability-model-evaluation-regime-elapsed-v1.json`
- Modify: `reports/probability-model-evaluation-regime-elapsed-v1.md`
- Modify: `reports/reset-regime-analysis.json`
- Modify: `reports/reset-regime-analysis.md`

- [ ] **Step 1: Run the canonical fixed-origin evaluation**

  Run `corepack pnpm run evaluate:regime-elapsed -- --as-of 2026-08-13T06:20:00.000Z` with the existing environment. Confirm it uses `production-point-in-time`, not offline fallback, and record the parity diagnostics.

- [ ] **Step 2: Check post-cutover logging read-only**

  Query `prediction_history` after `2026-08-13T07:19:01Z`. If no row exists, report `まだ未保存`; if one exists naturally, validate both shadow payloads without creating or updating rows.

- [ ] **Step 3: Run public regression checks**

  Compare `/api/current` values before/after the code change using the same read-only request path. Confirm 24h/48h, latest reset, notice, history, and data health are unchanged.

- [ ] **Step 4: Run complete verification**

  Run `corepack pnpm test`, `corepack pnpm run check`, `corepack pnpm run build`, and `git diff --check`. Confirm skip/todo are zero.

- [ ] **Step 5: Commit and push**

  Commit with `fix: align point-in-time evaluation with production data`, push `main`, wait for GitHub Actions, and confirm `HEAD == origin/main` with a clean working tree.
