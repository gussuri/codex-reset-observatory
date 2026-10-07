import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionResetDisplayNameCandidateLifecycle,
  getResetDisplayNameCandidateDedupeKey,
  isCandidatePromotionAuthorized,
  isExecutionBearingResetDisplayNameNotice,
} from "../lib/radar/resetDisplayNameCandidateTypes";

test("trusted logical post identity wins over the notice tweet fallback", () => {
  assert.equal(
    getResetDisplayNameCandidateDedupeKey({
      officialNoticeTweetId: "tweet-1",
      logicalPostId: "logical-1",
    }),
    "logical-post:logical-1",
  );
});

test("blank official notice identity is rejected", () => {
  assert.equal(
    getResetDisplayNameCandidateDedupeKey({ officialNoticeTweetId: "  ", logicalPostId: null }),
    null,
  );
});

test("candidate identity falls back to the official notice tweet", () => {
  assert.equal(
    getResetDisplayNameCandidateDedupeKey({ officialNoticeTweetId: "tweet-1", logicalPostId: "  " }),
    "official-notice:tweet-1",
  );
});

test("promotion is terminal and cannot transition to superseded", () => {
  assert.equal(
    canTransitionResetDisplayNameCandidateLifecycle("promoted", "superseded"),
    false,
  );
});

test("provisional candidates can transition to each terminal lifecycle", () => {
  assert.equal(canTransitionResetDisplayNameCandidateLifecycle("provisional", "provisional"), true);
  assert.equal(canTransitionResetDisplayNameCandidateLifecycle("provisional", "promoted"), true);
  assert.equal(canTransitionResetDisplayNameCandidateLifecycle("provisional", "superseded"), true);
  assert.equal(canTransitionResetDisplayNameCandidateLifecycle("provisional", "expired"), true);
});

test("a resolver-created key without persisted execution evidence is not promotable", () => {
  assert.equal(
    isCandidatePromotionAuthorized(
      { status: "new", resetEventKey: "tibo-reset-new", matchedEvidenceEventKey: null },
      [],
      { candidateEventKind: "reset_execution", officialNoticeTweetId: "notice-1" },
    ),
    false,
  );
});

test("promotion requires matching persisted authoritative execution evidence", () => {
  const resolution = {
    status: "existing" as const,
    resetEventKey: "tibo-reset-existing",
    matchedEvidenceEventKey: "tibo-reset-existing",
  };
  const target = { candidateEventKind: "reset_execution" as const, officialNoticeTweetId: "notice-1" };
  assert.equal(isCandidatePromotionAuthorized(resolution, [], target), false);
  assert.equal(
    isCandidatePromotionAuthorized(resolution, [
      { resetEventKey: "tibo-reset-other", kind: "formal_adoption" },
    ], target),
    false,
  );
  assert.equal(
    isCandidatePromotionAuthorized(resolution, [
      { resetEventKey: "tibo-reset-existing", kind: "formal_adoption" },
    ], target),
    true,
  );
});

test("BANKED estimate promotion evidence must name the exact candidate notice", () => {
  const resolution = {
    status: "existing" as const,
    resetEventKey: "banked-reset-notice-1",
    matchedEvidenceEventKey: "banked-reset-notice-1",
  };
  const evidence = [{
    resetEventKey: "banked-reset-notice-1",
    kind: "banked_distribution_estimate" as const,
    officialNoticeTweetId: "notice-1",
  }];

  assert.equal(isCandidatePromotionAuthorized(resolution, evidence, {
    candidateEventKind: "banked_distribution",
    officialNoticeTweetId: "notice-1",
  }), true);
  assert.equal(isCandidatePromotionAuthorized(resolution, evidence, {
    candidateEventKind: "banked_distribution",
    officialNoticeTweetId: "notice-2",
  }), false);
  assert.equal(isCandidatePromotionAuthorized(resolution, evidence, {
    candidateEventKind: "reset_execution",
    officialNoticeTweetId: "notice-1",
  }), false);
  assert.equal(isCandidatePromotionAuthorized({ ...resolution, status: "conflict" }, evidence, {
    candidateEventKind: "banked_distribution",
    officialNoticeTweetId: "notice-1",
  }), false);
});

test("a confirmed official notice promising broad BANKED delivery can seed a provisional name candidate", () => {
  assert.equal(
    isExecutionBearingResetDisplayNameNotice({
      signalType: "official_notice",
      verificationStatus: "confirmed",
      isReply: false,
      isHistoricalOnly: false,
      isPresentationOnlyOngoingBanked: false,
      hasFutureBankedDistributionIntent: true,
    }),
    true,
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

test("the shared notice predicate accepts a final official notice", () => {
  assert.equal(
    isExecutionBearingResetDisplayNameNotice({
      signalType: "official_notice",
      verificationStatus: "confirmed",
      isReply: false,
      isHistoricalOnly: false,
      isPresentationOnlyOngoingBanked: false,
      hasFutureBankedDistributionIntent: false,
    }),
    true,
  );
});
