# Probability Model Evaluation

- asOf: 2026-08-01T03:32:00.000Z
- Target events: 19
- Completed intervals: 18
- Origins: 31
- Observation period: 2026-05-16T17:51:00.000Z to 2026-08-01T03:32:00.000Z
- Non-overlapping 48h origins: 16

## Models

| Model | Half-life | Classification | 24h Brier | 48h Brier |
| --- | ---: | --- | ---: | ---: |
| hazard-odds-v2-random-only | none | baseline | 0.2743 | 0.3289 |
| benchmark-constant-hazard-v1 | none | no_meaningful_difference | 0.2714 | 0.3319 |
| benchmark-v2-logit-calibrated-prequential-v1 | none | clearly_better | 0.2591 | 0.2850 |
| hazard-odds-v3-recency-bayes-h14-r2 | 14 | no_meaningful_difference | 0.2757 | 0.3326 |
| hazard-odds-v3-recency-bayes-h30-r2 | 30 | no_meaningful_difference | 0.2750 | 0.3319 |
| hazard-odds-v3-recency-bayes-h60-r2 | 60 | no_meaningful_difference | 0.2746 | 0.3308 |

## Metrics

### hazard-odds-v2-random-only

- 24h: n=31, actual=35.48%, mean=15.64%, Brier=0.2743, logLoss=0.7987
- 48h: n=31, actual=58.06%, mean=28.51%, Brier=0.3289, logLoss=0.8726
- 24h calibration: 0-20%: n=26, mean=14.50%, actual=42.31%; 20-40%: n=5, mean=21.56%, actual=0.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=6, mean=18.64%, actual=50.00%; 20-40%: n=25, mean=30.87%, actual=60.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Non-overlapping 48h: n=16, actual=56.25%, mean=28.22%, Brier=0.3302, logLoss=0.8783

### benchmark-constant-hazard-v1

- 24h: n=31, actual=35.48%, mean=14.59%, Brier=0.2714, logLoss=0.7836
- 48h: n=31, actual=58.06%, mean=26.96%, Brier=0.3319, logLoss=0.8752
- 24h calibration: 0-20%: n=31, mean=14.59%, actual=35.48%; 20-40%: n=0, mean=0.00%, actual=0.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=3, mean=19.87%, actual=100.00%; 20-40%: n=28, mean=27.72%, actual=53.57%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h -0.0029, 48h +0.0030
- 24h block bootstrap 95% CI: [-0.0063, 0.0002]
- 48h block bootstrap 95% CI: [-0.0105, 0.0160]
- Non-overlapping 48h: n=16, actual=56.25%, mean=26.91%, Brier=0.3283, logLoss=0.8688
- Non-overlapping 48h difference vs v2: Brier -0.0019, logLoss -0.0095

### benchmark-v2-logit-calibrated-prequential-v1

- 24h: n=31, actual=35.48%, mean=21.73%, Brier=0.2591, logLoss=0.7452
- 48h: n=31, actual=58.06%, mean=37.77%, Brier=0.2850, logLoss=0.7774
- 24h calibration: 0-20%: n=15, mean=12.55%, actual=33.33%; 20-40%: n=16, mean=30.33%, actual=37.50%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=7, mean=18.82%, actual=57.14%; 20-40%: n=9, mean=27.93%, actual=44.44%; 40-60%: n=15, mean=52.51%, actual=66.67%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h -0.0152, 48h -0.0439
- 24h block bootstrap 95% CI: [-0.0367, -0.0017]
- 48h block bootstrap 95% CI: [-0.0801, -0.0107]
- Non-overlapping 48h: n=16, actual=56.25%, mean=37.53%, Brier=0.2979, logLoss=0.8060
- Non-overlapping 48h difference vs v2: Brier -0.0323, logLoss -0.0723

### hazard-odds-v3-recency-bayes-h14-r2

- 24h: n=31, actual=35.48%, mean=15.09%, Brier=0.2757, logLoss=0.8116
- 48h: n=31, actual=58.06%, mean=27.11%, Brier=0.3326, logLoss=0.8903
- 24h calibration: 0-20%: n=22, mean=12.32%, actual=40.91%; 20-40%: n=9, mean=21.85%, actual=22.22%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=12, mean=15.36%, actual=33.33%; 20-40%: n=17, mean=33.69%, actual=82.35%; 40-60%: n=2, mean=41.70%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0014, 48h +0.0037
- 24h block bootstrap 95% CI: [-0.0066, 0.0087]
- 48h block bootstrap 95% CI: [-0.0116, 0.0190]
- Non-overlapping 48h: n=16, actual=56.25%, mean=26.89%, Brier=0.3313, logLoss=0.8921
- Non-overlapping 48h difference vs v2: Brier +0.0011, logLoss +0.0138

### hazard-odds-v3-recency-bayes-h30-r2

- 24h: n=31, actual=35.48%, mean=15.33%, Brier=0.2750, logLoss=0.8047
- 48h: n=31, actual=58.06%, mean=27.60%, Brier=0.3319, logLoss=0.8837
- 24h calibration: 0-20%: n=22, mean=12.82%, actual=40.91%; 20-40%: n=9, mean=21.48%, actual=22.22%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=9, mean=16.53%, actual=44.44%; 20-40%: n=21, mean=31.70%, actual=66.67%; 40-60%: n=1, mean=41.23%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0007, 48h +0.0030
- 24h block bootstrap 95% CI: [-0.0051, 0.0068]
- 48h block bootstrap 95% CI: [-0.0070, 0.0135]
- Non-overlapping 48h: n=16, actual=56.25%, mean=27.33%, Brier=0.3315, logLoss=0.8861
- Non-overlapping 48h difference vs v2: Brier +0.0013, logLoss +0.0078

