# Contextual Burst Hazard Shadow Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shadow model C (`hazard-contextual-burst-circadian-v1`) that augments the existing random-reset continuous hazard with short-term burst and Pacific-time circadian context, while preserving the current public model and existing A/B definitions.

**Architecture:** Reuse the existing random-reset-only Gaussian continuous hazard as C's baseline, but run it with no B 3-day regime multiplier. Fit a four-feature, ridge-regularized complementary-log-log discrete-time hazard context block from past-only random-reset exposure, integrate that context dynamically over future 12/24/48/72h survival paths, apply the same frozen ordinary semantic-signal policy as B, then apply C-only future-saved-forecast calibration, horizon coherence, and official-notice timing. C is generated only in the probability logging path and stored in `prediction_history.debug_info.experimentalProbabilityForecasts`; A v1 remains unchanged and does not consume C.

**Tech Stack:** Next.js 15.5.21, TypeScript 5.5, Node `node:test` via `tsx --test`, Supabase `@supabase/supabase-js` 2.108, pnpm 11.18.0.

**Spec:** `docs/superpowers/specs/2026-08-22-contextual-burst-hazard-design.md`

## Global Constraints

- Published model remains exactly `hazard-odds-v4-logit-calibrated-prequential-v3`; do not change the published selector, `/api/current`, public DTO, or UI.
- C model version is exactly `hazard-contextual-burst-circadian-v1`.
- C freeze boundary is exactly `2026-08-22T06:15:00.000Z`; no pre-freeze C forecast backfill or rewriting of saved rows.
- Evaluation mode is `prospective`, `backfill=false`, `auto publish=false`, manual review only.
- C target positives are completed broad-scope eligible random resets only. Regular resets do not reset C's random clock and do not censor C labels.
- Base hazard uses B's frozen Gaussian continuous values: bandwidth 24h, grid 1h, truncation ±72h, local prior exposure 2d, local prior window 48h, integration step 10m, global prior 1 event / 10d, daily floor 1%, daily cap 35%.
- Do not apply B's 3-day activity-regime multiplier in C; burst context replaces that role to avoid double-counting.
- C fitted features are exactly: standardized `log1p(randomResetCount72h)`, standardized `log1p(previousRandomIntervalHours)`, `hourSin`, `hourCos` in `America/Los_Angeles`.
- Circadian conversion must use IANA `America/Los_Angeles`; never a fixed PST/PDT UTC offset.
- Context fit uses 1h exposure cells and a complementary-log-log Bernoulli hazard with base cumulative hazard as offset; no free intercept.
- Context coefficient prior is independent Gaussian mean 0, SD 0.5. Minimum fit data: 15 historical eligible random events and 720 eligible exposure cells.
- Final context multiplier is clamped to `[0.5, 2.0]` at every integration step.
- If previous interval is unavailable, minimum data is insufficient, or the solver fails/non-finite, use coefficients `[0,0,0,0]`, multiplier 1, and persist a fallback reason.
- During future integration, circadian time changes and known old reset events age out of the rolling 72h count; no hypothetical future reset is added before the target event.
- C ordinary semantic signals use exactly B v1's frozen signal policy. Do not add weekday, weekend, raw Tibo post counts, previous-reason category, milestone/release category, embeddings, or Product Activity features to C v1.
- C calibration uses only actually saved post-freeze C raw forecasts, JST daily-first, strict full-horizon resolution, minimum 10 samples, alpha prior SD 0.5.
- C ablation raw values exclude calibration and official-notice override.
- A v1's exact five-component set stays frozen and must not include C. Any ensemble using C is a future A v2.
- No DB schema migration. Preserve `prediction_history` first-writer-wins behavior.
- Implementation follows TDD and existing `AGENTS.md`: focused tests first, then implementation, full verification, commit and push.

---

## File Structure

