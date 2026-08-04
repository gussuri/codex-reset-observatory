import assert from "node:assert/strict";
import test from "node:test";

import { SHADOW_PROBABILITY_MODEL_VERSION } from "../data/shadowProbabilityConfig";
import { buildExperimentalProbabilityForecasts, buildProbabilityDebugInfo } from "../lib/logProbability";
import { calculateShadowProbability } from "../lib/radar/shadowProbability";
import { getLocalProbabilityCalculation } from "../lib/radar/probability";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";

test("internal forecast audit stores v2 and all fixed recency models without duplicate model keys", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");
  const data = getLocalRadarData({ calculationNow: now });
  const primary = getLocalProbabilityCalculation(data, { now });
  const shadow = calculateShadowProbability(data, { now });
  const forecasts = buildExperimentalProbabilityForecasts(data, {
    now,
    shadowProbability: shadow,
  });

  assert.deepEqual(Object.keys(forecasts), [
    "hazard-odds-v2-random-only",
    "hazard-odds-v3-recency-bayes-h14-r2",
    "hazard-odds-v3-recency-bayes-h30-r2",
    "hazard-odds-v3-recency-bayes-h60-r2",
  ]);
  assert.equal(forecasts[SHADOW_PROBABILITY_MODEL_VERSION].generatedAt, now.toISOString());
  assert.equal(forecasts[SHADOW_PROBABILITY_MODEL_VERSION].probability24h, shadow.predictions.probability24h);
  for (const forecast of Object.values(forecasts)) {
    assert.equal(forecast.generatedAt, now.toISOString());
    assert.ok(forecast.completedEventCount >= forecast.completedIntervalCount);
    assert.ok(forecast.weightedEventCount >= 0);
    assert.ok(forecast.weightedExposureDays >= 0);
    assert.ok(forecast.probability48h >= forecast.probability24h);
    assert.equal(forecast.targetDefinition, shadow.targetDefinition);
  }

  const debugInfo = buildProbabilityDebugInfo(
    {},
    primary,
    now.toISOString(),
    now,
    shadow,
    undefined,
    forecasts,
  );
  assert.deepEqual(Object.keys(debugInfo.experimentalProbabilityForecasts as object), Object.keys(forecasts));
  assert.doesNotMatch(JSON.stringify(toPublicRadarSnapshot(data, "en", { calculationNow: now })), /hazard-odds-v3-recency/);
});
