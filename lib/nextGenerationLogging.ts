import {
  CALIBRATED_SHADOW_MODEL_VERSION,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT,
  NEXT_GENERATION_A_COMPONENT_VERSIONS,
  NEXT_GENERATION_A_MODEL_VERSION,
  NEXT_GENERATION_B_MODEL_VERSION,
  NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION,
  NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
  NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION,
  NEXT_GENERATION_C_FREEZE_AT,
  NEXT_GENERATION_C_MODEL_VERSION,
  NEXT_GENERATION_C_V2_FREEZE_AT,
  NEXT_GENERATION_C_V2_MODEL_VERSION,
  NEXT_GENERATION_FREEZE_AT,
  NEXT_GENERATION_FREEZE_POLICY,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_FREEZE_AT,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_FREEZE_POLICY,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CONTROL_MODEL_VERSION,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_POLICY,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS,
  RECENCY_H30_PROBABILITY_MODEL_VERSION,
  REGIME_ELAPSED_FULL_MODEL_VERSION,
  RANDOM_ELAPSED_SHADOW_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_POLICY,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
  BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_POLICY,
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_POLICY,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  SURVIVAL_CONDITIONED_FREEZE_AT,
  SURVIVAL_CONDITIONED_FREEZE_POLICY,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  SURVIVAL_CONTEXT_MODEL_VERSIONS,
} from "@/data/shadowProbabilityConfig";
import type {
  ExperimentalProbabilityForecast,
  ExperimentalProbabilityForecasts,
} from "./logProbability";
import {
  toRandomContinuousExperimentalProbabilityForecast,
} from "./logProbability";
import {
  calculateNextGenerationAEnsemble,
  type NextGenerationAResult,
  type NextGenerationComponentForecast,
} from "./radar/nextGenerationEnsemble";
import {
  calculateContextAwareContinuousProbability,
  toContextAwareForecastAudit,
} from "./radar/contextAwareContinuousProbability";
import {
  calculateNextGenerationBPostResetAgeCandidate,
  calculateNextGenerationBProbability,
  calculateNextGenerationSelectiveCalibrationProbability,
  type NextGenerationBResult,
} from "./radar/nextGenerationProbability";
import {
  calculateContextualBurstProbability,
  calculateNormalizedContextualBurstProbability,
  type ContextualBurstProbabilityResult,
} from "./radar/contextualBurstProbability";
import type { NextGenerationTrainingState } from "./radar/nextGenerationTraining";
import type { RadarData } from "./radar/types";
import { buildPublishedV3FeatureSnapshot } from "./radar/publishedV3FeatureSnapshot";
import type { ShadowProbabilityOptions } from "./radar/shadowProbability";
import {
  calculateSurvivalConditionedContextArms,
  calculateSurvivalConditionedProbability,
  getSurvivalConditionedHazardDiagnosticsAtAge,
  isValidSurvivalConditionedPrediction,
  type SurvivalConditionedContextArm,
  type SurvivalConditionedProbabilityResult,
} from "./radar/survivalConditionedProbability";
import {
  calculateRandomContinuousBandwidthShadowPair,
} from "./radar/randomContinuousBandwidthShadow";
import {
  calculateRandomContinuousBandwidthAgeDiagnostics,
  type RandomContinuousBandwidthAgeDiagnosticResult,
} from "./radar/randomContinuousBandwidthAgeDiagnostics";
import {
  calculateRandomContinuousLateAgeRegimeDiagnostics,
  type LateAgeRegimeDiagnosticResults,
} from "./radar/randomContinuousLateAgeRegimeDiagnostics";
import {
  calculateBroadBankedRandomContinuousShadow,
  type BroadBankedRandomContinuousShadowResult,
} from "./radar/broadBankedRandomContinuousShadow";
import {
  calculateRandomContinuousBroadBankedLateAgeRegimeDiagnostics,
  type BroadBankedLateAgeRegimeDiagnosticResults,
} from "./radar/randomContinuousBroadBankedLateAgeRegimeDiagnostics";

