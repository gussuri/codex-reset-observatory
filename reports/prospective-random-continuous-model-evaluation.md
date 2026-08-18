# Prospective Random Continuous Shadow Evaluation

- Status: insufficient_data
- Evaluation mode: prospective
- Backfilled: false
- Evaluation start: not started
- Active model: hazard-regime-random-continuous-v1
- Baseline model: hazard-regime-random-elapsed-v1
- Freeze at: 2026-08-18T16:14:21.000Z
- As of: 2026-08-18T16:33:40.431Z
- Canonical random boundaries: 26
- Saved forecasts: active=0, baseline=0, comparable=0
- Source: prediction_history.debug_info.experimentalProbabilityForecasts

## Daily first forecast comparison

### hazard-regime-random-continuous-v1
- 24h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0
- 48h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0

### hazard-regime-random-elapsed-v1
- 24h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0
- 48h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0

## Active minus baseline

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

- Only prediction_history rows containing both the continuous shadow and the existing coarse random shadow are compared.
- Rows before 2026-08-18T16:14:21.000Z are excluded; no forecast is backfilled, regenerated, or relabeled.
- The daily representative is the first saved forecast in each Asia/Tokyo calendar day.
- A regular-only boundary inside a scored horizon is censored; no-boundary horizons are negative and random boundaries are positive.
- The continuous and coarse random shadows use the same Production-equivalent recovery boundary set.
- Prospective results alone never auto-publish or retune a model; manual review is required.
- The continuous shadow parameters are frozen at 2026-08-18T16:14:21.000Z; A single reset, miss, or new observation must not trigger retuning.
- Boundary source: Production Supabase recovery inputs normalized into RadarData; local static history is not synchronized or backfilled.
