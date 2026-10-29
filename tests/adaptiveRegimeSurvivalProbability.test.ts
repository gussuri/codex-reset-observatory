import assert from "node:assert/strict";
import test from "node:test";

import { TIMED_TEASER_REALLOCATION_POLICY_VERSION } from "../data/shadowProbabilityConfig";
import {
  calculateAdaptiveRegimeBaseline,
  calculateAdaptiveRegimeSurvivalProbability,
  clampAdaptiveRegimeRateMultiplier,
  getAdaptiveRegimeRateState,
  isValidAdaptiveRegimeSurvivalPrediction,
} from "../lib/radar/adaptiveRegimeSurvivalProbability";
import type { RecoveryBoundaryAudit } from "../lib/radar/recoveryBoundary";
import {
  calculateSurvivalConditionedProbability,
  getSurvivalConditionedHazardDiagnosticsAtAge,
  type SurvivalConditionedHazard,
} from "../lib/radar/survivalConditionedProbability";
import { applyOddsMultiplier } from "../lib/radar/shadowProbability";
import {
  applyTimedTeaserProbabilityReallocationFromAudit,
  type TimedTeaserReallocationAudit,
} from "../lib/radar/timedTeaserProbability";
import { frozenSupportShapeSurvivalStaticHistory } from "./fixtures/survivalConditionedHistory";

const HOUR_MS = 60 * 60 * 1000;
const HALF_LIFE_HOURS = 72;
const origin = new Date("2026-10-29T00:00:00.000Z");

function auditBoundary(
  hoursBeforeOrigin: number,
  flags: { randomEligible?: boolean; regularEligible?: boolean } = {},
): RecoveryBoundaryAudit {
  return {
    id: `boundary-${hoursBeforeOrigin}-${flags.randomEligible ? "r" : "n"}`,
    resetAt: new Date(origin.getTime() - hoursBeforeOrigin * HOUR_MS).toISOString(),
    included: Boolean(flags.randomEligible || flags.regularEligible),
    randomEligible: flags.randomEligible ?? false,
    regularEligible: flags.regularEligible ?? false,
    reason: flags.randomEligible
      ? "random_boundary"
      : flags.regularEligible
        ? "regular_boundary"
        : "rejected",
  };
}

function state(boundaries: RecoveryBoundaryAudit[], longTermHazardPerHour = 1 / 72, futureHours = 0) {
  return getAdaptiveRegimeRateState(boundaries, origin, longTermHazardPerHour, futureHours);
}

function constantHazard(longTermHazardPerHour = 1 / 72): SurvivalConditionedHazard {
  return {
    randomEligibilityPolicyVersion: "broad-banked-distribution-random-clock-v2",
    intervals: [],
    bins: [],
    completedIntervalCount: 36,
    weightedEventCount: 36,
    weightedExposureHours: 36 / longTermHazardPerHour,
    totalExposureHours: 36 / longTermHazardPerHour,
    ess0: 0,
    maxSupportedAgeHours: 1_000,
    longTermHazardPerHour,
    tailAnchorHazardPerHour: longTermHazardPerHour,
    tailHalfLifeHours: 72,
    binHours: 1,
    minSmoothingBandwidthHours: 1,
    maxSmoothingBandwidthHours: 1,
    liveIntervalIncludedInTraining: false,
  };
}

function fineReferenceProbability(
  hazard: SurvivalConditionedHazard,
  startAgeHours: number,
  rateState: ReturnType<typeof getAdaptiveRegimeRateState>,
  horizonHours: number,
  stepMinutes: number,
) {
  const k = Math.LN2 / HALF_LIFE_HOURS;
  const rateAt = (futureHours: number) => {
    const decay = Math.exp(-k * futureHours);
    const c = rateState.c0 * decay;
    const e = rateState.e0 * decay - Math.expm1(-k * futureHours) / k;
    const shortRate = (c + 48 * rateState.longTermHazardPerHour) / (e + 48);
    return getSurvivalConditionedHazardDiagnosticsAtAge(hazard, startAgeHours + futureHours).lambdaPerHour
      * clampAdaptiveRegimeRateMultiplier(shortRate / rateState.longTermHazardPerHour);
  };
  const stepHours = stepMinutes / 60;
  let cumulative = 0;
  let previous = rateAt(0);
  for (let cursor = 0; cursor < horizonHours; cursor += stepHours) {
    const nextHours = Math.min(horizonHours, cursor + stepHours);
    const next = rateAt(nextHours);
    cumulative += ((previous + next) / 2) * (nextHours - cursor);
    previous = next;
  }
  return -Math.expm1(-cumulative);
}

