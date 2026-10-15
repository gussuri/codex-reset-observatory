# Tibo classification evaluation: stage 1 dry run

Generated 2026-10-15 from the offline evaluator. This is an input and scorer validation run, not a model evaluation.

## Dry-run contract

`pnpm eval:tibo-offline` selects and counts the same normalized cases used by `--results` scoring. The current corpus contains 229 selectable cases: 145 original virtual scenarios, 48 curated synthetic context contrasts, and 36 real-post/input-condition cases. The last count includes alternate evidence conditions for the two October 15 reply/quote records. Selection accepts `--condition`, `--split`, and `--limit`; unknown or empty selections fail.

```text
Tibo classification evaluation dry-run
- fixture cases: 229
- selected cases: 229
- current API calls: 0
- current network: none
- current DB writes: 0
- current provider/model: not run
- future stage 2 diagnostic: 12 inputs × 4 conditions = 48 base calls
- future stage 2 maximum HTTP attempts: 60 (not executed in stage 1)
- selection: condition=all, split=all, limit=none
- real source posts: 32 in 29 groups
```

The 48 new synthetic records use paired target text and timestamp across text-only, verified same-author parent, verified unrelated parent, and other-author quoted-post inputs. The inputs are formatted with the production `buildGeminiPrompt` formatter. They cover fragments (“Landing within the next 2 hours”, “Done and dusted”), direct reset notice/completion, a Codex milestone teaser whose parent context changes the gold, BANKED distribution notice/delivery and parent context, personal BANKED use, and cancellation. Gold expectations and rationales are explicit per condition. These are synthetic scorer controls, not model outputs or claims of model accuracy.

## Real-post and source limitations

The real-post fixture has 32 stored posts across 29 logical event groups. Twenty complete legacy-evaluation snapshots are represented, with old wrapper output separated from new curator-draft gold. Their stored text is marked as an evaluation snapshot with original-text verification false; the fixture does not claim those rows are exact author originals. Other source snapshots retain their source status and citations. Incomplete and ambiguous records are excluded from the gold set.

Five August cases previously marked as holdout candidates are known from repository tests, data, or reports, including the banked 8pm, 14pm, and milestone examples. They are now regression cases. There are zero certified holdout cases. The 14pm PST temporal gold follows the existing tested compatibility contract: 14:00 PST resolves to `2026-08-23T22:00:00Z`. It is not scored as invalid. All gold remains `curator_draft` pending Sol review.

The October 15 reply and quote chain uses the supplied X DOM relationship review. The September 12 relation follows the mapping in `docs/reset-history-normalization.md`. Other cross-post references remain unverified and are not treated as same-event lineage. Runtime validation rejects unsupported gold labels, broken IDs, invalid temporal values, and event/split leakage.

The old wrapper CSV does not preserve provider raw responses. Its `gemini_prediction` is wrapper output, not raw model text. Raw output is therefore recorded as `not_recorded`; raw quality metrics are N/A, separate from attempted failures and not-run rows.

## Prompt and request identity

The current `TIBO_GEMINI_SYSTEM_PROMPT` is 23,158 JavaScript string characters, 23,238 UTF-8 bytes, and 3,292 whitespace-separated words. Provider token count is unavailable. The request formatter adds target text, timestamp, reply parent text/author, and quoted text/author using the production `buildGeminiPrompt` function. The current wrapper requests JSON MIME output, temperature 0, and a 7-second timeout; it does not supply provider JSON schema. Saved-result scoring requires explicit provider, model, model version, and one input condition. The run identity is computed from the current commit and normalized fixture, prompt plus formatter, output contract, and request-options manifest; CLI tests reject mismatches.

## Scoring and remaining integration coverage

Raw AI, corrected fallback, and public outcome are independently recorded and scored. Provider failure does not erase a saved fallback/public result. A missing public history assertion, missing temporal prediction, or null event association is counted as a miss/error when the layer was attempted. Not-recorded, not-run, attempted failure, and partial saved outcomes remain distinct. Zero support stays N/A; support with no correct prediction has zero recall/F1 where applicable. Latency and token-use omissions remain null and are counted as missing.

Synthetic JSON cases do not verify ingestion order, retries/resends, process restarts, multi-tab races, database concurrency, manual/rejected override races, or persisted deduplication. Those remain integration-test requirements; this stage has no DB-backed assertions and makes no claims about those paths. Existing production tests cover some of these behaviors independently.

No AI calls, network requests, database writes, production behavior changes, schema changes, or dependency changes were performed for stage 1.
