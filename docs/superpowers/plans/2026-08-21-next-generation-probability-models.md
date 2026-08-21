# Next-Generation Probability Shadows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement two prospective-only shadow probability models—B (`hazard-regime-random-continuous-calibrated-v1`) for explainable forecasting and A (`hazard-ensemble-logit-stack-v1`) for accuracy-first stacking—without changing the current published model or public API/UI.

**Architecture:** Reuse the existing random-continuous hazard, random/recovery boundary, signal, and prospective-evaluation infrastructure, but introduce version-frozen B configuration and a shared prospective training-row layer with strict horizon resolution. B applies future-only intercept calibration to stored raw forecasts and the existing official-notice timing policy once; A consumes five exact-version component forecasts and fits a deterministic, strongly regularized simplex-constrained logit ensemble. A/B forecasts are generated only in the logging path, persisted under `prediction_history.debug_info.experimentalProbabilityForecasts`, and compared prospectively against the actually saved current-public forecast.

**Tech Stack:** Next.js 15.5.21, TypeScript 5.5, React 18, Node `node:test` via `tsx --test`, Supabase `@supabase/supabase-js` 2.108, Vercel Serverless logging route, pnpm 11.18.0.

**Spec:** `docs/superpowers/specs/2026-08-21-next-generation-probability-models-design.md`

## Global Constraints

- Published model stays `hazard-odds-v4-logit-calibrated-prequential-v3`; do not change `PUBLISHED_PROBABILITY_MODEL_VERSION` or the selection/fallback chain in `calculatePublishedProbability`.
- B model version is exactly `hazard-regime-random-continuous-calibrated-v1`.
- A model version is exactly `hazard-ensemble-logit-stack-v1`.
- A/B preregistration boundary is exactly `2026-08-21T03:27:00.000Z`; no pre-freeze backfill, regeneration, or relabeling.
- A/B target positives are completed broad-scope eligible random resets only. Regular resets never reset the B random clock and never censor A/B training/evaluation labels.
- A/B row resolution is time-based only: 24h rows require `origin + 24h <= cutoff`, 48h rows require `origin + 48h <= cutoff`, even if a positive reset happened earlier.
- B continuous-hazard v1 values are frozen: Gaussian kernel, bandwidth 24h, exposure grid 1h, truncation ±72h, local prior exposure 2d, local prior window 48h, integration step 10m, global prior 1 event / 10d, daily floor 1%, daily cap 35%.
- B regime v1 values are frozen: half-life 3d, ratio exponent 1, multiplier clamp 0.5–2.0, prior event count 1, prior exposure 2d.
- B ordinary signal values/caps are the exact values recorded in the spec; future changes to shared config must not silently mutate B v1.
- B calibration: intercept-only MAP logit calibration, separate 24h/48h alpha, minimum 10 resolved daily-first samples, alpha prior SD 0.5, fit only saved B raw forecasts after freeze.
- A components are exact versions: calibrated public v3, B v1, `hazard-regime-elapsed-v1`, `hazard-regime-random-elapsed-v1`, `hazard-odds-v3-recency-bayes-h30-r3`.
- A component logit epsilon is exactly `1e-4`; clamp components to `[1e-4, 1 - 1e-4]` before logit.
- A cold start below 10 resolved daily-first samples uses weights `(0.2,0.2,0.2,0.2,0.2)` and alpha `0` independently for 24h/48h.
- A fit objective is exactly the penalized logistic objective from the spec with alpha prior SD 0.5 and weight-prior SD 0.15 around equal weights.
- A solver is deterministic PGD with Euclidean simplex projection, max 200 iterations, tolerance `1e-7`, line-search start 1.0, factor 0.5, max 20 backtracking steps.
- If B is missing/invalid, A is skipped. If any A component is missing/invalid/version-mismatched, or either horizon solver fails, A is skipped. Do not create a different fallback definition of A.
- A/B horizon coherence uses the current calibrated-model policy: clamp to [0,1], if `p48 < p24`, set `p48 = p24`; preserve `p24`; save an adjustment audit flag.
- A never applies an extra official-notice override; it consumes each component's already-final stored probability.
- No DB schema change, no new public DTO field, no public UI changes, no Gemini/Tibo classification changes.
- Additional DB reads are allowed only in the probability logging path; public dashboard/API request paths must not incur A/B training reads or solver CPU.
- Preserve `prediction_history` immutable/first-writer-wins behavior.
- Every implementation task uses TDD: add failing focused tests, verify failure, implement minimum behavior, rerun focused/regression tests, then commit.

---

## File Structure

The implementation should keep responsibilities separated as follows.

