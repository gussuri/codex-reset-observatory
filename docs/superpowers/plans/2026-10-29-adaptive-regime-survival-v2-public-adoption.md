# Adaptive Regime Survival v2 Public Adoption Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Schedule Adaptive Regime Survival v2 as the public model at the explicit 2026-10-29T12:20:00.000Z boundary while preserving every earlier v1 period and saved identity.

**Architecture:** Reuse the existing published selector and model registry. The global model pointer names v2, while the boundary keeps all earlier calculations on Survival-Conditioned v1 and an explicit null override rolls back to v1.

**Tech Stack:** TypeScript, Node test runner, pnpm scripts, generated model-registry documentation.

**Spec:** `docs/probability/adaptive-regime-survival-v2.md`

## Global Constraints

- Adoption boundary: `2026-10-29T12:20:00.000Z` / `2026-10-29 21:20 JST`.
- Previous public model: `hazard-survival-conditioned-adaptive-h45-tail-h24-v1`.
- Preserve all frozen parameters, historical saved rows, and v1 calculations before the boundary.
- After final independent review, consolidate the changes in one commit, push once, and open a main-targeted PR; do not merge, deploy, or change database state.
- Preserve the explicit comparison overrides in the offline benchmark and evaluator so results do not depend on the current public pointer.

## Review Focus

- Times one millisecond before, exactly at, and after the configured boundary select the expected public period and model.
- An explicit null v2 adoption override after the boundary selects v1 as the rollback path.
- Fixed historical origins before the boundary retain the v1 identity and probabilities.
- Registry pointers, model roles, public period bounds, logs, and docs agree on the current and previous identities.
- Offline comparison reproduces null-versus-v2 adoption regardless of the global current model and labels wall-clock measurement time separately from forecast origin.

---

### Task 1: Public model boundary and registry

**Files:**
- Modify: `data/shadowProbabilityConfig.ts`
- Modify: `data/probabilityModelRegistry.ts`
- Modify: `lib/radar/publishedProbability.ts` only if existing boundary behavior cannot express the required rollback
- Test: `tests/publishedProbability.test.ts`
- Test: `tests/probabilityModelRegistry.test.ts`

**Interfaces:**
- Consumes: the existing `publishedAdaptiveRegimeSurvivalAdoptionAt` selector option.
- Produces: global current pointer v2, previous pointer v1, v2 adoption date/time constants, and a contiguous public period registry.

- [x] Write failing tests for the default boundary before/at/after, explicit null rollback, and pre-boundary v1 history.
- [x] Run the focused tests and confirm the expected red failures.
- [x] Set the current and previous model pointers, adoption boundary/date, and model roles/statuses.
- [x] Keep the selector using v1 before the boundary and v2 at/after it; keep null override on v1.
- [x] Run the focused tests and verify all boundary identities and period bounds.

### Task 2: Reproducible comparison and governance documents

**Files:**
- Modify: `scripts/benchmarkAdaptiveRegimeSurvivalV2.ts`
- Modify: `reports/probability/adaptive-regime-survival-v2-benchmark.md`
- Modify: `docs/probability/adaptive-regime-survival-v2.md`
- Regenerate: `docs/probability/model-registry.md`
- Modify: tests covering model governance and benchmark reproduction as needed.

**Interfaces:**
- Consumes: explicit null and v2 adoption overrides in the local public-snapshot benchmark.
- Produces: comparisons independent of the global current pointer and docs with measured time distinct from forecast origin.

- [x] Add regression coverage for reproducible explicit comparison overrides after global adoption is configured.
- [x] Run the focused comparison and governance tests and verify they fail before implementation.
- [x] Update benchmark metadata, registry output, and v2 adoption documentation without retuning model parameters.
- [x] Run focused tests and the benchmark to verify unchanged comparison call counts and regenerated docs.

### Task 3: Local verification and handoff

**Files:**
- No additional implementation files.

- [x] Run focused tests, full tests, lint, typecheck, build, model-registry check, and `git diff --check`.
- [x] Verify the branch HEAD and current `origin/main`; report the HEAD, changed files, and results to Sol.
- [ ] After Sol approval, commit once, push the branch once, open and attach the PR, then report CI/Preview status; leave merge and deployment to Sol.
