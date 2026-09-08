import assert from "node:assert/strict";
import test from "node:test";

import {
  type ResetDisplayNameCandidateStoreClient,
} from "../lib/radar/resetDisplayNameCandidateStore";
import {
  collectPersistedAuthoritativeCandidateExecutionEvidence,
  discoverMissingResetDisplayNameCandidateSeeds,
  reconcileResetDisplayNames,
  type ResetDisplayNameCandidateNotice,
} from "../lib/radar/resetDisplayNameReconciliation";
import type {
  ResetDisplayNameCandidateRecord,
  ResetDisplayNameCandidateSeed,
} from "../lib/radar/resetDisplayNameCandidateTypes";
import type { RandomResetNameGenerationResult } from "../lib/radar/randomResetNaming";
import type { RadarData, WindowEventLike } from "../lib/radar/types";
import type { TiboFormalAdoptionRecord } from "../lib/radar/tiboFormalAdoptionStore";
import type { ResetExecutionEstimate } from "../lib/radar/resetExecution";

const NOW = new Date("2026-09-09T00:10:00.000Z");
const CANDIDATE_TIMESTAMP = "2026-09-08T00:00:00.000Z";

type DatabaseCandidate = {
  candidate_id: string;
  notice_dedupe_key: string;
  official_notice_tweet_id: string;
  logical_post_id: string | null;
  notice_tweet_ids: string[];
  source_tweet_ids: string[];
  source_snapshot_hash: string | null;
  input_hash: string | null;
  next_retry_at: string | null;
  ai_name_ja: string | null;
  ai_name_en: string | null;
  ai_name_zh: string | null;
  ai_confidence: number | null;
  ai_evidence: string | null;
  ai_reason: string | null;
  ai_flags: string[];
  ai_model: string | null;
  ai_prompt_version: string | null;
  ai_input_mode: string | null;
  ai_status: ResetDisplayNameCandidateRecord["aiStatus"];
  lifecycle_status: ResetDisplayNameCandidateRecord["lifecycleStatus"];
  generation_attempts: number;
  last_generated_at: string | null;
  promoted_event_key: string | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
};

function candidate(
  id: string,
  overrides: Partial<ResetDisplayNameCandidateRecord> = {},
): ResetDisplayNameCandidateRecord {
  return {
    candidateId: id,
    noticeDedupeKey: `official-notice:${id}`,
    officialNoticeTweetId: id,
    logicalPostId: null,
    noticeTweetIds: [id],
    sourceTweetIds: [id],
    sourceSnapshotHash: null,
    inputHash: null,
    aiNameJa: null,
    aiNameEn: null,
    aiNameZh: null,
    aiConfidence: null,
    aiEvidence: null,
    aiReason: null,
    aiFlags: [],
    aiModel: null,
    aiPromptVersion: null,
    aiInputMode: null,
    aiStatus: "unprocessed",
    lifecycleStatus: "provisional",
    generationAttempts: 0,
    lastGeneratedAt: null,
    promotedEventKey: null,
    promotedAt: null,
    createdAt: CANDIDATE_TIMESTAMP,
    updatedAt: CANDIDATE_TIMESTAMP,
    nextRetryAt: null,
    ...overrides,
  };
}

