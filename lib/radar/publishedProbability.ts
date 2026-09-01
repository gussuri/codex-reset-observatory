import {
  CALIBRATED_SHADOW_MODEL_VERSION,
  NEXT_GENERATION_B_MODEL_VERSION,
  NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION,
  PUBLISHED_ELAPSED_MODEL_OPTIONS,
  PUBLISHED_PROBABILITY_ADOPTION_AT,
  PUBLISHED_PROBABILITY_PREVIOUS_ADOPTION_AT,
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
import {
  calculateNextGenerationBPostResetAgeCandidate,
  calculateNextGenerationBProbability,
  type NextGenerationBResult,
  type NextGenerationCalibrationRow,
  type NextGenerationTrainingReadStatus,
} from "./nextGenerationProbability";
import { calculateRegimeElapsedProbability } from "./regimeElapsedProbability";
import { calculateRecencyWeightedShadowProbability } from "./recencyWeightedProbability";
import type { RadarData } from "./types";

export type PublishedProbabilitySource =
  | "calibrated"
  | "stable-shadow-fallback"
  | "legacy-shadow-fallback"
  | "heuristic-fallback";
export type PublishedProbabilityFallbackReason =
  | "next_generation_b_exception"
  | "next_generation_b_invalid_prediction"
  | "calibrated_exception"
  | "calibrated_fallback"
  | "calibrated_invalid_prediction"
  | "stable_shadow_exception"
  | "stable_shadow_invalid_prediction"
  | "shadow_exception"
  | "shadow_invalid_prediction";

const PUBLIC_CALCULATION_INTERVAL_MS = 10 * 60 * 1000;

function parseAdoptionTime(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

const PUBLISHED_PROBABILITY_PREVIOUS_ADOPTION_TIME = parseAdoptionTime(
  PUBLISHED_PROBABILITY_PREVIOUS_ADOPTION_AT,
);

export type PublishedNextGenerationBModel =
  | "post-reset-age-candidate"
  | "previous-b"
  | null;

export function getPublishedNextGenerationBModel(
  now: Date,
  adoptionAt: string | null | undefined = PUBLISHED_PROBABILITY_ADOPTION_AT,
): PublishedNextGenerationBModel {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return null;
  const candidateAdoptionTime = parseAdoptionTime(adoptionAt);
  if (candidateAdoptionTime !== null && nowTime >= candidateAdoptionTime) {
    return "post-reset-age-candidate";
  }
  if (
    PUBLISHED_PROBABILITY_PREVIOUS_ADOPTION_TIME !== null
    && nowTime >= PUBLISHED_PROBABILITY_PREVIOUS_ADOPTION_TIME
  ) {
    return "previous-b";
  }
  return null;
}

export function roundPublicProbabilityTime(now: Date) {
  const time = now.getTime();
  if (!Number.isFinite(time)) return now;
  return new Date(Math.floor(time / PUBLIC_CALCULATION_INTERVAL_MS) * PUBLIC_CALCULATION_INTERVAL_MS);
}

export type NextGenerationBPublicTrainingState = {
  trainingRows: Array<NextGenerationCalibrationRow>;
  trainingReadStatus: NextGenerationTrainingReadStatus;
};

type RadarDataWithNextGenerationBTraining = RadarData & {
  __nextGenerationBPublicTrainingState?: NextGenerationBPublicTrainingState;
};

export function attachNextGenerationBPublicTrainingState(
  data: RadarData,
  state: NextGenerationBPublicTrainingState,
): RadarData {
  return {
    ...data,
    __nextGenerationBPublicTrainingState: state,
  } as RadarDataWithNextGenerationBTraining;
}

function getAttachedNextGenerationBPublicTrainingState(data: RadarData | null) {
  return (data as RadarDataWithNextGenerationBTraining | null)
    ?.__nextGenerationBPublicTrainingState ?? null;
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
  nextGenerationB: NextGenerationBResult | null;
  calibrated: CalibratedShadowProbabilityResult | null;
  rawShadow: ShadowProbabilityResult | null;
  stableShadow: ShadowProbabilityResult | null;
  shadow: ShadowProbabilityResult | null;
};

export function isValidNextGenerationBPrediction(
  result: Pick<NextGenerationBResult, "modelVersion" | "predictions">,
) {
  const { predictions } = result;
  return (
    (result.modelVersion === NEXT_GENERATION_B_MODEL_VERSION
      || result.modelVersion === NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION) &&
    Number.isFinite(predictions.probability12h) &&
    Number.isFinite(predictions.probability24h) &&
    Number.isFinite(predictions.probability48h) &&
    Number.isFinite(predictions.probability72h) &&
    predictions.probability12h >= 0 &&
    predictions.probability12h <= 1 &&
    predictions.probability24h >= 0 &&
    predictions.probability24h <= 1 &&
    predictions.probability48h >= 0 &&
    predictions.probability48h <= 1 &&
    predictions.probability72h >= 0 &&
    predictions.probability72h <= 1 &&
    predictions.probability12h <= predictions.probability24h &&
    predictions.probability24h <= predictions.probability48h &&
    predictions.probability48h <= predictions.probability72h
  );
}

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
  nextGenerationB: NextGenerationBResult | null = null,
): PublishedProbabilityCalculation {
  if (nextGenerationB && isValidNextGenerationBPrediction(nextGenerationB)) {
    return {
      probability12h: nextGenerationB.predictions.probability12h,
      probability24h: nextGenerationB.predictions.probability24h,
      probability48h: nextGenerationB.predictions.probability48h,
      probability72h: nextGenerationB.predictions.probability72h,
      adoptedModel: nextGenerationB.modelVersion,
      source: "calibrated",
      fallbackReason: null,
      primary,
      nextGenerationB,
      calibrated,
      rawShadow,
      stableShadow,
      shadow: null,
    };
  }

  if (calibrated && isValidCalibratedPrediction(calibrated)) {
    return {
      probability12h: derive12hFrom24hProbability(calibrated.probability24h),
      probability24h: calibrated.probability24h,
      probability48h: calibrated.probability48h,
      probability72h: derive72hFrom48hProbability(calibrated.probability48h),
      adoptedModel: calibrated.modelVersion,
      source: "calibrated",
      fallbackReason,
      primary,
      nextGenerationB,
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
      nextGenerationB,
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
      nextGenerationB,
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
    nextGenerationB,
    calibrated,
    rawShadow,
    stableShadow,
    shadow: stableShadow,
  };
}

function logPublishedProbabilityFallback(
  calculation: PublishedProbabilityCalculation,
) {
  if (calculation.fallbackReason === null) return;

  console.warn("[Published probability fallback]", {
    reason: calculation.fallbackReason,
    nextGenerationBModelVersion: calculation.nextGenerationB?.modelVersion ?? null,
    nextGenerationBFallbackUsed: calculation.nextGenerationB?.fallbackUsed ?? null,
    nextGenerationBFallbackReason: calculation.nextGenerationB?.fallbackReason ?? null,
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

export type PublishedProbabilityOptions = {
  now?: Date;
  signalEvaluation?: LocalSignalEvaluation;
  activeOfficialNotice?: ActiveOfficialNotice | null;
  regularResetExpectedAt?: string | null;
  nextGenerationBTrainingRows?: Array<NextGenerationCalibrationRow>;
  nextGenerationBTrainingReadStatus?: NextGenerationTrainingReadStatus;
  /** Explicit Production switch boundary; omitted uses the committed boundary. */
  publishedModelAdoptionAt?: string | null;
};

export function calculatePublishedProbability(
  data: RadarData | null,
  options: PublishedProbabilityOptions = {},
  runtime: { logFallback?: boolean } = {},
): PublishedProbabilityCalculation {
  const attachedTraining = getAttachedNextGenerationBPublicTrainingState(data);
  const {
    nextGenerationBTrainingRows,
    nextGenerationBTrainingReadStatus,
    publishedModelAdoptionAt,
    ...calculationOptions
  } = options;
  const resolvedTrainingRows = nextGenerationBTrainingRows ?? attachedTraining?.trainingRows ?? [];
  const resolvedTrainingReadStatus =
    nextGenerationBTrainingReadStatus ?? attachedTraining?.trainingReadStatus ?? "ok";
  const primary = getLocalProbabilityCalculation(data, calculationOptions);
  const publicModelOptions = {
    ...calculationOptions,
    now: roundPublicProbabilityTime(calculationOptions.now ?? new Date()),
  };
  const nextGenerationBModel = getPublishedNextGenerationBModel(
    publicModelOptions.now,
    publishedModelAdoptionAt === undefined
      ? PUBLISHED_PROBABILITY_ADOPTION_AT
      : publishedModelAdoptionAt,
  );

  let nextGenerationB: NextGenerationBResult | null = null;
  let rawShadow: ShadowProbabilityResult | null = null;
  let calibrated: CalibratedShadowProbabilityResult | null = null;
  let stableShadow: ShadowProbabilityResult | null = null;
  let fallbackReason: PublishedProbabilityFallbackReason | null = null;

  if (nextGenerationBModel !== null) {
    try {
      const calculateB = nextGenerationBModel === "post-reset-age-candidate"
        ? calculateNextGenerationBPostResetAgeCandidate
        : calculateNextGenerationBProbability;
      nextGenerationB = calculateB(data, {
        ...publicModelOptions,
        trainingRows: resolvedTrainingRows,
        trainingReadStatus: resolvedTrainingReadStatus,
      });
      if (!isValidNextGenerationBPrediction(nextGenerationB)) {
        fallbackReason = "next_generation_b_invalid_prediction";
      }
    } catch {
      fallbackReason = "next_generation_b_exception";
    }
  }

  try {
    rawShadow = calculateShadowProbability(data, publicModelOptions);
    calibrated = calculateCalibratedShadowProbability(data, {
      ...publicModelOptions,
      shadowProbability: rawShadow,
    });
    if (!isValidCalibratedPrediction(calibrated) && !fallbackReason) {
      fallbackReason = calibrated.fallbackUsed
        ? "calibrated_fallback"
        : "calibrated_invalid_prediction";
    }
  } catch {
    if (!fallbackReason) fallbackReason = "calibrated_exception";
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
  if (!(nextGenerationB && isValidNextGenerationBPrediction(nextGenerationB)) ||
      !(calibrated && isValidCalibratedPrediction(calibrated)) ||
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
    nextGenerationB,
  );
  if (runtime.logFallback !== false) logPublishedProbabilityFallback(selected);
  return selected;
}
