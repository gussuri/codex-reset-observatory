# Day18 source-context marker and future-reply monitor gate

## Scope and safety

- Primary checkout: `C:\Users\Yura\Documents\codex-reset-observatory` stays read-only. Work only in `C:\Users\Yura\.codex\worktrees\reset-history-recovery\codex-reset-observatory`.
- Base and recovered A commit: `80ec245bd35b46ec93163e39ca976a837ffc606f` (`Mark complete normal source-context classifications`). The previous managed worktree and its uncommitted B files were deleted. No B diff was found in Git worktrees, stashes, artifacts, or saved files. Sol supplied the verified file-by-file B specification; reconstruct it from that specification and rerun verification. Do not describe it as recovered.
- No LLM API, Production data/API, linked database, cron, polling, push, PR, or deploy. Site reset monitoring from 01:10–03:10 JST is reserved on Sol's side; do not duplicate that check. If Sol reports a live reset issue, prioritize the production site fix within the user's instruction.
- Additive migration/RPC and isolated local DB tests are authorized. Production migration remains on hold until Sol's code and DB review. A local commit is authorized after each logical unit passes its checks; push/PR/deploy remain on hold.

## A — source-context marker

- A is already in HEAD. It fixes the proven normal-webhook marker persistence contract while retaining exact revision-array and generation CAS behavior.
- Prior evidence, from the deleted worktree: source-context suite 21/21; lint/typecheck passed; a previous full `pnpm run check` passed 2620/2620 plus lint/typecheck. That full run attempted two unrelated OpenAI Status GETs, both 503. These are historical results; rerun required checks against the reconstructed worktree before final claims.

## B — forward-order verified future reply

Reconstruct the prior B changes from the Sol-provided specification:

- `lib/radar/tiboFutureReplyNotice.ts`: export an exact-window helper over the existing strict reply validator. Require finite, valid intervals and strict overlap; no grace and endpoint contact is false.
- `app/api/webhook/codex-usage/route.ts`: project every strict validator field through the existing bounded notice query. Include verified replies only for unexpected monitor recovery and exact execution-window overlap. Preserve reply exclusion from persistent/BANKED lookup. Feed filtered signals to recovery selectors and notice collectors.
- `lib/radar/tiboHistory.ts`: preserve quote proof fields through notice type and collectors.
- `lib/radarFetch.ts`: accept only strictly validated reply notices in `toNoticeSignal`, preserve their full proof through the public projection, and append eligible recent replies only to notice candidates, never accepted completion resets.
- Recreate focused forward tests in `tests/codexUsageWebhookRoute.test.ts`, `tests/tiboFutureReplyNotice.test.ts`, and `tests/radarFetch.test.ts`.

### Required review follow-ups before B is complete

- Distinct strict reply events whose resolved windows both overlap one recovery must fail closed. Do not let latest-created ordering choose between different parent/event identities. Redelivery and edit aliases of one logical event must not count as separate events without evidence; conflicting parent proof remains unassociated.
- A reply already linked to one recovery may not be reused by a later recovery. Preserve the first event's estimate/key/time/precision and leave the later recovery as a standalone monitor event. Protect forward and reverse paths atomically with a future-reply-specific guard; do not broaden the existing generic atomic-write contract.

## Reverse-order verified future reply

- A monitor may first create a standalone estimate, then the reply may arrive through normal Tibo webhook or `source_context_enrichment` classification. The trigger is the receipt only; no scheduled task, polling, or re-LLM.
- The current source-context duplicate path returns 200 immediately when the current revision markers are all complete. Reconciliation must run before that early 200 and must not call Gemini for a complete marker.
- The reverse RPC must reread and lock the current Tibo row, compare every strict proof field used by the JavaScript validator (including text, classification, AI evidence, reply metadata, source snapshot/revision/classified hashes/generation, resolved temporal fields), and reject manual/protected or changed rows. Revision/generation equality alone is insufficient.
- Read a bounded set of Codex observations; require unique strong/unexpected/observed/unmatched candidate, a valid comparison gap <= 10 minutes, exact reply-window/execution-interval overlap, and reply creation before the execution interval. Require one exact existing monitor-only estimate; never create an estimate or alter observation status/matched Tibo tweet ID.
- Update only reply provenance on that existing estimate. Preserve estimate ID, key, recovery identity, display time/window, estimator version, precision, and any existing distinct event/notice/manual fields. Same-link retries revalidate current proof and identities before idempotent handling.
- Use one short transaction with a consistent lock order, service-role-only RPC privileges, fixed `search_path`, schema-qualified objects, and no new public access. Missing, ambiguous, incomplete, or over-limit candidates are no-ops. Database/CAS failures return 503.
- Cache invalidation needs a durable retry signal: if the estimate write succeeds but `invalidateRadarCache("tibo-event")` fails, the next duplicate receipt must invalidate again without re-updating provenance. Do not rely only on a changed-row return flag.

## Test and verification plan

- Write failing offline tests first for: forward ambiguity across two different parents; a same-parent/edit alias that is not counted as a second event; reply reuse across two different monitor observations; reverse monitor-first reconciliation; current proof/manual changes; retry after marker completion without Gemini; cache invalidation retry; and estimate identity preservation.
- Add real Postgres/Supabase integration tests for migration/RPC atomicity, concurrent forward/reverse requests, duplicate/retry, manual/proof changes, and single-row preservation. A mock or single-connection WASM test is not concurrency evidence.
- The previous machine check found no Docker CLI, no configured loopback Supabase variables, and no listeners on usual Supabase/Postgres ports. Recheck read-only, then look for an existing native Postgres toolchain. If unavailable, assess an isolated temporary side-by-side local Postgres using normal privileges; do not touch shared services or Production credentials. Report any integration gap plainly.
- Run focused regression suites, full repository tests, lint, typecheck, build, and `git diff --check`. Never run the production monitor.

## Checkpoint ledger

- 2026-10-24 01:05 JST: previous worktree path was missing; only its parent marker remained. A/HEAD was verified from Git. No B patch/archive/stash was available. New managed worktree created at `C:\Users\Yura\.codex\worktrees\reset-history-recovery\codex-reset-observatory`, branch `codex/day18-source-context-marker`, clean at HEAD `80ec245bd35b46ec93163e39ca976a837ffc606f`. Sol was informed of the recovery state and exact path.
- Old worktree's forward B tests reportedly passed 44/44, 6/6, and 27/27; source-context suite had 21 pass plus one intentional reverse-order RED. Those results do not validate the reconstructed files. Fresh verification is required.
