import assert from "node:assert/strict";
import test from "node:test";

import {
  promoteResetDisplayNameCandidate,
  type PromoteResetDisplayNameCandidateInput,
  type ResetDisplayNameCandidateStoreClient,
} from "../lib/radar/resetDisplayNameCandidateStore";
import type { ResetDisplayNameCandidateRecord } from "../lib/radar/resetDisplayNameCandidateTypes";

const CANDIDATE_ID = "candidate-1";
const CREATED_AT = "2026-09-08T00:00:00.000Z";

function acceptedCandidate(
  overrides: Partial<ResetDisplayNameCandidateRecord> = {},
): ResetDisplayNameCandidateRecord {
  return {
    candidateId: CANDIDATE_ID,
    noticeDedupeKey: "official-notice:notice-1",
    officialNoticeTweetId: "notice-1",
    logicalPostId: "logical-1",
    noticeTweetIds: ["notice-1"],
    sourceTweetIds: ["notice-1"],
    sourceSnapshotHash: "source-hash",
    inputHash: "notice-input-hash",
    aiNameJa: "Astra記念リセット",
    aiNameEn: "Astra Celebration Reset",
    aiNameZh: "Astra纪念重置",
    aiConfidence: null,
    aiEvidence: null,
    aiReason: "notice-based accepted name",
    aiFlags: [],
    aiModel: "gemini-3.5-flash-lite",
    aiPromptVersion: "random-reset-name-v3",
    aiInputMode: "notice-precompute-v1",
    aiStatus: "accepted",
    lifecycleStatus: "provisional",
    generationAttempts: 1,
    lastGeneratedAt: CREATED_AT,
    promotedEventKey: null,
    promotedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    nextRetryAt: null,
    ...overrides,
  };
}

function promotionInput(canonicalEventKey: string): PromoteResetDisplayNameCandidateInput {
  return {
    candidateId: CANDIDATE_ID,
    canonicalEventKey,
    canonicalSourceTweetId: "notice-1",
    promotedAt: "2026-09-09T00:00:00.000Z",
    identityResolution: {
      status: "existing",
      resetEventKey: canonicalEventKey,
      matchedEvidenceEventKey: canonicalEventKey,
    },
    authoritativeEvidence: [{
      resetEventKey: canonicalEventKey,
      kind: "formal_adoption",
    }],
  };
}

type FakePromotionClient = ResetDisplayNameCandidateStoreClient & {
  candidate: ResetDisplayNameCandidateRecord;
  canonicalWrites: number;
  rpcCalls: number;
};

function fakePromotionClient(
  candidate: ResetDisplayNameCandidateRecord,
  options: { canonicalNameState?: "missing" | "manual" | "accepted" } = {},
): FakePromotionClient {
  let canonicalEventKey: string | null = candidate.promotedEventKey;
  const client = {
    candidate,
    canonicalWrites: 0,
    rpcCalls: 0,
    rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "promote_reset_display_name_candidate");
      this.rpcCalls += 1;
      const requestedKey = args.p_canonical_event_key;
      if (typeof requestedKey !== "string") {
        return Promise.resolve({ data: null, error: new Error("invalid key") });
      }
      if (canonicalEventKey && canonicalEventKey !== requestedKey) {
        return Promise.resolve({
          data: { status: "conflict", canonicalWrite: false, canonicalEventKey },
          error: null,
        });
      }
      if (canonicalEventKey === requestedKey) {
        return Promise.resolve({
          data: { status: "already_promoted", canonicalWrite: false, canonicalEventKey },
          error: null,
        });
      }
      if (this.candidate.aiStatus !== "accepted") {
        return Promise.resolve({
          data: { status: "not_accepted", canonicalWrite: false, canonicalEventKey: null },
          error: null,
        });
      }
      canonicalEventKey = requestedKey;
      this.candidate.promotedEventKey = requestedKey;
      this.candidate.promotedAt = String(args.p_promoted_at);
      this.candidate.lifecycleStatus = "promoted";
      if (options.canonicalNameState === "missing") this.canonicalWrites += 1;
      return Promise.resolve({
        data: {
          status: options.canonicalNameState === "missing" ? "promoted" : "reused",
          canonicalWrite: options.canonicalNameState === "missing",
          canonicalEventKey: requestedKey,
        },
        error: null,
      });
    },
    from() {
      throw new Error("promotion wrapper should use the atomic RPC");
    },
  } as FakePromotionClient;
  return client;
}

test("promotion is idempotent and never changes the candidate identity", async () => {
  const client = fakePromotionClient(acceptedCandidate(), { canonicalNameState: "missing" });
  const input = promotionInput("canonical-event-1");
  const first = await promoteResetDisplayNameCandidate(client, input);
  const second = await promoteResetDisplayNameCandidate(client, input);
  assert.equal(first.status, "promoted");
  assert.equal(second.status, "already_promoted");
  assert.equal(client.canonicalWrites, 1);
  assert.equal(client.candidate.candidateId, input.candidateId);
});
test("a different canonical key after promotion is a conflict", async () => {
  const client = fakePromotionClient(acceptedCandidate({ promotedEventKey: "canonical-event-1" }));
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
  const client = fakePromotionClient(acceptedCandidate(), { canonicalNameState: "missing" });
  const result = await promoteResetDisplayNameCandidate(client, promotionInput("canonical-event-1"));
  assert.equal(result.status, "promoted");
  assert.equal(client.rpcCalls, 1);
});

test("a candidate without accepted names is not promoted", async () => {
  const client = fakePromotionClient(acceptedCandidate({ aiStatus: "null", aiNameJa: null }));
  const result = await promoteResetDisplayNameCandidate(client, promotionInput("canonical-event-1"));
  assert.equal(result.status, "not_accepted");
  assert.equal(client.rpcCalls, 1);
  assert.equal(client.canonicalWrites, 0);
});

test("manual or existing accepted canonical names are reused without replacement", async () => {
  const client = fakePromotionClient(acceptedCandidate(), { canonicalNameState: "accepted" });
  const result = await promoteResetDisplayNameCandidate(client, promotionInput("canonical-event-1"));
  assert.equal(result.status, "reused");
  assert.equal(result.canonicalWrite, false);
  assert.equal(client.canonicalWrites, 0);
});
