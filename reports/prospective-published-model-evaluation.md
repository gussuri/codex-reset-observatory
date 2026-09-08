# Prospective Published Model Evaluation

- Status: insufficient_data
- Evaluation mode: prospective
- Backfilled: false
- Evaluation start: 2026-09-01T08:00:26.043Z
- Active model: hazard-regime-random-continuous-calibrated-post-reset-age-v2
- Baseline model: hazard-regime-random-continuous-calibrated-v1
- As of: 2026-09-08T18:31:27.345Z
- Saved forecasts: active=30, baseline=30, comparable=30
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
- 24h: n=7, positive=2, actual=28.57%, mean=54.41%, Brier=0.2405, logLoss=0.6462, targetResets=2
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, Brier=0.2491, logLoss=0.7226, targetResets=3

### hazard-regime-random-continuous-calibrated-v1
- 24h: n=7, positive=2, actual=28.57%, mean=54.41%, Brier=0.2405, logLoss=0.6462, targetResets=2
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, Brier=0.2491, logLoss=0.7226, targetResets=3

### Active minus baseline

- 24h Brier: 0
- 48h Brier: 0
- 24h Log loss: 0
- 48h Log loss: 0
- Resolved forecasts: 24h=7, 48h=7
- Positive forecasts: 24h=2, 48h=4
- Target random reset count: 3

### Manual review gate

- Auto publish: false
- Manual review only: true
- Target resets: 3/5
- Resolved daily 24h: 7/20
- Resolved daily 48h: 7/15
- Eligible for manual review: false

## Post-reset 0-24h diagnostic

This is a separate descriptive diagnostic comparing the active post-reset-age model with the v1 baseline. It never affects the primary gate, status, manual-review eligibility, model selection, or publication.
- All eligible saved origins: 4
- Representative origins (first comparable origin per canonical reset): 2
- banked-reset-2095651088502591861: reset=2026-09-04T03:34:46.386Z, forecast=2026-09-04T05:00:13.033Z
- local-codex-rolling-notice-reset-2026-09-08: reset=2026-09-08T01:30:00.000Z, forecast=2026-09-08T05:06:12.544Z

### 24h
- n=1, positive=1, activeMean=0.2857, baselineMean=0.3987, activeBrier=0.5102, baselineBrier=0.3615, brierDelta=0.1487, activeLogLoss=1.2528, baselineLogLoss=0.9194, logLossDelta=0.3333, meanProbabilityDelta=-0.1130

### 48h
- n=1, positive=1, activeMean=0.6524, baselineMean=0.7037, activeBrier=0.1208, baselineBrier=0.0878, brierDelta=0.0330, activeLogLoss=0.4271, baselineLogLoss=0.3514, logLossDelta=0.0757, meanProbabilityDelta=-0.0513

## Notes

- Only prediction_history rows containing both the active and baseline forecasts are compared.
- Rows before the first comparable forecast are not backfilled and are not relabeled.
- The daily representative is the first saved forecast in each Asia/Tokyo calendar day; unresolved 24h/48h horizons are excluded.
- Target positives are completed broad-scope random reset events only; regular reset boundaries are not random target positives.
- The post-reset 0-24h section is a separate descriptive diagnostic using the first saved comparable origin per canonical random reset; it never affects the primary gate or manual-review status.
- Only forecasts generated at or after the manual adoption boundary 2026-09-01T08:00:00.000Z are evaluated as the adopted public model hazard-regime-random-continuous-calibrated-post-reset-age-v2; earlier rows remain historical data and are not relabeled.
- Prospective results alone never auto-publish or retune a model; manual review is required.
- The stable hazard-elapsed-v1 fallback and hazard-regime-elapsed-v1 shadow parameters remain fixed throughout the evaluation period.
- The hazard-regime-random-continuous-calibrated-post-reset-age-v2 public model is manually governed at the explicit adoption boundary; hazard-regime-random-continuous-calibrated-v1 remains the comparison baseline, and the prospective gate remains not_met.
