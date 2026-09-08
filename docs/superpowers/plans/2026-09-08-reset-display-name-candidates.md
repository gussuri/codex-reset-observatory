# Reset Display Name Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist a future official notice as an internal name candidate, generate its localized V3 name outside the webhook critical path, and promote it exactly once to an existing canonical event after persisted authoritative execution evidence exists.

**Architecture:** The webhook writes only an idempotent notice seed to a service-role-only `reset_display_name_candidates` table when the fail-closed candidate mode permits it. The existing bounded reset-display-name reconciler discovers missing seeds, shares its existing global Gemini budget, and performs candidate generation while the candidate remains provisional. Existing adoption/Monitor identity resolution remains the only source of canonical event keys; promotion copies a safe accepted candidate into `reset_display_names` only when that resolver reports an existing key backed by persisted authoritative execution evidence.

**Tech Stack:** TypeScript, Node test runner via `tsx`, Next.js 15, Supabase Postgres/RPC, existing Gemini V3 naming transport/parser/validator.

**Spec:** `docs/superpowers/specs/2026-09-08-reset-display-name-candidates-design.md`

## Global Constraints

- Webhook work ends at candidate seed persistence; Gemini generation, retry, and promotion run only in the reset display-name reconciliation job.
- A candidate PK is an opaque candidate identity. `notice_dedupe_key` is notice deduplication identity. Neither is a canonical `reset_event_key`.
- A seed has nullable `source_snapshot_hash` and `input_hash`, and starts with `ai_status=unprocessed`. `pending` is set only after a generation claim.
- Candidate lifecycle is `provisional -> promoted | superseded | expired`; `promoted` is terminal and cannot become `superseded`.
- Automatic generation and regeneration are allowed only while `lifecycle_status=provisional`; v1 has no automatic post-execution source-enrichment regeneration. No automatic rename or overwrite occurs after promotion.
- Candidate acceptance uses `assessRandomResetNameResult()` and the existing JA/EN/ZH validator. `ai_confidence` and `ai_evidence` are audit fields, not acceptance or promotion gates.
- Candidate V3 input never supplies a fake `completedAt`; the shared Gemini helper receives a V3 validation context including `sourcePostText` and preserves the existing named-token/number safety flags. Completed-event input/prompt/payload semantics remain unchanged.
- The existing run-wide global Gemini cap is shared. Completed canonical reconciliation runs first; candidates use only the remaining budget.
- A candidate result with `ai_status=rate_limited` is not retried on the next ten-minute run: persist a nullable `next_retry_at` and skip it until that time. The minimum candidate cooldown is one hour; a provider `retryAfterSeconds` value longer than one hour wins. No retry table or unbounded retry loop is added.
- Candidate activation is fail-closed: `off` is the default and permits no candidate action, `seed` permits only webhook/self-healing seed writes, and `full` additionally permits candidate generation and promotion. `RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT` is a candidate-specific activation/adoption cutoff, separate from the existing completed-event reconciler adoption time; self-healing never considers a `tibo_signals` row whose `tweet_created_at` is before that cutoff. Invalid or missing mode/cutoff configuration resolves to `off`.
- Promotion requires `resolveTiboResetEventIdentity()` to return `status="existing"`, a non-null key, and a matching persisted authoritative execution evidence record. A non-null key from `status="new"` is never promotable, and notice-only/static-history/dynamic-only matches are insufficient.
- Candidate-only work never enters `RadarData`, `public-v1`, public history, probability, adoption, reset estimates, or `lastRandomResetAt`.
- Existing `reset_display_names` localized/legacy compatibility, Tibo identity, history/adoption, probability, and unrelated fallback code remain unchanged except for the explicit precomputed-name preservation branch.
- No notice is merged by nearby time, similar text, or an untrusted edit relationship. Source context uses explicit provenance IDs only.

## Planned File Map

Create:

- `lib/radar/resetDisplayNameCandidateTypes.ts` — candidate records, seed input, identity and lifecycle predicates.
- `lib/radar/resetDisplayNameCandidateActivation.ts` — fail-closed `off | seed | full` configuration and candidate-specific adoption cutoff parsing.
- `supabase/migrations/20260908123000_create_reset_display_name_candidates.sql` — candidate table, constraints, RLS, and service-role grants.
- `lib/radar/resetDisplayNameCandidateStore.ts` — seed, read, generation claim/result, and lifecycle persistence.
- `lib/radar/resetDisplayNameCandidateNaming.ts` — candidate-specific V3 input and prompt adapter.
- `supabase/migrations/20260908124500_create_promote_reset_display_name_candidate.sql` — atomic promotion RPC.
- `scripts/inspect-reset-display-name-candidates.ts` — read-only shadow inspection.
- `docs/operations/reset-display-name-candidates-rollout.md` — rollout and activation runbook.

Modify:

- `lib/radar/randomResetNaming.ts` — expose a prompt-based transport entry point while preserving the completed-event wrapper.
- `app/api/webhook/tibo/route.ts` — persist an official-notice seed only, with failure isolation.
- `lib/radarFetch.ts` — expose internal eligible notice rows for reconciler self-healing without changing public DTOs.
- `lib/radar/resetDisplayNameReconciliation.ts` — missing-seed discovery, candidate phase, shared global budget, and promotion orchestration.
- `lib/radar/resetDisplayNameStore.ts` — explicit `notice-precompute-v1` provenance and safe accepted preservation.
- `lib/radar/resetDisplayNameReconciliationRoute.ts` — retain the existing safe response while passing candidate-enabled reconciliation options.

