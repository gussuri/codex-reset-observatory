# Reset Regime × Elapsed Probability Evaluation

- model: hazard-regime-elapsed-v1
- asOf: 2026-08-08T04:27:00.000Z
- mode: walk-forward-prequential
- origins: 197 (every 6h)
- target events: 23
- recovery boundaries: 27
- labels: 24h scored=189, censored=8; 48h scored=181, censored=16
- non-overlap labels: 24h scored=48, censored=2; 48h scored=23, censored=2
- selected bins/prior/half-life: A / 2d / 3d

## Current snapshot

- latest random reset: 2026-08-01T03:32:00.000Z
- latest recovery boundary: 2026-08-08T03:32:00.000Z
- elapsed since recovery boundary: 0.92h
- old h30-r3: 12h=12.28%, 24h=23.05%, 48h=40.78%, 72h=54.43%
- elapsed-only: 12h=5.02%, 24h=17.89%, 48h=42.48%, 72h=56.01%
- regime-only: 12h=9.63%, 24h=18.33%, 48h=33.30%, 72h=45.53%
- new model: 12h=4.15%, 24h=14.97%, 48h=36.55%, 72h=49.11%
- regime diagnostics: {"recentWeightedEventCount":0.4623712102014854,"recentWeightedExposureDays":4.328085104323444,"recentRatePerDay":0.2310922160642832,"longTermRatePerDay":0.28089339705452065,"rawRateRatio":0.8227043372594082,"regimeMultiplier":0.8227043372594082,"halfLifeDays":3,"priorEventCount":1,"priorExposureDays":2,"rawRandomEventCount":23,"observationStartAt":"2026-05-16T17:51:00.000Z"}

## Metrics

| Model | 24h Brier | 48h Brier | 24h log loss | 48h log loss | non-overlap 24h n | non-overlap 48h n |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| hazard-odds-v3-recency-bayes-h30-r3 | 0.2497 | 0.3039 | 0.7158 | 0.8128 | 48 | 23 |
| benchmark-constant-hazard-v1 | 0.2539 | 0.3105 | 0.7277 | 0.8254 | 48 | 23 |
| hazard-regime-elapsed-v1-elapsed-only | 0.2493 | 0.3029 | 0.7138 | 0.8087 | 48 | 23 |
| hazard-regime-elapsed-v1-regime-only | 0.2385 | 0.2808 | 0.6895 | 0.7737 | 48 | 23 |
| hazard-regime-elapsed-v1 | 0.2374 | 0.2794 | 0.6879 | 0.7711 | 48 | 23 |

### hazard-odds-v3-recency-bayes-h30-r3

- 24h: n=189, actual=34.39%, mean=19.83%, Brier=0.2497, logLoss=0.7158, AUC=0.5190, sd=0.0698, range=9.24%-34.11%
- 48h: n=181, actual=57.46%, mean=35.46%, Brier=0.3039, logLoss=0.8128, AUC=0.4675, sd=0.0999, range=18.01%-49.76%
- non-overlap 24h: n=48, actual=35.42%, mean=19.86%, Brier=0.2586, logLoss=0.7374, AUC=0.4934, sd=0.0709, range=9.43%-32.98%
- non-overlap 48h: n=23, actual=56.52%, mean=34.68%, Brier=0.3088, logLoss=0.8239, AUC=0.4231, sd=0.0992, range=18.01%-49.52%
- difference vs current: baseline

### benchmark-constant-hazard-v1

- 24h: n=189, actual=34.39%, mean=18.03%, Brier=0.2539, logLoss=0.7277, AUC=0.4500, sd=0.0413, range=11.05%-23.35%
- 48h: n=181, actual=57.46%, mean=32.96%, Brier=0.3105, logLoss=0.8254, AUC=0.4168, sd=0.0674, range=20.87%-41.24%
- non-overlap 24h: n=48, actual=35.42%, mean=18.04%, Brier=0.2608, logLoss=0.7443, AUC=0.4535, sd=0.0411, range=11.05%-23.17%
- non-overlap 48h: n=23, actual=56.52%, mean=32.79%, Brier=0.3083, logLoss=0.8210, AUC=0.4077, sd=0.0670, range=21.24%-40.68%
- difference vs current: {"brier24h":0.004234628440340199,"brier48h":0.006521823012579309,"logLoss24h":0.011865597386674476,"logLoss48h":0.012562324859494711,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.0050454877025794915,"median":0.0038902307233044924,"upper":0.01623441409455391},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.009742374974832279,"median":0.006138878179654925,"upper":0.024258365898606863}}

