# Shadow Hazard Probability v1

## Purpose

`hazard-odds-v1` is the public probability model. The former heuristic model
is retained as a comparison model and is used only when the shadow result is
invalid or throws an exception. Model metadata and audit details remain
internal and are not shown in the dashboard or `/api/current`.

The model is a **ベイズ平滑化した区分ハザードと保守的なシグナル倍率を組み合わせたshadow確率モデル**. It uses a transparent empirical-Bayes prior rather than model training or parameter optimization.

## Event definition

The event collection reuses the existing global reset semantics:

- static history and formally accepted Tibo reset signals are combined by
  `combineResetHistory`;
- opened, pending, invalid, rejected, future, and execution-time-less records
  are excluded;
- records with `details.resetMethod === "任意リセット権1回配布"` are excluded;
- completed regular and random resets are both included because the current
  global reset age/count calculations use that same combined collection;
- explicitly narrow scopes such as a specific user, individual account, or
  subset are excluded; known account-wide and legacy regular-reset scope
  labels are retained.

The current code treats a formally accepted Tibo post's creation time as its
completed reset time. That existing meaning is preserved here. Static and
dynamic duplicates are removed before interval construction.

## Piecewise hazard

Completed reset timestamps are sorted and adjacent intervals are collected.
The period before the first known event is not treated as exposure. The period
after the latest event is right-censored exposure, so it contributes time but
not an event.

The age bins are 0-24, 24-48, 48-72, 72-96, 96-120, 120-144, 144-168, and
168+ hours. Each bin has a posterior hourly rate. The model uses the explicit
prior constants in `data/shadowProbabilityConfig.ts`:

- global prior events: `1`;
- global prior exposure: `10` days;
- per-bin equivalent prior exposure: `20` days.

This is an empirical-Bayes smoothing rule, not a fitted Bayesian model. Each
bin's implied daily probability is guarded to 1%-35% to avoid 0%/100% output
from sparse data. Both the 24-hour and 48-hour baselines integrate the same
piecewise hourly curve from the current reset age.

## Signal odds multipliers

Signals are applied after the baseline through odds, not direct probability
addition. Available inputs are recent completed reset count, regular-reset
proximity, teaser strength, weighted Status score, official incident hints,
official updates, community mentions, usage-limit anomalies, and independent
complaint pressure. Missing inputs remain at multiplier `1`.

The conservative initial multipliers and total caps are configuration values,
not values optimized against this small history. An active official notice
uses the existing 90%/96% override for the shadow result as well.

## Confidence and evaluation

Confidence is metadata only. An active official notice is `high`; at least 30
completed intervals and 120 exposure days is `medium`; otherwise it is `low`.

`scripts/evaluate-shadow-probability.ts` is read-only. It evaluates the saved
probability snapshots and uses only events available by each snapshot time for
historical hazard calculations. The repository currently does not retain
point-in-time snapshots of Status, community, teaser, and other signal inputs,
so historical full-shadow metrics are reported as unavailable rather than
reconstructed from today's data. The script still reports the hazard-only,
constant-rate, elapsed-time-only, and recorded primary comparisons, plus a
current shadow preview. Future online logs can make the full-shadow comparison
available without backfilling old rows.

## Promotion criteria

The public switch is intentionally conservative: the shadow result must be
finite, stay within 0%-100%, and satisfy `P24 <= P48`. Otherwise the former
heuristic result is published for that calculation and the fallback reason is
kept in internal debug information. Future evaluation should continue to
check multi-period calibration, 24/48-hour ordering, and behavior across more
than one concentrated reset period.
