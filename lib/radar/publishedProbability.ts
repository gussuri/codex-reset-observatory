import { SHADOW_PROBABILITY_MODEL_VERSION } from "@/data/shadowProbabilityConfig";
import type {
  ActiveOfficialNotice,
  LocalSignalEvaluation,
  ProbabilityCalculationAudit,
} from "./probability";
import { getLocalProbabilityCalculation } from "./probability";
import {
  calculateShadowProbability,
  derive12hFrom24hProbability,
  derive72hFrom48hProbability,
  type ShadowProbabilityResult,
} from "./shadowProbability";
import type { RadarData } from "./types";

export type PublishedProbabilitySource = "shadow" | "heuristic-fallback";
export type PublishedProbabilityFallbackReason =
  | "shadow_exception"
  | "shadow_invalid_prediction";

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
    shadow.modelVersion === SHADOW_PROBABILITY_MODEL_VERSION &&
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
  if (calculation.source !== "heuristic-fallback") return;

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

  try {
    const shadow = calculateShadowProbability(data, options);
    const selected = selectPublishedProbability(primary, shadow);
    if (runtime.logFallback !== false) logPublishedProbabilityFallback(selected);
    return selected;
  } catch {
    const selected = selectPublishedProbability(primary, null, "shadow_exception");
    if (runtime.logFallback !== false) logPublishedProbabilityFallback(selected);
    return selected;
  }
}
