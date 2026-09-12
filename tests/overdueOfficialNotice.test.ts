import assert from "node:assert/strict";
import test from "node:test";
import {
  getTemporalNoticeCoverage,
  hasDeadlineSemantics,
  isOverdueNoticePending,
  isTemporalNoticeConsumedAtReset,
  TIBO_NOTICE_GRACE_MS,
} from "../lib/radar/tiboTemporal";
import { getRadarViewModel } from "../lib/radar";
import { applyOfficialNoticeTimingPolicy } from "../lib/radar/regimeElapsedProbability";
import {
  derive12hFrom24hProbability,
  derive72hFrom48hProbability,
} from "../lib/radar/shadowProbability";
import type { RadarData } from "../lib/radar/types";

const EXPECTED_ISO = "2026-08-13T02:01:37.000Z";
const EXPECTED_TIME = Date.parse(EXPECTED_ISO);

const exactNoticeResolution = {
  status: "resolved" as const,
  temporalPrecision: "exact_time" as const,
  confidence: 0.9,
  expectedStartAt: EXPECTED_ISO,
  expectedEndAt: EXPECTED_ISO,
};

test("A. exact_time before due has full notice coverage (1.0)", () => {
  const now = new Date(EXPECTED_TIME - 60 * 60 * 1000); // 1 hour before
  const coverage24 = getTemporalNoticeCoverage(exactNoticeResolution, now, 24);
  assert.equal(coverage24, 1);
});

test("B. exact_time exactly due has full notice support (1.0)", () => {
  const now = new Date(EXPECTED_TIME);
  const coverage24 = getTemporalNoticeCoverage(exactNoticeResolution, now, 24);
  assert.equal(coverage24, 1);
});

test("C. exact_time 45m overdue has 0.75 grace factor", () => {
  const now = new Date(EXPECTED_TIME + 45 * 60 * 1000);
  const coverage24 = getTemporalNoticeCoverage(exactNoticeResolution, now, 24);
  assert.equal(coverage24, 0.75);
});

test("D. exact_time 90m overdue has 0.50 grace factor", () => {
  const now = new Date(EXPECTED_TIME + 90 * 60 * 1000);
  const coverage24 = getTemporalNoticeCoverage(exactNoticeResolution, now, 24);
  assert.equal(coverage24, 0.5);
});

test("E. exact_time 135m overdue has 0.25 grace factor", () => {
  const now = new Date(EXPECTED_TIME + 135 * 60 * 1000);
  const coverage24 = getTemporalNoticeCoverage(exactNoticeResolution, now, 24);
  assert.equal(coverage24, 0.25);
});

test("F. exact_time at grace expiry (180m) has 0.0 support", () => {
  const now = new Date(EXPECTED_TIME + TIBO_NOTICE_GRACE_MS);
  const coverage24 = getTemporalNoticeCoverage(exactNoticeResolution, now, 24);
  assert.equal(coverage24, 0);
});

test("G. exact_time after grace expiry (>180m) has 0.0 support", () => {
  const now = new Date(EXPECTED_TIME + TIBO_NOTICE_GRACE_MS + 60 * 1000);
  const coverage24 = getTemporalNoticeCoverage(exactNoticeResolution, now, 24);
  assert.equal(coverage24, 0);
});

const nonExactNoticeResolution = {
  status: "resolved" as const,
  temporalPrecision: "day" as const,
  confidence: 0.9,
  expectedStartAt: EXPECTED_ISO,
  expectedEndAt: new Date(EXPECTED_TIME + 60 * 60 * 1000).toISOString(),
};

test("non-exact window just before expected end retains positive coverage", () => {
  const end = Date.parse(nonExactNoticeResolution.expectedEndAt);
  const coverage24 = getTemporalNoticeCoverage(nonExactNoticeResolution, new Date(end - 1), 24);
  assert.equal(coverage24, 0.9);
});

test("non-exact day window ends immediately without the exact-time grace", () => {
  const end = Date.parse(nonExactNoticeResolution.expectedEndAt);
  assert.equal(getTemporalNoticeCoverage(nonExactNoticeResolution, new Date(end), 24), 0);
  assert.equal(getTemporalNoticeCoverage(nonExactNoticeResolution, new Date(end + 30 * 60 * 1000), 24), 0);
});

