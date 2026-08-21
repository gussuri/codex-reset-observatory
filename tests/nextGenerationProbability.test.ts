import assert from "node:assert/strict";
import test from "node:test";

import {
  NEXT_GENERATION_A_MODEL_VERSION,
  NEXT_GENERATION_B_MODEL_VERSION,
  NEXT_GENERATION_FREEZE_AT,
  NEXT_GENERATION_FREEZE_POLICY,
  calculateNextGenerationBProbability,
  enforceNextGenerationHorizonCoherence,
  selectNextGenerationCalibrationRows,
} from "../lib/radar/nextGenerationProbability";
import { getLocalRadarData } from "../lib/radar";

test("next-generation model versions and freeze metadata are preregistered", () => {
  assert.equal(NEXT_GENERATION_A_MODEL_VERSION, "hazard-ensemble-logit-stack-v1");
  assert.equal(NEXT_GENERATION_B_MODEL_VERSION, "hazard-regime-random-continuous-calibrated-v1");
  assert.equal(NEXT_GENERATION_FREEZE_AT, "2026-08-21T03:27:00.000Z");
  assert.equal(
    NEXT_GENERATION_FREEZE_POLICY,
    "A single reset, miss, or new observation must not trigger retuning.",
  );
});

test("next-generation horizon coherence never lowers 24h", () => {
  assert.deepEqual(enforceNextGenerationHorizonCoherence(0.4, 0.2), {
    probability24h: 0.4,
    probability48h: 0.4,
    adjusted: true,
  });
  assert.deepEqual(enforceNextGenerationHorizonCoherence(0.2, 0.4), {
    probability24h: 0.2,
    probability48h: 0.4,
    adjusted: false,
  });
});

test("B calibration rows are freeze-boundary and JST daily-first only", () => {
  const rows = selectNextGenerationCalibrationRows([
    {
      generatedAt: "2026-08-21T03:26:59.000Z",
      modelVersion: NEXT_GENERATION_B_MODEL_VERSION,
      rawProbability24h: 0.1,
      rawProbability48h: 0.2,
    },
    {
      generatedAt: "2026-08-21T04:00:00.000Z",
      modelVersion: NEXT_GENERATION_B_MODEL_VERSION,
      rawProbability24h: 0.2,
      rawProbability48h: 0.3,
    },
    {
      generatedAt: "2026-08-21T04:30:00.000Z",
      modelVersion: NEXT_GENERATION_B_MODEL_VERSION,
      rawProbability24h: 0.3,
      rawProbability48h: 0.4,
    },
    {
      generatedAt: "2026-08-22T01:00:00.000Z",
      modelVersion: NEXT_GENERATION_B_MODEL_VERSION,
      rawProbability24h: 0.4,
      rawProbability48h: 0.5,
    },
  ], new Date("2026-08-22T03:00:00.000Z"));

  assert.deepEqual(rows.map((row) => row.generatedAt), [
    "2026-08-21T04:00:00.000Z",
    "2026-08-22T01:00:00.000Z",
  ]);
});

test("B cold start uses zero alpha and keeps the random clock across regular recovery", () => {
  const now = new Date("2026-08-22T03:00:00.000Z");
  const result = calculateNextGenerationBProbability(
    getLocalRadarData({ calculationNow: now }),
    { now, trainingRows: [], trainingReadStatus: "ok" },
  );

  assert.equal(result.modelVersion, NEXT_GENERATION_B_MODEL_VERSION);
  assert.equal(result.alpha24h, 0);
  assert.equal(result.alpha48h, 0);
  assert.equal(result.calibrationSampleCount24h, 0);
  assert.equal(result.calibrationSampleCount48h, 0);
  assert.ok(result.predictions.probability48h >= result.predictions.probability24h);
  assert.equal(result.randomContinuous.randomElapsedHours >= 0, true);
});

