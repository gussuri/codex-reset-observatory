# Tibo classification evaluation: stage 1 dry run

Generated 2026-10-15 from the offline evaluator on the evaluation-only branch. This is a data and tooling dry run, not a model evaluation.

## Dry-run result

```text
Tibo classification evaluation dry-run
- fixture cases: 225
- selected cases: 225
- current API calls: 0
- current network: none
- current DB writes: 0
- current provider/model: not run
- future stage 2 diagnostic: 12 inputs × 4 conditions = 48 base calls
- future stage 2 maximum HTTP attempts: 60 (not executed in stage 1)
- real source posts: 32 in 29 groups
- raw AI response: unavailable unless a saved result explicitly includes it
```

The original 145 virtual scenarios remain at the beginning of `tests/fixtures/tibo-scenarios.json`. Eighty additional evaluator-only contrast cases cover classification, temporal expressions, relation/provenance conditions, cancellation/retry, and banked-versus-forced reset outcomes. Their expected labels are hand-authored synthetic controls; they are not Gemini output and do not measure model quality.

## Real-post data

The versioned real-post fixture has 32 posts in 29 event groups. Twenty complete rows from the older evaluation snapshots are retained as regression cases, with legacy wrapper labels and new curator-draft gold stored separately. Incomplete/truncated records and an ambiguous snapshot are not included in the gold set. The October 15 parent, reply, and quoted completion posts retain exact text, timestamps, and source IDs; their relationship evidence comes from the supplied X DOM review. The September 12 relation uses the mapping explicitly recorded in `docs/reset-history-normalization.md`. Other relationships are missing or unverified and are not promoted into lineage.

Five August rows are holdout candidates with `splitReviewStatus: pending_leakage_review`; they are **not** certified unseen holdout data. All known linked posts must remain in one split. The current gold labels have `reviewStatus: curator_draft`, so the fixture is not a fully adjudicated benchmark.

The old wrapper CSV does not preserve the provider's raw response. Its `gemini_prediction` is wrapper output, not raw AI output. Accordingly, legacy raw availability is recorded as unavailable; the evaluator reports raw-layer accuracy as N/A when no raw prediction exists. The legacy CSV contains 23 snapshots; incomplete records and the ambiguous example are excluded from the new gold set rather than guessed.

## Prompt and request context

The current `TIBO_GEMINI_SYSTEM_PROMPT` is 23,158 JavaScript string characters, 23,238 UTF-8 bytes, and 3,292 whitespace-separated words. A true provider token count is not available in this stage. The production wrapper sends the fixed instruction together with a user message that assembles input parts and requests JSON MIME output; it does not supply a provider JSON schema. The instruction handles several tasks together: classification, teaser interpretation, temporal extraction, and operational outcomes.

Prompt length and missing evidence are separate hypotheses. This dry run does not attribute historical errors to either cause. Context cannot repair absent or unverified source relations, and prompt changes are out of scope for stage 1.

## Offline evaluator contract

Saved outcomes are scored independently at raw AI, corrected, and public-outcome layers. Failed requests (including 401, 429, timeout, invalid JSON, and missing fields), abstentions, missing outcomes, and unavailable layers stay distinct from `irrelevant`. Reports include all-request and successful-response accuracy, per-class support/precision/recall/F1, confusion counts, abstention, confidence thresholds, event association, temporal-window comparison, response status counts, and missing outcome IDs. Zero-support and unavailable metrics are null/N/A.

Run `pnpm eval:tibo-offline` for the no-network summary. Saved-result scoring requires an explicit `--results` file and rejects a checkpoint whose run identity differs in fixtures, prompt source, schema, request options, commit, provider, model/version, or input condition. No code path in this stage invokes Gemini or writes to a database.

## Stage boundary

The 12-input × 4-condition experiment (48 base calls, capped at 60 HTTP attempts) is a future stage-2 budget only. Stage 1 executed none of those calls. There is no model accuracy claim, no production change, no deployment change, and no database mutation in this report.
