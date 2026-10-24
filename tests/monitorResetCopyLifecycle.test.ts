import assert from "node:assert/strict";
import test from "node:test";

import {
  MONITOR_OBSERVED_RESET_EXECUTION_ESTIMATOR_VERSION,
  RESET_EXECUTION_ESTIMATOR_VERSION,
  type ResetExecutionEstimate,
} from "../lib/radar/resetExecution";
import {
  buildMonitorConfirmedResetCopyContext,
  type MonitorResetCopySourceRow,
} from "../lib/radar/monitorResetCopyLifecycle";
import { createTiboFormalReplyAdmissionProof } from "../lib/radar/tiboFormalReplyAdmission";
import type { CodexRecoveryObservation } from "../lib/codexUsageRecovery";

const OBSERVED_AT = "2026-08-31T00:01:30.000Z";
const CONFIRMED_AT = "2026-08-31T00:02:00.000Z";
const PREVIOUS_AT = "2026-08-31T00:00:30.000Z";
const NOTICE_ID = "2115000000000000201";
const ROOT_ID = "2115000000000000202";
const PARENT_ID = "2115000000000000203";
const REPLY_ID = "2115000000000000204";
const REVISION = "a".repeat(64);

function observation(status: "observed" | "confirmed" = "confirmed"): CodexRecoveryObservation {
  return {
    id: "recovery-copy-lifecycle",
    sourceKey: "local-codex-app-server",
    observedAt: OBSERVED_AT,
    previousObservedAt: PREVIOUS_AT,
    previousUsedPercent: 100,
    currentUsedPercent: 0,
    previousResetsAt: 1788000000,
    currentResetsAt: 1788604800,
    cycleHint: "unexpected",
    confidence: "strong",
    status,
    matchedTiboTweetId: status === "confirmed" ? REPLY_ID : null,
    confirmedAt: status === "confirmed" ? CONFIRMED_AT : null,
    createdAt: OBSERVED_AT,
    updatedAt: CONFIRMED_AT,
  };
}

function estimate(overrides: Partial<ResetExecutionEstimate> = {}): ResetExecutionEstimate {
  return {
    resetEventKey: `tibo-reset-${ROOT_ID}`,
    displayExecutionAt: OBSERVED_AT,
    executionTimeSource: "usage_observation",
    executionTimeConfidence: "high",
    executionTimePrecision: "approximate",
    executionWindowStartAt: PREVIOUS_AT,
    executionWindowEndAt: OBSERVED_AT,
    recoveryObservationId: "recovery-copy-lifecycle",
    recoveryPreviousObservedAt: PREVIOUS_AT,
    recoveryObservedAt: OBSERVED_AT,
    tiboAnnouncedAt: "2026-08-30T23:50:00.000Z",
    tiboPrimaryTweetId: REPLY_ID,
    tiboSourceTweetIds: [NOTICE_ID, ROOT_ID, PARENT_ID, REPLY_ID],
    officialNoticeTweetId: NOTICE_ID,
    officialNoticeAt: "2026-08-30T23:50:00.000Z",
    estimatorVersion: RESET_EXECUTION_ESTIMATOR_VERSION,
    manualOverrideAt: null,
    manualOverrideBy: null,
    manualOverrideReason: null,
    manualExecutionAt: null,
    manualExecutionPrecision: null,
    ...overrides,
  };
}

function signalRow(
  tweetId: string,
  text: string,
  signalType: "official_notice" | "reset_executed",
  createdAt: string,
  overrides: Partial<MonitorResetCopySourceRow> = {},
): MonitorResetCopySourceRow {
  return {
    tweet_id: tweetId,
    text,
    tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
    tweet_created_at: createdAt,
    signal_type: signalType,
    confidence: 0.99,
    verification_status: "confirmed",
    classification_source: "gemini",
    is_reply: false,
    is_quote: false,
    ...overrides,
  };
}

