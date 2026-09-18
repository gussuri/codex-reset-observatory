import assert from "node:assert/strict";
import test from "node:test";

import {
  NEXT_GENERATION_FREEZE_AT,
  NEXT_GENERATION_B_FROZEN_REGIME_CONFIG,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_OPTIONS,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import {
  buildNextGenerationExperimentalProbabilityForecasts,
} from "../lib/nextGenerationLogging";
import type { ExperimentalProbabilityForecasts } from "../lib/logProbability";
import {
  calculateRandomContinuousBandwidthShadowPair,
} from "../lib/radar/randomContinuousBandwidthShadow";
import {
  calculateRandomContinuousLateAgeRegimeDiagnostics,
  getLateAgeRegimeMultiplierAtAge,
} from "../lib/radar/randomContinuousLateAgeRegimeDiagnostics";
import {
  buildRandomContinuousHazard,
  getPostResetRegimeMultiplierAtAge,
  integrateRandomContinuousHazard,
} from "../lib/radar/randomContinuousProbability";
import {
  calculateRegimeDiagnostics,
} from "../lib/radar/regimeElapsedProbability";
import {
  getRecoveryResetEvents,
} from "../lib/radar/recoveryBoundary";
import {
  evaluateLateAgeRegimeDiagnostics,
  getLateAgeRegimeAgeBucket,
  selectComparableLateAgeRegimeForecasts,
} from "../lib/radar/prospectiveLateAgeRegimeDiagnostics";
import type { RecoveryResetBoundary } from "../lib/radar/recoveryBoundary";
import type { WindowEventLike } from "../lib/radar/types";
import type { ProspectiveForecastRow } from "../lib/radar/prospectiveProbabilityEvaluation";
import type { NextGenerationTrainingState } from "../lib/radar/nextGenerationTraining";

const HOUR_MS = 60 * 60 * 1000;

function boundary(id: string, resetAt: string): RecoveryResetBoundary {
  return { id, resetAt, isRandom: true, isRegular: false, sourceIds: [id] };
}

function resetEvent(id: string, completedAt: string): WindowEventLike {
  return {
    id,
    recordKind: "confirmed_global",
    title: "Random reset",
    kind: "reset_completed",
    status: "closed",
    opened_at: completedAt,
    closed_at: completedAt,
    completed_at: completedAt,
    scope: "全有料プラン",
    details: {
      cycleType: "ランダムリセット",
      reasonType: "詫びリセット",
      resetMethod: "強制リセット",
      scope: "全有料プラン",
      noticeToExecution: "0分",
    },
  };
}

function trainingState(status: "ok" | "error" = "ok"): NextGenerationTrainingState {
  return {
    status,
    reason: status === "error" ? "induced failure" : null,
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

function diagnosticOptions(now: Date, staticHistory: Array<WindowEventLike>) {
  return {
    now,
    staticHistory,
    activeOfficialNotice: null,
  };
}

function assertFiniteMonotonic(forecast: ExperimentalProbabilityForecasts[string]) {
  assert.ok(Number.isFinite(forecast.probability12h));
  assert.ok(Number.isFinite(forecast.probability24h));
  assert.ok(Number.isFinite(forecast.probability48h));
  assert.ok(Number.isFinite(forecast.probability72h));
  assert.ok(forecast.probability12h! <= forecast.probability24h);
  assert.ok(forecast.probability24h <= forecast.probability48h);
  assert.ok(forecast.probability48h <= forecast.probability72h!);
}

test("late-age policies preserve the current regime below the threshold and apply at every age", () => {
  const regime = 1.3;
  const threshold = RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS;
  assert.equal(getPostResetRegimeMultiplierAtAge(23.999, regime), 1);
  assert.equal(getLateAgeRegimeMultiplierAtAge(0, regime, "control"), 1);
  assert.equal(getLateAgeRegimeMultiplierAtAge(23.999, regime, "control"), 1);
  assert.equal(getLateAgeRegimeMultiplierAtAge(24, regime, "control"), regime);
  assert.equal(getLateAgeRegimeMultiplierAtAge(143.999, regime, "control"), regime);
  assert.equal(getLateAgeRegimeMultiplierAtAge(threshold, regime, "control"), regime);
  assert.equal(getLateAgeRegimeMultiplierAtAge(168, regime, "control"), regime);

  assert.equal(getLateAgeRegimeMultiplierAtAge(23.999, regime, "late-neutral"), 1);
  assert.equal(getLateAgeRegimeMultiplierAtAge(24, regime, "late-neutral"), regime);
  assert.equal(getLateAgeRegimeMultiplierAtAge(threshold - 0.001, regime, "late-neutral"), regime);
  assert.equal(getLateAgeRegimeMultiplierAtAge(threshold, regime, "late-neutral"), 1);
  assert.equal(getLateAgeRegimeMultiplierAtAge(168, regime, "late-neutral"), 1);

  assert.equal(getLateAgeRegimeMultiplierAtAge(24, 0.7, "late-no-downward"), 0.7);
  assert.equal(getLateAgeRegimeMultiplierAtAge(threshold, 0.7, "late-no-downward"), 1);
  assert.equal(getLateAgeRegimeMultiplierAtAge(threshold, 1, "late-no-downward"), 1);
  assert.equal(getLateAgeRegimeMultiplierAtAge(threshold, 1.3, "late-no-downward"), 1.3);
});

test("late-age integration changes when a future horizon crosses 144h", () => {
  const now = new Date("2026-01-20T00:00:00.000Z");
  const hazard = buildRandomContinuousHazard([
    boundary("r0", "2026-01-01T00:00:00.000Z"),
    boundary("r1", "2026-01-05T00:00:00.000Z"),
  ], now, RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_OPTIONS);
  const lateNeutral = integrateRandomContinuousHazard(
    hazard,
    140,
    24,
    1.5,
    (age, regime) => getLateAgeRegimeMultiplierAtAge(age, regime, "late-neutral"),
  );
  const currentProductionPolicy = integrateRandomContinuousHazard(
    hazard,
    140,
    24,
    1.5,
    getPostResetRegimeMultiplierAtAge,
  );
  assert.ok(lateNeutral < currentProductionPolicy);
});

test("control arm exactly matches the existing Production-equivalent 18/54 calculation", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const staticHistory = [
    resetEvent("r0", "2026-08-01T00:00:00.000Z"),
    resetEvent("r1", "2026-08-08T00:00:00.000Z"),
    resetEvent("r2", "2026-08-16T00:00:00.000Z"),
  ];
  const production = calculateRandomContinuousBandwidthShadowPair(
    null,
    diagnosticOptions(now, staticHistory),
  ).challenger;
  const diagnostics = calculateRandomContinuousLateAgeRegimeDiagnostics(
    null,
    diagnosticOptions(now, staticHistory),
  );
  const control = diagnostics[RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION].result;
  assert.deepEqual(control.predictions, production.predictions);
  assert.deepEqual(control.baseline, production.baseline);
  assert.deepEqual(control.multipliers, production.multipliers);
  assert.deepEqual(control.officialNoticeOverride, production.officialNoticeOverride);
  assert.equal(control.randomContinuous.randomElapsedHours, production.randomContinuous.randomElapsedHours);
  assert.equal(control.randomContinuous.bandwidthHours, 18);
  assert.equal(control.randomContinuous.truncationHours, 54);
});

test("all four arms share origin, target, frozen settings, signal inputs, and notice state", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const diagnostics = calculateRandomContinuousLateAgeRegimeDiagnostics(
    null,
    diagnosticOptions(now, [
      resetEvent("r0", "2026-08-01T00:00:00.000Z"),
      resetEvent("r1", "2026-08-08T00:00:00.000Z"),
    ]),
  );
  const arms = RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.map((modelVersion) => {
    const arm = diagnostics[modelVersion];
    assert.equal(arm.result.calculatedAt, now.toISOString());
    assert.equal(arm.result.targetDefinition, diagnostics[RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[0]].result.targetDefinition);
    assert.equal(arm.result.randomContinuous.bandwidthHours, 18);
    assert.equal(arm.result.randomContinuous.truncationHours, 54);
    assert.deepEqual(arm.result.multipliers, diagnostics[RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[0]].result.multipliers);
    assert.deepEqual(arm.result.officialNoticeOverride, diagnostics[RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[0]].result.officialNoticeOverride);
    return arm;
  });
  assert.equal(new Set(arms.map((arm) => arm.result.calculatedAt)).size, 1);
});

test("pre-reset-frozen uses only history before the latest reset and excludes future resets", () => {
  const now = new Date("2026-01-08T00:00:00.000Z");
  const staticHistory = [
    resetEvent("r0", "2026-01-01T00:00:00.000Z"),
    resetEvent("r1", "2026-01-03T00:00:00.000Z"),
    resetEvent("r2", "2026-01-07T00:00:00.000Z"),
    resetEvent("future", "2026-01-09T00:00:00.000Z"),
  ];
  const boundaries = getRecoveryResetEvents(null, now, staticHistory);
  const randomBoundaries = boundaries.filter((item) => item.isRandom);
  const latest = randomBoundaries.at(-1)!;
  const expected = calculateRegimeDiagnostics(
    randomBoundaries.slice(0, -1),
    new Date(latest.resetAt),
    NEXT_GENERATION_B_FROZEN_REGIME_CONFIG,
  );
  const diagnostics = calculateRandomContinuousLateAgeRegimeDiagnostics(
    null,
    diagnosticOptions(now, staticHistory),
  );
  const preReset = diagnostics[RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION];
  assert.equal(preReset.preResetRegimeMultiplier, expected.regimeMultiplier);
  assert.equal(preReset.preResetRegimeMultiplierFallbackUsed, false);
  assert.equal(preReset.preResetRegimeMultiplierFallbackReason, null);
  assert.deepEqual(preReset.result.randomContinuous.randomBoundaryIds, ["r0", "r1", "r2"]);
});

test("pre-reset-frozen fails safe with an explicit audit reason when history is insufficient", () => {
  const diagnostics = calculateRandomContinuousLateAgeRegimeDiagnostics(
    null,
    diagnosticOptions(
      new Date("2026-01-02T00:00:00.000Z"),
      [resetEvent("only", "2026-01-01T00:00:00.000Z")],
    ),
  );
  const preReset = diagnostics[RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION];
  assert.equal(preReset.preResetRegimeMultiplier, 1);
  assert.equal(preReset.preResetRegimeMultiplierFallbackUsed, true);
  assert.equal(preReset.preResetRegimeMultiplierFallbackReason, "insufficient_random_history");
});

test("all late-age arms are omitted before freeze and saved together after freeze", () => {
  const before = new Date(Date.parse(RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT) - 1);
  const after = new Date(Date.parse(RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT) + 60_000);
  const beforeForecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: diagnosticOptions(before, []),
    existingForecasts: {},
    trainingState: trainingState(),
  });
  for (const modelVersion of RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS) {
    assert.equal(beforeForecasts[modelVersion], undefined);
  }

  const afterForecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: diagnosticOptions(after, []),
    existingForecasts: {},
    trainingState: trainingState(),
  });
  for (const modelVersion of RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS) {
    const forecast = afterForecasts[modelVersion];
    assert.ok(forecast);
    assert.equal(forecast.modelVersion, modelVersion);
    assert.equal(forecast.generatedAt, after.toISOString());
    assert.equal(forecast.experimentRole, "diagnostic");
    assert.equal(forecast.evaluationMode, "prospective");
    assert.equal(forecast.nextGenerationRole, "late-age-regime-diagnostic");
    assert.equal(forecast.backfilled, false);
    assert.equal(forecast.lateAgeStartHours, 144);
    assertFiniteMonotonic(forecast);
  }
});

