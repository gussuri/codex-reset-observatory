import {
  NEXT_GENERATION_B_FROZEN_REGIME_CONFIG,
  NEXT_GENERATION_B_FROZEN_SIGNAL_CONFIG,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_COMMON_OPTIONS,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_POLICY,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS,
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

export type RandomContinuousBandwidthAgeDiagnosticResult = RandomContinuousProbabilityResult;
export type RandomContinuousBandwidthAgeDiagnosticResults = Record<
  typeof RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS[number],
  RandomContinuousBandwidthAgeDiagnosticResult
>;

const DIAGNOSTIC_MODEL_BY_BANDWIDTH = Object.fromEntries(
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS.map((bandwidthHours, index) => [
    bandwidthHours,
    RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS[index],
  ]),
) as Record<number, typeof RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS[number]>;

function withDiagnosticIdentity(
  result: RandomContinuousProbabilityResult,
  modelVersion: string,
): RandomContinuousProbabilityResult {
  return {
    ...result,
    modelVersion,
    randomContinuous: {
      ...result.randomContinuous,
      freezeAt: RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT,
      freezePolicy: RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_POLICY,
    },
  };
}

export function getRandomContinuousBandwidthAgeDiagnosticOptions(bandwidthHours: number) {
  return {
    ...RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_COMMON_OPTIONS,
    bandwidthHours,
  };
}

function isReusablePrecomputedChallenger(
  result: RandomContinuousProbabilityResult | undefined,
  calculatedAt: string,
) {
  return Boolean(
    result
    && result.calculatedAt === calculatedAt
    && result.randomContinuous.bandwidthHours === 18
    && result.randomContinuous.truncationHours === 54,
  );
}

export function calculateRandomContinuousBandwidthAgeDiagnostics(
  data: RadarData | null,
  options: ShadowProbabilityOptions = {},
  precomputedRecoveryResult?: RegimeElapsedProbabilityResult,
  precomputedChallenger?: RandomContinuousProbabilityResult,
): RandomContinuousBandwidthAgeDiagnosticResults {
  const requestedNow = options.now ?? new Date();
  const sharedOptions: ShadowProbabilityOptions = {
    ...options,
    now: requestedNow,
  };
  const calculatedAt = requestedNow.toISOString();
  const regimeResult = precomputedRecoveryResult ?? calculateRegimeElapsedProbability(
    data,
    sharedOptions,
    {
      ...NEXT_GENERATION_B_FROZEN_REGIME_CONFIG,
      modelVersion: "hazard-regime-elapsed-v1",
      mode: "full",
      signalMultiplierConfig: NEXT_GENERATION_B_FROZEN_SIGNAL_CONFIG,
    },
  );

  const results = {} as RandomContinuousBandwidthAgeDiagnosticResults;
  for (const bandwidthHours of RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS) {
    const modelVersion = DIAGNOSTIC_MODEL_BY_BANDWIDTH[bandwidthHours];
    const result = bandwidthHours === 18
      && isReusablePrecomputedChallenger(precomputedChallenger, calculatedAt)
      ? precomputedChallenger!
      : calculateRandomContinuousProbability(
          data,
          sharedOptions,
          regimeResult,
          getRandomContinuousBandwidthAgeDiagnosticOptions(bandwidthHours),
        );
    results[modelVersion] = withDiagnosticIdentity(result, modelVersion);
  }

  return results;
}
