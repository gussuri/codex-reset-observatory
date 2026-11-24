import {
  ADAPTIVE_REGIME_SURVIVAL_FREEZE_AT,
  ADAPTIVE_REGIME_SURVIVAL_FREEZE_POLICY,
  ADAPTIVE_REGIME_SURVIVAL_FORECAST_POLICY_VERSION,
  ADAPTIVE_REGIME_SURVIVAL_INTEGRATION_STEP_MINUTES,
  ADAPTIVE_REGIME_SURVIVAL_MAX_RATE_MULTIPLIER,
  ADAPTIVE_REGIME_SURVIVAL_MIN_RATE_MULTIPLIER,
  ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
  ADAPTIVE_REGIME_SURVIVAL_PRIOR_EXPOSURE_HOURS,
  ADAPTIVE_REGIME_SURVIVAL_SHORT_HALF_LIFE_HOURS,
  ADAPTIVE_REGIME_SURVIVAL_TARGET_DEFINITION,
  ADAPTIVE_REGIME_SURVIVAL_V3_FORECAST_POLICY_VERSION,
  ADAPTIVE_REGIME_SURVIVAL_V3_FREEZE_AT,
  ADAPTIVE_REGIME_SURVIVAL_V3_FREEZE_POLICY,
  ADAPTIVE_REGIME_SURVIVAL_V3_MODEL_VERSION,
  ADAPTIVE_REGIME_SURVIVAL_V3_TARGET_DEFINITION,
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  TIMED_TEASER_REALLOCATION_POLICY_VERSION,
} from "@/data/shadowProbabilityConfig";
import { applyOddsMultiplier, type ShadowProbabilityHorizons } from "./shadowProbability";
import {
  getSurvivalConditionedHazardDiagnosticsAtAge,
  isValidSurvivalConditionedPrediction,
  type SurvivalConditionedHazard,
  type SurvivalConditionedHazardDiagnostics,
  type SurvivalConditionedInterval,
  type SurvivalConditionedProbabilityResult,
} from "./survivalConditionedProbability";
import {
  applyTimedTeaserProbabilityReallocationFromAudit,
} from "./timedTeaserProbability";
import type { RecoveryBoundaryAudit, RecoveryResetBoundary } from "./recoveryBoundary";

const HOUR_MS = 60 * 60 * 1000;
const BOUNDARY_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_INTEGRATION_STEP_HOURS = ADAPTIVE_REGIME_SURVIVAL_INTEGRATION_STEP_MINUTES / 60;
const HORIZONS = [12, 24, 48, 72] as const;
const EPSILON = 1e-12;

type DeduplicatedBoundary = {
  time: number;
  isRandom: boolean;
  isRegular: boolean;
};

export type AdaptiveRegimeRateState = {
  valid: boolean;
  reason: string | null;
  anchorAt: string | null;
  randomBoundaryCount: number;
  observedEventCount: number;
  exposureHours: number;
  c0: number;
  e0: number;
  longTermHazardPerHour: number;
  shortRatePerHour: number | null;
  rawRateMultiplier: number | null;
  rateMultiplier: number | null;
  clampHit: "minimum" | "maximum" | null;
};

export type AdaptiveRegimeSurvivalAudit = {
  modelVersion: typeof ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION;
  baseModelVersion: typeof SURVIVAL_CONDITIONED_MODEL_VERSION;
  originAt: string;
  shortHalfLifeHours: typeof ADAPTIVE_REGIME_SURVIVAL_SHORT_HALF_LIFE_HOURS;
  priorExposureHours: typeof ADAPTIVE_REGIME_SURVIVAL_PRIOR_EXPOSURE_HOURS;
  minRateMultiplier: typeof ADAPTIVE_REGIME_SURVIVAL_MIN_RATE_MULTIPLIER;
  maxRateMultiplier: typeof ADAPTIVE_REGIME_SURVIVAL_MAX_RATE_MULTIPLIER;
  forecastPolicyVersion: typeof ADAPTIVE_REGIME_SURVIVAL_FORECAST_POLICY_VERSION;
  integrationStepHours: number;
  randomEligibilityPolicyVersion: typeof BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION;
  randomElapsedHours: number;
  latestRandomResetAt: string | null;
  randomBoundaryCount: number;
  observedEventCount: number;
  completedIntervalCount: number;
  weightedEventCount: number;
  weightedExposureDays: number;
  historySupportValid: boolean;
  c0: number;
  e0: number;
  longTermHazardPerHour: number;
  currentShortRatePerHour: number | null;
  currentRawRateMultiplier: number | null;
  currentRateMultiplier: number | null;
  rateClampHit: "minimum" | "maximum" | null;
  ordinaryMultiplier24h: number;
  ordinaryMultiplier48h: number;
  ordinarySignalsAppliedOnce: true;
  timedTeaserPolicyVersion: typeof TIMED_TEASER_REALLOCATION_POLICY_VERSION;
  timedTeaserApplied: boolean;
  officialNoticeOverride: boolean;
  freezeAt: typeof ADAPTIVE_REGIME_SURVIVAL_FREEZE_AT;
  freezePolicy: typeof ADAPTIVE_REGIME_SURVIVAL_FREEZE_POLICY;
  fallbackUsed: boolean;
  fallbackReason: string | null;
};