function toDatabase(value: ResetDisplayNameCandidateRecord): DatabaseCandidate {
  return {
    candidate_id: value.candidateId,
    notice_dedupe_key: value.noticeDedupeKey,
    official_notice_tweet_id: value.officialNoticeTweetId,
    logical_post_id: value.logicalPostId,
    notice_tweet_ids: [...value.noticeTweetIds],
    source_tweet_ids: [...value.sourceTweetIds],
    source_snapshot_hash: value.sourceSnapshotHash,
    input_hash: value.inputHash,
    next_retry_at: value.nextRetryAt,
    ai_name_ja: value.aiNameJa,
    ai_name_en: value.aiNameEn,
    ai_name_zh: value.aiNameZh,
    ai_confidence: value.aiConfidence,
    ai_evidence: value.aiEvidence,
    ai_reason: value.aiReason,
    ai_flags: [...value.aiFlags],
    ai_model: value.aiModel,
    ai_prompt_version: value.aiPromptVersion,
    ai_input_mode: value.aiInputMode,
    ai_status: value.aiStatus,
    lifecycle_status: value.lifecycleStatus,
    generation_attempts: value.generationAttempts,
    last_generated_at: value.lastGeneratedAt,
    promoted_event_key: value.promotedEventKey,
    promoted_at: value.promotedAt,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

function fromDatabase(value: DatabaseCandidate): ResetDisplayNameCandidateRecord {
  return {
    candidateId: value.candidate_id,
    noticeDedupeKey: value.notice_dedupe_key,
    officialNoticeTweetId: value.official_notice_tweet_id,
    logicalPostId: value.logical_post_id,
    noticeTweetIds: [...value.notice_tweet_ids],
    sourceTweetIds: [...value.source_tweet_ids],
    sourceSnapshotHash: value.source_snapshot_hash,
    inputHash: value.input_hash,
    nextRetryAt: value.next_retry_at,
    aiNameJa: value.ai_name_ja,
    aiNameEn: value.ai_name_en,
    aiNameZh: value.ai_name_zh,
    aiConfidence: value.ai_confidence,
    aiEvidence: value.ai_evidence,
    aiReason: value.ai_reason,
    aiFlags: [...value.ai_flags],
    aiModel: value.ai_model,
    aiPromptVersion: value.ai_prompt_version,
    aiInputMode: value.ai_input_mode,
    aiStatus: value.ai_status,
    lifecycleStatus: value.lifecycle_status,
    generationAttempts: value.generation_attempts,
    lastGeneratedAt: value.last_generated_at,
    promotedEventKey: value.promoted_event_key,
    promotedAt: value.promoted_at,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function fakeCandidateStore(initial: ResetDisplayNameCandidateRecord[] = []) {
  const rows = new Map(initial.map((value) => [value.candidateId, toDatabase(value)]));
  let seedWrites = 0;
  let candidateResultWrites = 0;
  const client = {
    rpc(name: "upsert_reset_display_name_candidate_seed" | "promote_reset_display_name_candidate", args: Record<string, unknown>) {
      if (name !== "upsert_reset_display_name_candidate_seed") {
        return Promise.resolve({ data: null, error: new Error("unexpected RPC") });
      }
      seedWrites += 1;
      const seed = args.p_seed as ResetDisplayNameCandidateSeed & {
        official_notice_tweet_id: string;
        logical_post_id: string | null;
        notice_tweet_ids: string[];
        source_tweet_ids: string[];
      };
      const existing = Array.from(rows.values()).find((row) =>
        row.official_notice_tweet_id === seed.official_notice_tweet_id ||
        row.notice_tweet_ids.some((id) => seed.notice_tweet_ids.includes(id)) ||
        (seed.logical_post_id !== null && row.logical_post_id === seed.logical_post_id),
      );
      if (!existing) {
        const created = toDatabase(candidate(`candidate-${rows.size + 1}`, {
          officialNoticeTweetId: seed.official_notice_tweet_id,
          logicalPostId: seed.logical_post_id,
          noticeTweetIds: [...seed.notice_tweet_ids],
          sourceTweetIds: [...seed.source_tweet_ids],
          noticeDedupeKey: seed.logical_post_id
            ? `logical-post:${seed.logical_post_id}`
            : `official-notice:${seed.official_notice_tweet_id}`,
        }));
        rows.set(created.candidate_id, created);
        return Promise.resolve({ data: created, error: null });
      }
      existing.logical_post_id ??= seed.logical_post_id;
      existing.notice_dedupe_key = existing.logical_post_id
        ? `logical-post:${existing.logical_post_id}`
        : `official-notice:${existing.official_notice_tweet_id}`;
      existing.notice_tweet_ids = Array.from(new Set([...existing.notice_tweet_ids, ...seed.notice_tweet_ids]));
      existing.source_tweet_ids = Array.from(new Set([...existing.source_tweet_ids, ...seed.source_tweet_ids]));
      return Promise.resolve({ data: existing, error: null });
    },
    from() {
      return {
        select() {
          const filters: Array<(row: DatabaseCandidate) => boolean> = [];
          const query = {
            eq(column: keyof DatabaseCandidate, value: unknown) {
              filters.push((row) => row[column] === value);
              return query;
            },
            order() {
              return Promise.resolve({ data: Array.from(rows.values()), error: null });
            },
            maybeSingle() {
              const row = Array.from(rows.values()).find((entry) => filters.every((filter) => filter(entry)));
              return Promise.resolve({ data: row ?? null, error: null });
            },
          };
          return query;
        },
        update(payload: Record<string, unknown>) {
          const filters: Array<(row: DatabaseCandidate) => boolean> = [];
          const query = {
            eq(column: keyof DatabaseCandidate, value: unknown) {
              filters.push((row) => row[column] === value);
              return query;
            },
            or(expression: string) {
              if (expression.startsWith("next_retry_at.is.null")) {
                const now = expression.match(/next_retry_at\.lte\.(.+)$/)?.[1] ?? "";
                filters.push((row) => row.next_retry_at === null || row.next_retry_at <= now);
              } else if (expression.startsWith("ai_status.neq.pending")) {
                const staleBefore = expression.match(/updated_at\.lt\.(.+)$/)?.[1] ?? "";
                filters.push((row) => row.ai_status !== "pending" || row.updated_at < staleBefore);
              }
              return query;
            },
            select() {
              return {
                maybeSingle() {
                  const row = Array.from(rows.values()).find((entry) => filters.every((filter) => filter(entry)));
                  if (!row) return Promise.resolve({ data: null, error: null });
                  Object.assign(row, payload);
                  if (payload.ai_status === "pending") {
                    return Promise.resolve({ data: row, error: null });
                  }
                  candidateResultWrites += 1;
                  return Promise.resolve({ data: row, error: null });
                },
              };
            },
          };
          return query;
        },
      };
    },
  } as unknown as ResetDisplayNameCandidateStoreClient;

  return {
    client,
    get rows() { return Array.from(rows.values()).map(fromDatabase); },
    get seedWrites() { return seedWrites; },
    get candidateResultWrites() { return candidateResultWrites; },
  };
}

function notice(
  id: string,
  overrides: Partial<ResetDisplayNameCandidateNotice> = {},
): ResetDisplayNameCandidateNotice {
  return {
    officialNoticeTweetId: id,
    logicalPostId: null,
    noticeTweetIds: [id],
    sourceTweetIds: [id],
    tweetCreatedAt: CANDIDATE_TIMESTAMP,
    noticeObservedAt: CANDIDATE_TIMESTAMP,
    expectedStartAt: null,
    expectedEndAt: null,
    temporalPrecision: null,
    scope: null,
    noticeType: "official_notice",
    sourceUrl: `https://x.test/${id}`,
    sourceContext: "A recorded reset announcement.",
    isExecutionBearing: true,
    ...overrides,
  };
}

function resetEvent(eventKey: string): WindowEventLike {
  const sourceTweetId = `source-${eventKey}`;
  return {
    id: eventKey,
    recordKind: "confirmed_global",
    kind: "reset_completed",
    status: "closed",
    completed_at: "2026-09-08T00:00:00.000Z",
    closed_at: "2026-09-08T00:00:00.000Z",
    sourceTweetIds: [sourceTweetId],
    source_url: `https://x.test/${sourceTweetId}`,
    details: {
      cycleType: "ランダムリセット",
      reasonType: "詫びリセット",
      resetMethod: "強制リセット",
      scope: "全有料プラン",
      noticeToExecution: "0分",
      noticeType: "公式予告あり",
    },
  };
}

function sourceRow(tweetId: string) {
  return {
    tweet_id: tweetId,
    text: "A recorded reset announcement.",
    tweet_created_at: CANDIDATE_TIMESTAMP,
    is_reply: false,
    verification_status: "confirmed",
  };
}

function successResult(): RandomResetNameGenerationResult {
  return {
    name: "記録されたリセット",
    nameEn: "Recorded Reset",
    nameZh: "记录重置",
    confidence: null,
    evidence: null,
    reason: "recorded",
    evidenceGrounded: null,
    flags: [],
    status: "success",
    model: "gemini-test",
    promptVersion: "random-reset-name-v3",
    latencyMs: 1,
    httpStatus: 200,
    retryAfterSeconds: null,
  };
}

function rateLimitedResult(retryAfterSeconds: number | null): RandomResetNameGenerationResult {
  return {
    ...successResult(),
    name: null,
    nameEn: null,
    nameZh: null,
    status: "rate_limited",
    flags: ["provider_rate_limited"],
    httpStatus: 429,
    retryAfterSeconds,
  };
}

async function reconcileWithCandidateFixtures(input: {
  mode?: "off" | "seed" | "full";
  adoptionAt?: string | null;
  now?: string;
  existingCandidates?: ResetDisplayNameCandidateRecord[];
  eligibleNotices?: ResetDisplayNameCandidateNotice[];
  completedEventsNeedingNames?: number;
  maxGeminiRequests?: number;
  dryRun?: boolean;
  candidateRetryAfterSeconds?: number | null;
}) {
  const mode = input.mode ?? "off";
  const candidateStorage = fakeCandidateStore(input.existingCandidates ?? []);
  const notices = input.eligibleNotices ?? [];
  const completedCount = input.completedEventsNeedingNames ?? 0;
  const history = Array.from({ length: completedCount }, (_, index) => resetEvent(`completed-${index + 1}`));
  const sourceRows = history.flatMap((item) => sourceRow(item.sourceTweetIds?.[0] ?? ""));
  let candidateGeminiCalls = 0;
  const reconciliation = await reconcileResetDisplayNames({
    data: {
      formal_tibo_resets: sourceRows,
      reset_display_names: [],
    } as unknown as RadarData,
    canonicalHistory: history,
    sourceRows,
    now: new Date(input.now ?? NOW.toISOString()),
    apiKey: "test-key",
    maxGeminiRequests: input.maxGeminiRequests,
    dryRun: input.dryRun,
    candidateActivation: {
      mode,
      adoptionAt: input.adoptionAt ?? "2026-09-01T00:00:00.000Z",
    },
    candidateNotices: notices,
    candidateStore: candidateStorage.client,
    candidateGenerate: async () => {
      candidateGeminiCalls += 1;
      return input.candidateRetryAfterSeconds === undefined
        ? successResult()
        : rateLimitedResult(input.candidateRetryAfterSeconds);
    },
    ensure: async (item, options) => ({
      eventKey: options.canonicalEventKey ?? item.id ?? null,
      status: "accepted",
      displayName: "Completed reset",
      inputMode: "metadata+source",
      skipped: false,
    }),
  });

  return {
    ...reconciliation,
    seedWrites: candidateStorage.seedWrites,
    candidateGeminiRequests: candidateGeminiCalls,
    candidateResultWrites: candidateStorage.candidateResultWrites,
    nextRetryAt: candidateStorage.rows[0]?.nextRetryAt ?? null,
  };
}

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

test("mode off does not read or write the candidate table", async () => {
  const result = await reconcileWithCandidateFixtures({
    mode: "off",
    eligibleNotices: [notice("notice-1")],
  });
  assert.equal(result.seedWrites, 0);
  assert.equal(result.candidateGeminiRequests, 0);
});

test("candidate-only work never invalidates the public radar cache", async () => {
  const result = await reconcileWithCandidateFixtures({
    mode: "full",
    eligibleNotices: [notice("notice-1")],
    maxGeminiRequests: 1,
  });
  assert.equal(result.invalidated, false);
});

test("a resolver-created key is not promoted without persisted authoritative evidence", async () => {
  const evidence = collectPersistedAuthoritativeCandidateExecutionEvidence([], []);
  assert.deepEqual(evidence, []);
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
    existingCandidates: [candidate("notice-1", {
      aiStatus: "rate_limited",
      nextRetryAt: "2026-09-09T01:00:00.000Z",
    })],
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

test("missing seed discovery uses exact IDs and the persisted cutoff", () => {
  const seeds = discoverMissingResetDisplayNameCandidateSeeds(
    [notice("notice-1", { tweetCreatedAt: "2026-09-08T00:00:00.000Z" })],
    [],
    { mode: "seed", adoptionAt: "2026-09-01T00:00:00.000Z" },
  );
  assert.deepEqual(seeds.map((seed) => seed.officialNoticeTweetId), ["notice-1"]);
  assert.equal(seeds[0]?.logicalPostId, null);
});

test("authoritative evidence comes only from formal adoption and monitor usage estimates", () => {
  const ledgers = [{ resetEventKey: "formal-1" }] as TiboFormalAdoptionRecord[];
  const estimates = [{
    resetEventKey: "estimate-1",
    executionTimeSource: "usage_observation",
    recoveryObservationId: "observation-1",
  }] as ResetExecutionEstimate[];
  assert.deepEqual(
    collectPersistedAuthoritativeCandidateExecutionEvidence(ledgers, estimates),
    [
      { resetEventKey: "formal-1", kind: "formal_adoption" },
      { resetEventKey: "estimate-1", kind: "monitor_usage_estimate" },
    ],
  );
});
