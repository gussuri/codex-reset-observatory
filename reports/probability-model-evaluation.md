# Probability Model Evaluation

- asOf: 2026-08-01T03:32:00.000Z
- Target events: 19
- Completed intervals: 18
- Origins: 31
- Observation period: 2026-05-16T17:51:00.000Z to 2026-08-01T03:32:00.000Z

## Models

| Model | Half-life | Classification | 24h Brier | 48h Brier |
| --- | ---: | --- | ---: | ---: |
| hazard-odds-v2-random-only | none | baseline | 0.2743 | 0.3289 |
| hazard-odds-v3-recency-bayes-h14-r2 | 14 | no_meaningful_difference | 0.2757 | 0.3326 |
| hazard-odds-v3-recency-bayes-h30-r2 | 30 | no_meaningful_difference | 0.2750 | 0.3319 |
| hazard-odds-v3-recency-bayes-h60-r2 | 60 | no_meaningful_difference | 0.2746 | 0.3308 |

## Metrics

### hazard-odds-v2-random-only

- 24h: n=31, actual=35.48%, mean=15.64%, Brier=0.2743, logLoss=0.7987
- 48h: n=31, actual=58.06%, mean=28.51%, Brier=0.3289, logLoss=0.8726
- 24h calibration: 0-20%: n=26, mean=14.50%, actual=42.31%; 20-40%: n=5, mean=21.56%, actual=0.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=6, mean=18.64%, actual=50.00%; 20-40%: n=25, mean=30.87%, actual=60.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%

### hazard-odds-v3-recency-bayes-h14-r2

- 24h: n=31, actual=35.48%, mean=15.09%, Brier=0.2757, logLoss=0.8116
- 48h: n=31, actual=58.06%, mean=27.11%, Brier=0.3326, logLoss=0.8903
- 24h calibration: 0-20%: n=22, mean=12.32%, actual=40.91%; 20-40%: n=9, mean=21.85%, actual=22.22%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=12, mean=15.36%, actual=33.33%; 20-40%: n=17, mean=33.69%, actual=82.35%; 40-60%: n=2, mean=41.70%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0014, 48h +0.0037
- 24h block bootstrap 95% CI: [-0.0066, 0.0087]
- 48h block bootstrap 95% CI: [-0.0116, 0.0190]

### hazard-odds-v3-recency-bayes-h30-r2

- 24h: n=31, actual=35.48%, mean=15.33%, Brier=0.2750, logLoss=0.8047
- 48h: n=31, actual=58.06%, mean=27.60%, Brier=0.3319, logLoss=0.8837
- 24h calibration: 0-20%: n=22, mean=12.82%, actual=40.91%; 20-40%: n=9, mean=21.48%, actual=22.22%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=9, mean=16.53%, actual=44.44%; 20-40%: n=21, mean=31.70%, actual=66.67%; 40-60%: n=1, mean=41.23%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0007, 48h +0.0030
- 24h block bootstrap 95% CI: [-0.0051, 0.0068]
- 48h block bootstrap 95% CI: [-0.0070, 0.0135]

### hazard-odds-v3-recency-bayes-h60-r2

- 24h: n=31, actual=35.48%, mean=15.48%, Brier=0.2746, logLoss=0.8014
- 48h: n=31, actual=58.06%, mean=27.98%, Brier=0.3308, logLoss=0.8789
- 24h calibration: 0-20%: n=25, mean=13.97%, actual=44.00%; 20-40%: n=6, mean=21.78%, actual=0.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=8, mean=17.47%, actual=50.00%; 20-40%: n=22, mean=31.25%, actual=63.64%; 40-60%: n=1, mean=40.21%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0004, 48h +0.0019
- 24h block bootstrap 95% CI: [-0.0033, 0.0043]
- 48h block bootstrap 95% CI: [-0.0041, 0.0085]

## Notes

- Models use the same target event definition and signal multiplier path as the current Shadow model.
- Completed interval event and exposure weights use exp(-ln(2) * ageDays / halfLifeDays); censored exposure uses weight 1.
- The fixed bootstrap seed is 20260804 with 7-day blocks and 2000 iterations.
- There are 19 target events and 18 completed intervals available as of 2026-08-01T03:32:00.000Z.
- Daily evaluation origins overlap, so metric differences are not independent.
- The public model remains hazard-odds-v2-random-only; these recency models are Shadow-only experiments.
- No automatic winner is selected. The sample is small and should not be treated as a production adoption decision.