function toCommonForecast(result: NextGenerationBResult): ExperimentalProbabilityForecast {
  const random = result.randomContinuousResult;
  const randomAudit = result.randomContinuous;
  const hazard = random.hazard;
  return {
    modelVersion: result.modelVersion,
    generatedAt: result.calculatedAt,
    probability12h: result.predictions.probability12h,
    probability24h: result.predictions.probability24h,
    probability48h: result.predictions.probability48h,
    probability72h: result.predictions.probability72h,
    halfLifeDays: null,
    completedEventCount: hazard.completedEventCount,
    completedIntervalCount: hazard.completedIntervalCount,
    weightedEventCount: hazard.weightedEventCount,
    weightedExposureDays: hazard.weightedExposureHours / 24,
    baseline12h: random.baseline.probability12h,
    baseline24h: random.baseline.probability24h,
    baseline48h: random.baseline.probability48h,
    baseline72h: random.baseline.probability72h,
    combinedSignalMultiplier24h: random.multipliers.combinedAfterCap.probability24h,
    combinedSignalMultiplier48h: random.multipliers.combinedAfterCap.probability48h,
    combinedSignalMultiplier72h: random.multipliers.combinedAfterCap.probability48h,
    officialNoticeOverride: result.officialNoticeOverride.active,
    targetDefinition: result.targetDefinition,
    rawModelVersion: result.rawModelVersion,
    rawProbability24h: result.rawProbability24h,
    rawProbability48h: result.rawProbability48h,
    alpha24h: result.alpha24h,
    alpha48h: result.alpha48h,
    calibrationSampleCount24h: result.calibrationSampleCount24h,
    calibrationSampleCount48h: result.calibrationSampleCount48h,
    positiveCalibrationCount24h: result.positiveCalibrationCount24h,
    positiveCalibrationCount48h: result.positiveCalibrationCount48h,
    calibrationTrainingModelVersion: result.calibrationTrainingModelVersion,
    regimeMultiplierPolicyVersion: result.regimeMultiplierPolicyVersion,
    priorStdDev: 0.5,
    minimumSamples: 10,
    lastResolvedOrigin24h: result.lastResolvedOrigin24h,
    lastResolvedOrigin48h: result.lastResolvedOrigin48h,
    horizonCoherenceAdjusted: result.horizonCoherenceAdjusted,
    fallbackUsed: result.fallbackUsed,
    fallbackReason: result.fallbackReason,
    trainingReadStatus: result.trainingReadStatus,
    evaluationMode: "prospective",
    officialNoticeTimingPolicyVersion: result.officialNoticeTimingPolicyVersion,
    signalMultipliers: random.multipliers,
    mode: randomAudit.mode,
    regimeMultiplier: randomAudit.regimeMultiplier,
    effectiveRegimeMultiplier: randomAudit.effectiveRegimeMultiplier,
    recentRatePerDay: randomAudit.recentRatePerDay,
    longTermRatePerDay: randomAudit.longTermRatePerDay,
    elapsedHoursSinceRecovery: randomAudit.recoveryElapsedHours,
    elapsedHoursSinceRandom: randomAudit.randomElapsedHours,
    randomElapsedHours: randomAudit.randomElapsedHours,
    recoveryElapsedHours: randomAudit.recoveryElapsedHours,
    latestRandomResetAt: randomAudit.latestRandomResetAt,
    latestRecoveryResetAt: randomAudit.latestRecoveryResetAt,
    randomBoundaryCount: randomAudit.randomBoundaryCount,
    regularBoundaryCount: randomAudit.regularBoundaryCount,
    estimator: "gaussian-kernel",
    kernelBandwidthHours: randomAudit.bandwidthHours,
    kernelGridHours: randomAudit.gridHours,
    gridStepHours: randomAudit.gridStepHours,
    kernelTruncationHours: randomAudit.truncationHours,
    priorExposureDays: randomAudit.priorExposureDays,
    localPriorExposureDays: randomAudit.localPriorExposureDays,
    localPriorWindowHours: randomAudit.localPriorWindowHours,
    exposureCellCount: randomAudit.exposureCellCount,
    instantaneousHazardPerHour: randomAudit.instantaneousHazardPerHour,
    instantaneousDailyProbability: randomAudit.instantaneousDailyProbability,
    currentKernelWeightedEvents: randomAudit.currentKernelWeightedEvents,
    currentKernelWeightedExposureHours: randomAudit.currentKernelWeightedExposureHours,
    kernelType: randomAudit.kernelType,
    probeDailyProbabilities: randomAudit.probeDailyProbabilities,
    freezeAt: result.freezeAt,
    freezePolicy: result.freezePolicy,
    nextGenerationRole: "candidate-b",
  };
}

function toRawBandwidthForecast(
  result: ReturnType<typeof calculateRandomContinuousBandwidthShadowPair>["control"],
  experimentRole: "control" | "challenger",
): ExperimentalProbabilityForecast {
  const forecast = toRandomContinuousExperimentalProbabilityForecast(result);
  return {
    ...forecast,
    confidence: result.confidence.level,
    confidenceReason: result.confidence.reason,
    calibrationApplied: false,
    integrationStepHours: result.randomContinuous.integrationStepHours,
    regimeMultiplierPolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    evaluationMode: "prospective",
    experimentRole,
    freezeAt: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_FREEZE_AT,
    freezePolicy: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_FREEZE_POLICY,
  };
}

function toBroadBankedRandomContinuousForecast(
  result: BroadBankedRandomContinuousShadowResult,
): ExperimentalProbabilityForecast {
  const forecast = toRandomContinuousExperimentalProbabilityForecast(result);
  return {
    ...forecast,
    modelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    rawModelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    rawProbability24h: result.baseline.probability24h,
    rawProbability48h: result.baseline.probability48h,
    confidence: result.confidence.level,
    confidenceReason: result.confidence.reason,
    calibrationApplied: false,
    integrationStepHours: result.randomContinuous.integrationStepHours,
    regimeMultiplierPolicyVersion: result.randomContinuous.regimeMultiplierPolicyVersion,
    randomEligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    evaluationMode: "prospective",
    experimentRole: "diagnostic",
    freezeAt: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
    freezePolicy: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_POLICY,
    backfilled: false,
  };
}

function isValidRandomBandwidthAgeDiagnosticResult(
  result: RandomContinuousBandwidthAgeDiagnosticResult,
) {
  const values = [
    result.predictions.probability12h,
    result.predictions.probability24h,
    result.predictions.probability48h,
    result.predictions.probability72h,
    result.baseline.probability24h,
    result.baseline.probability48h,
  ];
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && result.predictions.probability12h <= result.predictions.probability24h
    && result.predictions.probability24h <= result.predictions.probability48h
    && result.predictions.probability48h <= result.predictions.probability72h;
}

