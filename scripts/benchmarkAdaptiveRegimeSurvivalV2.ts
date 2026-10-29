import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { cpuUsage } from "node:process";

import {
  ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
  PUBLISHED_ADAPTIVE_REGIME_SURVIVAL_ADOPTION_AT,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import {
  calculateSurvivalConditionedContextArms,
  calculateSurvivalConditionedProbability,
  isValidSurvivalConditionedPrediction,
} from "../lib/radar/survivalConditionedProbability";
import {
  calculateAdaptiveRegimeSurvivalProbability,
} from "../lib/radar/adaptiveRegimeSurvivalProbability";
import {
  buildNextGenerationExperimentalProbabilityForecasts,
} from "../lib/nextGenerationLogging";
import { buildCanonicalResetHistoryContext } from "../lib/radar/tiboHistory";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import type { WindowEventLike } from "../lib/radar/types";
import type { NextGenerationTrainingState } from "../lib/radar/nextGenerationTraining";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-10-29T10:30:00.000Z");
const PUBLIC_LOCALES = ["ja", "en", "zh"] as const;

function makeHistory(count: number): WindowEventLike[] {
  const intervalHours = 48;
  const firstTime = NOW.getTime() - 20 * HOUR_MS - (count - 1) * intervalHours * HOUR_MS;
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(firstTime + index * intervalHours * HOUR_MS).toISOString();
    return {
      id: `benchmark-random-reset-${index}`,
      recordKind: "confirmed_global",
      title: `benchmark-random-reset-${index}`,
      kind: "reset_completed",
      status: "closed",
      scope: "全有料プラン",
      closed_at: at,
      completed_at: at,
      details: {
        cycleType: "ランダムリセット",
        resetMethod: "強制リセット",
        scope: "全有料プラン",
        noticeToExecution: "0分",
      },
    };
  });
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

function measure(label: string, iterations: number, run: () => void, beforeMeasurement: () => void = () => {}) {
  const warmups = Math.min(3, iterations);
  for (let index = 0; index < warmups; index += 1) run();
  beforeMeasurement();
  const startCpu = cpuUsage();
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) run();
  const elapsedMs = performance.now() - start;
  const cpu = cpuUsage(startCpu);
  return {
    label,
    measuredCalls: iterations,
    warmupCalls: warmups,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    elapsedMsPerCall: Number((elapsedMs / iterations).toFixed(4)),
    cpuUserMs: Number((cpu.user / 1_000).toFixed(3)),
    cpuSystemMs: Number((cpu.system / 1_000).toFixed(3)),
    cpuMsPerCall: Number(((cpu.user + cpu.system) / 1_000 / iterations).toFixed(4)),
  };
}

