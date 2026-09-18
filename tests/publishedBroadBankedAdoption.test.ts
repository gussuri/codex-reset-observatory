import assert from "node:assert/strict";
import test from "node:test";

import { getLocalRadarData } from "../lib/radar";
import {
  calculateBroadBankedRandomContinuousShadow,
} from "../lib/radar/broadBankedRandomContinuousShadow";
import { calculateRandomContinuousBandwidthShadowPair } from "../lib/radar/randomContinuousBandwidthShadow";
import { getLocalProbabilityCalculation } from "../lib/radar/probability";
import {
  calculatePublishedProbability,
  getPublishedProbabilityPeriodAt,
  selectPublishedProbability,
} from "../lib/radar/publishedProbability";
import {
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT,
  PUBLISHED_BROAD_BANKED_V2_ADOPTION_DATE,
  PUBLISHED_BROAD_BANKED_V2_PREVIOUS_MODEL_VERSION,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION,
  PUBLISHED_RAW_CONTINUOUS_18_54_ADOPTION_AT,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import { getRecoveryResetEvents } from "../lib/radar/recoveryBoundary";
import { getRandomResetEligibilityPolicyVersion } from "../lib/radar/resetEligibility";
import { LOCAL_RESET_HISTORY } from "../data/resetHistory";

test("public governance adopts broad-banked v2 over raw 18/54 v1 at the exact boundary", () => {
  assert.equal(PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT, "2026-09-18T06:00:00.000Z");
  assert.equal(PUBLISHED_BROAD_BANKED_V2_ADOPTION_DATE, "2026-09-18");
  assert.equal(PUBLISHED_PROBABILITY_MODEL_VERSION, BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION);
  assert.equal(
    PUBLISHED_BROAD_BANKED_V2_PREVIOUS_MODEL_VERSION,
    RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
  );
  assert.equal(PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION, RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION);
});

test("published period classification has a half-open raw-v1 period and exact v2 adoption", () => {
  assert.equal(getPublishedProbabilityPeriodAt("2026-09-18T05:59:59.999Z"), "raw-continuous-18-54");
  assert.equal(getPublishedProbabilityPeriodAt("2026-09-18T06:00:00.000Z"), "broad-banked-v2");
  assert.equal(getPublishedProbabilityPeriodAt("2026-09-18T06:00:00.001Z"), "broad-banked-v2");
  assert.equal(getPublishedProbabilityPeriodAt(PUBLISHED_RAW_CONTINUOUS_18_54_ADOPTION_AT!), "raw-continuous-18-54");
});

test("public selector switches from raw v1 to v2 at the exact rounded boundary", () => {
  const before = new Date("2026-09-18T05:59:59.999Z");
  const exact = new Date("2026-09-18T06:00:00.000Z");
  const after = new Date("2026-09-18T06:00:00.001Z");

  const beforeResult = calculatePublishedProbability(
    getLocalRadarData({ calculationNow: before }),
    { now: before },
    { logFallback: false },
  );
  const exactResult = calculatePublishedProbability(
    getLocalRadarData({ calculationNow: exact }),
    { now: exact },
    { logFallback: false },
  );
  const afterResult = calculatePublishedProbability(
    getLocalRadarData({ calculationNow: after }),
    { now: after },
    { logFallback: false },
  );

  assert.equal(beforeResult.adoptedModel, RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION);
  assert.equal(exactResult.adoptedModel, BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION);
  assert.equal(afterResult.adoptedModel, BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION);
});

test("post-adoption public probabilities exactly reuse the broad-banked v2 calculator", () => {
  const now = new Date("2026-09-18T06:10:00.000Z");
  const data = getLocalRadarData({ calculationNow: now });
  const expected = calculateBroadBankedRandomContinuousShadow(data, { now });
  const published = calculatePublishedProbability(data, { now }, { logFallback: false });

  assert.equal(published.adoptedModel, BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION);
  assert.equal(published.source, "broad-banked-raw-continuous");
  assert.equal(published.fallbackReason, null);
  assert.deepEqual(
    [published.probability12h, published.probability24h, published.probability48h, published.probability72h],
    [expected.predictions.probability12h, expected.predictions.probability24h, expected.predictions.probability48h, expected.predictions.probability72h],
  );
  assert.equal(published.broadBankedV2?.modelVersion, expected.modelVersion);
  assert.equal(
    published.broadBankedV2?.randomContinuous.randomEligibilityPolicyVersion,
    getRandomResetEligibilityPolicyVersion(BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY),
  );
});

test("a v2 exception falls back to the raw 18/54 v1 result with an audit reason", () => {
  const now = new Date("2026-09-18T06:10:00.000Z");
  const data = getLocalRadarData({ calculationNow: now });
  const primary = getLocalProbabilityCalculation(data, { now });
  const raw = calculateRandomContinuousBandwidthShadowPair(data, { now }).challenger;
  const selected = selectPublishedProbability(
    primary,
    null,
    null,
    null,
    null,
    null,
    null,
    {
      allowBroadBankedV2: true,
      broadBankedV2: null,
      broadBankedV2FailureReason: "broad_banked_v2_exception",
      allowRawContinuous: true,
      rawContinuous: raw,
    },
  );

  assert.equal(selected.adoptedModel, RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION);
  assert.equal(selected.source, "raw-continuous");
  assert.equal(selected.fallbackReason, "broad_banked_v2_exception");
});

test("an invalid v2 prediction falls back to raw v1, while invalid raw v1 continues the existing chain", () => {
  const now = new Date("2026-09-18T06:10:00.000Z");
  const data = getLocalRadarData({ calculationNow: now });
  const primary = getLocalProbabilityCalculation(data, { now });
  const raw = calculateRandomContinuousBandwidthShadowPair(data, { now }).challenger;
  const invalidV2 = {
    ...raw,
    modelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    predictions: { ...raw.predictions, probability24h: Number.NaN },
  };
  const selected = selectPublishedProbability(
    primary,
    null,
    null,
    null,
    null,
    null,
    null,
    {
      allowBroadBankedV2: true,
      broadBankedV2: invalidV2,
      broadBankedV2FailureReason: "broad_banked_v2_invalid_prediction",
      allowRawContinuous: true,
      rawContinuous: raw,
    },
  );

  assert.equal(selected.adoptedModel, RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION);
  assert.equal(selected.fallbackReason, "broad_banked_v2_invalid_prediction");
});

test("the 2026-06-12 broad banked record changes only v2 boundary semantics", () => {
  const fixture = LOCAL_RESET_HISTORY.find((item) => item.id === "personal-reset-credit-2026-06-11");
  assert.ok(fixture);
  const asOf = new Date("2026-06-13T00:00:00.000Z");
  const legacy = getRecoveryResetEvents(null, asOf, [fixture]);
  const v2 = getRecoveryResetEvents(null, asOf, [fixture], undefined, BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY);

  assert.equal(legacy[0]?.isRandom, false);
  assert.equal(v2[0]?.isRandom, true);
  assert.equal(v2[0]?.isRegular, true);
  assert.equal(fixture.recordKind, "banked_distribution");
  assert.equal(fixture.details?.cycleType, "定期リセット");
});