test("adaptive rate uses deduplicated eligible random boundaries and left-truncated exposure", () => {
  const anchor = auditBoundary(24, { randomEligible: true });
  const observed = auditBoundary(12, { randomEligible: true });
  const result = state([
    auditBoundary(-1, { randomEligible: true }),
    auditBoundary(10, { regularEligible: true }),
    { ...observed, id: "same-observed-boundary", regularEligible: true },
    observed,
    { ...auditBoundary(6), resetAt: null },
    anchor,
  ]);

  const k = Math.log(2) / HALF_LIFE_HOURS;
  assert.equal(result.valid, true);
  assert.equal(result.anchorAt, anchor.resetAt);
  assert.equal(result.randomBoundaryCount, 2);
  assert.equal(result.observedEventCount, 1);
  assert.ok(Math.abs(result.c0 - Math.exp(-k * 12)) < 1e-12);
  assert.ok(Math.abs(result.e0 - (-Math.expm1(-k * 24)) / k) < 1e-12);
});

test("recent repeated events raise the short rate and a no-event gap lowers it", () => {
  const repeated = state([
    auditBoundary(73, { randomEligible: true }),
    auditBoundary(1, { randomEligible: true }),
  ]);
  const noRecentEvent = state([
    auditBoundary(73, { randomEligible: true }),
  ]);
  const current = state([
    auditBoundary(48, { randomEligible: true }),
    auditBoundary(24, { randomEligible: true }),
  ]);
  const afterGap = state([
    auditBoundary(48, { randomEligible: true }),
    auditBoundary(24, { randomEligible: true }),
  ], 1 / 72, 72);

  assert.ok((repeated.rateMultiplier ?? 0) > (noRecentEvent.rateMultiplier ?? 0));
  assert.ok((current.rateMultiplier ?? 1) > (afterGap.rateMultiplier ?? 1));
});

test("adaptive rate analytically decays weighted events and exposure while shrinking toward the prior", () => {
  const longTermHazardPerHour = 1 / 80;
  const boundaries = [
    auditBoundary(120, { randomEligible: true }),
    auditBoundary(12, { randomEligible: true }),
  ];
  const futureHours = 36;
  const result = getAdaptiveRegimeRateState(boundaries, origin, longTermHazardPerHour, futureHours);
  const k = Math.LN2 / HALF_LIFE_HOURS;
  const c0 = Math.exp(-k * 12);
  const e0 = -Math.expm1(-k * 120) / k;
  const decay = Math.exp(-k * futureHours);
  const expectedC = c0 * decay;
  const expectedE = e0 * decay - Math.expm1(-k * futureHours) / k;
  const expectedShortRate = (expectedC + 48 * longTermHazardPerHour) / (expectedE + 48);
  const unshrunkRate = expectedC / expectedE;

  assert.equal(result.exposureHours, 120);
  assert.ok(Math.abs(result.c0 - c0) < 1e-12);
  assert.ok(Math.abs(result.e0 - e0) < 1e-12);
  assert.ok(Math.abs((result.shortRatePerHour ?? 0) - expectedShortRate) < 1e-12);
  assert.ok(Math.abs(expectedShortRate - longTermHazardPerHour) < Math.abs(unshrunkRate - longTermHazardPerHour));
});

test("invalid origins, elapsed inputs, and history dates safely invalidate the adaptive rate", () => {
  assert.equal(getAdaptiveRegimeRateState([], new Date(Number.NaN), 1 / 72).reason, "invalid_origin");
  assert.equal(state([auditBoundary(24, { randomEligible: true })], Number.NaN).reason, "invalid_long_term_hazard");
  assert.equal(state([auditBoundary(24, { randomEligible: true })], 1 / 72, -1).reason, "invalid_future_hours");
  assert.equal(
    state([{ ...auditBoundary(24), resetAt: "not-a-date", randomEligible: true, included: true }]).reason,
    "missing_random_history_anchor",
  );
});

test("a controlled campaign-to-gap lowers the forecast for a constant base hazard and matches a fine integration", () => {
  const hazard = constantHazard();
  const boundaries = [
    auditBoundary(240, { randomEligible: true }),
    ...[36, 24, 12, 6, 1].map((hours) => auditBoundary(hours, { randomEligible: true })),
  ];
  const current = calculateAdaptiveRegimeBaseline(hazard, 1, boundaries, origin);
  const gapOrigin = new Date(origin.getTime() + 72 * HOUR_MS);
  const afterGap = calculateAdaptiveRegimeBaseline(hazard, 73, boundaries, gapOrigin);
  assert.ok(current.baseline);
  assert.ok(afterGap.baseline);
  assert.ok((current.state.rateMultiplier ?? 1) > (afterGap.state.rateMultiplier ?? 1));
  assert.ok(current.baseline.probability24h > afterGap.baseline.probability24h);
  assert.ok(Math.abs(
    current.baseline.probability24h - fineReferenceProbability(hazard, 1, current.state, 24, 1),
  ) < 1e-6);
});