- `data/shadowProbabilityConfig.ts`: add only C version/freeze/frozen solver and model constants; do not mutate A/B values.
- `lib/radar/contextualBurstContext.ts` (new): past-only feature extraction, PT sin/cos, 1h training-cell creation, burst standardization, cloglog MAP objective/solver, dynamic context multiplier.
- `lib/radar/contextualBurstProbability.ts` (new): C orchestration: base continuous hazard without B regime, context integration/ablations, ordinary signals, C calibration, coherence, notice policy, audit result.
- `lib/radar/nextGenerationTraining.ts`: parse C saved raw forecasts into `cRows` independently of A/B availability.
- `lib/nextGenerationLogging.ts`: generate C after its own freeze, serialize C audit/ablations, keep A v1 calculation unchanged.
- `lib/logProbability.ts`: extend internal `ExperimentalProbabilityForecast` type with C audit fields and `candidate-c`; no public serialization changes.
- `lib/radar/prospectiveContextualBurstModelEvaluation.ts` (new): same-origin Current/A/B/C prospective comparison plus C raw ablation metrics.
- `scripts/evaluateContextualBurstProbabilityModel.ts` (new): load saved history/random boundaries and emit JSON/Markdown report.
- `package.json`: add `evaluate:prospective-contextual-burst`.
- Tests: `tests/contextualBurstContext.test.ts`, `tests/contextualBurstProbability.test.ts`, `tests/contextualBurstLogging.test.ts`, `tests/prospectiveContextualBurstModelEvaluation.test.ts`; modify `tests/nextGenerationTraining.test.ts`, `tests/nextGenerationLogging.test.ts`, and route-contract test only where necessary.

---

### Task 1: Freeze C identity and context-model constants

**Files:**
- Modify: `data/shadowProbabilityConfig.ts`
- Create: `tests/contextualBurstContext.test.ts`

**Interfaces:**

```ts
export const NEXT_GENERATION_C_MODEL_VERSION = "hazard-contextual-burst-circadian-v1";
export const NEXT_GENERATION_C_FREEZE_AT = "2026-08-22T06:15:00.000Z";
export const NEXT_GENERATION_C_FREEZE_POLICY =
  "A single reset, miss, or new observation must not trigger retuning.";
export const NEXT_GENERATION_C_CONTEXT_PRIOR_STD_DEV = 0.5;
export const NEXT_GENERATION_C_MINIMUM_RANDOM_EVENTS = 15;
export const NEXT_GENERATION_C_MINIMUM_EXPOSURE_CELLS = 720;
export const NEXT_GENERATION_C_MIN_MULTIPLIER = 0.5;
export const NEXT_GENERATION_C_MAX_MULTIPLIER = 2;
export const NEXT_GENERATION_C_SOLVER_MAX_ITERATIONS = 250;
export const NEXT_GENERATION_C_SOLVER_TOLERANCE = 1e-7;
export const NEXT_GENERATION_C_SOLVER_INITIAL_STEP = 1;
export const NEXT_GENERATION_C_SOLVER_BACKTRACKING_FACTOR = 0.5;
export const NEXT_GENERATION_C_SOLVER_MAX_BACKTRACKING_STEPS = 24;
```

C base continuous config should be a versioned copy of B's continuous values, not a mutable alias. C signal config may reference B's already frozen immutable object because the spec requires exact equality; add a test that deep equality holds.

- [ ] **Step 1: Write failing constant-contract tests**

```ts
test("C identity and frozen context constants match the preregistration", () => {
  assert.equal(NEXT_GENERATION_C_MODEL_VERSION, "hazard-contextual-burst-circadian-v1");
  assert.equal(NEXT_GENERATION_C_FREEZE_AT, "2026-08-22T06:15:00.000Z");
  assert.equal(NEXT_GENERATION_C_CONTEXT_PRIOR_STD_DEV, 0.5);
  assert.equal(NEXT_GENERATION_C_MINIMUM_RANDOM_EVENTS, 15);
  assert.equal(NEXT_GENERATION_C_MINIMUM_EXPOSURE_CELLS, 720);
  assert.deepEqual(NEXT_GENERATION_C_FROZEN_SIGNAL_CONFIG, NEXT_GENERATION_B_FROZEN_SIGNAL_CONFIG);
});
```

