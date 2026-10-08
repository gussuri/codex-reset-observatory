# Reset Post Association Implementation Plan

> Execution: Luna implements in the existing `6 Luna` chat; Sol investigates, reviews, and independently verifies. Do not spawn subagents or create another chat. Use the executing-plans workflow inline in Luna. The user approved this design and authorized implementation through Production; another user approval is unnecessary. Obtain Sol's concrete code review before merging or applying this redesign's migration.

**Goal:** Persist BANKED grant observations independently of notices, associate posts using explicit type/lifecycle/evidence rules, and preserve existing event identity and chronology.

**Architecture:** Separate durable observation facts, normalized post claims, and versioned association decisions. A pure matcher is shared by ingestion and reconciliation; public history consumes accepted persisted associations. Existing estimates remain the compatible public execution projection. Additive DB migration preserves the current atomic/CAS transaction and enforces kind/idempotence boundaries.

**Tech stack:** Next.js/TypeScript, Node test runner via tsx/pnpm, Supabase Postgres RPC, existing monitor/outbox, GitHub CI and Vercel.

**Spec:** `docs/plans/2026-10-08-reset-post-association-redesign.md` (approved 2026-10-08). Read `docs/reset-history-normalization.md` first. Start from main `d23a54af669503f90985f39a721e2122d32f6704` or its verified newer descendant, not the detached primary checkout.

## Global constraints

- Luna owns product implementation, regression tests, migration, commit/push/PR and release. Sol owns design/review and independent read-only checks. Preserve other uncommitted work and do not reset another checkout.
- The scope is BANKED observation/association and forced/BANKED type separation, including necessary history/name projection changes. Do not rewrite prediction, public-v1 DTO, unrelated temporal parsing, GUI or monitor protocol without a demonstrated dependency.
- Keep observations even when notice lookup fails or yields no candidate. Do not acknowledge a new usable grant fact before durable persistence. Failed matching must not roll back an otherwise valid observation; retry matching separately.
- Preserve stable keys, execution times, manual/accepted display names, formal ledger, corrected 40M record, and unrelated event counts. No broad speculative backfill or source-ID/time-proximity merge.
- Source facts and AI audit values remain separate. No credentials or environment variable values in output, files or commits.
- Batch local validation and push. No intermediate push/deploy for each task. Internal local commits are optional until the final validated batch.

## Review focus and test ownership

1. Lost/duplicated observations under retry, restart, concurrency and CAS: Tasks 1 and 3.
2. Expired or ambiguous posts accepted by ranking/fallback: Tasks 2 and 4.
3. BANKED and forced events merged by keys/sources/ledger: Tasks 1 and 5.
4. Incorrect public clock/name/scope or history loss during migration: Tasks 4 and 6.
5. Incomplete Production migration/cache or missing SQL verification: Task 7.

## Task 1: Durable observation and decision storage; transactional guarantees

**Files:** `lib/codexUsageAtomic.ts`, `lib/codexUsageRecoveryStore.ts`, new focused observation/association store module if warranted; new `supabase/migrations/<timestamp>_separate_banked_observations_and_associations.sql`; `tests/codexUsageAtomic.test.ts`, `tests/codexUsageRecoveryStore.test.ts`, `tests/integration/codexUsageAtomic.integration.test.ts` or focused new DB integration test.

**Contracts to implement:**