### hazard-odds-v3-recency-bayes-h60-r2

- 24h: n=31, actual=35.48%, mean=15.48%, Brier=0.2746, logLoss=0.8014
- 48h: n=31, actual=58.06%, mean=27.98%, Brier=0.3308, logLoss=0.8789
- 24h calibration: 0-20%: n=25, mean=13.97%, actual=44.00%; 20-40%: n=6, mean=21.78%, actual=0.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=8, mean=17.47%, actual=50.00%; 20-40%: n=22, mean=31.25%, actual=63.64%; 40-60%: n=1, mean=40.21%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0004, 48h +0.0019
- 24h block bootstrap 95% CI: [-0.0033, 0.0043]
- 48h block bootstrap 95% CI: [-0.0041, 0.0085]
- Non-overlapping 48h: n=16, actual=56.25%, mean=27.69%, Brier=0.3311, logLoss=0.8825
- Non-overlapping 48h difference vs v2: Brier +0.0009, logLoss +0.0043

## Diagnostics

- Age structure: age_structure_inconclusive
- Calibration: underprediction_calibration_signal
- Constant hazard daily comparison: no_meaningful_difference
- Calibrated v2 daily comparison: clearly_better
- Non-overlapping 48h direction: constant=better, calibrated=better

## Label and event contribution

- Daily labels: 24h positive=11/31, 48h positive=18/31
- Non-overlapping 48h labels: positive=9/16

| Event | Reset at | Positive daily origins (24h) | Positive daily origins (48h) |
| --- | --- | ---: | ---: |
| local-gpt-55-degradation-compensation-2026-05-17 | 2026-05-16T17:51:00.000Z | 0 | 0 |
| local-sam-like-promise-reset-2026-05-20 | 2026-05-19T18:39:18.000Z | 0 | 0 |
| local-long-session-compression-compensation-2026-05-24 | 2026-05-23T20:14:00.000Z | 0 | 0 |
| local-5m-users-celebration-2026-05-31 | 2026-05-31T15:25:06.000Z | 0 | 0 |
| local-codex-reliability-compensation-2026-06-04 | 2026-06-04T00:25:58.000Z | 0 | 0 |
| local-codex-forced-comp-reset-2026-06-29 | 2026-06-29T00:00:00.000Z | 0 | 0 |
| local-codex-forced-reset-2026-06-30 | 2026-06-30T00:30:00.000Z | 1 | 1 |
| local-codex-gpt-5-6-release-reset-2026-07-10 | 2026-07-09T22:00:00.000Z | 1 | 2 |
| local-codex-gpt-5-6-sol-release-reset-2-2026-07-11 | 2026-07-10T18:26:00.000Z | 1 | 2 |
| local-codex-gpt-5-6-sol-release-reset-3-2026-07-11 | 2026-07-11T06:00:00.000Z | 1 | 2 |
| local-codex-6m-users-reset-2026-07-13 | 2026-07-12T18:30:00.000Z | 1 | 2 |
| local-codex-8m-users-reset-2026-07-15 | 2026-07-14T20:45:00.000Z | 1 | 2 |
| local-codex-9m-users-reset-2026-07-16 | 2026-07-16T04:15:00.000Z | 1 | 2 |
| local-codex-gpt-5-6-sol-release-reset-4-2026-07-18 | 2026-07-18T03:31:00.000Z | 1 | 2 |
| local-codex-10m-users-reset-2026-07-22 | 2026-07-21T17:05:00.000Z | 1 | 2 |
| local-codex-outage-compensation-reset-2026-07-26 | 2026-07-25T19:17:00.000Z | 1 | 2 |
| local-codex-chatgpt-work-adoption-reset-2026-07-28 | 2026-07-28T03:09:00.000Z | 1 | 2 |
| local-codex-gpt56-sol-efficiency-reset-2026-07-29 | 2026-07-29T04:09:00.000Z | 1 | 2 |
| local-luna-100k-threads-efficiency-reset-2026-08-01 | 2026-08-01T03:32:00.000Z | 0 | 0 |

## Prequential calibration

- Prior: Normal(0, 0.5^2)
- Minimum samples: 10
- Final audit: alpha24h=0.719332, alpha48h=0.848584, samples24h=30, samples48h=29

## Notes

- Models use the same target event definition and signal multiplier path as the current Shadow model.
- The constant hazard benchmark uses the v2 global lambda and censored exposure without age bins.
- Prequential calibration uses only pastOrigin + horizon <= currentOrigin, a fixed Normal(0, 0.5^2) prior, and a minimum of 10 confirmed samples.
- The fixed bootstrap seed is 20260804 with 7-day blocks and 2000 iterations for overlapping daily comparisons.
- There are 19 target events and 18 completed intervals available as of 2026-08-01T03:32:00.000Z.
- Benchmark models are evaluation-only and are not written to experimentalProbabilityForecasts or used by the public model.
- Daily evaluation origins overlap, so daily metric differences are not independent.
- The non-overlapping 48h section is a lower-sample reference analysis.
- The public model remains hazard-odds-v2-random-only; benchmark models are evaluation-only.
- Benchmark results do not change API responses, UI, DTOs, Supabase, or stored Shadow forecasts.
- No automatic winner is selected from an inconclusive result.
