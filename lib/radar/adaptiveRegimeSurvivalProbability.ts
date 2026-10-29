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
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  TIMED_TEASER_REALLOCATION_POLICY_VERSION,
} from "@/data/shadowProbabilityConfig";
import { applyOddsMultiplier, type ShadowProbabilityHorizons } from "./shadowProbability";
import {
  getSurvivalConditionedHazardDiagnosticsAtAge,
  isValidSurvivalConditionedPrediction,
  type SurvivalConditionedHazard,
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

function integrateRegimeAdjustedHazard(
  hazard: SurvivalConditionedHazard,
  startAgeHours: number,
  state: AdaptiveRegimeRateState,
): ShadowProbabilityHorizons {
  const step = DEFAULT_INTEGRATION_STEP_HOURS;
  let cumulativeHazard = 0;
  let previousHazard = getSurvivalConditionedHazardDiagnosticsAtAge(
    hazard,
    startAgeHours,
  ).lambdaPerHour * (state.rateMultiplier ?? 1);
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
    const nextHazard = getSurvivalConditionedHazardDiagnosticsAtAge(
      hazard,
      startAgeHours + toHours,
    ).lambdaPerHour * rate.rateMultiplier;
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

export function calculateAdaptiveRegimeBaseline(
  hazard: SurvivalConditionedHazard,
  randomElapsedHours: number,
  boundaryAudit: RecoveryBoundaryAudit[],
  origin: Date,
): { state: AdaptiveRegimeRateState; baseline: ShadowProbabilityHorizons | null } {
  const state = getAdaptiveRegimeRateState(
    boundaryAudit,
    origin,
    hazard.longTermHazardPerHour,
  );
  if (!state.valid || !Number.isFinite(randomElapsedHours) || randomElapsedHours < 0) {
    return { state, baseline: null };
  }
  const baseline = integrateRegimeAdjustedHazard(hazard, randomElapsedHours, state);
  return { state, baseline: isValidHorizons(baseline) ? baseline : null };
}

function fallback(
  base: SurvivalConditionedProbabilityResult,
  reason: string,
  state?: AdaptiveRegimeRateState,
): AdaptiveRegimeSurvivalProbabilityResult {
  const originAt = base.calculatedAt;
  const audit: AdaptiveRegimeSurvivalAudit = {
    modelVersion: ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
    baseModelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
    originAt,
    shortHalfLifeHours: ADAPTIVE_REGIME_SURVIVAL_SHORT_HALF_LIFE_HOURS,
    priorExposureHours: ADAPTIVE_REGIME_SURVIVAL_PRIOR_EXPOSURE_HOURS,
    minRateMultiplier: ADAPTIVE_REGIME_SURVIVAL_MIN_RATE_MULTIPLIER,
    maxRateMultiplier: ADAPTIVE_REGIME_SURVIVAL_MAX_RATE_MULTIPLIER,
    forecastPolicyVersion: ADAPTIVE_REGIME_SURVIVAL_FORECAST_POLICY_VERSION,
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
    ordinarySignalsAppliedOnce: true,
    timedTeaserPolicyVersion: TIMED_TEASER_REALLOCATION_POLICY_VERSION,
    timedTeaserApplied: Boolean(base.survival.timedTeaserReallocation?.applied),
    officialNoticeOverride: base.officialNoticeOverride.active,
    freezeAt: ADAPTIVE_REGIME_SURVIVAL_FREEZE_AT,
    freezePolicy: ADAPTIVE_REGIME_SURVIVAL_FREEZE_POLICY,
    fallbackUsed: true,
    fallbackReason: reason,
  };
  return {
    modelVersion: ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
    calculatedAt: originAt,
    targetDefinition: ADAPTIVE_REGIME_SURVIVAL_TARGET_DEFINITION,
    predictions: base.predictions,
    baseline: base.baseline,
    confidence: base.confidence,
    audit,
  };
}

export function calculateAdaptiveRegimeSurvivalProbability(
  base: SurvivalConditionedProbabilityResult,
): AdaptiveRegimeSurvivalProbabilityResult {
  if (!isValidSurvivalConditionedPrediction(base)) return fallback(base, "invalid_survival_v1_base");
  const { state, baseline } = calculateAdaptiveRegimeBaseline(
    base.hazard,
    base.survival.randomElapsedHours,
    base.survival.boundaryAudit,
    new Date(base.calculatedAt),
  );
  if (!state.valid) return fallback(base, state.reason ?? "invalid_rate_state", state);
  if (state.observedEventCount < 1) return fallback(base, "insufficient_random_boundaries", state);
  if (!baseline) return fallback(base, "invalid_baseline_horizons", state);

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
      return fallback(base, "invalid_official_notice_override", state);
    }
    predictions = {
      probability12h: official.probability12h!,
      probability24h: official.probability24h!,
      probability48h: official.probability48h!,
      probability72h: official.probability72h!,
    };
  }
  if (!isValidHorizons(predictions)) return fallback(base, "invalid_final_horizons", state);

  return {
    modelVersion: ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
    calculatedAt: base.calculatedAt,
    targetDefinition: ADAPTIVE_REGIME_SURVIVAL_TARGET_DEFINITION,
    predictions,
    baseline,
    confidence: base.confidence,
    audit: {
      modelVersion: ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
      baseModelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
      originAt: base.calculatedAt,
      shortHalfLifeHours: ADAPTIVE_REGIME_SURVIVAL_SHORT_HALF_LIFE_HOURS,
      priorExposureHours: ADAPTIVE_REGIME_SURVIVAL_PRIOR_EXPOSURE_HOURS,
      minRateMultiplier: ADAPTIVE_REGIME_SURVIVAL_MIN_RATE_MULTIPLIER,
      maxRateMultiplier: ADAPTIVE_REGIME_SURVIVAL_MAX_RATE_MULTIPLIER,
      forecastPolicyVersion: ADAPTIVE_REGIME_SURVIVAL_FORECAST_POLICY_VERSION,
      integrationStepHours: DEFAULT_INTEGRATION_STEP_HOURS,
      randomEligibilityPolicyVersion: base.survival.randomEligibilityPolicyVersion,
      randomElapsedHours: base.survival.randomElapsedHours,
      latestRandomResetAt: base.survival.latestRandomResetAt,
      randomBoundaryCount: state.randomBoundaryCount,
      observedEventCount: state.observedEventCount,
      completedIntervalCount: base.hazard.completedIntervalCount,
      weightedEventCount: base.hazard.weightedEventCount,
      weightedExposureDays: base.hazard.weightedExposureHours / 24,
      historySupportValid: base.survival.historySupportValid,
      c0: state.c0,
      e0: state.e0,
      longTermHazardPerHour: base.hazard.longTermHazardPerHour,
      currentShortRatePerHour: state.shortRatePerHour,
      currentRawRateMultiplier: state.rawRateMultiplier,
      currentRateMultiplier: state.rateMultiplier,
      rateClampHit: state.clampHit,
      ordinaryMultiplier24h: multipliers.probability24h,
      ordinaryMultiplier48h: multipliers.probability48h,
      ordinarySignalsAppliedOnce: true,
      timedTeaserPolicyVersion: TIMED_TEASER_REALLOCATION_POLICY_VERSION,
      timedTeaserApplied: Boolean(teaser.audit?.applied),
      officialNoticeOverride: official.active,
      freezeAt: ADAPTIVE_REGIME_SURVIVAL_FREEZE_AT,
      freezePolicy: ADAPTIVE_REGIME_SURVIVAL_FREEZE_POLICY,
      fallbackUsed: false,
      fallbackReason: null,
    },
  };
}

export function isValidAdaptiveRegimeSurvivalPrediction(
  result: AdaptiveRegimeSurvivalProbabilityResult,
) {
  return result.modelVersion === ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION
    && result.audit.modelVersion === ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION
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