Tests:

- `tests/resetDisplayNameCandidateTypes.test.ts`
- `tests/resetDisplayNameCandidateActivation.test.ts`
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

export type ResetDisplayNameCandidateActivationMode = "off" | "seed" | "full";

export type ResetDisplayNameCandidateActivation = {
  mode: ResetDisplayNameCandidateActivationMode;
  adoptionAt: string | null;
};

export type ResetDisplayNameNoticeEligibilityInput = {
  signalType: "official_notice" | "reset_executed" | "teaser" | "irrelevant";
  verificationStatus: string | null;
  isReply: boolean;
  isHistoricalOnly: boolean;
  isPresentationOnlyOngoingBanked: boolean;
  hasFutureBankedDistributionIntent: boolean;
};

export function isExecutionBearingResetDisplayNameNotice(
  input: ResetDisplayNameNoticeEligibilityInput,
): boolean;

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

export type ResetDisplayNameCandidatePromotionResolution = {
  status: "new" | "existing" | "conflict" | "blocked";
  resetEventKey: string | null;
  matchedEvidenceEventKey: string | null;
};

export type ResetDisplayNameCandidateExecutionEvidence = {
  resetEventKey: string;
  kind: "formal_adoption" | "monitor_usage_estimate";
};

export function isCandidatePromotionAuthorized(
  resolution: ResetDisplayNameCandidatePromotionResolution,
  evidence: readonly ResetDisplayNameCandidateExecutionEvidence[],
): boolean;
```

Also define `ResetDisplayNameCandidateSeed` and `ResetDisplayNameCandidateRecord` with the exact nullable fields from the spec. The record includes `ai_flags`, `ai_input_mode`, `generation_attempts`, `promoted_event_key`, and `nextRetryAt: string | null`; hashes are `string | null`.

The new `lib/radar/resetDisplayNameCandidateActivation.ts` exposes:

```ts
export function readResetDisplayNameCandidateActivation(
  env: Readonly<Record<string, string | undefined>>,
): ResetDisplayNameCandidateActivation;

export function isResetDisplayNameCandidateNoticeAfterAdoption(
  tweetCreatedAt: string,
  adoptionAt: string,
): boolean;
```

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

test("a resolver-created key without persisted execution evidence is not promotable", () => {
  assert.equal(
    isCandidatePromotionAuthorized(
      { status: "new", resetEventKey: "tibo-reset-new", matchedEvidenceEventKey: null },
      [],
    ),
    false,
  );
});

test("the shared notice predicate excludes presentation-only ongoing BANKED policy", () => {
  assert.equal(
    isExecutionBearingResetDisplayNameNotice({
      signalType: "official_notice",
      verificationStatus: "confirmed",
      isReply: false,
      isHistoricalOnly: false,
      isPresentationOnlyOngoingBanked: true,
      hasFutureBankedDistributionIntent: false,
    }),
    false,
  );
});
```

`tests/resetDisplayNameCandidateActivation.test.ts` separately asserts that missing/invalid mode or adoption cutoff becomes `{ mode: "off", adoptionAt: null }`, that `seed` permits only seed operations, that `full` permits generation/promotion phases, and that a `tweet_created_at` before `adoptionAt` is never eligible for self-healing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateTypes.test.ts tests/resetDisplayNameCandidateActivation.test.ts`

Expected: FAIL because the candidate identity/eligibility modules and exported predicates do not exist.

- [ ] **Step 3: Write the minimal implementation**

Implement exact identity precedence and lifecycle transitions. Return null for blank notice IDs. Use `logical-post:<logicalPostId>` only when a trusted logical ID is non-empty; otherwise use `official-notice:<officialNoticeTweetId>`. Allow only `provisional -> provisional`, `provisional -> promoted`, `provisional -> superseded`, and `provisional -> expired`. Implement `isExecutionBearingResetDisplayNameNotice()` once here so both webhook and reconciler import the same predicate: it accepts only a final official notice that is not rejected, reply-only, historical-only, or presentation-only ongoing BANKED without explicit future distribution intent. Implement `isCandidatePromotionAuthorized()` so it requires `status="existing"`, a non-null resolver key, a matching resolver evidence key, and a persisted evidence entry of kind `formal_adoption` or `monitor_usage_estimate`; `status="new"` is false even when its key is non-null.

In `lib/radar/resetDisplayNameCandidateActivation.ts`, parse `RESET_DISPLAY_NAME_CANDIDATE_MODE` and the separate `RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT`. Invalid or missing values fail closed to `mode="off"`; `seed` and `full` require a valid ISO cutoff. Expose a pure `isResetDisplayNameCandidateNoticeAfterAdoption(tweetCreatedAt, adoptionAt)` predicate that compares the existing `tibo_signals.tweet_created_at` value and never falls back to the existing completed-event reconciler adoption timestamp. The cutoff is configuration, not a candidate/canonical identity.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateTypes.test.ts tests/resetDisplayNameCandidateActivation.test.ts`

Expected: PASS, including tests for notice fallback identity, untrusted blank identity rejection, the shared execution-bearing predicate, the promotion evidence gate, default `off`, invalid configuration fail-closed behavior, and the adoption cutoff.

