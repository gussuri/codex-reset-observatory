# Reset Regime × Elapsed Probability Evaluation

- model: hazard-elapsed-v1
- asOf: 2026-08-13T06:20:00.000Z
- input mode: production-point-in-time
- source asOf: 2026-08-13T06:20:00.000Z
- source checkedAt: 2026-08-13T06:20:00.000Z
- future leakage policy: availability-timestamps-v1
- backfilled: false
- mode: walk-forward-prequential
- origins: 218 (every 6h)
- target events: 26
- recovery boundaries: 30
- labels: 24h scored=207, censored=11; 48h scored=199, censored=19
- non-overlap labels: 24h scored=53, censored=2; 48h scored=26, censored=2
- selected bins/prior/half-life: A / 2d / 3d

## Current snapshot

- latest random reset: 2026-08-13T03:34:43.341Z
- latest recovery boundary: 2026-08-13T03:34:43.341Z
- elapsed since recovery boundary: 2.75h
- old h30-r3: 12h=9.32%, 24h=19.09%, 48h=42.32%, 72h=58.98%
- elapsed-only: 12h=7.15%, 24h=21.80%, 48h=48.43%, 72h=62.36%
- regime-only: 12h=19.33%, 24h=34.93%, 48h=57.66%, 72h=72.45%
- new model: 12h=7.15%, 24h=21.80%, 48h=48.43%, 72h=62.36%
- regime diagnostics: {"recentWeightedEventCount":2.073212210948166,"recentWeightedExposureDays":4.328085116992881,"recentRatePerDay":0.4856464718996325,"longTermRatePerDay":0.29827616629203135,"rawRateRatio":1.6281772624908746,"regimeMultiplier":1.6281772624908746,"halfLifeDays":3,"priorEventCount":1,"priorExposureDays":2,"rawRandomEventCount":26,"observationStartAt":"2026-05-16T17:51:00.000Z"}

## Metrics

| Model | 24h Brier | 48h Brier | 24h log loss | 48h log loss | non-overlap 24h n | non-overlap 48h n |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| hazard-odds-v3-recency-bayes-h30-r3 | 0.2524 | 0.3051 | 0.7202 | 0.8141 | 53 | 26 |
| benchmark-constant-hazard-v1 | 0.2576 | 0.3139 | 0.7347 | 0.8314 | 53 | 26 |
| hazard-elapsed-v1 | 0.2527 | 0.2991 | 0.7201 | 0.8002 | 53 | 26 |
| hazard-regime-elapsed-v1-regime-only | 0.2447 | 0.2871 | 0.7032 | 0.7851 | 53 | 26 |
| hazard-regime-elapsed-v1 | 0.2434 | 0.2783 | 0.7005 | 0.7672 | 53 | 26 |

### hazard-odds-v3-recency-bayes-h30-r3

- 24h: n=207, actual=35.27%, mean=20.18%, Brier=0.2524, logLoss=0.7202, AUC=0.5319, sd=0.0682, range=9.24%-34.11%
- 48h: n=199, actual=60.80%, mean=36.15%, Brier=0.3051, logLoss=0.8141, AUC=0.4868, sd=0.0978, range=18.01%-49.76%
- non-overlap 24h: n=53, actual=35.85%, mean=20.21%, Brier=0.2587, logLoss=0.7357, AUC=0.5124, sd=0.0692, range=9.43%-32.98%
- non-overlap 48h: n=26, actual=57.69%, mean=35.35%, Brier=0.3087, logLoss=0.8225, AUC=0.4121, sd=0.0954, range=18.01%-49.52%
- difference vs current: baseline

### benchmark-constant-hazard-v1

- 24h: n=207, actual=35.27%, mean=18.42%, Brier=0.2576, logLoss=0.7347, AUC=0.4577, sd=0.0414, range=11.05%-23.35%
- 48h: n=199, actual=60.80%, mean=33.60%, Brier=0.3139, logLoss=0.8314, AUC=0.4627, sd=0.0675, range=20.87%-41.42%
- non-overlap 24h: n=53, actual=35.85%, mean=18.45%, Brier=0.2615, logLoss=0.7441, AUC=0.4737, sd=0.0412, range=11.05%-23.17%
- non-overlap 48h: n=26, actual=57.69%, mean=33.57%, Brier=0.3073, logLoss=0.8178, AUC=0.4121, sd=0.0666, range=21.24%-40.68%
- difference vs current: {"brier24h":0.005169621321166329,"brier48h":0.00878900654040049,"logLoss24h":0.014537858111501545,"logLoss48h":0.01729418577094699,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.0039753407101392225,"median":0.004695069767571431,"upper":0.01610834710852373},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.007155134966426468,"median":0.007758276005640368,"upper":0.02362728728423265}}

