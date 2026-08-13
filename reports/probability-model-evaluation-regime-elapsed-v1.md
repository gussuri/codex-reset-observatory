# Reset Regime × Elapsed Probability Evaluation

- model: hazard-elapsed-v1
- asOf: 2026-08-13T06:20:00.000Z
- mode: walk-forward-prequential
- origins: 218 (every 6h)
- target events: 23
- recovery boundaries: 27
- labels: 24h scored=206, censored=12; 48h scored=194, censored=24
- non-overlap labels: 24h scored=52, censored=3; 48h scored=25, censored=3
- selected bins/prior/half-life: A / 2d / 3d

## Current snapshot

- latest random reset: 2026-08-01T03:32:00.000Z
- latest recovery boundary: 2026-08-08T03:32:00.000Z
- elapsed since recovery boundary: 122.80h
- old h30-r3: 12h=9.14%, 24h=17.45%, 48h=31.85%, 72h=43.74%
- elapsed-only: 12h=14.88%, 24h=28.27%, 48h=50.53%, 72h=66.41%
- regime-only: 12h=7.64%, 24h=14.70%, 48h=27.25%, 72h=37.94%
- new model: 12h=14.88%, 24h=28.27%, 48h=50.53%, 72h=66.41%
- regime diagnostics: {"recentWeightedEventCount":0.1430210496270805,"recentWeightedExposureDays":4.328085116992881,"recentRatePerDay":0.18062668698271975,"longTermRatePerDay":0.26513437003736123,"rawRateRatio":0.6812646996964854,"regimeMultiplier":0.6812646996964854,"halfLifeDays":3,"priorEventCount":1,"priorExposureDays":2,"rawRandomEventCount":23,"observationStartAt":"2026-05-16T17:51:00.000Z"}

## Metrics

| Model | 24h Brier | 48h Brier | 24h log loss | 48h log loss | non-overlap 24h n | non-overlap 48h n |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| hazard-odds-v3-recency-bayes-h30-r3 | 0.2328 | 0.2932 | 0.6763 | 0.7902 | 52 | 25 |
| benchmark-constant-hazard-v1 | 0.2368 | 0.2995 | 0.6878 | 0.8025 | 52 | 25 |
| hazard-elapsed-v1 | 0.2346 | 0.2955 | 0.6803 | 0.7932 | 52 | 25 |
| hazard-regime-elapsed-v1-regime-only | 0.2214 | 0.2684 | 0.6487 | 0.7465 | 52 | 25 |
| hazard-regime-elapsed-v1 | 0.2219 | 0.2692 | 0.6516 | 0.7489 | 52 | 25 |

### hazard-odds-v3-recency-bayes-h30-r3

- 24h: n=206, actual=31.55%, mean=19.93%, Brier=0.2328, logLoss=0.6763, AUC=0.5171, sd=0.0670, range=9.24%-34.11%
- 48h: n=194, actual=53.61%, mean=35.62%, Brier=0.2932, logLoss=0.7902, AUC=0.4709, sd=0.0967, range=18.01%-49.76%
- non-overlap 24h: n=52, actual=32.69%, mean=19.93%, Brier=0.2420, logLoss=0.6986, AUC=0.4924, sd=0.0682, range=9.43%-32.98%
- non-overlap 48h: n=25, actual=52.00%, mean=34.89%, Brier=0.2953, logLoss=0.7955, AUC=0.4295, sd=0.0956, range=18.01%-49.52%
- difference vs current: baseline

### benchmark-constant-hazard-v1

