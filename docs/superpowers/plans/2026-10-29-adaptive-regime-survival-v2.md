# Adaptive Regime Survival v2 implementation plan

## Scope and guardrails

- [x] Freeze the design from `docs/probability/adaptive-regime-survival-v2.md`; preserve v1 and the dirty historical worktree.
- [x] Start from the reviewed `origin/main` base in the isolated managed worktree.
- [x] Keep public adoption boundary null and v1 as current public model pending Sol review.
- [x] Reuse existing v1 fit, signal, notice, teaser, cache, request and logging paths; do not add a DB/provider call, schema, polling cadence, or context fit.

## Implementation

- [x] Add red tests for regime decay/exposure math, boundary eligibility/deduplication, prior shrinkage/clamps, invalid inputs, and next-event coherence.
- [x] Extract only shared survival/policy helpers needed by v2; establish v1 golden parity before integrating the new arm.
- [x] Implement frozen short-rate correction and compact audit, with safe v1 fallback and unchanged public semantics.
- [x] Register v2 as a non-public candidate and add it to the existing logging cadence without copying raw boundary history.
- [x] Preserve v1/public model identity, localized DTOs, history periods, and adoption boundary behavior.

## Replay and verification

- [x] Retrieve only missing saved v1 PIT audit fields in one bounded read-only query; preserve current source classifications for old origins.
- [x] Prove same-origin v1 replay matches saved probabilities within `1e-9`; use only matched mature origins for both models.
- [x] Report Brier/log-loss, coverage and all fixed slices/resampling from the specification; do not tune this version if a gate fails.
- [x] Benchmark ordinary/long history paths and three-locale/public plus existing logging call counts and CPU.
- [x] Add and run focused regression tests; then sequentially run full tests, lint, typecheck, build, registry check and diffcheck.
- [x] Report code, replay, limitations, verification and performance to Sol; do not publish or change the adoption boundary before independent review.

## Post-review public-boundary preparation

The independent review approved the frozen v2 implementation and the later public-boundary preparation in [`2026-10-29-adaptive-regime-survival-v2-public-adoption.md`](2026-10-29-adaptive-regime-survival-v2-public-adoption.md). The review-phase decision to keep adoption null was followed; the approved plan sets the manual boundary at `2026-10-29T12:20:00.000Z` and preserves v1 history. After final approval, this work is consolidated in one commit and PR; merge and deployment remain with Sol.
