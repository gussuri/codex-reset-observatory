# Prospective Next-Generation Probability Model Evaluation

- Status: insufficient_data
- Evaluation mode: prospective
- Backfilled: false
- Freeze at: 2026-08-21T03:27:00.000Z
- As of: 2026-08-21T04:26:38.460Z
- Evaluation start: not started
- Target: Broad-scope random reset probability modeled by elapsed time since the latest broad-scope random reset and the existing point-in-time random-reset regime. Regular resets remain recovery boundaries for product/state logic but do not reset the random-event hazard clock.
- Saved forecasts: public=0, A=0, B=0, comparable=0
- Availability: A=0.0%, B=0.0%, comparable=0.0%

## Daily first comparable forecasts

- Public 24h: n=0, Brier=0.000000, logLoss=0.000000, avg=0.0000, actual=0.0000
- Public 48h: n=0, Brier=0.000000, logLoss=0.000000, avg=0.0000, actual=0.0000
- A 24h: n=0, Brier=0.000000, logLoss=0.000000, avg=0.0000, actual=0.0000
- A 48h: n=0, Brier=0.000000, logLoss=0.000000, avg=0.0000, actual=0.0000
- B 24h: n=0, Brier=0.000000, logLoss=0.000000, avg=0.0000, actual=0.0000
- B 48h: n=0, Brier=0.000000, logLoss=0.000000, avg=0.0000, actual=0.0000

## Comparison

- Target random resets: 0
- Resolved: 24h=0, 48h=0
- Non-overlapping samples: 24h=0, 48h=0
- A minus public Brier: 24h=unavailable, 48h=unavailable
- B minus public Brier: 24h=unavailable, 48h=unavailable
- A minus public log loss: 24h=unavailable, 48h=unavailable
- B minus public log loss: 24h=unavailable, 48h=unavailable

## Manual review gate

- Auto publish: false
- Manual review only: true
- Target resets: 0/5
- Resolved daily: 24h=0/20, 48h=0/15
- A eligible: false
- B eligible: false

## Skip reasons


## Notes

- Only prediction_history rows containing the public model and both exact next-generation models at the same origin are compared.
- Rows before 2026-08-21T03:27:00.000Z are excluded; no forecast is backfilled, regenerated, or relabeled.
- The primary sample is the first comparable forecast in each Asia/Tokyo calendar day.
- Only broad eligible random reset boundaries are targets; regular resets are neither targets nor censoring events.
- Gate results are manual-review diagnostics only and never auto-publish or retune a model.
- Prediction history availability: no row contains the public model and both exact next-generation forecasts at the same origin yet.
- Boundary source: Production Supabase recovery inputs normalized into RadarData; only random boundaries are passed to this evaluator.
