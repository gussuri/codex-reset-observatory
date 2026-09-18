import {
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_COMMON_OPTIONS,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_POLICY,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_REGIME_CONFIG,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_SIGNAL_CONFIG,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_TARGET_DEFINITION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
} from "@/data/shadowProbabilityConfig";
import type { RadarData } from "./types";
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
import type {
  LateAgeRegimeDiagnosticArm,
  LateAgeRegimePolicy,
} from "./randomContinuousLateAgeRegimeDiagnostics";

export type BroadBankedLateAgeRegimeDiagnosticResults = Record<
  typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[number],
  LateAgeRegimeDiagnosticArm
>;

function safeRegimeMultiplier(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 1;
}

export function getBroadBankedLateAgeRegimeMultiplierAtAge(
  ageHours: number,
  regimeMultiplier: number,
  policy: LateAgeRegimePolicy,
  preResetRegimeMultiplier = 1,
) {
  if (!Number.isFinite(ageHours) || ageHours < 24) return 1;

  const safeRegime = safeRegimeMultiplier(regimeMultiplier);
  if (policy === "control") return safeRegime;
  if (policy === "late-neutral") {
    return ageHours < BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS
      ? safeRegime
      : 1;
  }
  if (policy === "late-no-downward") {
    return ageHours < BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS
      ? safeRegime
      : Math.max(1, safeRegime);
  }
  return safeRegimeMultiplier(preResetRegimeMultiplier);
}

function getPreResetRegime(
  boundaries: Array<RecoveryResetBoundary>,
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
    BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_REGIME_CONFIG,
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

function withV2Identity(result: RandomContinuousProbabilityResult, modelVersion: string) {
  return {
    ...result,
    modelVersion,
    targetDefinition: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_TARGET_DEFINITION,
    randomContinuous: {
      ...result.randomContinuous,
      freezeAt: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
      freezePolicy: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_POLICY,
    },
  };
}

function getModelOptions(
  policy: LateAgeRegimePolicy,
  preResetRegimeMultiplier: number,
): RandomContinuousModelOptions {
  if (policy === "control") return BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_COMMON_OPTIONS;
  return {
    ...BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_COMMON_OPTIONS,
    regimeMultiplierAtAge: (ageHours, regimeMultiplier) =>
      getBroadBankedLateAgeRegimeMultiplierAtAge(
        ageHours,
        regimeMultiplier,
        policy,
        preResetRegimeMultiplier,
      ),
  };
}

export function calculateRandomContinuousBroadBankedLateAgeRegimeDiagnostics(
  data: RadarData | null,
  options: ShadowProbabilityOptions = {},
): BroadBankedLateAgeRegimeDiagnosticResults {
  const requestedNow = options.now ?? new Date();
  const sharedOptions: ShadowProbabilityOptions = {
    ...options,
    now: requestedNow,
    randomEligibilityPolicy: BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  };
  const regimeResult = calculateRegimeElapsedProbability(
    data,
    sharedOptions,
    {
      ...BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_REGIME_CONFIG,
      modelVersion: "hazard-regime-elapsed-v1",
      mode: "full",
      signalMultiplierConfig: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_SIGNAL_CONFIG,
    },
  );
  const boundaries = getRecoveryResetEvents(
    data,
    requestedNow,
    options.staticHistory,
    options.canonicalHistoryContext,
    BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  );
  const preReset = getPreResetRegime(boundaries);
  const makeArm = (
    modelVersion: string,
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
      result: withV2Identity(
        calculateRandomContinuousProbability(
          data,
          sharedOptions,
          regimeResult,
          getModelOptions(lateAgeRegimePolicy, preReset.preResetRegimeMultiplier ?? 1),
        ),
        modelVersion,
      ),
      lateAgeRegimePolicy,
      lateAgeStartHours: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS,
      ...audit,
    };
  };

  return {
    [BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION]: makeArm(
      BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
      "control",
    ),
    [BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION]: makeArm(
      BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
      "late-neutral",
    ),
    [BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION]: makeArm(
      BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
      "late-no-downward",
    ),
    [BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION]: makeArm(
      BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
      "pre-reset-frozen",
    ),
  };
}
