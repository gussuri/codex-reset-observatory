import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_SHADOW_PROBABILITY_MODEL_VERSION,
  PUBLISHED_REGIME_ELAPSED_MODEL_OPTIONS,
  SHADOW_PROBABILITY_MODEL_VERSION,
  RANDOM_ELAPSED_SHADOW_MODEL_VERSION,
  RANDOM_ELAPSED_SHADOW_TARGET_DEFINITION,
} from "../data/shadowProbabilityConfig";
import { buildExperimentalProbabilityForecasts, buildProbabilityDebugInfo } from "../lib/logProbability";
import { calculateShadowProbability } from "../lib/radar/shadowProbability";
import { getLocalProbabilityCalculation } from "../lib/radar/probability";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import { calculateRegimeElapsedProbability } from "../lib/radar/regimeElapsedProbability";

test("internal forecast audit stores the inclusive model and all fixed recency models without duplicate keys", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");
  const data = getLocalRadarData({ calculationNow: now });
  const primary = getLocalProbabilityCalculation(data, { now });
  const shadow = calculateShadowProbability(data, { now });
  const forecasts = buildExperimentalProbabilityForecasts(data, {
    now,
    shadowProbability: shadow,
  });

  assert.deepEqual(Object.keys(forecasts), [
    "hazard-odds-v3-random-inclusive",
    "hazard-odds-v3-recency-bayes-h14-r2",
    "hazard-odds-v3-recency-bayes-h30-r3",
    "hazard-odds-v3-recency-bayes-h60-r2",
    "hazard-regime-elapsed-v1",
    RANDOM_ELAPSED_SHADOW_MODEL_VERSION,
    "hazard-odds-v4-logit-calibrated-prequential-v2",
  ]);
  assert.equal(forecasts[SHADOW_PROBABILITY_MODEL_VERSION].generatedAt, now.toISOString());
  assert.equal(forecasts[SHADOW_PROBABILITY_MODEL_VERSION].probability24h, shadow.predictions.probability24h);
  assert.equal(forecasts[SHADOW_PROBABILITY_MODEL_VERSION].probability12h, shadow.predictions.probability12h);
  assert.equal(forecasts[SHADOW_PROBABILITY_MODEL_VERSION].probability72h, shadow.predictions.probability72h);
  const regimeElapsed = forecasts["hazard-regime-elapsed-v1"];
  assert.equal(regimeElapsed.modelVersion, "hazard-regime-elapsed-v1");
  assert.equal(regimeElapsed.halfLifeDays, null);
  assert.ok(regimeElapsed.probability24h >= 0);
  assert.ok(regimeElapsed.probability48h >= regimeElapsed.probability24h);
  assert.equal(typeof regimeElapsed.regimeMultiplier, "number");
  assert.equal(typeof regimeElapsed.recentRatePerDay, "number");
  assert.equal(typeof regimeElapsed.longTermRatePerDay, "number");
  assert.equal(typeof regimeElapsed.elapsedHoursSinceRecovery, "number");
  assert.equal(regimeElapsed.selectedBinScheme, "A");
  assert.equal(regimeElapsed.selectedPriorExposureDays, 2);
  assert.equal(regimeElapsed.selectedRegimeHalfLifeDays, 3);
  assert.equal(regimeElapsed.selectedRegimeRatioExponent, 1);
  const explicitPublished = calculateRegimeElapsedProbability(
    data,
    { now },
    PUBLISHED_REGIME_ELAPSED_MODEL_OPTIONS,
  );
  assert.equal(explicitPublished.regimeElapsed.regime.priorExposureDays, 2);
  assert.equal(regimeElapsed.probability24h, explicitPublished.predictions.probability24h);
  assert.equal(regimeElapsed.probability48h, explicitPublished.predictions.probability48h);
  const randomElapsed = forecasts[RANDOM_ELAPSED_SHADOW_MODEL_VERSION];
  assert.equal(randomElapsed.modelVersion, RANDOM_ELAPSED_SHADOW_MODEL_VERSION);
  assert.equal(typeof randomElapsed.randomElapsedHours, "number");
  assert.equal(typeof randomElapsed.recoveryElapsedHours, "number");
  assert.equal(typeof randomElapsed.randomBoundaryCount, "number");
  assert.equal(typeof randomElapsed.regularBoundaryCount, "number");
  assert.equal(randomElapsed.freezeAt, "2026-08-11T18:38:51.000Z");
  const calibrated = forecasts["hazard-odds-v4-logit-calibrated-prequential-v2"];
  assert.equal(calibrated.rawModelVersion, "hazard-odds-v3-random-inclusive");
  assert.equal(calibrated.evaluationMode, "prospective");
  assert.equal(typeof calibrated.alpha24h, "number");
  assert.equal(typeof calibrated.alpha48h, "number");
  assert.equal(typeof calibrated.calibrationSampleCount24h, "number");
  assert.equal(typeof calibrated.positiveCalibrationCount48h, "number");
  assert.equal(typeof calibrated.horizonCoherenceAdjusted, "boolean");
  assert.equal(typeof calibrated.fallbackUsed, "boolean");
  assert.equal(calibrated.pointInTimeProjectionVersion, "status-conservative-v2");
  assert.equal(
    forecasts["hazard-odds-v4-logit-calibrated-prequential-v1"],
    undefined,
  );
  assert.equal(LEGACY_SHADOW_PROBABILITY_MODEL_VERSION, "hazard-odds-v2-random-only");
  for (const forecast of Object.values(forecasts)) {
    assert.equal(forecast.generatedAt, now.toISOString());
    if (forecast.modelVersion === "hazard-regime-elapsed-v1") {
      assert.ok(forecast.completedEventCount >= 0);
    } else {
      assert.ok(forecast.completedEventCount >= forecast.completedIntervalCount);
    }
    assert.ok(forecast.weightedEventCount >= 0);
    assert.ok(forecast.weightedExposureDays >= 0);
    assert.ok(forecast.probability48h >= forecast.probability24h);
    if (forecast.probability72h !== undefined) {
      assert.ok(forecast.probability48h <= forecast.probability72h);
    }
    if (forecast.probability12h !== undefined) {
      assert.ok(forecast.probability12h <= forecast.probability24h);
    }
    if (forecast.modelVersion === "hazard-regime-elapsed-v1") {
      assert.match(forecast.targetDefinition, /recovery-boundary/);
    } else if (forecast.modelVersion === RANDOM_ELAPSED_SHADOW_MODEL_VERSION) {
      assert.equal(forecast.targetDefinition, RANDOM_ELAPSED_SHADOW_TARGET_DEFINITION);
    } else {
      assert.equal(forecast.targetDefinition, shadow.targetDefinition);
    }
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
  assert.doesNotMatch(
    JSON.stringify(toPublicRadarSnapshot(data, "en", { calculationNow: now })),
    /hazard-odds-v3-recency|hazard-odds-v4-logit-calibrated|hazard-regime-random-elapsed|alpha24h|alpha48h|calibrationSampleCount/,
  );
});
