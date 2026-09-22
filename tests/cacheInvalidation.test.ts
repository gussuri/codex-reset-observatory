import assert from "node:assert/strict";
import test from "node:test";

import {
  getRadarCacheInvalidationTags,
  type RadarCacheInvalidationScope,
} from "../lib/radar/cacheInvalidation";
import { RADAR_CACHE_TAGS } from "../lib/radar/cacheGeneration";

test("Tibo writes invalidate only Tibo projections and their shared dependents", () => {
  const tags: string[] = [...getRadarCacheInvalidationTags("tibo")];

  assert.deepEqual(tags, [
    RADAR_CACHE_TAGS.tiboActive,
    RADAR_CACHE_TAGS.tiboHistory,
    RADAR_CACHE_TAGS.tiboTimed,
    RADAR_CACHE_TAGS.core,
  ]);
  assert.equal((tags as string[]).includes(RADAR_CACHE_TAGS.displayNames), false);
  assert.equal((tags as string[]).includes(RADAR_CACHE_TAGS.predictionHistory), false);
});

test("Tibo webhook writes invalidate formal and derived Tibo event projections", () => {
  const tags: string[] = [...getRadarCacheInvalidationTags("tibo-event")];

  assert.ok((tags as string[]).includes(RADAR_CACHE_TAGS.formalAdoptions));
  assert.ok((tags as string[]).includes(RADAR_CACHE_TAGS.recoveryObservations));
  assert.ok((tags as string[]).includes(RADAR_CACHE_TAGS.resetExecutionEstimates));
  assert.ok((tags as string[]).includes(RADAR_CACHE_TAGS.displayNames));
  assert.equal((tags as string[]).includes(RADAR_CACHE_TAGS.predictionHistory), false);
});

test("display-name writes do not invalidate prediction history", () => {
  assert.deepEqual(getRadarCacheInvalidationTags("display-names"), [
    RADAR_CACHE_TAGS.displayNames,
    RADAR_CACHE_TAGS.core,
  ]);
});

test("prediction-history writes invalidate the training source and shared core", () => {
  assert.deepEqual(getRadarCacheInvalidationTags("prediction-history"), [
    RADAR_CACHE_TAGS.predictionHistory,
    RADAR_CACHE_TAGS.core,
  ]);
});

test("usage recovery invalidation covers only sources written by the atomic plan", () => {
  assert.deepEqual(getRadarCacheInvalidationTags("codex-usage"), [
    RADAR_CACHE_TAGS.tiboActive,
    RADAR_CACHE_TAGS.tiboHistory,
    RADAR_CACHE_TAGS.tiboTimed,
    RADAR_CACHE_TAGS.regularResetEvents,
    RADAR_CACHE_TAGS.recoveryObservations,
    RADAR_CACHE_TAGS.resetExecutionEstimates,
    RADAR_CACHE_TAGS.core,
  ]);
});

test("full invalidation remains available for an explicit maintenance operation", () => {
  const scopes: RadarCacheInvalidationScope[] = [
    "tibo",
    "tibo-event",
    "codex-usage",
    "display-names",
    "prediction-history",
    "all",
  ];
  const allTags = getRadarCacheInvalidationTags("all");

  for (const scope of scopes) {
    assert.ok(getRadarCacheInvalidationTags(scope).every((tag) => allTags.includes(tag)));
  }
  assert.ok(allTags.includes(RADAR_CACHE_TAGS.formalAdoptions));
  assert.ok(allTags.includes(RADAR_CACHE_TAGS.predictionHistory));
});