function validReplyRow(): MonitorResetCopySourceRow {
  const text = "Reset is live now.";
  const parentText = "The quota reset applies to all paid users.";
  const rootText = "We will reset usage limits for all paid users.";
  const proof = createTiboFormalReplyAdmissionProof({
    authorText: text,
    isReply: true,
    isQuote: false,
    replyContextText: parentText,
    replyParentTweetId: PARENT_ID,
    replyParentTweetUrl: `https://x.com/thsottiaux/status/${PARENT_ID}`,
    selectedSignalType: "reset_executed",
    temporalDirection: "completed_now",
    evidenceQuote: text,
    contextualResetAssessment: "same_global_reset",
    contextualResetTweetId: ROOT_ID,
    resetMeaning: {
      method: "forced",
      methodEvidence: { tweetId: ROOT_ID, quote: "reset usage limits" },
      scope: "all_paid_users",
      scopeEvidence: { tweetId: ROOT_ID, quote: "all paid users" },
    },
    targetTweetId: REPLY_ID,
    targetTweetUrl: `https://x.com/thsottiaux/status/${REPLY_ID}`,
    targetTweetCreatedAt: "2026-08-31T00:00:00.000Z",
    validatedSourceContext: {
      version: "tibo-evidence-context-v1",
      status: "complete",
      target: {
        tweetId: REPLY_ID,
        tweetUrl: `https://x.com/thsottiaux/status/${REPLY_ID}`,
        authorHandle: "@thsottiaux",
        text,
        createdAt: "2026-08-31T00:00:00.000Z",
        sourceContextRevisionHashes: [REVISION],
      },
      relatedPosts: [
        {
          tweetId: PARENT_ID,
          tweetUrl: `https://x.com/thsottiaux/status/${PARENT_ID}`,
          authorHandle: "@thsottiaux",
          text: parentText,
          createdAt: "2026-08-30T23:55:00.000Z",
        },
        {
          tweetId: ROOT_ID,
          tweetUrl: `https://x.com/thsottiaux/status/${ROOT_ID}`,
          authorHandle: "@thsottiaux",
          text: rootText,
          createdAt: "2026-08-30T23:50:00.000Z",
        },
      ],
      edges: [
        { fromTweetId: REPLY_ID, toTweetId: PARENT_ID, relation: "reply" },
        { fromTweetId: PARENT_ID, toTweetId: ROOT_ID, relation: "reply" },
      ],
      omissions: [],
      lookupCount: 2,
    },
  }, [REVISION], 0);
  assert.ok(proof);
  return signalRow(REPLY_ID, text, "reset_executed", "2026-08-31T00:00:00.000Z", {
    verification_status: "auto_unverified",
    classification_source: "gemini",
    ai_signal_type: "reset_executed",
    ai_confidence: 0.99,
    ai_classification_status: "success",
    ai_temporal_direction: "completed_now",
    ai_evidence_quote: text,
    is_reply: true,
    source_context_revision_hashes: [REVISION],
    source_context_classified_revision_hashes: [REVISION],
    source_context_generation: 0,
    formal_reply_admission_proof: proof,
  });
}

const sourceRows = [
  signalRow(
    NOTICE_ID,
    "We will reset usage limits for all paid users after a quality fix.",
    "official_notice",
    "2026-08-30T23:50:00.000Z",
  ),
  signalRow(
    ROOT_ID,
    "A quality issue has been fixed; reset usage limits for all paid users.",
    "official_notice",
    "2026-08-30T23:51:00.000Z",
  ),
  signalRow(
    PARENT_ID,
    "The forced reset has finished.",
    "reset_executed",
    "2026-08-30T23:58:00.000Z",
  ),
  validReplyRow(),
];

