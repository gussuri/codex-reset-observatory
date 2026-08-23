import assert from "node:assert/strict";
import test from "node:test";

import {
  getEffectiveTemporalPrecision,
  getTemporalNoticeCoverage,
  isTemporalNoticeConsumedAtReset,
  parseTiboTemporalSemantics,
  resolveTiboTemporalSchedule,
  TIBO_SOURCE_TIME_ZONE,
} from "../lib/radar/tiboTemporal";
import { formatOfficialNoticeScheduleSubject } from "../lib/radar/officialNoticePresentation";

const CREATED_AT = "2026-08-08T20:34:50.000Z";

function semantics(overrides: Record<string, unknown> = {}) {
  return {
    temporalExpression: "Monday",
    temporalKind: "weekday",
    temporalPrecision: "day",
    weekday: "monday",
    relativeDayOffset: null,
    relativeAmount: null,
    relativeUnit: null,
    explicitDateParts: null,
    explicitTimeParts: null,
    daypart: null,
    rangeKind: null,
    explicitTimezone: null,
    temporalConfidence: 0.95,
    ...overrides,
  };
}

test("resolves the Monday sample in Pacific Time without assuming Monday midnight UTC", () => {
  const result = resolveTiboTemporalSchedule(
    semantics() as never,
    CREATED_AT,
    TIBO_SOURCE_TIME_ZONE,
  );
  assert.equal(result.status, "resolved");
  assert.equal(result.temporalPrecision, "day");
  assert.equal(result.timezone, "America/Los_Angeles");
  assert.equal(result.expectedStartAt, "2026-08-10T07:00:00.000Z");
  assert.equal(result.expectedEndAt, "2026-08-11T07:00:00.000Z");
});

test("resolves explicit weekday time and relative times deterministically", () => {
  const mondayAtTwo = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "Monday at 2pm",
      explicitTimeParts: { hour: 14, minute: 0 },
    }) as never,
    CREATED_AT,
  );
  assert.equal(mondayAtTwo.status, "resolved");
  assert.equal(mondayAtTwo.temporalPrecision, "exact_time");
  assert.equal(mondayAtTwo.expectedStartAt, "2026-08-10T21:00:00.000Z");

  const in24Hours = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "in 24 hours",
      temporalKind: "relative_duration",
      temporalPrecision: "exact_time",
      weekday: null,
      relativeAmount: 24,
      relativeUnit: "hours",
    }) as never,
    CREATED_AT,
  );
  assert.equal(in24Hours.expectedStartAt, "2026-08-09T20:34:50.000Z");
  assert.equal(in24Hours.expectedEndAt, in24Hours.expectedStartAt);

  const inTwoDays = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "in 2 days",
      temporalKind: "relative_duration",
      temporalPrecision: "day",
      weekday: null,
      relativeAmount: 2,
      relativeUnit: "days",
    }) as never,
    CREATED_AT,
  );
  assert.equal(inTwoDays.temporalPrecision, "day");
  assert.equal(inTwoDays.expectedStartAt, "2026-08-10T07:00:00.000Z");
});

test("resolves a same-day absolute deadline from the tweet instant without inferring tomorrow", () => {
  const deadline = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "by 8pm PST",
      temporalKind: "absolute",
      temporalPrecision: "exact_time",
      weekday: null,
      explicitTimeParts: { hour: 20, minute: 0 },
      explicitTimezone: "PST",
    }) as never,
    "2026-08-21T23:40:34.000Z",
  );

  assert.equal(deadline.status, "resolved");
  assert.equal(deadline.expectedStartAt, "2026-08-21T23:40:34.000Z");
  assert.equal(deadline.expectedEndAt, "2026-08-22T04:00:00.000Z");
  assert.equal(deadline.temporalPrecision, "range");
  assert.equal(
    getEffectiveTemporalPrecision({
      status: deadline.status,
      temporalPrecision: "exact_time",
      expectedStartAt: deadline.expectedStartAt,
      expectedEndAt: deadline.expectedEndAt,
    }),
    "range",
  );

  const pastDeadline = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "by 8pm PST",
      temporalKind: "absolute",
      temporalPrecision: "exact_time",
      weekday: null,
      explicitTimeParts: { hour: 20, minute: 0 },
      explicitTimezone: "PST",
    }) as never,
    "2026-08-22T05:00:00.000Z",
  );
  assert.equal(pastDeadline.status, "unresolved");
  assert.equal(pastDeadline.expectedStartAt, null);
  assert.equal(pastDeadline.expectedEndAt, null);
});

