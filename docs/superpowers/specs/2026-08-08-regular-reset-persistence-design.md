# Automatic Regular Reset Persistence Design

**Goal:** Persist a scheduled regular reset as a completed history event once its representative schedule time has arrived, without treating it as a random-reset probability event.

## Architecture

The application will keep an explicit weekly schedule definition and expose a CRON-protected synchronization endpoint. An existing GitHub Actions schedule will invoke that endpoint every ten minutes. The endpoint inserts due occurrences into Supabase with a deterministic `schedule_key`; the database uniqueness constraint makes retries idempotent.

Persisted events are loaded into the internal radar data model and merged with static history. They use the distinct `regular_completed` record kind, retain `cycleType = 定期リセット`, and retain the configured delivery method such as `強制リセット` or `任意リセット権1回配布`. Regular events are never eligible for the random-reset target because the existing eligibility predicate still requires `cycleType = ランダムリセット`.

The latest completed regular event is used as a regular-cycle anchor and as a UI teaser boundary. It is not used as the random-reset age, random event count, or random probability target. Teaser posts before that boundary remain stored unchanged but are excluded from the current UI teaser aggregate; later teaser posts can become active again.

The dashboard's elapsed-time status will use the latest completed random or regular reset boundary. After a regular reset is persisted, the displayed value therefore restarts from that regular event instead of continuing to count from the previous random reset.

The 2026-08-08 observation is represented as a multi-user regular-reset wave with `window_start_at`, `window_end_at`, and a `representative_at`. The representative timestamp is an operational reference for idempotent scheduling, not a claim that every account reset at one universal instant.

## Persistence and correction

`public.regular_reset_events` will contain:

- deterministic `schedule_key` primary key and unique `scheduled_at`
- wave start/end and representative/completion timestamps
- cycle type, reset method, scope, and `regular_completed` record kind
- `completed`, `corrected`, or `voided` status
- correction reason and timestamp, without deleting the original row
- created/updated timestamps

The synchronization endpoint only inserts due schedule occurrences and never overwrites an existing row, including a manually corrected or voided row. Corrections can therefore be applied later through the database without being undone by the next scheduled run.

## Localization

Stored history uses stable Japanese source keys/values already used by the history renderer. New automatic-completion summary/scope strings receive Japanese, English, and Simplified Chinese entries in the existing dynamic translation table. The public DTO shape remains unchanged; only the history contents gain the completed regular event when it is due.

## Verification

Tests will cover schedule cutoffs, idempotent insertion payloads, completed/voided filtering, regular-vs-random eligibility, teaser consumption before and after the regular boundary, and Japanese/English/Chinese history rendering. Existing probability tests will confirm that adding a regular event does not change the random target or published probability.
