# Tibo Communication Regime Shadow Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, reproducible research pipeline that classifies eligible random reset history into formal notice, teaser, and silent communication types and evaluates whether prior communication information adds out-of-sample signal without changing Production behavior.

**Architecture:** A pure research helper owns communication normalization, provenance, point-in-time filtering, coverage-aware exposure, and seeded resampling. A standalone script loads current Supabase data read-only, rebuilds the canonical combined history through existing production helpers, produces scratch CSV/JSON/Markdown reports, and runs prequential shadow comparisons. No Production module imports the research helper and no public DTO/database write path is touched.

**Tech Stack:** TypeScript, Node `tsx`, existing `@supabase/supabase-js` read-only client, existing reset eligibility/history/probability helpers, Node test runner.

## Global Constraints

- Productionのpublished probability、expectation、UI、public API/DTO、DB schema、Gemini prompt、Tibo分類、安全ガードは変更しない。
- Supabaseはread-only queryだけを使う。書き込み、backfill、既存行の更新は行わない。
- 対象イベントは既存の`isEligibleRandomResetEvent`で選び、regular、narrow、future、duplicate、rejectedは除外する。
- static historyとdynamic DB dataは既存の`combineResetHistory`に通し、Productionと同じdedupe・notice-backed recovery処理を使う。
- observed signalsとlegacy historyのprovenanceを保持し、signal coverage不足だけでhistorical eventをsilentへ再分類しない。
- non-reset exposureの分母はcoverage confirmedの時間binだけに限定し、coverage不明・scan failure期間はsilent exposureへ入れない。
- Production validity policyをprimaryに再利用し、研究用confidence cutoffはsensitivity analysisとして別集計する。
- prequential/rolling point-in-time評価を主評価とし、LOOは構造安定性の補助診断と明記する。LOOをprospective/OOSとは呼ばない。
- 研究成果物は`scratch/communication-regime-study/`に出力し、production dataへ書き戻さない。

---

### Task 1: Add the pure communication-regime research helper

**Files:**
- Create: `lib/radar/communicationRegime.ts`
- Test: `tests/communicationRegime.test.ts`

**Interfaces:**
- Consumes: `WindowEventLike`, `ActiveTiboSignal`-shaped signals, `isEligibleRandomResetEvent`.
- Produces: `CommunicationType`, `CommunicationProvenance`, `CommunicationSignalInput`, `CommunicationEventInput`, `classifyCommunicationEvent`, `projectSignalsToOrigin`, `buildRollingCommunicationRegime`, `seededPermutation`.

- [ ] **Step 1: Write failing tests for normalization and provenance**

Create fixtures with one completed broad random event and signals before/after it. Assert that an observed formal notice wins over an observed teaser, a pre-reset teaser is selected when no formal notice exists, and a post-reset `reset_executed` signal produces no pre-signal.

