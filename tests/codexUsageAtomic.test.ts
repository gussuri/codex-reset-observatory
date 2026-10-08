import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCodexUsageBankedAssociation,
  buildCodexUsageAtomicWritePlan,
  buildResetExecutionEstimateWrite,
} from "../lib/codexUsageAtomic";
import { buildBankedGrantAssociationWrite, buildBankedGrantObservationWrite } from "../lib/codexUsageBankedGrant";
import { matchBankedObservationToPosts } from "../lib/radar/resetPostAssociation";

const previousState = {
  sourceKey: "local-codex-app-server",
  observedAt: "2026-08-30T00:00:00.000Z",
  receivedAt: "2026-08-30T00:00:01.000Z",
  limitId: "codex",
  planType: "plus",
  usedPercent: 100,
  windowDurationMins: 10080,
  resetsAt: 1_788_000_000,
  coverageStartedAt: "2026-08-29T23:55:00.000Z",
  bankedResetAvailableCount: 0,
  lastBankedGrantAt: null,
};

const snapshot = {
  observedAt: "2026-08-30T00:04:00.000Z",
  limitId: "codex" as const,
  planType: "plus",
  usedPercent: 0,
  windowDurationMins: 10080 as const,
  resetsAt: 1_788_604_800,
  bankedResetAvailableCount: 1,
};

const observation = {
  sourceKey: "local-codex-app-server",
  observedAt: snapshot.observedAt,
  previousObservedAt: previousState.observedAt,
  previousUsedPercent: 100,
  currentUsedPercent: 0,
  previousResetsAt: previousState.resetsAt,
  currentResetsAt: snapshot.resetsAt,
  cycleHint: "unexpected" as const,
  confidence: "strong" as const,
  status: "observed" as const,
  matchedTiboTweetId: null,
  confirmedAt: null,
};

test("builds one atomic plan for all related webhook writes", () => {
  const estimate = buildResetExecutionEstimateWrite({
    resetEventKey: "usage-reset-pending",
    displayExecutionAt: snapshot.observedAt,
    executionTimeSource: "usage_observation",
    executionTimeConfidence: "high",
    executionTimePrecision: "approximate",
    executionWindowStartAt: previousState.observedAt,
    executionWindowEndAt: snapshot.observedAt,
    recoveryObservationId: null,
    recoveryPreviousObservedAt: previousState.observedAt,
    recoveryObservedAt: snapshot.observedAt,
    tiboAnnouncedAt: null,
    tiboPrimaryTweetId: null,
    tiboSourceTweetIds: [],
    officialNoticeTweetId: null,
    officialNoticeAt: null,
    estimatorVersion: "usage-execution-monitor-v1",
    manualOverrideAt: null,
    manualOverrideBy: null,
    manualOverrideReason: null,
    manualExecutionAt: null,
    manualExecutionPrecision: null,
  }, { monitorObserved: true });

  const plan = buildCodexUsageAtomicWritePlan({
    expectedPreviousObservedAt: previousState.observedAt,
    snapshot,
    receivedAt: "2026-08-30T00:04:01.000Z",
    previousState,
    observation,
    regularReset: {
      scheduledAt: "2026-08-30T00:00:00.000Z",
      completedAt: snapshot.observedAt,
    },
    executionEstimate: estimate,
    bankedDistribution: {
      resetEventKey: "banked-reset-notice",
      displayExecutionAt: snapshot.observedAt,
      tiboAnnouncedAt: "2026-08-29T23:00:00.000Z",
      tiboPrimaryTweetId: "banked-notice",
      tiboSourceTweetIds: ["banked-notice"],
      officialNoticeTweetId: "banked-notice",
      officialNoticeAt: "2026-08-29T23:00:00.000Z",
    },
    promotion: {
      tweetId: "deferred-reset",
      confidence: 0.98,
    },
  });

  assert.equal(plan.expected_previous_observed_at, previousState.observedAt);
  assert.equal(plan.observation?.observed_at, snapshot.observedAt);
  assert.equal(plan.regular_reset_event?.completed_at, snapshot.observedAt);
  assert.equal(plan.execution_estimate?.reset_event_key, "usage-reset-pending");
  assert.equal(plan.execution_estimate?.is_monitor_observed, true);
  assert.equal(plan.banked_distribution_estimate?.reset_event_key, "banked-reset-notice");
  assert.equal(plan.promotion?.tweet_id, "deferred-reset");
  assert.equal(plan.state.observed_at, snapshot.observedAt);
});

test("association RPC exposes whether public publication changed for scoped cache invalidation", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return { data: { status: "accepted", publication_changed: true }, error: null };
    },
  } as never;
  const matcherObservation = {
    observationKey: "banked-fact:exact",
    resetEventKey: "banked-reset-exact",
    sourceKey: "local-codex-app-server",
    limitId: "codex",
    planType: "plus",
    previousObservedAt: previousState.observedAt,
    observedAt: snapshot.observedAt,
    receivedAt: "2026-08-30T00:04:01.000Z",
    previousAvailableCount: 0,
    currentAvailableCount: 1,
  };
  const decision = matchBankedObservationToPosts(matcherObservation, []);
  const associationWrite = buildBankedGrantAssociationWrite(decision, "2026-08-30T00:05:00.000Z", 3);

  const result = await applyCodexUsageBankedAssociation(client, associationWrite, null);

  assert.equal(rpcCalls[0]?.name, "record_banked_grant_association_decision");
  assert.equal(((rpcCalls[0]?.args.p_decision ?? {}) as Record<string, unknown>).legacy_identity_status, "resolved");
  assert.deepEqual(result, { status: "accepted", publicationChanged: true, error: null });
});

test("does not advance the BANKED grant anchor from protocol baselines or structural rebases", () => {
  for (const postReason of ["initial", "structure_change"] as const) {
    const plan = buildCodexUsageAtomicWritePlan({
      expectedPreviousObservedAt: previousState.observedAt,
      snapshot: {
        ...snapshot,
        monitorProtocolVersion: 2,
        postReason,
        bankedResetCountChange: true,
      },
      receivedAt: "2026-08-30T00:04:01.000Z",
      previousState,
    });

    assert.equal(plan.banked_grant_observation, undefined);
    assert.equal(plan.state.last_banked_grant_at, null);
  }
});

test("protocol-v2 unknown BANKED count clears the comparison baseline across a later positive reading", () => {
  const unknownObservedAt = "2026-08-30T00:04:00.000Z";
  const unknownPlan = buildCodexUsageAtomicWritePlan({
    expectedPreviousObservedAt: previousState.observedAt,
    snapshot: {
      observedAt: unknownObservedAt,
      limitId: "codex",
      planType: "plus",
      usedPercent: 50,
      windowDurationMins: 10080,
      resetsAt: snapshot.resetsAt,
      monitorProtocolVersion: 2,
      postReason: "heartbeat",
    },
    receivedAt: "2026-08-30T00:04:01.000Z",
    previousState,
  });
  assert.equal(unknownPlan.state.banked_reset_available_count, null);

  const afterUnknownState = {
    ...previousState,
    observedAt: unknownObservedAt,
    bankedResetAvailableCount: unknownPlan.state.banked_reset_available_count,
  };
  const laterPositive = {
    ...snapshot,
    observedAt: "2026-08-30T00:05:00.000Z",
    monitorProtocolVersion: 2,
    postReason: "heartbeat" as const,
  };
  assert.equal(buildBankedGrantObservationWrite({
    previousState: afterUnknownState,
    snapshot: laterPositive,
    receivedAt: "2026-08-30T00:05:01.000Z",
  }), null);
});