- [ ] **Step 5: Commit**

```bash
git add lib/radar/resetDisplayNameCandidateTypes.ts lib/radar/resetDisplayNameCandidateActivation.ts tests/resetDisplayNameCandidateTypes.test.ts tests/resetDisplayNameCandidateActivation.test.ts
git commit -m "feat: define reset display name candidate policy"
```

### Task 2: Add the service-role-only candidate schema

**Files:**
- Create: `supabase/migrations/20260908123000_create_reset_display_name_candidates.sql`
- Test: `tests/resetDisplayNameCandidateSchema.test.ts`

**Interfaces:**

The migration creates `public.reset_display_name_candidates` with `candidate_id uuid primary key`, unique `notice_dedupe_key`, non-null `official_notice_tweet_id`, nullable `logical_post_id`, `source_snapshot_hash`, `input_hash`, nullable `next_retry_at`, localized AI fields, `ai_flags`, `ai_input_mode`, generation counters, lifecycle fields, and timestamps. The same migration defines the atomic `public.upsert_reset_display_name_candidate_seed(p_seed jsonb)` RPC used by both webhook and reconciler seed paths.

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
  assert.match(sql, /create or replace function public\.upsert_reset_display_name_candidate_seed/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = pg_catalog, public, extensions/i);
  assert.match(sql, /revoke all on function public\.upsert_reset_display_name_candidate_seed/i);
  assert.match(sql, /grant execute on function public\.upsert_reset_display_name_candidate_seed\s*\([^)]*\)\s+to\s+service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.upsert_reset_display_name_candidate_seed\s*\([^)]*\)[\s\S]*?to\s+(?:public|anon|authenticated)/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateSchema.test.ts`

Expected: FAIL because the migration file is absent.

- [ ] **Step 3: Write the minimal implementation**

Create the table with:

- `source_snapshot_hash text null` and `input_hash text null` for unprocessed seeds.
- `next_retry_at timestamptz null` for provider-directed rate-limit cooldown; it is not a separate retry queue.
- `ai_status` defaulting to `unprocessed` and constrained to `unprocessed`, `pending`, `accepted`, `null`, `review_required`, `api_error`, `rate_limited`, and `invalid_response`.
- `lifecycle_status` defaulting to `provisional` and constrained to `provisional`, `promoted`, `superseded`, and `expired`.
- `ai_flags text[] not null default '{}'` and `ai_input_mode text null` constrained to `notice-precompute-v1` when present.
- Partial unique indexes for non-null `logical_post_id` and `official_notice_tweet_id`; `notice_dedupe_key` is unique.
- RLS enabled, all public/anon/authenticated privileges revoked, and service-role select/insert/update privileges granted.
- `upsert_reset_display_name_candidate_seed(p_seed jsonb)` is `SECURITY INVOKER`, fixes `search_path` to `pg_catalog, public, extensions`, revokes EXECUTE from `public`, `anon`, and `authenticated`, and grants EXECUTE only to `service_role`. Its transaction lock and exact identity upgrade semantics are specified in Task 3.

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
  rpc(
    functionName: "upsert_reset_display_name_candidate_seed" | "promote_reset_display_name_candidate",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown | null }>;
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
    retryAfterSeconds: number | null;
    generatedAt: string;
  },
): Promise<void>;
```

The test file defines `fakeCandidateClient(): ResetDisplayNameCandidateStoreClient`, `candidate(id: string, overrides?: Partial<ResetDisplayNameCandidateRecord>): ResetDisplayNameCandidateRecord`, and a rate-limit response fixture as in-memory helpers. The client records seed, claim, and result writes and exposes the stored row through `client.rows` so idempotency, state transitions, and `nextRetryAt` can be asserted without a database connection.

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

test("trusted logical identity upgrades the same fallback row and unions provenance", async () => {
  const client = fakeCandidateClient();
  const first = await upsertResetDisplayNameCandidateSeed(client, {
    officialNoticeTweetId: "notice-1",
    logicalPostId: null,
    noticeTweetIds: ["notice-1"],
    sourceTweetIds: ["notice-1"],
  });
  const upgraded = await upsertResetDisplayNameCandidateSeed(client, {
    officialNoticeTweetId: "notice-1",
    logicalPostId: "logical-1",
    noticeTweetIds: ["notice-1", "notice-2"],
    sourceTweetIds: ["notice-1", "source-2"],
  });
  assert.equal(upgraded.candidateId, first.candidateId);
  assert.equal(upgraded.logicalPostId, "logical-1");
  assert.deepEqual(upgraded.noticeTweetIds, ["notice-1", "notice-2"]);
  assert.deepEqual(upgraded.sourceTweetIds, ["notice-1", "source-2"]);
});

