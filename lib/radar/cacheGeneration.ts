export const RADAR_CACHE_GENERATION_FALLBACK = "local-v1";
export const RADAR_DATA_CACHE_TAG = "radar-data";

export const RADAR_CACHE_TAGS = {
  core: "radar-core",
  tiboActive: "radar-tibo-active",
  tiboHistory: "radar-tibo-history",
  tiboTimed: "radar-tibo-timed",
  regularResetEvents: "radar-regular-reset-events",
  recoveryObservations: "radar-recovery-observations",
  resetExecutionEstimates: "radar-reset-execution-estimates",
  formalAdoptions: "radar-formal-adoptions",
  displayNames: "radar-display-names",
  predictionHistory: "radar-prediction-history",
} as const;

export const RADAR_CORE_DEPENDENCY_TAGS = [
  RADAR_CACHE_TAGS.tiboActive,
  RADAR_CACHE_TAGS.tiboHistory,
  RADAR_CACHE_TAGS.tiboTimed,
  RADAR_CACHE_TAGS.regularResetEvents,
  RADAR_CACHE_TAGS.recoveryObservations,
  RADAR_CACHE_TAGS.resetExecutionEstimates,
  RADAR_CACHE_TAGS.formalAdoptions,
  RADAR_CACHE_TAGS.displayNames,
  RADAR_CACHE_TAGS.predictionHistory,
] as const;

type CacheGenerationEnvironment = {
  VERCEL_GIT_COMMIT_SHA?: string;
};

export function resolveRadarCacheGeneration(
  environment: CacheGenerationEnvironment = {
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  },
) {
  const commitSha = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  return commitSha
    ? "deploy-" + commitSha
    : RADAR_CACHE_GENERATION_FALLBACK;
}

export const RADAR_CACHE_GENERATION = resolveRadarCacheGeneration();

export function getRadarCacheKeyParts(
  baseKey: string,
  generation = RADAR_CACHE_GENERATION,
) {
  return [baseKey, "generation:" + generation];
}