```ts
const result = classifyCommunicationEvent(event, [formal, teaser, afterReset], {
  previousRandomResetAt: previous,
  availableAt: event.completedAt,
});
assert.equal(result.primaryType, "formal_notice");
assert.equal(result.provenance, "observed_signal");
assert.deepEqual(result.observedSignalIds, [formal.tweetId]);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run `corepack pnpm exec tsx --test tests/communicationRegime.test.ts`. It must fail because the helper exports do not exist yet.

- [ ] **Step 3: Implement typed normalization and point-in-time filtering**

Define:

```ts
export type CommunicationType = "formal_notice" | "teaser" | "silent";
export type CommunicationProvenance = "observed_signal" | "legacy_history";
export type CommunicationSignalInput = {
  tweetId: string;
  signalType: string;
  tweetCreatedAt: string;
  availableAt: string | null;
  confidence: number | null;
  verificationStatus: string | null;
  isReply: boolean;
};
```

Use `availableAt = detected_at ?? tweet_created_at` for origin projection. A signal is pre-reset only when its tweet time is strictly after the previous random reset and strictly before the event completed time. Exclude rejected and replies. Do not hard-code a new primary threshold; accept a `SignalValidityPolicy` callback from the script, with a default policy that mirrors the current Production notice/teaser validity checks. Keep threshold-based sensitivity as a separate explicit callback.

- [ ] **Step 4: Implement legacy fallback and timestamp audit**

Map only known `details.noticeType` values to legacy labels. If there is no reliable observed coverage for the event, return the legacy label with `provenance: "legacy_history"`. When observed and legacy labels both exist, keep observed primary and record `legacyAgreement` as `true` or `false`. Expose `legacySignalAt` only when the event's `opened_at` is explicitly marked as a pre-reset communication time by the caller; otherwise return null and never calculate signal-to-execution duration.

- [ ] **Step 5: Implement rolling regimes and seeded permutation**

`buildRollingCommunicationRegime(events, index, definition)` must use only rows with index lower than the current event. Support last-3 majority, last-5 majority, and EWMA shares. Implement a deterministic 32-bit seeded PRNG and Fisher-Yates permutation so 100,000 permutation runs are reproducible without depending on global randomness.

- [ ] **Step 6: Run focused tests and commit the helper**

Run `corepack pnpm exec tsx --test tests/communicationRegime.test.ts`; expected result is all focused tests passing. Commit with `git add lib/radar/communicationRegime.ts tests/communicationRegime.test.ts && git commit -m "research: add communication regime helper"`.

### Task 2: Load point-in-time research inputs read-only

**Files:**
- Create: `scripts/analyze-tibo-communication-regime.ts`
- Modify only if needed: `scripts/evaluateProspectiveProbabilityForecasts.ts` (reuse exported read-only loaders; do not change their behavior)

**Interfaces:**
- Consumes: `.env.local`, Supabase service role environment, `LOCAL_RESET_HISTORY`, `combineResetHistory`, `getNoticeBackedHistoryInputs`, and Task 1 helper.
- Produces: an internal `ResearchSnapshot` with raw source counts, canonical history, signal availability audit, regular boundaries, and coverage intervals.

- [ ] **Step 1: Add a read-only loader with explicit selected columns**

Load `.env.local` without printing values. Query:

```text
tibo_signals: tweet_id,text,tweet_url,tweet_created_at,detected_at,expires_at,signal_type,confidence,verification_status,is_reply,source_timeline,ai_teaser_strength
regular_reset_events: schedule_key,window_start_at,window_end_at,representative_at,scheduled_at,completed_at,cycle_type,reset_method,scope,record_kind,status,correction_reason,corrected_at
codex_recovery_observations: id,source_key,observed_at,previous_observed_at,cycle_hint,confidence,status,matched_tibo_tweet_id,confirmed_at,created_at,updated_at
reset_execution_estimates: existing EXECUTION_ESTIMATE_COLUMNS
tibo_heartbeat: existing monitor health fields required to identify parse/scan coverage
```

On query failure, record a source-specific degraded state and continue only if the missing source does not make the requested metric valid. Never substitute an empty failed query for confirmed no data.

- [ ] **Step 2: Build canonical combined history**

Convert accepted reset signals with the existing `isFormalTiboResetSignal`/association path, convert official notices using `getNoticeBackedHistoryInputs`, and call:

```ts
combineResetHistory(
  LOCAL_RESET_HISTORY,
  formalResets,
  rejectedResets,
  regularRows,
  noticeSignals,
  recoveryObservations,
  executionEstimates,
)
```

Filter the combined result with `getCompletedResetAt` and `isEligibleRandomResetEvent(item, completedAt, asOfMs)`. Keep the dedupe audit IDs and record kinds in the report. Assert that regular rows never enter the random event list.

- [ ] **Step 3: Build coverage intervals without treating missing signals as silent**

Normalize heartbeat rows into `coverage_confirmed`, `coverage_unknown`, and `scan_failure` intervals. A bin is confirmed only when the heartbeat indicates a valid recent parse/scan and no failure state covers the bin. Use the existing 10-minute monitor cadence and health age constants only as an audit interpretation; do not change monitor code. Store the coverage policy, source rows, confirmed intervals, excluded intervals, and interval gaps in the report.

- [ ] **Step 4: Run loader tests with mocked rows**

Add pure test cases for a failed heartbeat query, a confirmed interval with no signal, and a coverage gap. Confirm that the former can be reported as degraded and the latter two are not silently counted as equal `silent` exposure.

### Task 3: Implement exploratory metrics and report writers

**Files:**
- Modify: `scripts/analyze-tibo-communication-regime.ts`
- Create: `tests/communicationRegimeAnalysis.test.ts` only if pure metric functions are not conveniently tested in Task 1

**Interfaces:**
- Consumes: `ResearchSnapshot`, `CommunicationEvent[]`, coverage intervals.
- Produces: JSON/CSV/Markdown files under `scratch/communication-regime-study/`.

- [ ] **Step 1: Add event dataset and chronological/transition summaries**

For every eligible event emit ID, completedAt, recordKind, communication type/provenance, raw noticeType, reasonType, resetMethod, scope, previous random reset, elapsed hours, JST/Pacific local hour, signal IDs, signal timestamps, signal-to-execution hours when timestamp semantics are confirmed, and source URL. Generate type counts/shares, sequence, runs, same-type adjacency, longest run, and a 3x3 transition table with row probabilities.

- [ ] **Step 2: Add 100,000-seed permutation metrics**

Use a fixed seed recorded in `permutation.json`. Preserve type counts and shuffle only event order. Calculate empirical p-values as `(1 + exceedances) / (permutations + 1)` for same-type adjacency, formal↔teaser direct transitions, longest run, and transition entropy. Mark the family as exploratory and do not select a threshold from these results.

- [ ] **Step 3: Add elapsed, reason, time, and timing summaries**

Compute mean/median/min/max/Q1/Q3 for elapsed and signal-to-execution only where timestamps are semantically valid. Add `<=72h` tables, Fisher/exact permutation results, risk ratio/odds ratio with explicit zero-cell handling, reasonType cross tables, JST/Pacific local-hour tables, AM/PM and 10:00/12:00 splits, and event-level rows instead of circular normal approximations.

- [ ] **Step 4: Add period confounding and Markov diagnostics**

Report event-index/date sequence plots/tables and candidate change points without using a post-hoc split as a predictive feature. Compare Laplace-smoothed global-share and first-order transition models with prequential log loss, multiclass Brier-like score, and accuracy. Any LOO result must be nested under `diagnosticOnly` and labeled non-prospective if future events influence its fit.

### Task 4: Add coverage-aware exposure and shadow-only predictive replay

**Files:**
- Modify: `scripts/analyze-tibo-communication-regime.ts`
- Create or modify: `lib/radar/communicationRegime.ts` only for pure replay helpers
- Test: `tests/communicationRegimeAnalysis.test.ts`

**Interfaces:**
- Consumes: point-in-time `ResearchSnapshot`, event labels available before each origin, coverage intervals, `calculateRegimeElapsedProbability` with `PUBLISHED_ELAPSED_MODEL_OPTIONS`.
- Produces: `shadow-evaluation.json` and a report section that never changes published forecasts.

- [ ] **Step 1: Define coverage-confirmed non-reset origins**

Create daily or 12-hour candidate origins only within confirmed coverage intervals. Exclude bins with coverage unknown, parse stale/missing, scan error, or page reload failure. For each eligible origin, project signals with `availableAt <= origin`, project random/regular history with completed time `<= origin`, and keep current communication state separate from future event labels.

- [ ] **Step 2: Define four feature sets**

Evaluate:

```text
A elapsed-only baseline
B elapsed + current signal state
C elapsed + prior communication regime
D elapsed + current signal + prior regime
```

Use the existing frozen elapsed-only model for A. B/C/D may be simple research-only calibrated adjustments or empirical state-conditioned rates, but they must be fit only on rows preceding the origin, never use the current event's eventual label, and return `insufficient_data` when the support floor is not met. Do not name any research model as the published model.

- [ ] **Step 3: Compute primary and diagnostic metrics**

For 24h/48h outcomes, report resolved count, positive count/rate, mean prediction, Brier, log loss, calibration bins, and a discrimination supplement. Primary results are rolling/prequential. Add leave-one-event-out only as `diagnosticOnly`; explicitly state it is not prospective/OOS if fit data includes events after an origin. Add bootstrap or permutation uncertainty where support permits.

- [ ] **Step 4: Add recent high-confidence subset and leakage audit**

Report the recent period separately when both signal and coverage provenance are high. Emit a leakage audit for every origin showing max event completion used, max signal availability used, current signal IDs, prior regime event IDs, and whether any future label entered the feature set. Tests must fail if an origin sees its own event or a later signal.

### Task 5: Add report generation and focused regression tests

**Files:**
- Modify: `scripts/analyze-tibo-communication-regime.ts`
- Test: `tests/communicationRegime.test.ts`, `tests/communicationRegimeAnalysis.test.ts`

- [ ] **Step 1: Write report schema tests**

Assert the report contains `communicationRegimeStudyVersion`, `generatedAt`, `asOf`, `sourceAsOf`, `backfilled: false`, source health, type provenance, coverage policy, event count, transition/permutation summaries, shadow evaluation mode, primary-vs-diagnostic labels, and Production invariants.

- [ ] **Step 2: Write Markdown tables and visual-friendly strips**

Include a chronological communication strip, transition matrix, elapsed-by-type table, signal timing table, execution-hour table, reasonType cross table, rolling regime candidates, and shadow Brier comparison. Keep raw text out of the report unless needed for audit; do not publish secrets or internal API values.

- [ ] **Step 3: Run the pure test suite**

Run `corepack pnpm exec tsx --test tests/communicationRegime.test.ts tests/communicationRegimeAnalysis.test.ts`. Fix only research files and tests if failures occur.

### Task 6: Run the live study and deliver

**Files:**
- Create at runtime only: `scratch/communication-regime-study/*`

- [ ] **Step 1: Run the read-only live analysis**

Run `corepack pnpm exec tsx scripts/analyze-tibo-communication-regime.ts --output-dir scratch/communication-regime-study`. Confirm output includes 8/11 and 8/13 dynamic events and source health is not silently treated as empty.

- [ ] **Step 2: Review report validity**

Check that legacy events retain `legacy_history` provenance, observed/legacy disagreements are listed, coverage-unknown bins are excluded from exposure, `prequential` is primary, LOO is diagnostic-only, and any insufficient-data result is explicit.

- [ ] **Step 3: Run full verification**

Run:

```text
corepack pnpm test
corepack pnpm run check
corepack pnpm run build
git diff --check
```

Also run a read-only Production API smoke check and verify published probability/model response behavior is unchanged. Never write Supabase rows.

- [ ] **Step 4: Commit and push**

Review `git diff --stat`, stage only the helper, script, tests, spec, and plan, then commit with `research: analyze Tibo communication regimes`. Push `main`, wait for CI success, and confirm `HEAD == origin/main` and a clean working tree.

