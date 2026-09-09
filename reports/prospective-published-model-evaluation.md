# Prospective Published Model Evaluation

- Status: insufficient_data
- Evaluation mode: prospective
- Backfilled: false
- Evaluation start: 2026-09-01T08:00:26.043Z
- Active model: hazard-regime-random-continuous-calibrated-post-reset-age-v2
- Baseline model: hazard-regime-random-continuous-calibrated-v1
- As of: 2026-09-09T16:40:07.783Z
- Saved forecasts: active=33, baseline=33, comparable=33
- Source: prediction_history.debug_info.experimentalProbabilityForecasts
- Target definition: Completed broad-scope random reset events after reset-history deduplication; includes forced resets and Banked Reset distributions, while excluding regular resets, narrow-scope distributions, pending or opened-only records, rejected Tibo signals, future or invalid timestamps, and reference records.

## Primary prospective evaluation

### Canonical random reset truth
- Post-adoption canonical random reset events: 3
- banked-reset-2095651088502591861: 2026-09-04T03:34:46.386Z
- banked-reset-2095651088502591861-observation-20260904T234601897Z: 2026-09-04T23:46:01.897Z
- local-codex-rolling-notice-reset-2026-09-08: 2026-09-08T01:30:00.000Z

### Daily first forecast comparison

### hazard-regime-random-continuous-calibrated-post-reset-age-v2
- 24h: n=8, positive=3, actual=37.50%, mean=58.86%, Brier=0.2117, logLoss=0.5786, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, Brier=0.2491, logLoss=0.7226, targetResets=3

### hazard-regime-random-continuous-calibrated-v1
- 24h: n=8, positive=3, actual=37.50%, mean=58.86%, Brier=0.2117, logLoss=0.5786, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, Brier=0.2491, logLoss=0.7226, targetResets=3

### Active minus baseline

- 24h Brier: 0
- 48h Brier: 0
- 24h Log loss: 0
- 48h Log loss: 0
- Resolved forecasts: 24h=8, 48h=7
- Positive forecasts: 24h=3, 48h=4
- Target random reset count: 3

## Unified model comparison (retrospective v3 diagnostic)

All five series use the same daily-first saved origins, canonical truth, and resolved-horizon rules. v3 is a retrospective point-in-time counterfactual; it was not saved prospectively and never affects the primary gate or status.
- Shared origins: 9
- Origin timestamps: 2026-09-01T08:00:26.043Z, 2026-09-01T16:51:47.016Z, 2026-09-02T16:49:13.509Z, 2026-09-03T16:38:23.571Z, 2026-09-04T16:33:39.803Z, 2026-09-05T15:28:58.662Z, 2026-09-06T15:42:12.464Z, 2026-09-07T21:44:09.200Z, 2026-09-08T16:48:51.682Z
### Final displayed
- Source: prediction_history.probability_24h/probability_48h
- 24h: n=8, positive=3, actual=37.50%, mean=63.99%, Brier=0.2439, logLoss=0.6555, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=79.96%, Brier=0.3156, logLoss=0.8675, targetResets=3

### v3 uncalibrated post-reset-age candidate
- Source: retrospective point-in-time calculateNextGenerationV3Probability
- 24h: n=8, positive=3, actual=37.50%, mean=55.47%, Brier=0.1675, logLoss=0.5008, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=71.95%, Brier=0.2807, logLoss=0.7497, targetResets=3

### Current v2 calibrated
- Source: prediction_history.debug_info.experimentalProbabilityForecasts
- 24h: n=8, positive=3, actual=37.50%, mean=58.86%, Brier=0.2117, logLoss=0.5786, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, Brier=0.2491, logLoss=0.7226, targetResets=3

### Raw continuous
- Source: saved v2 rawProbability24h/rawProbability48h
- 24h: n=8, positive=3, actual=37.50%, mean=35.35%, Brier=0.2851, logLoss=0.7690, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=55.25%, Brier=0.2941, logLoss=0.7919, targetResets=3

### v1 calibrated
- Source: prediction_history.debug_info.experimentalProbabilityForecasts
- 24h: n=8, positive=3, actual=37.50%, mean=58.86%, Brier=0.2117, logLoss=0.5786, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, Brier=0.2491, logLoss=0.7226, targetResets=3

