# Prospective Published Model Evaluation

- Status: insufficient_data
- Evaluation mode: prospective
- Backfilled: false
- Evaluation start: 2026-08-08T14:59:40.532Z
- Active model: hazard-regime-elapsed-v1
- Baseline model: hazard-odds-v3-recency-bayes-h30-r3
- As of: 2026-08-08T15:14:50.369Z
- Saved forecasts: active=1, baseline=11, comparable=1
- Source: prediction_history.debug_info.experimentalProbabilityForecasts
- Target definition: Completed broad-scope random reset events after reset-history deduplication; includes forced resets and Banked Reset distributions, while excluding regular resets, narrow-scope distributions, pending or opened-only records, rejected Tibo signals, future or invalid timestamps, and reference records.

## Daily first forecast comparison

### hazard-regime-elapsed-v1
- 24h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0
- 48h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0

### hazard-odds-v3-recency-bayes-h30-r3
- 24h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0
- 48h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0

## Active minus baseline

- 24h Brier: unavailable
- 48h Brier: unavailable
- 24h Log loss: unavailable
- 48h Log loss: unavailable
- Resolved forecasts: 24h=0, 48h=0
- Positive forecasts: 24h=0, 48h=0
- Target random reset count: 0

## Manual review gate

- Auto publish: false
- Manual review only: true
- Target resets: 0/5
- Resolved daily 24h: 0/20
- Resolved daily 48h: 0/15
- Eligible for manual review: false

## Notes

- Only prediction_history rows containing both the active and baseline forecasts are compared.
- Rows before the first comparable forecast are not backfilled and are not relabeled.
- The daily representative is the first saved forecast in each Asia/Tokyo calendar day; unresolved 24h/48h horizons are excluded.
- Target positives are completed broad-scope random reset events only; regular reset boundaries are not random target positives.
- Prospective results alone never auto-publish or retune a model; manual review is required.
- hazard-regime-elapsed-v1 parameters remain fixed throughout the evaluation period.