- `data/shadowProbabilityConfig.ts`: version strings, freeze boundary/policy, exact B frozen constants, exact A components/epsilon/solver/regularization constants.
- `lib/radar/nextGenerationProbabilityTraining.ts` (new): parse/validate stored experimental forecasts, filter post-freeze rows, strict 24h/48h resolution, JST daily-first selection, random-reset-only outcome labels, resolved training-example builders. No Supabase I/O.
- `lib/radar/shadowProbability.ts`: allow a caller-supplied immutable signal-multiplier configuration/caps while preserving existing default behavior byte-for-byte for existing callers.
- `lib/radar/regimeElapsedProbability.ts`: allow model-specific prior/regime/signal settings to flow through a calculation and expose/reuse the official-notice timing application as a pure helper rather than duplicating the policy.
- `lib/radar/randomContinuousProbability.ts`: allow model-specific frozen continuous-hazard constants; preserve existing `calculateRandomContinuousProbability()` defaults for the old shadow.
- `lib/radar/calibratedRandomContinuousProbability.ts` (new): Model B wrapper, future-only saved-raw calibration, horizon coherence, one-time official-notice timing policy, B audit result.
- `lib/radar/probabilityEnsemble.ts` (new): simplex projection, deterministic PGD, A component validation, 24h/48h fitting, cold-start handling, horizon coherence, A audit result. No I/O.
- `lib/radar/nextGenerationProbabilityHistory.ts` (new): logging-only Supabase adapter to load post-freeze `prediction_history` rows and normalize them to `ProspectiveForecastRow`-compatible records.
- `lib/logProbability.ts`: extend internal forecast serialization with B/A audit fields; keep existing forecasts unchanged.
- `app/api/log-probability/route.ts`: load training history once, build current ordinary experimental forecasts, then B, then A, then persist one immutable row.
- `lib/radar/prospectiveNextGenerationModelEvaluation.ts` (new): three-way Current Public / A / B prospective evaluator with strict resolution and random-only labels.
- `scripts/evaluateNextGenerationModelsProspectively.ts` (new): read rows/events, render JSON/Markdown report.
- `package.json`: add one evaluation script.
- Focused tests: new `tests/nextGenerationProbabilityTraining.test.ts`, `tests/calibratedRandomContinuousProbability.test.ts`, `tests/probabilityEnsemble.test.ts`, `tests/nextGenerationProbabilityHistory.test.ts`, `tests/prospectiveNextGenerationModelEvaluation.test.ts`; modify persistence/regression tests where integration behavior changes.

---

### Task 1: Preregister constants and strict prospective training primitives

**Files:**
- Modify: `data/shadowProbabilityConfig.ts`
- Create: `lib/radar/nextGenerationProbabilityTraining.ts`
- Create: `tests/nextGenerationProbabilityTraining.test.ts`

**Interfaces:**
- Produces constants:
  - `EXPLAINABLE_RANDOM_CONTINUOUS_MODEL_VERSION`
  - `ACCURACY_ENSEMBLE_MODEL_VERSION`
  - `NEXT_GENERATION_MODEL_FREEZE_AT`
  - `NEXT_GENERATION_MODEL_FREEZE_POLICY`
  - `NEXT_GENERATION_TARGET_DEFINITION`
  - `NEXT_GENERATION_B_FROZEN_CONFIG`
  - `NEXT_GENERATION_A_COMPONENT_MODEL_VERSIONS`
  - `A_COMPONENT_LOGIT_EPSILON`
  - `A_ENSEMBLE_MIN_TRAINING_SAMPLES`
  - `A_ENSEMBLE_ALPHA_PRIOR_SD`
  - `A_ENSEMBLE_WEIGHT_PRIOR_SD`
  - `A_ENSEMBLE_SOLVER_CONFIG`
- Produces pure helpers:

```ts
export type NextGenerationStoredForecast = {
  modelVersion: string;
  generatedAt: string;
  probability24h: number;
  probability48h: number;
  rawProbability24h?: number;
  rawProbability48h?: number;
  [key: string]: unknown;
};

export type NextGenerationForecastRow = {
  loggedHour?: string | null;
  generatedAt: string;
  forecasts: Record<string, NextGenerationStoredForecast>;
};

export type ResolvedForecastExample = {
  generatedAt: string;
  actual: 0 | 1;
  forecast: NextGenerationStoredForecast;
};

export function isStrictHorizonResolved(
  origin: string,
  horizonHours: 24 | 48,
  cutoff: Date,
): boolean;

export function getRandomResetOutcomeWithinHorizon(
  events: Array<ShadowResetEvent>,
  origin: string,
  horizonHours: 24 | 48,
): 0 | 1 | null;

export function selectPostFreezeComparableRows(
  rows: Array<NextGenerationForecastRow>,
  requiredModelVersions: readonly string[],
  freezeAt: string,
): Array<NextGenerationForecastRow>;

export function selectJstDailyFirstRows(
  rows: Array<NextGenerationForecastRow>,
): Array<NextGenerationForecastRow>;

export function buildResolvedExamples(
  rows: Array<NextGenerationForecastRow>,
  modelVersion: string,
  horizonHours: 24 | 48,
  events: Array<ShadowResetEvent>,
  cutoff: Date,
): Array<ResolvedForecastExample>;
```

- [ ] **Step 1: Add failing tests for freeze filtering, JST daily-first, strict resolution, and regular-reset-neutral labels**

Use Node test style already used by the repository:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResolvedExamples,
  getRandomResetOutcomeWithinHorizon,
  isStrictHorizonResolved,
  selectJstDailyFirstRows,
  selectPostFreezeComparableRows,
} from "../lib/radar/nextGenerationProbabilityTraining";

test("positive reset does not early-resolve a 24h training row", () => {
  const origin = "2026-08-21T04:00:00.000Z";
  assert.equal(
    isStrictHorizonResolved(origin, 24, new Date("2026-08-22T03:59:59.999Z")),
    false,
  );
  assert.equal(
    isStrictHorizonResolved(origin, 24, new Date("2026-08-22T04:00:00.000Z")),
    true,
  );
});

test("regular reset does not censor a later random reset", () => {
  const events = [{ id: "random", resetAt: "2026-08-21T19:00:00.000Z" }];
  assert.equal(
    getRandomResetOutcomeWithinHorizon(events, "2026-08-21T04:00:00.000Z", 24),
    1,
  );
});
```

Also assert that two rows on the same JST date select the earlier `generatedAt`, a row before `2026-08-21T03:27:00.000Z` is excluded, and a missing required model excludes the row.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
corepack pnpm exec tsx --test tests/nextGenerationProbabilityTraining.test.ts
```

Expected: FAIL because `nextGenerationProbabilityTraining.ts` and the new constants do not exist.

- [ ] **Step 3: Add the exact preregistered constants**

