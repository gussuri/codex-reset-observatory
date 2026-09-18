import {
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_COMMON_OPTIONS,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_REGIME_CONFIG,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_SIGNAL_CONFIG,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS,
} from "@/data/shadowProbabilityConfig";
import type { RadarData, WindowEventLike } from "./types";
import {
  calculateRegimeDiagnostics,
  calculateRegimeElapsedProbability,
  type RegimeDiagnostics,
} from "./regimeElapsedProbability";
import {
  getRecoveryResetEvents,
  type RecoveryResetBoundary,
} from "./recoveryBoundary";
import {
  calculateRandomContinuousProbability,
  type RandomContinuousModelOptions,
  type RandomContinuousProbabilityResult,
} from "./randomContinuousProbability";
import type { ShadowProbabilityOptions } from "./shadowProbability";

export type LateAgeRegimePolicy =
  | "control"
  | "late-neutral"
  | "late-no-downward"
  | "pre-reset-frozen";

export type LateAgeRegimeDiagnosticArm = {
  modelVersion: string;
  result: RandomContinuousProbabilityResult;
  lateAgeRegimePolicy: LateAgeRegimePolicy;
  lateAgeStartHours: number;
  preResetRegimeMultiplier: number | null;
  preResetRegimeMultiplierFallbackUsed: boolean;
  preResetRegimeMultiplierFallbackReason: string | null;
};

export type LateAgeRegimeDiagnosticResults = Record<
  typeof RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION
    | typeof RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION
    | typeof RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION
    | typeof RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
  LateAgeRegimeDiagnosticArm
>;

function safeRegimeMultiplier(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 1;
}

export function getLateAgeRegimeMultiplierAtAge(
  ageHours: number,
  regimeMultiplier: number,
  policy: LateAgeRegimePolicy,
  preResetRegimeMultiplier = 1,
) {
  if (!Number.isFinite(ageHours) || ageHours < 24) return 1;

  const safeRegime = safeRegimeMultiplier(regimeMultiplier);
  if (policy === "control") return safeRegime;
  if (policy === "late-neutral") {
    return ageHours < RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS
      ? safeRegime
      : 1;
  }
  if (policy === "late-no-downward") {
    return ageHours < RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS
      ? safeRegime
      : Math.max(1, safeRegime);
  }
  return safeRegimeMultiplier(preResetRegimeMultiplier);
}

function getPreResetRegime(
  boundaries: RecoveryResetBoundary[],
): Pick<LateAgeRegimeDiagnosticArm, "preResetRegimeMultiplier" | "preResetRegimeMultiplierFallbackUsed" | "preResetRegimeMultiplierFallbackReason"> {
  const randomBoundaries = boundaries.filter((boundary) => boundary.isRandom);
  const latest = randomBoundaries.at(-1);
  if (!latest || randomBoundaries.length < 2) {
    return {
      preResetRegimeMultiplier: 1,
      preResetRegimeMultiplierFallbackUsed: true,
      preResetRegimeMultiplierFallbackReason: "insufficient_random_history",
    };
  }

  const latestTime = new Date(latest.resetAt);
  if (!Number.isFinite(latestTime.getTime())) {
    return {
      preResetRegimeMultiplier: 1,
      preResetRegimeMultiplierFallbackUsed: true,
      preResetRegimeMultiplierFallbackReason: "invalid_latest_random_reset_at",
    };
  }

  const diagnostics: RegimeDiagnostics = calculateRegimeDiagnostics(
    randomBoundaries.slice(0, -1),
    latestTime,
    RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_REGIME_CONFIG,
  );
  if (!Number.isFinite(diagnostics.regimeMultiplier) || diagnostics.regimeMultiplier < 0) {
    return {
      preResetRegimeMultiplier: 1,
      preResetRegimeMultiplierFallbackUsed: true,
      preResetRegimeMultiplierFallbackReason: "invalid_pre_reset_regime_multiplier",
    };
  }

  return {
    preResetRegimeMultiplier: diagnostics.regimeMultiplier,
    preResetRegimeMultiplierFallbackUsed: false,
    preResetRegimeMultiplierFallbackReason: null,
  };
}

function withArmIdentity(
  result: RandomContinuousProbabilityResult,
  modelVersion: string,
) {
  return {
    ...result,
    modelVersion,
  };
}

function getModelOptions(
  policy: LateAgeRegimePolicy,
  preResetRegimeMultiplier: number,
): RandomContinuousModelOptions {
  if (policy === "control") {
    return RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_COMMON_OPTIONS;
  }
  return {
    ...RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_COMMON_OPTIONS,
    regimeMultiplierAtAge: (ageHours, regimeMultiplier) =>
      getLateAgeRegimeMultiplierAtAge(
        ageHours,
        regimeMultiplier,
        policy,
        preResetRegimeMultiplier,
      ),
  };
}

export function calculateRandomContinuousLateAgeRegimeDiagnostics(
  data: RadarData | null,
  options: ShadowProbabilityOptions = {},
): LateAgeRegimeDiagnosticResults {
  const { now: requestedNow, ...optionsWithoutNow } = options;
  const calculationNow = requestedNow ?? new Date();
  const sharedOptions: ShadowProbabilityOptions = {
    ...optionsWithoutNow,
    now: calculationNow,
  };
  const regimeResult = calculateRegimeElapsedProbability(
    data,
    sharedOptions,
    {
      ...RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_REGIME_CONFIG,
      modelVersion: "hazard-regime-elapsed-v1",
      mode: "full",
      signalMultiplierConfig: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_SIGNAL_CONFIG,
    },
  );
  const boundaries = getRecoveryResetEvents(
    data,
    calculationNow,
    options.staticHistory,
    options.canonicalHistoryContext,
  );
  const preReset = getPreResetRegime(boundaries);
  const makeArm = (
    modelVersion: LateAgeRegimeDiagnosticArm["modelVersion"],
    lateAgeRegimePolicy: LateAgeRegimePolicy,
  ): LateAgeRegimeDiagnosticArm => {
    const audit = lateAgeRegimePolicy === "pre-reset-frozen"
      ? preReset
      : {
          preResetRegimeMultiplier: null,
          preResetRegimeMultiplierFallbackUsed: false,
          preResetRegimeMultiplierFallbackReason: null,
        };
    return {
      modelVersion,
      result: withArmIdentity(
        calculateRandomContinuousProbability(
          data,
          sharedOptions,
          regimeResult,
          getModelOptions(lateAgeRegimePolicy, preReset.preResetRegimeMultiplier ?? 1),
        ),
        modelVersion,
      ),
      lateAgeRegimePolicy,
      lateAgeStartHours: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS,
      ...audit,
    };
  };

  return {
    [RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION]: makeArm(
      RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
      "control",
    ),
    [RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION]: makeArm(
      RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
      "late-neutral",
    ),
    [RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION]: makeArm(
      RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
      "late-no-downward",
    ),
    [RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION]: makeArm(
      RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
      "pre-reset-frozen",
    ),
  };
}