function toRandomBandwidthAgeDiagnosticForecast(
  result: RandomContinuousBandwidthAgeDiagnosticResult,
) {
  const forecast = toRandomContinuousExperimentalProbabilityForecast(result);
  return {
    ...forecast,
    modelVersion: result.modelVersion,
    rawModelVersion: result.modelVersion,
    rawProbability24h: result.baseline.probability24h,
    rawProbability48h: result.baseline.probability48h,
    confidence: result.confidence.level,
    confidenceReason: result.confidence.reason,
    calibrationApplied: false,
    integrationStepHours: result.randomContinuous.integrationStepHours,
    regimeMultiplierPolicyVersion: result.randomContinuous.regimeMultiplierPolicyVersion,
    evaluationMode: "prospective" as const,
    experimentRole: "diagnostic" as const,
    freezeAt: RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT,
    freezePolicy: RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_POLICY,
    backfilled: false as const,
  } satisfies ExperimentalProbabilityForecast;
}

function isValidLateAgeRegimeDiagnosticResult(
  result: LateAgeRegimeDiagnosticResults[typeof RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[number]],
) {
  const values = [
    result.result.predictions.probability12h,
    result.result.predictions.probability24h,
    result.result.predictions.probability48h,
    result.result.predictions.probability72h,
    result.result.baseline.probability24h,
    result.result.baseline.probability48h,
  ];
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && result.result.predictions.probability12h <= result.result.predictions.probability24h
    && result.result.predictions.probability24h <= result.result.predictions.probability48h
    && result.result.predictions.probability48h <= result.result.predictions.probability72h
    && Number.isFinite(result.lateAgeStartHours)
    && result.lateAgeStartHours >= 0;
}

function toLateAgeRegimeDiagnosticForecast(
  arm: LateAgeRegimeDiagnosticResults[typeof RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[number]],
) {
  const forecast = toRandomContinuousExperimentalProbabilityForecast(arm.result);
  return {
    ...forecast,
    modelVersion: arm.modelVersion,
    rawModelVersion: arm.modelVersion,
    rawProbability24h: arm.result.baseline.probability24h,
    rawProbability48h: arm.result.baseline.probability48h,
    confidence: arm.result.confidence.level,
    confidenceReason: arm.result.confidence.reason,
    calibrationApplied: false,
    integrationStepHours: arm.result.randomContinuous.integrationStepHours,
    regimeMultiplierPolicyVersion: arm.lateAgeRegimePolicy,
    evaluationMode: "prospective" as const,
    experimentRole: "diagnostic" as const,
    nextGenerationRole: "late-age-regime-diagnostic" as const,
    freezeAt: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
    freezePolicy: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_POLICY,
    lateAgeRegimePolicy: arm.lateAgeRegimePolicy,
    lateAgeStartHours: arm.lateAgeStartHours,
    preResetRegimeMultiplier: arm.preResetRegimeMultiplier,
    preResetRegimeMultiplierFallbackUsed: arm.preResetRegimeMultiplierFallbackUsed,
    preResetRegimeMultiplierFallbackReason: arm.preResetRegimeMultiplierFallbackReason,
    backfilled: false as const,
  } satisfies ExperimentalProbabilityForecast;
}

function isValidBroadBankedLateAgeRegimeDiagnosticResult(
  result: BroadBankedLateAgeRegimeDiagnosticResults[typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[number]],
) {
  const values = [
    result.result.predictions.probability12h,
    result.result.predictions.probability24h,
    result.result.predictions.probability48h,
    result.result.predictions.probability72h,
    result.result.baseline.probability24h,
    result.result.baseline.probability48h,
  ];
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && result.result.predictions.probability12h <= result.result.predictions.probability24h
    && result.result.predictions.probability24h <= result.result.predictions.probability48h
    && result.result.predictions.probability48h <= result.result.predictions.probability72h
    && Number.isFinite(result.lateAgeStartHours)
    && result.lateAgeStartHours >= 0;
}

function toBroadBankedLateAgeRegimeDiagnosticForecast(
  arm: BroadBankedLateAgeRegimeDiagnosticResults[typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[number]],
) {
  const forecast = toRandomContinuousExperimentalProbabilityForecast(arm.result);
  return {
    ...forecast,
    modelVersion: arm.modelVersion,
    rawModelVersion: arm.modelVersion,
    rawProbability24h: arm.result.baseline.probability24h,
    rawProbability48h: arm.result.baseline.probability48h,
    confidence: arm.result.confidence.level,
    confidenceReason: arm.result.confidence.reason,
    calibrationApplied: false,
    integrationStepHours: arm.result.randomContinuous.integrationStepHours,
    regimeMultiplierPolicyVersion: arm.lateAgeRegimePolicy,
    randomEligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    evaluationMode: "prospective" as const,
    experimentRole: "diagnostic" as const,
    nextGenerationRole: "late-age-regime-diagnostic" as const,
    freezeAt: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
    freezePolicy: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_POLICY,
    lateAgeRegimePolicy: arm.lateAgeRegimePolicy,
    lateAgeStartHours: arm.lateAgeStartHours,
    preResetRegimeMultiplier: arm.preResetRegimeMultiplier,
    preResetRegimeMultiplierFallbackUsed: arm.preResetRegimeMultiplierFallbackUsed,
    preResetRegimeMultiplierFallbackReason: arm.preResetRegimeMultiplierFallbackReason,
    backfilled: false as const,
  } satisfies ExperimentalProbabilityForecast;
}