Add a versioned block to `data/shadowProbabilityConfig.ts` using the exact design values. Keep all existing constants unchanged. The core shape must include:

```ts
export const EXPLAINABLE_RANDOM_CONTINUOUS_MODEL_VERSION =
  "hazard-regime-random-continuous-calibrated-v1";
export const ACCURACY_ENSEMBLE_MODEL_VERSION =
  "hazard-ensemble-logit-stack-v1";
export const NEXT_GENERATION_MODEL_FREEZE_AT = "2026-08-21T03:27:00.000Z";
export const A_COMPONENT_LOGIT_EPSILON = 1e-4;
export const A_ENSEMBLE_MIN_TRAINING_SAMPLES = 10;
export const A_ENSEMBLE_ALPHA_PRIOR_SD = 0.5;
export const A_ENSEMBLE_WEIGHT_PRIOR_SD = 0.15;
export const A_ENSEMBLE_SOLVER_CONFIG = {
  maxIterations: 200,
  tolerance: 1e-7,
  initialStep: 1,
  backtrackingFactor: 0.5,
  maxBacktrackingSteps: 20,
} as const;
```

`NEXT_GENERATION_B_FROZEN_CONFIG` must copy every B numerical constant from the approved spec rather than spreading mutable shared config objects.

- [ ] **Step 4: Implement the pure prospective row helpers**

Implementation rules:
- invalid timestamps return `false`/`null`, not exceptions, except programmer-invalid horizon values are impossible because the type is `24 | 48`;
- outcome checks only `ShadowResetEvent[]`, so regular boundaries can never censor labels;
- event is positive only if `eventTime > originTime && eventTime <= originTime + horizon`;
- daily-first ordering matches existing `selectDailyFirstForecasts`: generated time first, then `loggedHour` as tiebreaker;
- `buildResolvedExamples` first enforces `isStrictHorizonResolved`, then validates stored probability finiteness/range, then computes the label.

- [ ] **Step 5: Run focused tests**

```powershell
corepack pnpm exec tsx --test tests/nextGenerationProbabilityTraining.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run existing prospective-evaluation regression tests**

```powershell
corepack pnpm exec tsx --test tests/prospectiveProbabilityEvaluation.test.ts tests/prospectiveRandomContinuousModelEvaluation.test.ts tests/prospectiveRandomClockModelEvaluation.test.ts
```

Expected: PASS; Task 1 must not alter old evaluator semantics.

- [ ] **Step 7: Commit**

```powershell
git add data/shadowProbabilityConfig.ts lib/radar/nextGenerationProbabilityTraining.ts tests/nextGenerationProbabilityTraining.test.ts
git commit -m "feat: preregister next-generation probability models"
```

---

### Task 2: Add version-frozen calculation plumbing without changing existing model outputs

**Files:**
- Modify: `lib/radar/shadowProbability.ts`
- Modify: `lib/radar/regimeElapsedProbability.ts`
- Modify: `lib/radar/randomContinuousProbability.ts`
- Modify: `tests/shadowProbability.test.ts`
- Modify: `tests/regimeElapsedProbability.test.ts`
- Modify: `tests/randomContinuousProbability.test.ts`

**Interfaces:**
- Extend signal calculation with an optional immutable config while keeping the current one-argument API behavior:

```ts
export type ShadowSignalMultiplierRuntimeConfig = {
  multiplierConfig: typeof SHADOW_SIGNAL_MULTIPLIER_CONFIG;
  maxTotalOddsMultiplier24h: number;
  maxTotalOddsMultiplier48h: number;
};

export function calculateShadowSignalMultipliers(
  input: ShadowSignalInputs,
  runtimeConfig?: ShadowSignalMultiplierRuntimeConfig,
): ShadowSignalMultipliers;
```

- Extend `RegimeElapsedModelOptions` with model-specific prior/floor/cap/signal values required by B. Existing callers that omit them must produce identical results.
- Add pure official-notice application helper and use it from the existing regime implementation:

```ts
export function applyOfficialNoticeTimingPolicy(
  probabilities: ShadowProbabilityHorizons,
  activeOfficialNotice: ActiveOfficialNotice | null | undefined,
  now: Date,
): {
  predictions: ShadowProbabilityHorizons;
  active: boolean;
  policyVersion: typeof OFFICIAL_NOTICE_TIMING_POLICY_VERSION;
};
```

If the current policy needs temporal fields already available through another object, define a narrow input type containing those exact fields rather than reaching into global state.

- Add random-continuous model config:

```ts
export type RandomContinuousModelConfig = {
  modelVersion: string;
  targetDefinition: string;
  freezeAt: string;
  freezePolicy: string;
  bandwidthHours: number;
  gridHours: number;
  truncationHours: number;
  localPriorExposureDays: number;
  localPriorWindowHours: number;
  integrationStepHours: number;
  globalPriorEventCount: number;
  globalPriorExposureDays: number;
  minDailyProbability: number;
  maxDailyProbability: number;
};

