import assert from "node:assert/strict";
import test from "node:test";

import {
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import {
  buildNextGenerationExperimentalProbabilityForecasts,
} from "../lib/nextGenerationLogging";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import { getLocalRadarData } from "../lib/radar";
import {
  isEligibleRandomResetEvent,
  isEligibleRandomResetEventWithPolicy,
} from "../lib/radar/resetEligibility";
import {
  getRecoveryResetEvents,
} from "../lib/radar/recoveryBoundary";
import {
  calculateBroadBankedRandomContinuousShadow,
} from "../lib/radar/broadBankedRandomContinuousShadow";
import {
  calculateRandomContinuousBroadBankedLateAgeRegimeDiagnostics,
} from "../lib/radar/randomContinuousBroadBankedLateAgeRegimeDiagnostics";
import {
  evaluateBroadBankedLateAgeRegimeDiagnostics,
} from "../lib/radar/prospectiveBroadBankedLateAgeRegimeDiagnostics";
import {
  BROAD_BANKED_RANDOM_CLOCK_SENSITIVITY_AGES_HOURS,
  calculateRandomClockSensitivityComparison,
  compareRandomBoundaryIntervals,
} from "../lib/radar/broadBankedRandomClockV2Diagnostics";
import type { NextGenerationTrainingState } from "../lib/radar/nextGenerationTraining";
import type { WindowEventLike } from "../lib/radar/types";
import type { ProspectiveForecastRow } from "../lib/radar/prospectiveProbabilityEvaluation";

type ResetEventOverrides = Omit<Partial<WindowEventLike>, "details"> & {
  details?: Partial<NonNullable<WindowEventLike["details"]>>;
};

function resetEvent(overrides: ResetEventOverrides = {}): WindowEventLike {
  const { details: detailsOverride, ...rest } = overrides;
  const completedAt = rest.completed_at ?? "2026-06-12T00:11:00.000Z";
  return {
    id: "v2-fixture",
    recordKind: "banked_distribution",
    title: "Banked reset",
    kind: "reset_completed",
    status: "closed",
    opened_at: completedAt,
    closed_at: completedAt,
    completed_at: completedAt,
    scope: "全有料プラン",
    details: {
      cycleType: "定期リセット",
      reasonType: "定期更新",
      resetMethod: "任意リセット権配布",
      scope: "全有料プラン",
      noticeToExecution: "0分",
      ...detailsOverride,
    },
    ...rest,
  };
}

function trainingState(): NextGenerationTrainingState {
  return {
    status: "ok",
    reason: null,
    bRows: [],
    aRows: [],
    cRows: [],
    cV2Rows: [],
    contextAwareRows: [],
    totalRows: 0,
    skipReasons: {
      pre_freeze: 0,
      missing_b_forecast: 0,
      invalid_b_forecast: 0,
      incomplete_a_components: 0,
      invalid_generated_at: 0,
    },
    backfill: false,
  };
}

function sixTwelveFixture() {
  return LOCAL_RESET_HISTORY.find((item) => item.id === "personal-reset-credit-2026-06-11")!;
}

function v2Row(
  generatedAt: string,
  ageHours: number,
  predictions: Partial<Record<string, { probability24h: number; probability48h: number }>> = {},
): ProspectiveForecastRow {
  const forecasts = Object.fromEntries(BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.map((modelVersion) => {
    const prediction = predictions[modelVersion] ?? { probability24h: 0.2, probability48h: 0.3 };
    return [modelVersion, {
      modelVersion,
      generatedAt,
      probability24h: prediction.probability24h,
      probability48h: prediction.probability48h,
      baseline24h: prediction.probability24h,
      baseline48h: prediction.probability48h,
      randomElapsedHours: ageHours,
      randomEligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
      backfilled: false,
    }];
  }));
  return { generatedAt, loggedHour: generatedAt, forecasts };
}

function boundary(id: string, timestampMs: number): {
  id: string;
  resetAt: string;
  isRandom: boolean;
  isRegular: boolean;
  sourceIds: string[];
} {
  return {
    id,
    resetAt: new Date(timestampMs).toISOString(),
    isRandom: true,
    isRegular: false,
    sourceIds: [id],
  };
}

test("legacy random eligibility stays random-cycle-only while v2 accepts the broad banked regular fixture", () => {
  const item = sixTwelveFixture();
  const completedAt = Date.parse(item.completed_at ?? "");
  const now = Date.parse("2026-06-13T00:00:00.000Z");

  assert.equal(isEligibleRandomResetEvent(item, completedAt, now), false);
  assert.equal(
    isEligibleRandomResetEventWithPolicy(item, completedAt, now, BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY),
    true,
  );
});

test("v2 accepts broad random banked events but rejects narrow, conditional, future, rejected, voided, excluded, and regular confirmed-global records", () => {
  const now = Date.parse("2026-09-10T00:00:00.000Z");
  const broadRandom = resetEvent({
    id: "broad-random-banked",
    details: { cycleType: "ランダムリセット" },
  });
  const cases: Array<[string, WindowEventLike, boolean]> = [
    ["broad random banked", broadRandom, true],
    ["narrow banked", resetEvent({ id: "narrow", scope: "一部ユーザー" }), false],
    ["conditional banked", resetEvent({ id: "conditional", randomResetTargetScope: "conditional" }), false],
    ["future banked", resetEvent({ id: "future", completed_at: "2026-09-10T00:00:01.000Z", closed_at: "2026-09-10T00:00:01.000Z", opened_at: "2026-09-10T00:00:01.000Z" }), false],
    ["rejected banked", resetEvent({ id: "rejected", status: "rejected" }), false],
    ["voided banked", resetEvent({ id: "voided", status: "voided" }), false],
    ["excluded banked", resetEvent({ id: "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec" }), false],
    ["regular confirmed global", resetEvent({ id: "confirmed-regular", recordKind: "confirmed_global" }), false],
  ];

  for (const [label, item, expected] of cases) {
    const completedAt = Date.parse(item.completed_at ?? "");
    assert.equal(
      isEligibleRandomResetEventWithPolicy(item, completedAt, now, BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY),
      expected,
      label,
    );
  }
});

test("the v2 2026-06-12 boundary is both random and regular while legacy remains regular-only", () => {
  const now = new Date("2026-06-13T00:00:00.000Z");
  const history = [sixTwelveFixture()];
  const legacy = getRecoveryResetEvents(null, now, history);
  const v2 = getRecoveryResetEvents(null, now, history, undefined, BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY);

  assert.deepEqual(legacy.map(({ id, isRandom, isRegular }) => ({ id, isRandom, isRegular })), [
    { id: "personal-reset-credit-2026-06-11", isRandom: false, isRegular: true },
  ]);
  assert.deepEqual(v2.map(({ id, isRandom, isRegular }) => ({ id, isRandom, isRegular })), [
    { id: "personal-reset-credit-2026-06-11", isRandom: true, isRegular: true },
  ]);
});

test("omitting policy preserves the legacy recovery and continuous result shape", () => {
  const now = new Date("2026-06-13T00:00:00.000Z");
  const history = [
    resetEvent({ id: "r0", completed_at: "2026-06-01T00:00:00.000Z", closed_at: "2026-06-01T00:00:00.000Z", opened_at: "2026-06-01T00:00:00.000Z", recordKind: "confirmed_global", details: { cycleType: "ランダムリセット", reasonType: "詫びリセット", resetMethod: "強制リセット" } }),
    sixTwelveFixture(),
  ];
  const legacyBoundaries = getRecoveryResetEvents(null, now, history);
  const explicitLegacyBoundaries = getRecoveryResetEvents(null, now, history, undefined, LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY);
  assert.deepEqual(legacyBoundaries, explicitLegacyBoundaries);

  const legacy = calculateBroadBankedRandomContinuousShadow(null, {
    now,
    staticHistory: [history[0]],
    activeOfficialNotice: null,
  });
  assert.deepEqual(legacy.randomContinuous.randomBoundaryIds, ["r0"]);
});

test("v2 base shadow and v2 late-age control share exactly the same random boundary semantics", () => {
  const now = new Date("2026-06-13T00:00:00.000Z");
  const options = { now, staticHistory: [sixTwelveFixture()], activeOfficialNotice: null };
  const base = calculateBroadBankedRandomContinuousShadow(null, options);
  const late = calculateRandomContinuousBroadBankedLateAgeRegimeDiagnostics(null, options);
  const control = late[BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION].result;

  assert.deepEqual(control.randomContinuous.randomBoundaryIds, ["personal-reset-credit-2026-06-11"]);
  assert.deepEqual(control.randomContinuous.randomBoundaryIds, base.randomContinuous.randomBoundaryIds);
  assert.equal(base.randomContinuous.randomEligibilityPolicyVersion, BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION);
  assert.equal(control.randomContinuous.randomEligibilityPolicyVersion, BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION);
  assert.equal(control.randomContinuous.bandwidthHours, 18);
  assert.equal(control.randomContinuous.truncationHours, 54);
});

test("v2 forecast logging is frozen separately, records policy identity, and keeps diagnostic identities separate", () => {
  const after = new Date(Date.parse(BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT) + 60_000);
  const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: {
      now: after,
      staticHistory: [sixTwelveFixture()],
      activeOfficialNotice: null,
    },
    existingForecasts: {},
    trainingState: trainingState(),
  });

  assert.equal(PUBLISHED_PROBABILITY_MODEL_VERSION, SURVIVAL_CONDITIONED_MODEL_VERSION);
  assert.equal(RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT < BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT, true);
  assert.equal(BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT, BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT);
  assert.ok(forecasts[BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION]);
  for (const modelVersion of BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS) {
    const forecast = forecasts[modelVersion];
    assert.ok(forecast, modelVersion);
    assert.equal(forecast.randomEligibilityPolicyVersion, BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION);
    assert.equal(forecast.experimentRole, "diagnostic");
    assert.equal(forecast.evaluationMode, "prospective");
    assert.equal(forecast.backfilled, false);
    if (modelVersion === BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION) {
      assert.equal(forecast.preResetRegimeMultiplier, null);
      assert.equal(forecast.preResetRegimeMultiplierFallbackUsed, false);
      assert.equal(forecast.preResetRegimeMultiplierFallbackReason, null);
    } else if (modelVersion.endsWith("pre-reset-frozen-regime-v2")) {
      assert.equal(typeof forecast.preResetRegimeMultiplier, "number");
      assert.equal(forecast.preResetRegimeMultiplierFallbackUsed, true);
      assert.equal(typeof forecast.preResetRegimeMultiplierFallbackReason, "string");
    } else {
      assert.equal(forecast.preResetRegimeMultiplier, null);
      assert.equal(forecast.preResetRegimeMultiplierFallbackUsed, false);
      assert.equal(forecast.preResetRegimeMultiplierFallbackReason, null);
    }
  }
  assert.equal(forecasts[RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION]?.randomEligibilityPolicyVersion, undefined);
});