function toSurvivalConditionedForecast(
  result: SurvivalConditionedProbabilityResult | SurvivalConditionedContextArm,
  contextArm?: string,
): ExperimentalProbabilityForecast {
  const base = "base" in result ? result.base : result;
  const fit = "contextFit" in result ? result.contextFit : null;
  const survival = base.survival;
  const fallbackUsed = survival.fallbackUsed || Boolean(fit?.fallbackUsed);
  return {
    modelVersion: result.modelVersion,
    generatedAt: result.calculatedAt,
    probability12h: result.predictions.probability12h,
    probability24h: result.predictions.probability24h,
    probability48h: result.predictions.probability48h,
    probability72h: result.predictions.probability72h,
    halfLifeDays: survival.recencyHalfLifeDays,
    completedEventCount: survival.completedIntervalCount,
    completedIntervalCount: survival.completedIntervalCount,
    weightedEventCount: survival.weightedEventCount,
    weightedExposureDays: survival.weightedExposureDays,
    baseline12h: result.baseline.probability12h,
    baseline24h: result.baseline.probability24h,
    baseline48h: result.baseline.probability48h,
    baseline72h: result.baseline.probability72h,
    combinedSignalMultiplier24h: survival.ordinarySignalMultipliers.combinedAfterCap.probability24h,
    combinedSignalMultiplier48h: survival.ordinarySignalMultipliers.combinedAfterCap.probability48h,
    combinedSignalMultiplier72h: survival.ordinarySignalMultipliers.combinedAfterCap.probability48h,
    officialNoticeOverride: base.officialNoticeOverride.active,
    targetDefinition: base.targetDefinition,
    rawModelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
    rawProbability24h: result.baseline.probability24h,
    rawProbability48h: result.baseline.probability48h,
    confidence: base.confidence.level,
    confidenceReason: base.confidence.reason,
    calibrationApplied: false,
    integrationStepHours: survival.integrationStepHours,
    experimentRole: "diagnostic",
    randomEligibilityPolicyVersion: survival.randomEligibilityPolicyVersion,
    elapsedHoursSinceRandom: survival.randomElapsedHours,
    randomElapsedHours: survival.randomElapsedHours,
    latestRandomResetAt: survival.latestRandomResetAt,
    estimator: "survival-conditioned",
    instantaneousHazardPerHour: getSurvivalConditionedHazardDiagnosticsAtAge(
      base.hazard,
      survival.randomElapsedHours,
    ).lambdaPerHour,
    freezeAt: SURVIVAL_CONDITIONED_FREEZE_AT,
    freezePolicy: SURVIVAL_CONDITIONED_FREEZE_POLICY,
    nextGenerationRole: "survival-conditioned-shadow",
    fallbackUsed,
    fallbackReason: fit?.fallbackReason ?? survival.fallbackReason,
    survivalConditioned: survival,
    survivalContextArm: contextArm ?? "base",
    ...(fit
      ? {
          contextCoefficients: fit.coefficients,
          burstStats: fit.burstStats,
          contextTrainingEventCount: fit.trainingEventCount,
          contextExposureCellCount: fit.exposureCellCount,
          contextFallbackUsed: fit.fallbackUsed,
          contextFallbackReason: fit.fallbackReason,
          contextSolver: fit.solver,
        }
      : {}),
    backfilled: false,
  };
}

function isValidContextAwareResult(result: ReturnType<typeof calculateContextAwareContinuousProbability>) {
  return [
    result.predictions.probability12h,
    result.predictions.probability24h,
    result.predictions.probability48h,
    result.predictions.probability72h,
    result.baseline.probability24h,
    result.baseline.probability48h,
  ].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && result.predictions.probability48h >= result.predictions.probability24h;
}

function toContextAwareForecast(
  result: ReturnType<typeof calculateContextAwareContinuousProbability>,
): ExperimentalProbabilityForecast {
  const underlying = toRandomContinuousExperimentalProbabilityForecast(result.randomContinuousResult);
  return {
    ...underlying,
    modelVersion: result.modelVersion,
    generatedAt: result.calculatedAt,
    probability12h: result.predictions.probability12h,
    probability24h: result.predictions.probability24h,
    probability48h: result.predictions.probability48h,
    probability72h: result.predictions.probability72h,
    baseline12h: result.baseline.probability12h,
    baseline24h: result.baseline.probability24h,
    baseline48h: result.baseline.probability48h,
    baseline72h: result.baseline.probability72h,
    combinedSignalMultiplier24h: 1,
    combinedSignalMultiplier48h: 1,
    combinedSignalMultiplier72h: 1,
    officialNoticeOverride: result.officialNoticeOverride.active,
    targetDefinition: result.targetDefinition,
    rawModelVersion: result.underlyingModelVersion,
    rawProbability24h: result.contextAdjusted.probability24h,
    rawProbability48h: result.contextAdjusted.probability48h,
    calibrationApplied: false,
    confidence: result.randomContinuousResult.confidence.level,
    confidenceReason: result.randomContinuousResult.confidence.reason,
    regimeMultiplierPolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    evaluationMode: result.evaluationMode,
    backfilled: false,
    freezeAt: result.freezeAt,
    freezePolicy: result.freezePolicy,
    nextGenerationRole: "candidate-context-aware",
    trainingReadStatus: result.trainingReadStatus,
    fallbackUsed: result.fitFallbackUsed,
    fallbackReason: result.fitFallbackReason,
    horizonCoherenceAdjusted: result.horizonCoherenceAdjusted,
    officialNoticeTimingPolicyVersion: result.officialNoticeTimingPolicyVersion,
    signalMultipliers: result.signalMultipliers,
    contextAware: toContextAwareForecastAudit(result),
  };
}