- [ ] **Step 2: Verify failure**

```powershell
corepack pnpm exec tsx --test tests/contextualBurstContext.test.ts
```

Expected: FAIL because C constants do not exist.

- [ ] **Step 3: Add only the C constants/config block**

Keep every existing public/A/B constant byte-for-byte unchanged.

- [ ] **Step 4: Run the focused test**

```powershell
corepack pnpm exec tsx --test tests/contextualBurstContext.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add data/shadowProbabilityConfig.ts tests/contextualBurstContext.test.ts
git commit -m "feat: freeze contextual burst model constants"
```

---

### Task 2: Implement past-only burst/circadian features and cloglog MAP fit

**Files:**
- Create: `lib/radar/contextualBurstContext.ts`
- Modify: `tests/contextualBurstContext.test.ts`

**Interfaces:**

```ts
export type ContextualBurstRawFeatures = {
  randomResetCount72h: number;
  previousRandomIntervalHours: number | null;
  hourSin: number;
  hourCos: number;
};

export type ContextualBurstCoefficients = {
  count72: number;
  previousInterval: number;
  hourSin: number;
  hourCos: number;
};

export type ContextualBurstFit = {
  coefficients: ContextualBurstCoefficients;
  burstStats: {
    count72Mean: number;
    count72StdDev: number;
    previousIntervalMean: number;
    previousIntervalStdDev: number;
  };
  trainingEventCount: number;
  exposureCellCount: number;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  solver: { converged: boolean; iterations: number; objective: number | null; reason: string | null };
};

export function getPacificHourFeatures(at: Date): { hourSin: number; hourCos: number; localHour: number };
export function getContextualBurstRawFeatures(randomResetTimes: Date[], at: Date): ContextualBurstRawFeatures;
export function fitContextualBurstContext(randomBoundaries: RecoveryResetBoundary[], asOf: Date, hazard: RandomContinuousHazard): ContextualBurstFit;
export function getContextualBurstMultiplier(raw: ContextualBurstRawFeatures, fit: ContextualBurstFit, ablation?: "full" | "noBurst" | "noCircadian"): number;
```

- [ ] **Step 1: Add failing tests for time-zone periodicity and strict past-only features**

Cover:
- noon PT and midnight PT produce opposite sin/cos positions;
- DST dates use `America/Los_Angeles` automatically;
- a reset exactly at `at` is excluded from `randomResetCount72h`;
- a reset older than 72h is excluded;
- previous interval uses the latest two resets strictly before `at`.

Example:

```ts
test("72h burst count uses strict past-only events", () => {
  const at = new Date("2026-08-22T12:00:00.000Z");
  const features = getContextualBurstRawFeatures([
    new Date("2026-08-19T11:59:59.000Z"),
    new Date("2026-08-20T12:00:00.000Z"),
    new Date("2026-08-22T12:00:00.000Z"),
  ], at);
  assert.equal(features.randomResetCount72h, 1);
});
```

- [ ] **Step 2: Add failing synthetic-fit tests**

Create at least 20 random events / >720 exposure cells where events are deliberately concentrated in one PT phase and clustered after short intervals. Assert fitted coefficients are finite, solver converges, and `full` multiplier differs from both ablations. Also test sparse data returns zero coefficients and `fallbackReason === "insufficient_context_history"`.

- [ ] **Step 3: Verify failure**

```powershell
corepack pnpm exec tsx --test tests/contextualBurstContext.test.ts
```

- [ ] **Step 4: Implement PT feature extraction and training cells**