### hazard-regime-elapsed-v1-elapsed-only

- 24h: n=189, actual=34.39%, mean=20.25%, Brier=0.2493, logLoss=0.7138, AUC=0.4912, sd=0.0660, range=3.42%-31.71%
- 48h: n=181, actual=57.46%, mean=36.60%, Brier=0.3029, logLoss=0.8087, AUC=0.4266, sd=0.0918, range=8.13%-51.39%
- non-overlap 24h: n=48, actual=35.42%, mean=20.18%, Brier=0.2578, logLoss=0.7334, AUC=0.4630, sd=0.0679, range=3.48%-31.71%
- non-overlap 48h: n=23, actual=56.52%, mean=35.42%, Brier=0.3057, logLoss=0.8132, AUC=0.4077, sd=0.0967, range=8.24%-48.95%
- difference vs current: {"brier24h":-0.0003591328839786523,"brier48h":-0.001010877088038098,"logLoss24h":-0.0019770978612486667,"logLoss48h":-0.0040425243515990195,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.0057434606487015505,"median":-0.0001860211643790106,"upper":0.00505827148901586},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.012944221281798307,"median":-0.0009850705007435085,"upper":0.012068654824457856}}

### hazard-regime-elapsed-v1-regime-only

- 24h: n=189, actual=34.39%, mean=23.83%, Brier=0.2385, logLoss=0.6895, AUC=0.5450, sd=0.1072, range=5.68%-39.18%
- 48h: n=181, actual=57.46%, mean=41.77%, Brier=0.2808, logLoss=0.7737, AUC=0.5451, sd=0.1643, range=11.05%-63.01%
- non-overlap 24h: n=48, actual=35.42%, mean=23.72%, Brier=0.2430, logLoss=0.6996, AUC=0.5465, sd=0.1053, range=5.68%-38.82%
- non-overlap 48h: n=23, actual=56.52%, mean=41.54%, Brier=0.2925, logLoss=0.8000, AUC=0.5154, sd=0.1630, range=11.25%-59.79%
- difference vs current: {"brier24h":-0.011226469588112686,"brier48h":-0.023109566000048043,"logLoss24h":-0.026356545383993013,"logLoss48h":-0.03912980111737352,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.027944402186183562,"median":-0.010912693682146,"upper":0.002771429015396594},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.06134779127531933,"median":-0.022901013604923255,"upper":0.01254093013200908}}

### hazard-regime-elapsed-v1

- 24h: n=189, actual=34.39%, mean=26.69%, Brier=0.2374, logLoss=0.6879, AUC=0.5615, sd=0.1372, range=3.33%-52.13%
- 48h: n=181, actual=57.46%, mean=45.62%, Brier=0.2794, logLoss=0.7711, AUC=0.5485, sd=0.1855, range=7.98%-71.03%
- non-overlap 24h: n=48, actual=35.42%, mean=26.44%, Brier=0.2441, logLoss=0.7006, AUC=0.5617, sd=0.1363, range=3.37%-50.89%
- non-overlap 48h: n=23, actual=56.52%, mean=44.01%, Brier=0.2920, logLoss=0.7980, AUC=0.5231, sd=0.1859, range=10.75%-68.03%
- difference vs current: {"brier24h":-0.012262692294609662,"brier48h":-0.024529404241696695,"logLoss24h":-0.02793572559809354,"logLoss48h":-0.041680694960283926,"bootstrap24h":{"seed":20260808,"iterations":1000,"lower":-0.041858649410335236,"median":-0.011512536673976913,"upper":0.011896368947825595},"bootstrap48h":{"seed":20260808,"iterations":1000,"lower":-0.07569980196832644,"median":-0.024280384127660155,"upper":0.025794403754071393}}

## Regime diagnostics

