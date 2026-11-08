import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REGULAR_RESET_SCHEDULE,
  createObservedRegularResetEventRow,
  getLatestRegularScheduleAnchorAt as getLatestAnchorFromEvents,
  getDueRegularResetReferenceEvents,
  toRegularResetHistoryEvent,
} from "../lib/radar/regularResetSchedule";
import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import {
  getLastGlobalResetAt,
  getLastResetBoundaryAt,
} from "../lib/radar/probability";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";

const INITIAL_ANCHOR_AT = "2026-08-08T03:32:00.000Z";
const FORCED_RESET_AT = "2026-08-13T03:34:43.341Z";

function resetEvent(
  at: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `reset-${at}`,
    recordKind: "confirmed_global" as const,
    status: "closed",
    closed_at: at,
    completed_at: at,
    scope: "全有料プラン",
    details: {
      cycleType: "ランダムリセット",
      reasonType: "ランダムリセット",
      resetMethod: "強制リセット",
      scope: "全有料プラン",
      noticeToExecution: "0分",
      ...((overrides.details as Record<string, unknown> | undefined) ?? {}),
    },
    ...overrides,
  };
}

function regularEvent(at: string, overrides: Record<string, unknown> = {}) {
  return resetEvent(at, {
    recordKind: "regular_completed",
    details: {
      cycleType: "定期リセット",
      reasonType: "定期更新",
      resetMethod: "強制リセット",
      scope: "任意リセット未使用アカウント",
      noticeToExecution: "0分（定期）",
    },
    scope: "任意リセット未使用アカウント",
    ...overrides,
  });
}

test("does not project the next regular reference before its anchored weekly boundary", () => {
  const references = getDueRegularResetReferenceEvents(
    new Date("2026-08-15T03:31:59.000Z"),
    INITIAL_ANCHOR_AT,
  );

  assert.deepEqual(references, []);
  assert.deepEqual(
    getDueRegularResetReferenceEvents(new Date("2026-08-15T03:32:00.000Z"), null),
    [],
  );
});

test("projects one reference seven days after the latest anchor without claiming completion", () => {
  const references = getDueRegularResetReferenceEvents(
    new Date("2026-08-15T03:32:00.000Z"),
    INITIAL_ANCHOR_AT,
  );

  assert.equal(references.length, 1);
  assert.equal(references[0].date, "2026-08-15T03:32:00.000Z");
  assert.equal(references[0].recordKind, "reference");
  assert.equal(references[0].status, "scheduled");
  assert.equal(references[0].completed_at, null);
  assert.equal(references[0].closed_at, null);
  assert.equal(references[0].details?.cycleType, "定期リセット");
  assert.equal(references[0].scope, "任意リセット未使用アカウント");
});

test("an observed regular recovery uses the monitor observation time, not the schedule time", () => {
  const row = createObservedRegularResetEventRow(
    "2026-08-20T03:34:43.341Z",
    "2026-08-20T03:40:00.000Z",
  );

  assert.equal(row.scheduled_at, "2026-08-20T03:34:43.341Z");
  assert.equal(row.completed_at, "2026-08-20T03:40:00.000Z");
  assert.notEqual(row.completed_at, row.scheduled_at);
  assert.equal(row.status, "completed");
});

test("generates each missed weekly reference with a stable id", () => {
  const references = getDueRegularResetReferenceEvents(
    new Date("2026-08-22T03:32:00.000Z"),
    INITIAL_ANCHOR_AT,
  );

  assert.deepEqual(
    references.map((event) => event.date),
    [
      "2026-08-15T03:32:00.000Z",
      "2026-08-22T03:32:00.000Z",
    ],
  );
  assert.deepEqual(
    references,
    getDueRegularResetReferenceEvents(
      new Date("2026-08-22T03:32:00.000Z"),
      INITIAL_ANCHOR_AT,
    ),
  );
  assert.equal(new Set(references.map((event) => event.id)).size, references.length);
});

test("a weekly Banked Reset reference remains a reference, not a random reset", () => {
  const references = getDueRegularResetReferenceEvents(new Date("2026-08-15T03:32:00.000Z"), INITIAL_ANCHOR_AT, {
    ...DEFAULT_REGULAR_RESET_SCHEDULE,
    reset_method: "任意リセット権配布",
    scope: "全有料プラン",
  });

  const history = references[0];
  assert.equal(history.recordKind, "reference");
  assert.equal(history.details?.cycleType, "定期リセット");
  assert.equal(history.details?.resetMethod, "任意リセット権配布");
  assert.equal(history.scope, "全有料プラン");
  assert.equal(history.details?.scope, "全有料プラン");
});

