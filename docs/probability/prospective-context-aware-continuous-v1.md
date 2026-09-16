# Prospective Context-aware Continuous Probability v1

## Registration

- Model version: `hazard-regime-random-continuous-context-calibrated-bw18-tr54-v1`.
- Evaluation mode: prospective shadow only.
- Freeze timestamp: `2026-09-16T18:25:40.948Z` (UTC).
- Public model: no. The public selector, V4 corrective rollback, and public-v1 DTO are unchanged.
- Auto publish: prohibited.
- Manual review: required even if the advisory gate is met.
- Historical forecast backfill, relabeling, and rewriting existing 18/54 control or challenger rows are prohibited.

The freeze timestamp fixes the candidate architecture and policy. Rows before the
freeze may be used as development/training input only when their saved point-in-
time context state is available. They are never prospective superiority evidence.
Only candidate forecasts generated at or after the freeze are eligible for the
candidate's prospective score.

## Inherited baseline

The candidate reuses the existing raw 18/54 challenger calculation and its
post-reset-age regime policy. It inherits bandwidth 18 hours, truncation 54
hours, grid and integration settings, priors, probability floor/cap, boundary
semantics, and target definition. The existing 18/54 experiment is not retuned.
No 12/36, 15/45, 21/63, or other bandwidth/truncation search is part of this
candidate.

The candidate uses the challenger continuous age baseline before ordinary
semantic signal multipliers. Hand-written teaser multipliers are not applied a
second time.

## Context model

Only three context states are eligible for the context layer:

- `none`
- `weak`
- `strong`

For each of 24h and 48h independently:

```text
logit(P_final_h) = logit(P_age_h)
  + alpha_h
  + betaWeak_h * I(weak)
  + betaStrong_h * I(strong)
```

The intercept is the context-logit intercept; no second generic calibration
intercept is applied. `none` uses only `alpha`, `weak` uses `alpha + betaWeak`,
and `strong` uses `alpha + betaStrong`. A row cannot be both weak and strong.

Coefficients use deterministic MAP logistic regression with independent
N(0, 0.5^2) priors and a minimum of 10 eligible training samples per horizon.
Below the minimum, all coefficients are zero and the candidate falls back to
the age-only baseline. The same fallback applies when the training read fails.

Official notices, status incidents, official incident hints, official updates,
community signals, usage anomalies, complaint pressure, and other non-teaser
context are excluded from coefficient fitting and context boosting. Official
notice timing/override policy is applied at the end of the pipeline. These
exclusions are retained as compact audit counts/reasons where available.

Context state is point-in-time safe. The implementation prefers saved
explicit/effective teaser state from the forecast origin, then the existing
point-in-time projection, then a safe audit fallback. Unknown state is excluded
from training and is not silently treated as `none`.

## Pipeline

```text
18/54 age baseline
  -> context-aware logit adjustment
  -> horizon coherence
  -> official notice timing policy/override
  -> final candidate probability
```

The final 48h probability is at least the final 24h probability. 12h and 72h
remain derived from the candidate's 24h and 48h values using existing horizon
semantics; no separate 12h/72h fit is introduced.

## Stored audit

The candidate is stored only in
`prediction_history.debug_info.experimentalProbabilityForecasts`. The compact
audit includes model/origin/freeze identity, evaluation mode, `backfilled=false`,
18/54 baseline and final values, context state/provenance, alpha/beta values,
per-horizon sample and positive counts by state, last resolved training origin,
excluded counts/reasons, prior/minimum sample settings, fit fallback/read status,
horizon coherence and official override state, latest random reset/elapsed state,
and the inherited 18/54 estimator audit. Raw training rows are not stored.

Existing B, A, C, C v2, and bandwidth control/challenger forecasts remain
unchanged. The candidate is not exposed by public-v1.

## Prospective evaluation

The evaluator uses candidate rows generated at or after this freeze, requires
same-origin candidate and 18/54 challenger evidence, and chooses the first
saved forecast per Asia/Tokyo calendar day. It reports resolved count, positive
count, target reset count, mean prediction, actual rate, Brier score, log loss,
candidate-minus-baseline deltas, none/weak/strong diagnostics, latest
coefficients, and excluded/unknown context counts.

The age-only 18/54 baseline is the saved candidate age baseline. The existing
18/54 challenger is the hand-coded-signal comparison. The advisory gate uses
target resets >= 5, resolved daily 24h >= 20, resolved daily 48h >= 15, no Brier
regression at either horizon, and log-loss worsening no greater than 0.05.
The gate never publishes or changes parameters automatically.