test("v2 forecast logging is fail-open before it can affect the existing forecast map", () => {
  const before = new Date(Date.parse(BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT) - 1);
  const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: { now: before, staticHistory: [sixTwelveFixture()], activeOfficialNotice: null },
    existingForecasts: {},
    trainingState: trainingState(),
  });
  assert.equal(forecasts[BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION], undefined);
  assert.equal(
    forecasts[BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION],
    undefined,
  );
});

test("public snapshot does not expose the v2 shadow identity or audit fields", () => {
  const internal = getLocalRadarData({ calculationNow: new Date("2026-06-13T00:00:00.000Z") });
  const serialized = JSON.stringify(toPublicRadarSnapshot(internal, "en", {
    calculationNow: new Date("2026-06-13T00:00:00.000Z"),
  }));
  assert.doesNotMatch(serialized, /broad-banked|lateAgeRegimePolicy|lateAgeStartHours|preResetRegimeMultiplier/);
});

test("v2 prospective evaluator keeps overall and >=144h primary metrics on the same daily-first origins", () => {
  const control = BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION;
  const primary = BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION;
  const rows = [
    v2Row("2026-09-18T12:00:00.000Z", 120, {
      [control]: { probability24h: 0.1, probability48h: 0.2 },
      [primary]: { probability24h: 0.9, probability48h: 0.8 },
    }),
    v2Row("2026-09-19T12:00:00.000Z", 150, {
      [control]: { probability24h: 0.2, probability48h: 0.2 },
      [primary]: { probability24h: 0.6, probability48h: 0.7 },
    }),
  ];
  const report = evaluateBroadBankedLateAgeRegimeDiagnostics(
    rows,
    [],
    new Date("2026-09-22T00:00:00.000Z"),
  );
  assert.equal(report.schemaVersion, "prospective-broad-banked-late-age-regime-diagnostics-v2");
  assert.equal(report.randomEligibilityPolicyVersion, BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION);
  assert.equal(report.comparison.primary.resolved24h, 2);
  assert.equal(report.comparison.primary.lateAgeResolved24h, 1);
  assert.notEqual(
    report.comparison.primary.overallBrierDifference24h,
    report.comparison.primary.lateAgeBrierDifference24h,
  );
  assert.ok((report.comparison.primary.lateAgeBrierDifference24h ?? 0) > 0);
});