export type AdaptiveRegimeSurvivalProbabilityResult = {
  modelVersion: typeof ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION;
  calculatedAt: string;
  targetDefinition: typeof ADAPTIVE_REGIME_SURVIVAL_TARGET_DEFINITION;
  predictions: ShadowProbabilityHorizons;
  baseline: ShadowProbabilityHorizons;
  confidence: SurvivalConditionedProbabilityResult["confidence"];
  audit: AdaptiveRegimeSurvivalAudit;
};

export type AdaptiveRegimeSurvivalV3Audit = Omit<
  AdaptiveRegimeSurvivalAudit,
  "modelVersion" | "forecastPolicyVersion" | "freezeAt" | "freezePolicy"
> & {
  modelVersion: typeof ADAPTIVE_REGIME_SURVIVAL_V3_MODEL_VERSION;
  forecastPolicyVersion: typeof ADAPTIVE_REGIME_SURVIVAL_V3_FORECAST_POLICY_VERSION;
  freezeAt: typeof ADAPTIVE_REGIME_SURVIVAL_V3_FREEZE_AT;
  freezePolicy: typeof ADAPTIVE_REGIME_SURVIVAL_V3_FREEZE_POLICY;
  priorRiskWeight: number;
  shrunkTailAnchorHazardPerHour: number | null;
};

export type AdaptiveRegimeSurvivalV3ProbabilityResult = {
  modelVersion: typeof ADAPTIVE_REGIME_SURVIVAL_V3_MODEL_VERSION;
  calculatedAt: string;
  targetDefinition: typeof ADAPTIVE_REGIME_SURVIVAL_V3_TARGET_DEFINITION;
  predictions: ShadowProbabilityHorizons;
  baseline: ShadowProbabilityHorizons;
  confidence: SurvivalConditionedProbabilityResult["confidence"];
  audit: AdaptiveRegimeSurvivalV3Audit;
};

