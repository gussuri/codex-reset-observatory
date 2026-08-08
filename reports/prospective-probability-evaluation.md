# Prospective Probability Evaluation

- Status: insufficient_data
- Evaluation mode: prospective
- Backfilled: false
- Evaluation start: 2026-08-04T12:26:50.674Z
- Active candidate model: hazard-odds-v4-logit-calibrated-prequential-v2
- Archived candidate models: hazard-odds-v4-logit-calibrated-prequential-v1
- As of: 2026-08-08T14:32:35.394Z
- Source: prediction_history.debug_info.experimentalProbabilityForecasts
- Target definition: Same random-reset target definition as hazard-regime-elapsed-v1; this archived comparison reads hazard-odds-v2-random-only rows where available.

## Models

### hazard-odds-v2-random-only
- 24h: n=2, positive=0, actual=0.00%, mean=23.80%, Brier=0.0567, logLoss=0.2718, period=2026-08-04T12:26:50.674Z..2026-08-04T15:04:12.378Z, resets=0
- 48h: n=2, positive=0, actual=0.00%, mean=39.63%, Brier=0.1570, logLoss=0.5046, period=2026-08-04T12:26:50.674Z..2026-08-04T15:04:12.378Z, resets=0

### hazard-odds-v4-logit-calibrated-prequential-v2
- 24h: n=2, positive=0, actual=0.00%, mean=36.72%, Brier=0.1349, logLoss=0.4577, period=2026-08-04T12:26:50.674Z..2026-08-04T15:04:12.378Z, resets=0
- 48h: n=2, positive=0, actual=0.00%, mean=59.69%, Brier=0.3563, logLoss=0.9088, period=2026-08-04T12:26:50.674Z..2026-08-04T15:04:12.378Z, resets=0

## Difference versus v2

- 24h Brier: 0.07821387237202732
- 48h Brier: 0.19931252593641813
- 24h Log loss: 0.185814479215632
- 48h Log loss: 0.4041464219818429
- Resolved daily forecasts: 24h=2, 48h=2
- Target reset count: 0

## Adoption gate

- Automatic publication: false
- Target resets: 0/5
- Resolved daily 24h: 2/20
- Resolved daily 48h: 2/15
- 24h Brier not worse: false
- 48h Brier not worse: false
- One horizon clearly improved: false
- Log loss not extremely worse: false

## Notes

- This is a prospective evaluation of forecasts saved after the active v4-v2 deployment point.
- Existing prediction_history rows are not backfilled or relabeled as v4 forecasts.
- Rows are filtered to the active v2 and v4 candidates before selecting the first saved forecast per Asia/Tokyo calendar day.
- Archived candidate models are excluded from the active comparison: hazard-odds-v4-logit-calibrated-prequential-v1.
- Passing the gate never changes the public model automatically; manual review is required.
- The active public model is hazard-regime-elapsed-v1; this report retains the archived hazard-odds-v2-random-only comparison.
