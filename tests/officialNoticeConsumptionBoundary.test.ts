import assert from "node:assert/strict";
import test from "node:test";

import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import {
  getActiveOfficialNotice,
  getLocalProbabilityCalculation,
} from "../lib/radar/probability";
import {
  createObservedRegularResetEventRow,
} from "../lib/radar/regularResetSchedule";
import {
  getLastRandomRecoveryResetAt,
  getRecoveryResetEvents,
} from "../lib/radar/recoveryBoundary";

const NOTICE_AT = "2026-09-19T11:59:00.000Z";
const REGULAR_AT = "2026-09-19T12:00:00.000Z";
const CALCULATION_AT = new Date("2026-09-19T12:01:00.000Z");
const FUTURE_EXPIRY = "2026-09-20T12:00:00.000Z";

function regularReset() {
  return createObservedRegularResetEventRow(REGULAR_AT, REGULAR_AT);
}

function unresolvedNotice(id = "unresolved-official-notice") {
  return {
    tweet_id: id,
    text: "A reset is coming soon.",
    tweet_url: `https://x.com/tibo/status/${id}`,
    signal_type: "official_notice" as const,
    confidence: 0.99,
    tweet_created_at: NOTICE_AT,
    expires_at: FUTURE_EXPIRY,
    verification_status: "auto_unverified" as const,
    temporal_resolution_status: "unresolved" as const,
    expected_start_at: null,
    expected_end_at: null,
  };
}

function resolvedNotice(id = "resolved-official-notice") {
  return {
    ...unresolvedNotice(id),
    text: "The reset will land at noon UTC.",
    temporal_resolution_status: "resolved" as const,
    ai_temporal_precision: "exact_time" as const,
    ai_temporal_timezone: "UTC",
    expected_start_at: REGULAR_AT,
    expected_end_at: REGULAR_AT,
  };
}

function deadlineNotice(id = "deadline-official-notice") {
  return {
    ...unresolvedNotice(id),
    text: "The reset will land by noon UTC.",
    temporal_resolution_status: "resolved" as const,
    ai_temporal_precision: "range" as const,
    ai_temporal_timezone: "UTC",
    is_deadline: true,
    expected_start_at: "2026-09-19T11:00:00.000Z",
    expected_end_at: REGULAR_AT,
  };
}

function resetExecuted(id = "random-global-execution") {
  return {
    tweet_id: id,
    text: "I reset usage for everyone.",
    tweet_url: `https://x.com/tibo/status/${id}`,
    signal_type: "reset_executed" as const,
    confidence: 0.98,
    tweet_created_at: REGULAR_AT,
    verification_status: "confirmed" as const,
    classification_source: "rule" as const,
    is_reply: false,
  };
}

test("regular-only boundary does not consume a newer unresolved official notice", () => {
  const data = getLocalRadarData({
    calculationNow: CALCULATION_AT,
    activeTiboSignals: [unresolvedNotice()],
    regularResetEvents: [regularReset()],
  });

  assert.equal(
    getActiveOfficialNotice(data, null, CALCULATION_AT)?.id,
    "unresolved-official-notice",
  );
  assert.equal(
    getActiveOfficialNotice(data, new Date(REGULAR_AT), CALCULATION_AT)?.id,
    "unresolved-official-notice",
  );
  assert.equal(
    getRadarViewModel(data, "ja", false, undefined, CALCULATION_AT).activeWindow.kind,
    "official",
  );
});

test("regular-only boundary does not consume a resolved overlapping notice or its override", () => {
  const data = getLocalRadarData({
    calculationNow: CALCULATION_AT,
    activeTiboSignals: [resolvedNotice()],
    regularResetEvents: [regularReset()],
  });

  const notice = getActiveOfficialNotice(data, null, CALCULATION_AT);
  assert.equal(notice?.id, "resolved-official-notice");
  const calculation = getLocalProbabilityCalculation(data, { now: CALCULATION_AT });
  assert.equal(calculation.breakdown.officialNoticeOverride.active, true);
  assert.equal(calculation.probability24h, 0.9);
  assert.equal(calculation.probability48h, 0.96);
});