- 24h: n=206, actual=31.55%, mean=18.33%, Brier=0.2368, logLoss=0.6878, AUC=0.4160, sd=0.0408, range=11.05%-23.35%
- 48h: n=194, actual=53.61%, mean=33.33%, Brier=0.2995, logLoss=0.8025, AUC=0.3906, sd=0.0665, range=20.87%-41.24%
- non-overlap 24h: n=52, actual=32.69%, mean=18.31%, Brier=0.2444, logLoss=0.7057, AUC=0.4218, sd=0.0406, range=11.05%-23.17%
- non-overlap 48h: n=25, actual=52.00%, mean=33.24%, Brier=0.2954, logLoss=0.7940, AUC=0.3718, sd=0.0660, range=21.24%-40.68%
- difference vs current: {"brier24h":0.004094639085788693,"brier48h":0.006351035318949039,"logLoss24h":0.011525669676080041,"logLoss48h":0.0123009388829316,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.004847097157156532,"median":0.003529304205352555,"upper":0.015141757556846805},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.010294393881254794,"median":0.0059117273518153185,"upper":0.021949502441285778}}

### hazard-elapsed-v1

- 24h: n=206, actual=31.55%, mean=20.76%, Brier=0.2346, logLoss=0.6803, AUC=0.4575, sd=0.0663, range=3.42%-31.71%
- 48h: n=194, actual=53.61%, mean=37.08%, Brier=0.2955, logLoss=0.7932, AUC=0.3973, sd=0.0906, range=8.13%-51.39%
- non-overlap 24h: n=52, actual=32.69%, mean=20.73%, Brier=0.2438, logLoss=0.7017, AUC=0.4269, sd=0.0688, range=3.48%-31.71%
- non-overlap 48h: n=25, actual=52.00%, mean=36.21%, Brier=0.2976, logLoss=0.7963, AUC=0.3590, sd=0.0968, range=8.24%-48.95%
- difference vs current: {"brier24h":0.001862314562909112,"brier48h":0.002313819080472179,"logLoss24h":0.004065022174193911,"logLoss48h":0.00297739107924877,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.004108776915841945,"median":0.0017300625341143462,"upper":0.007980604986028698},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.010403880438549616,"median":0.002146599244147485,"upper":0.014552125332278499}}

### hazard-regime-elapsed-v1-regime-only

- 24h: n=206, actual=31.55%, mean=23.32%, Brier=0.2214, logLoss=0.6487, AUC=0.5652, sd=0.1042, range=5.68%-39.18%
- 48h: n=194, actual=53.61%, mean=41.04%, Brier=0.2684, logLoss=0.7465, AUC=0.5688, sd=0.1610, range=11.05%-63.01%
- non-overlap 24h: n=52, actual=32.69%, mean=23.24%, Brier=0.2267, logLoss=0.6605, AUC=0.5647, sd=0.1026, range=5.68%-38.82%
- non-overlap 48h: n=25, actual=52.00%, mean=40.66%, Brier=0.2765, logLoss=0.7651, AUC=0.5321, sd=0.1592, range=11.25%-59.79%
- difference vs current: {"brier24h":-0.01134732632961069,"brier48h":-0.024785509093269154,"logLoss24h":-0.027576536863468948,"logLoss48h":-0.04366178426670253,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.02796608309571914,"median":-0.010798455156101354,"upper":0.0025506736568007217},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.057173961676112064,"median":-0.024307414034800197,"upper":0.009648488999513068}}

### hazard-regime-elapsed-v1

- 24h: n=206, actual=31.55%, mean=26.29%, Brier=0.2219, logLoss=0.6516, AUC=0.5751, sd=0.1327, range=3.33%-52.13%
- 48h: n=194, actual=53.61%, mean=44.94%, Brier=0.2692, logLoss=0.7489, AUC=0.5714, sd=0.1811, range=7.98%-71.03%
- non-overlap 24h: n=52, actual=32.69%, mean=26.13%, Brier=0.2293, logLoss=0.6664, AUC=0.5731, sd=0.1320, range=3.37%-50.89%
- non-overlap 48h: n=25, actual=52.00%, mean=43.41%, Brier=0.2794, logLoss=0.7706, AUC=0.5385, sd=0.1798, range=10.75%-68.03%
- difference vs current: {"brier24h":-0.010816058197236522,"brier48h":-0.023991563031582452,"logLoss24h":-0.02467264510402778,"logLoss48h":-0.041302376151417075,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.0390721616955185,"median":-0.009800824108249756,"upper":0.013665755120415556},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.0698555792910876,"median":-0.02388677794096613,"upper":0.025483198138120725}}

