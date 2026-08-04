# Recency-Weighted Probability Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three fixed-half-life, recency-weighted Bayesian hazard models for internal comparison while keeping `hazard-odds-v2-random-only` as the public model.

**Architecture:** Reuse `getShadowCompletedResetEvents()` and the existing Shadow signal multiplier path. Generalize only the hazard accumulation step so v2 keeps unit weights and v3 applies the same event/exposure decay weight. A standalone walk-forward evaluator will build point-in-time training sets from the same event type, calculate deterministic metrics/bootstrap intervals, and write JSON/Markdown reports. Existing `prediction_history.debug_info` is the only candidate persistence surface; no new table or public DTO field will be introduced.

**Tech Stack:** Next.js/TypeScript, Node test runner via `tsx --test`, `tsx` evaluation scripts, Supabase JSON `debug_info`.

## Global Constraints

- Keep `hazard-odds-v2-random-only` as the public model and preserve its output for the same inputs.
- Candidate models are fixed: `hazard-odds-v3-recency-bayes-h14`, `hazard-odds-v3-recency-bayes-h30`, and `hazard-odds-v3-recency-bayes-h60`.
- Use completed global-scope random resets only; exclude regular resets, credit grants, pending/opened-only, rejected, future/invalid, narrow-scope, and duplicate events.
- Apply `exp(-ln(2) * ageDays / halfLifeDays)` to both completed interval event and exposure; current censored exposure uses weight 1.
- Preserve existing priors, signal multipliers, official 90%/96% override, public DTO, UI, translations, and Supabase schema.
- Walk-forward origins are 00:00 JST, use only events at or before the origin for training, and treat events strictly after the origin as future labels.
- Reports use explicit `asOf`, default `LOCAL_MODEL_UPDATED_AT`, and fixed bootstrap seed `20260804`.

### Task 1: Shared hazard weighting and recency Shadow models

**Files:**
- Modify: `lib/radar/shadowProbability.ts`
- Modify: `data/shadowProbabilityConfig.ts`
- Create: `lib/radar/recencyWeightedProbability.ts`
- Test: `tests/recencyWeightedProbability.test.ts`

**Interfaces:**
- `buildShadowHazard(events, now, options?)` keeps its current two-argument behavior and accepts an optional completed-interval weight callback.
- `calculateRecencyWeightedShadowProbability(data, halfLifeDays, options?)` returns a `ShadowProbabilityResult`-compatible internal result with model-specific hazard audit counts.
- The recency module consumes `getShadowCompletedResetEvents()` and `calculateShadowSignalMultipliers()`; it does not implement a second event extractor or a second signal multiplier formula.

- [ ] Add failing tests for half-life weights, equal event/exposure decay, invalid half-life rejection, shared event filtering, probability ordering, and official override.
- [ ] Run `npm test tests/recencyWeightedProbability.test.ts` and confirm the new behavior fails before implementation.
- [ ] Add fixed model constants and a generic hazard accumulation option with default weight `1` so v2 remains unchanged.
- [ ] Implement the three model wrappers using the shared events, priors, bins, baseline integration, multipliers, and override.
- [ ] Run the focused test and existing Shadow tests; confirm both pass.
- [ ] Commit as `feat: add recency-weighted bayesian shadow models`.

### Task 2: Deterministic walk-forward evaluation and reports

**Files:**
- Create: `scripts/evaluateProbabilityModels.ts`
- Create: `tests/probabilityModelEvaluation.test.ts`
- Modify: `package.json`
- Generate: `reports/probability-model-evaluation.json`
- Generate: `reports/probability-model-evaluation.md`

**Interfaces:**
- Export pure helpers for daily origin generation, leakage-safe training/label partitioning, metric calculation, calibration, block bootstrap, and recommendation classification so tests do not invoke network or Supabase.
- CLI: `npm run evaluate:probability-models -- [--as-of ISO]`.

- [ ] Add failing tests for strict origin boundaries, no future leakage, 24/48 label boundaries, deterministic metrics/bootstrap, calibration buckets, and recommendation rules.
- [ ] Run the focused evaluation test and verify expected failures.
- [ ] Implement daily JST origins after five completed intervals, v2 and all three v3 predictions, epsilon log loss, five calibration buckets, 7-day block bootstrap, and clear temporal-correlation wording.
- [ ] Generate deterministic JSON/Markdown reports with explicit `asOf`, event counts, observation period, model settings, all metrics, confidence intervals, and no automatic winner.
- [ ] Run `npm run evaluate:probability-models` and the focused tests.
- [ ] Commit as `test: add walk-forward probability model evaluation`.

### Task 3: Internal future forecast audit persistence

**Files:**
- Modify: `lib/logProbability.ts`
- Modify: `app/api/log-probability/route.ts`
- Create or modify: focused persistence tests under `tests/`

**Interfaces:**
- Existing `prediction_history` row shape and public response remain unchanged.
- Experimental model forecasts are nested under existing `debug_info` only, keyed by model version and generated timestamp.

- [ ] Add a failing test for a four-model internal audit payload and duplicate key handling without exposing it through the public DTO.
- [ ] Verify that the existing upsert path can calculate and store all four forecasts without a schema change or public API change.
- [ ] Add only the allowlisted internal forecast fields and deterministic `modelVersion + generatedAt` deduplication.
- [ ] If the existing route cannot safely persist all four models without changing schema or making an unsafe extra fetch, leave persistence unchanged and record the exact limitation in the report.
- [ ] Run persistence/public-boundary tests.
- [ ] Commit as `feat: persist experimental probability forecasts` only if code was safely added; otherwise do not create an empty commit.

### Task 4: Full verification and publication

**Files:**
- No additional source files unless verification exposes a regression.

- [ ] Run `npm run check`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run evaluate:probability-models`.
- [ ] Confirm public model, public probabilities, DTO, and UI are unchanged and experimental model names are absent from `/api/current`.
- [ ] Review `git diff`, ensure no secrets or `.env.local` changes, and confirm worktree state.
- [ ] Push `main` and report SHAs, metrics, persistence decision, verification, and push result.
