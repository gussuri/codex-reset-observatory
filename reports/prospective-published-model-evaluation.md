# Prospective Published Model Evaluation

- Status: insufficient_data
- Evaluation mode: prospective
- Backfilled: false
- Evaluation start: 2026-09-01T08:00:26.043Z
- Active model: hazard-regime-random-continuous-calibrated-post-reset-age-v2
- Baseline model: hazard-regime-random-continuous-calibrated-v1
- As of: 2026-09-09T17:24:48.520Z
- Saved forecasts: active=34, baseline=34, comparable=34
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
- 24h: n=9, positive=3, actual=33.33%, mean=57.21%, bias=0.2387, Brier=0.2097, logLoss=0.5787, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, bias=0.1648, Brier=0.2491, logLoss=0.7226, targetResets=3

### hazard-regime-random-continuous-calibrated-v1
- 24h: n=9, positive=3, actual=33.33%, mean=57.62%, bias=0.2429, Brier=0.2135, logLoss=0.5864, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, bias=0.1648, Brier=0.2491, logLoss=0.7226, targetResets=3

### Active minus baseline

- 24h Brier: -0.003824822172768444
- 48h Brier: 0
- 24h Log loss: -0.007704909564350659
- 48h Log loss: 0
- Resolved forecasts: 24h=9, 48h=7
- Positive forecasts: 24h=3, 48h=4
- Target random reset count: 3

## Unified model comparison (retrospective v3 diagnostic)

All six series use the same daily-first saved origins, canonical truth, and resolved-horizon rules. The hybrid and fully uncalibrated candidates are retrospective point-in-time counterfactuals; they were not saved prospectively and never affect the primary gate or status.
- Shared origins: 10
- Origin timestamps: 2026-09-01T08:00:26.043Z, 2026-09-01T16:51:47.016Z, 2026-09-02T16:49:13.509Z, 2026-09-03T16:38:23.571Z, 2026-09-04T16:33:39.803Z, 2026-09-05T15:28:58.662Z, 2026-09-06T15:42:12.464Z, 2026-09-07T21:44:09.200Z, 2026-09-08T16:48:51.682Z, 2026-09-09T16:51:58.105Z
### Final displayed
- Source: prediction_history.probability_24h/probability_48h
- 24h: n=9, positive=3, actual=33.33%, mean=61.76%, bias=0.2842, Brier=0.2382, logLoss=0.6469, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=79.96%, bias=0.2282, Brier=0.3156, logLoss=0.8675, targetResets=3

### v3 uncalibrated post-reset-age candidate
- Source: retrospective point-in-time calculateNextGenerationV3Probability
- 24h: n=9, positive=3, actual=33.33%, mean=53.16%, bias=0.1983, Brier=0.1623, logLoss=0.4924, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=71.95%, bias=0.1481, Brier=0.2807, logLoss=0.7497, targetResets=3

### Selective-calibration hybrid candidate
- Source: retrospective point-in-time calculateNextGenerationSelectiveCalibrationProbability
- 24h: n=9, positive=3, actual=33.33%, mean=53.16%, bias=0.1983, Brier=0.1623, logLoss=0.4924, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=81.50%, bias=0.2436, Brier=0.3168, logLoss=0.8762, targetResets=3

### Current v2 calibrated
- Source: prediction_history.debug_info.experimentalProbabilityForecasts
- 24h: n=9, positive=3, actual=33.33%, mean=57.21%, bias=0.2387, Brier=0.2097, logLoss=0.5787, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, bias=0.1648, Brier=0.2491, logLoss=0.7226, targetResets=3

### Raw continuous
- Source: saved v2 rawProbability24h/rawProbability48h
- 24h: n=9, positive=3, actual=33.33%, mean=35.23%, bias=0.0189, Brier=0.2664, logLoss=0.7301, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=55.25%, bias=-0.0190, Brier=0.2941, logLoss=0.7919, targetResets=3

### v1 calibrated
- Source: prediction_history.debug_info.experimentalProbabilityForecasts
- 24h: n=9, positive=3, actual=33.33%, mean=57.62%, bias=0.2429, Brier=0.2135, logLoss=0.5864, targetResets=3
- 48h: n=7, positive=4, actual=57.14%, mean=73.62%, bias=0.1648, Brier=0.2491, logLoss=0.7226, targetResets=3