export function calculateRandomContinuousProbability(
  data: RadarData | null,
  options?: ShadowProbabilityOptions,
  precomputedRecoveryResult?: RegimeElapsedProbabilityResult,
  modelConfig?: RandomContinuousModelConfig,
): RandomContinuousProbabilityResult;
```

Existing three-argument calls retain the current old-shadow config.

- [ ] **Step 1: Add regression tests proving defaults are unchanged and injected config is honored**

Add tests that calculate the same fixture before/after the refactor path and assert deep equality for the default result. Add injected-config assertions such as:

```ts
test("random continuous accepts frozen model constants without changing defaults", () => {
  const defaultResult = calculateRandomContinuousProbability(data, options);
  const explicitResult = calculateRandomContinuousProbability(
    data,
    options,
    undefined,
    {
      modelVersion: defaultResult.modelVersion,
      targetDefinition: defaultResult.targetDefinition,
      freezeAt: defaultResult.randomContinuous.freezeAt,
      freezePolicy: defaultResult.randomContinuous.freezePolicy,
      bandwidthHours: 24,
      gridHours: 1,
      truncationHours: 72,
      localPriorExposureDays: 2,
      localPriorWindowHours: 48,
      integrationStepHours: 10 / 60,
      globalPriorEventCount: 1,
      globalPriorExposureDays: 10,
      minDailyProbability: 0.01,
      maxDailyProbability: 0.35,
    },
  );
  assert.deepEqual(explicitResult.predictions, defaultResult.predictions);
});
```

Add a signal-config test that changes exactly one multiplier in an injected config and verifies only the injected call changes.

- [ ] **Step 2: Run focused tests and verify at least one fails before implementation**

```powershell
corepack pnpm exec tsx --test tests/shadowProbability.test.ts tests/regimeElapsedProbability.test.ts tests/randomContinuousProbability.test.ts
```

Expected: FAIL on the new optional-config/helper behavior.

- [ ] **Step 3: Parameterize signal multiplier math**

Change `calculateShadowSignalMultipliers` so all current formulas read from `runtimeConfig ?? currentDefaults`. Do not alter the existing recent-reset/regular-proximity 1x policy for random-reset models. Keep default cap values 5/6.

- [ ] **Step 4: Parameterize regime prior/floor/cap/signal values and extract official-notice policy**

Pass explicit model values through `RegimeElapsedModelOptions` instead of reading mutable globals in branches used by B. Replace the current in-function official-notice calculation with `applyOfficialNoticeTimingPolicy`, and make the existing output/tests unchanged for default calls.

- [ ] **Step 5: Parameterize continuous-hazard constants**

Replace hardcoded module-level model constants inside hazard construction/kernel/integration with values from `modelConfig`, defaulting to the existing random-continuous constants. Ensure audit fields report the effective model config.

- [ ] **Step 6: Run focused regression suite**

```powershell
corepack pnpm exec tsx --test tests/shadowProbability.test.ts tests/regimeElapsedProbability.test.ts tests/randomContinuousProbability.test.ts tests/calibratedShadowProbability.test.ts tests/overdueOfficialNotice.test.ts tests/tiboTemporal.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add lib/radar/shadowProbability.ts lib/radar/regimeElapsedProbability.ts lib/radar/randomContinuousProbability.ts tests/shadowProbability.test.ts tests/regimeElapsedProbability.test.ts tests/randomContinuousProbability.test.ts
git commit -m "refactor: support frozen probability model configs"
```

---

### Task 3: Implement Model B future-only calibration and final probability audit

**Files:**
- Create: `lib/radar/calibratedRandomContinuousProbability.ts`
- Create: `tests/calibratedRandomContinuousProbability.test.ts`
- Reuse: `lib/radar/nextGenerationProbabilityTraining.ts`
- Reuse: `lib/radar/calibratedShadowProbability.ts` coherence semantics
- Reuse: `lib/radar/prequentialCalibration.ts` MAP alpha fitting primitives where possible

**Interfaces:**

```ts
export type ExplainableRandomContinuousResult = {
  modelVersion: typeof EXPLAINABLE_RANDOM_CONTINUOUS_MODEL_VERSION;
  generatedAt: string;
  probability12h: number;
  probability24h: number;
  probability48h: number;
  probability72h: number;
  rawProbability24h: number;
  rawProbability48h: number;
  alpha24h: number;
  alpha48h: number;
  calibrationSampleCount24h: number;
  calibrationSampleCount48h: number;
  positiveCalibrationCount24h: number;
  positiveCalibrationCount48h: number;
  lastResolvedOrigin24h: string | null;
  lastResolvedOrigin48h: string | null;
  horizonCoherenceAdjusted: boolean;
  officialNoticeOverride: boolean;
  officialNoticeTimingPolicyVersion: string;
  calibrationFallbackUsed: boolean;
  randomContinuous: RandomContinuousAudit;
  multipliers: ShadowSignalMultipliers;
  freezeAt: string;
  freezePolicy: string;
  targetDefinition: string;
};

