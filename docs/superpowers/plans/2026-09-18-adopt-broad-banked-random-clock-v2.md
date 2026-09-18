# Adopt Broad Banked Random Clock v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt `hazard-regime-broad-banked-random-continuous-post-reset-age-raw-bw18-tr54-v2` as the public probability model from the fixed 2026-09-18T06:00:00.000Z boundary while preserving historical model periods, diagnostic shadow arms, prediction rows, and database schema.

**Architecture:** Keep `calculateBroadBankedRandomContinuousShadow()` as the single v2 calculator and add a boundary-aware public selection layer around it. The selector first attempts v2 after the new adoption boundary, falls back to the immediately previous raw 18/54 v1 result on v2 failure or invalid output, and only then continues the existing calibrated/stable fallback chain. Governance metadata and prospective evaluation defaults will use explicit v2/v1 identities without changing stored historical rows.

**Tech Stack:** TypeScript, Node test runner via `tsx`, Next.js, Supabase read paths, existing Radar probability calculators, PowerShell on Windows.

**Spec:** `C:/Users/Yura/.codex/attachments/3bb43fb8-9a8b-4cbc-ab23-bb05c7f2c6a2/貼り付けたテキスト.txt`

## Global Constraints

- Work only in Windows PowerShell; do not use WSL or Bash.
- Start from main `20d8cc9ffdd95c4f138db8026f7c38074ce16d8c` and use branch `adopt/broad-banked-random-clock-v2`.
- Public adoption boundary is exactly `2026-09-18T06:00:00.000Z` / `2026-09-18` (2026-09-18 15:00 JST); do not move it backward or substitute another time.
- Preserve `PUBLISHED_RAW_CONTINUOUS_18_54_ADOPTION_AT = "2026-09-17T05:45:00.000Z"` and all earlier historical boundaries.
- Publish only the broad-banked v2 base/control model; late-neutral, late-no-downward, and pre-reset-frozen arms remain diagnostic shadows.
- Use `BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY` for public v2 calculations and prospective truth boundaries.
- Do not relabel or backfill existing prediction rows; do not change reset history metadata; do not add DB migrations/schema changes; do not call `/api/log-probability` manually.
- Keep diagnostic-only fields and experimental forecast maps out of public DTO/UI.
- Do not merge main, amend existing commits, or force-push.

---

### Task 1: Record public v2 adoption governance

**Files:**
- Modify: `data/shadowProbabilityConfig.ts` near the existing published model aliases and raw 18/54 boundary constants.
- Modify: `docs/probability/published-model-governance.md` and `docs/probability/next-generation-shadow-models.md` only where current public identity and immediately previous public identity are described.
- Modify: `docs/prospective-published-model-evaluation.md` only where the current public prospective comparison is described; preserve historical report identity text.
- Test: `tests/publishedModelGovernance.test.ts`.

**Interfaces:**
- Produce `PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT = "2026-09-18T06:00:00.000Z"`.
- Produce `PUBLISHED_BROAD_BANKED_V2_ADOPTION_DATE = "2026-09-18"`.
- Produce `PUBLISHED_BROAD_BANKED_V2_PREVIOUS_MODEL_VERSION = RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION`.
- Set `PUBLISHED_PROBABILITY_MODEL_VERSION = BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION`.
- Set the current comparison baseline to `RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION` without changing historical adoption constants.

- [ ] **Step 1: Write the failing governance tests**

Add assertions that the v2 model alias, previous model alias, UTC/date boundaries, and preserved raw v1 boundary equal the exact values above; assert every late-age model version is absent from `PUBLISHED_PROBABILITY_MODEL_VERSION`.

- [ ] **Step 2: Run the focused governance test and verify the expected failure**

Run:

```powershell
pnpm exec tsx --test tests/publishedModelGovernance.test.ts
```

Expected: failure because the current public alias still points to raw v1 and the new constants do not exist.

- [ ] **Step 3: Add the constants and update governance wording**

Keep the existing raw v1 adoption constants untouched, add the new v2 boundary constants immediately beside them, and make the public alias point to `BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION`. Update only current-governance prose; label older v3/raw reports as historical.

