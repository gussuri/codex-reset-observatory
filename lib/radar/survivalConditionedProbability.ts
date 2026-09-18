import {
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  NEXT_GENERATION_B_FROZEN_REGIME_CONFIG,
  SURVIVAL_CONDITIONED_BIN_HOURS,
  SURVIVAL_CONDITIONED_FREEZE_AT,
  SURVIVAL_CONDITIONED_FREEZE_POLICY,
  SURVIVAL_CONDITIONED_INTEGRATION_STEP_MINUTES,
  SURVIVAL_CONDITIONED_MIN_COMPLETED_INTERVAL_COUNT,
  SURVIVAL_CONDITIONED_MAX_SMOOTH_HOURS,
  SURVIVAL_CONDITIONED_MIN_SMOOTH_HOURS,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  SURVIVAL_CONDITIONED_RECENCY_HALF_LIFE_DAYS,
  SURVIVAL_CONDITIONED_SIGNAL_CONFIG,
  SURVIVAL_CONDITIONED_TAIL_HALF_LIFE_HOURS,
  SURVIVAL_CONDITIONED_TARGET_DEFINITION,
  SURVIVAL_CONTEXT_BURST_MODEL_VERSION,
  SURVIVAL_CONTEXT_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_OLD_REGIME_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_MODEL_VERSION,
  SURVIVAL_CONTEXT_MAX_MULTIPLIER,
  SURVIVAL_CONTEXT_MIN_MULTIPLIER,
} from "@/data/shadowProbabilityConfig";
import type { RadarData } from "./types";
import {
  calculateRegimeElapsedProbability,
  type RegimeElapsedProbabilityResult,
} from "./regimeElapsedProbability";
import {
  applyOddsMultiplier,
  applyOfficialNoticeTimingPolicy,
  type ShadowProbabilityHorizons,
  type ShadowProbabilityOptions,
  type ShadowSignalMultipliers,
} from "./shadowProbability";
import { getActiveOfficialNotice, type ActiveOfficialNotice } from "./probability";
import {
  getRecoveryBoundaryAudit,
  getRecoveryResetEvents,
  type RecoveryResetBoundary,
} from "./recoveryBoundary";
import { getRandomElapsedBoundaries } from "./randomElapsedProbability";
import { getRandomResetEligibilityPolicyVersion } from "./resetEligibility";
import {
  calculateCircadianNormalization,
  fitContextualBurstContext,
  getContextualBurstMultiplier,
  getContextualBurstRawFeatures,
  type CircadianNormalization,
  type ContextualBurstFit,
} from "./contextualBurstContext";
import { getPostResetRegimeMultiplierAtAge } from "./randomContinuousProbability";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EPSILON = 1e-12;
const DEFAULT_INTEGRATION_STEP_HOURS = SURVIVAL_CONDITIONED_INTEGRATION_STEP_MINUTES / 60;

export type SurvivalConditionedInterval = {
  durationHours: number;
  completionAt: string;
  weight: number;
};

export type SurvivalConditionedBin = {
  startHour: number;
  endHour: number;
  centerHour: number;
  weightedRisk: number;
  weightedEvents: number;
  qRaw: number | null;
};

export type SurvivalConditionedHazard = {
  randomEligibilityPolicyVersion: typeof BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION;
  intervals: SurvivalConditionedInterval[];
  bins: SurvivalConditionedBin[];
  completedIntervalCount: number;
  weightedEventCount: number;
  weightedExposureHours: number;
  totalExposureHours: number;
  ess0: number;
  maxSupportedAgeHours: number;
  longTermHazardPerHour: number;
  tailAnchorHazardPerHour: number;
  tailHalfLifeHours: number;
  binHours: number;
  minSmoothingBandwidthHours: number;
  maxSmoothingBandwidthHours: number;
  liveIntervalIncludedInTraining: false;
};

export type SurvivalConditionedHazardDiagnostics = {
  ageHours: number;
  qRaw: number | null;
  qNeighbor: number;
  q: number;
  lambdaPerHour: number;
  dailyProbability: number;
  ess: number;
  supportFraction: number;
  smoothingBandwidthHours: number;
  alpha: number;
  inTail: boolean;
};