test("keeps an absolute at-time as a point instant", () => {
  const result = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "at 8pm PST",
      temporalKind: "absolute",
      temporalPrecision: "exact_time",
      weekday: null,
      explicitTimeParts: { hour: 20, minute: 0 },
      explicitTimezone: "PST",
    }) as never,
    "2026-08-21T23:40:34.000Z",
  );

  assert.equal(result.status, "resolved");
  assert.equal(result.expectedStartAt, "2026-08-22T04:00:00.000Z");
  assert.equal(result.expectedEndAt, result.expectedStartAt);
  assert.equal(result.temporalPrecision, "exact_time");
});

test("resolves today, tomorrow, and next-week calendar windows", () => {
  const tomorrow = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "tomorrow",
      temporalKind: "relative_day",
      weekday: null,
      temporalPrecision: "day",
      relativeDayOffset: 1,
    }) as never,
    CREATED_AT,
  );
  assert.equal(tomorrow.expectedStartAt, "2026-08-09T07:00:00.000Z");
  assert.equal(tomorrow.expectedEndAt, "2026-08-10T07:00:00.000Z");

  const tomorrowAtNine = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "tomorrow at 9am",
      temporalKind: "relative_day",
      weekday: null,
      temporalPrecision: "exact_time",
      relativeDayOffset: 1,
      explicitTimeParts: { hour: 9, minute: 0 },
    }) as never,
    CREATED_AT,
  );
  assert.equal(tomorrowAtNine.temporalPrecision, "exact_time");
  assert.equal(tomorrowAtNine.expectedStartAt, "2026-08-09T16:00:00.000Z");

  const nextWeek = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "next week",
      temporalKind: "range",
      temporalPrecision: "range",
      weekday: null,
      rangeKind: "next_week",
    }) as never,
    CREATED_AT,
  );
  assert.equal(nextWeek.expectedStartAt, "2026-08-10T07:00:00.000Z");
  assert.equal(nextWeek.expectedEndAt, "2026-08-17T07:00:00.000Z");

  const sameWeekdayWithTime = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "Saturday at 3pm",
      temporalKind: "weekday",
      temporalPrecision: "exact_time",
      weekday: "saturday",
      explicitTimeParts: { hour: 15, minute: 0 },
    }) as never,
    CREATED_AT,
  );
  assert.equal(sameWeekdayWithTime.expectedStartAt, "2026-08-08T22:00:00.000Z");

  const sameWeekdayBare = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "Saturday",
      temporalKind: "weekday",
      weekday: "saturday",
    }) as never,
    CREATED_AT,
  );
  assert.equal(sameWeekdayBare.status, "unresolved");
});

test("resolves dayparts and ranges in the source-local calendar", () => {
  const morning = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "Monday morning",
      temporalKind: "daypart",
      temporalPrecision: "daypart",
      daypart: "morning",
    }) as never,
    CREATED_AT,
  );
  assert.equal(morning.expectedStartAt, "2026-08-10T13:00:00.000Z");
  assert.equal(morning.expectedEndAt, "2026-08-10T19:00:00.000Z");

  const weekend = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "this weekend",
      temporalKind: "range",
      temporalPrecision: "range",
      weekday: null,
      rangeKind: "this_weekend",
    }) as never,
    CREATED_AT,
  );
  assert.equal(weekend.expectedStartAt, "2026-08-08T07:00:00.000Z");
  assert.equal(weekend.expectedEndAt, "2026-08-10T07:00:00.000Z");
});