export function calculateExplainableRandomContinuousProbability(
  data: RadarData | null,
  options: ShadowProbabilityOptions,
  historyRows: Array<NextGenerationForecastRow>,
): ExplainableRandomContinuousResult | null;
```

Implementation ordering is fixed:
1. compute B frozen continuous/regime/ordinary-signal raw probability **with official notice suppressed**;
2. build 24h/48h daily-first resolved calibration rows from post-freeze saved B forecasts using each row's `rawProbability24h/48h`;
3. fit alpha independently, alpha=0 below 10 samples;
4. apply `sigmoid(logit(raw) + alpha)`;
5. enforce 24h/48h coherence;
6. apply the real current official-notice timing policy exactly once;
7. validate final 24h<=48h, derive 12h/72h, and return the audit.

- [ ] **Step 1: Add failing tests for cold start, saved-raw training, strict resolution, regular reset invariance, coherence, and notice ordering**

Required test cases:
- 9 resolved rows -> alpha 0 / sample count 9;
- 10 resolved rows -> calibration fitter invoked / sample count 10;
- a stored row where `rawProbability24h=0.2` and `probability24h=0.8` proves training consumes 0.2, not 0.8;
- a positive reset at origin+3h is not used until origin+24h;
- inserting a regular reset between latest random reset and now does not change B `randomElapsedHours`;
- synthetic alphas causing raw 24h > raw 48h result in `p48 = p24` and `horizonCoherenceAdjusted=true`;
- official notice result matches `official-notice-window-v3` after calibration and is not multiplied/applied twice.

- [ ] **Step 2: Run focused test and verify failure**

```powershell
corepack pnpm exec tsx --test tests/calibratedRandomContinuousProbability.test.ts
```

Expected: FAIL because Model B module does not exist.

- [ ] **Step 3: Implement B frozen raw calculation**

Construct an explicit `RandomContinuousModelConfig` and explicit B regime/signal config from `NEXT_GENERATION_B_FROZEN_CONFIG`. For the raw calculation, pass `activeOfficialNotice: null` while keeping all other point-in-time signal inputs identical.

- [ ] **Step 4: Implement future-only alpha fitting**

Use `selectPostFreezeComparableRows`, `selectJstDailyFirstRows`, and strict resolution helpers. Never reconstruct pre-freeze B forecasts from event history. The fit input is the saved raw probability field. Record `lastResolvedOrigin*` from the final included row.

- [ ] **Step 5: Apply coherence and official notice once**

Reuse `enforceProbabilityHorizonCoherence` if its export is suitable; otherwise move the exact same helper to a neutral shared module and update the old calibrated model to import it in the same commit. Do not create subtly different coherence math.

- [ ] **Step 6: Run focused and random-clock regression tests**

```powershell
corepack pnpm exec tsx --test tests/calibratedRandomContinuousProbability.test.ts tests/randomContinuousProbability.test.ts tests/randomElapsedProbability.test.ts tests/calibratedShadowProbability.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add lib/radar/calibratedRandomContinuousProbability.ts tests/calibratedRandomContinuousProbability.test.ts lib/radar/calibratedShadowProbability.ts
git commit -m "feat: add explainable calibrated random-continuous shadow"
```

Only include `lib/radar/calibratedShadowProbability.ts` if coherence helper reuse required a move/export change.

---

### Task 4: Implement Model A deterministic regularized ensemble

**Files:**
- Create: `lib/radar/probabilityEnsemble.ts`
- Create: `tests/probabilityEnsemble.test.ts`
- Reuse: constants from `data/shadowProbabilityConfig.ts`
- Reuse: training selection from `lib/radar/nextGenerationProbabilityTraining.ts`

**Interfaces:**

```ts
export type EnsembleComponentForecast = {
  modelVersion: string;
  probability24h: number;
  probability48h: number;
};

export type EnsembleFitResult = {
  alpha: number;
  weights: [number, number, number, number, number];
  sampleCount: number;
  positiveCount: number;
  mode: "equal" | "fitted";
  iterations: number;
  converged: boolean;
  fitCutoff: string | null;
};

export type AccuracyEnsembleResult = {
  modelVersion: typeof ACCURACY_ENSEMBLE_MODEL_VERSION;
  generatedAt: string;
  probability12h: number;
  probability24h: number;
  probability48h: number;
  probability72h: number;
  rawEnsembleProbability24h: number;
  rawEnsembleProbability48h: number;
  horizonCoherenceAdjusted: boolean;
  componentModelVersions: readonly string[];
  componentProbabilities24h: number[];
  componentProbabilities48h: number[];
  componentLogitEpsilon: number;
  fit24h: EnsembleFitResult;
  fit48h: EnsembleFitResult;
  freezeAt: string;
  freezePolicy: string;
};

export function projectOntoProbabilitySimplex(values: readonly number[]): number[];

export function fitRegularizedEnsemble(
  rows: Array<{ componentProbabilities: number[]; actual: 0 | 1; generatedAt: string }>,
): EnsembleFitResult | null;

export function calculateAccuracyEnsembleProbability(
  currentComponents: Array<EnsembleComponentForecast>,
  historyRows: Array<NextGenerationForecastRow>,
  events: Array<ShadowResetEvent>,
  now: Date,
): AccuracyEnsembleResult | null;
```

- [ ] **Step 1: Add failing mathematical tests for simplex projection and deterministic fit**

Required assertions:

```ts
assert.deepEqual(projectOntoProbabilitySimplex([0.2, 0.2, 0.2, 0.2, 0.2]), [0.2,0.2,0.2,0.2,0.2]);
const projected = projectOntoProbabilitySimplex([-1, 2, 0, 0, 0]);
assert.ok(projected.every((value) => value >= 0));
assert.ok(Math.abs(projected.reduce((a,b) => a+b, 0) - 1) < 1e-12);
```

Also test:
- epsilon clamp makes p=0 and p=1 finite and equivalent to 1e-4 / 0.9999;
- <10 samples returns equal weights and alpha0;
- fitted result is deterministic across two calls;
- weights nonnegative/sum1;
- increasing the evidence for one component increases its fitted weight relative to a deliberately poor component while shrinkage prevents extreme unconstrained values on a tiny sample;
- solver returns null when a test-injected pathological objective/nonfinite input prevents convergence;
- 24h/48h independent fits can create a raw inversion and coherence raises only 48h;
- missing B or any exact component version returns null;
- no extra official-notice transformation exists in A.

- [ ] **Step 2: Run focused test and verify failure**

```powershell
corepack pnpm exec tsx --test tests/probabilityEnsemble.test.ts
```

Expected: FAIL because ensemble module does not exist.

- [ ] **Step 3: Implement stable logit/sigmoid and simplex projection**

Use the standard sorting-based Euclidean projection onto the simplex. Validate all component probabilities are finite and in [0,1] before epsilon clamp; invalid probabilities make the current A forecast null rather than silently converting bad data.

- [ ] **Step 4: Implement exact penalized objective and deterministic PGD**

Objective:

```text
J(alpha,w) = Σ logloss(y_j, sigmoid(alpha + z_j·w))
           + alpha² / (2 * 0.5²)
           + Σ (w_i - 0.2)² / (2 * 0.15²)