export type SurvivalConditionedAudit = {
  modelVersion: typeof SURVIVAL_CONDITIONED_MODEL_VERSION;
  randomElapsedHours: number;
  latestRandomResetAt: string | null;
  completedIntervalCount: number;
  minimumCompletedIntervalCount: number;
  historySupportValid: boolean;
  weightedEventCount: number;
  weightedExposureDays: number;
  ess0: number;
  currentEss: number;
  currentSmoothingBandwidthHours: number;
  maxSupportedAgeHours: number;
  recencyHalfLifeDays: typeof SURVIVAL_CONDITIONED_RECENCY_HALF_LIFE_DAYS;
  tailHalfLifeHours: typeof SURVIVAL_CONDITIONED_TAIL_HALF_LIFE_HOURS;
  longTermHazardPerHour: number;
  tailAnchorHazardPerHour: number;
  liveIntervalIncludedInTraining: false;
  randomEligibilityPolicyVersion: typeof BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION;
  integrationStepHours: number;
  ordinarySignalMultipliers: ShadowSignalMultipliers;
  officialNoticeOverride: boolean;
  officialNoticeTimingPolicyVersion: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  freezeAt: typeof SURVIVAL_CONDITIONED_FREEZE_AT;
  freezePolicy: typeof SURVIVAL_CONDITIONED_FREEZE_POLICY;
  boundaryAudit: ReturnType<typeof getRecoveryBoundaryAudit>;
};

