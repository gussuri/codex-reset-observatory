import assert from "node:assert/strict";
import test from "node:test";

import {
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_COMMON_OPTIONS,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_TRUNCATION_HOURS,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import { buildNextGenerationExperimentalProbabilityForecasts } from "../lib/nextGenerationLogging";
import type { ExperimentalProbabilityForecasts } from "../lib/logProbability";
import { getLocalRadarData } from "../lib/radar";
import {
  buildRandomContinuousHazard,
  getRandomContinuousHazardDiagnosticsAtAge,
} from "../lib/radar/randomContinuousProbability";
import {
  calculateRandomContinuousBandwidthAgeDiagnostics,
} from "../lib/radar/randomContinuousBandwidthAgeDiagnostics";
import {
  evaluateRandomContinuousBandwidthAgeDiagnostics,
  getRandomContinuousBandwidthAgeBucket,
  summarizeRandomResetIntervals,
} from "../lib/radar/prospectiveRandomBandwidthAgeDiagnostics";
import {
  calculateRandomContinuousBandwidthShadowPair,
} from "../lib/radar/randomContinuousBandwidthShadow";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import type { RecoveryResetBoundary } from "../lib/radar/recoveryBoundary";
import type { ProspectiveForecastRow } from "../lib/radar/prospectiveProbabilityEvaluation";

const HOUR_MS = 60 * 60 * 1000;

function boundary(
  id: string,
  resetAt: string,
  isRandom = true,
  isRegular = false,
): RecoveryResetBoundary {
  return { id, resetAt, isRandom, isRegular, sourceIds: [id] };
}

function trainingState() {
  return {
    status: "ok" as const,
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
    backfill: false as const,
  };
}

function diagnosticForecasts(generatedAt: string): ExperimentalProbabilityForecasts {
  return Object.fromEntries(RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS.map((modelVersion) => [
    modelVersion,
    {
      modelVersion,
      generatedAt,
      probability24h: 0.3,
      probability48h: 0.5,
      baseline24h: 0.2,
      baseline48h: 0.4,
      randomElapsedHours: 130,
    },
  ])) as unknown as ExperimentalProbabilityForecasts;
}

function row(generatedAt: string): ProspectiveForecastRow {
  return { generatedAt, loggedHour: generatedAt, forecasts: diagnosticForecasts(generatedAt) };
}

test("diagnostic family has five bandwidths with one fixed truncation and shared options", () => {
  assert.deepEqual([...RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS], [6, 9, 12, 18, 24]);
  assert.equal(RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_TRUNCATION_HOURS, 54);
  assert.equal(RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS.length, 5);
  for (const bandwidthHours of RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS) {
    assert.equal(RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_COMMON_OPTIONS.truncationHours, 54);
    assert.equal(RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_COMMON_OPTIONS.regimeMultiplierPolicy, NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION);
    assert.equal(typeof bandwidthHours, "number");
  }
});

test("all five diagnostics share one origin and bw18 matches the existing raw challenger", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const staticHistory = [
    boundary("random-a", "2026-09-10T12:00:00.000Z"),
    boundary("random-b", "2026-09-13T12:00:00.000Z"),
  ];
  const data = getLocalRadarData({ calculationNow: now });
  const pair = calculateRandomContinuousBandwidthShadowPair(data, {
    now,
    staticHistory,
    activeOfficialNotice: null,
  });
  const diagnostics = calculateRandomContinuousBandwidthAgeDiagnostics(data, {
    now,
    staticHistory,
    activeOfficialNotice: null,
  }, undefined, pair.challenger);
  const results = Object.values(diagnostics);

  assert.equal(results.length, 5);
  assert.ok(results.every((result) => result.calculatedAt === now.toISOString()));
  assert.ok(results.every((result) => result.randomContinuous.truncationHours === 54));
  assert.ok(results.every((result) => result.randomContinuous.regimeMultiplierPolicyVersion === NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION));
  assert.ok(results.every((result) => result.predictions.probability24h <= result.predictions.probability48h));
  assert.ok(results.every((result) => result.predictions.probability48h <= result.predictions.probability72h));

  const bw18 = diagnostics[
    "hazard-regime-random-continuous-post-reset-age-raw-bw18-tr54-age-diagnostic-v1"
  ];
  assert.equal(bw18.randomContinuous.bandwidthHours, 18);
  assert.deepEqual(bw18.predictions, pair.challenger.predictions);
  assert.deepEqual(bw18.baseline, pair.challenger.baseline);
  assert.equal(PUBLISHED_PROBABILITY_MODEL_VERSION, BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION);
});

test("diagnostic forecasts are persisted after their freeze and omitted before it", () => {
  const after = new Date(Date.parse(RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT) + 60_000);
  const before = new Date(Date.parse(RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT) - 1);
  const afterForecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: { now: after, staticHistory: [], activeOfficialNotice: null },
    existingForecasts: {},
    trainingState: trainingState(),
  });
  const beforeForecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: { now: before, staticHistory: [], activeOfficialNotice: null },
    existingForecasts: {},
    trainingState: trainingState(),
  });

  for (const modelVersion of RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS) {
    const forecast = afterForecasts[modelVersion];
    assert.ok(forecast, `${modelVersion} is saved`);
    assert.equal(forecast.generatedAt, after.toISOString());
    assert.equal(forecast.experimentRole, "diagnostic");
    assert.equal(forecast.evaluationMode, "prospective");
    assert.equal(forecast.freezeAt, RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT);
    assert.equal(forecast.freezePolicy?.includes("no historical backfill"), true);
    assert.ok(Number.isFinite(forecast.baseline24h));
    assert.ok(Number.isFinite(forecast.baseline48h));
    assert.ok(Number.isFinite(forecast.probability24h));
    assert.ok(Number.isFinite(forecast.probability48h));
  }
  for (const modelVersion of RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS) {
    assert.equal(beforeForecasts[modelVersion], undefined);
  }
});