- A BANKED observation has immutable occurrence identity, source/monitor identity, observed time, server received time, previous/current count where known, original observation interval/precision, and a stable compatible reset key. An accepted association stores current canonical notice/logical post IDs, evidence/reason, matcher version, reconciliation time and publication state/time. Retain superseded decisions as audit, not as currently active sources.
- Suggested names: `BankedGrantObservation`, `BankedPostAssociationDecision`, `persistBankedGrantObservation`, `reconcileBankedGrantObservation`. Final names/schema can follow repository conventions; document deviations rather than inventing parallel models.
- Unique observation identity is independent of notice/title, e.g. stable source identity + original observed timestamp + BANKED kind. Do not use request receipt time/random UUID per delivery. Same timestamp/key with conflicting immutable facts fails closed; exact retry returns the same observation.
- If an exact existing BANKED occurrence is verified by immutable observation evidence, reuse its reset key; do not generate a second public event. Source tweet overlap or nearest timestamp alone is insufficient.
- Extend `apply_codex_usage_webhook_write` additively so a valid grant observation and state CAS are atomic even without an estimate/notice. The old payload must remain safely compatible during rollout. Preserve recovery, regular update, execution promotion and conflict response contracts.
- Atomic RPC and TypeScript upsert must enforce BANKED/forced kind separation, including current and legacy BANKED estimator versions. Remove BANKED source-overlap identity merging; a recurring notice can support independent later grants. Forced source lookup must exclude BANKED rows. Same key with incompatible kind must not overwrite. Prevent check-then-upsert races in SQL/TS.
- Keep existing grants/estimates as readable legacy records; migration must not automatically rewrite old sources/names/times. Add necessary RLS, service-role-only writes, grants and constraints following existing patterns.

- [ ] Add failing unit and real local DB tests for notice-free grant persistence, exact retries, conflicting retries, CAS loser, transaction rollback, source-sharing distinct grants, concurrent requests, cross-kind exact/source collisions.
- [ ] Implement additive schema and RPC/store contracts.
- [ ] Apply migration to an isolated loopback Supabase/Postgres test DB and run integration assertions. A SQL text assertion or skipped integration suite is not enough to claim atomic/collision correctness. If the local DB runtime is unavailable, report it immediately to Sol and continue independent work; arrange an isolated alternative before release.
- [ ] Verify existing RPC callers/old payload compatibility and no unintended privileges.

## Task 2: Pure post claim normalization and shared matcher

**Files:** new `lib/radar/resetPostAssociation.ts` (or similarly focused module), `lib/radar/bankedReset.ts`, `lib/radar/officialNoticePolicy.ts`, relevant logical projection/types; new matcher tests plus `tests/bankedReset.test.ts`.

**Interfaces:** `normalizeBankedPostClaim(signal, context)` yields logical identity, BANKED kind, explicit distribution claim, scope evidence, claim phase, resolved schedule precision, valid start/end and termination evidence. `matchBankedObservationToPosts(observation, claims, context)` returns a discriminated accepted/pending/conflict decision with reason, eligible/excluded candidate IDs and matcher version. It is deterministic, pure, and has no forecast-selector dependency.

Rules:

- Filter kind, explicit distribution content, verified applicability, confidence/verification gates, lifecycle and schedule compatibility before deciding. Unknown scope is not positive evidence of all-paid/conditional eligibility; explicitly conditional candidates need actual eligibility proof.
- Single and recurring claims both honor explicit termination/cancellation and bounded validity. Feed existing September Astra termination into the common rule. Use observed time, not receipt/reconciliation time. Define interval boundaries in tests; termination/end is exclusive for new observations unless the source semantics explicitly require another boundary.
- Recurrence permits multiple independent observations, not unlimited validity or a single event per notice.
- Explicit scheduled dates/windows are checked using their stated precision and known observation uncertainty. An unresolved future schedule cannot be converted to a matching completed execution by confidence alone.
- Unscheduled explicit in-progress/loading distribution may match within the actual normalized notice validity interval; validate the actual 40M sentence. Do not merely widen the two-hour constant.
- Trusted edits are the same logical post. Replies, quotes, unknown schedules and similar wording are not automatic event aliases. An explicit same-event reference may provide evidence but cannot override kind/scope/lifecycle contradictions.
- Multiple independent eligible notices are pending, with no latest/specificity/confidence tie-break. An authoritative explicit same-event reference or manual reviewed link can resolve ambiguity; retain the basis. Protect existing manual associations from silent replacement, report conflicts.
- No source unions or earliest-announcement inheritance across independent candidates. Earliest notice time belongs only to the accepted same-event chain.

