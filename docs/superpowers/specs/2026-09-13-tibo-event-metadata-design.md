# Tibo Event Metadata Generation Design

## Goal

Improve automatic reset-history metadata generated from Tibo posts so that a newly adopted canonical reset event normally arrives with a useful display name, reason, scope, summary, and note without manual repair.

## Boundaries

This change does **not** alter reset admission, logical-post/edit identity, canonical event-key resolution, dedupe, execution-time resolution, recovery observations, or probability chronology. Those remain authoritative and are resolved before metadata generation.

## Source aggregation

Reuse the existing canonical source context produced by `buildResetDisplayNameSourceContext()`. It already includes only source tweet IDs attached to the canonical event provenance, excludes rejected/reply rows, preserves chronology, and avoids fuzzy nearby-post matching.

The completed-event flow therefore remains:

```text
Tibo classification / monitor evidence
  -> formal adoption + canonical event identity
  -> canonical source tweet set
  -> event-level AI metadata generation
  -> deterministic validation
  -> event-keyed persisted presentation metadata
  -> history projection
```

## Event-level AI metadata

Add a dedicated `reset-event-metadata-v1` Gemini generator. It receives the aggregated canonical source context plus deterministic event facts such as completion time and reset method. It returns:

- `reasonType`: `ご祝儀リセット` or `詫びリセット`
- `scope`: `全有料プラン`, `一部ユーザー`, or `null`
- localized `summaryJa`, `summaryEn`, `summaryZh`
- localized `noteJa`, `noteEn`, `noteZh`
- short Japanese audit reason

The existing display-name generator remains responsible for localized titles, but its prompt is tightened so explicit causal/incident/milestone context from related posts outranks a low-information completion phrase such as `Sweet dreams`.

## Scope normalization

Canonical/public reset scope is limited to exactly:

- `全有料プラン`
- `一部ユーザー`
- `null` when evidence is insufficient

`Codex / ChatGPT Work` is removed as a scope value/fallback. Legacy broad labels such as `全ユーザー` normalize to `全有料プラン`. Legacy narrow labels such as affected users or unused-reset accounts normalize to `一部ユーザー`. Unknown labels normalize to `null` and the UI omits the scope row.

A greeting or audience phrase such as `Hi Astra users` is not scope evidence. A non-null AI scope requires reset-applicability evidence from the source context.

## Reason policy

For regular scheduled resets, keep deterministic `定期更新`.

For completed random/BANKED events, presentation should not normally have a blank reason. Priority is:

1. explicit human/static canonical reason
2. safe event-level AI `reasonType`
3. deterministic reason inference from source/canonical text
4. `ご祝儀リセット` as the low-stakes fallback when no apology/incident evidence is available

The AI is instructed to choose the better of `ご祝儀リセット` and `詫びリセット` even when the distinction is not perfectly explicit. This field is descriptive presentation metadata, not event identity.

## Persistence

Extend the existing event-keyed `reset_display_names` row rather than create a second event-identity table. Add dedicated event-metadata columns:

- `event_reason_type`
- `event_scope`
- `event_summary_ja`, `event_summary_en`, `event_summary_zh`
- `event_note_ja`, `event_note_en`, `event_note_zh`
- `event_metadata_model`
- `event_metadata_prompt_version`
- `event_metadata_status`
- `event_metadata_flags`
- `event_metadata_generated_at`
- `event_metadata_input_hash`

The existing name columns and manual-name precedence remain unchanged.

## Validation and fallback

The event metadata generator is best-effort. Failure must not block Tibo webhook persistence or formal adoption.

Validation requirements:

- `reasonType` must be one of the two allowed non-regular reason values.
- `scope` must be one of the two allowed values or null.
- summary/note fields are bounded in length and must not introduce unsupported named entities or numbers relative to the canonical source context.
- an AI scope may be non-null only when the model also returns a short exact `scopeEvidence` substring from the canonical source context.
- unsafe/invalid metadata is not used by public history.

If event metadata is unavailable, deterministic history construction still produces the event; scope may be blank and reason falls back as described above.

## Presentation precedence

Human-authored/static history continues to win over generated metadata. For dynamic/monitor-backed canonical events, safe generated metadata may replace the generic Tibo fallback summary/note and provide reason/scope. Manual display names continue to outrank AI names.

Scope rows are shown only for `一部ユーザー`. `全有料プラン` remains the default broad scope and is hidden, matching current UI behavior. Null scope is also hidden.

## Compatibility

Read paths must tolerate deployments where the new database columns have not propagated yet. Missing metadata columns fall back to the legacy reset-display-name projection without making radar data unhealthy.

No historical backfill is required by this change. Existing static/manual corrections remain authoritative; new events use the new generator automatically.
