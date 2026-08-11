# Prospective Random-Clock Shadow Evaluation

- Status: insufficient_data
- Evaluation mode: prospective
- Backfilled: false
- Evaluation start: not started
- Shadow model: hazard-regime-random-elapsed-v1
- Public baseline: hazard-regime-elapsed-v1
- Freeze at: 2026-08-12T00:00:00.000Z
- As of: 2026-08-11T18:31:51.650Z
- Saved forecasts: shadow=0, public=53, comparable=0
- Source: prediction_history.debug_info.experimentalProbabilityForecasts
- Target definition: Broad-scope random reset probability modeled by elapsed time since the latest broad-scope random reset and the existing point-in-time random-reset regime. Regular resets remain recovery boundaries for product/state logic but do not reset the random-event hazard clock.

## Daily first forecast comparison

### hazard-regime-random-elapsed-v1
- 24h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0
- 48h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0

### hazard-regime-elapsed-v1
- 24h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0
- 48h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0

## Shadow minus public baseline

- 24h Brier: unavailable
- 48h Brier: unavailable
- 24h Log loss: unavailable
- 48h Log loss: unavailable
- Resolved forecasts: 24h=0, 48h=0
- Positive random resets: 24h=0, 48h=0
- Target random reset count: 0

## Manual review gate

- Auto publish: false
- Manual review only: true
- Target resets: 0/5
- Resolved daily 24h: 0/20
- Resolved daily 48h: 0/15
- Eligible for manual review: false

## Notes

- Only prediction_history rows containing both the random-clock shadow and published forecasts are compared.
- Rows before the first comparable forecast are not backfilled and are not relabeled.
- The daily representative is the first saved forecast in each Asia/Tokyo calendar day.
- A regular-only boundary inside a scored horizon is censored; no-boundary horizons are scored as negative and random boundaries are positive.
- Target positives are completed broad-scope random reset boundaries only; regular resets are never random positives.
- Prospective results alone never auto-publish or retune a model; manual review is required.
- The random-clock shadow parameters are frozen at 2026-08-12T00:00:00.000Z; A single reset, miss, or new observation must not trigger retuning.