test("adaptive rate multiplier clamps both bounds and rejects invalid long-term hazards", () => {
  assert.equal(clampAdaptiveRegimeRateMultiplier(0), 0.25);
  assert.equal(clampAdaptiveRegimeRateMultiplier(20), 4);
  assert.equal(clampAdaptiveRegimeRateMultiplier(2), 2);
  assert.equal(state([auditBoundary(24, { randomEligible: true })], 0).reason, "invalid_long_term_hazard");
});

test("adaptive regime survival uses valid v1 support and preserves next-event horizon coherence", () => {
  const now = new Date("2026-10-29T00:00:00.000Z");
  const base = calculateSurvivalConditionedProbability(null, {
    now,
    activeOfficialNotice: null,
    staticHistory: frozenSupportShapeSurvivalStaticHistory(),
  });
  const result = calculateAdaptiveRegimeSurvivalProbability(base);

  assert.equal(result.audit.fallbackUsed, false);
  assert.equal(isValidAdaptiveRegimeSurvivalPrediction(result), true);
  assert.ok(result.predictions.probability12h <= result.predictions.probability24h);
  assert.ok(result.predictions.probability24h <= result.predictions.probability48h);
  assert.ok(result.predictions.probability48h <= result.predictions.probability72h);
});

test("adaptive regime survival falls back to v1 when the frozen v1 support gate fails", () => {
  const now = new Date("2026-10-29T00:00:00.000Z");
  const base = calculateSurvivalConditionedProbability(null, {
    now,
    activeOfficialNotice: null,
    staticHistory: [],
  });
  const result = calculateAdaptiveRegimeSurvivalProbability(base);

  assert.equal(result.audit.fallbackUsed, true);
  assert.equal(result.audit.fallbackReason, "invalid_survival_v1_base");
  assert.deepEqual(result.predictions, base.predictions);
});

test("adaptive regime survival gives the existing official notice horizons exact precedence", () => {
  const now = new Date("2026-10-29T00:00:00.000Z");
  const calculated = calculateSurvivalConditionedProbability(null, {
    now,
    activeOfficialNotice: null,
    staticHistory: frozenSupportShapeSurvivalStaticHistory(),
  });
  const officialHorizons = {
    probability12h: 0.21,
    probability24h: 0.42,
    probability48h: 0.63,
    probability72h: 0.84,
  };
  const base = {
    ...calculated,
    officialNoticeOverride: { active: true, ...officialHorizons },
    survival: { ...calculated.survival, officialNoticeOverride: true },
  };
  const result = calculateAdaptiveRegimeSurvivalProbability(base);

  assert.deepEqual(result.predictions, officialHorizons);
  assert.equal(result.audit.officialNoticeOverride, true);
});

test("adaptive regime survival applies v1 ordinary multipliers and saved teaser audit once", () => {
  const base = calculateSurvivalConditionedProbability(null, {
    now: origin,
    activeOfficialNotice: null,
    staticHistory: frozenSupportShapeSurvivalStaticHistory(),
  });
  const ordinaryMultiplier24h = 1.4;
  const ordinaryMultiplier48h = 1.2;
  const teaserAudit: TimedTeaserReallocationAudit = {
    policyVersion: TIMED_TEASER_REALLOCATION_POLICY_VERSION,
    applied: true,
    contextDependence: null,
    timedEvidenceClass: null,
    reallocationWeight: 0.5,
    temporalPrecision: null,
    cdf: {
      probability12h: 0.1,
      probability24h: 0.25,
      probability48h: 0.55,
      probability72h: 0.8,
    },
  };
  const baseWithSavedPolicies = {
    ...base,
    survival: {
      ...base.survival,
      ordinarySignalMultipliers: {
        ...base.survival.ordinarySignalMultipliers,
        combinedAfterCap: {
          probability24h: ordinaryMultiplier24h,
          probability48h: ordinaryMultiplier48h,
        },
      },
      timedTeaserReallocation: teaserAudit,
    },
  };
  const result = calculateAdaptiveRegimeSurvivalProbability(baseWithSavedPolicies);
  const ordinaryAdjusted = {
    probability12h: applyOddsMultiplier(result.baseline.probability12h, ordinaryMultiplier24h),
    probability24h: applyOddsMultiplier(result.baseline.probability24h, ordinaryMultiplier24h),
    probability48h: applyOddsMultiplier(result.baseline.probability48h, ordinaryMultiplier48h),
    probability72h: applyOddsMultiplier(result.baseline.probability72h, ordinaryMultiplier48h),
  };
  const expected = applyTimedTeaserProbabilityReallocationFromAudit(
    ordinaryAdjusted,
    teaserAudit,
  ).predictions;
  assert.deepEqual(result.predictions, expected);
  assert.equal(result.audit.ordinaryMultiplier24h, ordinaryMultiplier24h);
  assert.equal(result.audit.ordinaryMultiplier48h, ordinaryMultiplier48h);
  assert.equal(result.audit.timedTeaserApplied, true);
});
