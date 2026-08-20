import {
  CALIBRATED_SHADOW_MODEL_VERSION,
  PUBLISHED_ELAPSED_MODEL_OPTIONS,
  PUBLISHED_RECENCY_HALF_LIFE_DAYS,
  PUBLISHED_STABLE_FALLBACK_MODEL_VERSION,
  RECENCY_H30_PROBABILITY_MODEL_VERSION,
} from "@/data/shadowProbabilityConfig";
import type {
  ActiveOfficialNotice,
  LocalSignalEvaluation,
  ProbabilityCalculationAudit,
} from "./probability";
import { getLocalProbabilityCalculation } from "./probability";
import {
  derive12hFrom24hProbability,
  derive72hFrom48hProbability,
  calculateShadowProbability,
  type ShadowProbabilityResult,
} from "./shadowProbability";
import {
  calculateCalibratedShadowProbability,
  type CalibratedShadowProbabilityResult,
} from "./calibratedShadowProbability";
import { calculateRegimeElapsedProbability } from "./regimeElapsedProbability";
import { calculateRecencyWeightedShadowProbability } from "./recencyWeightedProbability";
import type { RadarData } from "./types";

export type PublishedProbabilitySource =
  | "calibrated"
  | "stable-shadow-fallback"
  | "legacy-shadow-fallback"
  | "heuristic-fallback";
export type PublishedProbabilityFallbackReason =
  | "calibrated_exception"
  | "calibrated_fallback"
  | "calibrated_invalid_prediction"
  | "stable_shadow_exception"
  | "stable_shadow_invalid_prediction"
  | "shadow_exception"
  | "shadow_invalid_prediction";

const PUBLIC_CALCULATION_INTERVAL_MS = 10 * 60 * 1000;

export function roundPublicProbabilityTime(now: Date) {
  const time = now.getTime();
  if (!Number.isFinite(time)) return now;
  return new Date(Math.floor(time / PUBLIC_CALCULATION_INTERVAL_MS) * PUBLIC_CALCULATION_INTERVAL_MS);
}

export type PublishedProbabilityCalculation = {
  probability12h: number;
  probability24h: number;
  probability48h: number;
  probability72h: number;
  adoptedModel: string;
  source: PublishedProbabilitySource;
  fallbackReason: PublishedProbabilityFallbackReason | null;
  primary: ProbabilityCalculationAudit;
  calibrated: CalibratedShadowProbabilityResult | null;
  rawShadow: ShadowProbabilityResult | null;
  stableShadow: ShadowProbabilityResult | null;
  shadow: ShadowProbabilityResult | null;
};

export function isValidCalibratedPrediction(
  calibrated: Pick<
    CalibratedShadowProbabilityResult,
    "modelVersion" | "probability24h" | "probability48h" | "fallbackUsed"
  >,
) {
  return (
    calibrated.modelVersion === CALIBRATED_SHADOW_MODEL_VERSION &&
    calibrated.fallbackUsed === false &&
    Number.isFinite(calibrated.probability24h) &&
    Number.isFinite(calibrated.probability48h) &&
    calibrated.probability24h >= 0 &&
    calibrated.probability24h <= 1 &&
    calibrated.probability48h >= 0 &&
    calibrated.probability48h <= 1 &&
    calibrated.probability24h <= calibrated.probability48h
  );
}

export function isValidShadowPrediction(
  shadow: Pick<ShadowProbabilityResult, "modelVersion" | "predictions">,
  modelVersion = PUBLISHED_STABLE_FALLBACK_MODEL_VERSION,
) {
  const probability12h = shadow.predictions?.probability12h;
  const probability24h = shadow.predictions?.probability24h;
  const probability48h = shadow.predictions?.probability48h;
  const probability72h = shadow.predictions?.probability72h;

  return (
    shadow.modelVersion === modelVersion &&
    Number.isFinite(probability12h) &&
    Number.isFinite(probability24h) &&
    Number.isFinite(probability48h) &&
    Number.isFinite(probability72h) &&
    probability12h >= 0 &&
    probability12h <= 1 &&
    probability24h >= 0 &&
    probability24h <= 1 &&
    probability48h >= 0 &&
    probability48h <= 1 &&
    probability72h >= 0 &&
    probability72h <= 1 &&
    probability12h <= probability24h &&
    probability24h <= probability48h &&
    probability48h <= probability72h
  );
}

