# Broad banked random clock v2

## Purpose

`broad-banked-boundary-v2` is a prospective-only random-clock policy for the shadow estimator. It keeps the current 18-hour bandwidth, 54-hour truncation, continuous hazard integration, frozen regime multiplier, signal handling, notice handling, and post-reset attenuation unchanged. The policy changes only which completed recovery events can be used as random boundaries.

The policy version is `broad-banked-distribution-random-clock-v2`. Its freeze point is `2026-09-18T03:10:48.666Z`.

The legacy `legacy-random-cycle-v1` policy remains the default and its `isEligibleRandomResetEvent()` semantics are unchanged.

## Boundary semantics

Under v2:

- `confirmed_global` contributes a random boundary only when it is a completed, past, non-rejected/voided, broad, nonconditional `ランダムリセット`.
- `banked_distribution` contributes a random boundary when it is completed, past, non-rejected/voided, broad, nonconditional, and its cycle is either `ランダムリセット` or `定期リセット`.
- Narrow, conditional, future, rejected, and voided records do not contribute random boundaries.
- A broad banked record admitted as v2 random can also remain regular. The static `personal-reset-credit-2026-06-11` event, completed at `2026-06-12T09:11:00+09:00`, is the explicit fixture for this dual classification. Its history identity and chronology are unchanged; only the v2 eligibility view adds the random flag.
- A regular `confirmed_global` record remains non-random.

The recovery-boundary audit records the v2 policy version for v2 shadow artifacts. Legacy artifacts retain the existing default shape and values. The late-age diagnostic stores pre-reset regime multiplier fields only for the `pre-reset-frozen-regime` arm; the other three arms use `null`, `false`, and `null` for those non-applicable fields.

## Models and freeze rules

The base shadow model is:

`hazard-regime-broad-banked-random-continuous-post-reset-age-raw-bw18-tr54-v2`

The late-age diagnostic uses four separate v2 model identities: control, late-neutral-144h, late-no-downward-144h, and pre-reset-frozen-regime. They use the same 144-hour threshold and the same estimator settings as the v1 late-age diagnostic. v1 and v2 forecast rows are never mixed by the v2 evaluator.

All v2 rows are prospective diagnostic artifacts. There is no historical backfill, relabeling, retuning, or automatic publication. The existing public selector and published model remain:

`hazard-regime-random-continuous-post-reset-age-raw-bw18-tr54-v1`

The public API, DTO, UI, database schema, and existing prediction rows are outside this experiment and remain unchanged.

## Prospective evaluation

The v2 evaluator keeps the existing daily-first and comparable-origin rules. Overall metrics are descriptive comparison fields. Late-age primary metrics use only the same comparable origins whose saved `randomElapsedHours` is at least 144 hours:

`candidate (late-no-downward) metric - control metric`

This applies to Brier score and log loss at both 24 hours and 48 hours. A zero late-age sample returns `null`; a comparison is not computed when one side lacks the same late-age sample. `lateAgeResolved24h` and `lateAgeResolved48h` remain the resolved counts for that same late-age primary sample.

`canonicalRandomBoundaryCount` counts only random boundaries with a valid timestamp at or before `asOf`; future or invalid boundaries are excluded.

## Interval and sensitivity diagnostics

`evaluate:broad-banked-random-clock-v2` is a read-only diagnostic command. It can use Production recovery inputs or local static history with `--static-only`. It reports interval histograms for `0–24h`, `24–48h`, `48–72h`, daily bins through `9–10d`, and `10d+`.

The interval comparison derives the legacy and v2 elapsed hours from timestamps. When one legacy interval is split by a newly admitted v2 banked boundary, the diagnostic verifies that the v2 parts sum to the legacy interval. The approximately `333.567h` interval and approximately `191.75h + 141.82h` split are evidence from timestamps, not hardcoded model inputs.

The sensitivity table covers ages from 144 hours through 360 hours. It reports instantaneous raw daily probability, the frozen regime multiplier, attenuated P24/P48, and pure no-regime P24/P48. Signal and notice effects are intentionally excluded so the late second-peak comparison isolates reset-clock structure. No diagnostic command writes `prediction_history` or calls `/api/log-probability`.