function isValidBResult(result: NextGenerationBResult) {
  return [
    result.rawProbability24h,
    result.rawProbability48h,
    result.predictions.probability12h,
    result.predictions.probability24h,
    result.predictions.probability48h,
    result.predictions.probability72h,
  ].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && result.predictions.probability48h >= result.predictions.probability24h;
}

function isValidCResult(result: ContextualBurstProbabilityResult) {
  return [
    result.rawProbability24h,
    result.rawProbability48h,
    result.probability12h,
    result.probability24h,
    result.probability48h,
    result.probability72h,
  ].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && result.probability48h >= result.probability24h;
}

function toContextualBurstForecast(
  result: ContextualBurstProbabilityResult,
  role: "candidate-c" | "candidate-c-v2" = "candidate-c",
) {
  const fit = result.contextFit;
  const forecast = {
    modelVersion: result.modelVersion,
    generatedAt: result.calculatedAt,
    probability12h: result.probability12h,
    probability24h: result.probability24h,
    probability48h: result.probability48h,
    probability72h: result.probability72h,
    halfLifeDays: null,
    // C-specific context-fit counts are intentionally separate from the common
    // historical hazard fields; these common values are conservative audit placeholders.
    completedEventCount: fit.trainingEventCount,
    completedIntervalCount: fit.trainingEventCount,
    weightedEventCount: fit.trainingEventCount,
    weightedExposureDays: fit.exposureCellCount / 24,
    baseline24h: result.baseProbability24h,
    baseline48h: result.baseProbability48h,
    combinedSignalMultiplier24h: result.multipliers.combinedAfterCap.probability24h,
    combinedSignalMultiplier48h: result.multipliers.combinedAfterCap.probability48h,
    officialNoticeOverride: result.officialNoticeOverride.active,
    targetDefinition: result.targetDefinition,
    rawModelVersion: result.modelVersion,
    rawProbability24h: result.rawProbability24h,
    rawProbability48h: result.rawProbability48h,
    alpha24h: result.alpha24h,
    alpha48h: result.alpha48h,
    calibrationSampleCount24h: result.calibrationSampleCount24h,
    calibrationSampleCount48h: result.calibrationSampleCount48h,
    positiveCalibrationCount24h: result.positiveCalibrationCount24h,
    positiveCalibrationCount48h: result.positiveCalibrationCount48h,
    priorStdDev: 0.5,
    minimumSamples: 10,
    lastResolvedOrigin24h: result.lastResolvedOrigin24h,
    lastResolvedOrigin48h: result.lastResolvedOrigin48h,
    horizonCoherenceAdjusted: result.horizonCoherenceAdjusted,
    fallbackUsed: result.calibrationFallbackUsed || fit.fallbackUsed,
    fallbackReason: result.calibrationFallbackReason ?? fit.fallbackReason,
    trainingReadStatus: result.trainingReadStatus,
    evaluationMode: "prospective" as const,
    officialNoticeTimingPolicyVersion: result.officialNoticeTimingPolicyVersion,
    signalMultipliers: result.multipliers,
    randomElapsedHours: result.randomElapsedHours,
    elapsedHoursSinceRandom: result.randomElapsedHours,
    latestRandomResetAt: result.latestRandomResetAt,
    latestRecoveryResetAt: result.latestRecoveryResetAt,
    estimator: "gaussian-kernel" as const,
    instantaneousHazardPerHour: result.baseInstantaneousHazardPerHour,
    freezeAt: result.freezeAt,
    freezePolicy: result.freezePolicy,
    nextGenerationRole: role,
    randomResetCount72h: result.originFeatures.randomResetCount72h,
    previousRandomIntervalHours: result.originFeatures.previousRandomIntervalHours,
    hourSin: result.originFeatures.hourSin,
    hourCos: result.originFeatures.hourCos,
    contextCoefficients: fit.coefficients,
    burstStats: fit.burstStats,
    contextTrainingEventCount: fit.trainingEventCount,
    contextExposureCellCount: fit.exposureCellCount,
    contextFallbackUsed: fit.fallbackUsed,
    contextFallbackReason: fit.fallbackReason,
    contextSolver: fit.solver,
    effectiveContextMultiplier24h: result.effectiveContextMultiplier24h,
    effectiveContextMultiplier48h: result.effectiveContextMultiplier48h,
    ablations: result.ablations,
    ...(result.normalizedAblations
      ? {
          normalizedAblations: result.normalizedAblations,
          circadianNormalizationConstant: result.circadianNormalizationConstant,
          circadianCycleMeanBeforeNormalization: result.circadianCycleMeanBeforeNormalization,
          circadianCycleMeanAfterNormalization: result.circadianCycleMeanAfterNormalization,
          circadianNormalizationFallbackReason: result.circadianNormalizationFallbackReason,
        }
      : {}),
  };
  // Keep candidate-C audit fields optional so legacy stored forecasts remain valid.
  return forecast as unknown as ExperimentalProbabilityForecast;
}