test("a late-age diagnostic failure is fail-open and preserves other forecasts", () => {
  const now = new Date(Date.parse(RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT) + 60_000);
  const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: diagnosticOptions(now, []),
    existingForecasts: {},
    trainingState: trainingState(),
    lateAgeRegimeDiagnosticsCalculator: () => {
      throw new Error("induced late-age diagnostic failure");
    },
  });
  for (const modelVersion of RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS) {
    assert.equal(forecasts[modelVersion], undefined);
  }
  assert.ok(forecasts[RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION]);
});

function forecast(modelVersion: string, generatedAt: string, ageHours: number, backfilled: false | true = false) {
  return {
    modelVersion,
    generatedAt,
    probability24h: 0.2,
    probability48h: 0.35,
    baseline24h: 0.2,
    baseline48h: 0.35,
    randomElapsedHours: ageHours,
    backfilled,
  };
}

function row(generatedAt: string, options: { missingModel?: string; backfilled?: boolean } = {}): ProspectiveForecastRow {
  const forecasts = Object.fromEntries(
    RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS
      .filter((modelVersion) => modelVersion !== options.missingModel)
      .map((modelVersion) => [modelVersion, forecast(modelVersion, generatedAt, 150, options.backfilled === true)]),
  );
  return { generatedAt, loggedHour: generatedAt, forecasts };
}