- hot/normal diagnostic: inconclusive
- rolling density: {"rolling":[{"days":7,"maxCount":7,"minCount":1,"latestCount":1},{"days":14,"maxCount":9,"minCount":1,"latestCount":1}],"gpt56HighDensityPeriod":"Descriptive label only: the mid-July GPT-5.6 period contains the highest observed short-window concentration in this snapshot.","afterAugustFirst":"The post-2026-08-01 interval is short and does not support a stable normal-regime estimate."}
- random reset intervals: [{"from":null,"to":"2026-05-16T17:51:00.000Z","hours":null},{"from":"2026-05-16T17:51:00.000Z","to":"2026-05-19T18:39:18.000Z","hours":72.805},{"from":"2026-05-19T18:39:18.000Z","to":"2026-05-23T20:14:00.000Z","hours":97.57833333333333},{"from":"2026-05-23T20:14:00.000Z","to":"2026-05-31T15:25:06.000Z","hours":187.185},{"from":"2026-05-31T15:25:06.000Z","to":"2026-06-04T00:25:58.000Z","hours":81.01444444444445},{"from":"2026-06-04T00:25:58.000Z","to":"2026-06-17T22:00:00.000Z","hours":333.5672222222222},{"from":"2026-06-17T22:00:00.000Z","to":"2026-06-27T03:00:00.000Z","hours":221},{"from":"2026-06-27T03:00:00.000Z","to":"2026-06-29T00:00:00.000Z","hours":45},{"from":"2026-06-29T00:00:00.000Z","to":"2026-06-30T00:30:00.000Z","hours":24.5},{"from":"2026-06-30T00:30:00.000Z","to":"2026-07-01T20:50:00.000Z","hours":44.333333333333336},{"from":"2026-07-01T20:50:00.000Z","to":"2026-07-09T22:00:00.000Z","hours":193.16666666666666},{"from":"2026-07-09T22:00:00.000Z","to":"2026-07-10T18:26:00.000Z","hours":20.433333333333334},{"from":"2026-07-10T18:26:00.000Z","to":"2026-07-11T06:00:00.000Z","hours":11.566666666666666},{"from":"2026-07-11T06:00:00.000Z","to":"2026-07-12T18:30:00.000Z","hours":36.5},{"from":"2026-07-12T18:30:00.000Z","to":"2026-07-13T18:40:00.000Z","hours":24.166666666666668},{"from":"2026-07-13T18:40:00.000Z","to":"2026-07-14T20:45:00.000Z","hours":26.083333333333332},{"from":"2026-07-14T20:45:00.000Z","to":"2026-07-16T04:15:00.000Z","hours":31.5},{"from":"2026-07-16T04:15:00.000Z","to":"2026-07-18T03:31:00.000Z","hours":47.266666666666666},{"from":"2026-07-18T03:31:00.000Z","to":"2026-07-21T17:05:00.000Z","hours":85.56666666666666},{"from":"2026-07-21T17:05:00.000Z","to":"2026-07-25T19:17:00.000Z","hours":98.2},{"from":"2026-07-25T19:17:00.000Z","to":"2026-07-28T03:09:00.000Z","hours":55.86666666666667},{"from":"2026-07-28T03:09:00.000Z","to":"2026-07-29T04:09:00.000Z","hours":25},{"from":"2026-07-29T04:09:00.000Z","to":"2026-08-01T03:32:00.000Z","hours":71.38333333333334}]
- regular phase diagnostics: {"modelVersion":"hazard-regime-elapsed-v1","horizon":"24h","phases":[{"boundaryAt":"2026-06-12T00:11:00.000Z","phase":"pre-24..0h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-12T00:11:00.000Z","phase":"post-0..24h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-12T00:11:00.000Z","phase":"post-24..48h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-17T22:00:00.000Z","phase":"pre-24..0h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-06-17T22:00:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.0439538581775179,"brier":0.0022598753330409613},{"boundaryAt":"2026-06-17T22:00:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.05439371991354075,"brier":0.0031972616870612324},{"boundaryAt":"2026-06-24T22:01:00.000Z","phase":"pre-24..0h","originCount":4,"scoredCount":0,"censoredCount":4,"positiveCount":0,"actualRate":null,"averagePrediction":0.0769662948608891,"brier":null},{"boundaryAt":"2026-06-24T22:01:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.04376538222101353,"brier":0.00191544182052295},{"boundaryAt":"2026-06-24T22:01:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":3,"actualRate":0.75,"averagePrediction":0.04885750448062531,"brier":0.6763710509966123},{"boundaryAt":"2026-07-07T00:30:00.000Z","phase":"pre-24..0h","originCount":4,"scoredCount":0,"censoredCount":4,"positiveCount":0,"actualRate":null,"averagePrediction":0.16852051125183637,"brier":null},{"boundaryAt":"2026-07-07T00:30:00.000Z","phase":"post-0..24h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":0,"actualRate":0,"averagePrediction":0.15140476435277703,"brier":0.0229615050202217},{"boundaryAt":"2026-07-07T00:30:00.000Z","phase":"post-24..48h","originCount":4,"scoredCount":4,"censoredCount":0,"positiveCount":1,"actualRate":0.25,"averagePrediction":0.1413529152753161,"brier":0.19815167407705658},{"boundaryAt":"2026-08-08T03:32:00.000Z","phase":"pre-24..0h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-08-08T03:32:00.000Z","phase":"post-0..24h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null},{"boundaryAt":"2026-08-08T03:32:00.000Z","phase":"post-24..48h","originCount":0,"scoredCount":0,"censoredCount":0,"positiveCount":0,"actualRate":null,"averagePrediction":null,"brier":null}],"note":"Origins whose horizon crosses a regular recovery boundary without a random event are censored and excluded from scored metrics."}

