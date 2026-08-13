# Reset Regime Analysis

- schema: reset-regime-analysis-v2
- asOf: 2026-08-13T06:20:00.000Z
- input mode: production-point-in-time
- source asOf: 2026-08-13T06:20:00.000Z
- future leakage policy: availability-timestamps-v1
- backfilled: false
- target: Broad-scope random reset: confirmed global hard reset or broad Banked Reset distribution; regular reset is a recovery boundary only.
- random events: 26
- recovery boundaries: 30
- current elapsed hours: 2.75
- hot/normal diagnostic: inconclusive

## Current regime diagnostics

```json
{
  "recentWeightedEventCount": 2.073212210948166,
  "recentWeightedExposureDays": 4.328085116992881,
  "recentRatePerDay": 0.4856464718996325,
  "longTermRatePerDay": 0.29827616629203135,
  "rawRateRatio": 1.6281772624908746,
  "regimeMultiplier": 1.6281772624908746,
  "halfLifeDays": 3,
  "priorEventCount": 1,
  "priorExposureDays": 2,
  "rawRandomEventCount": 26,
  "observationStartAt": "2026-05-16T17:51:00.000Z"
}
```

## Random reset events

- 2026-08-13T03:34:43.341Z (tibo-reset-2087706104814023111)
- 2026-08-01T03:32:00.000Z (tibo-reset-2083395449814229287)
- 2026-08-08T20:29:22.000Z (tibo-reset-2086188036493344823)
- 2026-08-11T00:28:16.000Z (tibo-reset-2086972933566857393)
- 2026-07-29T04:09:00.000Z (local-codex-gpt56-sol-efficiency-reset-2026-07-29)
- 2026-07-28T03:09:00.000Z (local-codex-chatgpt-work-adoption-reset-2026-07-28)
- 2026-07-25T19:17:00.000Z (local-codex-outage-compensation-reset-2026-07-26)
- 2026-07-21T17:05:00.000Z (local-codex-10m-users-reset-2026-07-22)
- 2026-07-18T03:31:00.000Z (local-codex-gpt-5-6-sol-release-reset-4-2026-07-18)
- 2026-07-16T04:15:00.000Z (local-codex-9m-users-reset-2026-07-16)
- 2026-07-14T20:45:00.000Z (local-codex-8m-users-reset-2026-07-15)
- 2026-07-13T18:40:00.000Z (personal-tibo-7m-users-banked-reset-2026-07-14)
- 2026-07-12T18:30:00.000Z (local-codex-6m-users-reset-2026-07-13)
- 2026-07-11T06:00:00.000Z (local-codex-gpt-5-6-sol-release-reset-3-2026-07-11)
- 2026-07-10T18:26:00.000Z (local-codex-gpt-5-6-sol-release-reset-2-2026-07-11)
- 2026-07-09T22:00:00.000Z (local-codex-gpt-5-6-release-reset-2026-07-10)
- 2026-07-01T20:50:00.000Z (personal-codex-reset-button-aie-2026-07-02)
- 2026-06-30T00:30:00.000Z (local-codex-forced-reset-2026-06-30)
- 2026-06-29T00:00:00.000Z (local-codex-forced-comp-reset-2026-06-29)
- 2026-06-27T03:00:00.000Z (personal-compensation-reset-credit-2026-06-27)
- 2026-06-17T22:00:00.000Z (personal-compensation-reset-credit-2026-06-18)
- 2026-06-04T00:25:58.000Z (local-codex-reliability-compensation-2026-06-04)
- 2026-05-31T15:25:06.000Z (local-5m-users-celebration-2026-05-31)
- 2026-05-23T20:14:00.000Z (local-long-session-compression-compensation-2026-05-24)
- 2026-05-19T18:39:18.000Z (local-sam-like-promise-reset-2026-05-20)
- 2026-05-16T17:51:00.000Z (local-gpt-55-degradation-compensation-2026-05-17)

## Recovery boundaries

