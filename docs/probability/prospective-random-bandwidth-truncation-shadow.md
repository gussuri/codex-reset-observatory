# Prospective Random Bandwidth/Truncation Shadow Experiment

## Registration

- Evaluation mode: prospective shadow only.
- Freeze timestamp: `2026-09-02T09:00:00.000Z` (UTC).
- Control: `hazard-regime-random-continuous-post-reset-age-raw-bw24-tr72-v1`.
- Challenger: `hazard-regime-random-continuous-post-reset-age-raw-bw18-tr54-v1`.
- Target: completed broad-scope random resets. Regular resets remain recovery boundaries and are not random positives.
- Backfill: prohibited. Rows before the freeze are not regenerated, relabeled, or evaluated as experiment forecasts.
- Auto publish: prohibited. Any promotion requires manual review.

The control keeps the Production-equivalent raw Gaussian kernel at 24 hours with
72-hour truncation. The challenger is fixed at 18 hours with 54-hour truncation,
which is 25% narrower. Both arms retain the 1-hour grid, 10-minute integration,
local and global priors, probability floor/cap, random/recovery boundary policy,
ordinary signal policy, official notice policy, and the Production post-reset-age
regime policy. Neither arm applies calibration.

The 18/54 values were not selected by fitting historical data and are not claimed
to be optimal. They were preregistered as a conservative 25% narrowing to test
the over-smoothing hypothesis while limiting variance growth relative to 15/45
or 12/36 alternatives.

## Analysis rules

- Do not search 12/36, 15/45, 21/63, or other bandwidth/truncation pairs in this experiment.
- Do not change the parameters after observing results. A changed parameter requires a new model version and a new freeze timestamp.
- Both forecasts must be present in the same `prediction_history` row and share the same origin before a row is comparable.
- The representative forecast is the first saved forecast per Asia/Tokyo calendar day.
- The evaluator preserves the existing random-clock outcome semantics: a random reset is positive, a regular-only first boundary censors the horizon, and no boundary is negative.
- Age diagnostics use the forecast origin's `randomElapsedHours` and are descriptive only. Small buckets must not drive retuning.

## Stored audit

The two forecasts are stored together under
`prediction_history.debug_info.experimentalProbabilityForecasts`. Each retains
model version, origin, 12/24/48/72-hour probabilities, Gaussian bandwidth and
truncation, grid and integration settings, prior settings, random boundary
state, counts, confidence, and post-reset policy. The experiment does not add
these fields to the `public-v1` DTO.

## Evaluation

The report compares challenger minus control for 24-hour and 48-hour average
prediction, actual rate, Brier score, and log loss, with sample counts,
positive counts, and target reset counts. It also reports control and challenger
diagnostics for `[0,24)`, `[24,48)`, `[48,72)`, and `[72, infinity)` age buckets.

Results alone never publish a model, retune parameters, or rewrite historical
forecast rows. The gate is advisory and manual-review-only.

## Subsequent manual corrective adoption

After the frozen prospective experiment, the challenger
`hazard-regime-random-continuous-post-reset-age-raw-bw18-tr54-v1` is scheduled
for a separate manual corrective adoption at
`2026-09-17T08:00:00.000Z` (UTC). This is a public-selector change to an
already frozen challenger, not a new fit, calibration, retuning, or automatic
gate promotion. The preregistered freeze remains `2026-09-02T09:00:00.000Z`.

Before that boundary, historical B v1/B v2/selective-v3/corrective-V4 periods
remain unchanged. At and after the boundary, the public selector may use the
challenger only when its four horizons are finite, bounded, and monotonic. An
invalid or exceptional challenger falls back to the corrective V4 chain. The
existing B1/v2/v3/V4/A/C/C2/context-aware experimental logging continues, and
no historical prediction row is backfilled, relabeled, or rewritten.

The adoption is manual and carries the experiment's uncertainty: the raw
18/54 challenger is not claimed to be universally superior, and a single
reset, miss, or new observation must not trigger parameter changes. The
`public-v1` DTO does not expose challenger audit fields.
