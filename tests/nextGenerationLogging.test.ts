import assert from "node:assert/strict";
import test from "node:test";

import {
  CALIBRATED_SHADOW_MODEL_VERSION,
  NEXT_GENERATION_A_COMPONENT_VERSIONS,
  NEXT_GENERATION_A_MODEL_VERSION,
  NEXT_GENERATION_B_MODEL_VERSION,
  NEXT_GENERATION_FREEZE_AT,
  RECENCY_H30_PROBABILITY_MODEL_VERSION,
  REGIME_ELAPSED_FULL_MODEL_VERSION,
  RANDOM_ELAPSED_SHADOW_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import {
  buildNextGenerationExperimentalProbabilityForecasts,
} from "../lib/nextGenerationLogging";
import type { ExperimentalProbabilityForecasts } from "../lib/logProbability";
import type { NextGenerationTrainingState } from "../lib/radar/nextGenerationTraining";

function existingForecasts(): ExperimentalProbabilityForecasts {
  const entries: Array<[string, ExperimentalProbabilityForecasts[string]]> = [
    [CALIBRATED_SHADOW_MODEL_VERSION, 0.2],
    [REGIME_ELAPSED_FULL_MODEL_VERSION, 0.25],
    [RANDOM_ELAPSED_SHADOW_MODEL_VERSION, 0.3],
    [RECENCY_H30_PROBABILITY_MODEL_VERSION, 0.35],
  ].map(([modelVersion, probability]) => [modelVersion, {
    modelVersion,
    generatedAt: "2026-08-22T03:00:00.000Z",
    probability24h: probability,
    probability48h: Number(probability) + 0.1,
    halfLifeDays: null,
    completedEventCount: 10,
    completedIntervalCount: 9,
    weightedEventCount: 10,
    weightedExposureDays: 20,
    baseline24h: probability,
    baseline48h: Number(probability) + 0.1,
    combinedSignalMultiplier24h: 1,
    combinedSignalMultiplier48h: 1,
    officialNoticeOverride: false,
    targetDefinition: "completed broad random reset",
  }] as [string, ExperimentalProbabilityForecasts[string]]);
  return Object.fromEntries(entries);
}

function state(status: "ok" | "error"): NextGenerationTrainingState {
  return {
    status,
    reason: status === "error" ? "prediction_history query failed" : null,
    bRows: [],
    aRows: [],
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

test("logging adds B and exact five-component A without changing existing forecasts", () => {
  const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: { now: new Date("2026-08-22T03:00:00.000Z") },
    existingForecasts: existingForecasts(),
    trainingState: state("ok"),
  });

  assert.ok(forecasts[NEXT_GENERATION_B_MODEL_VERSION]);
  assert.ok(forecasts[NEXT_GENERATION_A_MODEL_VERSION]);
  assert.deepEqual(
    forecasts[NEXT_GENERATION_A_MODEL_VERSION].componentModelVersions,
    [...NEXT_GENERATION_A_COMPONENT_VERSIONS],
  );
  assert.equal(forecasts[NEXT_GENERATION_A_MODEL_VERSION].trainingMode24h, "equal");
  assert.equal(forecasts[NEXT_GENERATION_A_MODEL_VERSION].trainingMode48h, "equal");
  assert.equal(forecasts[CALIBRATED_SHADOW_MODEL_VERSION].probability24h, 0.2);
});

test("training DB failure preserves B fallback audit and omits A", () => {
  const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: { now: new Date("2026-08-22T03:00:00.000Z") },
    existingForecasts: existingForecasts(),
    trainingState: state("error"),
  });

  assert.equal(forecasts[NEXT_GENERATION_B_MODEL_VERSION].trainingReadStatus, "error");
  assert.equal(forecasts[NEXT_GENERATION_B_MODEL_VERSION].fallbackUsed, true);
  assert.equal(forecasts[NEXT_GENERATION_A_MODEL_VERSION], undefined);
});

test("logging does not create pre-freeze forecasts", () => {
  const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: { now: new Date(new Date(NEXT_GENERATION_FREEZE_AT).getTime() - 1) },
    existingForecasts: existingForecasts(),
    trainingState: state("ok"),
  });
  assert.equal(forecasts[NEXT_GENERATION_B_MODEL_VERSION], undefined);
  assert.equal(forecasts[NEXT_GENERATION_A_MODEL_VERSION], undefined);
});