### Delta versus current v2
- Final displayed: {"brier24h":0.03220492039021036,"brier48h":0.0665822601897954,"logLoss24h":0.07691593323406698,"logLoss48h":0.1449392885543742}
- v3: {"brier24h":-0.044164706770252776,"brier48h":0.03160536184358065,"logLoss24h":-0.07780576240364945,"logLoss48h":0.0271722640149894}
- Raw continuous: {"brier24h":0.07340779532836483,"brier48h":0.0450037025987613,"logLoss24h":0.1904511814619949,"logLoss48h":0.06935155652131997}
- v1: {"brier24h":0,"brier48h":0,"logLoss24h":0,"logLoss48h":0}

### Unified diagnostic subsets
### No official notice
- Origins: 7
- 24h v3: n=6, positive=1, actual=16.67%, mean=43.96%, Brier=0.2200, logLoss=0.6325, targetResets=1
- 48h v3: n=6, positive=3, actual=50.00%, mean=67.94%, Brier=0.3272, logLoss=0.8679, targetResets=3

### No final-display special overlay
- Origins: 7
- 24h v3: n=6, positive=3, actual=50.00%, mean=60.33%, Brier=0.1674, logLoss=0.4920, targetResets=3
- 48h v3: n=5, positive=3, actual=60.00%, mean=73.39%, Brier=0.2789, logLoss=0.7422, targetResets=2

### Official notice override active
- Origins: 2
- 24h v3: n=2, positive=2, actual=100.00%, mean=90.00%, Brier=0.0100, logLoss=0.1054, targetResets=2
- 48h v3: n=1, positive=1, actual=100.00%, mean=96.00%, Brier=0.0016, logLoss=0.0408, targetResets=1

### Latest random reset at 0-24h
- Origins: 1
- 24h v3: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0
- 48h v3: n=0, positive=0, actual=0.00%, mean=0.00%, Brier=0.0000, logLoss=0.0000, targetResets=0

### Manual review gate

- Auto publish: false
- Manual review only: true
- Target resets: 3/5
- Resolved daily 24h: 8/20
- Resolved daily 48h: 7/15
- Eligible for manual review: false

## Post-reset 0-24h diagnostic

This is a separate descriptive diagnostic comparing the active post-reset-age model with the v1 baseline. It never affects the primary gate, status, manual-review eligibility, model selection, or publication.
- All eligible saved origins: 5
- Representative origins (first comparable origin per canonical reset): 2
- banked-reset-2095651088502591861: reset=2026-09-04T03:34:46.386Z, forecast=2026-09-04T05:00:13.033Z
- local-codex-rolling-notice-reset-2026-09-08: reset=2026-09-08T01:30:00.000Z, forecast=2026-09-08T05:06:12.544Z

### 24h
- n=2, positive=1, activeMean=0.3106, baselineMean=0.4235, activeBrier=0.3114, baselineBrier=0.2812, brierDelta=0.0302, activeLogLoss=0.8308, baselineLogLoss=0.7571, logLossDelta=0.0737, meanProbabilityDelta=-0.1129

### 48h
- n=1, positive=1, activeMean=0.6524, baselineMean=0.7037, activeBrier=0.1208, baselineBrier=0.0878, brierDelta=0.0330, activeLogLoss=0.4271, baselineLogLoss=0.3514, logLossDelta=0.0757, meanProbabilityDelta=-0.0513

## Notes

- Only prediction_history rows containing both the active and baseline forecasts are compared.
- Rows before the first comparable forecast are not backfilled and are not relabeled.
- The daily representative is the first saved forecast in each Asia/Tokyo calendar day; unresolved 24h/48h horizons are excluded.
- Target positives are completed broad-scope random reset events only; regular reset boundaries are not random target positives.
- The post-reset 0-24h section is a separate descriptive diagnostic using the first saved comparable origin per canonical random reset; it never affects the primary gate or manual-review status.
- The unified model comparison uses the same daily-first origins and canonical truth for final displayed, v3 retrospective, current v2, raw continuous, and v1 series; v3 is point-in-time retrospective only and never affects the primary gate or status.
- Only forecasts generated at or after the manual adoption boundary 2026-09-01T08:00:00.000Z are evaluated as the adopted public model hazard-regime-random-continuous-calibrated-post-reset-age-v2; earlier rows remain historical data and are not relabeled.
- Prospective results alone never auto-publish or retune a model; manual review is required.
- The stable hazard-elapsed-v1 fallback and hazard-regime-elapsed-v1 shadow parameters remain fixed throughout the evaluation period.
- The hazard-regime-random-continuous-calibrated-post-reset-age-v2 public model is manually governed at the explicit adoption boundary; hazard-regime-random-continuous-calibrated-v1 remains the comparison baseline, and the prospective gate remains not_met.