- [ ] Write table tests: ended September only; valid before/end/after; late delivery before end; valid recurring distinct dates; unresolved vs in-progress; two candidates; cross-scope; explicit schedule precision; trusted edit vs reply; manual conflicts.
- [ ] Implement normalization/matcher without changing probability forecasting selection unnecessarily.
- [ ] Assert deterministic ordering/reason output and actual 40M + 3h53m acceptance.

## Task 3: Ingestion saves facts first and resolves independently

**Files:** `app/api/webhook/codex-usage/route.ts`, stores/atomic module, `tests/codexUsageWebhookRoute.test.ts`; monitor files/tests only if necessary to preserve original observation facts in the existing outbox.

- [ ] Add failing route tests for: ended Astra-only -> persisted pending; no notice -> persisted pending; matching lookup failure -> fact still saved and retryable; correct 40M -> accepted; two candidates -> pending; duplicate/reordered delivery; CAS retry; restart and structural plan change.
- [ ] Detect only proven increases between compatible known counts. Initial positive, unknown-to-positive, count decrease, plan/session structural rebaseline are not distribution proof. A client change flag alone must not manufacture a grant.
- [ ] Preserve original observed timestamp on retries. For stale/out-of-order delivery, never compare an old snapshot against a newer baseline to invent a grant or silently lose a previously proven queued grant. Document and test the accepted predecessor/interval contract; extend the payload only if the existing outbox cannot carry the necessary evidence.
- [ ] Replace BANKED use of `getActiveOfficialNotice(...includeTerminatedExecutionEvidence)` with shared matcher. Keep regular/forced recovery processing independently correct.
- [ ] Save new grant and state atomically; associate/project accepted evidence through a race-safe path. A pending association cannot create an estimate/history/global boundary. An association failure remains observable and retryable without re-emitting the grant.
- [ ] Maintain existing webhook auth, validation and response/idempotence contracts.

## Task 4: Reconciliation, accepted projection, names and history

**Files:** new reconciliation module, existing reconcile job/API or Tibo ingestion hook as appropriate; `lib/radar/tiboHistory.ts`, `lib/radar/resetDisplayNameReconciliation.ts`, associated stores/cache readers; focused tests for pending reconciliation, canonical history and display names.

- [ ] Add failing tests: notice arrives later, classification corrected, trusted edit, pending retry after temporary read failure, competing notices discovered, corrected association replacement, recurring new grant, manual accepted name protection.
- [ ] Use the exact same matcher/version for ingestion and reconciliation. Choose an existing durable retry/reconcile mechanism; do not rely only on one in-memory post callback. Bound batches and support continuation so observations cannot starve behind a fixed first page.
- [ ] Reconcile old observations using original observation time/lifecycle. An accepted automatic association that becomes contradicted is marked for safe correction/hold with audit, not silently left trusted; manual decisions remain protected and conflicts surfaced.
- [ ] Update the compatible execution estimate from accepted current relationship only. No `union` of obsolete sources or `min` with unrelated old notice times. Preserve stable reset key and observation precision/time. Store audit separately.
- [ ] Public history uses accepted relationships for new observations, preserving explicitly verified legacy records. Retain the repaired 40M legacy key with its manual names and corrected source. No inferred new link to legacy estimates based solely on proximity.
- [ ] BANKED completion can enrich only a uniquely evidenced BANKED event; cannot create forced execution. Unknown schedule cannot cluster unrelated notices. Keep applicable existing teaser behavior without weakening event identity constraints.
- [ ] Provisional name promotion requires the accepted association and exact canonical BANKED occurrence, with current/legacy compatibility explicitly tested. Manual/accepted names must not be overwritten on every reconciliation. A notice supporting several recurring grants must not merge those grants or their names.
- [ ] Update normalization/operations docs with implemented lifecycle/pending/reconciliation contracts, not speculative promises. Cache invalidation uses `tibo-event` when observation/estimate/name relationships change.

