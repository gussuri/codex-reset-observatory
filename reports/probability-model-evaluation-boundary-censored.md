# Random Boundary-Censored Probability Evaluation

- Evaluation: walk_forward_prequential (no backfill; future boundaries are used only for censor-aware labels)
- asOf: 2026-08-01T03:32:00.000Z
- Current model: hazard-odds-v3-random-inclusive
- Candidate model: hazard-odds-v3-random-boundary-censored
- Random event count: 23
- Boundary count: 26
- Origins: 42

## Interval construction

- Current event intervals: 22
- Current exposure days: 76.40
- Candidate event intervals: 22
- Candidate censored intervals: 2
- Candidate exposure days: 76.40
- Candidate current right-censored hours: 0.00

## Regular boundaries

| ID | Reset at | Record kind | Scope | Included | Reason |
| --- | --- | --- | --- | --- | --- |
| local-codex-regular-reset-2026-06-25 | 2026-06-24T22:01:00.000Z | reference | 全有料プラン | yes | accepted |
| local-codex-rate-limit-reset-notice-2026-06-17 | 2026-06-17T22:00:00.000Z | reference | 全有料プラン | yes | accepted |
| personal-reset-credit-2026-06-11 | 2026-06-12T00:11:00.000Z | banked_distribution | 全有料プラン | yes | accepted |
| local-codex-regular-reset-2026-08-08 | 2026-08-08T03:32:00.000Z | reference | 任意リセット未使用アカウント | no | future_timestamp |
| local-codex-regular-reset-2026-07-07 | 2026-07-07T00:30:00.000Z | reference | 任意リセットを使っていないアカウント | no | not_broad_scope |

## Evaluation

- Current 24h: scored=41, censored=1, Brier=0.2615, logLoss=0.7424
- Candidate 24h: scored=41, censored=1, Brier=0.2651, logLoss=0.7570
- Current 48h: scored=40, censored=2, Brier=0.3110, logLoss=0.8263
- Candidate 48h: scored=40, censored=2, Brier=0.3170, logLoss=0.8435
- Candidate classification: worse
- Brier difference (candidate-current): 24h 0.0036, 48h 0.0060
- Log loss difference (candidate-current): 24h 0.0146, 48h 0.0172

## Fixed-time comparison

- At: 2026-08-01T03:32:00.000Z
- Last random reset: 2026-08-01T03:32:00.000Z
- Last broad boundary: 2026-08-01T03:32:00.000Z
- Current age: 0.00h
- Candidate age: 0.00h
- Current 12h / 24h / 48h / 72h: 8.48% / 16.24% / 44.58% / 56.48%
- Candidate 12h / 24h / 48h / 72h: 8.10% / 15.55% / 42.85% / 56.12%
- Difference (candidate-current): -0.37% / -0.69% / -1.73% / -0.36%

## Notes

- The candidate treats each accepted broad regular reset as a boundary and right-censors the interval at that boundary without incrementing random event count.
- A regular boundary inside a scored horizon is censored rather than scored as a simple negative; current and candidate use the same scored origins.
- The model calculations use only history available at each origin; future records are used only to create censor-aware evaluation labels.
- The public model is hazard-regime-elapsed-v1; this report compares the boundary candidate with the unweighted hazard-odds-v3-random-inclusive baseline.
