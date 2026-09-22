import { revalidateTag } from "next/cache";

import {
  RADAR_CACHE_TAGS,
  RADAR_CORE_DEPENDENCY_TAGS,
} from "./cacheGeneration";

export type RadarCacheInvalidationScope =
  | "tibo"
  | "tibo-event"
  | "codex-usage"
  | "display-names"
  | "prediction-history"
  | "all";

const SCOPE_TAGS: Record<RadarCacheInvalidationScope, readonly string[]> = {
  tibo: [
    RADAR_CACHE_TAGS.tiboActive,
    RADAR_CACHE_TAGS.tiboHistory,
    RADAR_CACHE_TAGS.tiboTimed,
    RADAR_CACHE_TAGS.core,
  ],
  "tibo-event": [
    RADAR_CACHE_TAGS.tiboActive,
    RADAR_CACHE_TAGS.tiboHistory,
    RADAR_CACHE_TAGS.tiboTimed,
    RADAR_CACHE_TAGS.recoveryObservations,
    RADAR_CACHE_TAGS.resetExecutionEstimates,
    RADAR_CACHE_TAGS.formalAdoptions,
    RADAR_CACHE_TAGS.displayNames,
    RADAR_CACHE_TAGS.core,
  ],
  "codex-usage": [
    RADAR_CACHE_TAGS.tiboActive,
    RADAR_CACHE_TAGS.tiboHistory,
    RADAR_CACHE_TAGS.tiboTimed,
    RADAR_CACHE_TAGS.regularResetEvents,
    RADAR_CACHE_TAGS.recoveryObservations,
    RADAR_CACHE_TAGS.resetExecutionEstimates,
    RADAR_CACHE_TAGS.core,
  ],
  "display-names": [RADAR_CACHE_TAGS.displayNames, RADAR_CACHE_TAGS.core],
  "prediction-history": [RADAR_CACHE_TAGS.predictionHistory, RADAR_CACHE_TAGS.core],
  all: [...RADAR_CORE_DEPENDENCY_TAGS, RADAR_CACHE_TAGS.core],
};

export function getRadarCacheInvalidationTags(
  scope: RadarCacheInvalidationScope,
): string[] {
  return [...SCOPE_TAGS[scope]];
}

export async function invalidateRadarCache(
  scope: RadarCacheInvalidationScope,
  invalidate: (tag: string) => void | Promise<void> = revalidateTag,
) {
  for (const tag of getRadarCacheInvalidationTags(scope)) {
    await invalidate(tag);
  }
}