function clampFinite(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function effectiveSampleSizeAtAge(
  intervals: SurvivalConditionedInterval[],
  ageHours: number,
) {
  const risk = intervals.filter((interval) => interval.durationHours > ageHours);
  const sum = risk.reduce((total, interval) => total + interval.weight, 0);
  const sumSquares = risk.reduce((total, interval) => total + interval.weight ** 2, 0);
  return sumSquares > 0 ? (sum ** 2) / sumSquares : 0;
}

export function createShrunkSurvivalHazardEvaluator(hazard: SurvivalConditionedHazard) {
  const baseLambda = Number.isFinite(hazard.longTermHazardPerHour) && hazard.longTermHazardPerHour > 0
    ? hazard.longTermHazardPerHour
    : 0;
  const binHours = Number.isFinite(hazard.binHours) && hazard.binHours > 0 ? hazard.binHours : 12;
  const hasBins = hazard.maxSupportedAgeHours > 0 && hazard.ess0 > 0 && hazard.bins.length > 0;
  const priorRiskWeight = hazard.ess0 > 0 ? Math.sqrt(hazard.ess0) : 0;

  if (!hasBins) {
    const fallbackDiag = (ageHours: number): SurvivalConditionedHazardDiagnostics => {
      if (!Number.isFinite(ageHours) || baseLambda <= 0) {
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
      const q = clampFinite(1 - Math.exp(-baseLambda * binHours), 0, 1 - EPSILON);
      return {
        ageHours,
        qRaw: null,
        qNeighbor: q,
        q,
        lambdaPerHour: baseLambda,
        dailyProbability: clampFinite(1 - Math.exp(-baseLambda * 24), 0, 1),
        ess: 0,
        supportFraction: 0,
        smoothingBandwidthHours: hazard.maxSmoothingBandwidthHours,
        alpha: 0,
        inTail: ageHours > hazard.maxSupportedAgeHours,
      };
    };
    return {
      priorRiskWeight,
      tailAnchorHazardPerHour: baseLambda,
      diagnosticsAt: fallbackDiag,
    };
  }

  const qPrior = clampFinite(1 - Math.exp(-baseLambda * binHours), 0, 1 - EPSILON);
  const blendedCache = new Map<number, {
    qRaw: number | null;
    qNeighbor: number;
    q: number;
    alpha: number;
    ess: number;
    supportFraction: number;
    bandwidth: number;
  }>();

  const blendedAtPoint = (pointAge: number) => {
    const normalizedAge = clampFinite(pointAge, 0, Math.max(0, hazard.maxSupportedAgeHours - 1e-6));
    const cached = blendedCache.get(normalizedAge);
    if (cached) return cached;

    const ess = effectiveSampleSizeAtAge(hazard.intervals, normalizedAge);
    const supportFraction = clampFinite(ess / hazard.ess0, 0, 1);
    const bandwidth = hazard.minSmoothingBandwidthHours +
      (hazard.maxSmoothingBandwidthHours - hazard.minSmoothingBandwidthHours) * (1 - supportFraction);
    const binIndex = Math.min(
      hazard.bins.length - 1,
      Math.max(0, Math.floor(Math.max(0, normalizedAge) / binHours)),
    );
    const bin = binIndex >= 0 ? hazard.bins[binIndex] : null;
    const qRaw = bin && bin.weightedRisk > 0
      ? clampFinite(
          (bin.weightedEvents + priorRiskWeight * qPrior) / (bin.weightedRisk + priorRiskWeight),
          0,
          1 - EPSILON,
        )
      : null;

    let weightedEvents = 0;
    let weightedRisk = 0;
    for (let index = 0; index < hazard.bins.length; index += 1) {
      const neighbor = hazard.bins[index];
      if (index === binIndex || !(neighbor.weightedRisk > 0)) continue;
      const normalized = (neighbor.centerHour - normalizedAge) / Math.max(EPSILON, bandwidth);
      const kernel = Math.exp(-0.5 * normalized ** 2);
      weightedEvents += kernel * neighbor.weightedEvents;
      weightedRisk += kernel * neighbor.weightedRisk;
    }
    const qNeighbor = clampFinite(
      (weightedEvents + priorRiskWeight * qPrior) / (weightedRisk + priorRiskWeight),
      0,
      1 - EPSILON,
    );
    const alpha = ess / (ess + priorRiskWeight);
    const q = clampFinite(
      qRaw === null ? qNeighbor : alpha * qRaw + (1 - alpha) * qNeighbor,
      0,
      1 - EPSILON,
    );
    const result = { qRaw, qNeighbor, q, alpha, ess, supportFraction, bandwidth };
    blendedCache.set(normalizedAge, result);
    return result;
  };

  const points = [
    0,
    ...hazard.bins.map((bin) => bin.centerHour),
    hazard.maxSupportedAgeHours,
  ].filter((value, index, values) => index === 0 || value > values[index - 1]);

  const supportedDiagnostics = (ageHours: number): SurvivalConditionedHazardDiagnostics => {
    const normalizedAge = clampFinite(ageHours, 0, Math.max(0, hazard.maxSupportedAgeHours - 1e-6));
    let lower = points[0] ?? 0;
    let upper = points.at(-1) ?? 0;
    for (let index = 1; index < points.length; index += 1) {
      if (normalizedAge <= points[index]) {
        lower = points[index - 1];
        upper = points[index];
        break;
      }
    }
    const left = blendedAtPoint(lower);
    const right = blendedAtPoint(upper);
    const fraction = upper > lower ? clampFinite((normalizedAge - lower) / (upper - lower), 0, 1) : 0;
    const q = clampFinite(left.q + (right.q - left.q) * fraction, 0, 1 - EPSILON);
    const atPoint = blendedAtPoint(normalizedAge);
    const rawLambda = -Math.log(1 - clampFinite(q, 0, 1 - EPSILON)) / binHours;
    const lambdaPerHour = Number.isFinite(rawLambda) ? Math.max(0, rawLambda) : baseLambda;
    return {
      ageHours,
      qRaw: atPoint.qRaw,
      qNeighbor: atPoint.qNeighbor,
      q,
      lambdaPerHour,
      dailyProbability: clampFinite(1 - Math.exp(-lambdaPerHour * 24), 0, 1),
      ess: atPoint.ess,
      supportFraction: atPoint.supportFraction,
      smoothingBandwidthHours: atPoint.bandwidth,
      alpha: atPoint.alpha,
      inTail: false,
    };
  };

  const tailAnchorHazardPerHour = supportedDiagnostics(
    Math.max(0, hazard.maxSupportedAgeHours - 1e-6),
  ).lambdaPerHour;

  const diagnosticsAt = (ageHours: number): SurvivalConditionedHazardDiagnostics => {
    if (!Number.isFinite(ageHours)) {
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
      return supportedDiagnostics(ageHours);
    }
    const decay = 2 ** (-(ageHours - hazard.maxSupportedAgeHours) / hazard.tailHalfLifeHours);
    const tailLambda = baseLambda + (tailAnchorHazardPerHour - baseLambda) * decay;
    const safeLambda = Math.max(0, Number.isFinite(tailLambda) ? tailLambda : baseLambda);
    const q = clampFinite(1 - Math.exp(-safeLambda * binHours), 0, 1 - EPSILON);
    return {
      ageHours,
      qRaw: null,
      qNeighbor: q,
      q,
      lambdaPerHour: safeLambda,
      dailyProbability: clampFinite(1 - Math.exp(-safeLambda * 24), 0, 1),
      ess: 0,
      supportFraction: 0,
      smoothingBandwidthHours: hazard.maxSmoothingBandwidthHours,
      alpha: 0,
      inTail: true,
    };
  };

  return {
    priorRiskWeight,
    tailAnchorHazardPerHour,
    diagnosticsAt,
  };
}

export function getShrunkSurvivalHazardDiagnosticsAtAge(
  hazard: SurvivalConditionedHazard,
  ageHours: number,
): SurvivalConditionedHazardDiagnostics {
  return createShrunkSurvivalHazardEvaluator(hazard).diagnosticsAt(ageHours);
}

export function getShrunkSurvivalTailAnchorHazardPerHour(
  hazard: SurvivalConditionedHazard,
): number {
  return createShrunkSurvivalHazardEvaluator(hazard).tailAnchorHazardPerHour;
}

function validTimestamp(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function deduplicateBoundaries(
  boundaryAudit: RecoveryBoundaryAudit[],
  originTime: number,
): DeduplicatedBoundary[] {
  const candidates = boundaryAudit
    .flatMap((item): DeduplicatedBoundary[] => {
      const time = validTimestamp(item.resetAt);
      if (
        time === null ||
        time > originTime ||
        (!item.randomEligible && !item.regularEligible)
      ) return [];
      return [{ time, isRandom: item.randomEligible, isRegular: item.regularEligible }];
    })
    .sort((left, right) => left.time - right.time);

  const boundaries: DeduplicatedBoundary[] = [];
  for (const candidate of candidates) {
    const previous = boundaries.at(-1);
    const crossTypeBoundary = previous && (
      (previous.isRegular && !previous.isRandom && candidate.isRandom && !candidate.isRegular) ||
      (previous.isRandom && !previous.isRegular && candidate.isRegular && !candidate.isRandom)
    );
    const sameBoundary = previous && !crossTypeBoundary &&
      candidate.time - previous.time <= BOUNDARY_DEDUPE_WINDOW_MS;
    if (sameBoundary) {
      previous.isRandom ||= candidate.isRandom;
      previous.isRegular ||= candidate.isRegular;
      continue;
    }
    boundaries.push({ ...candidate });
  }
  return boundaries;
}

export function getAdaptiveRegimeRandomBoundaries(
  boundaryAudit: RecoveryBoundaryAudit[],
  origin: Date,
): RecoveryResetBoundary[] {
  const originTime = origin.getTime();
  if (!Number.isFinite(originTime)) return [];
  return deduplicateBoundaries(boundaryAudit, originTime)
    .filter((boundary) => boundary.isRandom)
    .map((boundary, index) => {
      const id = `adaptive-regime-boundary-${index}`;
      return {
        id,
        resetAt: new Date(boundary.time).toISOString(),
        isRandom: true,
        isRegular: boundary.isRegular,
        sourceIds: [id],
      };
    });
}

export function clampAdaptiveRegimeRateMultiplier(value: number) {
  const finiteValue = Number.isFinite(value) ? value : ADAPTIVE_REGIME_SURVIVAL_MIN_RATE_MULTIPLIER;
  return Math.min(
    ADAPTIVE_REGIME_SURVIVAL_MAX_RATE_MULTIPLIER,
    Math.max(ADAPTIVE_REGIME_SURVIVAL_MIN_RATE_MULTIPLIER, finiteValue),
  );
}

function rateFromSufficientStatistics(
  c0: number,
  e0: number,
  longTermHazardPerHour: number,
  futureHours: number,
) {
  const k = Math.LN2 / ADAPTIVE_REGIME_SURVIVAL_SHORT_HALF_LIFE_HOURS;
  const decay = Math.exp(-k * futureHours);
  const c = c0 * decay;
  const e = e0 * decay + (-Math.expm1(-k * futureHours)) / k;
  const shortRatePerHour = (
    c + ADAPTIVE_REGIME_SURVIVAL_PRIOR_EXPOSURE_HOURS * longTermHazardPerHour
  ) / (e + ADAPTIVE_REGIME_SURVIVAL_PRIOR_EXPOSURE_HOURS);
  const rawRateMultiplier = shortRatePerHour / longTermHazardPerHour;
  const rateMultiplier = clampAdaptiveRegimeRateMultiplier(rawRateMultiplier);
  const clampHit: AdaptiveRegimeRateState["clampHit"] = rawRateMultiplier < ADAPTIVE_REGIME_SURVIVAL_MIN_RATE_MULTIPLIER
    ? "minimum"
    : rawRateMultiplier > ADAPTIVE_REGIME_SURVIVAL_MAX_RATE_MULTIPLIER
      ? "maximum"
      : null;
  return { c, e, shortRatePerHour, rawRateMultiplier, rateMultiplier, clampHit };
}

export function getAdaptiveRegimeRateState(
  boundaryAudit: RecoveryBoundaryAudit[],
  origin: Date,
  longTermHazardPerHour: number,
  futureHours = 0,
): AdaptiveRegimeRateState {
  const originTime = origin.getTime();
  const invalid = (reason: string): AdaptiveRegimeRateState => ({
    valid: false,
    reason,
    anchorAt: null,
    randomBoundaryCount: 0,
    observedEventCount: 0,
    exposureHours: 0,
    c0: 0,
    e0: 0,
    longTermHazardPerHour,
    shortRatePerHour: null,
    rawRateMultiplier: null,
    rateMultiplier: null,
    clampHit: null,
  });
  if (!Number.isFinite(originTime)) return invalid("invalid_origin");
  if (!Number.isFinite(longTermHazardPerHour) || !(longTermHazardPerHour > 0)) {
    return invalid("invalid_long_term_hazard");
  }
  if (!Number.isFinite(futureHours) || futureHours < 0) return invalid("invalid_future_hours");

  const randomBoundaries = getAdaptiveRegimeRandomBoundaries(boundaryAudit, origin);
  const anchor = randomBoundaries[0];
  if (!anchor) return invalid("missing_random_history_anchor");
  const anchorTime = Date.parse(anchor.resetAt);
  const exposureHours = Math.max(0, (originTime - anchorTime) / HOUR_MS);
  const k = Math.LN2 / ADAPTIVE_REGIME_SURVIVAL_SHORT_HALF_LIFE_HOURS;
  const e0 = -Math.expm1(-k * exposureHours) / k;
  let c0 = 0;
  for (let index = 1; index < randomBoundaries.length; index += 1) {
    const boundaryTime = Date.parse(randomBoundaries[index].resetAt);
    c0 += Math.exp(-k * ((originTime - boundaryTime) / HOUR_MS));
  }
  const current = rateFromSufficientStatistics(c0, e0, longTermHazardPerHour, futureHours);
  const valid = [exposureHours, c0, e0, current.shortRatePerHour, current.rawRateMultiplier, current.rateMultiplier]
    .every(Number.isFinite) && current.shortRatePerHour > 0;
  if (!valid) return invalid("non_finite_rate_state");
  return {
    valid: true,
    reason: null,
    anchorAt: anchor.resetAt,
    randomBoundaryCount: randomBoundaries.length,
    observedEventCount: Math.max(0, randomBoundaries.length - 1),
    exposureHours,
    c0,
    e0,
    longTermHazardPerHour,
    shortRatePerHour: current.shortRatePerHour,
    rawRateMultiplier: current.rawRateMultiplier,
    rateMultiplier: current.rateMultiplier,
    clampHit: current.clampHit,
  };
}

function isValidHorizons(horizons: ShadowProbabilityHorizons) {
  const values = [
    horizons.probability12h,
    horizons.probability24h,
    horizons.probability48h,
    horizons.probability72h,
  ];
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && values[0] <= values[1]
    && values[1] <= values[2]
    && values[2] <= values[3];
}

function integrateRegimeAdjustedHazardWithDiagnostics(
  startAgeHours: number,
  state: AdaptiveRegimeRateState,
  diagnosticsAtAge: (ageHours: number) => Pick<SurvivalConditionedHazardDiagnostics, "lambdaPerHour">,
): ShadowProbabilityHorizons {
  const step = DEFAULT_INTEGRATION_STEP_HOURS;
  let cumulativeHazard = 0;
  let previousHazard = diagnosticsAtAge(startAgeHours).lambdaPerHour * (state.rateMultiplier ?? 1);
  const probabilities: Partial<Record<typeof HORIZONS[number], number>> = {};
  const totalSteps = Math.round(72 / step);

  for (let index = 0; index < totalSteps; index += 1) {
    const fromHours = index * step;
    const toHours = Math.min(72, (index + 1) * step);
    const rate = rateFromSufficientStatistics(
      state.c0,
      state.e0,
      state.longTermHazardPerHour,
      toHours,
    );
    const nextHazard = diagnosticsAtAge(startAgeHours + toHours).lambdaPerHour * rate.rateMultiplier;
    cumulativeHazard += ((previousHazard + nextHazard) / 2) * (toHours - fromHours);
    previousHazard = nextHazard;

    const reached = HORIZONS.find((horizon) => Math.abs(horizon - toHours) < 1e-9);
    if (reached !== undefined) probabilities[reached] = -Math.expm1(-Math.max(0, cumulativeHazard));
  }

  return {
    probability12h: probabilities[12] ?? 0,
    probability24h: probabilities[24] ?? 0,
    probability48h: probabilities[48] ?? 0,
    probability72h: probabilities[72] ?? 0,
  };
}

function calculateAdaptiveRegimeBaselineWithDiagnostics(
  hazard: SurvivalConditionedHazard,
  randomElapsedHours: number,
  boundaryAudit: RecoveryBoundaryAudit[],
  origin: Date,
  diagnosticsAtAge: (ageHours: number) => Pick<SurvivalConditionedHazardDiagnostics, "lambdaPerHour">,
): { state: AdaptiveRegimeRateState; baseline: ShadowProbabilityHorizons | null } {
  const state = getAdaptiveRegimeRateState(
    boundaryAudit,
    origin,
    hazard.longTermHazardPerHour,
  );
  if (!state.valid || !Number.isFinite(randomElapsedHours) || randomElapsedHours < 0) {
    return { state, baseline: null };
  }
  const baseline = integrateRegimeAdjustedHazardWithDiagnostics(
    randomElapsedHours,
    state,
    diagnosticsAtAge,
  );
  return { state, baseline: isValidHorizons(baseline) ? baseline : null };
}

export function calculateAdaptiveRegimeBaseline(
  hazard: SurvivalConditionedHazard,
  randomElapsedHours: number,
  boundaryAudit: RecoveryBoundaryAudit[],
  origin: Date,
): { state: AdaptiveRegimeRateState; baseline: ShadowProbabilityHorizons | null } {
  return calculateAdaptiveRegimeBaselineWithDiagnostics(
    hazard,
    randomElapsedHours,
    boundaryAudit,
    origin,
    (ageHours) => getSurvivalConditionedHazardDiagnosticsAtAge(hazard, ageHours),
  );
}

export function calculateAdaptiveRegimeSurvivalV3Baseline(
  hazard: SurvivalConditionedHazard,
  randomElapsedHours: number,
  boundaryAudit: RecoveryBoundaryAudit[],
  origin: Date,
): { state: AdaptiveRegimeRateState; baseline: ShadowProbabilityHorizons | null } {
  const evaluator = createShrunkSurvivalHazardEvaluator(hazard);
  return calculateAdaptiveRegimeBaselineWithDiagnostics(
    hazard,
    randomElapsedHours,
    boundaryAudit,
    origin,
    evaluator.diagnosticsAt,
  );
}

function buildCommonAuditFields(
  base: SurvivalConditionedProbabilityResult,
  state: AdaptiveRegimeRateState | undefined,
  options: {
    timedTeaserApplied: boolean;
    fallbackUsed: boolean;
    fallbackReason: string | null;
  },
): Omit<
  AdaptiveRegimeSurvivalAudit,
  "modelVersion" | "forecastPolicyVersion" | "freezeAt" | "freezePolicy"
> {
  return {
    baseModelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
    originAt: base.calculatedAt,
    shortHalfLifeHours: ADAPTIVE_REGIME_SURVIVAL_SHORT_HALF_LIFE_HOURS,
    priorExposureHours: ADAPTIVE_REGIME_SURVIVAL_PRIOR_EXPOSURE_HOURS,
    minRateMultiplier: ADAPTIVE_REGIME_SURVIVAL_MIN_RATE_MULTIPLIER,
    maxRateMultiplier: ADAPTIVE_REGIME_SURVIVAL_MAX_RATE_MULTIPLIER,
    integrationStepHours: DEFAULT_INTEGRATION_STEP_HOURS,
    randomEligibilityPolicyVersion: base.survival.randomEligibilityPolicyVersion,
    randomElapsedHours: base.survival.randomElapsedHours,
    latestRandomResetAt: base.survival.latestRandomResetAt,
    randomBoundaryCount: state?.randomBoundaryCount ?? 0,
    observedEventCount: state?.observedEventCount ?? 0,
    completedIntervalCount: base.hazard.completedIntervalCount,
    weightedEventCount: base.hazard.weightedEventCount,
    weightedExposureDays: base.hazard.weightedExposureHours / 24,
    historySupportValid: base.survival.historySupportValid,
    c0: state?.c0 ?? 0,
    e0: state?.e0 ?? 0,
    longTermHazardPerHour: base.hazard.longTermHazardPerHour,
    currentShortRatePerHour: state?.shortRatePerHour ?? null,
    currentRawRateMultiplier: state?.rawRateMultiplier ?? null,
    currentRateMultiplier: state?.rateMultiplier ?? null,
    rateClampHit: state?.clampHit ?? null,
    ordinaryMultiplier24h: base.survival.ordinarySignalMultipliers.combinedAfterCap.probability24h,
    ordinaryMultiplier48h: base.survival.ordinarySignalMultipliers.combinedAfterCap.probability48h,
    ordinarySignalsAppliedOnce: true as const,
    timedTeaserPolicyVersion: TIMED_TEASER_REALLOCATION_POLICY_VERSION,
    timedTeaserApplied: options.timedTeaserApplied,
    officialNoticeOverride: base.officialNoticeOverride.active,
    fallbackUsed: options.fallbackUsed,
    fallbackReason: options.fallbackReason,
  };
}

function computeAdaptiveRegimeCore(
  base: SurvivalConditionedProbabilityResult,
  computeBaseline: (baseResult: SurvivalConditionedProbabilityResult) => {
    state: AdaptiveRegimeRateState;
    baseline: ShadowProbabilityHorizons | null;
  },
):
  | {
      ok: true;
      state: AdaptiveRegimeRateState;
      baseline: ShadowProbabilityHorizons;
      predictions: ShadowProbabilityHorizons;
      timedTeaserApplied: boolean;
    }
  | { ok: false; reason: string; state?: AdaptiveRegimeRateState } {
  if (!isValidSurvivalConditionedPrediction(base)) {
    return { ok: false, reason: "invalid_survival_v1_base" };
  }
  const { state, baseline } = computeBaseline(base);
  if (!state.valid) return { ok: false, reason: state.reason ?? "invalid_rate_state", state };
  if (state.observedEventCount < 1) {
    return { ok: false, reason: "insufficient_random_boundaries", state };
  }
  if (!baseline) return { ok: false, reason: "invalid_baseline_horizons", state };

  const multipliers = base.survival.ordinarySignalMultipliers.combinedAfterCap;
  const ordinaryAdjusted: ShadowProbabilityHorizons = {
    probability12h: applyOddsMultiplier(baseline.probability12h, multipliers.probability24h),
    probability24h: applyOddsMultiplier(baseline.probability24h, multipliers.probability24h),
    probability48h: applyOddsMultiplier(baseline.probability48h, multipliers.probability48h),
    probability72h: applyOddsMultiplier(baseline.probability72h, multipliers.probability48h),
  };
  const teaser = applyTimedTeaserProbabilityReallocationFromAudit(
    ordinaryAdjusted,
    base.survival.timedTeaserReallocation,
  );
  const official = base.officialNoticeOverride;
  let predictions = teaser.predictions;
  if (official.active) {
    const values = [
      official.probability12h,
      official.probability24h,
      official.probability48h,
      official.probability72h,
    ];
    if (!values.every((value): value is number => Number.isFinite(value))) {
      return { ok: false, reason: "invalid_official_notice_override", state };
    }
    predictions = {
      probability12h: official.probability12h!,
      probability24h: official.probability24h!,
      probability48h: official.probability48h!,
      probability72h: official.probability72h!,
    };
  }
  if (!isValidHorizons(predictions)) {
    return { ok: false, reason: "invalid_final_horizons", state };
  }
  return {
    ok: true,
    state,
    baseline,
    predictions,
    timedTeaserApplied: Boolean(teaser.audit?.applied),
  };
}

function fallback(
  base: SurvivalConditionedProbabilityResult,
  reason: string,
  state?: AdaptiveRegimeRateState,
): AdaptiveRegimeSurvivalProbabilityResult {
  return {
    modelVersion: ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
    calculatedAt: base.calculatedAt,
    targetDefinition: ADAPTIVE_REGIME_SURVIVAL_TARGET_DEFINITION,
    predictions: base.predictions,
    baseline: base.baseline,
    confidence: base.confidence,
    audit: {
      modelVersion: ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
      forecastPolicyVersion: ADAPTIVE_REGIME_SURVIVAL_FORECAST_POLICY_VERSION,
      freezeAt: ADAPTIVE_REGIME_SURVIVAL_FREEZE_AT,
      freezePolicy: ADAPTIVE_REGIME_SURVIVAL_FREEZE_POLICY,
      ...buildCommonAuditFields(base, state, {
        timedTeaserApplied: Boolean(base.survival.timedTeaserReallocation?.applied),
        fallbackUsed: true,
        fallbackReason: reason,
      }),
    },
  };
}

function fallbackV3(
  base: SurvivalConditionedProbabilityResult,
  reason: string,
  state?: AdaptiveRegimeRateState,
  priorRiskWeight = 0,
  shrunkTailAnchorHazardPerHour: number | null = null,
): AdaptiveRegimeSurvivalV3ProbabilityResult {
  return {
    modelVersion: ADAPTIVE_REGIME_SURVIVAL_V3_MODEL_VERSION,
    calculatedAt: base.calculatedAt,
    targetDefinition: ADAPTIVE_REGIME_SURVIVAL_V3_TARGET_DEFINITION,
    predictions: base.predictions,
    baseline: base.baseline,
    confidence: base.confidence,
    audit: {
      modelVersion: ADAPTIVE_REGIME_SURVIVAL_V3_MODEL_VERSION,
      forecastPolicyVersion: ADAPTIVE_REGIME_SURVIVAL_V3_FORECAST_POLICY_VERSION,
      freezeAt: ADAPTIVE_REGIME_SURVIVAL_V3_FREEZE_AT,
      freezePolicy: ADAPTIVE_REGIME_SURVIVAL_V3_FREEZE_POLICY,
      priorRiskWeight,
      shrunkTailAnchorHazardPerHour,
      ...buildCommonAuditFields(base, state, {
        timedTeaserApplied: Boolean(base.survival.timedTeaserReallocation?.applied),
        fallbackUsed: true,
        fallbackReason: reason,
      }),
    },
  };
}

export function calculateAdaptiveRegimeSurvivalProbability(
  base: SurvivalConditionedProbabilityResult,
): AdaptiveRegimeSurvivalProbabilityResult {
  const core = computeAdaptiveRegimeCore(base, (baseResult) =>
    calculateAdaptiveRegimeBaseline(
      baseResult.hazard,
      baseResult.survival.randomElapsedHours,
      baseResult.survival.boundaryAudit,
      new Date(baseResult.calculatedAt),
    ),
  );
  if (!core.ok) return fallback(base, core.reason, core.state);

  return {
    modelVersion: ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
    calculatedAt: base.calculatedAt,
    targetDefinition: ADAPTIVE_REGIME_SURVIVAL_TARGET_DEFINITION,
    predictions: core.predictions,
    baseline: core.baseline,
    confidence: base.confidence,
    audit: {
      modelVersion: ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
      forecastPolicyVersion: ADAPTIVE_REGIME_SURVIVAL_FORECAST_POLICY_VERSION,
      freezeAt: ADAPTIVE_REGIME_SURVIVAL_FREEZE_AT,
      freezePolicy: ADAPTIVE_REGIME_SURVIVAL_FREEZE_POLICY,
      ...buildCommonAuditFields(base, core.state, {
        timedTeaserApplied: core.timedTeaserApplied,
        fallbackUsed: false,
        fallbackReason: null,
      }),
    },
  };
}

export function calculateAdaptiveRegimeSurvivalV3Probability(
  base: SurvivalConditionedProbabilityResult,
): AdaptiveRegimeSurvivalV3ProbabilityResult {
  const evaluator = createShrunkSurvivalHazardEvaluator(base.hazard);
  const core = computeAdaptiveRegimeCore(base, (baseResult) =>
    calculateAdaptiveRegimeBaselineWithDiagnostics(
      baseResult.hazard,
      baseResult.survival.randomElapsedHours,
      baseResult.survival.boundaryAudit,
      new Date(baseResult.calculatedAt),
      evaluator.diagnosticsAt,
    ),
  );
  if (!core.ok) {
    return fallbackV3(
      base,
      core.reason,
      core.state,
      evaluator.priorRiskWeight,
      evaluator.tailAnchorHazardPerHour > 0 ? evaluator.tailAnchorHazardPerHour : null,
    );
  }

  return {
    modelVersion: ADAPTIVE_REGIME_SURVIVAL_V3_MODEL_VERSION,
    calculatedAt: base.calculatedAt,
    targetDefinition: ADAPTIVE_REGIME_SURVIVAL_V3_TARGET_DEFINITION,
    predictions: core.predictions,
    baseline: core.baseline,
    confidence: base.confidence,
    audit: {
      modelVersion: ADAPTIVE_REGIME_SURVIVAL_V3_MODEL_VERSION,
      forecastPolicyVersion: ADAPTIVE_REGIME_SURVIVAL_V3_FORECAST_POLICY_VERSION,
      freezeAt: ADAPTIVE_REGIME_SURVIVAL_V3_FREEZE_AT,
      freezePolicy: ADAPTIVE_REGIME_SURVIVAL_V3_FREEZE_POLICY,
      priorRiskWeight: evaluator.priorRiskWeight,
      shrunkTailAnchorHazardPerHour: evaluator.tailAnchorHazardPerHour,
      ...buildCommonAuditFields(base, core.state, {
        timedTeaserApplied: core.timedTeaserApplied,
        fallbackUsed: false,
        fallbackReason: null,
      }),
    },
  };
}

function isValidAdaptiveRegimeResultCommon(
  result: {
    modelVersion: string;
    baseline: ShadowProbabilityHorizons;
    predictions: ShadowProbabilityHorizons;
    audit: {
      modelVersion: string;
      baseModelVersion: string;
      fallbackUsed: boolean;
      historySupportValid: boolean;
      completedIntervalCount: number;
      longTermHazardPerHour: number;
      c0: number;
      e0: number;
      currentRateMultiplier: number | null;
    };
  },
  expectedModelVersion: string,
) {
  return result.modelVersion === expectedModelVersion
    && result.audit.modelVersion === expectedModelVersion
    && result.audit.baseModelVersion === SURVIVAL_CONDITIONED_MODEL_VERSION
    && result.audit.fallbackUsed === false
    && result.audit.historySupportValid
    && result.audit.completedIntervalCount >= 36
    && Number.isFinite(result.audit.longTermHazardPerHour)
    && result.audit.longTermHazardPerHour > 0
    && Number.isFinite(result.audit.c0)
    && result.audit.c0 >= 0
    && Number.isFinite(result.audit.e0)
    && result.audit.e0 >= 0
    && Number.isFinite(result.audit.currentRateMultiplier)
    && isValidHorizons(result.baseline)
    && isValidHorizons(result.predictions);
}

export function isValidAdaptiveRegimeSurvivalPrediction(
  result: AdaptiveRegimeSurvivalProbabilityResult,
) {
  return isValidAdaptiveRegimeResultCommon(result, ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION);
}

export function isValidAdaptiveRegimeSurvivalV3Prediction(
  result: AdaptiveRegimeSurvivalV3ProbabilityResult,
) {
  return isValidAdaptiveRegimeResultCommon(result, ADAPTIVE_REGIME_SURVIVAL_V3_MODEL_VERSION)
    && Number.isFinite(result.audit.priorRiskWeight)
    && result.audit.priorRiskWeight > 0
    && Number.isFinite(result.audit.shrunkTailAnchorHazardPerHour)
    && (result.audit.shrunkTailAnchorHazardPerHour ?? 0) > 0;
}