- [ ] **Step 4: Run governance tests again**

Run the focused command from Step 2 and confirm the new assertions pass while all existing governance assertions remain green.

---

### Task 2: Add v2 public selector, validation, period classification, and raw-v1 fallback

**Files:**
- Modify: `lib/radar/publishedProbability.ts`.
- Test: `tests/publishedProbability.test.ts`.

**Interfaces:**
- Add `PublishedProbabilitySource` value `"broad-banked-raw-continuous"`.
- Add fallback reasons `"broad_banked_v2_exception"` and `"broad_banked_v2_invalid_prediction"`.
- Add `PublishedProbabilityPeriod` value `"broad-banked-v2"`.
- Extend `PublishedProbabilityPeriodOptions` and `PublishedProbabilityOptions` with the v2 adoption boundary while retaining the raw v1 option.
- Add `isValidBroadBankedV2Prediction(result)` requiring the v2 model version, finite ordered P12/P24/P48/P72 values in `[0,1]`.
- Add `broadBankedV2: BroadBankedRandomContinuousShadowResult | null` to `PublishedProbabilityCalculation`.
- Select v2 after `PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT`, then raw v1 after `PUBLISHED_RAW_CONTINUOUS_18_54_ADOPTION_AT`, then existing fallback chain.

- [ ] **Step 1: Write boundary, equivalence, and fallback tests before implementation**

Add tests for:

```typescript
assert.equal(getPublishedProbabilityPeriodAt("2026-09-18T05:59:59.999Z"), "raw-continuous-18-54");
assert.equal(getPublishedProbabilityPeriodAt("2026-09-18T06:00:00.000Z"), "broad-banked-v2");
assert.equal(getPublishedProbabilityPeriodAt("2026-09-18T06:00:00.001Z"), "broad-banked-v2");
```

Inject deterministic calculators into `calculatePublishedProbability` or `selectPublishedProbability` so tests verify that a valid v2 result exactly matches `calculateBroadBankedRandomContinuousShadow` P12/P24/P48/P72/modelVersion; verify v2 exception and invalid prediction choose raw v1 with the corresponding reason; verify invalid raw v1 continues to the existing fallback chain.

- [ ] **Step 2: Run the focused tests and confirm they fail for missing v2 behavior**

Run:

```powershell
pnpm exec tsx --test tests/publishedProbability.test.ts
```

Expected: the new boundary/source/fallback tests fail because v2 is not yet selected and the v2 fields/reasons do not yet exist.

- [ ] **Step 3: Implement the smallest selector change**

Import the v2 calculator/result and constants. Compute the rounded public calculation time once. After the v2 boundary, calculate v2 with the same `publicModelOptions`, validate it with the dedicated validator, and retain either the valid result or a v2 failure reason. Compute raw v1 when its boundary is active or when it is needed as the v2 fallback. Pass both candidates to `selectPublishedProbability`, where valid v2 wins, valid raw v1 is next, and the old calibrated/stable/legacy/heuristic chain follows.

Ensure `broadBankedV2` is populated in every returned calculation object and `rawContinuous` continues to mean only the historical raw 18/54 v1 result.

- [ ] **Step 4: Implement exact period ordering**

Evaluate historical periods first, then raw v1 for timestamps at or after `2026-09-17T05:45:00.000Z` and before `2026-09-18T06:00:00.000Z`, then return `"broad-banked-v2"` at or after the v2 boundary. Preserve rollback and older period behavior for timestamps before the new v2 boundary.

- [ ] **Step 5: Run the focused selector tests**

Run `pnpm exec tsx --test tests/publishedProbability.test.ts tests/publishedModelGovernance.test.ts` and confirm all boundary, equivalence, validation, fallback, and existing selector tests pass.

---

### Task 3: Update public calculation audit metadata without exposing diagnostics

**Files:**
- Modify: `lib/logProbability.ts`.
- Modify: `tests/probabilityAudit.test.ts` and the relevant logging tests.