function isValidModelPrediction(
  shadow: Pick<ShadowProbabilityResult, "modelVersion" | "predictions">,
  modelVersion: string,
) {
  const probability12h = shadow.predictions?.probability12h;
  const probability24h = shadow.predictions?.probability24h;
  const probability48h = shadow.predictions?.probability48h;
  const probability72h = shadow.predictions?.probability72h;

  return (
    shadow.modelVersion === modelVersion &&
    Number.isFinite(probability12h) &&
    Number.isFinite(probability24h) &&
    Number.isFinite(probability48h) &&
    Number.isFinite(probability72h) &&
    probability12h >= 0 &&
    probability12h <= 1 &&
    probability24h >= 0 &&
    probability24h <= 1 &&
    probability48h >= 0 &&
    probability48h <= 1 &&
    probability72h >= 0 &&
    probability72h <= 1 &&
    probability12h <= probability24h &&
    probability24h <= probability48h &&
    probability48h <= probability72h
  );
}

export function selectPublishedProbability(
  primary: ProbabilityCalculationAudit,
  calibrated: CalibratedShadowProbabilityResult | null,
  stableShadow: ShadowProbabilityResult | null,
  fallbackReason: PublishedProbabilityCalculation["fallbackReason"] = null,
  legacyShadow: ShadowProbabilityResult | null = null,
  rawShadow: ShadowProbabilityResult | null = null,
): PublishedProbabilityCalculation {
  if (calibrated && isValidCalibratedPrediction(calibrated)) {
    return {
      probability12h: derive12hFrom24hProbability(calibrated.probability24h),
      probability24h: calibrated.probability24h,
      probability48h: calibrated.probability48h,
      probability72h: derive72hFrom48hProbability(calibrated.probability48h),
      adoptedModel: calibrated.modelVersion,
      source: "calibrated",
      fallbackReason: null,
      primary,
      calibrated,
      rawShadow,
      stableShadow,
      shadow: null,
    };
  }

  if (stableShadow && isValidShadowPrediction(stableShadow, PUBLISHED_STABLE_FALLBACK_MODEL_VERSION)) {
    return {
      probability12h: stableShadow.predictions.probability12h,
      probability24h: stableShadow.predictions.probability24h,
      probability48h: stableShadow.predictions.probability48h,
      probability72h: stableShadow.predictions.probability72h,
      adoptedModel: stableShadow.modelVersion,
      source: "stable-shadow-fallback",
      fallbackReason: fallbackReason ?? "calibrated_invalid_prediction",
      primary,
      calibrated,
      rawShadow,
      stableShadow,
      shadow: stableShadow,
    };
  }

  if (legacyShadow && isValidModelPrediction(legacyShadow, RECENCY_H30_PROBABILITY_MODEL_VERSION)) {
    return {
      probability12h: legacyShadow.predictions.probability12h,
      probability24h: legacyShadow.predictions.probability24h,
      probability48h: legacyShadow.predictions.probability48h,
      probability72h: legacyShadow.predictions.probability72h,
      adoptedModel: legacyShadow.modelVersion,
      source: "legacy-shadow-fallback",
      fallbackReason: fallbackReason ?? "stable_shadow_invalid_prediction",
      primary,
      calibrated,
      rawShadow,
      stableShadow,
      shadow: legacyShadow,
    };
  }

  const resolvedFallbackReason = fallbackReason ?? "stable_shadow_invalid_prediction";

  return {
    probability12h: derive12hFrom24hProbability(primary.probability24h),
    probability24h: primary.probability24h,
    probability48h: primary.probability48h,
    probability72h: derive72hFrom48hProbability(primary.probability48h),
    adoptedModel: primary.modelVersion,
    source: "heuristic-fallback",
    fallbackReason: resolvedFallbackReason,
    primary,
    calibrated,
    rawShadow,
    stableShadow,
    shadow: stableShadow,
  };
}

