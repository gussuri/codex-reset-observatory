# Reset Display Name Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist a future official notice as an internal name candidate, generate its localized V3 name outside the webhook critical path, and promote it exactly once to the canonical event after authoritative execution evidence exists.

**Architecture:** The webhook writes only an idempotent notice seed to a service-role-only `reset_display_name_candidates` table. The existing bounded reset-display-name reconciler discovers missing seeds, shares its existing global Gemini budget, and performs candidate generation while the candidate remains provisional. Existing adoption/Monitor identity resolution remains the only source of canonical event keys; promotion copies a safe accepted candidate into `reset_display_names` without changing history or event identity.

**Tech Stack:** TypeScript, Node test runner via `tsx`, Next.js 15, Supabase Postgres/RPC, existing Gemini V3 naming transport/parser/validator.

**Spec:** `docs/superpowers/specs/2026-09-08-reset-display-name-candidates-design.md`

## Global Constraints

- Webhook work ends at candidate seed persistence; Gemini generation, retry, and promotion run only in the reset display-name reconciliation job.
- A candidate PK is an opaque candidate identity. `notice_dedupe_key` is notice deduplication identity. Neither is a canonical `reset_event_key`.
- A seed has nullable `source_snapshot_hash` and `input_hash`, and starts with `ai_status=unprocessed`. `pending` is set only after a generation claim.
- Candidate lifecycle is `provisional -> promoted | superseded | expired`; `promoted` is terminal and cannot become `superseded`.
- Automatic generation and regeneration are allowed only while `lifecycle_status=provisional`. No automatic rename or overwrite occurs after promotion.
- Candidate acceptance uses `assessRandomResetNameResult()` and the existing JA/EN/ZH validator. `ai_confidence` and `ai_evidence` are audit fields, not acceptance or promotion gates.
- Candidate V3 input never supplies a fake `completedAt`. Completed-event input/prompt semantics remain unchanged.
- The existing run-wide global Gemini cap is shared. Completed canonical reconciliation runs first; candidates use only the remaining budget.
- Candidate-only work never enters `RadarData`, `public-v1`, public history, probability, adoption, reset estimates, or `lastRandomResetAt`.
- Existing `reset_display_names` localized/legacy compatibility, Tibo identity, history/adoption, probability, and unrelated fallback code remain unchanged except for the explicit precomputed-name preservation branch.
- No notice is merged by nearby time, similar text, or an untrusted edit relationship. Source context uses explicit provenance IDs only.

## Planned File Map

Create:

- `lib/radar/resetDisplayNameCandidateTypes.ts` — candidate records, seed input, identity and lifecycle predicates.
- `supabase/migrations/20260908123000_create_reset_display_name_candidates.sql` — candidate table, constraints, RLS, and service-role grants.
- `lib/radar/resetDisplayNameCandidateStore.ts` — seed, read, generation claim/result, and lifecycle persistence.
- `lib/radar/resetDisplayNameCandidateNaming.ts` — candidate-specific V3 input and prompt adapter.
- `supabase/migrations/20260908124500_create_promote_reset_display_name_candidate.sql` — atomic promotion RPC.
- `scripts/inspect-reset-display-name-candidates.ts` — read-only shadow inspection.
- `docs/operations/reset-display-name-candidates-rollout.md` — rollout and activation runbook.

Modify:

- `lib/radar/randomResetNaming.ts` — expose a prompt-based transport entry point while preserving the completed-event wrapper.
- `app/api/webhook/tibo/route.ts` — persist an official-notice seed only, with failure isolation.
- `lib/radar/radarFetch.ts` — expose internal eligible notice rows for reconciler self-healing without changing public DTOs.
- `lib/radar/resetDisplayNameReconciliation.ts` — missing-seed discovery, candidate phase, shared global budget, and promotion orchestration.
- `lib/radar/resetDisplayNameStore.ts` — explicit `notice-precompute-v1` provenance and safe accepted preservation.
- `lib/radar/resetDisplayNameReconciliationRoute.ts` — retain the existing safe response while passing candidate-enabled reconciliation options.

Tests:

- `tests/resetDisplayNameCandidateTypes.test.ts`
- `tests/resetDisplayNameCandidateSchema.test.ts`
- `tests/resetDisplayNameCandidateStore.test.ts`
- `tests/resetDisplayNameCandidateNaming.test.ts`
- `tests/tiboWebhookRoute.test.ts`
- `tests/resetDisplayNameCandidateReconciliation.test.ts`
- `tests/resetDisplayNameCandidatePromotion.test.ts`
- `tests/randomResetDisplayNames.test.ts`
- `tests/resetDisplayNameReconciliation.test.ts`
- `tests/resetDisplayNameCandidatePublicIsolation.test.ts`
- `tests/resetDisplayNameCandidateShadow.test.ts`

