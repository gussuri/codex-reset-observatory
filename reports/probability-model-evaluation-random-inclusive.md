# Probability Model Evaluation

- asOf: 2026-08-01T03:32:00.000Z
- Target events: 23
- Completed intervals: 22
- Origins: 42
- Observation period: 2026-05-16T17:51:00.000Z to 2026-08-01T03:32:00.000Z
- Non-overlapping 48h origins: 21

## Models

| Model | Half-life | Classification | 24h Brier | 48h Brier |
| --- | ---: | --- | ---: | ---: |
| hazard-odds-v3-recency-bayes-h30-r2 | 30 | baseline | 0.2536 | 0.2964 |
| hazard-odds-v3-random-inclusive | none | no_meaningful_difference | 0.2558 | 0.2991 |
| benchmark-constant-hazard-v1 | none | no_meaningful_difference | 0.2608 | 0.3049 |
| benchmark-v2-logit-calibrated-prequential-v1 | none | promising_but_inconclusive | 0.2408 | 0.2676 |
| hazard-odds-v3-recency-bayes-h14-r2 | 14 | no_meaningful_difference | 0.2540 | 0.2979 |
| hazard-odds-v3-recency-bayes-h60-r2 | 60 | no_meaningful_difference | 0.2543 | 0.2972 |

## Metrics

### hazard-odds-v3-recency-bayes-h30-r2

- 24h: n=42, actual=35.71%, mean=18.64%, Brier=0.2536, logLoss=0.7229
- 48h: n=42, actual=57.14%, mean=32.54%, Brier=0.2964, logLoss=0.7959
- 24h calibration: 0-20%: n=24, mean=13.43%, actual=29.17%; 20-40%: n=18, mean=25.59%, actual=44.44%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=5, mean=19.11%, actual=40.00%; 20-40%: n=25, mean=29.23%, actual=60.00%; 40-60%: n=12, mean=45.04%, actual=58.33%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Non-overlapping 48h: n=21, actual=57.14%, mean=32.84%, Brier=0.2875, logLoss=0.7753

### hazard-odds-v3-random-inclusive

- 24h: n=42, actual=35.71%, mean=18.53%, Brier=0.2558, logLoss=0.7282
- 48h: n=42, actual=57.14%, mean=32.65%, Brier=0.2991, logLoss=0.8005
- 24h calibration: 0-20%: n=28, mean=14.97%, actual=28.57%; 20-40%: n=14, mean=25.66%, actual=50.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=2, mean=19.33%, actual=50.00%; 20-40%: n=31, mean=30.37%, actual=58.06%; 40-60%: n=9, mean=43.47%, actual=55.56%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0021, 48h +0.0027
- 24h block bootstrap 95% CI: [-0.0016, 0.0055]
- 48h block bootstrap 95% CI: [-0.0088, 0.0125]
- Non-overlapping 48h: n=21, actual=57.14%, mean=33.02%, Brier=0.2898, logLoss=0.7783
- Non-overlapping 48h difference vs public model: Brier +0.0023, logLoss +0.0031

### benchmark-constant-hazard-v1

- 24h: n=42, actual=35.71%, mean=16.97%, Brier=0.2608, logLoss=0.7428
- 48h: n=42, actual=57.14%, mean=30.91%, Brier=0.3049, logLoss=0.8128
- 24h calibration: 0-20%: n=27, mean=14.40%, actual=33.33%; 20-40%: n=15, mean=21.60%, actual=40.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=0, mean=0.00%, actual=0.00%; 20-40%: n=41, mean=30.67%, actual=58.54%; 40-60%: n=1, mean=40.82%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0072, 48h +0.0085
- 24h block bootstrap 95% CI: [-0.0064, 0.0295]
- 48h block bootstrap 95% CI: [-0.0079, 0.0278]
- Non-overlapping 48h: n=21, actual=57.14%, mean=30.75%, Brier=0.2998, logLoss=0.8011
- Non-overlapping 48h difference vs public model: Brier +0.0123, logLoss +0.0259

### benchmark-v2-logit-calibrated-prequential-v1

- 24h: n=42, actual=35.71%, mean=24.92%, Brier=0.2408, logLoss=0.6860
- 48h: n=42, actual=57.14%, mean=41.87%, Brier=0.2676, logLoss=0.7347
- 24h calibration: 0-20%: n=17, mean=13.99%, actual=23.53%; 20-40%: n=20, mean=29.80%, actual=50.00%; 40-60%: n=5, mean=42.54%, actual=20.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=2, mean=19.33%, actual=50.00%; 20-40%: n=18, mean=29.78%, actual=50.00%; 40-60%: n=17, mean=51.30%, actual=70.59%; 60-80%: n=5, mean=62.33%, actual=40.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h -0.0128, 48h -0.0288
- 24h block bootstrap 95% CI: [-0.0440, 0.0093]
- 48h block bootstrap 95% CI: [-0.0664, 0.0106]
- Non-overlapping 48h: n=21, actual=57.14%, mean=42.00%, Brier=0.2528, logLoss=0.7015
- Non-overlapping 48h difference vs public model: Brier -0.0347, logLoss -0.0738

### hazard-odds-v3-recency-bayes-h14-r2