Use `Intl.DateTimeFormat(..., { timeZone: "America/Los_Angeles", hourCycle: "h23", hour, minute, second })`. Build 1h cells only after `previousRandomIntervalHours` becomes defined. Each cell's response is 1 only if its ending random boundary occurs inside that cell. Features are evaluated at the cell start/center using only resets strictly earlier than that feature timestamp.

- [ ] **Step 5: Implement burst transformations**

Use `log1p` for count and previous interval; compute training mean/std from the cells. If a transformed standard deviation is `< 1e-9`, set that normalized feature to 0 and keep its coefficient at 0.

- [ ] **Step 6: Implement cloglog MAP objective and deterministic backtracking gradient descent**

For each cell:

```ts
const cumulative = Math.max(1e-12, baseHazardPerHour * cellDurationHours);
const eta = Math.log(cumulative) + dot(beta, x);
const mu = Math.exp(Math.min(40, Math.max(-40, eta)));
const probability = 1 - Math.exp(-mu);
```

Use stable Bernoulli negative log likelihood plus `sum(beta_i ** 2) / (2 * 0.5 ** 2)`. Gradient for each cell uses `dNll/dEta = mu` when `y=0`, and `-mu * exp(-mu) / max(1e-12, 1-exp(-mu))` when `y=1`, then multiplies by feature values and adds ridge gradient. Backtracking accepts only finite non-increasing objective. On failure or max iterations return the neutral fallback.

- [ ] **Step 7: Implement multiplier and clamp**

`exp(beta · x)` is clamped to `[0.5, 2.0]`; `noBurst` zeros the two burst terms, `noCircadian` zeros sin/cos terms.

- [ ] **Step 8: Run focused tests**

```powershell
corepack pnpm exec tsx --test tests/contextualBurstContext.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add lib/radar/contextualBurstContext.ts tests/contextualBurstContext.test.ts
git commit -m "feat: fit contextual burst hazard factors"
```

---

### Task 3: Build C probability calculation and raw ablations

**Files:**
- Create: `lib/radar/contextualBurstProbability.ts`
- Create: `tests/contextualBurstProbability.test.ts`
- Modify: `lib/radar/randomContinuousProbability.ts` only if a small exported integration/evaluator helper is needed; preserve existing outputs exactly.

**Interfaces:**

```ts
export type ContextualBurstCalibrationRow = {
  generatedAt: string;
  modelVersion: string;
  rawProbability24h: number;
  rawProbability48h: number;
  actual24h?: boolean;
  actual48h?: boolean;
};

export type ContextualBurstAblations = {
  baseOnly: { probability24h: number; probability48h: number };
  noBurst: { probability24h: number; probability48h: number };
  noCircadian: { probability24h: number; probability48h: number };
  fullContext: { probability24h: number; probability48h: number };
  fullRaw: { probability24h: number; probability48h: number };
};

export function calculateContextualBurstProbability(
  data: RadarData | null,
  options: ShadowProbabilityOptions & {
    trainingRows?: ContextualBurstCalibrationRow[];
    trainingReadStatus?: "ok" | "error";
  },
): ContextualBurstProbabilityResult;
```

- [ ] **Step 1: Write failing tests for no-regime baseline and dynamic context integration**

Assert C's base-only 24h/48h matches a Gaussian random-continuous calculation with effective regime multiplier 1 and the frozen C continuous config. Build a synthetic case where a reset falls out of the 72h lookback during the forecast and assert the dynamic full-context probability differs from a fixed-origin multiplier approximation.

- [ ] **Step 2: Write failing tests for ablations and semantic signals**

With neutral signals, `fullRaw === fullContext`. With a strong valid teaser, `fullRaw` increases while `baseOnly/noBurst/noCircadian/fullContext` remain unchanged. Official notice must not alter ablation values.

- [ ] **Step 3: Write failing tests for C calibration/notice ordering**

Assert cold start gives `alpha24h=alpha48h=0`; C rows before the C freeze are excluded; strict 24h/48h resolution and JST daily-first are preserved; official notice applies only after calibration/coherence.