Do not modify `lib/radar/tiboResetEventIdentity.ts`, `lib/radar/tiboHistory.ts`, `lib/radar/probability.ts`, `lib/radar/publicDto.ts`, `reset_execution_estimates`, existing migrations, or any evaluation artifacts.

---

### Task 1: Define candidate identity, lifecycle, and generation state

**Files:**
- Create: `lib/radar/resetDisplayNameCandidateTypes.ts`
- Test: `tests/resetDisplayNameCandidateTypes.test.ts`

**Interfaces:**

```ts
export type ResetDisplayNameCandidateLifecycle =
  | "provisional"
  | "promoted"
  | "superseded"
  | "expired";

export type ResetDisplayNameCandidateAiStatus =
  | "unprocessed"
  | "pending"
  | "accepted"
  | "null"
  | "review_required"
  | "api_error"
  | "rate_limited"
  | "invalid_response";

export type ResetDisplayNameCandidateIdentityInput = {
  officialNoticeTweetId: string;
  logicalPostId: string | null;
};

export function getResetDisplayNameCandidateDedupeKey(
  input: ResetDisplayNameCandidateIdentityInput,
): string | null;

export function canTransitionResetDisplayNameCandidateLifecycle(
  from: ResetDisplayNameCandidateLifecycle,
  to: ResetDisplayNameCandidateLifecycle,
): boolean;
```

Also define `ResetDisplayNameCandidateSeed`, `ResetDisplayNameCandidateRecord`, and `ResetDisplayNameCandidateNoticeEligibilityInput` with the exact nullable fields from the spec. The record includes `ai_flags`, `ai_input_mode`, `generation_attempts`, and `promoted_event_key`; hashes are `string | null`.

- [ ] **Step 1: Write the failing test**

```ts
test("trusted logical post identity wins over the notice tweet fallback", () => {
  assert.equal(
    getResetDisplayNameCandidateDedupeKey({
      officialNoticeTweetId: "tweet-1",
      logicalPostId: "logical-1",
    }),
    "logical-post:logical-1",
  );
});

test("promotion is terminal and cannot transition to superseded", () => {
  assert.equal(
    canTransitionResetDisplayNameCandidateLifecycle("promoted", "superseded"),
    false,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateTypes.test.ts`

Expected: FAIL because the candidate module and exported predicates do not exist.

- [ ] **Step 3: Write the minimal implementation**