### Delta versus current v2
- Final displayed: {"brier24h":0.028511583223424564,"brier48h":0.0665822601897954,"logLoss24h":0.06813627523640275,"logLoss48h":0.1449392885543742}
- Hybrid: {"brier24h":-0.04741267500489332,"brier48h":0.06773416376231822,"logLoss24h":-0.08628064134186525,"logLoss48h":0.1536100624155956}
- v3: {"brier24h":-0.04741267500489332,"brier48h":0.03160536184358065,"logLoss24h":-0.08628064134186525,"logLoss48h":0.0271722640149894}
- Raw continuous: {"brier24h":0.05672999585343347,"brier48h":0.0450037025987613,"logLoss24h":0.15135902054689554,"logLoss48h":0.06935155652131997}
- v1: {"brier24h":0.003824822172768444,"brier48h":0,"logLoss24h":0.007704909564350659,"logLoss48h":0}

### Per-origin diagnostics

#### 2026-09-01T08:00:26.043Z
- 24h actual=0, predictions={"v2":0.5974381606658998,"uncalibrated":0.46519382451577374,"hybrid":0.46519382451577374}, Brier={"v2":0.35693235581985355,"uncalibrated":0.2164052943676125,"hybrid":0.2164052943676125}
- 48h actual=0, predictions={"v2":0.8357482125725314,"uncalibrated":0.7304865900795817,"hybrid":0.8415858599062698}, Brier={"v2":0.6984750748181812,"uncalibrated":0.5336106582860949,"hybrid":0.7082667595941755}
- officialNotice=false, finalDisplayOverlay=false, postReset0To24h=false

#### 2026-09-01T16:51:47.016Z
- 24h actual=0, predictions={"v2":0.6334162269636247,"uncalibrated":0.5004209919453732,"hybrid":0.5004209919453732}, Brier={"v2":0.40121611658083406,"uncalibrated":0.25042116917959123,"hybrid":0.25042116917959123}
- 48h actual=0, predictions={"v2":0.8502781885839132,"uncalibrated":0.7497383693336577,"hybrid":0.8544825390136555}, Brier={"v2":0.7229729979815407,"uncalibrated":0.562107622451092,"hybrid":0.7301404094792232}
- officialNotice=false, finalDisplayOverlay=false, postReset0To24h=false

#### 2026-09-02T16:49:13.509Z
- 24h actual=0, predictions={"v2":0.5485834692993445,"uncalibrated":0.4306095451405199,"hybrid":0.4306095451405199}, Brier={"v2":0.3009438227885049,"uncalibrated":0.18542458036612547,"hybrid":0.18542458036612547}
- 48h actual=1, predictions={"v2":0.7676619646243743,"uncalibrated":0.6295216537564122,"hybrid":0.7710594679011961}, Brier={"v2":0.053980962682205494,"uncalibrated":0.13725420503538371,"hybrid":0.05241376723768348}
- officialNotice=false, finalDisplayOverlay=false, postReset0To24h=false

#### 2026-09-03T16:38:23.571Z
- 24h actual=1, predictions={"v2":0.4604155088515382,"uncalibrated":0.4237786423965198,"hybrid":0.4237786423965198}, Brier={"v2":0.2911514230879444,"uncalibrated":0.33203105295839785,"hybrid":0.33203105295839785}
- 48h actual=1, predictions={"v2":0.6466434438987587,"uncalibrated":0.5999572637645262,"hybrid":0.7215079600480463}, Brier={"v2":0.12486085573972967,"uncalibrated":0.1600341908147649,"hybrid":0.07755781631660058}
- officialNotice=false, finalDisplayOverlay=false, postReset0To24h=false

#### 2026-09-04T16:33:39.803Z
- 24h actual=1, predictions={"v2":0.9,"uncalibrated":0.9,"hybrid":0.9}, Brier={"v2":0.009999999999999995,"uncalibrated":0.009999999999999995,"hybrid":0.009999999999999995}
- 48h actual=1, predictions={"v2":0.96,"uncalibrated":0.96,"hybrid":0.96}, Brier={"v2":0.001600000000000003,"uncalibrated":0.001600000000000003,"hybrid":0.001600000000000003}
- officialNotice=true, finalDisplayOverlay=false, postReset0To24h=false