test("a canonical random/global execution still consumes the same official notice", () => {
  const data = getLocalRadarData({
    calculationNow: CALCULATION_AT,
    activeTiboSignals: [unresolvedNotice()],
    formalTiboResets: [resetExecuted()],
    regularResetEvents: [regularReset()],
  });

  assert.equal(getActiveOfficialNotice(data, null, CALCULATION_AT), null);
  assert.equal(
    getLastRandomRecoveryResetAt(data, CALCULATION_AT, []),
    REGULAR_AT,
  );
});

test("regular-only boundary does not consume a deadline notice during grace", () => {
  const data = getLocalRadarData({
    calculationNow: CALCULATION_AT,
    activeTiboSignals: [deadlineNotice()],
    regularResetEvents: [regularReset()],
  });

  assert.equal(
    getActiveOfficialNotice(data, null, CALCULATION_AT)?.id,
    "deadline-official-notice",
  );
});

test("a random/global execution consumes a deadline notice during grace", () => {
  const data = getLocalRadarData({
    calculationNow: CALCULATION_AT,
    activeTiboSignals: [deadlineNotice()],
    formalTiboResets: [resetExecuted()],
    regularResetEvents: [regularReset()],
  });

  assert.equal(getActiveOfficialNotice(data, null, CALCULATION_AT), null);
});

test("regular boundary remains regular-only for history and random eligibility", () => {
  const data = getLocalRadarData({
    calculationNow: CALCULATION_AT,
    regularResetEvents: [regularReset()],
  });
  const boundaries = getRecoveryResetEvents(data, CALCULATION_AT, []);

  assert.equal(boundaries.at(-1)?.isRegular, true);
  assert.equal(boundaries.at(-1)?.isRandom, false);
  assert.equal(getLastRandomRecoveryResetAt(data, CALCULATION_AT, []), null);
});

test("an unrelated BANKED distribution does not consume an active forced reset notice", () => {
  const bankedAt = "2026-09-19T12:00:00.000Z";
  const bankedDistributionEvent = {
    id: "banked-event-1",
    recordKind: "banked_distribution" as const,
    completed_at: bankedAt,
    closed_at: bankedAt,
    status: "completed",
    details: {
      cycleType: "ランダムリセット" as const,
      resetMethod: "任意リセット権配布" as const,
      scope: "全有料プラン",
    },
  };
  const data = getLocalRadarData({
    calculationNow: CALCULATION_AT,
    activeTiboSignals: [resolvedNotice("forced-notice-1")],
    formalTiboResets: [bankedDistributionEvent as any],
  });

  const notice = getActiveOfficialNotice(data, null, CALCULATION_AT);
  assert.equal(notice?.id, "forced-notice-1");
});

test("observation 1h past notice deadline matches the official notice via grace period", () => {
  const deadlineEnd = "2026-09-19T07:00:00.000Z"; // 16:00 JST
  const observedAt = new Date("2026-09-19T08:00:00.000Z"); // 17:00 JST (1h past deadline)
  const notice = {
    tweet_id: "deadline-notice-1600",
    text: "Reset will land by 4pm JST.",
    tweet_url: "https://x.com/tibo/status/deadline-notice-1600",
    signal_type: "official_notice" as const,
    confidence: 0.99,
    tweet_created_at: "2026-09-19T02:00:00.000Z",
    verification_status: "confirmed" as const,
    temporal_resolution_status: "resolved" as const,
    ai_temporal_precision: "range" as const,
    expected_start_at: "2026-09-19T02:00:00.000Z",
    expected_end_at: deadlineEnd,
  };
  const executionWindow = {
    executionWindowStartAt: "2026-09-19T07:55:00.000Z",
    executionWindowEndAt: "2026-09-19T08:00:00.000Z",
  };
  const data = getLocalRadarData({
    calculationNow: observedAt,
    activeTiboSignals: [notice],
  });

  const matched = getActiveOfficialNotice(
    data,
    null,
    observedAt,
    undefined,
    executionWindow,
    true, // requireExecutionWindowMatch
  );
  assert.equal(matched?.id, "deadline-notice-1600");
});