**Interfaces:**
- When `publishedProbability.adoptedModel` is v2, emit version v2, date `2026-09-18`, adoptionAt `2026-09-18T06:00:00.000Z`, previous model raw v1, and previousAdoptionAt `2026-09-17T05:45:00.000Z`.
- For historical raw v1 rows, keep raw v1 metadata unchanged.
- Read confidence, interval count, and exposure from `publishedProbability.broadBankedV2` for v2; do not use `rawContinuous` as a v2 alias.
- Preserve diagnostic arm fields only in internal saved debug metadata and ensure public projection tests remain free of them.

- [ ] **Step 1: Add failing audit assertions**

Build a fixed post-adoption v2 calculation and assert the generated `publishedProbabilityModel` fields use the v2 identity/boundary/baseline. Build a pre-v2 raw calculation and assert its old metadata remains raw v1. Assert the v2 audit does not derive `rawModelVersion` from the v1 field when a v2 result is available.

- [ ] **Step 2: Run the focused audit tests and confirm the expected failure**

Run:

```powershell
pnpm exec tsx --test tests/probabilityAudit.test.ts tests/probabilityForecastPersistence.test.ts tests/publicDelivery.test.ts
```

Expected: the new v2 metadata assertions fail against the current raw-v1 branch.

- [ ] **Step 3: Update audit selection logic**

Use explicit model identity checks for v2 and raw v1 rather than a generic “current model” assumption. Keep `rawContinuous` historical, add the v2 result to the calculation audit, and preserve existing calibration/interval fallback fields.

- [ ] **Step 4: Run logging/public projection tests**

Run the command from Step 2 and confirm v2 metadata is retained in saved debug information while `toPublicRadarSnapshot` and route DTO tests expose none of the diagnostic-only fields or experimental forecast maps.

---

### Task 4: Move prospective published evaluation to v2 versus raw v1

**Files:**
- Modify: `lib/radar/prospectivePublishedModelEvaluation.ts`.
- Modify: `scripts/evaluatePublishedModelProspectively.ts` and its existing package script only where defaults/imports require the new public boundary.
- Test: `tests/prospectivePublishedModelEvaluation.test.ts` and any evaluator-specific test file.

**Interfaces:**
- Default active model is `BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION`.
- Default baseline is `RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION`.
- Default adoption boundary is `PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT`.
- Canonical truth events for default evaluation are built with `BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY`; narrow/conditional banked events remain excluded.
- Evaluation remains saved-artifact-only, prospective, daily-first, and `backfilled: false`.

- [ ] **Step 1: Add failing evaluator default and truth-policy tests**

Assert report defaults expose v2 as `activeModelVersion`, raw v1 as `baselineModelVersion`, use the 2026-09-18T06:00:00.000Z boundary, exclude pre-boundary rows, include the 2026-06-12 broad banked fixture only under v2 truth, and retain the history record metadata unchanged.

- [ ] **Step 2: Run evaluator tests and confirm they fail**

Run:

```powershell
pnpm exec tsx --test tests/prospectivePublishedModelEvaluation.test.ts tests/probabilityModelEvaluation.test.ts
```

Expected: failures show the current raw-v1/default boundary and old canonical event policy.

- [ ] **Step 3: Update evaluator constants and default boundary**

Use the new v2 constants for default active/baseline/adoption identity. Keep explicit historical evaluation overrides available so existing raw/v3 reports remain reproducible and are not relabeled.

- [ ] **Step 4: Update canonical truth construction**

Replace only the evaluator’s default truth-builder policy with `BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY`. Keep target event extraction point-in-time and read-only; do not write or mutate `LOCAL_RESET_HISTORY` or saved rows.

- [ ] **Step 5: Update evaluator notes and CLI labels**

State that the default comparison is broad-banked v2 versus raw 18/54 v1, that late-age arms remain shadow diagnostics, and that pre-boundary rows are historical and not relabeled.

- [ ] **Step 6: Run evaluator-focused tests**

Run the commands from Step 2 and verify current explicit historical tests plus new v2 default tests pass.

---

### Task 5: Add adoption regression coverage and documentation consistency checks

