import {
  BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
  BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_POLICY,
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_OPTIONS,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_CONFIG,
  BROAD_BANKED_RANDOM_CLOCK_V2_SIGNAL_CONFIG,
  BROAD_BANKED_RANDOM_CLOCK_V2_TARGET_DEFINITION,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
} from "@/data/shadowProbabilityConfig";
import type { RadarData } from "./types";
import {
  calculateRegimeElapsedProbability,
  type RegimeElapsedProbabilityResult,
} from "./regimeElapsedProbability";
import {
  calculateRandomContinuousProbability,
  type RandomContinuousProbabilityResult,
} from "./randomContinuousProbability";
import type { ShadowProbabilityOptions } from "./shadowProbability";

export type BroadBankedRandomContinuousShadowResult = RandomContinuousProbabilityResult;

function withV2Identity(result: RandomContinuousProbabilityResult) {
  return {
    ...result,
    modelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    targetDefinition: BROAD_BANKED_RANDOM_CLOCK_V2_TARGET_DEFINITION,
    randomContinuous: {
      ...result.randomContinuous,
      freezeAt: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
      freezePolicy: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_POLICY,
    },
  };
}

export function calculateBroadBankedRandomContinuousShadow(
  data: RadarData | null,
  options: ShadowProbabilityOptions = {},
  precomputedRecoveryResult?: RegimeElapsedProbabilityResult,
): BroadBankedRandomContinuousShadowResult {
  const requestedNow = options.now ?? new Date();
  const sharedOptions: ShadowProbabilityOptions = {
    ...options,
    now: requestedNow,
    randomEligibilityPolicy: BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  };
  const regimeResult = precomputedRecoveryResult ?? calculateRegimeElapsedProbability(
    data,
    sharedOptions,
    {
      ...BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_CONFIG,
      modelVersion: "hazard-regime-elapsed-v1",
      mode: "full",
      signalMultiplierConfig: BROAD_BANKED_RANDOM_CLOCK_V2_SIGNAL_CONFIG,
    },
  );
  return withV2Identity(
    calculateRandomContinuousProbability(
      data,
      sharedOptions,
      regimeResult,
      BROAD_BANKED_RANDOM_CLOCK_V2_OPTIONS,
    ),
  );
}
