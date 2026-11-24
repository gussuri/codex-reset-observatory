# Adaptive regime survival v3 — implementation specification

> Status update (2026-11-24): `hazard-adaptive-regime-survival-v3` is configured for a forward manual public adoption boundary at `2026-11-24T11:15:00.000Z` (JST `2026-11-24 20:15`). Historical periods (`v1`, `v2`, and readopted `v2`) remain unchanged before that boundary, and no prior prediction is relabeled.

Freeze timestamp: `2026-11-24T11:10:00.000Z`. Formula, prior weight, and hyperparameters are frozen under `hazard-adaptive-regime-survival-v3` and must not be retuned against new outcomes under this identity.

## Root cause motivating v3

In frozen `Survival v1` (`hazard-survival-conditioned-adaptive-h45-tail-h24-v1`), both `qRaw` (the raw bin death probability `deaths / riskWeight` when `ess >= 1`) and `getNeighborEstimate()` (`neighborWeightedDeaths / neighborWeightedExposure`) are unshrunk empirical ratios. When elapsed random age `u` approaches the longest historical completed interval (`maxSupportedAgeHours = 288.0h`), `ess` drops toward `1.0`:

- `qRaw` spikes near `1.0` from a single terminal interval, and `qNeighbor` also inflates over the narrow high-age tail.
- `Survival v1` instantaneous hazard rises to `~0.0689/h` (`dailyProbability ~ 80.8%`), and its right-tail anchor jumps to `~80.9%/day`.
- Even when frozen `Adaptive v2` (`hazard-adaptive-regime-survival-v2`) damps the short-term rate down to `r = 0.372` after 11+ days with no random reset, multiplying `lambda_v1 * r` still pushes 24h / 48h probabilities up to `36.2% / 55.3%`.

## Empirical Bayes `sqrt(ess0)` hazard shrinkage (`v3`)

Let $w_0 = \sqrt{\text{ess}_0}$, where $\text{ess}_0$ is the weighted total effective sample size at $t = 0$ from `SurvivalConditionedHazard.ess0` (`w_0 = 5.56` on 48 completed intervals), and let $q_{\text{long}} = 1 - \exp(-L \cdot \Delta_{\text{bin}})$ be the global long-run weighted hazard per 12h bin (`L = base.hazard.longTermHazardPerHour`).

For any elapsed age $u$ inside $[0, \text{maxSupportedAgeHours}]$:

1. **Bin death-probability shrinkage**: replace unshrunk `rawDeaths / bin.riskWeight` with
   $$q_{\text{raw}}(u) = \frac{d_{\text{raw}} + w_0 \cdot q_{\text{long}}}{r_{\text{bin}} + w_0}$$
2. **Kernel neighbor estimate shrinkage**: replace unshrunk `deaths / exposureBins` with
   $$q_{\text{neighbor}}(u) = \frac{d_{\text{neighbor}} + w_0 \cdot q_{\text{long}}}{e_{\text{neighbor}} + w_0}$$
3. **Combination & tail extrapolation**: preserve the exact `Survival v1` $\alpha(u) = \text{clamp}(\text{supportFraction}(u) \cdot \text{ess}(u) / (\text{ess}(u) + \text{essTarget}), 0, 1)$ blend, $q(u) = \alpha(u) q_{\text{raw}}(u) + (1-\alpha(u)) q_{\text{neighbor}}(u)$, `binHours = 12` conversion $\lambda_{\text{v3,age}}(u) = -\ln(1 - q(u)) / 12$, and `H24` exponential tail return toward $L$ beyond `maxSupportedAgeHours` anchored at $\lambda_{\text{v3,age}}(\text{maxSupportedAgeHours})$ (`37.6%/day` instead of `80.9%/day`).
4. **Frozen Adaptive v2 regime multiplier & runtime policies**: keep `shortHalfLifeHours = 72`, `priorExposureHours = 48`, `minRateMultiplier = 0.25`, `maxRateMultiplier = 4`, no-next-event `C(u)/E(u)` decay, 10-minute trapezoid integration, valid `Survival v1` support gate (`>= 36` completed intervals), ordinary signal multipliers, timed teaser reallocation, official notice override, lower clamp, and fallback (`v3 -> v2 -> Survival v1 -> Broad-Banked v2 -> remaining chain`) unchanged.

Zero new tunable parameters are introduced; $w_0 = \sqrt{\text{ess}_0}$ adapts automatically with sample size. Both `Survival v1` and `Adaptive v2` remain completely frozen and bit-for-bit identical.

## Point-in-time replay verification (197 deduplicated origins, `2026-09-19..2026-11-24`)

Evaluated strictly point-in-time on canonical broad random events (`49` events / `48` completed intervals) across saved origins:

- Full 197 origins (`193` mature 24h, `187` mature 48h):
  - `24h` Brier `0.1839 -> 0.1810` (BSS `0.035 -> 0.051`), LogLoss `0.5867 -> 0.5626`, AUC `0.642 -> 0.653`
  - `48h` Brier `0.2513 -> 0.2496`, LogLoss `0.7440 -> 0.7288`, AUC `0.581 -> 0.584`
- Full no-notice subset:
  - `24h` Brier `0.1735 -> 0.1702` (BSS `-0.014 -> +0.005`), LogLoss `0.5403 -> 0.5177`
- Early campaign / cluster period (`2026-09-19..2026-10-29`): improves both `24h` and `48h` Brier, LogLoss, and AUC over frozen `v2`.
- Matched readoption/late period (`2026-10-29..now`): matches or slightly improves `v2` (`v1` remains significantly worse than both `v2` and `v3`).
- Live 11.4-day no-notice regime (`2026-11-24`): baseline `tailAnchorDaily` drops from `80.9%` (`v2`) to `37.6%` (`v3`), yielding `12h = 9.4%`, `24h = 16.2%`, `48h = 26.4%`, `72h = 34.0%`.