- 24h: n=42, actual=35.71%, mean=18.33%, Brier=0.2540, logLoss=0.7264
- 48h: n=42, actual=57.14%, mean=31.99%, Brier=0.2979, logLoss=0.8018
- 24h calibration: 0-20%: n=23, mean=12.28%, actual=30.43%; 20-40%: n=19, mean=25.66%, actual=42.11%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=10, mean=17.95%, actual=40.00%; 20-40%: n=20, mean=30.67%, actual=65.00%; 40-60%: n=12, mean=45.89%, actual=58.33%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0004, 48h +0.0015
- 24h block bootstrap 95% CI: [-0.0015, 0.0024]
- 48h block bootstrap 95% CI: [-0.0059, 0.0106]
- Non-overlapping 48h: n=21, actual=57.14%, mean=32.16%, Brier=0.2902, logLoss=0.7840
- Non-overlapping 48h difference vs public model: Brier +0.0027, logLoss +0.0088

### hazard-odds-v3-recency-bayes-h60-r2

- 24h: n=42, actual=35.71%, mean=18.65%, Brier=0.2543, logLoss=0.7243
- 48h: n=42, actual=57.14%, mean=32.65%, Brier=0.2972, logLoss=0.7969
- 24h calibration: 0-20%: n=26, mean=14.31%, actual=26.92%; 20-40%: n=16, mean=25.69%, actual=50.00%; 40-60%: n=0, mean=0.00%, actual=0.00%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- 48h calibration: 0-20%: n=2, mean=18.97%, actual=50.00%; 20-40%: n=29, mean=29.13%, actual=55.17%; 40-60%: n=11, mean=44.40%, actual=63.64%; 60-80%: n=0, mean=0.00%, actual=0.00%; 80-100%: n=0, mean=0.00%, actual=0.00%
- Difference vs current Brier: 24h +0.0007, 48h +0.0009
- 24h block bootstrap 95% CI: [-0.0007, 0.0019]
- 48h block bootstrap 95% CI: [-0.0047, 0.0052]
- Non-overlapping 48h: n=21, actual=57.14%, mean=33.00%, Brier=0.2880, logLoss=0.7753
- Non-overlapping 48h difference vs public model: Brier +0.0005, logLoss +0.0000

## Diagnostics

- Age structure: age_structure_inconclusive
- Calibration: calibration_inconclusive
- Constant hazard daily comparison: no_meaningful_difference
- Calibrated v2 daily comparison: promising_but_inconclusive
- Non-overlapping 48h direction: constant=worse, calibrated=better

## Label and event contribution

- Daily labels: 24h positive=15/42, 48h positive=24/42
- Non-overlapping 48h labels: positive=12/21

| Event | Reset at | Positive daily origins (24h) | Positive daily origins (48h) |
| --- | --- | ---: | ---: |
| local-gpt-55-degradation-compensation-2026-05-17 | 2026-05-16T17:51:00.000Z | 0 | 0 |
| local-sam-like-promise-reset-2026-05-20 | 2026-05-19T18:39:18.000Z | 0 | 0 |
| local-long-session-compression-compensation-2026-05-24 | 2026-05-23T20:14:00.000Z | 0 | 0 |
| local-5m-users-celebration-2026-05-31 | 2026-05-31T15:25:06.000Z | 0 | 0 |
| local-codex-reliability-compensation-2026-06-04 | 2026-06-04T00:25:58.000Z | 0 | 0 |
| personal-compensation-reset-credit-2026-06-18 | 2026-06-17T22:00:00.000Z | 0 | 0 |
| personal-compensation-reset-credit-2026-06-27 | 2026-06-27T03:00:00.000Z | 1 | 2 |
| local-codex-forced-comp-reset-2026-06-29 | 2026-06-29T00:00:00.000Z | 1 | 2 |
| local-codex-forced-reset-2026-06-30 | 2026-06-30T00:30:00.000Z | 1 | 2 |
| personal-codex-reset-button-aie-2026-07-02 | 2026-07-01T20:50:00.000Z | 1 | 2 |
| local-codex-gpt-5-6-release-reset-2026-07-10 | 2026-07-09T22:00:00.000Z | 1 | 2 |
| local-codex-gpt-5-6-sol-release-reset-2-2026-07-11 | 2026-07-10T18:26:00.000Z | 1 | 2 |
| local-codex-gpt-5-6-sol-release-reset-3-2026-07-11 | 2026-07-11T06:00:00.000Z | 1 | 2 |
| local-codex-6m-users-reset-2026-07-13 | 2026-07-12T18:30:00.000Z | 1 | 2 |
| personal-tibo-7m-users-banked-reset-2026-07-14 | 2026-07-13T18:40:00.000Z | 1 | 2 |
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
- Final audit: alpha24h=0.666192, alpha48h=0.766437, samples24h=41, samples48h=40

## Notes

- Models use the same target event definition and signal multiplier path as the public probability model.
- The constant hazard benchmark uses the v2 global lambda and censored exposure without age bins.
- Prequential calibration uses only pastOrigin + horizon <= currentOrigin, a fixed Normal(0, 0.5^2) prior, and a minimum of 10 confirmed samples.
- The fixed bootstrap seed is 20260804 with 7-day blocks and 2000 iterations for overlapping daily comparisons.
- There are 23 target events and 22 completed intervals available as of 2026-08-01T03:32:00.000Z.
- Benchmark models are evaluation-only and are not written to experimentalProbabilityForecasts or used by the public model.
- Daily evaluation origins overlap, so daily metric differences are not independent.
- The non-overlapping 48h section is a lower-sample reference analysis.
- The public model is hazard-odds-v3-recency-bayes-h30-r2; hazard-odds-v3-random-inclusive remains the unweighted comparison baseline.
- Benchmark results do not change API responses, UI, DTOs, Supabase, or stored Shadow forecasts.
- No automatic winner is selected from an inconclusive result.
