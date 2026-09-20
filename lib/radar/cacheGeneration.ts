export const RADAR_CACHE_GENERATION_FALLBACK = "local-v1";
export const RADAR_DATA_CACHE_TAG = "radar-data";

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
