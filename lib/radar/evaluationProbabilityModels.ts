import {
  MAX_BASELINE_DAILY_PROBABILITY,
  MIN_BASELINE_DAILY_PROBABILITY,
} from "@/data/shadowProbabilityConfig";
import {
  applyOddsMultiplier,
  getConstantProbabilityBaseline,
  type ShadowHazard,
  type ShadowProbabilityPair,
  type ShadowProbabilityResult,
} from "./shadowProbability";

const HOUR_MS = 60 * 60 * 1000;
const LOGIT_EPSILON = 1e-12;

export const PREQUENTIAL_CALIBRATION_PRIOR_STD_DEV = 0.5;
export const PREQUENTIAL_CALIBRATION_MIN_SAMPLES = 10;

export type EvaluationProbabilityResult = {
  baseline: ShadowProbabilityPair;
  predictions: ShadowProbabilityPair;
};

export type PrequentialCalibrationRow = {
  recordedAt: string;
  probability24h: number;
  probability48h: number;
  actual24h: boolean;
  actual48h: boolean;
};

export type PrequentialCalibrationAudit = {
  origin: string;
  rawProbability24h: number;
  rawProbability48h: number;
  alpha24h: number;
  alpha48h: number;
  calibrationSampleCount24h: number;
  calibrationSampleCount48h: number;
  calibratedProbability24h: number;
  calibratedProbability48h: number;
};

function clampProbability(value: number) {
  return Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function clampLogitProbability(value: number) {
  return Math.min(1 - LOGIT_EPSILON, Math.max(LOGIT_EPSILON, clampProbability(value)));
}

function logit(value: number) {
  const safe = clampLogitProbability(value);
  return Math.log(safe / (1 - safe));
}

function sigmoid(value: number) {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Constant hazard baseline for the evaluation benchmark.
 * The start age is accepted for parity with the existing helper, but it does
 * not affect a constant hazard model.
 */
export function getConstantHazardBaseline(
  hazard: ShadowHazard,
  startAgeHours: number,
  horizonHours: number,
) {
  const rawDailyProbability = getConstantProbabilityBaseline(hazard, startAgeHours, 24);
  const dailyProbability = Math.min(
    MAX_BASELINE_DAILY_PROBABILITY,
    Math.max(MIN_BASELINE_DAILY_PROBABILITY, rawDailyProbability),
  );
  const lambdaPerHour = -Math.log1p(-dailyProbability) / 24;
  return clampProbability(1 - Math.exp(-lambdaPerHour * Math.max(0, horizonHours)));
}

/**
 * Evaluation-only constant-hazard comparison using the same multipliers and
 * notice override as the supplied v2 result.
 */
export function calculateConstantHazardBenchmark(
  shadow: ShadowProbabilityResult,
): EvaluationProbabilityResult {
  const baseline = {
    probability24h: getConstantHazardBaseline(shadow.hazard, 0, 24),
    probability48h: getConstantHazardBaseline(shadow.hazard, 0, 48),
  } satisfies ShadowProbabilityPair;
  const adjusted = {
    probability24h: applyOddsMultiplier(
      baseline.probability24h,
      shadow.multipliers.combinedAfterCap.probability24h,
    ),
    probability48h: applyOddsMultiplier(
      baseline.probability48h,
      shadow.multipliers.combinedAfterCap.probability48h,
    ),
  } satisfies ShadowProbabilityPair;

  return {
    baseline,
    predictions: shadow.officialNoticeOverride.active
      ? {
          probability24h: shadow.officialNoticeOverride.probability24h ?? 0.9,
          probability48h: shadow.officialNoticeOverride.probability48h ?? 0.96,
        }
      : adjusted,
  };
}

function getEligibleCalibrationRows(
  rows: Array<PrequentialCalibrationRow>,
  currentOrigin: string,
  horizonHours: number,
) {
  const currentTime = timestamp(currentOrigin);
  if (currentTime === null) return [];
  const horizonMs = horizonHours * HOUR_MS;
  return rows.filter((row) => {
    const pastOrigin = timestamp(row.recordedAt);
    return pastOrigin !== null
      && pastOrigin < currentTime
      && pastOrigin + horizonMs <= currentTime;
  });
}

export function fitLogitInterceptMAP(
  samples: Array<{ probability: number; actual: boolean }>,
  priorStdDev = PREQUENTIAL_CALIBRATION_PRIOR_STD_DEV,
  minimumSamples = PREQUENTIAL_CALIBRATION_MIN_SAMPLES,
) {
  if (
    samples.length < minimumSamples
    || !Number.isFinite(priorStdDev)
    || priorStdDev <= 0
  ) {
    return 0;
  }

  const priorPrecision = 1 / (priorStdDev * priorStdDev);
  let alpha = 0;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    let gradient = -alpha * priorPrecision;
    let information = priorPrecision;
    for (const sample of samples) {
      const probability = sigmoid(logit(sample.probability) + alpha);
      gradient += Number(sample.actual) - probability;
      information += probability * (1 - probability);
    }
    const nextAlpha = Math.min(20, Math.max(-20, alpha + gradient / information));
    alpha = nextAlpha;
    if (Math.abs(gradient) < 1e-12 || Math.abs(gradient / information) < 1e-12) {
      break;
    }
  }
  return Number.isFinite(alpha) ? alpha : 0;
}

export function calibrateLogitProbability(probability: number, alpha: number) {
  if (!Number.isFinite(alpha)) return clampProbability(probability);
  return clampProbability(sigmoid(logit(probability) + alpha));
}

export function calculatePrequentialLogitCalibration(
  current: PrequentialCalibrationRow,
  pastRows: Array<PrequentialCalibrationRow>,
): PrequentialCalibrationAudit {
  const rows24h = getEligibleCalibrationRows(pastRows, current.recordedAt, 24);
  const rows48h = getEligibleCalibrationRows(pastRows, current.recordedAt, 48);
  const alpha24h = fitLogitInterceptMAP(rows24h.map((row) => ({
    probability: row.probability24h,
    actual: row.actual24h,
  })));
  const alpha48h = fitLogitInterceptMAP(rows48h.map((row) => ({
    probability: row.probability48h,
    actual: row.actual48h,
  })));

  return {
    origin: current.recordedAt,
    rawProbability24h: current.probability24h,
    rawProbability48h: current.probability48h,
    alpha24h,
    alpha48h,
    calibrationSampleCount24h: rows24h.length,
    calibrationSampleCount48h: rows48h.length,
    calibratedProbability24h: calibrateLogitProbability(current.probability24h, alpha24h),
    calibratedProbability48h: calibrateLogitProbability(current.probability48h, alpha48h),
  };
}