- [ ] **Step 4: Verify failure**

```powershell
corepack pnpm exec tsx --test tests/contextualBurstProbability.test.ts
```

- [ ] **Step 5: Implement C base calculation**

Use `getRecoveryResetEvents(...).filter(isRandom)` and `buildRandomContinuousHazard()` with C frozen continuous values. Do not call/use B's `effectiveRegimeMultiplier` in the integration path.

- [ ] **Step 6: Implement survival-path integration**

At every 10m integration step:
- query base hazard at current random age;
- compute PT sin/cos for the future absolute timestamp;
- recompute 72h count from known past random timestamps relative to that future timestamp;
- keep previous completed interval fixed;
- obtain the selected ablation multiplier;
- trapezoid-integrate `baseLambda * multiplier`.

Return probabilities as `1 - exp(-cumulativeHazard)` for 12/24/48/72h.

- [ ] **Step 7: Apply ordinary signals, then C calibration, coherence, notice**

Reuse B's frozen semantic multiplier config. `rawProbability24h/48h` means `fullContext + ordinary semantic signals`, before calibration/coherence/notice. Reuse the existing MAP logit-intercept helper and B's horizon-coherence helper. C calibration selection filters by `NEXT_GENERATION_C_MODEL_VERSION` and `NEXT_GENERATION_C_FREEZE_AT`.

- [ ] **Step 8: Run focused and random-continuous regression tests**

```powershell
corepack pnpm exec tsx --test tests/contextualBurstProbability.test.ts tests/randomContinuousProbability.test.ts tests/nextGenerationProbability.test.ts
```

Expected: PASS and B/random-continuous values unchanged.

- [ ] **Step 9: Commit**

```powershell
git add lib/radar/contextualBurstProbability.ts lib/radar/randomContinuousProbability.ts tests/contextualBurstProbability.test.ts
git commit -m "feat: add contextual burst probability shadow"
```

---

### Task 4: Persist C and load its future-only calibration rows

**Files:**
- Modify: `lib/radar/nextGenerationTraining.ts`
- Modify: `lib/nextGenerationLogging.ts`
- Modify: `lib/logProbability.ts`
- Modify: `tests/nextGenerationTraining.test.ts`
- Modify: `tests/nextGenerationLogging.test.ts`
- Create: `tests/contextualBurstLogging.test.ts`
- Modify: `tests/nextGenerationRouteContract.test.ts`

**Interfaces:**

`NextGenerationTrainingRows/State` gains:

```ts
cRows: ContextualBurstCalibrationRow[];
```

`ExperimentalProbabilityForecast` gains optional C fields: raw origin features, coefficients, burst normalization stats, context training counts, solver/fallback audit, effective integrated context multipliers, `ablations`, and `nextGenerationRole?: "candidate-a" | "candidate-b" | "candidate-c"`.

- [ ] **Step 1: Add failing parser tests**

A row containing a valid C forecast after `2026-08-22T06:15:00.000Z` must populate `cRows` even if A is incomplete or B is absent. A pre-C-freeze C row must not populate `cRows`. C `actual24h/48h` labels use the same strict random-target rule.

- [ ] **Step 2: Add failing logging tests**

Assert:
- before C freeze: existing A/B behavior only;
- after C freeze: C is added under exact model key;
- A's `componentModelVersions` remains exactly the existing five versions and never contains C;
- DB training-read failure still allows C with calibration alpha 0 and its context fit from reset history; A remains omitted under the existing rule;
- existing forecast objects are not mutated.

- [ ] **Step 3: Verify failure**

```powershell
corepack pnpm exec tsx --test tests/nextGenerationTraining.test.ts tests/nextGenerationLogging.test.ts tests/contextualBurstLogging.test.ts
```

- [ ] **Step 4: Parse C rows independently**

