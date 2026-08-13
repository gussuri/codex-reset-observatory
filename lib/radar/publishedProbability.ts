import {
  PUBLISHED_REGIME_ELAPSED_MODEL_OPTIONS,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  PUBLISHED_RECENCY_HALF_LIFE_DAYS,
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
  type ShadowProbabilityResult,
} from "./shadowProbability";
import { calculateRegimeElapsedProbability } from "./regimeElapsedProbability";
import { calculateRecencyWeightedShadowProbability } from "./recencyWeightedProbability";
import type { RadarData } from "./types";

export type PublishedProbabilitySource = "shadow" | "legacy-shadow-fallback" | "heuristic-fallback";
export type PublishedProbabilityFallbackReason =
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
  shadow: ShadowProbabilityResult | null;
};

export function isValidShadowPrediction(
  shadow: Pick<ShadowProbabilityResult, "modelVersion" | "predictions">,
) {
  const probability12h = shadow.predictions?.probability12h;
  const probability24h = shadow.predictions?.probability24h;
  const probability48h = shadow.predictions?.probability48h;
  const probability72h = shadow.predictions?.probability72h;

  return (
    shadow.modelVersion === PUBLISHED_PROBABILITY_MODEL_VERSION &&
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
  shadow: ShadowProbabilityResult | null,
  fallbackReason: PublishedProbabilityCalculation["fallbackReason"] = null,
  legacyShadow: ShadowProbabilityResult | null = null,
): PublishedProbabilityCalculation {
  if (shadow && isValidShadowPrediction(shadow)) {
    return {
      probability12h: shadow.predictions.probability12h,
      probability24h: shadow.predictions.probability24h,
      probability48h: shadow.predictions.probability48h,
      probability72h: shadow.predictions.probability72h,
      adoptedModel: shadow.modelVersion,
      source: "shadow",
      fallbackReason: null,
      primary,
      shadow,
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
      fallbackReason: fallbackReason ?? "shadow_invalid_prediction",
      primary,
      shadow,
    };
  }

  const resolvedFallbackReason = fallbackReason ?? "shadow_invalid_prediction";

  return {
    probability12h: derive12hFrom24hProbability(primary.probability24h),
    probability24h: primary.probability24h,
    probability48h: primary.probability48h,
    probability72h: derive72hFrom48hProbability(primary.probability48h),
    adoptedModel: primary.modelVersion,
    source: "heuristic-fallback",
    fallbackReason: resolvedFallbackReason,
    primary,
    shadow,
  };
}

function logPublishedProbabilityFallback(
  calculation: PublishedProbabilityCalculation,
) {
  if (calculation.source === "shadow") return;

  console.warn("[Published probability fallback]", {
    reason: calculation.fallbackReason,
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

  try {
    const shadow = calculateRegimeElapsedProbability(
      data,
      publicModelOptions,
      PUBLISHED_REGIME_ELAPSED_MODEL_OPTIONS,
    );
    let legacyShadow: ShadowProbabilityResult | null = null;
    if (!isValidShadowPrediction(shadow)) {
      try {
        legacyShadow = calculateRecencyWeightedShadowProbability(
          data,
          PUBLISHED_RECENCY_HALF_LIFE_DAYS,
          options,
        );
      } catch {
        legacyShadow = null;
      }
    }
    const selected = selectPublishedProbability(
      primary,
      shadow,
      isValidShadowPrediction(shadow) ? null : "shadow_invalid_prediction",
      legacyShadow,
    );
    if (runtime.logFallback !== false) logPublishedProbabilityFallback(selected);
    return selected;
  } catch {
    let legacyShadow: ShadowProbabilityResult | null = null;
    try {
      legacyShadow = calculateRecencyWeightedShadowProbability(
        data,
        PUBLISHED_RECENCY_HALF_LIFE_DAYS,
        options,
      );
    } catch {
      legacyShadow = null;
    }
    const selected = selectPublishedProbability(primary, null, "shadow_exception", legacyShadow);
    if (runtime.logFallback !== false) logPublishedProbabilityFallback(selected);
    return selected;
  }
}