test("non-exact daypart and range windows end immediately without grace", () => {
  const end = Date.parse(nonExactNoticeResolution.expectedEndAt);
  for (const temporalPrecision of ["daypart", "range"] as const) {
    assert.equal(
      getTemporalNoticeCoverage(
        { ...nonExactNoticeResolution, temporalPrecision },
        new Date(end + 1),
        24,
      ),
      0,
    );
  }
});

test("non-exact coverage does not rise at the window end", () => {
  const end = Date.parse(nonExactNoticeResolution.expectedEndAt);
  const beforeEnd = getTemporalNoticeCoverage(nonExactNoticeResolution, new Date(end - 1), 24);
  const atEnd = getTemporalNoticeCoverage(nonExactNoticeResolution, new Date(end), 24);
  assert.ok(beforeEnd !== null && atEnd !== null && atEnd <= beforeEnd);
});

test("H. reset confirmation ends overdue pending state", () => {
  const overdueNow = new Date(EXPECTED_TIME + 23 * 60 * 1000); // 23 min overdue

  // Unconfirmed reset -> overdue pending is true
  const pendingBefore = isOverdueNoticePending(exactNoticeResolution, null, overdueNow);
  assert.equal(pendingBefore, true);

  // Confirmed reset after expectedStartAt -> overdue pending is false
  const resetAt = new Date(EXPECTED_TIME + 5 * 60 * 1000).toISOString();
  const pendingAfter = isOverdueNoticePending(exactNoticeResolution, resetAt, overdueNow);
  assert.equal(pendingAfter, false);
});

test("I. UI overdue pending presentation for JA, EN, ZH", () => {
  const overdueNow = new Date(EXPECTED_TIME + 23 * 60 * 1000);
  const mockRadarData: RadarData = {
    active_tibo_signals: [
      {
        tweet_id: "2087706104814023111",
        text: "Landing in the next hour or so",
        tweet_created_at: "2026-08-13T01:01:37.000Z",
        signal_type: "official_notice",
        confidence: 0.95,
        ai_signal_type: "official_notice",
        ai_confidence: 0.95,
        ai_temporal_direction: "future",
        ai_notice_to_execution: "in the next hour or so",
        ai_temporal_expression: "in the next hour or so",
        ai_temporal_kind: "relative_duration",
        ai_temporal_precision: "exact_time",
        ai_temporal_timezone: "America/Los_Angeles",
        ai_temporal_confidence: 0.9,
        expected_start_at: EXPECTED_ISO,
        expected_end_at: EXPECTED_ISO,
        temporal_resolution_status: "resolved",
        temporal_resolution_version: "tibo-temporal-v1",
        expires_at: "2026-08-13T04:01:37.000Z",
      } as any,
    ],
  };

  const jaVm = getRadarViewModel(mockRadarData, "ja", false, undefined, overdueNow);
  assert.equal(jaVm.activeWindow.isOverduePending, true);
  assert.equal(jaVm.activeWindow.overdueText, "予定時刻を過ぎています。リセットを確認中です。");

  const enVm = getRadarViewModel(mockRadarData, "en", false, undefined, overdueNow);
  assert.equal(enVm.activeWindow.isOverduePending, true);
  assert.equal(enVm.activeWindow.overdueText, "The expected time has passed. Waiting for reset confirmation.");

  const zhVm = getRadarViewModel(mockRadarData, "zh", false, undefined, overdueNow);
  assert.equal(zhVm.activeWindow.isOverduePending, true);
  assert.equal(zhVm.activeWindow.overdueText, "预计时间已过，正在等待重置确认。");

  // Before expectedAt -> non-overdue
  const beforeNow = new Date(EXPECTED_TIME - 10 * 60 * 1000);
  const beforeVm = getRadarViewModel(mockRadarData, "ja", false, undefined, beforeNow);
  assert.equal(beforeVm.activeWindow.isOverduePending, false);
  assert.equal(beforeVm.activeWindow.overdueText, null);

  // After grace expiry -> notice expired / non-overdue
  const afterGraceNow = new Date(EXPECTED_TIME + TIBO_NOTICE_GRACE_MS + 1000);
  const afterGraceVm = getRadarViewModel(mockRadarData, "ja", false, undefined, afterGraceNow);
  assert.equal(afterGraceVm.activeWindow.isOverduePending, false);
  assert.equal(afterGraceVm.activeWindow.overdueText, null);
});