## Task 5: Forced formal adoption boundary in every write/read path

**Files:** `app/api/webhook/tibo/route.ts`, `lib/radar/tiboResetEventIdentity.ts`, `lib/codexUsageRecoveryStore.ts`, SQL RPC from Task 1, relevant formal adoption/history tests.

- [ ] Add failing tests with current and legacy BANKED rows sharing IDs/edit chains with a forced post, exact-key conflict, ledger conflict, and simultaneous genuinely distinct forced/BANKED events.
- [ ] Propagate estimatorVersion/executionTimeSource and kind evidence into the identity resolver. Exclude BANKED estimates/history from forced identity proof. A previously conflicting ledger must fail closed rather than bless the collision.
- [ ] Preserve monitor-backed forced canonical identity and independent explicit authoritative forced completion adoption. Do not require a monitor for every forced post.
- [ ] Test actual Oct8 generic completion text does not resurrect the rejected false forced event; explicit BANKED completion never adds a second forced history row.

## Task 6: Independent comparison, complete local verification and PR

**Files:** focused read-only comparison script and operations docs; relevant tests/E2E fixtures only as needed.

- [ ] Provide Sol a compact change map, schema/RPC contract, matcher decision examples, all validation outputs, and any unresolved limitation before release.
- [ ] Compare old/new matcher using read-only Production inputs with original timestamps. Report accepted/pending/conflict and reasons. Do not mutate or mass backfill. Existing questionable links become an audit list, not automatic repairs.
- [ ] Protect baseline: corrected40M key `banked-reset-2095651088502591861-observation-20261007T231228952Z`, execution `2026-10-07T23:12:28.952Z`, notice/source `2107913674593644711`, announced `2026-10-07T19:19:17Z`; false `tibo-reset-2108040921044639779` stays rejected. Preserve names, ledger, other events.
- [ ] Run focused tests, real DB integration, full `pnpm test`, lint, typecheck, build, relevant browser E2E, `git diff --check`. Do not weaken unrelated assertions to pass. Explain deliberate replacement of the obsolete terminated-Astra acceptance test.
- [ ] Commit/push the validated batch; create one PR with migration order/rollback notes and attach it. Sol performs independent diff/test review; address concrete findings in the same branch.

## Task 7: Production migration and release after Sol review

- [ ] Capture read-only before facts/counts for estimates, formal adoptions, names and the two repaired records. Separate additive schema metadata from protected semantic fields when comparing.
- [ ] Apply the additive migration before deploying code that requires it. Confirm old deployed caller works during the interval. If compatibility is impossible, restructure into expand/activate stages; no half-deployed required schema.
- [ ] Verify migration version/function definitions/permissions and a read-only health query. Do not create a test distribution in Production or broadly repair historical rows.
- [ ] Merge the reviewed PR and use the existing automatic Production deployment. Avoid a second manual deploy of the same SHA. Confirm main SHA, CI, deployment status and reconciliation workflow.
- [ ] Run safe bounded reconciliation only for observations with adequate persisted evidence; no broad legacy backfill. Invalidate `tibo-event` with existing helper; never log the secret.
- [ ] Verify fresh and ordinary JA/EN/ZH `/api/current?locale=...` plus `/history`, `/en/history`, `/zh/history` (respect known CDN TTL; no repeated DB writes/redeploys to clear a cached API response). Check repaired40M appears once, correct name/method/scope/3h53m, false forced row absent, chronology and other events stable, and pending observations excluded.
- [ ] Recheck protected DB facts and report exact commit/PR/migration/deployment, test outcomes and material remaining limitations. Completion means Production verification, not only a PR.

## Rollback principles

Prefer reverting the application to the last compatible deployed code while retaining additive observation facts and audit. Do not drop observation tables or destroy new facts to roll back. The additive migration must remain safe for old callers. If old application code would resume terminated-notice matching, document that risk and disable only the new automatic association/publishing path as necessary; do not erase historical records. A rollback must not undo the prior Oct8 data corrections.
