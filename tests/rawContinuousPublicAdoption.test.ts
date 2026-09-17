import assert from "node:assert/strict";
import test from "node:test";

import {
  CALIBRATED_SHADOW_MODEL_VERSION,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import { getLocalRadarData } from "../lib/radar";
import { getLocalProbabilityCalculation } from "../lib/radar/probability";
import {
  calculatePublishedProbability,
  getPublishedProbabilityPeriodAt,
  selectPublishedProbability,
} from "../lib/radar/publishedProbability";
import { calculateRandomContinuousBandwidthShadowPair } from "../lib/radar/randomContinuousBandwidthShadow";
import { calculateRegimeElapsedProbability } from "../lib/radar/regimeElapsedProbability";
import { PUBLISHED_ELAPSED_MODEL_OPTIONS } from "../data/shadowProbabilityConfig";
import type { WindowEventLike } from "../lib/radar/types";

const ROLLBACK_AT = "2026-09-11T02:20:00.000Z";
const ADOPTION_AT = "2026-09-17T12:00:00.000Z";

function resetEvent(id: string, completedAt: string): WindowEventLike {
  return {
    id,
    recordKind: "confirmed_global",
    title: "ランダムリセット",
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

function isFiniteMonotonic(predictions: {
  probability12h: number;
  probability24h: number;
  probability48h: number;
  probability72h: number;
}) {
  return [
    predictions.probability12h,
    predictions.probability24h,
    predictions.probability48h,
    predictions.probability72h,
  ].every(Number.isFinite)
    && predictions.probability12h <= predictions.probability24h
    && predictions.probability24h <= predictions.probability48h
    && predictions.probability48h <= predictions.probability72h;
}

test("raw continuous public adoption is boundary-defined and uses the frozen challenger", () => {
  const before = new Date("2026-09-17T11:59:59.999Z");
  const exact = new Date(ADOPTION_AT);
  const data = getLocalRadarData({ calculationNow: exact });
  const beforeResult = calculatePublishedProbability(data, {
    now: before,
    publishedRawContinuousAdoptionAt: ADOPTION_AT,
    publishedV4RollbackAt: ROLLBACK_AT,
  }, { logFallback: false });
  const exactResult = calculatePublishedProbability(data, {
    now: exact,
    publishedRawContinuousAdoptionAt: ADOPTION_AT,
    publishedV4RollbackAt: ROLLBACK_AT,
  }, { logFallback: false });
  const pair = calculateRandomContinuousBandwidthShadowPair(data, { now: exact });

  assert.equal(beforeResult.adoptedModel, CALIBRATED_SHADOW_MODEL_VERSION);
  assert.equal(exactResult.adoptedModel, RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION);
  assert.equal(exactResult.adoptedModel, PUBLISHED_PROBABILITY_MODEL_VERSION);
  assert.equal(exactResult.source, "raw-continuous");
  assert.equal(exactResult.fallbackReason, null);
  assert.deepEqual(exactResult.rawContinuous?.predictions, pair.challenger.predictions);
  assert.ok(exactResult.rawContinuous);
  assert.ok(isFiniteMonotonic(exactResult.rawContinuous.predictions));
});

test("raw continuous adoption has its own published period", () => {
  assert.equal(
    getPublishedProbabilityPeriodAt("2026-09-17T11:59:59.999Z", {
      rawContinuousAdoptionAt: ADOPTION_AT,
    }),
    "corrective-rollback-v4",
  );
  assert.equal(
    getPublishedProbabilityPeriodAt(ADOPTION_AT, {
      rawContinuousAdoptionAt: ADOPTION_AT,
    }),
    "raw-continuous-18-54",
  );
});

test("long-age publication uses the direct 18/54 challenger instead of calibrated V4", () => {
  const now = new Date("2026-09-05T18:00:00.000Z");
  const staticHistory = [
    resetEvent("random-1", "2026-08-20T00:00:00.000Z"),
    resetEvent("random-2", "2026-08-24T00:00:00.000Z"),
    resetEvent("random-3", "2026-08-28T00:00:00.000Z"),
    resetEvent("random-4", "2026-09-01T00:00:00.000Z"),
  ];
  const data = getLocalRadarData({ calculationNow: now });
  const options = {
    now,
    staticHistory,
    activeOfficialNotice: null,
    publishedRawContinuousAdoptionAt: "2026-09-01T00:00:00.000Z",
    publishedV4RollbackAt: "2026-09-01T00:00:00.000Z",
  };
  const published = calculatePublishedProbability(data, options, { logFallback: false });
  const pair = calculateRandomContinuousBandwidthShadowPair(data, options);

  assert.equal(published.adoptedModel, RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION);
  assert.equal(published.probability48h, pair.challenger.predictions.probability48h);
  assert.ok(published.calibrated);
  assert.notEqual(published.probability48h, published.calibrated.probability48h);
});

test("raw challenger failure falls back to corrective V4 without exposing shadow B failure", () => {
  const now = new Date(ADOPTION_AT);
  const data = getLocalRadarData({ calculationNow: now });
  const current = calculatePublishedProbability(data, {
    now,
    publishedRawContinuousAdoptionAt: ADOPTION_AT,
    publishedV4RollbackAt: ROLLBACK_AT,
  }, { logFallback: false });
  const primary = getLocalProbabilityCalculation(data, { now });
  const stable = calculateRegimeElapsedProbability(data, { now }, PUBLISHED_ELAPSED_MODEL_OPTIONS);
  assert.ok(current.calibrated);
  assert.ok(current.rawContinuous);

  const invalidRaw = {
    ...current.rawContinuous,
    predictions: {
      ...current.rawContinuous.predictions,
      probability24h: Number.NaN,
    },
  };
  const selected = selectPublishedProbability(
    primary,
    current.calibrated,
    stable,
    "next_generation_b_exception",
    null,
    current.rawShadow,
    current.nextGenerationB,
    {
      allowNextGenerationB: false,
      allowRawContinuous: true,
      rawContinuous: invalidRaw,
      rawContinuousFailureReason: "raw_continuous_invalid_prediction",
    },
  );

  assert.equal(selected.adoptedModel, CALIBRATED_SHADOW_MODEL_VERSION);
  assert.equal(selected.source, "calibrated");
  assert.equal(selected.fallbackReason, "raw_continuous_invalid_prediction");
  assert.notEqual(selected.fallbackReason, "next_generation_b_exception");

  const exceptionSelected = selectPublishedProbability(
    primary,
    current.calibrated,
    stable,
    "next_generation_b_invalid_prediction",
    null,
    current.rawShadow,
    current.nextGenerationB,
    {
      allowNextGenerationB: false,
      allowRawContinuous: true,
      rawContinuousFailureReason: "raw_continuous_exception",
    },
  );
  assert.equal(exceptionSelected.adoptedModel, CALIBRATED_SHADOW_MODEL_VERSION);
  assert.equal(exceptionSelected.fallbackReason, "raw_continuous_exception");

  const invalidV4Selected = selectPublishedProbability(
    primary,
    { ...current.calibrated, probability24h: Number.NaN },
    stable,
    "next_generation_b_invalid_prediction",
    null,
    current.rawShadow,
    current.nextGenerationB,
    {
      allowNextGenerationB: false,
      allowRawContinuous: true,
      rawContinuousFailureReason: "raw_continuous_invalid_prediction",
    },
  );
  assert.equal(invalidV4Selected.source, "stable-shadow-fallback");
  assert.equal(invalidV4Selected.fallbackReason, "calibrated_invalid_prediction");
});
