# Prospective Probability Evaluation

- Status: insufficient_data
- Evaluation mode: prospective
- Backfilled: false
- Evaluation start: not started
- As of: 2026-08-04T09:59:31.375Z
- Source: prediction_history.debug_info.experimentalProbabilityForecasts
- Target definition: Same random-reset target definition as hazard-odds-v2-random-only.

## Models

### hazard-odds-v2-random-only
- 24h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, period=none..none, resets=0
- 48h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, period=none..none, resets=0

### hazard-odds-v4-logit-calibrated-prequential-v1
- 24h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, period=none..none, resets=0
- 48h: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, period=none..none, resets=0

## Difference versus v2

- 24h Brier: 0
- 48h Brier: 0
- 24h Log loss: 0
- 48h Log loss: 0
- Resolved daily forecasts: 24h=0, 48h=0
- Target reset count: 0

## Adoption gate

- Automatic publication: false
- Target resets: 0/5
- Resolved daily 24h: 0/20
- Resolved daily 48h: 0/15
- 24h Brier not worse: true
- 48h Brier not worse: true
- One horizon clearly improved: false
- Log loss not extremely worse: true

## Notes

- This is a prospective evaluation of forecasts saved after the v4 deployment point.
- Existing prediction_history rows are not backfilled or relabeled as v4 forecasts.
- The primary comparison uses the first saved forecast per Asia/Tokyo calendar day.
- Passing the gate never changes the public model automatically; manual review is required.
- Data availability: No prediction_history rows contain both v2 and v4 experimental forecasts yet.
- The public model remains hazard-odds-v2-random-only.