Do not anchor parsing on presence of B. Keep existing `bRows`/`aRows` behavior unchanged, and collect `cRows` from the same history read using C's own freeze/version/raw-probability validation.

- [ ] **Step 5: Serialize C audit**

Add a dedicated `toContextualBurstForecast(result)` in `lib/nextGenerationLogging.ts`. Persist all spec audit fields, including:
`randomResetCount72h`, `previousRandomIntervalHours`, `hourSin`, `hourCos`, coefficients, normalization stats, solver, fit counts, fallback reason, effective multiplier 24h/48h, signal multipliers, calibration audit, freeze metadata, and five ablation pairs.

- [ ] **Step 6: Keep route isolation**

The existing logging route already invokes the next-generation builder after the earlier A/B freeze; C's own freeze guard belongs inside the builder. Update only the route-contract wording/assertion if needed to say A/B/C. `/api/current` must contain no C import/model string.

- [ ] **Step 7: Run focused tests**

```powershell
corepack pnpm exec tsx --test tests/nextGenerationTraining.test.ts tests/nextGenerationLogging.test.ts tests/contextualBurstLogging.test.ts tests/nextGenerationRouteContract.test.ts tests/probabilityForecastPersistence.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add lib/radar/nextGenerationTraining.ts lib/nextGenerationLogging.ts lib/logProbability.ts tests/nextGenerationTraining.test.ts tests/nextGenerationLogging.test.ts tests/contextualBurstLogging.test.ts tests/nextGenerationRouteContract.test.ts
git commit -m "feat: persist contextual burst shadow forecasts"
```

---

### Task 5: Add prospective Current/A/B/C and C-ablation evaluation

**Files:**
- Create: `lib/radar/prospectiveContextualBurstModelEvaluation.ts`
- Create: `tests/prospectiveContextualBurstModelEvaluation.test.ts`
- Create: `scripts/evaluateContextualBurstProbabilityModel.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export function evaluateContextualBurstModelProspectively(
  rows: ProspectiveForecastRow[],
  events: Array<ShadowResetEvent & { isRandom?: boolean }>,
  asOf: Date,
): ContextualBurstModelEvaluationReport;
```

The report must include:
- same-origin Current/A/B/C saved forecast counts and availability;
- daily-first resolved 24h/48h Brier, log loss, calibration, positive counts;
- C minus Current/B differences;
- C ablation metrics for `baseOnly`, `noBurst`, `noCircadian`, `fullContext`, `fullRaw`;
- derived contribution deltas: `noBurst - fullContext`, `noCircadian - fullContext`, `fullContext - fullRaw` in Brier/log loss;
- `insufficient_data` until at least the existing gate levels: 5 target resets, 20 resolved daily 24h, 15 resolved daily 48h;
- auto publish always false.

- [ ] **Step 1: Write failing common-origin/evaluation tests**

Construct rows where one origin lacks C and assert it is excluded from formal Current/A/B/C comparison. Include a regular event with `isRandom:false` and assert it never creates a positive label.

- [ ] **Step 2: Write failing ablation tests**

Use synthetic C audit probabilities where `fullContext` beats `noBurst`; assert report delta sign reflects burst benefit. Missing ablation fields should reduce ablation availability rather than invalidate the main C forecast.

- [ ] **Step 3: Verify failure**

```powershell
corepack pnpm exec tsx --test tests/prospectiveContextualBurstModelEvaluation.test.ts
```

- [ ] **Step 4: Implement evaluator using existing prospective metric conventions**

Reuse/parallel the existing `ProspectiveMetric`/daily-first conventions; do not change the existing A/B report schema or historical reports.

- [ ] **Step 5: Add CLI report writer**

Write:
- `reports/prospective-contextual-burst-model-evaluation.json`
- `reports/prospective-contextual-burst-model-evaluation.md`

Add package script:

```json
"evaluate:prospective-contextual-burst": "tsx scripts/evaluateContextualBurstProbabilityModel.ts"
```