### hazard-elapsed-v1

- 24h: n=207, actual=35.27%, mean=20.93%, Brier=0.2527, logLoss=0.7201, AUC=0.4879, sd=0.0676, range=3.42%-35.54%
- 48h: n=199, actual=60.80%, mean=37.69%, Brier=0.2991, logLoss=0.8002, AUC=0.4834, sd=0.0952, range=8.13%-58.79%
- non-overlap 24h: n=53, actual=35.85%, mean=20.99%, Brier=0.2564, logLoss=0.7285, AUC=0.4690, sd=0.0707, range=3.48%-35.54%
- non-overlap 48h: n=26, actual=57.69%, mean=36.74%, Brier=0.2998, logLoss=0.8005, AUC=0.4303, sd=0.0995, range=8.24%-53.63%
- difference vs current: {"brier24h":0.00020498531299645295,"brier48h":-0.005997747122203245,"logLoss24h":-0.00007303307943373749,"logLoss48h":-0.013915773765027173,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.005080303303855616,"median":0.00015413586095701742,"upper":0.005220304417630401},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.019321787735428857,"median":-0.005837757024619578,"upper":0.006116833732980529}}

### hazard-regime-elapsed-v1-regime-only

- 24h: n=207, actual=35.27%, mean=23.80%, Brier=0.2447, logLoss=0.7032, AUC=0.5326, sd=0.1031, range=5.68%-39.18%
- 48h: n=199, actual=60.80%, mean=41.70%, Brier=0.2871, logLoss=0.7851, AUC=0.5307, sd=0.1579, range=11.05%-63.01%
- non-overlap 24h: n=53, actual=35.85%, mean=23.71%, Brier=0.2461, logLoss=0.7058, AUC=0.5418, sd=0.1007, range=5.68%-38.82%
- non-overlap 48h: n=26, actual=57.69%, mean=41.52%, Brier=0.2971, logLoss=0.8072, AUC=0.4848, sd=0.1542, range=11.25%-59.79%
- difference vs current: {"brier24h":-0.007792828520703149,"brier48h":-0.017951146831639564,"logLoss24h":-0.016909389720207058,"logLoss48h":-0.028967258968222165,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.02577991546542587,"median":-0.007049990530644062,"upper":0.006014804900723375},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.0525503004207282,"median":-0.01721075792305544,"upper":0.017047503716396097}}

### hazard-regime-elapsed-v1

- 24h: n=207, actual=35.27%, mean=26.88%, Brier=0.2434, logLoss=0.7005, AUC=0.5401, sd=0.1321, range=3.33%-52.13%
- 48h: n=199, actual=60.80%, mean=45.95%, Brier=0.2783, logLoss=0.7672, AUC=0.5402, sd=0.1784, range=7.98%-71.03%
- non-overlap 24h: n=53, actual=35.85%, mean=26.70%, Brier=0.2456, logLoss=0.7027, AUC=0.5526, sd=0.1303, range=3.37%-50.89%
- non-overlap 48h: n=26, actual=57.69%, mean=44.55%, Brier=0.2920, logLoss=0.7957, AUC=0.4909, sd=0.1763, range=10.75%-68.03%
- difference vs current: {"brier24h":-0.009075486181547299,"brier48h":-0.02678882576397129,"logLoss24h":-0.01964604939224568,"logLoss48h":-0.04690970186341059,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.03635576729404461,"median":-0.007820279581044316,"upper":0.012998015149769403},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.06948374823755465,"median":-0.024713842855635527,"upper":0.018526187914184544}}

## Regime diagnostics

