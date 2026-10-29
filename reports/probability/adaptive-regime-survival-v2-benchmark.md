# Adaptive Regime Survival v2 offline benchmark

- Measurement started: `2026-10-29T12:15:06.539Z`.
- Shared forecast origin: `2026-10-29T10:30:00.000Z` (before the configured public boundary).
- Histories: 37 random boundaries (ordinary) and 144 random boundaries (long synthetic history), both ending 20 hours before the origin.
- Public comparison: explicit null-adoption rollback versus an explicit v2 boundary equal to the origin. The configured public boundary is `2026-10-29T12:20:00.000Z`; overrides make this historical-origin comparison independent of that setting.
- Public path: two measured three-locale DTO triplets (`ja`, `en`, `zh`) per mode. A prebuilt canonical history context was reused and excluded from timing.
- Logging path: one measured full logging invocation after one warmup per mode and history size. The v1-only baseline skips only the v2 artifact; both modes run the same v1 base and context-arm calculations.
- CPU is Node `process.cpuUsage()` user plus system time; elapsed time uses `performance.now()`.

## Public three-locale path

| Boundaries | Adoption mode | Elapsed ms/triplet | CPU ms/triplet | v1 base fits / triplet | v2 transforms / triplet | DB/provider calls |
|---:|---|---:|---:|---:|---:|---:|
| 37 | Null override | 145.3342 | 140.5 | 3 | 0 | 0 / 0 |
| 37 | Explicit v2 | 145.2913 | 148.5 | 3 | 3 | 0 / 0 |
| 144 | Null override | 145.8696 | 140.5 | 3 | 0 | 0 / 0 |
| 144 | Explicit v2 | 145.9076 | 164.5 | 3 | 3 | 0 / 0 |

Each measured triplet produced six locale DTOs total, hence six v1 fits in each two-triplet measurement. The v2 path adds exactly one transform per DTO while leaving v1 fits unchanged. Elapsed and CPU differences are within measurement noise at this sample size.

## Experimental logging path

| Boundaries | Mode | Elapsed ms/invocation | CPU ms/invocation | v1 base fits | Context-arm batches | v2 transforms / rows | DB/provider calls |
|---:|---|---:|---:|---:|---:|---:|---:|
| 37 | v1-only baseline | 1262.0674 | 1219 | 1 | 1 | 0 / 0 | 0 / 0 |
| 37 | v2 added | 1266.2136 | 1312 | 1 | 1 | 1 / 1 | 0 / 0 |
| 144 | v1-only baseline | 4783.0208 | 4423 | 1 | 1 | 0 / 0 | 0 / 0 |
| 144 | v2 added | 4777.5329 | 4515 | 1 | 1 | 1 / 1 | 0 / 0 |

The v2 transform uses the already calculated v1 base, so adding it did not add a v1 fit or context-arm batch. Logging includes all existing shadow arms and dominates the measured duration; the single-invocation timing is not precise enough to estimate a stable v2 latency delta.

## Isolated v2 transform

| Boundaries | Measured transforms | Elapsed ms/transform | CPU ms/transform |
|---:|---:|---:|---:|
| 37 | 40 | 0.5699 | 0.375 |
| 144 | 40 | 0.8642 | 0.8 |

## Limitations

- Synthetic fixed 48-hour histories are repeatable workload shapes, not Production traces.
- The public measurement captures DTO and local calculation work, not an HTTP request or provider access.
- Logging timings are one measured invocation per mode and history size; use call counts as the stronger result.
- An earlier 1,000-boundary end-to-end stress batch did not finish within 80 seconds and was stopped. That batch included public-context construction and existing logging arms, so its duration cannot be attributed to the v2 transform.