test("Real August 13 sample overdue behavior", () => {
  const tweetCreatedAt = "2026-08-13T01:01:37.000Z";
  const expectedAt = "2026-08-13T02:01:37.000Z"; // 11:01 JST
  const overdueNow = new Date("2026-08-13T02:24:44.000Z"); // 11:24 JST (~23 min overdue)

  const mockRadarData: RadarData = {
    active_tibo_signals: [
      {
        tweet_id: "2087706104814023111",
        text: "Old news actually from a bunch of days ago, but crossed that 15M. Enjoy a nice reset everyone. Landing in the next hour or so, go /fast.",
        tweet_created_at: tweetCreatedAt,
        signal_type: "official_notice",
        confidence: 0.95,
        ai_signal_type: "official_notice",
        ai_confidence: 0.95,
        ai_temporal_direction: "future",
        ai_notice_to_execution: "in the next hour or so",
        ai_temporal_expression: "in the next hour or so",
        ai_temporal_kind: "relative_duration",
        ai_temporal_precision: "exact_time",
        ai_temporal_timezone: "America/Los_Angeles",
        ai_temporal_confidence: 0.9,
        expected_start_at: expectedAt,
        expected_end_at: expectedAt,
        temporal_resolution_status: "resolved",
        temporal_resolution_version: "tibo-temporal-v1",
        expires_at: "2026-08-13T04:01:37.000Z",
      } as any,
    ],
  };

  const vmOverdue = getRadarViewModel(mockRadarData, "ja", false, undefined, overdueNow);
  const vmBefore = getRadarViewModel(mockRadarData, "ja", false, undefined, new Date("2026-08-13T01:30:00.000Z"));
  const vmWithoutNotice = getRadarViewModel({ active_tibo_signals: [] }, "ja", false, undefined, overdueNow);

  // 1. Notice is active
  assert.equal(vmOverdue.activeWindow.active, true);
  assert.equal(vmOverdue.activeWindow.isOverduePending, true);

  const prob24hOverdue = vmOverdue.probability24h ?? 0;
  const prob24hWithout = vmWithoutNotice.probability24h ?? 0;
  const prob24hBefore = vmBefore.probability24h ?? 0;
  const prob48hOverdue = vmOverdue.probability48h ?? 0;
  const prob48hWithout = vmWithoutNotice.probability48h ?? 0;

  // 2. Overdue probability degrades gracefully, strictly bounded between baseline and full notice
  assert.ok(
    prob24hOverdue > prob24hWithout,
    `Overdue 24h prob (${prob24hOverdue}) should be greater than baseline (${prob24hWithout})`,
  );
  assert.ok(
    prob24hOverdue <= prob24hBefore,
    `Overdue 24h prob (${prob24hOverdue}) should be less than or equal to pre-deadline prob (${prob24hBefore})`,
  );

  assert.ok(
    prob48hOverdue > prob48hWithout,
    `Overdue 48h prob (${prob48hOverdue}) should be greater than baseline (${prob48hWithout})`,
  );
});