The script should reuse the same Production boundary normalization approach as `scripts/evaluateNextGenerationProbabilityModels.ts` and `loadPredictionHistoryRows()`.

- [ ] **Step 6: Run focused tests and evaluator**

```powershell
corepack pnpm exec tsx --test tests/prospectiveContextualBurstModelEvaluation.test.ts
corepack pnpm run evaluate:prospective-contextual-burst
```

Expected: tests PASS; report is valid JSON/Markdown and normally reports `insufficient_data` immediately after launch.

- [ ] **Step 7: Commit**

```powershell
git add lib/radar/prospectiveContextualBurstModelEvaluation.ts tests/prospectiveContextualBurstModelEvaluation.test.ts scripts/evaluateContextualBurstProbabilityModel.ts package.json reports/prospective-contextual-burst-model-evaluation.json reports/prospective-contextual-burst-model-evaluation.md
git commit -m "feat: evaluate contextual burst model prospectively"
```

---

### Task 6: Document shadow C and perform full verification

**Files:**
- Modify: `docs/probability/next-generation-shadow-models.md`
- Modify only if needed for stable test expectations: generated reports from Task 5

- [ ] **Step 1: Document C without rewriting A/B history**

Add C as an independent third shadow with its own freeze, prospective-only/no-backfill policy, feature set, explicit non-features, and evaluation command. State clearly that A v1 still has exactly five components and does not include C.

- [ ] **Step 2: Run all tests**

```powershell
corepack pnpm test
```

Expected: all tests PASS.

- [ ] **Step 3: Run lint, typecheck, and build**

```powershell
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run build
```

Expected: all succeed.

- [ ] **Step 4: Run both prospective evaluators**

```powershell
corepack pnpm run evaluate:prospective-next-generation
corepack pnpm run evaluate:prospective-contextual-burst
```

Expected: existing A/B report remains valid; C report is generated separately.

- [ ] **Step 5: Verify public isolation**

```powershell
Select-String -Path "app/api/current/route.ts","lib/radar/publishedProbability.ts" -Pattern "hazard-contextual-burst-circadian-v1|contextualBurst" -CaseSensitive
```

Expected: no matches.

- [ ] **Step 6: Check diff hygiene**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended implementation/report/doc changes are present.

- [ ] **Step 7: Commit final docs/report refresh**

```powershell
git add docs/probability/next-generation-shadow-models.md reports/prospective-contextual-burst-model-evaluation.json reports/prospective-contextual-burst-model-evaluation.md
git commit -m "docs: document contextual burst shadow model"
```

- [ ] **Step 8: Push and verify CI/deployment**

```powershell
git push origin main
```

Then confirm the pushed commit's GitHub Actions checks succeed and the Vercel Production deployment becomes READY. Verify `/`, `/en`, `/zh`, and `/api/current` still return 200 and that public probability/model identity remains unchanged.

---

## Completion Criteria

Implementation is complete only when all of the following are true:

1. A post-freeze logging row can contain C with exact version `hazard-contextual-burst-circadian-v1` and full context/ablation audit.
2. C uses only random-reset clock/history; regular resets do not reset or censor it.
3. C base continuous hazard matches the frozen Gaussian baseline with no B activity-regime multiplier.
4. Burst/circadian fit is point-in-time, strongly shrunk, finite, deterministic, and neutral-fallback safe.
5. Future integration updates PT phase and rolling 72h count across the horizon.
6. C ordinary signals equal B v1's frozen policy; raw Tibo volume/weekday/reason/product activity are absent.
7. C calibration learns only from actually saved post-freeze C raw forecasts with strict horizon resolution.
8. A v1's exact five components and existing A/B forecasts/evaluation remain unchanged.
9. Separate prospective C evaluation exposes factor ablations without backfill or auto publication.
10. Full tests, lint, typecheck, build, existing A/B evaluator, C evaluator, CI, Vercel, and public-route smoke checks all pass.
