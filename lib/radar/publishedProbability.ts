import { SHADOW_PROBABILITY_MODEL_VERSION } from "@/data/shadowProbabilityConfig";
import type {
  ActiveOfficialNotice,
  LocalSignalEvaluation,
  ProbabilityCalculationAudit,
} from "./probability";
import { getLocalProbabilityCalculation } from "./probability";
import {
  calculateShadowProbability,
  type ShadowProbabilityResult,
} from "./shadowProbability";
import type { RadarData } from "./types";

export type PublishedProbabilitySource = "shadow" | "heuristic-fallback";

export type PublishedProbabilityCalculation = {
  probability24h: number;
  probability48h: number;
  adoptedModel: string;
  source: PublishedProbabilitySource;
  fallbackReason: "shadow_exception" | "shadow_invalid_prediction" | null;
  primary: ProbabilityCalculationAudit;
  shadow: ShadowProbabilityResult | null;
};

export function isValidShadowPrediction(
  shadow: Pick<ShadowProbabilityResult, "modelVersion" | "predictions">,
) {
  const probability24h = shadow.predictions?.probability24h;
  const probability48h = shadow.predictions?.probability48h;

  return (
    shadow.modelVersion === SHADOW_PROBABILITY_MODEL_VERSION &&
    Number.isFinite(probability24h) &&
    Number.isFinite(probability48h) &&
    probability24h >= 0 &&
    probability24h <= 1 &&
    probability48h >= 0 &&
    probability48h <= 1 &&
    probability24h <= probability48h
  );
}

export function selectPublishedProbability(
  primary: ProbabilityCalculationAudit,
  shadow: ShadowProbabilityResult | null,
  fallbackReason: PublishedProbabilityCalculation["fallbackReason"] = null,
): PublishedProbabilityCalculation {
  if (shadow && isValidShadowPrediction(shadow)) {
    return {
      probability24h: shadow.predictions.probability24h,
      probability48h: shadow.predictions.probability48h,
      adoptedModel: shadow.modelVersion,
      source: "shadow",
      fallbackReason: null,
      primary,
      shadow,
    };
  }

  return {
    probability24h: primary.probability24h,
    probability48h: primary.probability48h,
    adoptedModel: primary.modelVersion,
    source: "heuristic-fallback",
    fallbackReason: fallbackReason ?? "shadow_invalid_prediction",
    primary,
    shadow,
  };
}

export function calculatePublishedProbability(
  data: RadarData | null,
  options: {
    now?: Date;
    signalEvaluation?: LocalSignalEvaluation;
    activeOfficialNotice?: ActiveOfficialNotice | null;
    regularResetExpectedAt?: string | null;
  } = {},
): PublishedProbabilityCalculation {
  const primary = getLocalProbabilityCalculation(data, options);

  try {
    const shadow = calculateShadowProbability(data, options);
    return selectPublishedProbability(primary, shadow);
  } catch {
    return selectPublishedProbability(primary, null, "shadow_exception");
  }
}