test("monitor-first and Tibo-first evidence order produce one canonical event and fingerprint", () => {
  const estimateA = estimate();
  const estimateB = estimate({ tiboSourceTweetIds: [...estimateA.tiboSourceTweetIds].reverse() });
  const first = buildMonitorConfirmedResetCopyContext({
    estimate: estimateA,
    recoveryObservation: observation(),
    sourceRows,
  });
  const second = buildMonitorConfirmedResetCopyContext({
    estimate: estimateB,
    recoveryObservation: observation(),
    sourceRows: [...sourceRows].reverse(),
  });

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.item.id, second.item.id);
  assert.equal(first.item.completed_at, second.item.completed_at);
  assert.equal(first.item.recoveryObservationId, second.item.recoveryObservationId);
  assert.equal(first.evidence.fingerprint, second.evidence.fingerprint);
  assert.match(first.sourceContext, /\[Tibo notice \| tweet_id=/);
  assert.match(first.sourceContext, /\[Tibo completion \| tweet_id=/);
  assert.match(first.sourceContext, /\[Tibo verified reply completion \| tweet_id=/);
  assert.match(first.sourceContext, /status=confirmed/);
});

test("Day18-style observed monitor recovery is eligible, while invalid observations and stale replies are not", () => {
  const observedRecovery = buildMonitorConfirmedResetCopyContext({
    estimate: estimate(),
    recoveryObservation: observation("observed"),
    sourceRows,
  });
  assert.ok(observedRecovery);
  assert.equal(observedRecovery.evidence.recoveryStatus, "observed");
  assert.equal(observedRecovery.evidence.recoveryConfirmedAt, null);
  assert.equal(observedRecovery.evidence.recoveryMatchedTiboTweetId, null);

  const weakRecovery = buildMonitorConfirmedResetCopyContext({
    estimate: estimate(),
    recoveryObservation: { ...observation("observed"), confidence: "medium" },
    sourceRows,
  });
  const regularRecovery = buildMonitorConfirmedResetCopyContext({
    estimate: estimate(),
    recoveryObservation: { ...observation("observed"), cycleHint: "regular" },
    sourceRows,
  });
  assert.equal(weakRecovery, null);
  assert.equal(regularRecovery, null);

  const staleReply = validReplyRow();
  staleReply.text = "Changed after the reply proof was issued.";
  const ordinaryReply = signalRow(
    "2115000000000000205",
    "The reset is finished.",
    "reset_executed",
    "2026-08-31T00:00:10.000Z",
    { is_reply: true },
  );
  const context = buildMonitorConfirmedResetCopyContext({
    estimate: estimate(),
    recoveryObservation: observation(),
    sourceRows: [...sourceRows.filter((row) => row.tweet_id !== REPLY_ID), staleReply, ordinaryReply],
  });

  assert.ok(context);
  assert.equal(context.sourceContext.includes("Changed after the reply proof was issued."), false);
  assert.equal(context.sourceContext.includes("The reset is finished."), false);
});

test("estimate without a recovery identity cannot authorize final copy", () => {
  const missingRecoveryId = buildMonitorConfirmedResetCopyContext({
    estimate: estimate({ recoveryObservationId: null }),
    recoveryObservation: observation(),
    sourceRows,
  });
  const monitorOnlyWithoutSources = buildMonitorConfirmedResetCopyContext({
    estimate: estimate({
      estimatorVersion: MONITOR_OBSERVED_RESET_EXECUTION_ESTIMATOR_VERSION,
      officialNoticeTweetId: null,
      officialNoticeAt: null,
      tiboPrimaryTweetId: null,
      tiboSourceTweetIds: [],
    }),
    recoveryObservation: observation(),
    sourceRows,
  });

  assert.equal(missingRecoveryId, null);
  assert.equal(monitorOnlyWithoutSources, null);
});

test("multiple monitor-confirmed events keep their source context and fingerprints separate", () => {
  const secondNoticeId = "2115000000000000301";
  const secondCompletionId = "2115000000000000302";
  const secondObservedAt = "2026-09-01T00:01:30.000Z";
  const secondPreviousAt = "2026-09-01T00:00:30.000Z";
  const secondConfirmedAt = "2026-09-01T00:02:00.000Z";
  const secondObservation = {
    ...observation(),
    id: "recovery-copy-lifecycle-second",
    observedAt: secondObservedAt,
    previousObservedAt: secondPreviousAt,
    confirmedAt: secondConfirmedAt,
    createdAt: secondObservedAt,
    updatedAt: secondConfirmedAt,
    matchedTiboTweetId: secondCompletionId,
  };
  const secondEstimate = estimate({
    resetEventKey: `tibo-reset-${secondCompletionId}`,
    displayExecutionAt: secondObservedAt,
    executionWindowStartAt: secondPreviousAt,
    executionWindowEndAt: secondObservedAt,
    recoveryObservationId: secondObservation.id,
    recoveryPreviousObservedAt: secondPreviousAt,
    recoveryObservedAt: secondObservedAt,
    tiboAnnouncedAt: "2026-08-31T23:50:00.000Z",
    tiboPrimaryTweetId: secondCompletionId,
    tiboSourceTweetIds: [secondNoticeId, secondCompletionId],
    officialNoticeTweetId: secondNoticeId,
    officialNoticeAt: "2026-08-31T23:50:00.000Z",
  });
  const secondSources = [
    signalRow(
      secondNoticeId,
      "We will reset usage limits for all paid users after fixing the billing issue.",
      "official_notice",
      "2026-08-31T23:50:00.000Z",
    ),
    signalRow(
      secondCompletionId,
      "The billing issue is fixed and the reset is complete.",
      "reset_executed",
      secondObservedAt,
    ),
  ];
  const allSources = [...sourceRows, ...secondSources];
  const first = buildMonitorConfirmedResetCopyContext({
    estimate: estimate(),
    recoveryObservation: observation(),
    sourceRows: allSources,
  });
  const second = buildMonitorConfirmedResetCopyContext({
    estimate: secondEstimate,
    recoveryObservation: secondObservation,
    sourceRows: allSources,
  });

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.item.id, second.item.id);
  assert.notEqual(first.evidence.fingerprint, second.evidence.fingerprint);
  assert.equal(first.sourceContext.includes(secondNoticeId), false);
  assert.equal(first.sourceContext.includes(secondCompletionId), false);
  assert.equal(second.sourceContext.includes(NOTICE_ID), false);
  assert.equal(second.sourceContext.includes(ROOT_ID), false);
});