test("prospective evaluator is saved-artifact-only, daily-first, and excludes malformed/pre-freeze/backfilled rows", () => {
  const firstSameDay = "2026-09-18T12:00:00.000Z";
  const laterSameDay = "2026-09-18T16:00:00.000Z";
  const nextDay = "2026-09-19T12:00:00.000Z";
  const preFreeze = new Date(Date.parse(RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT) - 1).toISOString();
  const rows = [
    row(firstSameDay),
    row(laterSameDay),
    row(nextDay),
    row("2026-09-19T16:00:00.000Z", { missingModel: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION }),
    row(preFreeze),
    row("2026-09-20T12:00:00.000Z", { backfilled: true }),
  ];
  const report = evaluateLateAgeRegimeDiagnostics(
    rows,
    [boundary("event", "2026-09-20T00:00:00.000Z")],
    new Date("2026-09-22T00:00:00.000Z"),
  );
  const control = report.models[RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION];
  assert.equal(report.status, "available");
  assert.equal(control.forecastCount, 3);
  assert.equal(control.comparableOriginCount, 3);
  assert.equal(control.dailyFirstOriginCount, 2);
  assert.equal(control.metrics24h.count, 2);
  assert.equal(control.metrics48h.count, 2);
  assert.equal(report.comparison.primary.resolved24h, 2);
  assert.equal(report.comparison.primary.resolved48h, 2);
  assert.equal(report.comparison.primary.brierDifference24h, 0);
});