**Files:**
- Modify: `tests/publishedProbability.test.ts`, `tests/publishedModelGovernance.test.ts`, `tests/prospectivePublishedModelEvaluation.test.ts`, `tests/probabilityAudit.test.ts`, and `tests/publicDelivery.test.ts` as needed.
- Modify: current governance/evaluation docs only; do not edit historical report identities.

- [ ] **Step 1: Add the 6/12 semantics regression**

Compare `getRecoveryResetEvents` under legacy and v2 policy for `personal-reset-credit-2026-06-11`; assert the legacy path is not random, the v2 path is random and regular as already defined, and the source history row remains `recordKind = "banked_distribution"` and `cycleType = "定期リセット"`.

- [ ] **Step 2: Add public late-age exclusion checks**

Assert `calculatePublishedProbability` can return v2 base/control output but never selects any v1/v2 late-age diagnostic arm as `adoptedModel`; assert diagnostic-only fields and `experimentalProbabilityForecasts` remain absent from public DTO/UI snapshots.

- [ ] **Step 3: Add governance/document assertions**

Assert current governance names v2 and raw v1, exact UTC boundaries, manual adoption, no backfill/auto-publish, and shadow-only late-age arms. Assert historical published evaluation documents retain their original identities.

- [ ] **Step 4: Run all focused adoption tests**

Run:

```powershell
pnpm exec tsx --test tests/publishedProbability.test.ts tests/publishedModelGovernance.test.ts tests/prospectivePublishedModelEvaluation.test.ts tests/probabilityAudit.test.ts tests/probabilityForecastPersistence.test.ts tests/publicDelivery.test.ts tests/broadBankedRandomClockV2.test.ts
```

Expected: all focused tests pass with no public DTO leakage and no history mutation.

---

### Task 6: Production read-only snapshot and final validation

**Files:**
- Modify: no production code unless a focused test exposes a requirement gap.
- Test: existing focused suites only.

- [ ] **Step 1: Run production snapshot read-only**

Use the existing read-only production input loader and fixed rounded calculation times before and after the adoption boundary. Call no logging route. Capture v1/v2 P12/P24/P48/P72, differences, random boundary/interval counts, max interval, regime/effective multipliers, and latest random reset. If an official notice is active, report override and pre-override baseline separately.

- [ ] **Step 2: Run complete validation**

Run:

```powershell
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
git diff --check
```

Also verify no changed path exists under `supabase/`, no existing prediction rows were written, and public route/UI smoke checks contain no diagnostic-only fields.

- [ ] **Step 3: Review the diff and commit**

Confirm changed files are limited to governance/selector/audit/evaluator/tests/docs/plan, with no model semantics outside the requested public v2 adoption, no freeze changes, no DB migrations, and no history data edits. Commit exactly:

```powershell
git add data/shadowProbabilityConfig.ts lib/radar/publishedProbability.ts lib/logProbability.ts lib/radar/prospectivePublishedModelEvaluation.ts scripts/evaluatePublishedModelProspectively.ts tests docs/superpowers/plans
git commit -m "feat: adopt broad banked random clock v2"
```

- [ ] **Step 4: Push the feature branch only**

Run:

```powershell
git push origin adopt/broad-banked-random-clock-v2
```

Verify local and remote branch SHA match, `main` remains at its pre-adoption SHA, and working tree is clean. Do not merge main.

## Self-review checklist

- Spec sections 1–3: branch, exact adoption boundary, public identity and previous model are covered by Tasks 1 and 5.
- Spec sections 4–10: selector order, v2 validation, fallback audit, calculation audit, period classification, v2 policy, and shadow-only late-age arms are covered by Tasks 2–3 and 5.
- Spec sections 11–14: log metadata, prospective active/baseline defaults, v2 truth policy, and continued experimental logging are covered by Tasks 3–4.
- Spec sections 15–16: public DTO/UI isolation and no DB/history mutations are covered by Tasks 3, 5, and 6.
- Spec sections 17–22: boundary, equivalence, fallback, 6/12, governance, and logging tests are covered by Tasks 2, 3, and 5.
- Spec sections 23–26: read-only Production snapshot, full validation, exact commit/push, and final report are covered by Task 6.
- No placeholders or unspecified model versions remain in the tasks; all dates, identities, policies, and commands are explicit.
