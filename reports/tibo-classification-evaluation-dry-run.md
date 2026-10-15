# Tibo classification evaluation: stage 1 dry run

Generated 2026-10-15 from the offline evaluator. This validates inputs, serialization, and scoring behavior; no real AI evaluation has been run, so model precision and quality are unmeasured.

## Dry-run contract

`pnpm eval:tibo-offline` selects and counts the same normalized cases used by `--results` scoring. The current corpus contains 230 selectable cases: 145 original virtual scenarios, 49 added synthetic cases (48 paired context contrasts plus one general release-notes negative), and 36 real-post/input-condition cases. Selection accepts `--condition`, `--split`, and `--limit`; unknown or empty selections fail.

```text
Tibo classification evaluation dry-run
- fixture cases: 230
- selected cases: 230
- current API calls: 0
- current network: none
- current DB writes: 0
- current provider/model: not run
- future stage 2 diagnostic: 12 inputs × 4 conditions = 48 base calls
- future stage 2 maximum HTTP attempts: 60 (not executed in stage 1)
- selection: condition=all, split=all, limit=none
- real source posts: 32 in 29 groups
```

The paired synthetic contrasts use the same target text and timestamp with text-only, verified same-author parent, unrelated parent, and other-author quoted-post inputs. The production baseline formatter is replayed faithfully. A separate evaluation-only `verified_graph` serializer includes source IDs, authors, timestamps, relation edges, and related post records; it is not silently mixed into baseline inputs. Serializer mode and formatter hash are part of the run identity. Cases with synthetic virtual parent/quote IDs say so explicitly and do not claim those IDs occur in a source fixture.

## Legacy and real-post evidence

All original 145 scenarios remain in the corpus. Their legacy reply/quote text, flags, reply handles, and timeline metadata now flow through normalization and the final production formatter. Explicit legacy `ambiguous` flags are preserved as ambiguous safe-hold cases; the old expected label remains in the original scenario JSON for audit and is not treated as definite gold or included in definite-label accuracy. This prevents contextless “Done” from being a correct completion label. Their safe-hold behavior is reported separately.

The real-post fixture has 32 stored posts across 29 logical event groups. Twenty complete legacy-evaluation snapshots are represented, with old wrapper output separate from curator-draft gold. Their stored text is marked as an evaluation snapshot with original-text verification false; the fixture does not claim those rows are exact author originals. Incomplete records remain excluded. Five known-leakage candidates are regression cases, leaving zero certified holdouts. The 14pm PST temporal gold follows the existing tested compatibility contract: 14:00 PST resolves to `2026-08-23T22:00:00Z`. All curator-draft gold remains subject to human adjudication.

For the October 15 quoted completion, the target is connected by a quote edge to the timing reply, and that quoted post has its own reply edge to the Day 10 post. The baseline mode marks the target as a quote and does not invent a direct reply to Day 10. The graph serializer preserves both directed edges. Public-state assertions are present only when the fixture carries an explicit prior state and expected resulting state; pure classification rows do not acquire public fields from evaluator-side assumptions.

## Layer-specific gold and scoring

The BANKED delivery contrast follows the current four-label prompt: pure BANKED distribution is `irrelevant` in both raw and corrected classification gold, while a saved raw `reset_executed` prediction is scored as an error. Public facts separately retain BANKED delivery and no forced reset history. Ambiguous Codex milestone wording is a boundary case accepting a safe hold or teaser, and cannot create completion or an official notice. A separate general release-notes sentence is a strict irrelevant control.

Old wrapper CSVs do not preserve provider raw responses. Their `gemini_prediction` is wrapper output, not raw model text. Raw capture remains `not_recorded`; attempted request failures and not-run rows are distinct. The current prompt formatter uses the production `buildGeminiPrompt` function. Request options are JSON MIME output, temperature 0, and a 7-second timeout; the wrapper supplies no provider JSON schema. Provider token count is unavailable. Saved-result scoring requires explicit provider, model, model version, and one input condition. The run identity includes current commit, normalized fixture, prompt, output contract, request options, and serialization mode/hash.

Definite-label accuracy excludes ambiguous cases. Those cases are counted separately as safe-hold outcomes. Corrected-layer gold can differ from raw-AI gold. Public state is scored only when the fixture explicitly gives a pre-state and expected post-state. Missing temporal predictions and missing event associations count as errors only where those fields are explicitly in scope.

Synthetic JSON cases do not verify ingestion order, retries/resends, process restarts, multi-tab races, database concurrency, manual/rejected override races, or persisted deduplication. Those remain integration-test requirements; this stage has no DB-backed assertions and makes no claims about those paths.

No AI calls, network requests, database writes, production behavior changes, schema changes, or dependency changes were performed for stage 1.