export type SurvivalConditionedProbabilityResult = {
  modelVersion: typeof SURVIVAL_CONDITIONED_MODEL_VERSION;
  calculatedAt: string;
  targetDefinition: typeof SURVIVAL_CONDITIONED_TARGET_DEFINITION;
  predictions: ShadowProbabilityHorizons;
  baseline: ShadowProbabilityHorizons;
  multipliers: ShadowSignalMultipliers;
  officialNoticeOverride: {
    active: boolean;
    probability12h: number | null;
    probability24h: number | null;
    probability48h: number | null;
    probability72h: number | null;
  };
  confidence: {
    level: "low" | "medium" | "high";
    reason: string;
    completedIntervalCount: number;
    totalExposureDays: number;
  };
  hazard: SurvivalConditionedHazard;
  survival: SurvivalConditionedAudit;
  warnings: string[];
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function weightForCompletion(completionTime: number, originTime: number) {
  const ageDays = Math.max(0, originTime - completionTime) / DAY_MS;
  return 2 ** (-ageDays / SURVIVAL_CONDITIONED_RECENCY_HALF_LIFE_DAYS);
}

function sortedCompletedIntervals(boundaries: RecoveryResetBoundary[], origin: Date) {
  const originTime = origin.getTime();
  const randomBoundaries = boundaries
    .filter((boundary) => boundary.isRandom)
    .map((boundary) => ({ boundary, time: timestamp(boundary.resetAt) }))
    .filter((item): item is { boundary: RecoveryResetBoundary; time: number } =>
      item.time !== null && item.time <= originTime,
    )
    .sort((left, right) => left.time - right.time)
    .filter((item, index, items) => index === 0 || item.time !== items[index - 1].time);
  const intervals: SurvivalConditionedInterval[] = [];
  for (let index = 1; index < randomBoundaries.length; index += 1) {
    const previousTime = randomBoundaries[index - 1].time;
    const completionTime = randomBoundaries[index].time;
    const durationHours = (completionTime - previousTime) / HOUR_MS;
    if (!(durationHours > 0)) continue;
    intervals.push({
      durationHours,
      completionAt: new Date(completionTime).toISOString(),
      weight: weightForCompletion(completionTime, originTime),
    });
  }
  return intervals;
}

function effectiveSampleSize(intervals: SurvivalConditionedInterval[], ageHours: number) {
  const risk = intervals.filter((interval) => interval.durationHours > ageHours);
  const sum = risk.reduce((total, interval) => total + interval.weight, 0);
  const sumSquares = risk.reduce((total, interval) => total + interval.weight ** 2, 0);
  return sumSquares > 0 ? (sum ** 2) / sumSquares : 0;
}

function buildBins(intervals: SurvivalConditionedInterval[], maxSupportedAgeHours: number) {
  const count = Math.max(1, Math.ceil(maxSupportedAgeHours / SURVIVAL_CONDITIONED_BIN_HOURS));
  return Array.from({ length: count }, (_, index): SurvivalConditionedBin => {
    const startHour = index * SURVIVAL_CONDITIONED_BIN_HOURS;
    const endHour = Math.min(
      maxSupportedAgeHours,
      startHour + SURVIVAL_CONDITIONED_BIN_HOURS,
    );
    const risk = intervals.filter((interval) => interval.durationHours > startHour);
    const events = risk.filter((interval) => interval.durationHours <= startHour + SURVIVAL_CONDITIONED_BIN_HOURS);
    const weightedRisk = risk.reduce((total, interval) => total + interval.weight, 0);
    const weightedEvents = events.reduce((total, interval) => total + interval.weight, 0);
    return {
      startHour,
      endHour,
      centerHour: startHour + (endHour - startHour) / 2,
      weightedRisk,
      weightedEvents,
      qRaw: weightedRisk > 0 ? clamp(weightedEvents / weightedRisk, 0, 1) : null,
    };
  });
}

export function buildSurvivalConditionedHazard(
  boundaries: RecoveryResetBoundary[],
  origin: Date,
): SurvivalConditionedHazard {
  const intervals = sortedCompletedIntervals(boundaries, origin);
  const maxSupportedAgeHours = Math.max(...intervals.map((interval) => interval.durationHours), 0);
  const weightedEventCount = intervals.reduce((total, interval) => total + interval.weight, 0);
  const weightedExposureHours = intervals.reduce(
    (total, interval) => total + interval.weight * interval.durationHours,
    0,
  );
  const totalExposureHours = intervals.reduce((total, interval) => total + interval.durationHours, 0);
  const ess0 = effectiveSampleSize(intervals, 0);
  const longTermHazardPerHour = weightedExposureHours > 0
    ? weightedEventCount / weightedExposureHours
    : 0;

  if (!(maxSupportedAgeHours > 0) || !(ess0 > 0)) {
    return {
      randomEligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
      intervals,
      bins: [],
      completedIntervalCount: intervals.length,
      weightedEventCount,
      weightedExposureHours,
      totalExposureHours,
      ess0,
      maxSupportedAgeHours,
      longTermHazardPerHour,
      tailAnchorHazardPerHour: longTermHazardPerHour,
      tailHalfLifeHours: SURVIVAL_CONDITIONED_TAIL_HALF_LIFE_HOURS,
      binHours: SURVIVAL_CONDITIONED_BIN_HOURS,
      minSmoothingBandwidthHours: SURVIVAL_CONDITIONED_MIN_SMOOTH_HOURS,
      maxSmoothingBandwidthHours: SURVIVAL_CONDITIONED_MAX_SMOOTH_HOURS,
      liveIntervalIncludedInTraining: false,
    };
  }

  const bins = buildBins(intervals, maxSupportedAgeHours);
  const provisional: SurvivalConditionedHazard = {
    randomEligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    intervals,
    bins,
    completedIntervalCount: intervals.length,
    weightedEventCount,
    weightedExposureHours,
    totalExposureHours,
    ess0,
    maxSupportedAgeHours,
    longTermHazardPerHour,
    tailAnchorHazardPerHour: 0,
    tailHalfLifeHours: SURVIVAL_CONDITIONED_TAIL_HALF_LIFE_HOURS,
    binHours: SURVIVAL_CONDITIONED_BIN_HOURS,
    minSmoothingBandwidthHours: SURVIVAL_CONDITIONED_MIN_SMOOTH_HOURS,
    maxSmoothingBandwidthHours: SURVIVAL_CONDITIONED_MAX_SMOOTH_HOURS,
    liveIntervalIncludedInTraining: false,
  };
  provisional.tailAnchorHazardPerHour = getSupportedDiagnostics(provisional, Math.max(0, maxSupportedAgeHours - 1e-6)).lambdaPerHour;
  return provisional;
}

function getBinIndex(hazard: SurvivalConditionedHazard, ageHours: number) {
  if (hazard.bins.length === 0) return -1;
  return Math.min(
    hazard.bins.length - 1,
    Math.max(0, Math.floor(Math.max(0, ageHours) / hazard.binHours)),
  );
}

function getRawForAge(hazard: SurvivalConditionedHazard, ageHours: number) {
  const index = getBinIndex(hazard, ageHours);
  return index < 0 ? null : hazard.bins[index].qRaw;
}

function getSmoothingBandwidth(hazard: SurvivalConditionedHazard, ageHours: number) {
  if (!(hazard.ess0 > 0)) {
    return {
      ess: 0,
      supportFraction: 0,
      bandwidth: hazard.maxSmoothingBandwidthHours,
    };
  }
  const ess = effectiveSampleSize(hazard.intervals, Math.max(0, ageHours));
  const supportFraction = clamp(ess / hazard.ess0, 0, 1);
  return {
    ess,
    supportFraction,
    bandwidth: hazard.minSmoothingBandwidthHours +
      (hazard.maxSmoothingBandwidthHours - hazard.minSmoothingBandwidthHours) * (1 - supportFraction),
  };
}

function getNeighborEstimate(
  hazard: SurvivalConditionedHazard,
  ageHours: number,
  bandwidthHours: number,
) {
  const targetBinIndex = getBinIndex(hazard, ageHours);
  let weightedEvents = 0;
  let weightedRisk = 0;
  for (let index = 0; index < hazard.bins.length; index += 1) {
    const bin = hazard.bins[index];
    if (index === targetBinIndex || !(bin.weightedRisk > 0)) continue;
    const normalized = (bin.centerHour - ageHours) / Math.max(EPSILON, bandwidthHours);
    const kernel = Math.exp(-0.5 * normalized ** 2);
    weightedEvents += kernel * bin.weightedEvents;
    weightedRisk += kernel * bin.weightedRisk;
  }
  return weightedRisk > 0 ? clamp(weightedEvents / weightedRisk, 0, 1) : clamp(
    1 - Math.exp(-hazard.longTermHazardPerHour * hazard.binHours),
    0,
    1,
  );
}

function getBlendedAtPoint(hazard: SurvivalConditionedHazard, ageHours: number) {
  const normalizedAge = clamp(ageHours, 0, Math.max(0, hazard.maxSupportedAgeHours - 1e-6));
  const smoothing = getSmoothingBandwidth(hazard, normalizedAge);
  const qRaw = getRawForAge(hazard, normalizedAge);
  const qNeighbor = getNeighborEstimate(hazard, normalizedAge, smoothing.bandwidth);
  const alpha = smoothing.ess / (smoothing.ess + Math.sqrt(hazard.ess0));
  const q = clamp(
    qRaw === null ? qNeighbor : alpha * qRaw + (1 - alpha) * qNeighbor,
    0,
    1 - EPSILON,
  );
  return {
    qRaw,
    qNeighbor,
    q,
    alpha,
    ...smoothing,
  };
}

function getSupportedDiagnostics(hazard: SurvivalConditionedHazard, ageHours: number): SurvivalConditionedHazardDiagnostics {
  const normalizedAge = clamp(ageHours, 0, Math.max(0, hazard.maxSupportedAgeHours - 1e-6));
  const points = [
    0,
    ...hazard.bins.map((bin) => bin.centerHour),
    hazard.maxSupportedAgeHours,
  ].filter((value, index, values) => index === 0 || value > values[index - 1]);
  let lower = points[0] ?? 0;
  let upper = points.at(-1) ?? 0;
  for (let index = 1; index < points.length; index += 1) {
    if (normalizedAge <= points[index]) {
      lower = points[index - 1];
      upper = points[index];
      break;
    }
  }
  const left = getBlendedAtPoint(hazard, lower);
  const right = getBlendedAtPoint(hazard, upper);
  const fraction = upper > lower ? (normalizedAge - lower) / (upper - lower) : 0;
  const q = left.q + (right.q - left.q) * clamp(fraction, 0, 1);
  const smoothing = getSmoothingBandwidth(hazard, normalizedAge);
  const qNeighbor = getNeighborEstimate(hazard, normalizedAge, smoothing.bandwidth);
  const qRaw = getRawForAge(hazard, normalizedAge);
  const alpha = smoothing.ess / (smoothing.ess + Math.sqrt(hazard.ess0));
  const lambdaPerHour = -Math.log(1 - clamp(q, 0, 1 - EPSILON)) / hazard.binHours;
  return {
    ageHours,
    qRaw,
    qNeighbor,
    q,
    lambdaPerHour: Number.isFinite(lambdaPerHour) ? Math.max(0, lambdaPerHour) : 0,
    dailyProbability: clamp(1 - Math.exp(-Math.max(0, lambdaPerHour) * 24), 0, 1),
    ess: smoothing.ess,
    supportFraction: smoothing.supportFraction,
    smoothingBandwidthHours: smoothing.bandwidth,
    alpha,
    inTail: false,
  };
}

export function getSurvivalConditionedHazardDiagnosticsAtAge(
  hazard: SurvivalConditionedHazard,
  ageHours: number,
): SurvivalConditionedHazardDiagnostics {
  if (!(hazard.maxSupportedAgeHours > 0) || !Number.isFinite(ageHours)) {
    return {
      ageHours,
      qRaw: null,
      qNeighbor: 0,
      q: 0,
      lambdaPerHour: 0,
      dailyProbability: 0,
      ess: 0,
      supportFraction: 0,
      smoothingBandwidthHours: hazard.maxSmoothingBandwidthHours,
      alpha: 0,
      inTail: false,
    };
  }
  if (ageHours <= hazard.maxSupportedAgeHours) {
    return getSupportedDiagnostics(hazard, ageHours);
  }
  const tailLambda = hazard.longTermHazardPerHour +
    (hazard.tailAnchorHazardPerHour - hazard.longTermHazardPerHour) *
    2 ** (-(ageHours - hazard.maxSupportedAgeHours) / hazard.tailHalfLifeHours);
  const safeLambda = Math.max(0, Number.isFinite(tailLambda) ? tailLambda : hazard.longTermHazardPerHour);
  const q = clamp(1 - Math.exp(-safeLambda * hazard.binHours), 0, 1 - EPSILON);
  return {
    ageHours,
    qRaw: null,
    qNeighbor: q,
    q,
    lambdaPerHour: safeLambda,
    dailyProbability: clamp(1 - Math.exp(-safeLambda * 24), 0, 1),
    ess: 0,
    supportFraction: 0,
    smoothingBandwidthHours: hazard.maxSmoothingBandwidthHours,
    alpha: 0,
    inTail: true,
  };
}

export function integrateSurvivalConditionedHazard(
  hazard: SurvivalConditionedHazard,
  startAgeHours: number,
  horizonHours: number,
  integrationStepHours = DEFAULT_INTEGRATION_STEP_HOURS,
) {
  if (!Number.isFinite(startAgeHours) || !Number.isFinite(horizonHours) || horizonHours <= 0) return 0;
  const step = Number.isFinite(integrationStepHours) && integrationStepHours > 0
    ? integrationStepHours
    : DEFAULT_INTEGRATION_STEP_HOURS;
  const start = Math.max(0, startAgeHours);
  const end = start + horizonHours;
  let cursor = start;
  let cumulative = 0;
  let current = getSurvivalConditionedHazardDiagnosticsAtAge(hazard, cursor).lambdaPerHour;
  while (cursor < end) {
    const nextAge = Math.min(end, cursor + step);
    if (!(nextAge > cursor)) break;
    const next = getSurvivalConditionedHazardDiagnosticsAtAge(hazard, nextAge).lambdaPerHour;
    cumulative += ((current + next) / 2) * (nextAge - cursor);
    cursor = nextAge;
    current = next;
  }
  return clamp(1 - Math.exp(-Math.max(0, cumulative)), 0, 1);
}

function directHorizons(hazard: SurvivalConditionedHazard, randomElapsedHours: number): ShadowProbabilityHorizons {
  return {
    probability12h: integrateSurvivalConditionedHazard(hazard, randomElapsedHours, 12),
    probability24h: integrateSurvivalConditionedHazard(hazard, randomElapsedHours, 24),
    probability48h: integrateSurvivalConditionedHazard(hazard, randomElapsedHours, 48),
    probability72h: integrateSurvivalConditionedHazard(hazard, randomElapsedHours, 72),
  };
}

function latestReset(boundaries: RecoveryResetBoundary[]) {
  return boundaries.at(-1)?.resetAt ?? null;
}

function makeConfidence(hazard: SurvivalConditionedHazard, noticeActive: boolean) {
  if (noticeActive) {
    return { level: "high" as const, reason: "An active official notice overrides the normal confidence tier." };
  }
  if (hazard.completedIntervalCount >= 30 && hazard.weightedExposureHours / 24 >= 120) {
    return { level: "medium" as const, reason: "Completed interval count and weighted exposure meet the medium-confidence floor." };
  }
  return { level: "low" as const, reason: "Completed interval history is below the medium-confidence floor." };
}

function safeRandomElapsedHours(boundaries: RecoveryResetBoundary[], now: Date) {
  const latest = boundaries.at(-1);
  const latestTime = timestamp(latest?.resetAt);
  return latestTime === null ? 0 : Math.max(0, (now.getTime() - latestTime) / HOUR_MS);
}

function getNotice(
  data: RadarData | null,
  options: ShadowProbabilityOptions,
  latestRecoveryResetAt: string | null,
  now: Date,
): ActiveOfficialNotice | null {
  if (options.activeOfficialNotice !== undefined) return options.activeOfficialNotice;
  return getActiveOfficialNotice(
    data,
    latestRecoveryResetAt ? new Date(latestRecoveryResetAt) : null,
    now,
    options.localObservationSignals,
    null,
    false,
    false,
    options.canonicalHistoryContext,
  );
}

export function calculateSurvivalConditionedProbability(
  data: RadarData | null,
  options: ShadowProbabilityOptions = {},
  precomputedRecoveryResult?: RegimeElapsedProbabilityResult,
): SurvivalConditionedProbabilityResult {
  const now = options.now ?? new Date();
  const sharedOptions: ShadowProbabilityOptions = {
    ...options,
    now,
    randomEligibilityPolicy: BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  };
  const boundaries = getRecoveryResetEvents(
    data,
    now,
    options.staticHistory,
    options.canonicalHistoryContext,
    BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  );
  const randomBoundaries = getRandomElapsedBoundaries(boundaries);
  const hazard = buildSurvivalConditionedHazard(randomBoundaries, now);
  const regimeResult = precomputedRecoveryResult ?? calculateRegimeElapsedProbability(
    data,
    sharedOptions,
    {
      ...NEXT_GENERATION_B_FROZEN_REGIME_CONFIG,
      modelVersion: "hazard-regime-elapsed-v1",
      mode: "elapsed-only",
      signalMultiplierConfig: SURVIVAL_CONDITIONED_SIGNAL_CONFIG,
    },
  );
  const latestRandomResetAt = latestReset(randomBoundaries);
  const latestRecoveryResetAt = latestReset(boundaries);
  const randomElapsedHours = safeRandomElapsedHours(randomBoundaries, now);
  const baseline = directHorizons(hazard, randomElapsedHours);
  const adjusted: ShadowProbabilityHorizons = {
    probability12h: applyOddsMultiplier(baseline.probability12h, regimeResult.multipliers.combinedAfterCap.probability24h),
    probability24h: applyOddsMultiplier(baseline.probability24h, regimeResult.multipliers.combinedAfterCap.probability24h),
    probability48h: applyOddsMultiplier(baseline.probability48h, regimeResult.multipliers.combinedAfterCap.probability48h),
    probability72h: applyOddsMultiplier(baseline.probability72h, regimeResult.multipliers.combinedAfterCap.probability48h),
  };
  const notice = getNotice(data, sharedOptions, latestRecoveryResetAt, now);
  const noticeHorizons = applyOfficialNoticeTimingPolicy(baseline, notice, now);
  const predictions = noticeHorizons ?? adjusted;
  const currentDiagnostics = getSurvivalConditionedHazardDiagnosticsAtAge(hazard, randomElapsedHours);
  const confidence = makeConfidence(hazard, noticeHorizons !== null);
  const warnings = [
    "The live random-reset interval is query-only and is excluded from survival training.",
    "Regular recovery boundaries are retained for audit but do not reset the random-event hazard clock.",
  ];

  return {
    modelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
    calculatedAt: now.toISOString(),
    targetDefinition: SURVIVAL_CONDITIONED_TARGET_DEFINITION,
    predictions,
    baseline,
    multipliers: regimeResult.multipliers,
    officialNoticeOverride: {
      active: noticeHorizons !== null,
      probability12h: noticeHorizons?.probability12h ?? null,
      probability24h: noticeHorizons?.probability24h ?? null,
      probability48h: noticeHorizons?.probability48h ?? null,
      probability72h: noticeHorizons?.probability72h ?? null,
    },
    confidence: {
      ...confidence,
      completedIntervalCount: hazard.completedIntervalCount,
      totalExposureDays: hazard.weightedExposureHours / 24,
    },
    hazard,
    survival: {
      modelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
      randomElapsedHours,
      latestRandomResetAt,
      completedIntervalCount: hazard.completedIntervalCount,
      minimumCompletedIntervalCount: SURVIVAL_CONDITIONED_MIN_COMPLETED_INTERVAL_COUNT,
      historySupportValid: hazard.completedIntervalCount >= SURVIVAL_CONDITIONED_MIN_COMPLETED_INTERVAL_COUNT,
      weightedEventCount: hazard.weightedEventCount,
      weightedExposureDays: hazard.weightedExposureHours / 24,
      ess0: hazard.ess0,
      currentEss: currentDiagnostics.ess,
      currentSmoothingBandwidthHours: currentDiagnostics.smoothingBandwidthHours,
      maxSupportedAgeHours: hazard.maxSupportedAgeHours,
      recencyHalfLifeDays: SURVIVAL_CONDITIONED_RECENCY_HALF_LIFE_DAYS,
      tailHalfLifeHours: SURVIVAL_CONDITIONED_TAIL_HALF_LIFE_HOURS,
      longTermHazardPerHour: hazard.longTermHazardPerHour,
      tailAnchorHazardPerHour: hazard.tailAnchorHazardPerHour,
      liveIntervalIncludedInTraining: false,
      randomEligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
      integrationStepHours: DEFAULT_INTEGRATION_STEP_HOURS,
      ordinarySignalMultipliers: regimeResult.multipliers,
      officialNoticeOverride: noticeHorizons !== null,
      officialNoticeTimingPolicyVersion: regimeResult.regimeElapsed.officialNoticeTimingPolicyVersion,
      fallbackUsed: false,
      fallbackReason: null,
      freezeAt: SURVIVAL_CONDITIONED_FREEZE_AT,
      freezePolicy: SURVIVAL_CONDITIONED_FREEZE_POLICY,
      boundaryAudit: getRecoveryBoundaryAudit(
        data,
        now,
        options.staticHistory,
        options.canonicalHistoryContext,
        BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
      ),
    },
    warnings,
  };
}

export function isValidSurvivalConditionedPrediction(
  result: Pick<
    SurvivalConditionedProbabilityResult,
    "modelVersion" | "predictions" | "baseline" | "hazard" | "survival"
  >,
) {
  const predictions = result.predictions;
  const baseline = result.baseline;
  const predictionValues = [
    predictions.probability12h,
    predictions.probability24h,
    predictions.probability48h,
    predictions.probability72h,
  ];
  const baselineValues = baseline
    ? [
        baseline.probability12h,
        baseline.probability24h,
        baseline.probability48h,
        baseline.probability72h,
      ]
    : [];
  const isValidHorizonSet = (values: number[]) => values.every((value) =>
    Number.isFinite(value) && value >= 0 && value <= 1,
  ) && values[0] <= values[1] && values[1] <= values[2] && values[2] <= values[3];
  return result.modelVersion === SURVIVAL_CONDITIONED_MODEL_VERSION
    && result.survival.modelVersion === SURVIVAL_CONDITIONED_MODEL_VERSION
    && result.survival.liveIntervalIncludedInTraining === false
    && Number.isFinite(result.survival.randomElapsedHours)
    && result.survival.randomElapsedHours >= 0
    && result.hazard.randomEligibilityPolicyVersion === BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION
    && result.hazard.completedIntervalCount > 0
    && result.hazard.completedIntervalCount >= SURVIVAL_CONDITIONED_MIN_COMPLETED_INTERVAL_COUNT
    && result.survival.minimumCompletedIntervalCount === SURVIVAL_CONDITIONED_MIN_COMPLETED_INTERVAL_COUNT
    && result.survival.historySupportValid === true
    && result.hazard.ess0 > 0
    && result.hazard.maxSupportedAgeHours > 0
    && isValidHorizonSet(predictionValues)
    && isValidHorizonSet(baselineValues)
    && Number.isFinite(result.hazard.longTermHazardPerHour)
    && result.hazard.longTermHazardPerHour >= 0;
}

export type SurvivalConditionedContextArm = {
  modelVersion: string;
  contextArm: "previous-interval" | "circadian" | "previous-interval-circadian" | "burst" | "old-regime";
  calculatedAt: string;
  predictions: ShadowProbabilityHorizons;
  baseline: ShadowProbabilityHorizons;
  base: SurvivalConditionedProbabilityResult;
  contextFit: ContextualBurstFit | null;
  contextMultiplierAtOrigin: number;
};

function applySurvivalSignalMultipliers(
  baseline: ShadowProbabilityHorizons,
  multipliers: ShadowSignalMultipliers,
): ShadowProbabilityHorizons {
  return {
    probability12h: applyOddsMultiplier(baseline.probability12h, multipliers.combinedAfterCap.probability24h),
    probability24h: applyOddsMultiplier(baseline.probability24h, multipliers.combinedAfterCap.probability24h),
    probability48h: applyOddsMultiplier(baseline.probability48h, multipliers.combinedAfterCap.probability48h),
    probability72h: applyOddsMultiplier(baseline.probability72h, multipliers.combinedAfterCap.probability48h),
  };
}

function integrateHazardWithMultiplier(
  hazard: SurvivalConditionedHazard,
  randomElapsedHours: number,
  horizonHours: number,
  multiplierAtAge: (ageHours: number) => number,
) {
  const step = DEFAULT_INTEGRATION_STEP_HOURS;
  const start = Math.max(0, randomElapsedHours);
  const end = start + horizonHours;
  const lambdaAt = (ageHours: number) => getSurvivalConditionedHazardDiagnosticsAtAge(hazard, ageHours).lambdaPerHour * clamp(
    multiplierAtAge(ageHours),
    SURVIVAL_CONTEXT_MIN_MULTIPLIER,
    SURVIVAL_CONTEXT_MAX_MULTIPLIER,
  );
  let cursor = start;
  let cumulative = 0;
  let current = lambdaAt(cursor);
  while (cursor < end) {
    const nextAge = Math.min(end, cursor + step);
    if (!(nextAge > cursor)) break;
    const next = lambdaAt(nextAge);
    cumulative += ((current + next) / 2) * (nextAge - cursor);
    cursor = nextAge;
    current = next;
  }
  return clamp(1 - Math.exp(-Math.max(0, cumulative)), 0, 1);
}

function integrateContextHazard(
  hazard: SurvivalConditionedHazard,
  randomElapsedHours: number,
  randomResetTimes: Date[],
  now: Date,
  fit: ContextualBurstFit,
  ablation: Parameters<typeof getContextualBurstMultiplier>[2],
  horizonHours: number,
  normalization?: CircadianNormalization,
) {
  const start = Math.max(0, randomElapsedHours);
  return integrateHazardWithMultiplier(
    hazard,
    start,
    horizonHours,
    (ageHours) => {
      const at = new Date(now.getTime() + (ageHours - start) * HOUR_MS);
      return getContextualBurstMultiplier(
        getContextualBurstRawFeatures(randomResetTimes, at),
        fit,
        ablation,
        normalization,
      );
    },
  );
}

function contextHorizons(
  hazard: SurvivalConditionedHazard,
  randomElapsedHours: number,
  randomResetTimes: Date[],
  now: Date,
  fit: ContextualBurstFit,
  ablation: Parameters<typeof getContextualBurstMultiplier>[2],
  normalization?: CircadianNormalization,
): ShadowProbabilityHorizons {
  return {
    probability12h: integrateContextHazard(hazard, randomElapsedHours, randomResetTimes, now, fit, ablation, 12, normalization),
    probability24h: integrateContextHazard(hazard, randomElapsedHours, randomResetTimes, now, fit, ablation, 24, normalization),
    probability48h: integrateContextHazard(hazard, randomElapsedHours, randomResetTimes, now, fit, ablation, 48, normalization),
    probability72h: integrateContextHazard(hazard, randomElapsedHours, randomResetTimes, now, fit, ablation, 72, normalization),
  };
}

export function calculateSurvivalConditionedContextArms(
  data: RadarData | null,
  options: ShadowProbabilityOptions = {},
  baseResult?: SurvivalConditionedProbabilityResult,
) {
  const now = options.now ?? new Date();
  const base = baseResult ?? calculateSurvivalConditionedProbability(data, options);
  if (!isValidSurvivalConditionedPrediction(base)) {
    return {} as Record<string, SurvivalConditionedContextArm>;
  }
  const boundaries = getRecoveryResetEvents(
    data,
    now,
    options.staticHistory,
    options.canonicalHistoryContext,
    BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  );
  const randomBoundaries = getRandomElapsedBoundaries(boundaries);
  const randomResetTimes = randomBoundaries
    .map((boundary) => timestamp(boundary.resetAt))
    .filter((value): value is number => value !== null)
    .map((value) => new Date(value));
  const fit = fitContextualBurstContext(randomBoundaries, now, null, {
    includeLiveInterval: false,
    getHazardAtAge: (ageHours) => getSurvivalConditionedHazardDiagnosticsAtAge(base.hazard, ageHours).lambdaPerHour,
  });
  const circadianNormalization = calculateCircadianNormalization(fit.coefficients);
  const arms = [
    {
      modelVersion: SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_MODEL_VERSION,
      contextArm: "previous-interval" as const,
      ablation: "previousIntervalOnly" as const,
    },
    {
      modelVersion: SURVIVAL_CONTEXT_CIRCADIAN_MODEL_VERSION,
      contextArm: "circadian" as const,
      ablation: "circadianOnly" as const,
    },
    {
      modelVersion: SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_CIRCADIAN_MODEL_VERSION,
      contextArm: "previous-interval-circadian" as const,
      ablation: "previousIntervalCircadianOnly" as const,
    },
    {
      modelVersion: SURVIVAL_CONTEXT_BURST_MODEL_VERSION,
      contextArm: "burst" as const,
      ablation: "noCircadian" as const,
    },
    {
      modelVersion: SURVIVAL_CONTEXT_OLD_REGIME_MODEL_VERSION,
      contextArm: "old-regime" as const,
      ablation: "noBurst" as const,
    },
  ];
  const oldRegimeResult = calculateRegimeElapsedProbability(
    data,
    {
      ...options,
      now,
      randomEligibilityPolicy: BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
    },
    {
      ...NEXT_GENERATION_B_FROZEN_REGIME_CONFIG,
      modelVersion: `${SURVIVAL_CONTEXT_OLD_REGIME_MODEL_VERSION}-source`,
      mode: "full",
      signalMultiplierConfig: SURVIVAL_CONDITIONED_SIGNAL_CONFIG,
    },
  );
  const oldRegimeMultiplier = oldRegimeResult.regimeElapsed.effectiveRegimeMultiplier;
  const result = Object.fromEntries(arms.map((arm) => {
    const adjustedBaseline = arm.contextArm === "old-regime"
      ? [12, 24, 48, 72].reduce((result, horizonHours) => ({
          ...result,
          [`probability${horizonHours}h`]: integrateHazardWithMultiplier(
            base.hazard,
            base.survival.randomElapsedHours,
            horizonHours,
            (ageHours) => getPostResetRegimeMultiplierAtAge(ageHours, oldRegimeMultiplier),
          ),
        }), {} as ShadowProbabilityHorizons)
      : contextHorizons(
          base.hazard,
          base.survival.randomElapsedHours,
          randomResetTimes,
          now,
          fit,
          arm.ablation,
          circadianNormalization,
        );
    const signalAdjusted = applySurvivalSignalMultipliers(adjustedBaseline, base.multipliers);
    const predictions = base.officialNoticeOverride.active ? base.predictions : signalAdjusted;
    const originRaw = getContextualBurstRawFeatures(randomResetTimes, now);
    return [arm.modelVersion, {
      modelVersion: arm.modelVersion,
      contextArm: arm.contextArm,
      calculatedAt: now.toISOString(),
      predictions,
      baseline: adjustedBaseline,
      base,
      contextFit: fit,
      contextMultiplierAtOrigin: arm.contextArm === "old-regime"
        ? getPostResetRegimeMultiplierAtAge(base.survival.randomElapsedHours, oldRegimeMultiplier)
        : getContextualBurstMultiplier(originRaw, fit, arm.ablation, circadianNormalization),
    } satisfies SurvivalConditionedContextArm];
  })) as Record<string, SurvivalConditionedContextArm>;
  return result;
}

export function getSurvivalConditionedPolicyVersion() {
  return getRandomResetEligibilityPolicyVersion(BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY);
}
