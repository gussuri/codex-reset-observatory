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
| hazard-odds-v3-recency-bayes-h14 | 14 | clearly_better | 0.2404 | 0.2511 |
| hazard-odds-v3-recency-bayes-h30 | 30 | clearly_better | 0.2559 | 0.2852 |
| hazard-odds-v3-recency-bayes-h60 | 60 | clearly_better | 0.2649 | 0.3063 |

## Metrics

### hazard-odds-v2-random-only

- 24h: n=31, actual=35.48%, mean=15.64%, Brier=0.2743, logLoss=0.7987
- 48h: n=31, actual=58.06%, mean=28.51%, Brier=0.3289, logLoss=0.8726
- 24h calibration: 0-20%: n=26, mean=14.50%, actual=42.31%; 20-40%: n=5, mean=21.56%, actual=0.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=6, mean=18.64%, actual=50.00%; 20-40%: n=25, mean=30.87%, actual=60.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%

### hazard-odds-v3-recency-bayes-h14

- 24h: n=31, actual=35.48%, mean=25.03%, Brier=0.2404, logLoss=0.6844
- 48h: n=31, actual=58.06%, mean=43.17%, Brier=0.2511, logLoss=0.6977
- 24h calibration: 0-20%: n=12, mean=15.72%, actual=25.00%; 20-40%: n=19, mean=30.92%, actual=42.11%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=0, mean=0.00%, actual=0.00%; 20-40%: n=12, mean=28.84%, actual=33.33%; 40-60%: n=19, mean=52.23%, actual=73.68%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h -0.0339, 48h -0.0778
- 24h block bootstrap 95% CI: [-0.0663, -0.0107]
- 48h block bootstrap 95% CI: [-0.1170, -0.0234]

### hazard-odds-v3-recency-bayes-h30

- 24h: n=31, actual=35.48%, mean=20.28%, Brier=0.2559, logLoss=0.7314
- 48h: n=31, actual=58.06%, mean=36.13%, Brier=0.2852, logLoss=0.7709
- 24h calibration: 0-20%: n=15, mean=14.37%, actual=33.33%; 20-40%: n=16, mean=25.83%, actual=37.50%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=0, mean=0.00%, actual=0.00%; 20-40%: n=16, mean=27.30%, actual=50.00%; 40-60%: n=15, mean=45.54%, actual=66.67%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h -0.0184, 48h -0.0437
- 24h block bootstrap 95% CI: [-0.0365, -0.0055]
- 48h block bootstrap 95% CI: [-0.0653, -0.0152]

### hazard-odds-v3-recency-bayes-h60

- 24h: n=31, actual=35.48%, mean=17.75%, Brier=0.2649, logLoss=0.7626
- 48h: n=31, actual=58.06%, mean=32.18%, Brier=0.3063, logLoss=0.8185
- 24h calibration: 0-20%: n=17, mean=13.72%, actual=35.29%; 20-40%: n=14, mean=22.64%, actual=35.71%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=2, mean=19.05%, actual=100.00%; 20-40%: n=20, mean=29.26%, actual=60.00%; 40-60%: n=9, mean=41.59%, actual=44.44%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h -0.0094, 48h -0.0226
- 24h block bootstrap 95% CI: [-0.0186, -0.0028]
- 48h block bootstrap 95% CI: [-0.0333, -0.0083]

## Notes

- Models use the same target event definition and signal multiplier path as the current Shadow model.
- Completed interval event and exposure weights use exp(-ln(2) * ageDays / halfLifeDays); censored exposure uses weight 1.
- The fixed bootstrap seed is 20260804 with 7-day blocks and 2000 iterations.
- There are 19 target events and 18 completed intervals available as of 2026-08-01T03:32:00.000Z.
- Daily evaluation origins overlap, so metric differences are not independent.
- The public model remains hazard-odds-v2-random-only; these recency models are Shadow-only experiments.
- No automatic winner is selected. The sample is small and should not be treated as a production adoption decision.