test("late-age evaluator keeps primary comparison on age >= 144h and uses half-open buckets", () => {
  assert.equal(getLateAgeRegimeAgeBucket(143.999), "120-144h");
  assert.equal(getLateAgeRegimeAgeBucket(144), "144-168h");
  assert.equal(getLateAgeRegimeAgeBucket(167.999), "144-168h");
  assert.equal(getLateAgeRegimeAgeBucket(168), "168-192h");
  assert.equal(getLateAgeRegimeAgeBucket(216), ">=216h");

  const generatedAt = "2026-09-18T12:00:00.000Z";
  const rows = [row(generatedAt)];
  const report = evaluateLateAgeRegimeDiagnostics(
    rows,
    [],
    new Date("2026-09-20T12:00:00.000Z"),
  );
  assert.equal(report.comparison.primary.lateAgeResolved24h, 1);
  assert.equal(report.comparison.primary.lateAgeResolved48h, 1);
  assert.equal(report.models[RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION].ageBuckets["144-168h"].metrics24h.count, 1);
});

test("public model and public DTO remain independent of late-age diagnostic fields", () => {
  assert.equal(
    RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    "hazard-regime-random-continuous-post-reset-age-raw-bw18-tr54-v1",
  );
  const serialized = JSON.stringify({
    modelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
  });
  assert.doesNotMatch(serialized, /late-age-regime|preResetRegimeMultiplier|lateAgeStartHours/);
});

void HOUR_MS;