test("Real September 12 sample (tweet 2098612714704891959 'by midnight today')", () => {
  const tweetCreatedAt = "2026-09-12T03:20:36.000Z";
  const deadlineAt = "2026-09-12T07:00:00.000Z"; // midnight PT
  const expiresAt = "2026-09-12T10:00:00.000Z"; // deadline + 3h grace

  const deadlineResolution = {
    status: "resolved" as const,
    temporalPrecision: "range" as const,
    confidence: 0.95,
    expectedStartAt: tweetCreatedAt,
    expectedEndAt: deadlineAt,
    isDeadline: true,
    temporalExpression: "by midnight today",
  };

  assert.equal(hasDeadlineSemantics(deadlineResolution), true);

  // 1. Before deadline: 2026-09-12T06:50Z (10 min before deadline)
  const preDeadlineNow = new Date("2026-09-12T06:50:00.000Z");
  assert.equal(isOverdueNoticePending(deadlineResolution, null, preDeadlineNow), false);
  const preCoverage24 = getTemporalNoticeCoverage(deadlineResolution, preDeadlineNow, 24);
  const preCoverage48 = getTemporalNoticeCoverage(deadlineResolution, preDeadlineNow, 48);
  assert.equal(preCoverage24, 0.95);
  assert.equal(preCoverage48, 0.95);

  // 2. Overdue pending: 2026-09-12T07:48Z (48 min overdue, unconfirmed reset)
  const overdueNow1 = new Date("2026-09-12T07:48:00.000Z");
  assert.equal(isOverdueNoticePending(deadlineResolution, null, overdueNow1), true);
  const overdueCoverage24_1 = getTemporalNoticeCoverage(deadlineResolution, overdueNow1, 24);
  const overdueCoverage48_1 = getTemporalNoticeCoverage(deadlineResolution, overdueNow1, 48);
  assert.equal(overdueCoverage24_1, 1);
  assert.equal(overdueCoverage48_1, 1);

  // In regimeElapsedProbability / shadowProbability, override is maintained at full strength:
  // 24h = 0.90, 48h = 0.96
  const dummyBaseline = {
    probability12h: 0.15,
    probability24h: 0.25,
    probability48h: 0.40,
    probability72h: 0.55,
  };
  const activeNotice = {
    origin: "dynamic" as const,
    id: "2098612714704891959",
    title: "Rolling out limit resets by midnight today",
    summary: "Rolling out limit resets by midnight today",
    observedAt: tweetCreatedAt,
    expectedAt: tweetCreatedAt,
    expectedEndAt: deadlineAt,
    expiresAt,
    source: "https://x.com/tibo/status/2098612714704891959",
    sourceLabel: "X @tibo_maker",
    text: "Rolling out limit resets by midnight today",
    temporalPrecision: "range" as const,
    temporalConfidence: 0.95,
    temporalResolutionStatus: "resolved" as const,
    isDeadline: true,
  };

  const overdueOverride = applyOfficialNoticeTimingPolicy(dummyBaseline, activeNotice, overdueNow1);
  assert.ok(overdueOverride);
  assert.equal(overdueOverride.probability24h, 0.90);
  assert.equal(overdueOverride.probability48h, 0.96);
  assert.equal(overdueOverride.probability12h, derive12hFrom24hProbability(0.90));
  assert.equal(overdueOverride.probability72h, derive72hFrom48hProbability(0.96));

  // 3. Overdue pending near end of grace: 2026-09-12T09:59Z (unconfirmed reset)
  const overdueNow2 = new Date("2026-09-12T09:59:00.000Z");
  assert.equal(isOverdueNoticePending(deadlineResolution, null, overdueNow2), true);
  const overdueCoverage24_2 = getTemporalNoticeCoverage(deadlineResolution, overdueNow2, 24);
  const overdueCoverage48_2 = getTemporalNoticeCoverage(deadlineResolution, overdueNow2, 48);
  assert.equal(overdueCoverage24_2, 1);
  assert.equal(overdueCoverage48_2, 1);
  const overdueOverride2 = applyOfficialNoticeTimingPolicy(dummyBaseline, activeNotice, overdueNow2);
  assert.ok(overdueOverride2);
  assert.equal(overdueOverride2.probability24h, 0.90);
  assert.equal(overdueOverride2.probability48h, 0.96);

  // 4. Reset confirmed during overdue: e.g. reset confirmed at 2026-09-12T07:30Z
  const resetConfirmedAt = "2026-09-12T07:30:00.000Z";
  assert.equal(isTemporalNoticeConsumedAtReset(deadlineResolution, resetConfirmedAt), true);
  assert.equal(isOverdueNoticePending(deadlineResolution, resetConfirmedAt, overdueNow1), false);
  assert.equal(getTemporalNoticeCoverage(deadlineResolution, overdueNow1, 24, { latestResetAt: resetConfirmedAt }), 0);

  // 5. Grace period expired: 2026-09-12T10:01Z (unconfirmed reset)
  const afterGraceNow = new Date("2026-09-12T10:01:00.000Z");
  assert.equal(isOverdueNoticePending(deadlineResolution, null, afterGraceNow), false);
  assert.equal(getTemporalNoticeCoverage(deadlineResolution, afterGraceNow, 24), 0);

  // 6. UI Presentation for RadarViewModel:
  const mockRadarData: RadarData = {
    active_tibo_signals: [
      {
        tweet_id: "2098612714704891959",
        text: "Rolling out limit resets by midnight today",
        tweet_created_at: tweetCreatedAt,
        signal_type: "official_notice",
        confidence: 0.95,
        ai_signal_type: "official_notice",
        ai_confidence: 0.95,
        ai_temporal_direction: "future",
        ai_notice_to_execution: "by midnight today",
        ai_temporal_expression: "by midnight today",
        ai_temporal_kind: "absolute",
        ai_temporal_precision: "range",
        ai_temporal_timezone: "America/Los_Angeles",
        ai_temporal_confidence: 0.95,
        expected_start_at: tweetCreatedAt,
        expected_end_at: deadlineAt,
        temporal_resolution_status: "resolved",
        temporal_resolution_version: "tibo-temporal-v5",
        expires_at: expiresAt,
      } as any,
    ],
  };

  // Pre-deadline: overdue pending false, no overdue text
  const vmPre = getRadarViewModel(mockRadarData, "ja", false, undefined, preDeadlineNow);
  assert.equal(vmPre.activeWindow.isOverduePending, false);
  assert.equal(vmPre.activeWindow.overdueText, null);

  // Overdue at 07:48Z: overdue pending true, translations present, probability 24h=0.90 / 48h=0.96
  const vmJa = getRadarViewModel(mockRadarData, "ja", false, undefined, overdueNow1);
  assert.equal(vmJa.activeWindow.isOverduePending, true);
  assert.equal(vmJa.activeWindow.overdueText, "予定時刻を過ぎています。リセットを確認中です。");
  assert.equal(vmJa.probability24h, 0.90);
  assert.equal(vmJa.probability48h, 0.96);

  const vmEn = getRadarViewModel(mockRadarData, "en", false, undefined, overdueNow1);
  assert.equal(vmEn.activeWindow.isOverduePending, true);
  assert.equal(vmEn.activeWindow.overdueText, "The expected time has passed. Waiting for reset confirmation.");

  const vmZh = getRadarViewModel(mockRadarData, "zh", false, undefined, overdueNow1);
  assert.equal(vmZh.activeWindow.isOverduePending, true);
  assert.equal(vmZh.activeWindow.overdueText, "预计时间已过，正在等待重置确认。");

  // After grace at 10:01Z: activeWindow inactive / overdue pending false
  const vmAfter = getRadarViewModel(mockRadarData, "ja", false, undefined, afterGraceNow);
  assert.equal(vmAfter.activeWindow.active, false);
  assert.equal(vmAfter.activeWindow.isOverduePending, false);
});