function toEnsembleForecast(
  result: NextGenerationAResult,
  bResult: NextGenerationBResult,
): ExperimentalProbabilityForecast {
  const random = bResult.randomContinuousResult;
  const hazard = random.hazard;
  return {
    modelVersion: result.modelVersion,
    generatedAt: result.generatedAt,
    probability12h: result.probability12h,
    probability24h: result.probability24h,
    probability48h: result.probability48h,
    probability72h: result.probability72h,
    halfLifeDays: null,
    completedEventCount: hazard.completedEventCount,
    completedIntervalCount: hazard.completedIntervalCount,
    weightedEventCount: hazard.weightedEventCount,
    weightedExposureDays: hazard.weightedExposureHours / 24,
    baseline12h: result.rawProbability24h,
    baseline24h: result.rawProbability24h,
    baseline48h: result.rawProbability48h,
    baseline72h: result.rawProbability48h,
    combinedSignalMultiplier24h: 1,
    combinedSignalMultiplier48h: 1,
    combinedSignalMultiplier72h: 1,
    officialNoticeOverride: false,
    targetDefinition: bResult.targetDefinition,
    rawModelVersion: NEXT_GENERATION_A_MODEL_VERSION,
    rawProbability24h: result.rawProbability24h,
    rawProbability48h: result.rawProbability48h,
    alpha24h: result.alpha24h,
    alpha48h: result.alpha48h,
    calibrationSampleCount24h: result.trainingSampleCount24h,
    calibrationSampleCount48h: result.trainingSampleCount48h,
    positiveCalibrationCount24h: result.positiveTrainingCount24h,
    positiveCalibrationCount48h: result.positiveTrainingCount48h,
    priorStdDev: result.regularization.alphaPriorStdDev,
    minimumSamples: 10,
    lastResolvedOrigin24h: result.fitCutoff24h,
    lastResolvedOrigin48h: result.fitCutoff48h,
    horizonCoherenceAdjusted: result.horizonCoherenceAdjusted,
    fallbackUsed: false,
    evaluationMode: "prospective",
    componentModelVersions: result.componentModelVersions,
    componentProbabilities24h: result.componentProbabilities24h,
    componentProbabilities48h: result.componentProbabilities48h,
    componentLogitEpsilon: result.componentLogitEpsilon,
    weights24h: result.weights24h,
    weights48h: result.weights48h,
    alphaPriorStdDev: result.regularization.alphaPriorStdDev,
    weightPriorMean: result.regularization.weightPriorMean,
    weightPriorStdDev: result.regularization.weightPriorStdDev,
    trainingMode24h: result.trainingMode24h,
    trainingMode48h: result.trainingMode48h,
    trainingSampleCount24h: result.trainingSampleCount24h,
    trainingSampleCount48h: result.trainingSampleCount48h,
    positiveTrainingCount24h: result.positiveTrainingCount24h,
    positiveTrainingCount48h: result.positiveTrainingCount48h,
    fitCutoff24h: result.fitCutoff24h,
    fitCutoff48h: result.fitCutoff48h,
    solver24h: result.solver24h,
    solver48h: result.solver48h,
    freezeAt: result.freezeAt,
    freezePolicy: result.freezePolicy,
    nextGenerationRole: "candidate-a",
  };
}

function getComponentForecast(
  forecasts: ExperimentalProbabilityForecasts,
  modelVersion: string,
): NextGenerationComponentForecast | null {
  const forecast = forecasts[modelVersion];
  if (!forecast || forecast.modelVersion !== modelVersion) return null;
  if (!Number.isFinite(forecast.probability24h) || !Number.isFinite(forecast.probability48h)) return null;
  return {
    modelVersion,
    probability24h: forecast.probability24h,
    probability48h: forecast.probability48h,
  };
}

export type NextGenerationShadowBuildOptions = {
  data: RadarData | null;
  calculationOptions: ShadowProbabilityOptions;
  existingForecasts: ExperimentalProbabilityForecasts;
  trainingState: NextGenerationTrainingState;
  lateAgeRegimeDiagnosticsCalculator?: typeof calculateRandomContinuousLateAgeRegimeDiagnostics;
  broadBankedRandomContinuousShadowCalculator?: typeof calculateBroadBankedRandomContinuousShadow;
  broadBankedLateAgeRegimeDiagnosticsCalculator?: typeof calculateRandomContinuousBroadBankedLateAgeRegimeDiagnostics;
  survivalConditionedCalculator?: typeof calculateSurvivalConditionedProbability;
  survivalConditionedContextArmsCalculator?: typeof calculateSurvivalConditionedContextArms;
};

