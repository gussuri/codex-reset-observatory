# Tibo teaser strength synthetic stress test

This is a holdout evaluation-only dataset. Its expected labels were not sent to Gemini and were not added to the system prompt or few-shot examples.
Production classification, database rows, UI, probability, and the existing Gemini prompt were not changed.

- Evaluation started: 2026-08-07T11:21:25.027Z
- Gemini model: gemini-3.5-flash-lite
- Dataset: 32 holdout posts (26 ordinary + 6 reply-context)
- Requested runs: 3
- Completed runs: 3
- API requests: 96
- Successful responses: 96
- Rate-limited responses: 0

## Gold distribution

- strong: 7
- weak: 10
- none: 15

## Classification metrics (all)

| run | accuracy | strong P/R | weak P/R | none P/R |
|---:|---:|---:|---:|---:|
| 1 | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 2 | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 3 | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| all | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |

## Classification metrics (ordinary posts)

| run | accuracy | strong P/R | weak P/R | none P/R |
|---:|---:|---:|---:|---:|
| 1 | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 2 | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 3 | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| all | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |

## Classification metrics (reply-context posts)

| run | accuracy | strong P/R | weak P/R | none P/R |
|---:|---:|---:|---:|---:|
| 1 | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 2 | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 3 | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| all | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |

## Evidence quote validation (all)

| run | classified | evidence valid | invalid_evidence | valid rate |
|---:|---:|---:|---:|---:|
| 1 | 32 | 32 | 0 | 100.0% |
| 2 | 32 | 32 | 0 | 100.0% |
| 3 | 32 | 32 | 0 | 100.0% |
| all | 96 | 96 | 0 | 100.0% |
- Expected strong: 21/21 valid (100.0%).
- Expected weak: 30/30 valid (100.0%).
- Expected none: 45/45 valid (100.0%).

## Evidence quote validation (ordinary posts)

| run | classified | evidence valid | invalid_evidence | valid rate |
|---:|---:|---:|---:|---:|
| 1 | 26 | 26 | 0 | 100.0% |
| 2 | 26 | 26 | 0 | 100.0% |
| 3 | 26 | 26 | 0 | 100.0% |
| all | 78 | 78 | 0 | 100.0% |
- Expected strong: 18/18 valid (100.0%).
- Expected weak: 24/24 valid (100.0%).
- Expected none: 36/36 valid (100.0%).

## Evidence quote validation (reply-context posts)

| run | classified | evidence valid | invalid_evidence | valid rate |
|---:|---:|---:|---:|---:|
| 1 | 6 | 6 | 0 | 100.0% |
| 2 | 6 | 6 | 0 | 100.0% |
| 3 | 6 | 6 | 0 | 100.0% |
| all | 18 | 18 | 0 | 100.0% |
- Expected strong: 3/3 valid (100.0%).
- Expected weak: 6/6 valid (100.0%).
- Expected none: 9/9 valid (100.0%).

## Stability

- All-run unanimous: 32/32 (100.0%)
- Pairwise agreement: 96/96 (100.0%)
- Ordinary unanimous: 26/26 (100.0%)
- Reply-context unanimous: 6/6 (100.0%)

## Per-post results

| id | type | expected | run 1 | run 2 | run 3 | evidence valid |
|---|---|---|---|---|---|---|
| S1 | ordinary | strong | strong (0.95) | strong (0.95) | strong (0.95) | yes |
| S2 | ordinary | strong | strong (0.95) | strong (0.95) | strong (0.95) | yes |
| S3 | ordinary | strong | strong (0.95) | strong (0.95) | strong (0.95) | yes |
| S4 | ordinary | strong | strong (0.90) | strong (0.90) | strong (0.90) | yes |
| S5 | ordinary | strong | strong (0.95) | strong (0.95) | strong (0.95) | yes |
| S6 | ordinary | strong | strong (0.90) | strong (0.90) | strong (0.90) | yes |
| W1 | ordinary | weak | weak (0.90) | weak (0.90) | weak (0.90) | yes |
| W2 | ordinary | weak | weak (0.90) | weak (0.90) | weak (0.90) | yes |
| W3 | ordinary | weak | weak (0.85) | weak (0.85) | weak (0.85) | yes |
| W4 | ordinary | weak | weak (0.90) | weak (0.90) | weak (0.90) | yes |
| W5 | ordinary | weak | weak (0.90) | weak (0.90) | weak (0.90) | yes |
| W6 | ordinary | weak | weak (0.95) | weak (0.90) | weak (0.90) | yes |
| W7 | ordinary | weak | weak (0.90) | weak (0.90) | weak (0.90) | yes |
| W8 | ordinary | weak | weak (0.90) | weak (0.90) | weak (0.95) | yes |
| N1 | ordinary | none | none (0.95) | none (0.95) | none (0.95) | yes |
| N2 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| N3 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| N4 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| N5 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| N6 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| N7 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| N8 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| N9 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| N10 | ordinary | none | none (0.95) | none (0.95) | none (0.95) | yes |
| N11 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| N12 | ordinary | none | none (1.00) | none (1.00) | none (1.00) | yes |
| R1 | reply | weak | weak (0.80) | weak (0.80) | weak (0.80) | yes |
| R2 | reply | none | none (1.00) | none (1.00) | none (1.00) | yes |
| R3 | reply | strong | strong (0.95) | strong (0.95) | strong (0.95) | yes |
| R4 | reply | none | none (1.00) | none (1.00) | none (1.00) | yes |
| R5 | reply | weak | weak (0.90) | weak (0.90) | weak (0.90) | yes |
| R6 | reply | none | none (1.00) | none (1.00) | none (1.00) | yes |

## Misclassified posts

No misclassified posts in the completed runs.

## Comparison with the third evaluation

- The prior 35-case evaluation used the same narrowed weak definition and reported 100% class accuracy for its non-synthetic set, with all-run and pairwise agreement at 100%.
- This 32-case set is an unseen stress test: 26 ordinary synthetic cases and 6 reply-context cases. It was not added to the prompt or few-shot examples.
- Synthetic results are diagnostic evidence only and should not be treated as production performance evidence.

## Safety

The script calls Gemini only for this holdout dataset. It does not query or update Supabase, does not update production classifications, and does not change UI or probability code.