test("bandwidth age diagnostic audit stays out of the public snapshot", () => {
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({ calculationNow: new Date("2026-09-20T12:00:00.000Z") }),
    "ja",
  );
  const serialized = JSON.stringify(snapshot);
  for (const value of [
    "candidate-c-v2",
    "circadianNormalizationConstant",
    "RANDOM_BANDWIDTH_AGE_DIAGNOSTIC",
    ...RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS,
  ]) {
    assert.equal(serialized.includes(value), false, `${value} remains internal`);
  }
});

test("age bucket boundaries are explicit and half-open", () => {
  assert.equal(getRandomContinuousBandwidthAgeBucket(-1), null);
  assert.equal(getRandomContinuousBandwidthAgeBucket(119.999), "<120h");
  assert.equal(getRandomContinuousBandwidthAgeBucket(120), "120-144h");
  assert.equal(getRandomContinuousBandwidthAgeBucket(143.999), "120-144h");
  assert.equal(getRandomContinuousBandwidthAgeBucket(144), "144-168h");
  assert.equal(getRandomContinuousBandwidthAgeBucket(168), "168-192h");
  assert.equal(getRandomContinuousBandwidthAgeBucket(192), "192-216h");
  assert.equal(getRandomContinuousBandwidthAgeBucket(216), ">=216h");
});

test("historical interval summary includes current right-censored exposure", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const boundaries = [
    boundary("random-0", new Date(start).toISOString()),
    boundary("random-1", new Date(start + 120 * HOUR_MS).toISOString()),
  ];
  const summary = summarizeRandomResetIntervals(boundaries, new Date(start + 170 * HOUR_MS));
  const totalExposure = summary.reduce((sum, bucket) => sum + bucket.atRiskExposureHours, 0);
  const eventBucket = summary.find((bucket) => bucket.ageBucket === "120-144h");

  assert.equal(totalExposure, 170);
  assert.equal(eventBucket?.eventCount, 1);
  assert.ok(summary.every((bucket) => Number.isFinite(bucket.crudeRatePerHour)));
});

test("prospective evaluator reports baseline and final metrics by saved age bucket", () => {
  const generatedTime = Date.parse(RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT) + HOUR_MS;
  const generatedAt = new Date(generatedTime).toISOString();
  const eventAt = new Date(generatedTime + 12 * HOUR_MS).toISOString();
  const report = evaluateRandomContinuousBandwidthAgeDiagnostics(
    [row(generatedAt)],
    [
      boundary("prior", new Date(generatedTime - 120 * HOUR_MS).toISOString()),
      boundary("event", eventAt),
    ],
    new Date(generatedTime + 72 * HOUR_MS),
  );
  const model = report.models[RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS[0]];

  assert.equal(report.evaluationMode, "prospective");
  assert.equal(report.backfilled, false);
  assert.equal(model.metrics24h.final.count, 1);
  assert.equal(model.metrics24h.final.positiveCount, 1);
  assert.equal(model.metrics24h.final.averagePrediction, 0.3);
  assert.equal(model.metrics24h.baseline.averagePrediction, 0.2);
  assert.equal(model.ageBuckets.find((bucket) => bucket.ageBucket === "120-144h")?.metrics24h.final.count, 1);
  assert.equal(model.ageBuckets.find((bucket) => bucket.ageBucket === "120-144h")?.metrics48h.final.count, 1);
});

test("synthetic cliff has a sharper narrow-bandwidth hazard gradient without a winner rule", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const intervals = [24, 48, 72, 96, 180, 176, 184, 186];
  const boundaries = [boundary("r0", new Date(start).toISOString())];
  let cursor = start;
  for (let index = 0; index < intervals.length; index += 1) {
    const intervalHours = intervals[index];
    cursor += intervalHours * HOUR_MS;
    boundaries.push(boundary(`r${index + 1}`, new Date(cursor).toISOString()));
  }
  const now = new Date(cursor + 240 * HOUR_MS);
  const dailyAtAge = (bandwidthHours: number, ageHours: number) => {
    const hazard = buildRandomContinuousHazard(boundaries, now, {
      ...RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_COMMON_OPTIONS,
      bandwidthHours,
    });
    return getRandomContinuousHazardDiagnosticsAtAge(hazard, ageHours).dailyProbability;
  };
  const narrowGradient = dailyAtAge(6, 168) - dailyAtAge(6, 160);
  const broadGradient = dailyAtAge(24, 168) - dailyAtAge(24, 160);

  assert.ok(Number.isFinite(narrowGradient));
  assert.ok(Number.isFinite(broadGradient));
  assert.ok(narrowGradient > broadGradient);
});