#### 2026-09-05T15:28:58.662Z
- 24h actual=0, predictions={"v2":0.11116041367120556,"uncalibrated":0.38238121228923594,"hybrid":0.38238121228923594}, Brier={"v2":0.012356637567553544,"uncalibrated":0.14621539151178573,"hybrid":0.14621539151178573}
- 48h actual=0, predictions={"v2":0.3084873734552771,"uncalibrated":0.6847966460360067,"hybrid":0.7746209393887348}, Brier={"v2":0.0951644595813356,"uncalibrated":0.46894644642216377,"hybrid":0.6000375997394859}
- officialNotice=false, finalDisplayOverlay=true, postReset0To24h=false

#### 2026-09-06T15:42:12.464Z
- 24h actual=0, predictions={"v2":0.5575685448235278,"uncalibrated":0.4355087777252968,"hybrid":0.4355087777252968}, Brier={"v2":0.31088268217662635,"uncalibrated":0.18966789547578194,"hybrid":0.18966789547578194}
- 48h actual=1, predictions={"v2":0.7845652986669979,"uncalibrated":0.6819577524337412,"hybrid":0.7818503831988443}, Brier={"v2":0.046412110538439834,"uncalibrated":0.10115087123699742,"hybrid":0.047589255310491095}
- officialNotice=false, finalDisplayOverlay=true, postReset0To24h=false

#### 2026-09-07T21:44:09.200Z
- 24h actual=1, predictions={"v2":0.9,"uncalibrated":0.8999999999999999,"hybrid":0.8999999999999999}, Brier={"v2":0.009999999999999995,"uncalibrated":0.010000000000000018,"hybrid":0.010000000000000018}
- 48h actual=unresolved, predictions={"v2":0.96,"uncalibrated":0.96,"hybrid":0.96}, Brier={"v2":null,"uncalibrated":null,"hybrid":null}
- officialNotice=true, finalDisplayOverlay=false, postReset0To24h=false

#### 2026-09-08T16:48:51.682Z
- 24h actual=0, predictions={"v2":0.440089602075375,"uncalibrated":0.3468175845784699,"hybrid":0.3468175845784699}, Brier={"v2":0.1936788578548619,"uncalibrated":0.12028243697284412,"hybrid":0.12028243697284412}
- 48h actual=unresolved, predictions={"v2":0.7587979219413001,"uncalibrated":0.6404617023037201,"hybrid":0.7588879482260353}, Brier={"v2":null,"uncalibrated":null,"hybrid":null}
- officialNotice=false, finalDisplayOverlay=false, postReset0To24h=true

#### 2026-09-09T16:51:58.105Z
- 24h actual=unresolved, predictions={"v2":0.5082531547539024,"uncalibrated":0.4008376649973422,"hybrid":0.4008376649973422}, Brier={"v2":null,"uncalibrated":null,"hybrid":null}
- 48h actual=unresolved, predictions={"v2":0.7712535220153638,"uncalibrated":0.65043271345223,"hybrid":0.7667706678153703}, Brier={"v2":null,"uncalibrated":null,"hybrid":null}
- officialNotice=false, finalDisplayOverlay=false, postReset0To24h=false

### Unified diagnostic subsets
### No official notice
- Origins: 8
- 24h v2: n=7, positive=1, actual=14.29%, mean=47.84%, bias=0.3355, Brier=0.2667, logLoss=0.7140, targetResets=1
- 24h fully uncalibrated: n=7, positive=1, actual=14.29%, mean=42.64%, bias=0.2835, Brier=0.2058, logLoss=0.6030, targetResets=1
- 24h hybrid: n=7, positive=1, actual=14.29%, mean=42.64%, bias=0.2835, Brier=0.2058, logLoss=0.6030, targetResets=1
- 48h v2: n=6, positive=3, actual=50.00%, mean=69.89%, bias=0.1989, Brier=0.2903, logLoss=0.8362, targetResets=3
- 48h fully uncalibrated: n=6, positive=3, actual=50.00%, mean=67.94%, bias=0.1794, Brier=0.3272, logLoss=0.8679, targetResets=3
- 48h hybrid: n=6, positive=3, actual=50.00%, mean=79.09%, bias=0.2909, Brier=0.3693, logLoss=1.0154, targetResets=3