export function buildNextGenerationExperimentalProbabilityForecasts(
  options: NextGenerationShadowBuildOptions,
): ExperimentalProbabilityForecasts {
  const generatedAt = options.calculationOptions.now ?? new Date();
  if (generatedAt.getTime() < new Date(NEXT_GENERATION_FREEZE_AT).getTime()) {
    return options.existingForecasts;
  }

  const bCalculationOptions = {
    ...options.calculationOptions,
    trainingRows: options.trainingState.bRows,
    trainingReadStatus: options.trainingState.status,
  };
  const bResult = calculateNextGenerationBProbability(options.data, bCalculationOptions);
  const bValid = isValidBResult(bResult);
  const withB: ExperimentalProbabilityForecasts = bValid
    ? {
        ...options.existingForecasts,
        [NEXT_GENERATION_B_MODEL_VERSION]: toCommonForecast(bResult),
      }
    : options.existingForecasts;
  const postResetAgeResult = calculateNextGenerationBPostResetAgeCandidate(
    options.data,
    bCalculationOptions,
  );
  const postResetAgeValid = isValidBResult(postResetAgeResult);
  const withBVariants: ExperimentalProbabilityForecasts = postResetAgeValid
    ? {
        ...withB,
        [NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION]: toCommonForecast(postResetAgeResult),
      }
    : withB;
  const selectiveCalibrationResult = calculateNextGenerationSelectiveCalibrationProbability(
    options.data,
    bCalculationOptions,
  );
  const selectiveCalibrationValid = isValidBResult(selectiveCalibrationResult);
  const withAllBVariants: ExperimentalProbabilityForecasts = selectiveCalibrationValid
    ? {
        ...withBVariants,
        [NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION]: {
          ...toCommonForecast(selectiveCalibrationResult),
          featureSnapshot: buildPublishedV3FeatureSnapshot(
            options.data,
            new Date(selectiveCalibrationResult.calculatedAt),
          ),
        },
      }
    : withBVariants;

  let withA = withAllBVariants;
  if (bValid) {
    const components = Object.fromEntries(
      NEXT_GENERATION_A_COMPONENT_VERSIONS.map((modelVersion) => {
        const component = modelVersion === NEXT_GENERATION_B_MODEL_VERSION
          ? getComponentForecast(withB, NEXT_GENERATION_B_MODEL_VERSION)
          : getComponentForecast(options.existingForecasts, modelVersion);
        return [modelVersion, component];
      }),
    );
    if (!Object.values(components).some((component) => component === null)) {
      const aResult = calculateNextGenerationAEnsemble(
        components as Record<string, NextGenerationComponentForecast>,
        {
          generatedAt: bResult.calculatedAt,
          trainingRows: options.trainingState.aRows,
          trainingReadStatus: options.trainingState.status,
        },
      );
      if (aResult) {
        withA = {
          ...withAllBVariants,
          [NEXT_GENERATION_A_MODEL_VERSION]: toEnsembleForecast(aResult, bResult),
        };
      }
    }
  }

  let withBandwidthExperiment = withA;
  let bandwidthPair: ReturnType<typeof calculateRandomContinuousBandwidthShadowPair> | null = null;
  if (generatedAt.getTime() >= new Date(RANDOM_BANDWIDTH_TRUNCATION_SHADOW_FREEZE_AT).getTime()) {
    bandwidthPair = calculateRandomContinuousBandwidthShadowPair(
      options.data,
      options.calculationOptions,
    );
    withBandwidthExperiment = {
      ...withA,
      [RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CONTROL_MODEL_VERSION]: toRawBandwidthForecast(
        bandwidthPair.control,
        "control",
      ),
      [RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION]: toRawBandwidthForecast(
        bandwidthPair.challenger,
        "challenger",
      ),
    };
  }

  let withBandwidthAgeDiagnostics = withBandwidthExperiment;
  if (generatedAt.getTime() >= new Date(RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT).getTime()) {
    try {
      const diagnostics = calculateRandomContinuousBandwidthAgeDiagnostics(
        options.data,
        options.calculationOptions,
        undefined,
        bandwidthPair?.challenger,
      );
      const diagnosticForecasts = Object.fromEntries(
        Object.entries(diagnostics).flatMap(([modelVersion, result]) => {
          if (!RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS.includes(
            modelVersion as typeof RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS[number],
          ) || !isValidRandomBandwidthAgeDiagnosticResult(result)) {
            return [];
          }
          return [[modelVersion, toRandomBandwidthAgeDiagnosticForecast(result)]];
        }),
      ) as ExperimentalProbabilityForecasts;
      withBandwidthAgeDiagnostics = {
        ...withBandwidthExperiment,
        ...diagnosticForecasts,
      };
    } catch {
      // Age-shape diagnostics are fail-open and cannot affect public results.
    }
  }

  let withContextAware = withBandwidthAgeDiagnostics;
  if (
    bandwidthPair &&
    generatedAt.getTime() >= new Date(CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT).getTime()
  ) {
    const savedFeatureSnapshot = withAllBVariants[
      NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION
    ]?.featureSnapshot;
    const contextAwareResult = calculateContextAwareContinuousProbability(options.data, {
      ...options.calculationOptions,
      precomputedChallenger: bandwidthPair.challenger,
      trainingRows: options.trainingState.contextAwareRows ?? [],
      trainingReadStatus: options.trainingState.status,
      savedFeatureSnapshot,
    });
    if (isValidContextAwareResult(contextAwareResult)) {
      withContextAware = {
        ...withBandwidthAgeDiagnostics,
        [contextAwareResult.modelVersion]: toContextAwareForecast(contextAwareResult),
      };
    }
  }

  let withC = withContextAware;
  if (generatedAt.getTime() >= new Date(NEXT_GENERATION_C_FREEZE_AT).getTime()) {
    const cResult = calculateContextualBurstProbability(options.data, {
      ...options.calculationOptions,
      trainingRows: options.trainingState.cRows,
      trainingReadStatus: options.trainingState.status,
    });
    if (isValidCResult(cResult)) {
      withC = {
        ...withContextAware,
        [NEXT_GENERATION_C_MODEL_VERSION]: toContextualBurstForecast(cResult),
      };
    }
  }

  let withC2 = withC;
  if (generatedAt.getTime() >= new Date(NEXT_GENERATION_C_V2_FREEZE_AT).getTime()) {
    const cV2Result = calculateNormalizedContextualBurstProbability(options.data, {
      ...options.calculationOptions,
      trainingRows: options.trainingState.cV2Rows,
      trainingReadStatus: options.trainingState.status,
    });
    if (isValidCResult(cV2Result)) {
      withC2 = {
        ...withC,
        [NEXT_GENERATION_C_V2_MODEL_VERSION]: toContextualBurstForecast(cV2Result, "candidate-c-v2"),
      };
    }
  }

  let withBroadBankedShadow = withC2;
  if (generatedAt.getTime() >= new Date(BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT).getTime()) {
    try {
      const calculateShadow = options.broadBankedRandomContinuousShadowCalculator
        ?? calculateBroadBankedRandomContinuousShadow;
      const broadBankedResult = calculateShadow(options.data, options.calculationOptions);
      if (
        isValidRandomBandwidthAgeDiagnosticResult(broadBankedResult)
        && broadBankedResult.modelVersion === BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION
      ) {
        withBroadBankedShadow = {
          ...withC2,
          [BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION]: toBroadBankedRandomContinuousForecast(
            broadBankedResult,
          ),
        };
      }
    } catch {
      // Broad-banked v2 is a fail-open shadow and cannot affect normal logging.
    }
  }

  let withLateAgeDiagnostics = withBroadBankedShadow;
  if (generatedAt.getTime() >= new Date(RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT).getTime()) {
    try {
      const calculateDiagnostics = options.lateAgeRegimeDiagnosticsCalculator
        ?? calculateRandomContinuousLateAgeRegimeDiagnostics;
      const diagnostics = calculateDiagnostics(options.data, options.calculationOptions);
      const allValid = RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.every((modelVersion) => {
        const arm = diagnostics[modelVersion];
        return Boolean(arm && isValidLateAgeRegimeDiagnosticResult(arm));
      });
      if (allValid) {
        const diagnosticForecasts = Object.fromEntries(
          RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.map((modelVersion) => [
            modelVersion,
            toLateAgeRegimeDiagnosticForecast(diagnostics[modelVersion]),
          ]),
        ) as ExperimentalProbabilityForecasts;
        withLateAgeDiagnostics = {
          ...withBroadBankedShadow,
          ...diagnosticForecasts,
        };
      }
    } catch {
      // Late-age diagnostics are fail-open and cannot affect normal logging.
    }
  }

  if (generatedAt.getTime() >= new Date(BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT).getTime()) {
    try {
      const calculateDiagnostics = options.broadBankedLateAgeRegimeDiagnosticsCalculator
        ?? calculateRandomContinuousBroadBankedLateAgeRegimeDiagnostics;
      const diagnostics = calculateDiagnostics(options.data, options.calculationOptions);
      const allValid = BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.every((modelVersion) => {
        const arm = diagnostics[modelVersion];
        return Boolean(arm && isValidBroadBankedLateAgeRegimeDiagnosticResult(arm));
      });
      if (allValid) {
        const diagnosticForecasts = Object.fromEntries(
          BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.map((modelVersion) => [
            modelVersion,
            toBroadBankedLateAgeRegimeDiagnosticForecast(diagnostics[modelVersion]),
          ]),
        ) as ExperimentalProbabilityForecasts;
        withLateAgeDiagnostics = {
          ...withLateAgeDiagnostics,
          ...diagnosticForecasts,
        };
      }
    } catch {
      // Broad-banked late-age diagnostics are fail-open and cannot affect normal logging.
    }
  }

  let withSurvival = withLateAgeDiagnostics;
  if (generatedAt.getTime() >= new Date(SURVIVAL_CONDITIONED_FREEZE_AT).getTime()) {
    try {
      const calculateSurvival = options.survivalConditionedCalculator
        ?? calculateSurvivalConditionedProbability;
      const survivalResult = calculateSurvival(options.data, options.calculationOptions);
      if (isValidSurvivalConditionedPrediction(survivalResult)) {
        const calculateArms = options.survivalConditionedContextArmsCalculator
          ?? calculateSurvivalConditionedContextArms;
        let contextArms: Record<string, SurvivalConditionedContextArm> = {};
        try {
          contextArms = calculateArms(options.data, options.calculationOptions, survivalResult);
        } catch {
          // A context-arm failure must not suppress the valid survival base artifact.
        }
        const forecasts: ExperimentalProbabilityForecasts = {
          [SURVIVAL_CONDITIONED_MODEL_VERSION]: toSurvivalConditionedForecast(survivalResult),
          ...Object.fromEntries(
            SURVIVAL_CONTEXT_MODEL_VERSIONS.flatMap((modelVersion) => {
              const arm = contextArms[modelVersion];
              if (!arm) return [];
              try {
                return [[modelVersion, toSurvivalConditionedForecast(arm, arm.contextArm)]];
              } catch {
                return [];
              }
            }),
          ),
        };
        withSurvival = {
          ...withLateAgeDiagnostics,
          ...forecasts,
        };
      }
    } catch {
      // Survival-conditioned shadow logging is fail-open and cannot affect public results.
    }
  }

  return withSurvival;
}