## Regime diagnostics

- hot/normal diagnostic: inconclusive
- rolling density: {"rolling":[{"days":7,"maxCount":7,"minCount":1,"latestCount":1},{"days":14,"maxCount":9,"minCount":1,"latestCount":1}],"gpt56HighDensityPeriod":"Descriptive label only: the mid-July GPT-5.6 period contains the highest observed short-window concentration in this snapshot.","afterAugustFirst":"The post-2026-08-01 interval is short and does not support a stable normal-regime estimate."}
- random reset intervals: [{"from":null,"to":"2026-05-16T17:51:00.000Z","hours":null},{"from":"2026-05-16T17:51:00.000Z","to":"2026-05-19T18:39:18.000Z","hours":72.805},{"from":"2026-05-19T18:39:18.000Z","to":"2026-05-23T20:14:00.000Z","hours":97.57833333333333},{"from":"2026-05-23T20:14:00.000Z","to":"2026-05-31T15:25:06.000Z","hours":187.185},{"from":"2026-05-31T15:25:06.000Z","to":"2026-06-04T00:25:58.000Z","hours":81.01444444444445},{"from":"2026-06-04T00:25:58.000Z","to":"2026-06-17T22:00:00.000Z","hours":333.5672222222222},{"from":"2026-06-17T22:00:00.000Z","to":"2026-06-27T03:00:00.000Z","hours":221},{"from":"2026-06-27T03:00:00.000Z","to":"2026-06-29T00:00:00.000Z","hours":45},{"from":"2026-06-29T00:00:00.000Z","to":"2026-06-30T00:30:00.000Z","hours":24.5},{"from":"2026-06-30T00:30:00.000Z","to":"2026-07-01T20:50:00.000Z","hours":44.333333333333336},{"from":"2026-07-01T20:50:00.000Z","to":"2026-07-09T22:00:00.000Z","hours":193.16666666666666},{"from":"2026-07-09T22:00:00.000Z","to":"2026-07-10T18:26:00.000Z","hours":20.433333333333334},{"from":"2026-07-10T18:26:00.000Z","to":"2026-07-11T06:00:00.000Z","hours":11.566666666666666},{"from":"2026-07-11T06:00:00.000Z","to":"2026-07-12T18:30:00.000Z","hours":36.5},{"from":"2026-07-12T18:30:00.000Z","to":"2026-07-13T18:40:00.000Z","hours":24.166666666666668},{"from":"2026-07-13T18:40:00.000Z","to":"2026-07-14T20:45:00.000Z","hours":26.083333333333332},{"from":"2026-07-14T20:45:00.000Z","to":"2026-07-16T04:15:00.000Z","hours":31.5},{"from":"2026-07-16T04:15:00.000Z","to":"2026-07-18T03:31:00.000Z","hours":47.266666666666666},{"from":"2026-07-18T03:31:00.000Z","to":"2026-07-21T17:05:00.000Z","hours":85.56666666666666},{"from":"2026-07-21T17:05:00.000Z","to":"2026-07-25T19:17:00.000Z","hours":98.2},{"from":"2026-07-25T19:17:00.000Z","to":"2026-07-28T03:09:00.000Z","hours":55.86666666666667},{"from":"2026-07-28T03:09:00.000Z","to":"2026-07-29T04:09:00.000Z","hours":25},{"from":"2026-07-29T04:09:00.000Z","to":"2026-08-01T03:32:00.000Z","hours":71.38333333333334}]
- regular phase diagnostics: {"modelVersion":"hazard-elapsed-v1","horizon":"24h","phases":[{"boundaryAt":"2026-06-12T00:11:00.000Z","phase":"pre-24..0h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-12T00:11:00.000Z","phase":"post-0..24h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-12T00:11:00.000Z","phase":"post-24..48h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-17T22:00:00.000Z","phase":"pre-24..0h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-17T22:00:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.03780167885994787,"brier":0.001465905906377149},{"boundaryAt":"2026-06-17T22:00:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.08226351846321933,"brier":0.008503547937013294},{"boundaryAt":"2026-06-24T22:01:00.000Z","phase":"pre-24..0h","originCount":4,"scoredCount":0,"censoredCount":4,"positiveCount":0,"actualRate":null,"averagePrediction":0.14800827907294048,"brier":null},{"boundaryAt":"2026-06-24T22:01:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.08561532262150412,"brier":0.007330104659931385},{"boundaryAt":"2026-06-24T22:01:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":3,"actualRate":0.75,"averagePrediction":0.09530018499627518,"brier":0.6109851141826149},{"boundaryAt":"2026-07-07T00:30:00.000Z","phase":"pre-24..0h","originCount":4,"scoredCount":0,"censoredCount":4,"positiveCount":0,"actualRate":null,"averagePrediction":0.17657167121755565,"brier":null},{"boundaryAt":"2026-07-07T00:30:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.15971642287010115,"brier":0.025553956751981733},{"boundaryAt":"2026-07-07T00:30:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":1,"actualRate":0.25,"averagePrediction":0.15008183026057,"brier":0.1960913606457975},{"boundaryAt":"2026-08-08T03:32:00.000Z","phase":"pre-24..0h","originCount":4,"scoredCount":0,"censoredCount":4,"positiveCount":0,"actualRate":null,"averagePrediction":0.32188103045293315,"brier":null},{"boundaryAt":"2026-08-08T03:32:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.26455074238559406,"brier":0.07203037576861974},{"boundaryAt":"2026-08-08T03:32:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.265517596282846,"brier":0.07087394985150193}],"note":"Origins whose horizon crosses a regular recovery boundary without a random event are censored and excluded from scored metrics."}

