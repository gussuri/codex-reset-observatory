# Automatic Regular Reset Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist due weekly regular-reset waves in Supabase and make history, teaser boundaries, next-cycle anchors, and elapsed-time display use the completed regular event without changing random-reset probability targets.

**Architecture:** A pure schedule module generates deterministic weekly occurrences from the confirmed 2026-08-08 representative wave. A CRON-protected route inserts due occurrences into a new idempotent Supabase table, while the existing ten-minute GitHub Actions schedule invokes it. Radar data loads completed/corrected rows, merges them into history, and exposes no new public DTO fields.

**Tech Stack:** Next.js App Router route handlers, Supabase service-role client, TypeScript, GitHub Actions cron, existing i18n and `node:test` suites.

## Global Constraints

- `cycleType = 定期リセット` events are excluded from random-reset probability targets.
- The 2026-08-08 event is a representative multi-user regular-reset wave, not a universal instant.
- Static TypeScript history is never mutated at runtime.
- Existing Tibo classification values and source rows are never rewritten.
- Japanese, English, and Simplified Chinese history output must remain localized.

### Task 1: Add the persisted event contract and schedule source

**Files:**
- Create: `supabase/migrations/20260808100000_add_regular_reset_events.sql`
- Create: `lib/radar/regularResetSchedule.ts`
- Modify: `lib/radar/types.ts`
- Test: `tests/regularResetPersistence.test.ts`

- [ ] Add `regular_reset_events` with unique `schedule_key` and `scheduled_at`, timestamps, method/scope/cycle fields, `regular_completed` record kind, `completed/corrected/voided` status, and correction metadata. Enable RLS without public policies.
- [ ] Define the 2026-08-08 wave using window start/end and representative time, and generate weekly due occurrences without using the suspicious 2026-06-12 banked record as an anchor.
- [ ] Add the internal `regular_reset_events` radar-data field and pure mapping types.
- [ ] Test before/after due cutoff, deterministic keys, weekly generation, and Banked delivery remaining `cycleType = 定期リセット`.

### Task 2: Merge completed regular events and boundary behavior

**Files:**
- Modify: `lib/radar/tiboHistory.ts`
- Modify: `lib/radar.ts`
- Modify: `lib/radar/probability.ts`
- Modify: `lib/radar/publicDto.ts`
- Modify: `lib/radar/teaserStrength.ts` only if a shared boundary helper is required
- Test: `tests/regularResetPersistence.test.ts`, `tests/resetTeaserStatus.test.ts`, `tests/resetDurationPresentation.test.ts`

- [ ] Merge persisted completed/corrected rows with static history, preferring the persisted regular event for the same representative time and avoiding duplicate UI rows.
- [ ] Add a latest completed reset-boundary helper that includes random targets and completed regular events for UI teaser consumption and elapsed-time display, while leaving `getLastGlobalResetAt` random-only for probability.
- [ ] Let the regular forecast use a persisted `regular_completed` event as its weekly anchor and include it in visible history/latest-window selection.
- [ ] Keep `isEligibleRandomResetEvent` unchanged in meaning: regular records and regular Banked records never become random targets.
- [ ] Test pre-boundary teaser retention, post-boundary teaser reactivation, elapsed time restarting at the regular event, and unchanged random probability inputs.

### Task 3: Load and persist through scheduled execution

**Files:**
- Modify: `lib/radarFetch.ts`
- Create: `app/api/regular-reset/sync/route.ts`
- Modify: `.github/workflows/tibo-monitor-health.yml`
- Test: `tests/regularResetPersistence.test.ts`

- [ ] Read completed/corrected regular rows with the existing Supabase service-role pattern and fold their health into the existing Supabase source health.
- [ ] Require `CRON_SECRET` for the sync route, generate due rows, and insert with `ignoreDuplicates` on `schedule_key`; never overwrite corrections.
- [ ] Add an independent ten-minute workflow job so sync does not depend on a browser or a successful UI request.
- [ ] Test unauthorized requests, due/no-due payloads, idempotent conflict behavior, and no overwrite of `voided`/`corrected` rows.

### Task 4: Localize the completed regular history

**Files:**
- Modify: `lib/radar/i18n.ts`
- Modify: `lib/radar.ts`
- Test: `tests/i18nCompleteness.test.ts`, `tests/regularResetPersistence.test.ts`

- [ ] Add Japanese/English/Chinese translations for the automatic-completion summary and scope labels.
- [ ] Verify history title, cycle, method, scope, status, and summary render naturally in all three locales.

### Task 5: Verify and publish

**Files:**
- No additional production files

- [ ] Run `pnpm test`, `pnpm run check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and `git diff --check`.
- [ ] Confirm the temporary display probability cap commit remains intact and no random probability target changed.
- [ ] Commit implementation and migration, push `main`, and verify the final worktree is clean.