## Candidate selection

- candidate count: 160
- selected key: A|prior=2|half=3|exp=1
- selection counts: {"A|prior=2|half=3|exp=1":65,"B|prior=2|half=14|exp=1":5,"B|prior=20|half=3|exp=1":25,"A|prior=20|half=3|exp=1":6,"B|prior=20|half=14|exp=0.25":1,"A|prior=20|half=14|exp=0.25":32,"A|prior=5|half=3|exp=1":16,"B|prior=2|half=3|exp=1":46,"B|prior=5|half=3|exp=1":1}
- A|prior=2|half=3|exp=1: 24h Brier=0.2370983206130846, 48h Brier=0.2751658990202473
- A|prior=2|half=5|exp=1: 24h Brier=0.23824918987458674, 48h Brier=0.2767492961596739
- A|prior=2|half=3|exp=0.75: 24h Brier=0.23841502824189037, 48h Brier=0.2766962347360441
- B|prior=2|half=3|exp=1: 24h Brier=0.2389688103558758, 48h Brier=0.2765546782862797
- B|prior=2|half=3|exp=0.75: 24h Brier=0.2397913457871353, 48h Brier=0.27770587589787327
- B|prior=2|half=5|exp=1: 24h Brier=0.24005725115066506, 48h Brier=0.2780106556040756
- A|prior=2|half=7|exp=1: 24h Brier=0.24058075107319793, 48h Brier=0.2812649275433052
- A|prior=2|half=5|exp=0.75: 24h Brier=0.2408115833597451, 48h Brier=0.2817996334726727
- B|prior=2|half=5|exp=0.75: 24h Brier=0.2418603985671674, 48h Brier=0.2825046845066345
- B|prior=2|half=7|exp=1: 24h Brier=0.2421105099824646, 48h Brier=0.2822847880420636

## Limitations

- All model predictions are generated from point-in-time projected data at each 6-hour origin.
- A horizon with a regular recovery boundary and no random event is censored rather than scored as a simple negative.
- The 24-hour and 48-hour non-overlapping subsets are lower-sample references; overlapping 6-hour origins are dependent.
- The selected configuration is chosen from past-origin scores only; no future label is used at the origin where a choice is made.
- The public model is hazard-regime-elapsed-v1; hazard-odds-v3-recency-bayes-h30-r3 remains the comparison and fallback model.
- The current model uses bin scheme A, prior exposure 2 days, regime half-life 3 days, and ratio exponent 1.
- No fixed 14%/27% display cap is included in these predictions.
- Rolling counts and EWMA rates are descriptive diagnostics, not a post-hoc hot/normal rule used by the model.
- The sample is small and the GPT-5.6 high-density period was identified after inspecting the history; this is a post-hoc selection limitation.
- Regular boundaries reset elapsed exposure but never increase the random event or regime event count.