test("resolves during the day from the post instant to the source-local day boundary", () => {
  const result = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "during the day",
      temporalKind: "daypart",
      temporalPrecision: "daypart",
      weekday: null,
      daypart: "day",
    }) as never,
    "2026-08-21T12:30:00.000Z",
  );

  assert.equal(result.status, "resolved");
  assert.equal(result.timezone, TIBO_SOURCE_TIME_ZONE);
  assert.equal(result.temporalPrecision, "daypart");
  assert.equal(result.expectedStartAt, "2026-08-21T12:30:00.000Z");
  assert.equal(result.expectedEndAt, "2026-08-22T07:00:00.000Z");
});

test("resolves during the day across a Pacific DST boundary and local date boundary", () => {
  const beforeDst = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "during the day",
      temporalKind: "daypart",
      temporalPrecision: "daypart",
      weekday: null,
      daypart: "day",
    }) as never,
    "2026-03-08T08:30:00.000Z",
  );
  assert.equal(beforeDst.expectedEndAt, "2026-03-09T07:00:00.000Z");

  const beforeLocalMidnight = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "during the day",
      temporalKind: "daypart",
      temporalPrecision: "daypart",
      weekday: null,
      daypart: "day",
    }) as never,
    "2026-08-22T06:30:00.000Z",
  );
  assert.equal(beforeLocalMidnight.expectedStartAt, "2026-08-22T06:30:00.000Z");
  assert.equal(beforeLocalMidnight.expectedEndAt, "2026-08-22T07:00:00.000Z");
});

test("ambiguous, vague, and hallucinated temporal fields fail safely", () => {
  const soon = resolveTiboTemporalSchedule(
    semantics({ temporalExpression: "soon", temporalKind: "vague", temporalPrecision: "unknown", weekday: null }) as never,
    CREATED_AT,
  );
  assert.equal(soon.status, "unresolved");

  const invalidExpression = parseTiboTemporalSemantics(
    semantics({ temporalExpression: "tomorrow at 9am", explicitTimeParts: { hour: 9, minute: 0 } }),
    "The reset is coming tomorrow.",
  );
  assert.equal(invalidExpression, null);

  const invalidTime = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "Sunday at 2:30am",
      temporalKind: "weekday",
      temporalPrecision: "exact_time",
      weekday: "sunday",
      explicitTimeParts: { hour: 2, minute: 30 },
    }) as never,
    "2026-03-07T20:00:00.000Z",
  );
  assert.equal(invalidTime.status, "rejected");

  const ambiguousTime = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "Sunday at 1:30am",
      temporalKind: "weekday",
      temporalPrecision: "exact_time",
      weekday: "sunday",
      explicitTimeParts: { hour: 1, minute: 30 },
    }) as never,
    "2026-10-31T20:00:00.000Z",
  );
  assert.equal(ambiguousTime.status, "rejected");

  const explicitPacificTime = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "Monday at 2pm PDT",
      temporalKind: "weekday",
      temporalPrecision: "exact_time",
      weekday: "monday",
      explicitTimeParts: { hour: 14, minute: 0 },
      explicitTimezone: "PDT",
    }) as never,
    CREATED_AT,
  );
  assert.equal(explicitPacificTime.status, "resolved");
  assert.equal(explicitPacificTime.expectedStartAt, "2026-08-10T21:00:00.000Z");

  const unknownTimeZone = resolveTiboTemporalSchedule(
    semantics({
      temporalExpression: "Monday at 2pm Martian Time",
      temporalKind: "weekday",
      temporalPrecision: "exact_time",
      weekday: "monday",
      explicitTimeParts: { hour: 14, minute: 0 },
      explicitTimezone: "Martian Time",
    }) as never,
    CREATED_AT,
  );
  assert.equal(unknownTimeZone.status, "unresolved");
});

test("partial window coverage is not the legacy fixed 90/96 override", () => {
  const notice = {
    status: "resolved" as const,
    temporalPrecision: "day" as const,
    confidence: 0.95,
    expectedStartAt: "2026-08-10T07:00:00.000Z",
    expectedEndAt: "2026-08-11T07:00:00.000Z",
  };
  const now = new Date(CREATED_AT);
  const coverage24 = getTemporalNoticeCoverage(notice, now, 24);
  const coverage48 = getTemporalNoticeCoverage(notice, now, 48);
  assert.equal(coverage24, 0);
  assert.ok(coverage48 !== null && coverage48 > 0 && coverage48 < 1);
  assert.equal(isTemporalNoticeConsumedAtReset(notice, "2026-08-09T12:00:00.000Z"), false);
  assert.equal(isTemporalNoticeConsumedAtReset(notice, "2026-08-10T12:00:00.000Z"), true);
});