function logPublishedProbabilityFallback(
  calculation: PublishedProbabilityCalculation,
) {
  if (calculation.source === "calibrated") return;

  console.warn("[Published probability fallback]", {
    reason: calculation.fallbackReason,
    calibratedModelVersion: calculation.calibrated?.modelVersion ?? null,
    calibratedFallbackUsed: calculation.calibrated?.fallbackUsed ?? null,
    calibratedAlpha24h: calculation.calibrated?.alpha24h ?? null,
    calibratedAlpha48h: calculation.calibrated?.alpha48h ?? null,
    calibratedSampleCount24h: calculation.calibrated?.calibrationSampleCount24h ?? null,
    calibratedSampleCount48h: calculation.calibrated?.calibrationSampleCount48h ?? null,
    shadowModelVersion: calculation.shadow?.modelVersion ?? null,
    shadowConfidence: calculation.shadow?.confidence.level ?? null,
    completedIntervalCount: calculation.shadow?.confidence.completedIntervalCount ?? null,
    totalExposureDays: calculation.shadow?.confidence.totalExposureDays ?? null,
  });
}

export function calculatePublishedProbability(
  data: RadarData | null,
  options: {
    now?: Date;
    signalEvaluation?: LocalSignalEvaluation;
    activeOfficialNotice?: ActiveOfficialNotice | null;
    regularResetExpectedAt?: string | null;
  } = {},
  runtime: { logFallback?: boolean } = {},
): PublishedProbabilityCalculation {
  const primary = getLocalProbabilityCalculation(data, options);
  const publicModelOptions = {
    ...options,
    now: roundPublicProbabilityTime(options.now ?? new Date()),
  };

  let rawShadow: ShadowProbabilityResult | null = null;
  let calibrated: CalibratedShadowProbabilityResult | null = null;
  let stableShadow: ShadowProbabilityResult | null = null;
  let fallbackReason: PublishedProbabilityFallbackReason | null = null;

  try {
    rawShadow = calculateShadowProbability(data, publicModelOptions);
    calibrated = calculateCalibratedShadowProbability(data, {
      ...publicModelOptions,
      shadowProbability: rawShadow,
    });
    if (!isValidCalibratedPrediction(calibrated)) {
      fallbackReason = calibrated.fallbackUsed
        ? "calibrated_fallback"
        : "calibrated_invalid_prediction";
    }
  } catch {
    fallbackReason = "calibrated_exception";
  }

  try {
    stableShadow = calculateRegimeElapsedProbability(
      data,
      publicModelOptions,
      PUBLISHED_ELAPSED_MODEL_OPTIONS,
    );
    if (!isValidShadowPrediction(stableShadow, PUBLISHED_STABLE_FALLBACK_MODEL_VERSION) && !fallbackReason) {
      fallbackReason = "stable_shadow_invalid_prediction";
    }
  } catch {
    if (!fallbackReason) fallbackReason = "stable_shadow_exception";
  }

  let legacyShadow: ShadowProbabilityResult | null = null;
  if (!(calibrated && isValidCalibratedPrediction(calibrated)) ||
      !(stableShadow && isValidShadowPrediction(stableShadow, PUBLISHED_STABLE_FALLBACK_MODEL_VERSION))) {
    try {
      legacyShadow = calculateRecencyWeightedShadowProbability(
        data,
        PUBLISHED_RECENCY_HALF_LIFE_DAYS,
        publicModelOptions,
      );
    } catch {
      legacyShadow = null;
    }
  }

  const selected = selectPublishedProbability(
    primary,
    calibrated,
    stableShadow,
    fallbackReason,
    legacyShadow,
    rawShadow,
  );
  if (runtime.logFallback !== false) logPublishedProbabilityFallback(selected);
  return selected;
}