test("v2 prospective evaluator returns null late-age differences with zero late-age sample and excludes future boundaries", () => {
  const report = evaluateBroadBankedLateAgeRegimeDiagnostics(
    [v2Row("2026-09-18T12:00:00.000Z", 120)],
    [
      { id: "past", resetAt: "2026-09-20T11:59:59.000Z", isRandom: true, isRegular: false, sourceIds: ["past"] },
      { id: "future", resetAt: "2026-09-20T12:00:01.000Z", isRandom: true, isRegular: false, sourceIds: ["future"] },
      { id: "invalid", resetAt: "not-a-timestamp", isRandom: true, isRegular: false, sourceIds: ["invalid"] },
    ],
    new Date("2026-09-20T12:00:00.000Z"),
  );
  assert.equal(report.comparison.primary.lateAgeBrierDifference24h, null);
  assert.equal(report.comparison.primary.lateAgeBrierDifference48h, null);
  assert.equal(report.comparison.primary.lateAgeLogLossDifference24h, null);
  assert.equal(report.comparison.primary.lateAgeLogLossDifference48h, null);
  assert.equal(report.canonicalRandomBoundaryCount, 1);
});

test("interval diagnostics derive the 333.567-hour legacy interval and its two v2 parts from timestamps", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const legacyEnd = start + 333.567 * 60 * 60 * 1000;
  const split = start + 191.75 * 60 * 60 * 1000;
  const comparison = compareRandomBoundaryIntervals(
    [boundary("r0", start), boundary("r1", legacyEnd)],
    [boundary("r0", start), boundary("banked", split), boundary("r1", legacyEnd)],
  );
  const evidence = comparison.splitEvidence[0];
  assert.ok(evidence);
  assert.ok(Math.abs(evidence.legacyHours - 333.567) < 0.001);
  assert.equal(evidence.v2PartsHours.length, 2);
  assert.ok(Math.abs(evidence.v2PartsHours[0] - 191.75) < 0.001);
  assert.ok(Math.abs(evidence.v2PartsHours[1] - 141.817) < 0.001);
  assert.ok((comparison.v2.maxHours ?? Number.POSITIVE_INFINITY) < 240);
});

