# Adaptive regime survival v2 — implementation specification

> Status update (2026-10-29): the reviewed model is configured for a manual public boundary at `2026-10-29T12:20:00.000Z` (JST 21:20). The selector remains on Survival v1 before that boundary; no prior prediction is relabeled.

User explicitly requests creating an improved new model and changing Production to it after verification. Sol owns design/evaluation/review; existing Luna7 owns implementation. This supersedes publishing the old burst candidate, whose uncommitted work must remain preserved.
Design fixed before scoring this new formula. Design timestamp2026-10-29T10:26:53Z. Do not search/tune parameters against recent outcomes under this identity.

## Product behavior and decision
Build a cheap, continuously adaptive short/long regime correction around the valid frozen Survival v1 age hazard. Recent resets raise the short rate; elapsed time with no reset reduces it. No campaign text/date boost, daily-reset assumption, LLM, new poll/cron, schema, or extra network query.
Keep official notice and timed teaser semantics, broad random target, monitor admission, manual protection, canonical identity/timestamps, public-v1 DTO and existing fallback.
Unlike existing burst context, this model has no contextual coefficient fitting, Pacific time features or iterative solver. It must not add the expensive old all-arm calculation to public requests.

## Fixed new identity and defaults
- modelVersion: hazard-adaptive-regime-survival-v2
- freezeAt:2026-10-29T10:26:53.000Z; freeze architecture/hyperparameters, not the accumulation of new observations.
- shortHalfLifeHours=72; priorExposureHours=48; minRateMultiplier=0.25; maxRateMultiplier=4.
- Integration step10minutes; horizons12/24/48/72h.
- Valid existing Survival v1 support gate (36 completed intervals, finite coherent base) stays. v1 H45/H24 is unchanged.
- The initial adoption boundary was null pending independent review. The local configuration now sets the reviewed forward boundary to `2026-10-29T12:20:00.000Z`; previous public model is Survival v1. Existing periods/forecasts are never relabeled. Fallback v2 -> Survival v1 -> existing Broad-Banked/remaining chain.

## Formula and evidence at one origin
All times below are hours. Get the same deduplicated canonical broad random boundaries as v1, with times <= origin t. Exclude regular, narrow, personal, future and excluded rows. Do not use Tibo post count as event count.
Let s be the first boundary, used only as the left exposure anchor; count subsequent observed boundaries x_i (exclude first because observation history is left-truncated).
Let k=ln(2)/72, L=base.hazard.longTermHazardPerHour (finite and >0).
C0=sum_i exp(-k*(t-x_i)).
E0=(1-exp(-k*(t-s)))/k. Use expm1 for stable small durations.
At u hours in the future conditional on no next event before t+u:
C(u)=C0*exp(-k*u).
E(u)=E0*exp(-k*u)+(1-exp(-k*u))/k.
shortRate(u)=(C(u)+48*L)/(E(u)+48).
r(u)=clamp(shortRate(u)/L,0.25,4).
lambdaNew(u)=existingSurvivalHazard(base.hazard,base.randomElapsedHours+u)*r(u).
P(h)=1-exp(-integral_0^h lambdaNew(u)du), evaluated with the existing trapezoid10min scheme.
This predicts the next event; do not insert hypothetical future resets in the no-event path.
The Survival base still trains on completed intervals only. The NEW regime rate intentionally uses time since the last event as no-event exposure; this difference must be explicit in docs/audit/tests rather than silently changing v1.
The ratio can change through the forecast horizon. Do not hold the origin multiplier fixed for72h or apply independent odds adjustments at each horizon that break coherence.
Degenerate/invalid history, nonfinite intermediates, invalid base or incoherent horizons fail safely to v1 with accurate internal reason.

## Signals and runtime
Apply the existing ordinary odds multipliers once to the NEW baseline horizons, then the existing timed teaser reallocation once. Get both from the same source/canonical context and origin semantics as v1, including excluding the timed teaser from the ordinary path. Explicit official-notice override wins with exactly the current final horizons.
Reuse shared helpers by a small extraction with independent v1/golden parity; do not duplicate or rewrite policies. Do not feed already signal-adjusted v1 predictions back through multipliers.
Use existing public calculation-time rounding/reset lower clamp. Reuse an already computed v1 result, no second base fit per v2. No new persistent cache. Request-scoped reuse is allowed only with correct source/generation/time/options identity.
Existing six-hour logging cadence is unchanged. New v2 audit should be compact: version/parameters/origin/C0/E0/L/current short rate/ratio/clamp/fallback and existing signal/policy references. Do not duplicate full raw histories or boundaryAudit for each new arm. Reuse existing saved v1 point-in-time audit.
Public semantic output is probabilities and accurate internal model identity; no unrequested implementation jargon in site copy.