test("Generic range without deadline semantics is not treated as overdue", () => {
  const genericRange = {
    status: "resolved" as const,
    temporalPrecision: "range" as const,
    confidence: 0.9,
    expectedStartAt: "2026-09-12T03:00:00.000Z",
    expectedEndAt: "2026-09-12T07:00:00.000Z",
    isDeadline: false,
    temporalExpression: "this morning",
  };

  const afterEnd = new Date("2026-09-12T07:05:00.000Z");
  assert.equal(hasDeadlineSemantics(genericRange), false);
  assert.equal(isOverdueNoticePending(genericRange, null, afterEnd), false);
  assert.equal(getTemporalNoticeCoverage(genericRange, afterEnd, 24), 0);
});

test("Future deadline notice outside 24h horizon does not get full 90% probability", () => {
  const futureStart = "2026-09-12T00:00:00.000Z";
  const futureDeadline = "2026-09-13T12:00:00.000Z"; // 36h in future
  const futureNoticeResolution = {
    status: "resolved" as const,
    temporalPrecision: "range" as const,
    confidence: 1.0,
    expectedStartAt: futureStart,
    expectedEndAt: futureDeadline,
    isDeadline: true,
    temporalExpression: "by tomorrow noon",
  };

  const now = new Date(futureStart);
  assert.equal(isOverdueNoticePending(futureNoticeResolution, null, now), false);
  const coverage24 = getTemporalNoticeCoverage(futureNoticeResolution, now, 24);
  const coverage48 = getTemporalNoticeCoverage(futureNoticeResolution, now, 48);

  // 24h coverage should be horizon-bounded: 24h / 36h = 2/3 ≈ 0.667 < 1.0
  assert.ok(coverage24 !== null && coverage24 < 0.7 && coverage24 > 0.6);
  // 48h coverage encompasses entire 36h window: 1.0
  assert.equal(coverage48, 1);

  const baseline = {
    probability12h: 0.15,
    probability24h: 0.25,
    probability48h: 0.40,
    probability72h: 0.55,
  };
  const activeNotice = {
    origin: "dynamic" as const,
    id: "test-future-notice",
    title: "by tomorrow noon",
    summary: "by tomorrow noon",
    observedAt: futureStart,
    expectedAt: futureStart,
    expectedEndAt: futureDeadline,
    expiresAt: "2026-09-13T15:00:00.000Z",
    source: null,
    sourceLabel: "X",
    text: "by tomorrow noon",
    temporalPrecision: "range" as const,
    temporalConfidence: 1.0,
    temporalResolutionStatus: "resolved" as const,
    isDeadline: true,
  };

  const timing = applyOfficialNoticeTimingPolicy(baseline, activeNotice, now);
  assert.ok(timing);
  assert.ok(timing.probability24h < 0.90, `24h probability (${timing.probability24h}) should be < 0.90 for future notice`);
  assert.equal(timing.probability48h, 0.96);
});