test("persisted regular reset restarts the elapsed-time boundary without becoming a random target", () => {
  const now = new Date("2026-08-15T05:00:00.000Z");
  const row = createObservedRegularResetEventRow(
    "2026-08-15T03:32:00.000Z",
    "2026-08-15T03:32:00.000Z",
  );
  const data = getLocalRadarData({
    calculationNow: now,
    regularResetEvents: [row],
  });

  assert.equal(getLastResetBoundaryAt(data, now)?.toISOString(), "2026-08-15T03:32:00.000Z");
  assert.notEqual(getLastGlobalResetAt(data, now)?.toISOString(), "2026-08-15T03:32:00.000Z");

  const viewModel = getRadarViewModel(data, "ja", false, undefined, now);
  assert.notEqual(viewModel.regularResetForecast.sourceResetAt, row.completed_at);
  assert.notEqual(viewModel.regularResetForecast.lastCompletedAt, row.completed_at);
});

test("a regular boundary does not consume earlier teaser strength and allows a later teaser", () => {
  const now = new Date("2026-08-15T05:00:00.000Z");
  const row = createObservedRegularResetEventRow(
    "2026-08-15T03:32:00.000Z",
    "2026-08-15T03:32:00.000Z",
  );
  const baseSignal = {
    tweet_id: "regular-boundary-teaser",
    signal_type: "irrelevant" as const,
    text: "A possible reset",
    tweet_url: "https://x.com/thsottiaux/status/regular-boundary-teaser",
    tweet_created_at: "2026-08-15T03:20:00.000Z",
    verification_status: "auto_unverified" as const,
    teaser_strength: "strong" as const,
    status: "active",
    expectation: "",
    action: "",
  };

  const beforeBoundary = getLocalRadarData({
    calculationNow: now,
    regularResetEvents: [row],
    recentTiboSignals: [baseSignal],
  });
  const beforeSnapshot = toPublicRadarSnapshot(beforeBoundary, "ja", { calculationNow: now });
  assert.equal(beforeSnapshot.resetTeaserStatus, "strong");
  assert.equal(beforeSnapshot.latestTiboActivity?.text, "A possible reset");

  const afterBoundary = getLocalRadarData({
    calculationNow: now,
    regularResetEvents: [row],
    recentTiboSignals: [{ ...baseSignal, tweet_created_at: "2026-08-15T04:00:00.000Z" }],
  });
  assert.equal(
    toPublicRadarSnapshot(afterBoundary, "ja", { calculationNow: now }).resetTeaserStatus,
    "strong",
  );
});

test("uses the latest broad forced reset as the new schedule anchor", () => {
  assert.equal(
    getLatestAnchorFromEvents([
      regularEvent(INITIAL_ANCHOR_AT),
      resetEvent(FORCED_RESET_AT),
    ], new Date("2026-08-20T00:00:00.000Z")),
    FORCED_RESET_AT,
  );

  assert.deepEqual(
    getDueRegularResetReferenceEvents(
      new Date("2026-08-20T03:34:43.340Z"),
      FORCED_RESET_AT,
    ),
    [],
  );
  assert.deepEqual(
    getDueRegularResetReferenceEvents(
      new Date("2026-08-20T03:34:43.341Z"),
      FORCED_RESET_AT,
    ).map((event) => event.date),
    ["2026-08-20T03:34:43.341Z"],
  );
});

test("a later forced reset re-anchors the following regular occurrence", () => {
  const laterForcedAt = "2026-08-18T10:00:00.000Z";
  assert.deepEqual(
    getDueRegularResetReferenceEvents(
      new Date("2026-08-25T10:00:00.000Z"),
      laterForcedAt,
    ).map((event) => event.date),
    ["2026-08-25T10:00:00.000Z"],
  );
});