Implement exact identity precedence and lifecycle transitions. Return null for blank notice IDs. Use `logical-post:<logicalPostId>` only when a trusted logical ID is non-empty; otherwise use `official-notice:<officialNoticeTweetId>`. Allow only `provisional -> provisional`, `provisional -> promoted`, `provisional -> superseded`, and `provisional -> expired`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateTypes.test.ts`

Expected: PASS, including tests for notice fallback identity, untrusted blank identity rejection, and the separate AI status union.

- [ ] **Step 5: Commit**

```bash
git add lib/radar/resetDisplayNameCandidateTypes.ts tests/resetDisplayNameCandidateTypes.test.ts
git commit -m "feat: define reset display name candidate identity"
```

### Task 2: Add the service-role-only candidate schema

**Files:**
- Create: `supabase/migrations/20260908123000_create_reset_display_name_candidates.sql`
- Test: `tests/resetDisplayNameCandidateSchema.test.ts`

**Interfaces:**

The migration creates `public.reset_display_name_candidates` with `candidate_id uuid primary key`, unique `notice_dedupe_key`, non-null `official_notice_tweet_id`, nullable `logical_post_id`, `source_snapshot_hash`, and `input_hash`, localized AI fields, `ai_flags`, `ai_input_mode`, generation counters, lifecycle fields, and timestamps.

- [ ] **Step 1: Write the failing test**

```ts
test("candidate migration declares the identity and lifecycle contract", () => {
  const sql = readFileSync(
    "supabase/migrations/20260908123000_create_reset_display_name_candidates.sql",
    "utf8",
  );
  assert.match(sql, /candidate_id\\s+uuid\\s+primary key/i);
  assert.match(sql, /source_snapshot_hash\\s+text/i);
  assert.match(sql, /input_hash\\s+text/i);
  assert.match(sql, /'unprocessed'/i);
  assert.match(sql, /'pending'/i);
  assert.match(sql, /'notice-precompute-v1'/i);
  assert.match(sql, /enable row level security/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateSchema.test.ts`

Expected: FAIL because the migration file is absent.

- [ ] **Step 3: Write the minimal implementation**

Create the table with:

- `source_snapshot_hash text null` and `input_hash text null` for unprocessed seeds.
- `ai_status` defaulting to `unprocessed` and constrained to `unprocessed`, `pending`, `accepted`, `null`, `review_required`, `api_error`, `rate_limited`, and `invalid_response`.
- `lifecycle_status` defaulting to `provisional` and constrained to `provisional`, `promoted`, `superseded`, and `expired`.
- `ai_flags text[] not null default '{}'` and `ai_input_mode text null` constrained to `notice-precompute-v1` when present.
- Partial unique indexes for non-null `logical_post_id` and `official_notice_tweet_id`; `notice_dedupe_key` is unique.
- RLS enabled, all public/anon/authenticated privileges revoked, and service-role select/insert/update privileges granted.

Do not add a foreign key to `reset_execution_estimates`, `reset_display_names`, or any canonical history table.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateSchema.test.ts`

Expected: PASS. Validate the SQL locally with the repository's Supabase tooling only; do not apply it to Production.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260908123000_create_reset_display_name_candidates.sql tests/resetDisplayNameCandidateSchema.test.ts
git commit -m "feat: add reset display name candidate storage"
```

### Task 3: Implement candidate seed, read, claim, and result storage

**Files:**
- Create: `lib/radar/resetDisplayNameCandidateStore.ts`
- Test: `tests/resetDisplayNameCandidateStore.test.ts`

**Interfaces:**

```ts
export type ResetDisplayNameCandidateStoreClient = {
  from(table: "reset_display_name_candidates"): any;
};

export async function upsertResetDisplayNameCandidateSeed(
  client: ResetDisplayNameCandidateStoreClient,
  seed: ResetDisplayNameCandidateSeed,
): Promise<ResetDisplayNameCandidateRecord>;

export async function listResetDisplayNameCandidates(
  client: ResetDisplayNameCandidateStoreClient,
): Promise<ResetDisplayNameCandidateRecord[]>;

export async function claimResetDisplayNameCandidateGeneration(
  client: ResetDisplayNameCandidateStoreClient,
  input: {
    candidateId: string;
    sourceSnapshotHash: string;
    inputHash: string;
    now: string;
    stalePendingBefore: string;
  },
): Promise<ResetDisplayNameCandidateRecord | null>;

export async function writeResetDisplayNameCandidateGeneration(
  client: ResetDisplayNameCandidateStoreClient,
  input: {
    candidateId: string;
    sourceSnapshotHash: string;
    inputHash: string;
    aiStatus: ResetDisplayNameCandidateAiStatus;
    aiInputMode: "notice-precompute-v1";
    result: RandomResetNameGenerationResult;
    generatedAt: string;
  },
): Promise<void>;
```

The test file defines `fakeCandidateClient(): ResetDisplayNameCandidateStoreClient` as an in-memory client that records seed, claim, and result writes. It also exposes the stored row through `client.rows` so idempotency and state transitions can be asserted without a database connection.

- [ ] **Step 1: Write the failing test**

```ts
test("seed has no hashes or AI result and is unprocessed", async () => {
  const client = fakeCandidateClient();
  const record = await upsertResetDisplayNameCandidateSeed(client, {
    officialNoticeTweetId: "notice-1",
    logicalPostId: null,
    noticeTweetIds: ["notice-1"],
    sourceTweetIds: ["notice-1"],
  });
  assert.equal(record.aiStatus, "unprocessed");
  assert.equal(record.sourceSnapshotHash, null);
  assert.equal(record.inputHash, null);
  assert.equal(record.promotedEventKey, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateStore.test.ts`

Expected: FAIL because the store functions are absent.

- [ ] **Step 3: Write the minimal implementation**

Map database snake_case rows to the typed record. Seed upsert writes only notice identity, explicit source IDs, `ai_status=unprocessed`, `lifecycle_status=provisional`, and null generation/promotion fields. It must use `onConflict: "notice_dedupe_key"` and merge trusted logical identity only after the caller has verified the same edit chain.

The generation claim is a conditional update requiring `lifecycle_status=provisional`, a matching candidate ID, and a computed non-null hash. It sets `ai_status=pending` and the two hashes. A stale `pending` row is reclaimable using `updated_at`; no lease column or separate retry table is added. Generation result writes increment `generation_attempts`, preserve source identity, and store `ai_flags` exactly as returned by the V3 parser.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateStore.test.ts`

Expected: PASS for duplicate seed idempotency, logical identity enrichment, blank hash rejection during claim, and result status persistence.

- [ ] **Step 5: Commit**

```bash
git add lib/radar/resetDisplayNameCandidateStore.ts tests/resetDisplayNameCandidateStore.test.ts
git commit -m "feat: persist reset display name candidates"
```

### Task 4: Add a candidate-specific V3 naming interface

**Files:**
- Create: `lib/radar/resetDisplayNameCandidateNaming.ts`
- Modify: `lib/radar/randomResetNaming.ts`
- Test: `tests/resetDisplayNameCandidateNaming.test.ts`

**Interfaces:**

```ts
export type ResetDisplayNameCandidateNamingInput = {
  officialNoticeTweetId: string;
  logicalPostId: string | null;
  noticeObservedAt: string;
  expectedStartAt: string | null;
  expectedEndAt: string | null;
  temporalPrecision: string | null;
  scope: string | null;
  noticeType: string | null;
  sourceUrl: string | null;
  sourceContext: string | null;
};

export function buildResetDisplayNameCandidatePrompt(
  input: ResetDisplayNameCandidateNamingInput,
): string;

export async function generateResetDisplayNameCandidate(
  input: ResetDisplayNameCandidateNamingInput,
  options: { apiKey: string; model?: string; timeoutMs?: number },
): Promise<RandomResetNameGenerationResult>;

export async function generateRandomResetNameFromPrompt(
  prompt: string,
  options: { apiKey: string; model?: string; timeoutMs?: number },
): Promise<RandomResetNameGenerationResult>;
```

- [ ] **Step 1: Write the failing test**

```ts
test("candidate prompt describes a notice and never a completed event", () => {
  const prompt = buildResetDisplayNameCandidatePrompt(candidateInput());
  assert.match(prompt, /notice observed at/i);
  assert.doesNotMatch(prompt, /reset completed at/i);
  assert.doesNotMatch(prompt, /completedAt/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateNaming.test.ts`

Expected: FAIL because the candidate naming module and prompt-based generator are absent.

- [ ] **Step 3: Write the minimal implementation**

Extract the request/transport/parser portion of `generateRandomResetName()` into `generateRandomResetNameFromPrompt()`. Keep the existing `generateRandomResetName(RandomResetNameEvaluationInput, options)` wrapper and its `completedAt` prompt unchanged; it delegates to the new helper with the existing completed-event prompt.

The candidate adapter uses the same `RANDOM_RESET_NAME_V3_SYSTEM_PROMPT`, transport, JSON parser, `RANDOM_RESET_NAME_PROMPT_VERSION`, and `assessRandomResetNameResult()` path. `ai_input_mode=notice-precompute-v1` is the provenance discriminator; no new V3 acceptance rule is introduced. The candidate prompt labels notice observation and expected window as announcement facts, never as completion facts.

The test file defines `candidateInput(): ResetDisplayNameCandidateNamingInput` with a fixed notice fixture and a `mockGeminiResponse()` fetch stub; both are test-local and never call the external API.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateNaming.test.ts tests/randomResetNameEvaluation.test.ts`

Expected: PASS without any external Gemini request. Mock `globalThis.fetch` in the candidate test and verify the completed-event wrapper still emits its existing payload shape.

- [ ] **Step 5: Commit**

```bash
git add lib/radar/resetDisplayNameCandidateNaming.ts lib/radar/randomResetNaming.ts tests/resetDisplayNameCandidateNaming.test.ts
git commit -m "feat: add notice-based reset name generation"
```

### Task 5: Persist official-notice seeds in the webhook without AI work

**Files:**
- Modify: `app/api/webhook/tibo/route.ts`
- Test: `tests/tiboWebhookRoute.test.ts`

**Interfaces:**

The webhook calls `upsertResetDisplayNameCandidateSeed()` after the final signal has been persisted and before any completed-event naming call. The seed contains `officialNoticeTweetId`, trusted `logicalPostId`, explicit notice/source IDs, and temporal metadata. It does not contain a future `reset_event_key`.

The test file defines `postOfficialNoticeWithSeedStore(): Promise<{ status: number; seedWrites: number; nameGenerationCalls: number; canonicalEventKey: string | null; signalPersisted: boolean }>` and `postOfficialNoticeWithFailingSeedStore()` using route-local dependency injection. These fixtures distinguish seed persistence from the existing canonical event path and do not invoke Gemini.

- [ ] **Step 1: Write the failing test**

```ts
test("official notice webhook writes a seed but does not call the name generator", async () => {
  const result = await postOfficialNoticeWithSeedStore();
  assert.equal(result.status, 200);
  assert.equal(result.seedWrites, 1);
  assert.equal(result.nameGenerationCalls, 0);
  assert.equal(result.canonicalEventKey, null);
});

test("candidate seed failure does not fail official notice handling", async () => {
  const result = await postOfficialNoticeWithFailingSeedStore();
  assert.equal(result.status, 200);
  assert.equal(result.signalPersisted, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/tiboWebhookRoute.test.ts`

Expected: FAIL because the route has no candidate seed call and no seed-failure isolation.

- [ ] **Step 3: Write the minimal implementation**

After the existing `tibo_signals` upsert, evaluate the already-final classification with `isExecutionBearingResetDisplayNameNotice()`. Exclude replies, rejected signals, historical-only signals, and presentation-only `isOngoingBankedDistribution` policy rows without an explicit future distribution intent. Call the seed store exactly once for an eligible notice and catch/log only a redacted safe diagnostic on failure.

Do not call `generateRandomResetName()`, `generateResetDisplayNameCandidate()`, or any promotion helper from the webhook. Keep the existing formal adoption, canonical identity, estimate, and post-completion name path unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/tiboWebhookRoute.test.ts`

Expected: PASS, including regression coverage that a formal reset still reaches the existing canonical naming path and a seed error does not alter the webhook response or adoption behavior.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhook/tibo/route.ts tests/tiboWebhookRoute.test.ts
git commit -m "feat: seed reset name candidates from notices"
```

### Task 6: Add reconciler self-healing and shared-budget candidate generation

**Files:**
- Modify: `lib/radar/radarFetch.ts`
- Modify: `lib/radar/resetDisplayNameReconciliation.ts`
- Modify: `lib/radar/resetDisplayNameReconciliationRoute.ts`
- Test: `tests/resetDisplayNameCandidateReconciliation.test.ts`
- Test: `tests/resetDisplayNameReconciliationRoute.test.ts`

**Interfaces:**

```ts
export type ResetDisplayNameCandidateNotice = {
  officialNoticeTweetId: string;
  logicalPostId: string | null;
  noticeTweetIds: string[];
  sourceTweetIds: string[];
  noticeObservedAt: string;
  expectedStartAt: string | null;
  expectedEndAt: string | null;
  temporalPrecision: string | null;
  scope: string | null;
  noticeType: string | null;
  sourceUrl: string | null;
  sourceContext: string | null;
  isExecutionBearing: boolean;
};

export async function fetchResetDisplayNameCandidateNoticeSignals(): Promise<ResetDisplayNameCandidateNotice[]>;

export function discoverMissingResetDisplayNameCandidateSeeds(
  notices: readonly ResetDisplayNameCandidateNotice[],
  existing: readonly ResetDisplayNameCandidateRecord[],
): ResetDisplayNameCandidateSeed[];
```

The test file defines `notice(id: string): ResetDisplayNameCandidateNotice` and `reconcileWithCandidateFixtures(input: { existingCandidates?: ResetDisplayNameCandidateRecord[]; eligibleNotices?: ResetDisplayNameCandidateNotice[]; completedEventsNeedingNames?: number; maxGeminiRequests?: number; dryRun?: boolean }): Promise<{ seedWrites: number; geminiRequests: number; candidateGeminiRequests: number; invalidated: boolean }>` as test-local in-memory fixtures. The fixture injects fake candidate storage and naming calls, so it can verify ordering and shared-budget accounting without Supabase or Gemini.

- [ ] **Step 1: Write the failing test**

```ts
test("reconciler rediscovers a missing seed from an eligible signal", async () => {
  const result = await reconcileWithCandidateFixtures({
    existingCandidates: [],
    eligibleNotices: [notice("notice-1")],
    dryRun: false,
  });
  assert.equal(result.seedWrites, 1);
  assert.equal(result.candidateGeminiRequests, 1);
});

test("candidate generation uses only the remaining global budget", async () => {
  const result = await reconcileWithCandidateFixtures({
    completedEventsNeedingNames: 3,
    eligibleNotices: [notice("notice-1")],
    maxGeminiRequests: 3,
  });
  assert.equal(result.geminiRequests, 3);
  assert.equal(result.candidateGeminiRequests, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateReconciliation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts`

Expected: FAIL because missing-seed discovery and candidate reconciliation fields do not exist.

- [ ] **Step 3: Write the minimal implementation**

Expose an internal read of eligible `tibo_signals` through `lib/radarFetch.ts`; do not add candidates to `RadarData` or any public DTO. Discovery matches exact official notice IDs and trusted logical post IDs only. It upserts missing seeds idempotently and never merges by time, proximity, or text.

Extend `reconcileResetDisplayNames()` in this exact order:

1. Read candidate rows, eligible notice signals, source rows, adoption ledgers, estimates, canonical history, and existing canonical names.
2. Discover and seed missing candidates; when `dryRun=true`, report the discovery without writing.
3. Expire or supersede only still-provisional candidates that are rejected, historical-only, or explicitly ended.
4. Run the existing completed canonical reconciliation first.
5. Hydrate provisional candidates from explicit source IDs and compute nullable-to-populated `source_snapshot_hash` and `input_hash`.
6. Reuse identical accepted/null/review results and apply the existing transient cooldown before any call.
7. Use the same run-wide `maxGeminiRequests` counter for candidate calls. The candidate phase can call Gemini only while `geminiRequests < maxGeminiRequests`; the cap is not increased and no candidate reserve is added.
8. For candidates with authoritative execution evidence, allow at most one post-execution source-enrichment generation while lifecycle remains provisional and only when the explicit source snapshot changed. Defer it when no remaining budget exists.
9. Promote only after `resolveTiboResetEventIdentity()` has supplied a durable canonical key.
10. Invalidate `radar-data` only when canonical `reset_display_names` changed; candidate seed/result writes alone never invalidate public cache.

Use `ai_status=unprocessed` for a seed, `pending` only after the conditional claim, and `updated_at` for stale pending recovery. Keep the existing default global cap of 3 and the existing adoption boundary unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateReconciliation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts`

Expected: PASS for self-healing, duplicate prevention, remaining-budget accounting, dry-run no-write behavior, cooldown reuse, and candidate-only invalidation remaining false.

- [ ] **Step 5: Commit**

```bash
git add lib/radar/radarFetch.ts lib/radar/resetDisplayNameReconciliation.ts lib/radar/resetDisplayNameReconciliationRoute.ts tests/resetDisplayNameCandidateReconciliation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts
git commit -m "feat: reconcile reset display name candidates"
```

### Task 7: Add atomic candidate promotion after canonical identity exists

**Files:**
- Create: `supabase/migrations/20260908124500_create_promote_reset_display_name_candidate.sql`
- Modify: `lib/radar/resetDisplayNameCandidateStore.ts`
- Test: `tests/resetDisplayNameCandidatePromotion.test.ts`

**Interfaces:**

```ts
export type PromoteResetDisplayNameCandidateInput = {
  candidateId: string;
  canonicalEventKey: string;
  canonicalSourceTweetId: string | null;
  promotedAt: string;
};

export type PromoteResetDisplayNameCandidateResult = {
  status: "promoted" | "reused" | "already_promoted" | "not_accepted" | "conflict" | "missing";
  canonicalWrite: boolean;
  canonicalEventKey: string | null;
};

export async function promoteResetDisplayNameCandidate(
  client: ResetDisplayNameCandidateStoreClient,
  input: PromoteResetDisplayNameCandidateInput,
): Promise<PromoteResetDisplayNameCandidateResult>;
```

The test file defines `acceptedCandidate(): ResetDisplayNameCandidateRecord`, `promotedCandidate(canonicalEventKey: string): ResetDisplayNameCandidateRecord`, `promotionInput(canonicalEventKey: string): PromoteResetDisplayNameCandidateInput`, and `fakePromotionClient(candidate: ResetDisplayNameCandidateRecord): ResetDisplayNameCandidateStoreClient & { canonicalWrites: number; candidateId: string }` as in-memory fixtures. The fake client records canonical writes and rejects a second key without making a database call.

- [ ] **Step 1: Write the failing test**

```ts
test("promotion is idempotent and never changes the candidate identity", async () => {
  const client = fakePromotionClient(acceptedCandidate());
  const input = promotionInput("canonical-event-1");
  const first = await promoteResetDisplayNameCandidate(client, input);
  const second = await promoteResetDisplayNameCandidate(client, input);
  assert.equal(first.status, "promoted");
  assert.equal(second.status, "already_promoted");
  assert.equal(client.canonicalWrites, 1);
  assert.equal(client.candidateId, input.candidateId);
});

test("a different canonical key after promotion is a conflict", async () => {
  const client = fakePromotionClient(promotedCandidate("canonical-event-1"));
  const result = await promoteResetDisplayNameCandidate(client, promotionInput("canonical-event-2"));
  assert.equal(result.status, "conflict");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidatePromotion.test.ts`

Expected: FAIL because the promotion RPC and store wrapper do not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `promote_reset_display_name_candidate(p_candidate_id, p_canonical_event_key, p_source_tweet_id, p_promoted_at)` as a service-role RPC. Lock the candidate row and serialize access to the canonical event key inside the transaction. A candidate already promoted to the same key returns `already_promoted`; a different existing key returns `conflict`.

The RPC promotes only an accepted candidate. It preserves all existing manual localized fields and existing accepted canonical AI names, and fills only unprotected missing localized values. It records `promoted_event_key` and `promoted_at` once. It does not write history, adoption, estimates, probability, or reset boundaries.

The TypeScript wrapper maps the candidate into the existing reset-display-name record shape and calls `isSafeStoredAiResetName()` plus existing manual/accepted protection before sending a copy request. `ai_confidence` and `ai_evidence` are not required for a V3 accepted candidate.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidatePromotion.test.ts`

Expected: PASS for accepted promotion, manual/accepted reuse, null/error no-op, same-key retry, different-key conflict, and absence of history/estimate writes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260908124500_create_promote_reset_display_name_candidate.sql lib/radar/resetDisplayNameCandidateStore.ts tests/resetDisplayNameCandidatePromotion.test.ts
git commit -m "feat: promote reset display name candidates safely"
```

### Task 8: Preserve promoted precomputed names in completed-event reconciliation

**Files:**
- Modify: `lib/radar/resetDisplayNameStore.ts`
- Modify: `lib/radar/resetDisplayNameReconciliation.ts`
- Test: `tests/randomResetDisplayNames.test.ts`
- Test: `tests/resetDisplayNameReconciliation.test.ts`

**Interfaces:**

```ts
export function isSafeAcceptedPrecomputedResetDisplayName(
  record: ResetDisplayNameRecord | null | undefined,
): boolean;
```

The test file defines `acceptedPrecomputedRecord(overrides: { input_hash: string; ai_input_mode: "notice-precompute-v1" }): ResetDisplayNameRecord` and `reconcileWithExistingRecord(record: ResetDisplayNameRecord, input: { completedInputHash: string }): Promise<{ status: string; geminiCalls: number; writes: number }>` as test-local fixtures around the existing completed-event reconciliation seam.

- [ ] **Step 1: Write the failing test**

```ts
test("completed reconciliation preserves a promoted notice-precomputed name despite hash mismatch", async () => {
  const record = acceptedPrecomputedRecord({
    input_hash: "notice-input-hash",
    ai_input_mode: "notice-precompute-v1",
  });
  const result = await reconcileWithExistingRecord(record, {
    completedInputHash: "different-completed-event-hash",
  });
  assert.equal(result.status, "preserved_precomputed");
  assert.equal(result.geminiCalls, 0);
  assert.equal(result.writes, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/randomResetDisplayNames.test.ts tests/resetDisplayNameReconciliation.test.ts`

Expected: FAIL because the completed reconciler currently treats the candidate input hash as a mismatch and can regenerate.

- [ ] **Step 3: Write the minimal implementation**

Expand the existing internal input-mode type to accept `notice-precompute-v1`. Implement `isSafeAcceptedPrecomputedResetDisplayName()` by requiring `ai_input_mode=notice-precompute-v1` and delegating name safety to `isSafeStoredAiResetName()`; do not add a second validator.

In both `ensureResetDisplayNameForEvent()` and the completed reconciler loop, check this preservation branch after existing manual/legacy protections and before `shouldReuseResetDisplayNameResult()` or any completed-event hash comparison. Preserve the candidate hash as the hash of the notice-precompute input, keep `ai_generated_at` as generation time, and never write a fabricated completed timestamp or completed-event hash.

After `lifecycle_status=promoted`, candidate generation and automatic replacement are disabled permanently. Manual localized overrides remain the only later improvement path.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/randomResetDisplayNames.test.ts tests/resetDisplayNameReconciliation.test.ts`

Expected: PASS for precomputed preservation, hash mismatch, manual override precedence, legacy compatibility, and ordinary completed-event regeneration behavior.

- [ ] **Step 5: Commit**

```bash
git add lib/radar/resetDisplayNameStore.ts lib/radar/resetDisplayNameReconciliation.ts tests/randomResetDisplayNames.test.ts tests/resetDisplayNameReconciliation.test.ts
git commit -m "fix: preserve promoted precomputed reset names"
```

### Task 9: Lock public isolation and end-to-end failure boundaries

**Files:**
- Test: `tests/resetDisplayNameCandidatePublicIsolation.test.ts`
- Test: `tests/resetDisplayNameCandidateReconciliation.test.ts`
- Test: `tests/resetDisplayNameReconciliationRoute.test.ts`

**Interfaces:**

No `RadarData`, `public-v1`, `combineResetHistory()`, `getActiveOfficialNotice()`, probability, or public history interface gains a candidate field.

The test file defines `buildPublicSnapshotWithCandidateOnlyState(): { viewModel: Record<string, unknown> }` and `runInternalReconcileWithCandidateOnlyWrite(): Promise<{ invalidated: boolean; sourceContext?: string; generatedName?: string }>` as test-local fixtures. The first constructs a public-shaped object with only candidate-table state behind the fixture boundary; the second records a candidate-only write and the existing cache invalidation hook without exposing candidate fields.

- [ ] **Step 1: Write the failing test**

```ts
test("candidate-only state is absent from public snapshot and safe internal response", async () => {
  const snapshot = buildPublicSnapshotWithCandidateOnlyState();
  assert.equal("resetDisplayNameCandidates" in snapshot.viewModel, false);
  assert.equal("candidate" in snapshot, false);

  const response = await runInternalReconcileWithCandidateOnlyWrite();
  assert.equal(response.invalidated, false);
  assert.equal("sourceContext" in response, false);
  assert.equal("generatedName" in response, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidatePublicIsolation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts`

Expected: FAIL until the integration fixtures and candidate-only route behavior are fixed and explicitly asserted.

- [ ] **Step 3: Write the minimal implementation**

Keep candidates out of `fetchCurrentRadarData()`, `RadarData`, `lib/radar.ts`, public DTO construction, and `combineResetHistory()`. Keep the internal route response limited to existing safe counters and status summaries. Ensure candidate seed/generation writes do not call `revalidateTag("radar-data")`; only canonical display-name writes do.

Do not add a public route for candidate rows and do not expose source text, AI evidence, generated names, prompt fingerprints, or candidate identity in the public snapshot.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidatePublicIsolation.test.ts tests/resetDisplayNameCandidateReconciliation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts`

Expected: PASS with unchanged public schema and unchanged history/probability behavior.

- [ ] **Step 5: Commit**

```bash
git add tests/resetDisplayNameCandidatePublicIsolation.test.ts tests/resetDisplayNameCandidateReconciliation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts
git commit -m "test: keep reset name candidates private"
```

### Task 10: Add read-only shadow inspection and staged activation runbook

**Files:**
- Create: `scripts/inspect-reset-display-name-candidates.ts`
- Create: `docs/operations/reset-display-name-candidates-rollout.md`
- Test: `tests/resetDisplayNameCandidateShadow.test.ts`

**Interfaces:**

```ts
export type ResetDisplayNameCandidateShadowReport = {
  eligibleNoticeCount: number;
  existingCandidateCount: number;
  missingSeedCount: number;
  ambiguousIdentityCount: number;
  promotionReadyCount: number;
  geminiCalls: 0;
  writes: 0;
};

export async function inspectResetDisplayNameCandidates():
  Promise<ResetDisplayNameCandidateShadowReport>;
```

The test file defines `inspectWithFixtures(): Promise<ResetDisplayNameCandidateShadowReport>` as a test-local dependency-injected call to the script's pure inspection path, with one promotion-ready candidate and no write-capable client.

- [ ] **Step 1: Write the failing test**

```ts
test("shadow inspection is read-only and never invokes Gemini", async () => {
  const report = await inspectWithFixtures();
  assert.equal(report.geminiCalls, 0);
  assert.equal(report.writes, 0);
  assert.equal(report.promotionReadyCount, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateShadow.test.ts`

Expected: FAIL because the shadow script and report function are absent.

- [ ] **Step 3: Write the minimal implementation**

The script reads eligible Tibo signals, existing candidate rows, adoption/estimate evidence, and canonical names. It computes missing seeds, identity conflicts, and promotion-ready candidates without calling any upsert, RPC, Gemini, or cache invalidation function. Output contains counts and non-secret IDs only.

The runbook fixes this sequence:

1. Apply the candidate migrations only in local/staging validation environments.
2. Run the read-only shadow inspection with `geminiCalls=0` and `writes=0`.
3. Review missing-seed count, logical identity conflicts, ongoing-policy exclusions, and candidate-to-canonical associations.
4. Enable webhook seed persistence while keeping generation disabled; confirm seed counts and no public changes.
5. Enable the existing scheduled reconciler candidate phase with the unchanged run-wide Gemini cap; completed canonical work remains first.
6. Confirm canonical promotion and cache invalidation only on actual display-name writes.

Production migration application, scheduling enablement, and data writes are separate release actions after this plan has been implemented and shadow results have been reviewed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateShadow.test.ts`

Expected: PASS with zero Gemini calls and zero writes. Then run the complete focused candidate suite:

```bash
pnpm exec tsx --test tests/resetDisplayNameCandidateTypes.test.ts tests/resetDisplayNameCandidateStore.test.ts tests/resetDisplayNameCandidateNaming.test.ts tests/resetDisplayNameCandidateReconciliation.test.ts tests/resetDisplayNameCandidatePromotion.test.ts tests/randomResetDisplayNames.test.ts tests/resetDisplayNameReconciliation.test.ts tests/resetDisplayNameCandidatePublicIsolation.test.ts tests/resetDisplayNameCandidateShadow.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add scripts/inspect-reset-display-name-candidates.ts docs/operations/reset-display-name-candidates-rollout.md tests/resetDisplayNameCandidateShadow.test.ts
git commit -m "docs: define reset name candidate shadow rollout"
```

## Final Verification After Implementation

After all task commits, review the combined diff for these exact properties:

- Only the planned candidate files, the explicit V3 adapter, webhook seed hook, reconciler, preservation branch, tests, migration, script, and runbook changed.
- `reset_display_names.event_key` remains canonical-only; no candidate identifier is written there before promotion.
- No candidate table read is added to `RadarData`, public DTOs, public history, probability, or cache dimensions.
- `notice-precompute-v1` is the only new provenance discriminator, and the completed reconciler preserves safe accepted rows before completed-input hash comparison.
- `ai_confidence` and `ai_evidence` are not required for candidate acceptance or promotion.
- The webhook performs no Gemini call, retry, or promotion.
- Candidate generation shares the existing global cap and cannot consume more than the remaining per-run budget.
- Promotion failure cannot rollback formal adoption, Monitor evidence, history, or reset boundaries.
- `promoted` has no outgoing automatic lifecycle transition and no automatic regeneration path.
- Existing localized/legacy fallback, Tibo identity, adoption, history, probability, and public-v1 semantics have no unrelated changes.

Run after implementation:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
git diff --check
```

Do not run any Production migration, write, scheduler activation, or Gemini call as part of writing or reviewing this plan.