- 2026-05-16T17:51:00.000Z: random=true, regular=false, id=local-gpt-55-degradation-compensation-2026-05-17
- 2026-05-19T18:39:18.000Z: random=true, regular=false, id=local-sam-like-promise-reset-2026-05-20
- 2026-05-23T20:14:00.000Z: random=true, regular=false, id=local-long-session-compression-compensation-2026-05-24
- 2026-05-31T15:25:06.000Z: random=true, regular=false, id=local-5m-users-celebration-2026-05-31
- 2026-06-04T00:25:58.000Z: random=true, regular=false, id=local-codex-reliability-compensation-2026-06-04
- 2026-06-12T00:11:00.000Z: random=false, regular=true, id=personal-reset-credit-2026-06-11
- 2026-06-17T22:00:00.000Z: random=true, regular=true, id=local-codex-rate-limit-reset-notice-2026-06-17
- 2026-06-24T22:01:00.000Z: random=false, regular=true, id=local-codex-regular-reset-2026-06-25
- 2026-06-27T03:00:00.000Z: random=true, regular=false, id=personal-compensation-reset-credit-2026-06-27
- 2026-06-29T00:00:00.000Z: random=true, regular=false, id=local-codex-forced-comp-reset-2026-06-29
- 2026-06-30T00:30:00.000Z: random=true, regular=false, id=local-codex-forced-reset-2026-06-30
- 2026-07-01T20:50:00.000Z: random=true, regular=false, id=personal-codex-reset-button-aie-2026-07-02
- 2026-07-07T00:30:00.000Z: random=false, regular=true, id=local-codex-regular-reset-2026-07-07
- 2026-07-09T22:00:00.000Z: random=true, regular=false, id=local-codex-gpt-5-6-release-reset-2026-07-10
- 2026-07-10T18:26:00.000Z: random=true, regular=false, id=local-codex-gpt-5-6-sol-release-reset-2-2026-07-11
- 2026-07-11T06:00:00.000Z: random=true, regular=false, id=local-codex-gpt-5-6-sol-release-reset-3-2026-07-11
- 2026-07-12T18:30:00.000Z: random=true, regular=false, id=local-codex-6m-users-reset-2026-07-13
- 2026-07-13T18:40:00.000Z: random=true, regular=false, id=personal-tibo-7m-users-banked-reset-2026-07-14
- 2026-07-14T20:45:00.000Z: random=true, regular=false, id=local-codex-8m-users-reset-2026-07-15
- 2026-07-16T04:15:00.000Z: random=true, regular=false, id=local-codex-9m-users-reset-2026-07-16
- 2026-07-18T03:31:00.000Z: random=true, regular=false, id=local-codex-gpt-5-6-sol-release-reset-4-2026-07-18
- 2026-07-21T17:05:00.000Z: random=true, regular=false, id=local-codex-10m-users-reset-2026-07-22
- 2026-07-25T19:17:00.000Z: random=true, regular=false, id=local-codex-outage-compensation-reset-2026-07-26
- 2026-07-28T03:09:00.000Z: random=true, regular=false, id=local-codex-chatgpt-work-adoption-reset-2026-07-28
- 2026-07-29T04:09:00.000Z: random=true, regular=false, id=local-codex-gpt56-sol-efficiency-reset-2026-07-29
- 2026-08-01T03:32:00.000Z: random=true, regular=false, id=tibo-reset-2083395449814229287
- 2026-08-08T03:32:00.000Z: random=false, regular=true, id=regular-reset-weekly-regular-reset-2026-08-08T03-32-00-000Z
- 2026-08-08T20:29:22.000Z: random=true, regular=false, id=tibo-reset-2086188036493344823
- 2026-08-11T00:28:16.000Z: random=true, regular=false, id=tibo-reset-2086972933566857393
- 2026-08-13T03:34:43.341Z: random=true, regular=false, id=tibo-reset-2087706104814023111

## Density and intervals

