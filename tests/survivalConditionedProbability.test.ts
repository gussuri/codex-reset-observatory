import assert from "node:assert/strict";
import test from "node:test";

import {
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import { getLocalRadarData } from "../lib/radar";
import { calculatePublishedProbability } from "../lib/radar/publishedProbability";
import {
  buildSurvivalConditionedHazard,
  getSurvivalConditionedHazardDiagnosticsAtAge,
  integrateSurvivalConditionedHazard,
} from "../lib/radar/survivalConditionedProbability";
import type { RecoveryResetBoundary } from "../lib/radar/recoveryBoundary";

const HOUR_MS = 60 * 60 * 1000;

function boundary(id: string, ageHours: number): RecoveryResetBoundary {
  return {
    id,
    resetAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + ageHours * HOUR_MS).toISOString(),
    isRandom: true,
    isRegular: false,
    sourceIds: [id],
  };
}

test("the survival candidate is not the current public model before its future adoption", () => {
  assert.equal(PUBLISHED_PROBABILITY_MODEL_VERSION, BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION);
  assert.equal(SURVIVAL_CONDITIONED_MODEL_VERSION, "hazard-survival-conditioned-adaptive-h45-tail-h24-v1");
});

test("completed-only survival hazard excludes the live interval from training", () => {
  const hazard = buildSurvivalConditionedHazard(
    [boundary("r0", 0), boundary("r1", 96)],
    new Date("2026-01-10T00:00:00.000Z"),
  );

  assert.equal(hazard.liveIntervalIncludedInTraining, false);
  assert.equal(hazard.completedIntervalCount, 1);
  assert.equal(hazard.maxSupportedAgeHours, 96);
  assert.equal(hazard.totalExposureHours, 96);
  assert.ok(hazard.weightedExposureHours > 0 && hazard.weightedExposureHours < 96);
});

test("survival smoothing widens with lower ESS and keeps small samples below one", () => {
  const hazard = buildSurvivalConditionedHazard(
    [
      boundary("r0", 0),
      boundary("r1", 24),
      boundary("r2", 48),
      boundary("r3", 120),
    ],
    new Date("2026-01-06T00:00:00.000Z"),
  );
  const early = getSurvivalConditionedHazardDiagnosticsAtAge(hazard, 12);
  const late = getSurvivalConditionedHazardDiagnosticsAtAge(hazard, 108);

  assert.ok(early.ess >= late.ess);
  assert.ok(late.smoothingBandwidthHours >= early.smoothingBandwidthHours);
  assert.ok(early.q >= 0 && early.q <= 1);
  assert.ok(late.q >= 0 && late.q <= 1);
  assert.ok(early.lambdaPerHour >= 0 && late.lambdaPerHour >= 0);
});

test("survival horizons integrate directly and remain monotone", () => {
  const hazard = buildSurvivalConditionedHazard(
    [boundary("r0", 0), boundary("r1", 48), boundary("r2", 120), boundary("r3", 216)],
    new Date("2026-01-10T00:00:00.000Z"),
  );
  const probabilities = [12, 24, 48, 72].map((horizon) =>
    integrateSurvivalConditionedHazard(hazard, 72, horizon, 10 / 60),
  );

  assert.ok(probabilities.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.ok(probabilities[0] <= probabilities[1]);
  assert.ok(probabilities[1] <= probabilities[2]);
  assert.ok(probabilities[2] <= probabilities[3]);
});

test("the tail remains nonzero and converges toward long-term hazard without a Tmax cliff", () => {
  const hazard = buildSurvivalConditionedHazard(
    [boundary("r0", 0), boundary("r1", 24), boundary("r2", 72), boundary("r3", 216)],
    new Date("2026-01-10T00:00:00.000Z"),
  );
  const atTmax = getSurvivalConditionedHazardDiagnosticsAtAge(hazard, hazard.maxSupportedAgeHours);
  const justAfter = getSurvivalConditionedHazardDiagnosticsAtAge(hazard, hazard.maxSupportedAgeHours + 0.01);
  const farTail = getSurvivalConditionedHazardDiagnosticsAtAge(hazard, hazard.maxSupportedAgeHours + 240);

  assert.ok(Math.abs(atTmax.lambdaPerHour - justAfter.lambdaPerHour) < 1e-3);
  assert.ok(justAfter.lambdaPerHour > 0);
  assert.ok(Math.abs(farTail.lambdaPerHour - hazard.longTermHazardPerHour) <
    Math.abs(justAfter.lambdaPerHour - hazard.longTermHazardPerHour));
});

test("the survival boundary policy identity is recorded for the hazard", () => {
  const hazard = buildSurvivalConditionedHazard(
    [boundary("r0", 0), boundary("r1", 48)],
    new Date("2026-01-04T00:00:00.000Z"),
  );

  assert.equal(hazard.randomEligibilityPolicyVersion, BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION);
});

test("the future adoption boundary is exact and leaves the pre-boundary public model unchanged", () => {
  const boundary = new Date(PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT!);
  const before = new Date(boundary.getTime() - 1);
  const after = new Date(boundary.getTime() + 1);
  const beforeResult = calculatePublishedProbability(
    getLocalRadarData({ calculationNow: before }),
    { now: before, activeOfficialNotice: null },
    { logFallback: false },
  );
  const exactResult = calculatePublishedProbability(
    getLocalRadarData({ calculationNow: boundary }),
    { now: boundary, activeOfficialNotice: null },
    { logFallback: false },
  );
  const afterResult = calculatePublishedProbability(
    getLocalRadarData({ calculationNow: after }),
    { now: after, activeOfficialNotice: null },
    { logFallback: false },
  );

  assert.equal(beforeResult.adoptedModel, BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION);
  assert.equal(exactResult.adoptedModel, SURVIVAL_CONDITIONED_MODEL_VERSION);
  assert.equal(exactResult.source, "survival-conditioned");
  assert.equal(afterResult.adoptedModel, SURVIVAL_CONDITIONED_MODEL_VERSION);
});
