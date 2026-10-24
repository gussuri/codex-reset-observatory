# Monitor-backed reset copy lifecycle

## Goal

Generate or refresh a reset event title, summary, and note only after the canonical history event is backed by a persisted Usage Monitor recovery observation and its matching execution estimate. The observation may be `observed` or `confirmed` when it passes the existing monitor validity gate. A Tibo ledger or converted Tibo signal alone is not completion evidence.

## Design

- Monitor-first and Tibo-first arrival use the same persisted estimate, recovery observation, canonical event key, completion time, and normalized Tibo source context. Both webhook paths call the shared generator only after the canonical link can be read from persisted rows.
- Global reset copy generation accepts a valid `observed` recovery without `confirmedAt` or `matchedTiboTweetId`. A `confirmed` recovery must have a valid confirmation time and matched completion ID. `observed` is not itself a Tibo formal-history admission or completion claim.
- Keep notice, completion, verified reply notice, verified reply completion, and monitor recovery evidence visibly separate in the prompt. Include a future reply notice only when its persisted proof is strictly validated and its expected execution window overlaps the monitor window. Include reply completion only when its current formal-admission proof resolves to the same canonical event. Exclude ordinary replies, quotes, stale proofs, and unrelated source rows.
- A verified reply notice is corroborating source context, not execution evidence. The event key comes from its validated contextual parent/root ID, and the persisted estimate and recovery observation remain authoritative for the monitor event.
- The idempotency fingerprint includes the event key, recovery observation ID and state, monitor observation values and times, sorted used post IDs and current revision/text hashes, and the generation contract. Source rows are ordered deterministically so duplicate delivery and arrival order do not change the input.
- Do not invoke global event generation when the monitor event cannot be verified or source context is unavailable. History continues to render its deterministic fallback. A later verified source or changed evidence fingerprint may use the existing webhook generation slot; no retry job or backfill is added. A stored model/read failure with the same fingerprint is not retried automatically.
- BANKED title and metadata use a separate authority: a canonical grant-backed BANKED event with its linked official notice. This path does not supply monitor evidence to a global reset, and a notice without the canonical grant event cannot generate copy.
- Metadata generation does not depend on whether the title is generic. A monitor-backed completion may need a description even when a useful human title exists.
- If explicit apology/compensation evidence is absent, use `ご祝儀リセット` as the operational default reason category. This category alone does not establish a celebration, milestone, release tie, or cause; public copy must remain grounded in the persisted source posts. Keep the internal Japanese reason rationale separate from public summary/note.
- Human manual title fields always win. Auto-generated title results may be refreshed when verified completion evidence changes; explicit manual or human-approved values remain protected.
- Mark newly auto-generated metadata fields in the existing `event_metadata_flags` column with per-field content hashes. On a later evidence change, replace only fields that still match their generated hashes. Unmarked legacy fields and fields changed by a human are preserved. The marker is refreshed only for fields generated or replaced by the model.
- Read existing rows before generation and again before writing. If the second read fails, stop. Update with an `updated_at` compare-and-set; insert only when the row is still absent. A concurrent manual edit therefore wins.

## Non-goals

- No Production reads or writes, migration application, deployment, or legacy copy backfill.
- No changes to the current nine Production manual text columns.
- No classifier, retry worker, cron, or additional copy-generation path.

## Offline regression coverage

Cover monitor-first and Tibo-first arrival through the real handler paths with stubbed persistence/provider boundaries, the same canonical event key and observed time, no generated global copy before a monitor event exists, strict future-reply notice inclusion only after persisted linking, stale/ordinary/quote reply exclusion, multiple independent events, BANKED grant-backed copy eligibility, title-independent metadata eligibility, operational reason default without public causal claims, manual and human-approved field preservation during races, unchanged fingerprint failure reuse, changed evidence refresh for auto-generated fields, and model/read failures that leave history available. PostgreSQL integration assertions cover the database reconciliation and canonical root event key when PostgreSQL 17 is available.