- hot/normal diagnostic: inconclusive
- rolling density: {"rolling":[{"days":7,"maxCount":7,"minCount":1,"latestCount":1},{"days":14,"maxCount":9,"minCount":1,"latestCount":1}],"gpt56HighDensityPeriod":"Descriptive label only: the mid-July GPT-5.6 period contains the highest observed short-window concentration in this snapshot.","afterAugustFirst":"The post-2026-08-01 interval is short and does not support a stable normal-regime estimate."}
- random reset intervals: [{"from":null,"to":"2026-05-16T17:51:00.000Z","hours":null},{"from":"2026-05-16T17:51:00.000Z","to":"2026-05-19T18:39:18.000Z","hours":72.805},{"from":"2026-05-19T18:39:18.000Z","to":"2026-05-23T20:14:00.000Z","hours":97.57833333333333},{"from":"2026-05-23T20:14:00.000Z","to":"2026-05-31T15:25:06.000Z","hours":187.185},{"from":"2026-05-31T15:25:06.000Z","to":"2026-06-04T00:25:58.000Z","hours":81.01444444444445},{"from":"2026-06-04T00:25:58.000Z","to":"2026-06-17T22:00:00.000Z","hours":333.5672222222222},{"from":"2026-06-17T22:00:00.000Z","to":"2026-06-27T03:00:00.000Z","hours":221},{"from":"2026-06-27T03:00:00.000Z","to":"2026-06-29T00:00:00.000Z","hours":45},{"from":"2026-06-29T00:00:00.000Z","to":"2026-06-30T00:30:00.000Z","hours":24.5},{"from":"2026-06-30T00:30:00.000Z","to":"2026-07-01T20:50:00.000Z","hours":44.333333333333336},{"from":"2026-07-01T20:50:00.000Z","to":"2026-07-09T22:00:00.000Z","hours":193.16666666666666},{"from":"2026-07-09T22:00:00.000Z","to":"2026-07-10T18:26:00.000Z","hours":20.433333333333334},{"from":"2026-07-10T18:26:00.000Z","to":"2026-07-11T06:00:00.000Z","hours":11.566666666666666},{"from":"2026-07-11T06:00:00.000Z","to":"2026-07-12T18:30:00.000Z","hours":36.5},{"from":"2026-07-12T18:30:00.000Z","to":"2026-07-13T18:40:00.000Z","hours":24.166666666666668},{"from":"2026-07-13T18:40:00.000Z","to":"2026-07-14T20:45:00.000Z","hours":26.083333333333332},{"from":"2026-07-14T20:45:00.000Z","to":"2026-07-16T04:15:00.000Z","hours":31.5},{"from":"2026-07-16T04:15:00.000Z","to":"2026-07-18T03:31:00.000Z","hours":47.266666666666666},{"from":"2026-07-18T03:31:00.000Z","to":"2026-07-21T17:05:00.000Z","hours":85.56666666666666},{"from":"2026-07-21T17:05:00.000Z","to":"2026-07-25T19:17:00.000Z","hours":98.2},{"from":"2026-07-25T19:17:00.000Z","to":"2026-07-28T03:09:00.000Z","hours":55.86666666666667},{"from":"2026-07-28T03:09:00.000Z","to":"2026-07-29T04:09:00.000Z","hours":25},{"from":"2026-07-29T04:09:00.000Z","to":"2026-08-01T03:32:00.000Z","hours":71.38333333333334},{"from":"2026-08-01T03:32:00.000Z","to":"2026-08-08T20:29:22.000Z","hours":184.9561111111111},{"from":"2026-08-08T20:29:22.000Z","to":"2026-08-11T00:28:16.000Z","hours":51.98166666666667},{"from":"2026-08-11T00:28:16.000Z","to":"2026-08-13T03:34:43.341Z","hours":51.107594722222224}]
- regular phase diagnostics: {"modelVersion":"hazard-elapsed-v1","horizon":"24h","phases":[{"boundaryAt":"2026-06-12T00:11:00.000Z","phase":"pre-24..0h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-12T00:11:00.000Z","phase":"post-0..24h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-12T00:11:00.000Z","phase":"post-24..48h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-17T22:00:00.000Z","phase":"pre-24..0h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-17T22:00:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.03780167885994787,"brier":0.001465905906377149},{"boundaryAt":"2026-06-17T22:00:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.08226351846321933,"brier":0.008503547937013294},{"boundaryAt":"2026-06-24T22:01:00.000Z","phase":"pre-24..0h","originCount":4,"scoredCount":0,"censoredCount":4,"positiveCount":0,"actualRate":null,"averagePrediction":0.14800827907294048,"brier":null},{"boundaryAt":"2026-06-24T22:01:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.08561532262150412,"brier":0.007330104659931385},{"boundaryAt":"2026-06-24T22:01:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":3,"actualRate":0.75,"averagePrediction":0.09530018499627518,"brier":0.6109851141826149},{"boundaryAt":"2026-07-07T00:30:00.000Z","phase":"pre-24..0h","originCount":4,"scoredCount":0,"censoredCount":4,"positiveCount":0,"actualRate":null,"averagePrediction":0.17657167121755565,"brier":null},{"boundaryAt":"2026-07-07T00:30:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.15971642287010115,"brier":0.025553956751981733},{"boundaryAt":"2026-07-07T00:30:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":1,"actualRate":0.25,"averagePrediction":0.15008183026057,"brier":0.1960913606457975},{"boundaryAt":"2026-08-08T03:32:00.000Z","phase":"pre-24..0h","originCount":4,"scoredCount":1,"censoredCount":3,"positiveCount":1,"actualRate":1,"averagePrediction":0.3293832878427333,"brier":0.4154910927612919},{"boundaryAt":"2026-08-08T03:32:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":3,"actualRate":0.75,"averagePrediction":0.24469871670475246,"brier":0.43778942338793914},{"boundaryAt":"2026-08-08T03:32:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.2972498199825868,"brier":0.088530796690496}],"note":"Origins whose horizon crosses a regular recovery boundary without a random event are censored and excluded from scored metrics."}

## Candidate selection

- candidate count: 160
- selected key: A|prior=2|half=3|exp=1
- selection counts: {"A|prior=2|half=3|exp=1":86,"B|prior=2|half=14|exp=1":5,"B|prior=20|half=3|exp=1":25,"A|prior=20|half=3|exp=1":6,"B|prior=20|half=14|exp=0.25":1,"A|prior=20|half=14|exp=0.25":32,"A|prior=5|half=3|exp=1":16,"B|prior=2|half=3|exp=1":46,"B|prior=5|half=3|exp=1":1}
- A|prior=2|half=3|exp=1: 24h Brier=0.24306714956846126, 48h Brier=0.2744271583278761
- A|prior=2|half=5|exp=1: 24h Brier=0.2436586619976527, 48h Brier=0.27508812068722527
- A|prior=2|half=3|exp=0.75: 24h Brier=0.24384469329673822, 48h Brier=0.2756210327543739
- B|prior=2|half=3|exp=1: 24h Brier=0.2444510084269047, 48h Brier=0.2751700326825072
- B|prior=2|half=5|exp=1: 24h Brier=0.2448976388550941, 48h Brier=0.27569206524000056
- B|prior=2|half=3|exp=0.75: 24h Brier=0.24471381145266702, 48h Brier=0.27599781692906533
- A|prior=2|half=7|exp=1: 24h Brier=0.24526819207899073, 48h Brier=0.2777296614857679
- B|prior=2|half=7|exp=1: 24h Brier=0.24621235313752704, 48h Brier=0.278119328387309
- A|prior=2|half=5|exp=0.75: 24h Brier=0.24569972265161874, 48h Brier=0.2797020370904347
- B|prior=2|half=5|exp=0.75: 24h Brier=0.2462069036903948, 48h Brier=0.2797870470082569

## Limitations

- All model predictions are generated from point-in-time projected data at each 6-hour origin.
- A horizon with a regular recovery boundary and no random event is censored rather than scored as a simple negative.
- The 24-hour and 48-hour non-overlapping subsets are lower-sample references; overlapping 6-hour origins are dependent.
- The selected configuration is chosen from past-origin scores only; no future label is used at the origin where a choice is made.
- The public model is hazard-elapsed-v1; hazard-regime-elapsed-v1 remains the full-regime shadow and hazard-odds-v3-recency-bayes-h30-r3 remains the comparison and fallback model.
- The published model uses elapsed-only hazard with an effective regime multiplier of 1; full regime diagnostics remain shadow-only.
- The current model uses bin scheme A, prior exposure 2 days, regime half-life 3 days, and ratio exponent 1.
- No fixed 14%/27% display cap is included in these predictions.
- Rolling counts and EWMA rates are descriptive diagnostics, not a post-hoc hot/normal rule used by the model.
- The sample is small and the GPT-5.6 high-density period was identified after inspecting the history; this is a post-hoc selection limitation.
- Regular boundaries reset elapsed exposure but never increase the random event or regime event count.
