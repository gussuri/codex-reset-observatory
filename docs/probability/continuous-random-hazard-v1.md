# Preregistration: random continuous hazard shadow v1

- Model version: `hazard-regime-random-continuous-v1`
- Preregistration/freeze timestamp: `2026-08-18T16:14:21.000Z` (UTC)
- Evaluation mode: prospective only
- Public model: unchanged
- Database/API/UI: unchanged

## Scope

This is a shadow-only estimator for the same broad-scope random reset target used by
`hazard-regime-random-elapsed-v1`. Confirmed global hard resets and broad Banked Reset
distributions are included. Regular resets are recovery boundaries for state and audit
purposes, but they are not random target events and do not reset the random clock.

The runtime input is fixed to the existing production path:

1. Build the Production-equivalent `RadarData`.
2. Call `getRecoveryResetEvents(data, now)`.
3. Extract random boundaries with the same eligibility and deduplication policy used by
   `hazard-regime-random-elapsed-v1`.

The continuous estimator and the existing coarse random shadow must therefore receive the
same boundary IDs and timestamps. The local static-history fixture is not backfilled with
Production's later three boundaries for this preregistration.

## Frozen estimator

- Mode: full, including the existing point-in-time regime and signal/notice multipliers.
- Random clock: elapsed time since the latest broad random boundary.
- Exposure: each completed random-to-random interval contributes exposure from age 0 to its
  endpoint; the latest random-to-now interval contributes right-censored exposure only.
- Kernel: Gaussian, bandwidth 24 hours, evaluated on a 1-hour exposure grid, truncated at
  plus or minus 72 hours, with no later retuning or fitted parameter selection.
- Local prior: 2 exposure-days over the 48-hour local prior window.
- Global prior, probability clamps, signal multipliers, official notice overrides, and
  integration semantics are reused from the existing random shadow.
- Future horizons are integrated numerically at a step no larger than 10 minutes and must
  satisfy `12h <= 24h <= 48h <= 72h`.
- The stored diagnostic probes are fixed at ages `96h`, `120h`, `132h`, `144h`, `156h`,
  `168h`, `192h`, and `216h`; the probe set is descriptive only and is not fit or tuned.

## Evaluation protocol

- Only `prediction_history` rows saved after the freeze timestamp are eligible.
- No historical forecast is generated, relabeled, or backfilled.
- A comparable row must contain both the continuous forecast and the existing
  `hazard-regime-random-elapsed-v1` forecast in the same experimental forecast map.
- The existing coarse random shadow is the baseline for the continuous-shadow comparison.
- The first saved forecast per Asia/Tokyo calendar day is the primary representative; any
  denser diagnostic is explicitly overlapping and is not the primary score.
- Regular-only outcomes are censored; random boundaries are positive; no boundary is negative.
- Prospective results never auto-publish or retune a model. Manual review is required.

The current fixed-origin discrepancy of 23 local-static random timestamps versus 26
Production random boundaries is recorded as an evaluation-data-source limitation. It is not
resolved by injecting the three later Production events into historical origins.

## Freeze rule

The parameters above are frozen for this evaluation. A single reset, miss, or new observation
must not trigger retuning. Any future model change requires a new model version and a new
preregistration.