## Evaluation before publication
Use existing probability-review-20261029/evidence.json as the frozen observed-outcome reference and the same139 saved rows /127 six-hour origins, not new repeated DB dumps.
New formula has no saved historical forecasts: explicitly label its evaluation retrospective/PIT replay, NOT prospective or saved new-model predictions.
For features, project only each original row's saved Survival boundaryAudit, ordinarySignalMultipliers, notice override and timedTeaserReallocation audit (CDF/weight when applied), baseline horizons and metadata needed for replay. One compact bounded SQL query is allowed to retrieve these missing saved audit fields. Do not fetch current source text or inject current classifications into old origins.
Before scoring v2, prove the replayed v1 hazard/baseline and policies reproduce the saved v1 experimental forecast to <=1e-9. Use identical effective origin; if impossible, explain/count/exclude the incompatible origins consistently for both. Never silently substitute current history/features. Official notice cases may copy the saved final override horizons for both models. Timed teaser must use the original saved CDF/weight and the same shared policy; otherwise mark unavailable, not guessed.
Score the SAME matched origin set for both. Fully mature horizons only. Report broad target as primary and forced-only as sensitivity. Report full period, campaign from Day1 posting2026-10-05T17:20:29Z, pre-campaign, recent7, no-notice, age<24h, nonoverlapping windows and reset-cycle resampling. Sep26 missing-monitor manual row remains sensitivity only. No truth/backfill changes.
Predetermined publication requirements: v2 Brier improves over replayed v1 at both24h and48h for full and campaign/no-notice sets; pre-campaign Brier degradation <=0.005 absolute at either horizon; campaign log loss improves; full log loss does not worsen. Report counts/coverage and all failures. Recent7 is descriptive (5 events), not an independent unseen holdout. Bootstrap does not erase post-hoc model choice uncertainty.
If this first frozen model fails requirements, do not tune it repeatedly or force publication. Report the failure to Sol; Sol will revise design under a NEW version if necessary. User authorized a useful product improvement, not knowingly worse output.

## Tests and performance requirements
- Analytic C/E decay and exposure dimensions; equal-time/dedup/future/ineligible boundary filtering.
- Recent repeated events increase rate; controlled no-event gap lowers rate and ratio; constant-base-hazard synthetic campaign->gap lowers forecast. Do not assert all real age hazards monotonically fall with wall time.
- Prior shrinkage, min/max clamps, zero/invalid L, insufficient support, invalid dates/NaN, same timestamp/first boundary left-truncation.
- Next-event coherence12<=24<=48<=72, numerical integration vs fine reference, no future-feature leakage and no hypothetical reset insertion.
- v1 untouched golden parity, signal/teaser once, notice exact override, all locale DTO/history/identity unchanged, post-reset lower-clamp behavior.
- Adoption before/at/after/null, fallback/exception/model audit and logging identities/previous period.
- Offline ordinary/long history timings incl3locale/public and existing logging path; report actual call counts and CPU. No iterative context fit, new DB/provider call or full-arm evaluation added by public v2.

## Execution and release
Fresh isolated managed worktree/branch from latest origin/main (known87308aeff3481eea3dcd8d7d18c6a306e67994fd or later); preserve primary, live Monitor and old probability dirty tree. No new chat/subagent.
Luna writes checked plan at docs/superpowers/plans/2026-10-29-adaptive-regime-survival-v2.md and copies this spec to repository docs/probability/adaptive-regime-survival-v2.md.
Implement with meaningful red/green tests, replay and benchmark. Focused -> full test -> lint -> typecheck -> build (sequential .next consumers) -> registry check -> diffcheck. Keep all artifacts including red failures, replay coverage/failures and before/after numbers.
After local verification, report code/diff/worktree, replay metrics and limitations, test counts and performance to Sol by normal chat. Do not push/PR/merge/deploy or activate boundary until Sol independent review. Then one batched publication, exact commit CI/Preview target check and Production API/HTML verification; no repeated intermediate deployments.