test("excludes banked, narrow, voided, and future reset candidates", () => {
  const now = new Date("2026-08-20T00:00:00.000Z");
  assert.equal(
    getLatestAnchorFromEvents([
      resetEvent("2026-08-10T00:00:00.000Z", {
        recordKind: "banked_distribution",
        details: { resetMethod: "任意リセット権配布" },
      }),
    ], now),
    null,
  );
  assert.equal(
    getLatestAnchorFromEvents([
      resetEvent("2026-08-11T00:00:00.000Z", { scope: "一部ユーザー" }),
    ], now),
    null,
  );
  assert.equal(
    getLatestAnchorFromEvents([
      resetEvent("2026-08-12T00:00:00.000Z", { status: "voided" }),
    ], now),
    null,
  );
  assert.equal(
    getLatestAnchorFromEvents([
      resetEvent("2026-08-21T00:00:00.000Z"),
    ], now),
    null,
  );
});

test("does not use a legacy regular banked distribution as a schedule anchor", () => {
  const legacyBankedDistribution = resetEvent("2026-06-12T00:11:00.000Z", {
    recordKind: "banked_distribution",
    scope: "全有料プラン",
    details: {
      cycleType: "定期リセット",
      resetMethod: "任意リセット権配布",
      scope: "全有料プラン",
    },
  });

  assert.equal(
    getLatestAnchorFromEvents(
      [legacyBankedDistribution],
      new Date("2026-06-13T00:00:00.000Z"),
    ),
    null,
  );
});

test("personal regular_completed rows never become shared weekly schedule anchors", () => {
  assert.equal(
    getLatestAnchorFromEvents([
      regularEvent(INITIAL_ANCHOR_AT, {
        details: { resetMethod: "任意リセット権配布" },
      }),
    ], new Date("2026-08-15T00:00:00.000Z")),
    null,
  );
});

test("the shared weekly reference follows the last global forced reset, not personal or BANKED events", () => {
  const globalAnchorAt = "2026-10-28T06:35:40.653Z";
  const personalRecovery = toRegularResetHistoryEvent(
    createObservedRegularResetEventRow(
      "2026-11-08T00:54:47.000Z",
      "2026-11-08T00:54:50.259Z",
    ),
  );
  const bankedGrants = [
    resetEvent("2026-11-01T08:00:00.000Z", {
      recordKind: "banked_distribution",
      details: { cycleType: "ランダムリセット", resetMethod: "任意リセット権配布" },
    }),
    resetEvent("2026-11-02T08:00:00.000Z", {
      recordKind: "banked_distribution",
      details: { cycleType: "ランダムリセット", resetMethod: "任意リセット権配布" },
    }),
  ];
  const events = [resetEvent(globalAnchorAt), ...bankedGrants, personalRecovery];

  assert.equal(
    getLatestAnchorFromEvents(events, new Date("2026-11-08T02:00:00.000Z")),
    globalAnchorAt,
  );

  const references = getDueRegularResetReferenceEvents(
    new Date("2026-11-08T02:00:00.000Z"),
    globalAnchorAt,
  );
  assert.deepEqual(references.map((event) => event.date), [
    "2026-11-04T06:35:40.653Z",
  ]);
  assert.equal(references[0].recordKind, "reference");
  assert.equal(references[0].status, "scheduled");
  assert.equal(references[0].closed_at, null);
  assert.equal(references[0].completed_at, null);

  const laterGlobalAnchorAt = "2026-11-09T06:35:40.653Z";
  assert.deepEqual(
    getDueRegularResetReferenceEvents(
      new Date("2026-11-17T00:00:00.000Z"),
      laterGlobalAnchorAt,
    ).map((event) => event.date),
    ["2026-11-16T06:35:40.653Z"],
  );
});

test("uses the canonical completed timestamp rather than an older completion hint", () => {
  const canonicalAt = "2026-08-13T03:34:43.341Z";
  assert.equal(
    getLatestAnchorFromEvents([
      resetEvent(canonicalAt, { completed_at: "2026-08-13T03:00:00.000Z" }),
    ], new Date("2026-08-14T00:00:00.000Z")),
    canonicalAt,
  );
});

test("does not regenerate the old fixed 2026-08-22 occurrence after a 2026-08-13 anchor", () => {
  assert.deepEqual(
    getDueRegularResetReferenceEvents(
      new Date("2026-08-22T03:32:00.000Z"),
      FORCED_RESET_AT,
    ).map((event) => event.date),
    ["2026-08-20T03:34:43.341Z"],
  );
});