test("recovers an explicit 14pm PST tomorrow schedule from source text when Gemini omits temporal fields", () => {
  const source = "Reset will land around 14pm PST tomorrow.";
  const parsed = parseTiboTemporalSemantics(null, source);

  assert.ok(parsed);
  assert.equal(parsed.temporalKind, "relative_day");
  assert.deepEqual(parsed.explicitTimeParts, { hour: 14, minute: 0 });
  assert.equal(parsed.explicitTimezone, "PST");

  const resolution = resolveTiboTemporalSchedule(
    parsed,
    "2026-08-23T06:29:00.000Z",
    TIBO_SOURCE_TIME_ZONE,
  );
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.temporalPrecision, "exact_time");
  assert.equal(resolution.timezone, "PST");
  assert.equal(resolution.expectedStartAt, "2026-08-23T22:00:00.000Z");
  assert.equal(resolution.expectedEndAt, resolution.expectedStartAt);

  const subject = formatOfficialNoticeScheduleSubject(
    {
      expectedAt: resolution.expectedStartAt,
      expectedEndAt: resolution.expectedEndAt,
      temporalPrecision: resolution.temporalPrecision,
      temporalResolutionStatus: resolution.status,
      temporalTimezone: resolution.timezone,
    },
    "ja",
  );
  assert.ok(subject?.includes("14:00"));
  assert.ok(subject?.endsWith("ごろ"));
});

test("recovers supported clock and relative-day spellings without inventing a timestamp", () => {
  const cases = [
    "Reset will land around 14pm PST tomorrow.",
    "Reset will land 14pm PST tomorrow.",
    "Reset will land 14 pm PST tomorrow.",
    "Reset will land 14:00 PST tomorrow.",
    "Reset will land 2pm PST tomorrow.",
    "Reset will land tomorrow around 14pm PST.",
  ];

  for (const source of cases) {
    const parsed = parseTiboTemporalSemantics(null, source);
    const resolution = resolveTiboTemporalSchedule(parsed, "2026-08-23T06:29:00.000Z");
    assert.equal(resolution.status, "resolved", source);
    assert.equal(resolution.expectedStartAt, "2026-08-23T22:00:00.000Z", source);
  }

  const weekday = parseTiboTemporalSemantics(null, "Reset will land Monday at 2pm PDT.");
  const weekdayResolution = resolveTiboTemporalSchedule(weekday, CREATED_AT);
  assert.equal(weekdayResolution.status, "resolved");
  assert.equal(weekdayResolution.expectedStartAt, "2026-08-10T21:00:00.000Z");
});

test("rejects contradictory or vague source clocks and replaces hallucinated clock fields with source evidence", () => {
  for (const source of [
    "Reset will land at 14am tomorrow.",
    "Reset will land around sometime tomorrow.",
    "Reset will land soon.",
  ]) {
    const parsed = parseTiboTemporalSemantics(null, source);
    assert.equal(resolveTiboTemporalSchedule(parsed, "2026-08-23T06:29:00.000Z").status, "unresolved", source);
  }

  const hallucinated = parseTiboTemporalSemantics(
    {
      temporalExpression: "tomorrow at 10am",
      temporalKind: "relative_day",
      temporalPrecision: "exact_time",
      relativeDayOffset: 1,
      explicitTimeParts: { hour: 10, minute: 0 },
      explicitTimezone: null,
      temporalConfidence: 0.95,
    },
    "Reset will land tomorrow at 9am.",
  );
  assert.ok(hallucinated);
  assert.deepEqual(hallucinated.explicitTimeParts, { hour: 9, minute: 0 });
  assert.equal(hallucinated.temporalKind, "relative_day");
});