- rolling density: {"rolling":[{"days":7,"maxCount":7,"minCount":1,"latestCount":1},{"days":14,"maxCount":9,"minCount":1,"latestCount":1}],"gpt56HighDensityPeriod":"Descriptive label only: the mid-July GPT-5.6 period contains the highest observed short-window concentration in this snapshot.","afterAugustFirst":"The post-2026-08-01 interval is short and does not support a stable normal-regime estimate."}
- reset intervals: [{"from":null,"to":"2026-05-16T17:51:00.000Z","hours":null},{"from":"2026-05-16T17:51:00.000Z","to":"2026-05-19T18:39:18.000Z","hours":72.805},{"from":"2026-05-19T18:39:18.000Z","to":"2026-05-23T20:14:00.000Z","hours":97.57833333333333},{"from":"2026-05-23T20:14:00.000Z","to":"2026-05-31T15:25:06.000Z","hours":187.185},{"from":"2026-05-31T15:25:06.000Z","to":"2026-06-04T00:25:58.000Z","hours":81.01444444444445},{"from":"2026-06-04T00:25:58.000Z","to":"2026-06-17T22:00:00.000Z","hours":333.5672222222222},{"from":"2026-06-17T22:00:00.000Z","to":"2026-06-27T03:00:00.000Z","hours":221},{"from":"2026-06-27T03:00:00.000Z","to":"2026-06-29T00:00:00.000Z","hours":45},{"from":"2026-06-29T00:00:00.000Z","to":"2026-06-30T00:30:00.000Z","hours":24.5},{"from":"2026-06-30T00:30:00.000Z","to":"2026-07-01T20:50:00.000Z","hours":44.333333333333336},{"from":"2026-07-01T20:50:00.000Z","to":"2026-07-09T22:00:00.000Z","hours":193.16666666666666},{"from":"2026-07-09T22:00:00.000Z","to":"2026-07-10T18:26:00.000Z","hours":20.433333333333334},{"from":"2026-07-10T18:26:00.000Z","to":"2026-07-11T06:00:00.000Z","hours":11.566666666666666},{"from":"2026-07-11T06:00:00.000Z","to":"2026-07-12T18:30:00.000Z","hours":36.5},{"from":"2026-07-12T18:30:00.000Z","to":"2026-07-13T18:40:00.000Z","hours":24.166666666666668},{"from":"2026-07-13T18:40:00.000Z","to":"2026-07-14T20:45:00.000Z","hours":26.083333333333332},{"from":"2026-07-14T20:45:00.000Z","to":"2026-07-16T04:15:00.000Z","hours":31.5},{"from":"2026-07-16T04:15:00.000Z","to":"2026-07-18T03:31:00.000Z","hours":47.266666666666666},{"from":"2026-07-18T03:31:00.000Z","to":"2026-07-21T17:05:00.000Z","hours":85.56666666666666},{"from":"2026-07-21T17:05:00.000Z","to":"2026-07-25T19:17:00.000Z","hours":98.2},{"from":"2026-07-25T19:17:00.000Z","to":"2026-07-28T03:09:00.000Z","hours":55.86666666666667},{"from":"2026-07-28T03:09:00.000Z","to":"2026-07-29T04:09:00.000Z","hours":25},{"from":"2026-07-29T04:09:00.000Z","to":"2026-08-01T03:32:00.000Z","hours":71.38333333333334},{"from":"2026-08-01T03:32:00.000Z","to":"2026-08-08T20:29:22.000Z","hours":184.9561111111111},{"from":"2026-08-08T20:29:22.000Z","to":"2026-08-11T00:28:16.000Z","hours":51.98166666666667},{"from":"2026-08-11T00:28:16.000Z","to":"2026-08-13T03:34:43.341Z","hours":51.107594722222224}]

## Notes

- Rolling counts and EWMA rates are descriptive diagnostics, not a post-hoc hot/normal rule used by the model.
- The sample is small and the GPT-5.6 high-density period was identified after inspecting the history; this is a post-hoc selection limitation.
- Regular boundaries reset elapsed exposure but never increase the random event or regime event count.