test("deadline consumption lower bound: reset prior to tweet creation does not consume notice", () => {
  const notice = {
    status: "resolved" as const,
    temporalPrecision: "range" as const,
    confidence: 0.95,
    expectedStartAt: "2026-09-12T03:20:36.000Z",
    expectedEndAt: "2026-09-12T07:00:00.000Z",
    isDeadline: true,
  };
  // Mandatory test 1: notice created/start = 2026-09-12T03:20:36Z, reset = 2026-09-12T03:00:00Z -> NOT consumed
  const priorReset = "2026-09-12T03:00:00.000Z";
  assert.equal(isTemporalNoticeConsumedAtReset(notice, priorReset), false);

  // Still overdue pending during overdue grace if only prior reset is present
  const overdueNow = new Date("2026-09-12T07:48:00.000Z");
  assert.equal(isOverdueNoticePending(notice, priorReset, overdueNow), true);
  assert.equal(getTemporalNoticeCoverage(notice, overdueNow, 24, { latestResetAt: priorReset }), 1);
});

test("deadline consumption lower bound: reset during overdue grace period consumes notice", () => {
  const notice = {
    status: "resolved" as const,
    temporalPrecision: "range" as const,
    confidence: 0.95,
    expectedStartAt: "2026-09-12T03:20:36.000Z",
    expectedEndAt: "2026-09-12T07:00:00.000Z",
    isDeadline: true,
  };
  // Mandatory test 2: notice/start = 2026-09-12T03:20:36Z, deadline = 2026-09-12T07:00:00Z,
  // reset = 2026-09-12T08:09:17Z, grace end = 2026-09-12T10:00:00Z -> consumed
  const overdueReset = "2026-09-12T08:09:17.000Z";
  assert.equal(isTemporalNoticeConsumedAtReset(notice, overdueReset), true);

  // Overdue pending is cleared after reset is confirmed
  const overdueNow = new Date("2026-09-12T08:15:00.000Z");
  assert.equal(isOverdueNoticePending(notice, overdueReset, overdueNow), false);
  assert.equal(getTemporalNoticeCoverage(notice, overdueNow, 24, { latestResetAt: overdueReset }), 0);
});