### No final-display special overlay
- Origins: 8
- 24h v2: n=7, positive=3, actual=42.86%, mean=64.00%, bias=0.2114, Brier=0.2234, logLoss=0.6107, targetResets=3
- 24h fully uncalibrated: n=7, positive=3, actual=42.86%, mean=56.67%, bias=0.1381, Brier=0.1607, logLoss=0.4826, targetResets=3
- 24h hybrid: n=7, positive=3, actual=42.86%, mean=56.67%, bias=0.1381, Brier=0.1607, logLoss=0.4826, targetResets=3
- 48h v2: n=5, positive=3, actual=60.00%, mean=81.21%, bias=0.2121, Brier=0.3204, logLoss=0.8893, targetResets=2
- 48h fully uncalibrated: n=5, positive=3, actual=60.00%, mean=73.39%, bias=0.1339, Brier=0.2789, logLoss=0.7422, targetResets=2
- 48h hybrid: n=5, positive=3, actual=60.00%, mean=82.97%, bias=0.2297, Brier=0.3140, logLoss=0.8794, targetResets=2

### Official notice override active
- Origins: 2
- 24h v2: n=2, positive=2, actual=100.00%, mean=90.00%, bias=-0.1000, Brier=0.0100, logLoss=0.1054, targetResets=2
- 24h fully uncalibrated: n=2, positive=2, actual=100.00%, mean=90.00%, bias=-0.1000, Brier=0.0100, logLoss=0.1054, targetResets=2
- 24h hybrid: n=2, positive=2, actual=100.00%, mean=90.00%, bias=-0.1000, Brier=0.0100, logLoss=0.1054, targetResets=2
- 48h v2: n=1, positive=1, actual=100.00%, mean=96.00%, bias=-0.0400, Brier=0.0016, logLoss=0.0408, targetResets=1
- 48h fully uncalibrated: n=1, positive=1, actual=100.00%, mean=96.00%, bias=-0.0400, Brier=0.0016, logLoss=0.0408, targetResets=1
- 48h hybrid: n=1, positive=1, actual=100.00%, mean=96.00%, bias=-0.0400, Brier=0.0016, logLoss=0.0408, targetResets=1

### Latest random reset at 0-24h
- Origins: 1
- 24h v2: n=1, positive=0, actual=0.00%, mean=44.01%, bias=0.4401, Brier=0.1937, logLoss=0.5800, targetResets=0
- 24h fully uncalibrated: n=1, positive=0, actual=0.00%, mean=34.68%, bias=0.3468, Brier=0.1203, logLoss=0.4259, targetResets=0
- 24h hybrid: n=1, positive=0, actual=0.00%, mean=34.68%, bias=0.3468, Brier=0.1203, logLoss=0.4259, targetResets=0
- 48h v2: n=0, positive=0, actual=0.00%, mean=0.00%, bias=0.0000, Brier=0.0000, logLoss=0.0000, targetResets=0
- 48h fully uncalibrated: n=0, positive=0, actual=0.00%, mean=0.00%, bias=0.0000, Brier=0.0000, logLoss=0.0000, targetResets=0
- 48h hybrid: n=0, positive=0, actual=0.00%, mean=0.00%, bias=0.0000, Brier=0.0000, logLoss=0.0000, targetResets=0

### Manual review gate

- Auto publish: false
- Manual review only: true
- Target resets: 3/5
- Resolved daily 24h: 9/20
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
- The hybrid and fully uncalibrated values are point-in-time retrospective replays. A hybrid 48h value can differ from the persisted current-v2 row because the original v2 input and training snapshot are not replayed verbatim; this diagnostic difference does not alter the primary gate or public model.
- Only forecasts generated at or after the manual adoption boundary 2026-09-01T08:00:00.000Z are evaluated as the adopted public model hazard-regime-random-continuous-calibrated-post-reset-age-v2; earlier rows remain historical data and are not relabeled.
- Prospective results alone never auto-publish or retune a model; manual review is required.
- The stable hazard-elapsed-v1 fallback and hazard-regime-elapsed-v1 shadow parameters remain fixed throughout the evaluation period.
- The hazard-regime-random-continuous-calibrated-post-reset-age-v2 public model is manually governed at the explicit adoption boundary; hazard-regime-random-continuous-calibrated-v1 remains the comparison baseline, and the prospective gate remains not_met.