```

PGD rules are exactly the frozen constants. Accept a line-search candidate only if objective is finite, weights satisfy simplex after projection, and objective does not increase. If no accepted step within 20 backtracks or no convergence by 200 iterations, return null.

- [ ] **Step 5: Implement 24h/48h training assembly and prediction**

For each horizon independently:
- require all five exact component forecasts on each training row;
- use only post-freeze JST daily-first rows that strictly resolved before `now`;
- labels come only from random-reset events;
- fit horizon-specific alpha/weights;
- current prediction uses current exact-version final component probabilities;
- if either horizon cannot be fit according to the cold-start/fitted rules, skip A entirely.

- [ ] **Step 6: Enforce horizon coherence and derive 12h/72h**

Apply the same coherence policy as B/current calibrated model, save raw pair and adjustment flag, then call existing `derive12hFrom24hProbability` / `derive72hFrom48hProbability`.

- [ ] **Step 7: Run focused tests**

```powershell
corepack pnpm exec tsx --test tests/probabilityEnsemble.test.ts tests/nextGenerationProbabilityTraining.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add lib/radar/probabilityEnsemble.ts tests/probabilityEnsemble.test.ts
git commit -m "feat: add accuracy-first probability ensemble"
```

---

### Task 5: Add logging-only history loader with one bounded Supabase read

**Files:**
- Create: `lib/radar/nextGenerationProbabilityHistory.ts`
- Create: `tests/nextGenerationProbabilityHistory.test.ts`

**Interfaces:**

```ts
export type PredictionHistoryQueryClient = {
  from: (table: string) => unknown;
};

export async function loadNextGenerationTrainingRows(
  supabase: PredictionHistoryQueryClient,
  cutoff: Date,
): Promise<Array<NextGenerationForecastRow>>;
```

The adapter queries only `prediction_history` rows where `logged_hour >= NEXT_GENERATION_MODEL_FREEZE_AT` and `logged_hour < cutoff.toISOString()`, selecting only `logged_hour, debug_info`. It normalizes `debug_info.experimentalProbabilityForecasts` into `NextGenerationForecastRow[]`, drops malformed rows, and performs no model fitting.

- [ ] **Step 1: Add failing adapter tests using a fake Supabase query chain**

Assert:
- query table is `prediction_history`;
- select is limited to `logged_hour,debug_info` (spacing can match repository conventions);
- lower bound is freeze time and upper bound is current cutoff;
- malformed/missing `debug_info.experimentalProbabilityForecasts` rows are ignored;
- valid rows preserve the original stored `generatedAt`/forecast values;
- no mutation/update/upsert method is called.

- [ ] **Step 2: Run focused test and verify failure**

```powershell
corepack pnpm exec tsx --test tests/nextGenerationProbabilityHistory.test.ts
```

Expected: FAIL because adapter does not exist.

- [ ] **Step 3: Implement bounded read-only loader**

Keep all Supabase-shape handling in this adapter. The pure model modules must not import Supabase.

- [ ] **Step 4: Run focused test**

```powershell
corepack pnpm exec tsx --test tests/nextGenerationProbabilityHistory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/radar/nextGenerationProbabilityHistory.ts tests/nextGenerationProbabilityHistory.test.ts
git commit -m "feat: load prospective shadow training history"
```

---

### Task 6: Integrate B then A into immutable experimental forecast persistence

**Files:**
- Modify: `lib/logProbability.ts`
- Modify: `app/api/log-probability/route.ts`
- Modify: `tests/probabilityForecastPersistence.test.ts`
- Modify: `tests/probabilityAudit.test.ts` if internal debug schema assertions live there

**Interfaces:**
- Extend `ExperimentalProbabilityForecast` only with optional internal fields needed by B/A. Existing model serializers must continue producing the same properties.
- Add serializers:

```ts
export function toExplainableRandomContinuousExperimentalForecast(
  result: ExplainableRandomContinuousResult,
): ExperimentalProbabilityForecast;

export function toAccuracyEnsembleExperimentalForecast(
  result: AccuracyEnsembleResult,
): ExperimentalProbabilityForecast;
```

- Extend `buildExperimentalProbabilityForecasts` to accept optional already-computed B/A results rather than reading DB itself:

```ts
options: ShadowProbabilityOptions & {
  shadowProbability?: ShadowProbabilityResult | null;
  calibratedProbability?: CalibratedShadowProbabilityResult | null;
  explainableProbability?: ExplainableRandomContinuousResult | null;
  accuracyEnsembleProbability?: AccuracyEnsembleResult | null;
}
```

This keeps `lib/logProbability.ts` pure with respect to Supabase.

- [ ] **Step 1: Add failing persistence/audit tests**

Assert that when B/A results are supplied:
- experimental forecasts contain both exact version keys;
- B stores raw probabilities, alpha/sample counts, random elapsed, hazard/regime/signal audit, coherence flag, freeze metadata;
- A stores raw ensemble probabilities, component versions/probabilities, epsilon, weights/alphas, training modes/counts/cutoffs, solver iterations/converged flags, coherence/freeze audit;
- the route JSON response is unchanged and contains no `hazard-ensemble-logit-stack-v1` or B audit object;
- old experimental model keys remain present;
- first-writer-wins persistence behavior remains unchanged.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
corepack pnpm exec tsx --test tests/probabilityForecastPersistence.test.ts tests/probabilityAudit.test.ts
```

Expected: FAIL on new B/A persistence assertions.

- [ ] **Step 3: Extend internal forecast type and serializers**

Add optional fields rather than creating a second debug payload structure. Do not expose them in public DTO types.

- [ ] **Step 4: Change the route to perform one history read and compute B then A**

Ordering inside `handleLogRequest` after the Supabase client exists:

```ts
const trainingRows = await loadNextGenerationTrainingRows(supabase, calculationNow);
const explainableProbability = calculateExplainableRandomContinuousProbability(
  rawData,
  calculationOptions,
  trainingRows,
);
const baseExperimentalForecasts = buildExperimentalProbabilityForecasts(rawData, calculationOptions);
const accuracyEnsembleProbability = explainableProbability
  ? calculateAccuracyEnsembleProbability(
      extractExactCurrentComponents(baseExperimentalForecasts, explainableProbability),
      trainingRows,
      getShadowCompletedResetEvents(rawData, calculationNow),
      calculationNow,
    )
  : null;
```

Avoid calculating the existing model set twice. If needed, split `buildExperimentalProbabilityForecasts` into a pure `buildBaseExperimentalProbabilityForecasts` plus a serializer merge helper so current components are computed exactly once.

History-read failure policy:
- catch only the training-read failure separately;
- B may still be calculated with an empty training array, which yields alpha=0 and `calibrationFallbackUsed=true`;
- A must be null because training state cannot be reconstructed;
- logging of the normal published probability row must still proceed.

B raw-calculation failure policy:
- B null;
- A null;
- normal published logging still proceeds.

- [ ] **Step 5: Ensure current exact components are taken from this origin, not recomputed from historical rows**

Component 1 is calibrated public v3 stored/calculated for the current origin; component 2 is current B; components 3–5 are current base experimental forecasts. Validate modelVersion equality before invoking A.

- [ ] **Step 6: Run focused persistence and route boundary tests**

```powershell
corepack pnpm exec tsx --test tests/probabilityForecastPersistence.test.ts tests/probabilityAudit.test.ts tests/publishedProbability.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck before committing integration**

```powershell
corepack pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add lib/logProbability.ts app/api/log-probability/route.ts tests/probabilityForecastPersistence.test.ts tests/probabilityAudit.test.ts
git commit -m "feat: persist next-generation probability shadows"
```

---

### Task 7: Add three-way prospective evaluator and reports

**Files:**
- Create: `lib/radar/prospectiveNextGenerationModelEvaluation.ts`
- Create: `tests/prospectiveNextGenerationModelEvaluation.test.ts`
- Create: `scripts/evaluateNextGenerationModelsProspectively.ts`
- Modify: `package.json`
- Generate at runtime: `reports/prospective-next-generation-model-evaluation.json`
- Generate at runtime: `reports/prospective-next-generation-model-evaluation.md`

**Interfaces:**

```ts
export type NextGenerationCandidateEvaluation = {
  modelVersion: string;
  metrics24h: ProspectiveMetric;
  metrics48h: ProspectiveMetric;
  availability: {
    eligibleOrigins: number;
    savedForecasts: number;
    skippedForecasts: number;
    availabilityRate: number;
  };
};

export type ProspectiveNextGenerationReport = {
  schemaVersion: "prospective-next-generation-model-evaluation-v1";
  status: "insufficient_data" | "review_ready";
  evaluationMode: "prospective";
  backfilled: false;
  autoPublish: false;
  freezeAt: string;
  evaluationStartAt: string | null;
  publicModelVersion: string;
  modelA: NextGenerationCandidateEvaluation;
  modelB: NextGenerationCandidateEvaluation;
  publicModel: ProspectiveModelEvaluation;
  pairwise: {
    aMinusPublic: { brier24h: number | null; brier48h: number | null; logLoss24h: number | null; logLoss48h: number | null };
    bMinusPublic: { brier24h: number | null; brier48h: number | null; logLoss24h: number | null; logLoss48h: number | null };
    aMinusB: { brier24h: number | null; brier48h: number | null; logLoss24h: number | null; logLoss48h: number | null };
  };
  gate: {
    targetResetCount: number;
    resolvedDaily24h: number;
    resolvedDaily48h: number;
    aEligibleForManualReview: boolean;
    bEligibleForManualReview: boolean;
  };
  notes: string[];
};

