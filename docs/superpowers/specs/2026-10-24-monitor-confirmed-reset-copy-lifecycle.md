# Monitor-confirmed reset copy lifecycle

## Goal

Generate or refresh a reset event title, summary, and note only after the canonical history event is backed by a persisted, confirmed Usage Monitor recovery observation and its matching execution estimate. A Tibo ledger or a converted Tibo signal alone is not completion evidence.

## Design

- Both arrival orders use the same persisted estimate, confirmed recovery observation, canonical event key, completion time, and normalized Tibo source context. The canonical history item is constructed by `findNoticeBackedRecoveryEvents`; the generator never receives a synthetic completed event made from a Tibo row.
- Keep notice, completion, verified reply completion, and monitor recovery evidence visibly separate in the prompt. Include a reply only when `getCurrentTiboFormalReplyAdmissionProof` validates its current proof and that proof resolves to the same canonical event. Exclude ordinary replies, stale proofs, and unrelated source rows.
- The idempotency fingerprint includes the event key, recovery observation ID, confirmed status/time, monitor observed time, sorted used post IDs and current revision/text hashes, and the generation contract. Source rows are ordered deterministically so duplicate delivery and arrival order do not change the input.
- Do not invoke generation when the monitor event cannot be verified or source context is unavailable. History continues to render its deterministic fallback. A later verified source event may use the existing webhook generation slot; no retry job or backfill is added.
- Metadata generation does not depend on whether the title is generic. A monitor-backed completion may need a description even when a useful human title exists.
- Human manual title fields always win. Auto-generated title results may be refreshed when verified completion evidence changes; explicit manual or human-approved values remain protected.
- Mark newly auto-generated metadata fields in the existing `event_metadata_flags` column with per-field content hashes. On a later evidence change, replace only fields that still match their generated hashes. Unmarked legacy fields and fields changed by a human are preserved. The marker is refreshed only for fields generated or replaced by the model.
- Read existing rows before generation and again before writing. If the second read fails, stop. Update with an `updated_at` compare-and-set; insert only when the row is still absent. A concurrent manual edit therefore wins.
- Permit unknown reason and scope when the evidence does not establish them. Do not infer celebration, cause, or milestone from Day N numbering or proximity to a release. BANKED distribution semantics and existing manual copy remain intact.

## Non-goals

- No Production reads or writes, migration application, deployment, or legacy copy backfill.
- No changes to the current nine Production manual text columns.
- No classifier, retry worker, cron, new model evaluation, or additional generation path.

## Offline regression coverage

Cover monitor-first and Tibo-first arrival, same event key and observed time, no generated completed copy before a confirmed recovery, strict same-event reply inclusion and stale/ordinary reply exclusion, multiple independent events, BANKED compensation preservation, title-independent metadata eligibility, manual and human-approved field preservation during races, unchanged fingerprint reuse, changed evidence refresh for auto-generated fields, and model/read failures that leave history available.