## Candidate selection

- candidate count: 160
- selected key: A|prior=2|half=3|exp=1
- selection counts: {"A|prior=2|half=3|exp=1":86,"B|prior=2|half=14|exp=1":5,"B|prior=20|half=3|exp=1":25,"A|prior=20|half=3|exp=1":6,"B|prior=20|half=14|exp=0.25":1,"A|prior=20|half=14|exp=0.25":32,"A|prior=5|half=3|exp=1":16,"B|prior=2|half=3|exp=1":46,"B|prior=5|half=3|exp=1":1}
- A|prior=2|half=3|exp=1: 24h Brier=0.22162756159643313, 48h Brier=0.2652271525482179
- B|prior=2|half=3|exp=1: 24h Brier=0.22355761106582062, 48h Brier=0.2668476455569132
- A|prior=2|half=3|exp=0.75: 24h Brier=0.22321089191098872, 48h Brier=0.2676045390153256
- A|prior=2|half=5|exp=1: 24h Brier=0.22335018891803332, 48h Brier=0.26783463170803484
- B|prior=2|half=3|exp=0.75: 24h Brier=0.22470666374783846, 48h Brier=0.2688931179826083
- A|prior=5|half=3|exp=1: 24h Brier=0.2239379599709544, 48h Brier=0.26968420932789183
- B|prior=2|half=5|exp=1: 24h Brier=0.2252588858095763, 48h Brier=0.2693767233449755
- B|prior=5|half=3|exp=1: 24h Brier=0.22470817193295675, 48h Brier=0.2703897881615966
- A|prior=5|half=5|exp=1: 24h Brier=0.22503426732106274, 48h Brier=0.27133340707025866
- B|prior=5|half=5|exp=1: 24h Brier=0.22595717792191466, 48h Brier=0.272166659111622

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