function main() {
  const measurementStartedAt = new Date().toISOString();

  const results: Array<Record<string, unknown>> = [];
  for (const historyCount of [37, 144]) {
    const history = makeHistory(historyCount);
    const base = calculateSurvivalConditionedProbability(null, { now: NOW, staticHistory: history });
    assert.equal(isValidSurvivalConditionedPrediction(base), true);
    const adaptive = calculateAdaptiveRegimeSurvivalProbability(base);
    assert.equal(adaptive.audit.fallbackUsed, false);
    results.push(measure(`adaptive-v2-${historyCount}-boundaries`, 40, () => {
      const result = calculateAdaptiveRegimeSurvivalProbability(base);
      assert.equal(result.audit.fallbackUsed, false);
    }));

    const data = getLocalRadarData({ calculationNow: NOW });
    const canonicalHistoryContext = buildCanonicalResetHistoryContext(data, {
      defaultStaticHistory: history,
      displayStaticHistory: history,
      dynamicStaticHistory: [],
    });
    const calculationContext = { source: data, canonicalHistoryContext };
    const publicModes = [
      { label: "null-adoption", adoptionAt: null, expectedV2Calculations: 0 },
      { label: "v2-adopted", adoptionAt: NOW.toISOString(), expectedV2Calculations: 6 },
    ] as const;
    for (const mode of publicModes) {
      const publicCalls = { dto: 0, survivalV1Fits: 0, adaptiveV2Calculations: 0 };
      const measurement = measure(`public-3-locales-${mode.label}-${historyCount}-boundaries`, 2, () => {
        for (const locale of PUBLIC_LOCALES) {
          const snapshot = toPublicRadarSnapshot(data, locale, {
            calculationNow: NOW,
            limitHistory: false,
            calculationContext,
            publishedAdaptiveRegimeSurvivalAdoptionAt: mode.adoptionAt,
            publishedProbabilityRuntime: {
              logFallback: false,
              survivalConditionedCalculator: (input, options) => {
                publicCalls.survivalV1Fits += 1;
                return calculateSurvivalConditionedProbability(input, options);
              },
              adaptiveRegimeSurvivalCalculator: (survivalBase) => {
                publicCalls.adaptiveV2Calculations += 1;
                return calculateAdaptiveRegimeSurvivalProbability(survivalBase);
              },
            },
          });
          assert.ok(Number.isFinite(snapshot.viewModel.probability24h));
          publicCalls.dto += 1;
        }
      }, () => {
        publicCalls.dto = 0;
        publicCalls.survivalV1Fits = 0;
        publicCalls.adaptiveV2Calculations = 0;
      });
      assert.equal(publicCalls.dto, 6);
      assert.equal(publicCalls.survivalV1Fits, 6);
      assert.equal(publicCalls.adaptiveV2Calculations, mode.expectedV2Calculations);
      results.push({
        ...measurement,
        publicLocaleDtoCalls: publicCalls.dto,
        survivalV1Fits: publicCalls.survivalV1Fits,
        adaptiveV2Calculations: publicCalls.adaptiveV2Calculations,
        databaseCalls: 0,
        providerCalls: 0,
      });
    }

    for (const includeAdaptiveV2 of [false, true]) {
      const loggingCalls = { survivalBase: 0, contextArmBatch: 0, adaptiveTransform: 0, adaptiveCandidateRow: 0 };
      const runLoggingPath = () => {
      const forecasts = buildNextGenerationExperimentalProbabilityForecasts({
        data: null,
        calculationOptions: { now: NOW, staticHistory: history },
        existingForecasts: {},
        trainingState: trainingState(),
        survivalConditionedCalculator: (input, options) => {
          loggingCalls.survivalBase += 1;
          return calculateSurvivalConditionedProbability(input, options);
        },
        survivalConditionedContextArmsCalculator: (input, options, baseResult) => {
          loggingCalls.contextArmBatch += 1;
          return calculateSurvivalConditionedContextArms(input, options, baseResult);
        },
        adaptiveRegimeSurvivalCalculator: includeAdaptiveV2
          ? (survivalBase) => {
              loggingCalls.adaptiveTransform += 1;
              return calculateAdaptiveRegimeSurvivalProbability(survivalBase);
            }
          : null,
      });
      if (forecasts[ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION]) loggingCalls.adaptiveCandidateRow += 1;
      };
      const label = includeAdaptiveV2 ? "v2-added" : "v1-only-baseline";
      const measurement = measure(`experimental-logging-${label}-${historyCount}-boundaries`, 1, runLoggingPath, () => {
        loggingCalls.survivalBase = 0;
        loggingCalls.contextArmBatch = 0;
        loggingCalls.adaptiveTransform = 0;
        loggingCalls.adaptiveCandidateRow = 0;
      });
      assert.equal(loggingCalls.survivalBase, 1);
      assert.equal(loggingCalls.contextArmBatch, 1);
      assert.equal(loggingCalls.adaptiveTransform, includeAdaptiveV2 ? 1 : 0);
      assert.equal(loggingCalls.adaptiveCandidateRow, includeAdaptiveV2 ? 1 : 0);
      results.push({
        ...measurement,
        survivalV1BaseFits: loggingCalls.survivalBase,
        survivalContextArmBatches: loggingCalls.contextArmBatch,
        adaptiveV2Transforms: loggingCalls.adaptiveTransform,
        adaptiveV2CandidateRows: loggingCalls.adaptiveCandidateRow,
        databaseCalls: 0,
        providerCalls: 0,
      });
    }
  }

  console.log(JSON.stringify({
    mode: "offline synthetic-history microbenchmark",
    measurementStartedAt,
    forecastOriginAt: NOW.toISOString(),
    publicProductionAdoptionBoundary: PUBLISHED_ADAPTIVE_REGIME_SURVIVAL_ADOPTION_AT,
    publicComparison: "null adoption vs explicit v2 adoption at the same origin",
    publicModel: PUBLISHED_PROBABILITY_MODEL_VERSION,
    localeTriplet: PUBLIC_LOCALES,
    results,
    note: "Measurement time is separate from the fixed forecast origin. Public and logging comparisons reuse the same history and origin; explicit adoption overrides are passed only to this offline benchmark.",
  }, null, 2));
}

main();