test("a seed identity collision is reported without merging candidates", async () => {
  const client = fakeCandidateClient();
  await upsertResetDisplayNameCandidateSeed(client, {
    officialNoticeTweetId: "notice-1",
    logicalPostId: null,
    noticeTweetIds: ["notice-1"],
    sourceTweetIds: ["notice-1"],
  });
  await upsertResetDisplayNameCandidateSeed(client, {
    officialNoticeTweetId: "notice-2",
    logicalPostId: "logical-1",
    noticeTweetIds: ["notice-2"],
    sourceTweetIds: ["notice-2"],
  });
  await assert.rejects(() => upsertResetDisplayNameCandidateSeed(client, {
    officialNoticeTweetId: "notice-1",
    logicalPostId: "logical-1",
    noticeTweetIds: ["notice-1"],
    sourceTweetIds: ["notice-1"],
  }), /conflict/i);
  assert.equal(client.rows.size, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateStore.test.ts`

Expected: FAIL because the store functions are absent.

- [ ] **Step 3: Write the minimal implementation**

Map database snake_case rows to the typed record. `upsertResetDisplayNameCandidateSeed()` calls the service-role-only `upsert_reset_display_name_candidate_seed` RPC rather than doing a non-atomic read/insert sequence. Seed upsert writes only notice identity, explicit source IDs, `ai_status=unprocessed`, `lifecycle_status=provisional`, and null generation/promotion fields.

The seed RPC takes a trusted logical post identity when one is available, acquires the same kind of transaction-scoped advisory lock used by the formal-adoption RPC, and locks rows matching the exact official notice ID, exact logical post ID, or exact dedupe key. If a tweet-fallback row is the only compatible match, it upgrades that same opaque `candidate_id` in place, sets the trusted `logical_post_id`, recomputes `notice_dedupe_key`, and unions `notice_tweet_ids` and `source_tweet_ids`. It never rekeys the candidate or creates a canonical event key. If the official-ID lookup and logical-ID lookup resolve to different candidates, or the unique-key update conflicts with another candidate, the RPC returns `conflict` and performs no merge. Webhook and reconciler calls therefore share one atomic path and cannot create duplicates during concurrency. Identity upgrades are limited to the same explicitly verified edit chain; time, text, or nearby-post similarity is never used.

The generation claim is a conditional update requiring `lifecycle_status=provisional`, a matching candidate ID, a computed non-null hash, and `next_retry_at <= now()` (or null). It sets `ai_status=pending` and the two hashes. A stale `pending` row is reclaimable using `updated_at`; no lease column or separate retry table is added. Generation result writes increment `generation_attempts`, preserve source identity, and store `ai_flags` exactly as returned by the V3 parser. A rate-limited result stores `ai_status=rate_limited` and computes `next_retry_at = now + max(3600, retryAfterSeconds)`; missing provider retry timing therefore waits at least one hour, while a longer provider delay is respected. Successful, accepted/null/review, and terminal error results clear `next_retry_at`. The scheduled ten-minute run skips any row whose `next_retry_at` is in the future.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateStore.test.ts`

Expected: PASS for duplicate seed idempotency, in-place logical identity upgrade with provenance union, collision-without-merge behavior, blank hash rejection during claim, and result status persistence.

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
  sourcePostText: string;
  sourceContext: string | null;
};

export type RandomResetNameV3ValidationContext = {
  sourcePostText: string;
  evidenceValues: readonly (string | null)[];
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
  validationContext: RandomResetNameV3ValidationContext,
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

test("candidate generation retains V3 named-token and number safety flags", async () => {
  const fetchStub = mockGeminiResponse({
    nameJa: "GPT-99リセット",
    nameEn: "GPT-99 Reset",
    nameZh: "GPT-99重置",
    reason: "test",
  });
  globalThis.fetch = fetchStub;
  const result = await generateRandomResetNameFromPrompt(
    "notice prompt",
    { sourcePostText: "A reset is planned", evidenceValues: ["A reset is planned"] },
    { apiKey: "test-key" },
  );
  assert.deepEqual(result.flags, ["unprovided_named_token", "unprovided_number"]);
  fetchStub.restore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateNaming.test.ts`

Expected: FAIL because the candidate naming module and prompt-based generator are absent.

- [ ] **Step 3: Write the minimal implementation**

Extract the request/transport/parser portion of `generateRandomResetName()` into `generateRandomResetNameFromPrompt(prompt, validationContext, options)`. The common helper must receive `RandomResetNameV3ValidationContext`, including `sourcePostText` and the exact evidence values used by the V3 safety checks. It returns the existing `flags` unchanged, including `unprovided_named_token` and `unprovided_number`; candidate code cannot bypass or recompute them with a weaker rule. Keep the existing `generateRandomResetName(RandomResetNameEvaluationInput, options)` wrapper and its completed-event prompt and request payload unchanged; it supplies the existing completed-event validation context to the helper.

The candidate adapter uses a candidate-specific input builder with required `sourcePostText` and no `completedAt`, then passes its evidence values through the shared V3 validation context. It uses the same `RANDOM_RESET_NAME_V3_SYSTEM_PROMPT`, transport, JSON parser, `RANDOM_RESET_NAME_PROMPT_VERSION`, and `assessRandomResetNameResult()` path. `ai_input_mode=notice-precompute-v1` is the provenance discriminator; no new V3 acceptance rule is introduced. The candidate prompt labels notice observation and expected window as announcement facts, never as completion facts. The candidate adapter is invoked only after the shared `isExecutionBearingResetDisplayNameNotice()` predicate has accepted the notice; it does not create a second eligibility rule.

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

The webhook imports `readResetDisplayNameCandidateActivation()` and the shared `isExecutionBearingResetDisplayNameNotice()` predicate. It calls `upsertResetDisplayNameCandidateSeed()` after the final signal has been persisted and before any completed-event naming call only when mode is `seed` or `full` and the signal's existing `tweet_created_at` is on or after `adoptionAt`. The seed contains `officialNoticeTweetId`, trusted `logicalPostId`, explicit notice/source IDs, and temporal metadata. It does not contain a future `reset_event_key`. Mode `off` is the default and performs no candidate seed operation; mode `seed` never enables Gemini or promotion, and mode `full` still defers both to the reconciler.

The test file defines `postOfficialNoticeWithSeedStore(overrides?: { mode?: "off" | "seed" | "full"; adoptionAt?: string | null; tweetCreatedAt?: string }): Promise<{ status: number; seedWrites: number; nameGenerationCalls: number; canonicalEventKey: string | null; signalPersisted: boolean }>` and `postOfficialNoticeWithFailingSeedStore()` using route-local dependency injection. These fixtures distinguish seed persistence from the existing canonical event path and do not invoke Gemini.

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

test("candidate mode off is fail-closed and the adoption cutoff excludes old signals", async () => {
  assert.equal((await postOfficialNoticeWithSeedStore({ mode: "off" })).seedWrites, 0);
  assert.equal((await postOfficialNoticeWithSeedStore({
    mode: "seed",
    adoptionAt: "2026-09-09T00:00:00.000Z",
    tweetCreatedAt: "2026-09-08T23:59:59.999Z",
  })).seedWrites, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/tiboWebhookRoute.test.ts`

Expected: FAIL because the route has no candidate seed call and no seed-failure isolation.

- [ ] **Step 3: Write the minimal implementation**

After the existing `tibo_signals` upsert, evaluate the already-final classification with the one shared `isExecutionBearingResetDisplayNameNotice()` implementation from `lib/radar/resetDisplayNameCandidateTypes.ts`. Exclude replies, rejected signals, historical-only signals, and presentation-only `isOngoingBankedDistribution` policy rows without an explicit future distribution intent. Apply the candidate activation mode and `tweet_created_at >= candidateAdoptionAt` cutoff before calling the seed RPC exactly once for an eligible notice. Catch/log only a redacted safe diagnostic on seed failure. There is no webhook-local eligibility clone.

Do not call `generateRandomResetName()`, `generateResetDisplayNameCandidate()`, or any promotion helper from the webhook in any mode. Keep the existing formal adoption, canonical identity, estimate, and post-completion name path unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/tiboWebhookRoute.test.ts`

Expected: PASS, including mode-off fail-closed behavior, adoption cutoff exclusion, shared-predicate eligibility, a formal reset still reaching the existing canonical naming path, and a seed error not altering the webhook response or adoption behavior.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhook/tibo/route.ts tests/tiboWebhookRoute.test.ts
git commit -m "feat: seed reset name candidates from notices"
```

### Task 6: Add reconciler self-healing and shared-budget candidate generation

**Files:**
- Modify: `lib/radarFetch.ts`
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
  tweetCreatedAt: string;
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

export async function fetchResetDisplayNameCandidateNoticeSignals(
  activation: ResetDisplayNameCandidateActivation,
): Promise<ResetDisplayNameCandidateNotice[]>;

export function discoverMissingResetDisplayNameCandidateSeeds(
  notices: readonly ResetDisplayNameCandidateNotice[],
  existing: readonly ResetDisplayNameCandidateRecord[],
  activation: ResetDisplayNameCandidateActivation,
): ResetDisplayNameCandidateSeed[];

export function collectPersistedAuthoritativeCandidateExecutionEvidence(
  adoptionLedgers: readonly TiboFormalAdoptionRecord[],
  estimates: readonly ResetExecutionEstimate[],
): ResetDisplayNameCandidateExecutionEvidence[];

export type ResetDisplayNameReconciliationCandidateOptions = ResetDisplayNameCandidateActivation;
```

The test file defines `notice(id: string, overrides?: { tweetCreatedAt?: string; noticeObservedAt?: string }): ResetDisplayNameCandidateNotice` and `reconcileWithCandidateFixtures(input: { mode?: "off" | "seed" | "full"; adoptionAt?: string | null; now?: string; existingCandidates?: ResetDisplayNameCandidateRecord[]; eligibleNotices?: ResetDisplayNameCandidateNotice[]; completedEventsNeedingNames?: number; maxGeminiRequests?: number; dryRun?: boolean; candidateRetryAfterSeconds?: number | null; identityResolution?: ResetDisplayNameCandidatePromotionResolution; authoritativeEvidence?: ResetDisplayNameCandidateExecutionEvidence[] }): Promise<{ seedWrites: number; geminiRequests: number; candidateGeminiRequests: number; promotions: number; invalidated: boolean; nextRetryAt?: string | null }>` as test-local in-memory fixtures. The fixture injects fake candidate storage and naming calls, so it can verify ordering, activation mode, persisted-signal cutoff semantics, rate-limit cooldown, authoritative-evidence gating, and shared-budget accounting without Supabase or Gemini.

- [ ] **Step 1: Write the failing test**

```ts
test("reconciler rediscovers a missing seed from an eligible signal", async () => {
  const result = await reconcileWithCandidateFixtures({
    existingCandidates: [],
    eligibleNotices: [notice("notice-1")],
    mode: "seed",
    adoptionAt: "2026-09-01T00:00:00.000Z",
    dryRun: false,
  });
  assert.equal(result.seedWrites, 1);
  assert.equal(result.candidateGeminiRequests, 0);
});

test("candidate generation uses only the remaining global budget", async () => {
  const result = await reconcileWithCandidateFixtures({
    completedEventsNeedingNames: 3,
    eligibleNotices: [notice("notice-1")],
    mode: "full",
    adoptionAt: "2026-09-01T00:00:00.000Z",
    maxGeminiRequests: 3,
  });
  assert.equal(result.geminiRequests, 3);
  assert.equal(result.candidateGeminiRequests, 0);
});

test("full mode permits candidate generation after completed work leaves budget", async () => {
  const result = await reconcileWithCandidateFixtures({
    mode: "full",
    adoptionAt: "2026-09-01T00:00:00.000Z",
    eligibleNotices: [notice("notice-1")],
    maxGeminiRequests: 1,
  });
  assert.equal(result.candidateGeminiRequests, 1);
});

test("a resolver-created key is not promoted without persisted authoritative evidence", async () => {
  const result = await reconcileWithCandidateFixtures({
    mode: "full",
    adoptionAt: "2026-09-01T00:00:00.000Z",
    eligibleNotices: [notice("notice-1")],
    identityResolution: {
      status: "new",
      resetEventKey: "tibo-reset-new",
      matchedEvidenceEventKey: null,
    },
    authoritativeEvidence: [],
  });
  assert.equal(result.promotions, 0);
});

test("self-healing uses persisted tweetCreatedAt rather than noticeObservedAt for the cutoff", async () => {
  const result = await reconcileWithCandidateFixtures({
    mode: "seed",
    adoptionAt: "2026-09-09T00:00:00.000Z",
    eligibleNotices: [notice("notice-1", {
      tweetCreatedAt: "2026-09-08T23:59:59.999Z",
      noticeObservedAt: "2026-09-09T00:05:00.000Z",
    })],
  });
  assert.equal(result.seedWrites, 0);
});

test("a rate-limited candidate is not retried on the next ten-minute reconciliation", async () => {
  const result = await reconcileWithCandidateFixtures({
    mode: "full",
    adoptionAt: "2026-09-01T00:00:00.000Z",
    now: "2026-09-09T00:10:00.000Z",
    existingCandidates: [{ ...candidate("candidate-1"), aiStatus: "rate_limited", nextRetryAt: "2026-09-09T01:00:00.000Z" }],
    eligibleNotices: [notice("notice-1", { tweetCreatedAt: "2026-09-08T00:00:00.000Z" })],
  });
  assert.equal(result.candidateGeminiRequests, 0);
});

test("a provider retry-after longer than one hour is respected", async () => {
  const result = await reconcileWithCandidateFixtures({
    mode: "full",
    adoptionAt: "2026-09-01T00:00:00.000Z",
    now: "2026-09-09T00:00:00.000Z",
    candidateRetryAfterSeconds: 7200,
    eligibleNotices: [notice("notice-1", { tweetCreatedAt: "2026-09-08T00:00:00.000Z" })],
  });
  assert.equal(result.nextRetryAt, "2026-09-09T02:00:00.000Z");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateReconciliation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts`

Expected: FAIL because missing-seed discovery and candidate reconciliation fields do not exist.

- [ ] **Step 3: Write the minimal implementation**

Expose an internal read of eligible `tibo_signals` through `lib/radarFetch.ts`; do not add candidates to `RadarData` or any public DTO. Add `candidateActivation: ResetDisplayNameReconciliationCandidateOptions` to the internal reconciliation options, with `getResetDisplayNameReconciliationOptions()` reading the fail-closed activation config. Discovery applies the candidate activation mode and requires the persisted `tibo_signals.tweet_created_at >= candidateAdoptionAt`; `ResetDisplayNameCandidateNotice.tweetCreatedAt` is copied from that persisted column and is the only cutoff input. `noticeObservedAt` is observation metadata and can never substitute for `tweetCreatedAt`, so a row observed after activation but created before it is excluded. Discovery matches exact official notice IDs and trusted logical post IDs only. It calls the same atomic seed RPC as the webhook and never merges by time, proximity, or text.

Extend `reconcileResetDisplayNames()` in this exact order. The existing completed-event branch runs in every candidate mode; `off` only skips candidate-table work and leaves that existing branch unchanged:

1. Read the existing source rows, adoption ledgers, estimates, canonical history, and existing canonical names. When mode is `seed` or `full`, also read candidate rows and eligible notice signals; when mode is `off`, do not read or write the candidate table.
2. In `seed` or `full`, discover and seed missing candidates; when `dryRun=true`, report the discovery without writing.
3. Run the existing completed canonical reconciliation first, preserving its adoption boundary, manual protection, and global budget accounting.
4. In `mode="seed"`, stop the candidate branch after seed/self-healing; do not perform candidate lifecycle transitions, Gemini generation, or promotion. In `mode="off"`, skip the entire candidate branch.
5. In `mode="full"`, expire or supersede only still-provisional candidates that are rejected, historical-only, or explicitly ended.
6. In `mode="full"`, hydrate provisional candidates from explicit source IDs and compute nullable-to-populated `source_snapshot_hash` and `input_hash`.
7. Reuse identical accepted/null/review results and apply the existing transient cooldown before any candidate call. Skip `ai_status=rate_limited` while `next_retry_at > now`; when a candidate call returns 429, persist `ai_status=rate_limited` and `next_retry_at = now + max(3600, provider retryAfterSeconds)`, preferring the provider delay when longer. Use the same run-wide `maxGeminiRequests` counter for candidate calls; the cap is not increased and no candidate reserve is added.
8. v1 has no automatic post-execution source-enrichment generation. If a candidate reaches authoritative execution without an accepted precomputed result, leave canonical naming to the existing completed-event reconciler; later regeneration is a separate versioned design.
9. Before promotion, call `resolveTiboResetEventIdentity()` and collect persisted formal-adoption or Monitor-backed usage-observation evidence. Pass the resolver projection and evidence to `isCandidatePromotionAuthorized()`. Require `status="existing"`, a non-null key, matching resolver evidence, and an evidence row whose event key matches. A resolver result with `status="new"` is rejected even when it contains a non-null generated key; static-history or dynamic-only matches are also rejected.
10. Invalidate `radar-data` only when canonical `reset_display_names` changed; candidate seed/result writes alone never invalidate public cache.

Use `ai_status=unprocessed` for a seed, `pending` only after the conditional claim, and `updated_at` for stale pending recovery. Keep the existing default global cap of 3 and the existing completed-event adoption boundary unchanged; `candidateAdoptionAt` is an independent candidate cutoff.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidateReconciliation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts`

Expected: PASS for self-healing after the persisted `tweetCreatedAt` cutoff (with `noticeObservedAt` unable to bypass it), mode-off/seed/full behavior, duplicate prevention, `status="new"` promotion rejection, persisted-evidence promotion eligibility, remaining-budget accounting, dry-run no-write behavior, one-hour/provider-directed `rate_limited` cooldown, cooldown reuse, and candidate-only invalidation remaining false.

- [ ] **Step 5: Commit**

```bash
git add lib/radarFetch.ts lib/radar/resetDisplayNameReconciliation.ts lib/radar/resetDisplayNameReconciliationRoute.ts tests/resetDisplayNameCandidateReconciliation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts
git commit -m "feat: reconcile reset display name candidates"
```

### Task 7: Add atomic candidate promotion after canonical identity exists

**Files:**
- Create: `supabase/migrations/20260908124500_create_promote_reset_display_name_candidate.sql`
- Modify: `lib/radar/resetDisplayNameCandidateStore.ts`
- Test: `tests/resetDisplayNameCandidatePromotion.test.ts`
- Test: `tests/resetDisplayNameCandidateSchema.test.ts`

**Interfaces:**

```ts
export type PromoteResetDisplayNameCandidateInput = {
  candidateId: string;
  canonicalEventKey: string;
  canonicalSourceTweetId: string | null;
  promotedAt: string;
  identityResolution: ResetDisplayNameCandidatePromotionResolution;
  authoritativeEvidence: readonly ResetDisplayNameCandidateExecutionEvidence[];
};

export type PromoteResetDisplayNameCandidateResult = {
  status: "promoted" | "reused" | "already_promoted" | "not_accepted" | "not_authoritative" | "conflict" | "missing";
  canonicalWrite: boolean;
  canonicalEventKey: string | null;
};

export async function promoteResetDisplayNameCandidate(
  client: ResetDisplayNameCandidateStoreClient,
  input: PromoteResetDisplayNameCandidateInput,
): Promise<PromoteResetDisplayNameCandidateResult>;
```

The test file defines `acceptedCandidate(): ResetDisplayNameCandidateRecord`, `promotedCandidate(canonicalEventKey: string): ResetDisplayNameCandidateRecord`, `promotionInput(canonicalEventKey: string): PromoteResetDisplayNameCandidateInput`, and `fakePromotionClient(candidate: ResetDisplayNameCandidateRecord): ResetDisplayNameCandidateStoreClient & { canonicalWrites: number; candidateId: string; rpcCalls: number }` as in-memory fixtures. The fake client records RPC and canonical writes and rejects a second key without making a database call.

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

test("a non-null key from resolver status new never reaches the promotion RPC", async () => {
  const client = fakePromotionClient(acceptedCandidate());
  const result = await promoteResetDisplayNameCandidate(client, {
    ...promotionInput("tibo-reset-new"),
    identityResolution: {
      status: "new",
      resetEventKey: "tibo-reset-new",
      matchedEvidenceEventKey: null,
    },
    authoritativeEvidence: [],
  });
  assert.equal(result.status, "not_authoritative");
  assert.equal(client.rpcCalls, 0);
  assert.equal(client.canonicalWrites, 0);
});

test("an existing key with persisted formal adoption evidence is promotable", async () => {
  const client = fakePromotionClient(acceptedCandidate());
  const result = await promoteResetDisplayNameCandidate(client, {
    ...promotionInput("canonical-event-1"),
    identityResolution: {
      status: "existing",
      resetEventKey: "canonical-event-1",
      matchedEvidenceEventKey: "canonical-event-1",
    },
    authoritativeEvidence: [{
      resetEventKey: "canonical-event-1",
      kind: "formal_adoption",
    }],
  });
  assert.equal(result.status, "promoted");
  assert.equal(client.rpcCalls, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidatePromotion.test.ts`

Expected: FAIL because the promotion RPC and store wrapper do not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `promote_reset_display_name_candidate(p_candidate_id, p_canonical_event_key, p_source_tweet_id, p_promoted_at)` as a service-role RPC. Declare it explicitly `SECURITY INVOKER`, set `search_path = pg_catalog, public, extensions`, revoke EXECUTE from `public`, `anon`, and `authenticated`, and grant EXECUTE only to `service_role`, matching the formal-adoption RPC security pattern. Lock the candidate row and serialize access to the canonical event key inside the transaction. Re-read `tibo_formal_adoptions` and `reset_execution_estimates` in that transaction and require a persisted row for the requested key: a formal-adoption row, or a Monitor-backed usage-observation estimate. A candidate already promoted to the same key returns `already_promoted`; a different existing key returns `conflict`; absence of authoritative evidence returns `not_authoritative`.

The TypeScript wrapper first calls `isCandidatePromotionAuthorized(identityResolution, authoritativeEvidence)`. This requires `status="existing"`, a non-null key, matching resolver evidence, and evidence kind `formal_adoption` or `monitor_usage_estimate`; `status="new"` is rejected even when `resetEventKey` is non-null. Only after this guard passes does it call the RPC. The RPC repeats the persisted-evidence check so a stale or fabricated resolver result cannot promote a notice-only event.

The RPC promotes only an accepted candidate. It preserves all existing manual localized fields and existing accepted canonical AI names, and fills only unprotected missing localized values. It records `promoted_event_key` and `promoted_at` once. It does not write history, adoption, estimates, probability, or reset boundaries. Promotion failure cannot rollback the already-persisted evidence that made the canonical event authoritative.

The TypeScript wrapper maps the candidate into the existing reset-display-name record shape and calls `isSafeStoredAiResetName()` plus existing manual/accepted protection before sending a copy request. `ai_confidence` and `ai_evidence` are not required for a V3 accepted candidate.

Extend `tests/resetDisplayNameCandidateSchema.test.ts` to read the promotion migration and assert the same `SECURITY INVOKER`, fixed `search_path`, `REVOKE ALL ... FROM public, anon, authenticated`, service-role-only `GRANT EXECUTE`, and no-public-grant contract for `promote_reset_display_name_candidate`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidatePromotion.test.ts`

Expected: PASS for accepted promotion, `status="new"` rejection before RPC, existing-key/evidence promotion, manual/accepted reuse, null/error no-op, same-key retry, different-key conflict, schema security assertions, and absence of history/estimate writes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260908124500_create_promote_reset_display_name_candidate.sql lib/radar/resetDisplayNameCandidateStore.ts tests/resetDisplayNameCandidatePromotion.test.ts tests/resetDisplayNameCandidateSchema.test.ts
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

The test file defines `publicSnapshotFromRadarFixture(): ReturnType<typeof toPublicRadarSnapshot>` by passing a real `RadarData` fixture through `toPublicRadarSnapshot()` from `lib/radar/publicDto.ts`; candidate rows live only in the injected candidate-store fixture and are never attached to that `RadarData`. It also defines `safeRouteResponseFromCandidateOnlyRun(): Promise<Response>` by invoking the real `createReconcileResetDisplayNamesHandler()` and `toSafeResetDisplayNameReconciliationResponse()` boundary with a candidate-only reconciliation result. These are test-local adapters around the actual public DTO and safe route, not hand-built snapshots that could pass without exercising the production boundary.

- [ ] **Step 1: Write the failing test**

```ts
test("candidate-only state is absent from public snapshot and safe internal response", async () => {
  const snapshot = publicSnapshotFromRadarFixture();
  const serializedSnapshot = JSON.stringify(snapshot);
  assert.equal(serializedSnapshot.includes("candidate-id"), false);
  assert.equal(serializedSnapshot.includes("private candidate source text"), false);
  assert.equal(serializedSnapshot.includes("candidate generated name"), false);

  const response = await safeRouteResponseFromCandidateOnlyRun();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.invalidated, false);
  assert.equal(JSON.stringify(body).includes("candidate-id"), false);
  assert.equal(JSON.stringify(body).includes("private candidate source text"), false);
  assert.equal(JSON.stringify(body).includes("candidate generated name"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/resetDisplayNameCandidatePublicIsolation.test.ts tests/resetDisplayNameReconciliationRoute.test.ts`

Expected: FAIL until the real public DTO and safe route fixtures prove the candidate-only state remains outside both boundaries.

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

The runbook fixes this sequence and treats any missing/invalid mode or cutoff as fail-closed `off`:

1. Apply the candidate migrations only in local/staging validation environments.
2. Leave `RESET_DISPLAY_NAME_CANDIDATE_MODE=off` while running the read-only shadow inspection with `geminiCalls=0` and `writes=0`.
3. Set and review the immutable `RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT` cutoff; confirm signals before it are excluded from self-healing.
4. Review missing-seed count, logical identity conflicts, ongoing-policy exclusions, and candidate-to-canonical associations.
5. Enable `RESET_DISPLAY_NAME_CANDIDATE_MODE=seed` for webhook seed persistence and self-healing while keeping generation and promotion disabled; confirm seed counts and no public changes.
6. After a separate review, switch to `RESET_DISPLAY_NAME_CANDIDATE_MODE=full` to enable candidate generation and evidence-gated promotion with the unchanged run-wide Gemini cap; completed canonical work remains first.
7. Confirm canonical promotion and cache invalidation only on actual display-name writes.

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
- `rate_limited` candidates are skipped until `next_retry_at`, with a one-hour minimum and longer provider retry timing respected without a retry table.
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