export function evaluateNextGenerationModelsProspectively(
  rows: Array<ProspectiveForecastRow>,
  events: Array<ShadowResetEvent>,
  asOf: Date,
): ProspectiveNextGenerationReport;
```

- [ ] **Step 1: Add failing evaluator tests for same-origin fairness and strict random-only labels**

Required cases:
- a row missing A is excluded from the **three-way head-to-head metric set** but still contributes to availability diagnostics;
- a regular boundary alone within 24h produces negative, not censored;
- regular at +8h then random at +15h produces positive;
- a +3h random does not make a 24h row scorable at +4h;
- freeze-preceding rows never count;
- daily-first selection happens after comparable-row filtering;
- Gate 1 is target resets >=5, daily resolved24 >=20, resolved48 >=15;
- candidate Gate 2 requires Brier <= public on both horizons and log-loss worsening <=0.05 on both;
- report always has `autoPublish:false`;
- A/B availability rates and skip counts are reported separately.

- [ ] **Step 2: Run focused evaluator test and verify failure**

```powershell
corepack pnpm exec tsx --test tests/prospectiveNextGenerationModelEvaluation.test.ts
```

Expected: FAIL because evaluator does not exist.

- [ ] **Step 3: Implement evaluator using shared strict-resolution helpers**

Do not call old `getRandomClockOutcome`, because it censors regular boundaries. Reuse metrics/calibration-bucket helpers from `prospectiveProbabilityEvaluation.ts` by exporting neutral helpers if practical; otherwise move those helpers to a shared evaluation utility and keep old outputs unchanged.

Primary metrics use exactly the same three-way comparable daily-first origins. Secondary non-overlapping 24h/48h diagnostics should be included in report output, but not hard gates.

- [ ] **Step 4: Add CLI/report script**

Follow existing `evaluateRandomContinuousModelProspectively.ts` conventions for Supabase env loading, history normalization, canonical random-reset event retrieval, `--as-of` handling, and Markdown/JSON writes. The script must not write DB rows.

Add package script:

```json
"evaluate:prospective-next-generation": "tsx scripts/evaluateNextGenerationModelsProspectively.ts"
```

- [ ] **Step 5: Run focused test and evaluator command**

```powershell
corepack pnpm exec tsx --test tests/prospectiveNextGenerationModelEvaluation.test.ts
corepack pnpm run evaluate:prospective-next-generation
```

Expected: test PASS; report may legitimately say `insufficient_data` immediately after deployment.

- [ ] **Step 6: Commit**

```powershell
git add lib/radar/prospectiveNextGenerationModelEvaluation.ts tests/prospectiveNextGenerationModelEvaluation.test.ts scripts/evaluateNextGenerationModelsProspectively.ts package.json
git commit -m "test: add next-generation prospective evaluation"
```

Do not commit generated live report files unless existing repository convention for this evaluator family explicitly tracks generated reports; if tracked, include them in the same commit with their explicit `asOf`.

---

### Task 8: Full regression, Vercel/runtime verification, and observation-start readiness

**Files:**
- No planned source additions. Modify only files required to fix a verified regression.

**Interfaces:**
- Published output must remain unchanged for deterministic fixtures.
- A/B should appear only under internal experimental forecast debug data in newly saved post-freeze rows.

- [ ] **Step 1: Run all tests**

```powershell
corepack pnpm test
```

Expected: all tests PASS.

- [ ] **Step 2: Run full static checks**

```powershell
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run check
```

Expected: PASS. `check` reruns tests/lint/typecheck; still run the explicit commands so failures are attributable.

- [ ] **Step 3: Build production bundle**

```powershell
corepack pnpm run build
```

Expected: PASS with no new public route or client bundle dependency on the A/B solver/history loader.

- [ ] **Step 4: Verify diff hygiene**

```powershell
git diff --check
git status --short
git diff -- data/shadowProbabilityConfig.ts lib/radar app/api/log-probability/route.ts lib/logProbability.ts package.json tests
```

Confirm:
- no `.env*`, secrets, generated caches, or unrelated files;
- `PUBLISHED_PROBABILITY_MODEL_VERSION` remains calibrated v3;
- `calculatePublishedProbability` selection/fallback chain is unchanged;
- A/B loader/solver modules are not imported by `/api/current` or public rendering paths.

- [ ] **Step 5: Run deterministic published-probability regression fixture**

Use the existing published-probability tests plus an explicit before/after fixture assertion if not already covered:

```powershell
corepack pnpm exec tsx --test tests/publishedProbability.test.ts tests/probabilityForecastPersistence.test.ts tests/randomContinuousProbability.test.ts
```

Expected: PASS.

- [ ] **Step 6: Measure bounded solver/runtime behavior locally**

Add or use a test fixture with at least 100 prospective training rows and assert A fit returns within a reasonable unit-test budget without network I/O. The correctness requirement is the fixed 200×20 iteration/backtrack bound; do not introduce wall-clock-dependent production behavior.

Run:

```powershell
corepack pnpm exec tsx --test tests/probabilityEnsemble.test.ts
```

Expected: PASS and no hang.

- [ ] **Step 7: Commit any verification-only fixes separately**

If verification required a code fix:

```powershell
git add <only-the-files-changed-for-the-verified-regression>
git commit -m "fix: harden next-generation probability shadows"
```

If no fix was needed, do not create an empty commit.

- [ ] **Step 8: Push and verify Production observation start**

After all checks pass, push the completed commits. On the first successful post-deploy `/api/log-probability` execution, verify through the existing database/log inspection workflow:
- published model remains calibrated v3;
- first-writer-wins row is saved normally;
- B is present for a post-freeze origin and contains `freezeAt`, raw probabilities, alpha/sample audit, random elapsed, and coherence audit;
- A is present only when all five current components and training state are valid;
- if training read failed, B records calibration fallback and A is absent while published logging still succeeded;
- no pre-freeze row gained A/B forecasts;
- `/`, `/en`, `/zh`, `/api/current` remain healthy;
- Vercel logs show no repeated unbounded solver work or unexpected public-request CPU increase.

- [ ] **Step 9: Generate the initial prospective report**

```powershell
corepack pnpm run evaluate:prospective-next-generation
```

Expected immediately after launch: likely `insufficient_data`; this is correct and must not trigger retuning or publication.

---

## Plan Self-Review Checklist

- Spec coverage: every approved requirement is assigned to Tasks 1–8, including the Gemini-review fixes for strict horizon resolution, epsilon, coherence, bounded deterministic solver, and B→A cascade behavior.
- Leakage control: B calibration and A weights use only actually saved post-freeze forecasts whose full horizon elapsed before the current origin; no regenerated/backfilled forecast enters training.
- Target consistency: A/B training and evaluation consume random-reset events only; regular reset boundaries are not passed into target outcome helpers.
- Version stability: B numerical configuration and A exact components/solver constants are frozen by versioned constants rather than mutable aliases.
- Runtime isolation: DB training read and A/B computation occur only in `/api/log-probability`; public probability and UI paths stay unchanged.
- Failure isolation: B/A failures never abort normal published probability persistence; A never silently changes definition when B/component/solver state is invalid.
- Type consistency: `NextGenerationForecastRow` is the shared normalized stored-row shape across loader, B calibration, A fit, and evaluator; model outputs expose fields consumed by `lib/logProbability.ts` serializers.
- No schema migration: all new audit state remains inside existing `debug_info.experimentalProbabilityForecasts`.
