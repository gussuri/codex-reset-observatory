import assert from "node:assert/strict";
import test from "node:test";

import {
  NEXT_GENERATION_FREEZE_AT,
  SURVIVAL_CONDITIONED_FREEZE_AT,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  SURVIVAL_CONTEXT_MODEL_VERSIONS,
} from "../data/shadowProbabilityConfig";
import {
  buildNextGenerationExperimentalProbabilityForecasts,
} from "../lib/nextGenerationLogging";
import {
  calculateSurvivalConditionedProbability,
  type SurvivalConditionedContextArm,
} from "../lib/radar/survivalConditionedProbability";
import type { WindowEventLike } from "../lib/radar/types";
import type { NextGenerationTrainingState } from "../lib/radar/nextGenerationTraining";

function resetEvent(id: string, completedAt: string): WindowEventLike {
  return {
    id,
    recordKind: "confirmed_global",
    title: id,
    kind: "reset_completed",
    status: "closed",
    scope: "全有料プラン",
    closed_at: completedAt,
    completed_at: completedAt,
    details: {
      cycleType: "ランダムリセット",
      resetMethod: "強制リセット",
      scope: "全有料プラン",
      noticeToExecution: "0分",
    },
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

test("post-freeze logging stores survival base and every context arm at one origin", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");
  const staticHistory = [
    resetEvent("r0", "2026-08-20T00:00:00.000Z"),
    resetEvent("r1", "2026-08-25T00:00:00.000Z"),
    resetEvent("r2", "2026-09-01T00:00:00.000Z"),
    resetEvent("r3", "2026-09-10T00:00:00.000Z"),
  ];
  const base = calculateSurvivalConditionedProbability(null, { now, staticHistory });
  assert.ok(base.hazard.completedIntervalCount > 0);

  const contextArms = Object.fromEntries(SURVIVAL_CONTEXT_MODEL_VERSIONS.map((modelVersion, index) => [
    modelVersion,
    {
      modelVersion,
      contextArm: [
        "previous-interval",
        "circadian",
        "previous-interval-circadian",
        "burst",
        "old-regime",
      ][index] as SurvivalConditionedContextArm["contextArm"],
      calculatedAt: now.toISOString(),
      predictions: base.predictions,
      baseline: base.baseline,
      base,
      contextFit: null,
      contextMultiplierAtOrigin: 1,
    } satisfies SurvivalConditionedContextArm,
  ]));

  const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: { now, staticHistory },
    existingForecasts: {},
    trainingState: trainingState(),
    survivalConditionedCalculator: () => base,
    survivalConditionedContextArmsCalculator: () => contextArms,
  });

  const expectedVersions = [SURVIVAL_CONDITIONED_MODEL_VERSION, ...SURVIVAL_CONTEXT_MODEL_VERSIONS];
  assert.deepEqual(
    expectedVersions.map((modelVersion) => forecasts[modelVersion]?.modelVersion),
    expectedVersions,
  );
  for (const modelVersion of expectedVersions) {
    const forecast = forecasts[modelVersion];
    assert.ok(forecast);
    assert.equal(forecast.generatedAt, now.toISOString());
    assert.equal(forecast.freezeAt, SURVIVAL_CONDITIONED_FREEZE_AT);
    assert.equal(forecast.nextGenerationRole, "survival-conditioned-shadow");
    assert.equal(forecast.backfilled, false);
    assert.equal(forecast.survivalConditioned?.liveIntervalIncludedInTraining, false);
  }
});

test("survival logging does not create a pre-freeze artifact", () => {
  const now = new Date(new Date(SURVIVAL_CONDITIONED_FREEZE_AT).getTime() - 1);
  const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: { now },
    existingForecasts: {},
    trainingState: trainingState(),
    survivalConditionedCalculator: () => {
      throw new Error("survival calculator must not run before its freeze");
    },
  });
  assert.equal(forecasts[SURVIVAL_CONDITIONED_MODEL_VERSION], undefined);
  assert.ok(now.getTime() >= new Date(NEXT_GENERATION_FREEZE_AT).getTime());
});

test("a context-arm failure keeps the valid survival base artifact", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");
  const staticHistory = [
    resetEvent("r0", "2026-08-20T00:00:00.000Z"),
    resetEvent("r1", "2026-08-25T00:00:00.000Z"),
    resetEvent("r2", "2026-09-01T00:00:00.000Z"),
    resetEvent("r3", "2026-09-10T00:00:00.000Z"),
  ];
  const base = calculateSurvivalConditionedProbability(null, { now, staticHistory });
  const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
    data: null,
    calculationOptions: { now, staticHistory },
    existingForecasts: {},
    trainingState: trainingState(),
    survivalConditionedCalculator: () => base,
    survivalConditionedContextArmsCalculator: () => {
      throw new Error("context fit failure");
    },
  });

  assert.equal(forecasts[SURVIVAL_CONDITIONED_MODEL_VERSION]?.modelVersion, SURVIVAL_CONDITIONED_MODEL_VERSION);
  assert.ok(Object.values(forecasts).some((forecast) => forecast.survivalContextArm === "base"));
  assert.equal(
    Object.values(forecasts).some((forecast) => forecast.survivalContextArm === "circadian"),
    false,
  );
});