test("sensitivity diagnostics cover 6–15 days with pure structure probabilities and expose the late second-peak comparison", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const legacyEnd = start + 333.567 * 60 * 60 * 1000;
  const split = start + 191.75 * 60 * 60 * 1000;
  const comparison = calculateRandomClockSensitivityComparison(
    [boundary("r0", start), boundary("r1", legacyEnd)],
    [boundary("r0", start), boundary("banked", split), boundary("r1", legacyEnd)],
  );
  assert.deepEqual(comparison.legacy.map((row) => row.ageHours), [...BROAD_BANKED_RANDOM_CLOCK_SENSITIVITY_AGES_HOURS]);
  assert.deepEqual(comparison.v2.map((row) => row.ageHours), [...BROAD_BANKED_RANDOM_CLOCK_SENSITIVITY_AGES_HOURS]);
  for (const row of [...comparison.legacy, ...comparison.v2]) {
    assert.ok(Number.isFinite(row.instantaneousRawDailyProbability));
    assert.ok(Number.isFinite(row.regimeMultiplier));
    assert.ok(row.noRegimeProbability24h <= row.noRegimeProbability48h);
    assert.ok(row.probability24h <= row.probability48h);
  }
  const legacy12to15 = comparison.legacy.filter((row) => row.ageHours >= 288);
  const v2_12to15 = comparison.v2.filter((row) => row.ageHours >= 288);
  assert.ok(legacy12to15.some((row, index) =>
    Math.abs(row.probability24h - (v2_12to15[index]?.probability24h ?? row.probability24h)) > 1e-12,
  ));
});

assert.equal(RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.length, 4);
