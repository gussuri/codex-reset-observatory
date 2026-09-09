# Corrected Published Hybrid Evaluation

This report is a saved-artifact retrospective counterfactual, not a prospective result.
The historical report is intentionally left unchanged.

- Evaluation mode: saved-artifact-retrospective-counterfactual
- Backfilled: false
- Generated at: 2026-09-09T23:15:09.647Z
- As of: 2026-09-09T23:15:09.647Z
- Historical adoption boundary: 2026-09-01T08:00:00.000Z
- Prediction history rows loaded: 350
- Comparable saved rows: 35
- Daily-first origins: 10
- Source model: hazard-regime-random-continuous-calibrated-post-reset-age-v2
- Companion model for comparable selection: hazard-regime-random-continuous-calibrated-v1
- Counterfactual model: hazard-regime-random-continuous-selective-calibration-post-reset-age-v3
- Point-in-time replay: diagnostic-only-not-used; used for decision=false

## Canonical truth audit

- Excluded false-positive event: `usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec`
- False-positive event absent from canonical truth: true
- Canonical random reset events after historical boundary: 3
- banked-reset-2095651088502591861: 2026-09-04T03:34:46.386Z
- banked-reset-2095651088502591861-observation-20260904T234601897Z: 2026-09-04T23:46:01.897Z
- local-codex-rolling-notice-reset-2026-09-08: 2026-09-08T01:30:00.000Z

## Saved-artifact retrospective counterfactual

### Current v2 (hazard-regime-random-continuous-calibrated-post-reset-age-v2)
- 24h: n=9, positive=3, actual=0.333333, mean=0.572075, bias=0.238741, brier=0.209685, logLoss=0.578715
- 48h: n=8, positive=5, actual=0.625000, mean=0.764173, bias=0.139173, brier=0.218133, logLoss=0.637355

### Selective hybrid v3 (hazard-regime-random-continuous-selective-calibration-post-reset-age-v3)
- 24h: n=9, positive=3, actual=0.333333, mean=0.489373, bias=0.156039, brier=0.152611, logLoss=0.461204
- 48h: n=8, positive=5, actual=0.625000, mean=0.764173, bias=0.139173, brier=0.218133, logLoss=0.637355

### Hybrid minus v2
- 24h Brier: -0.057074
- 48h Brier: 0.000000
- 24h Log loss: -0.117511
- 48h Log loss: 0.000000
- Target reset count: 3
- Resolved horizons: 24h=9, 48h=8

## Per-origin diagnostics

| origin | actual 24h | v2 24h | hybrid 24h | v2 48h | hybrid 48h | notice override | coherence |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2026-09-01T08:00:26.043Z | 0 | 0.597438 | 0.454906 | 0.835748 | 0.835748 | false | false |
| 2026-09-01T16:51:47.016Z | 0 | 0.633416 | 0.492809 | 0.850278 | 0.850278 | false | false |
| 2026-09-02T16:49:13.509Z | 0 | 0.548583 | 0.426800 | 0.767662 | 0.767662 | false | false |
| 2026-09-03T16:38:23.571Z | 1 | 0.460416 | 0.363207 | 0.646643 | 0.646643 | false | false |
| 2026-09-04T16:33:39.803Z | 1 | 0.900000 | 0.900000 | 0.960000 | 0.960000 | true | false |
| 2026-09-05T15:28:58.662Z | 0 | 0.111160 | 0.087017 | 0.308487 | 0.308487 | false | false |
| 2026-09-06T15:42:12.464Z | 0 | 0.557569 | 0.437582 | 0.784565 | 0.784565 | false | false |
| 2026-09-07T21:44:09.200Z | 1 | 0.900000 | 0.900000 | 0.960000 | 0.960000 | true | false |
| 2026-09-08T16:48:51.682Z | 0 | 0.440090 | 0.342033 | 0.758798 | 0.758798 | false | false |
| 2026-09-09T16:51:58.105Z | unresolved | 0.508253 | 0.404647 | 0.771254 | 0.771254 | false | false |

## Saved-artifact audit

- Coherence-adjusted origins: none
- Unexplained saved-final mismatches: none

## Notes

- This is a saved-artifact retrospective counterfactual, not a prospective result.
- The hazard-regime-random-continuous-calibrated-post-reset-age-v2 saved forecast is the source; the hazard-regime-random-continuous-calibrated-v1 forecast is required only to preserve the same daily-first comparable-origin selection.
- The hybrid 24h value uses the saved v2 raw probability unless an explicitly saved policy override must be preserved; hybrid 48h starts from the saved v2 final probability.
- Canonical reset truth is supplied by the existing Production canonical semantics; no reset-history rows are written or relabeled.
- The prospective gate and published-model status are not computed from or changed by this counterfactual.
