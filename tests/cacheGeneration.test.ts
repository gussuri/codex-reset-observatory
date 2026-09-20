import assert from "node:assert/strict";
import test from "node:test";

import {
  RADAR_CACHE_GENERATION_FALLBACK,
  RADAR_DATA_CACHE_TAG,
  getRadarCacheKeyParts,
  resolveRadarCacheGeneration,
} from "../lib/radar/cacheGeneration";

test("cache generation is stable for one deployment and changes across deployments", () => {
  const generationA = resolveRadarCacheGeneration({
    VERCEL_GIT_COMMIT_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const generationB = resolveRadarCacheGeneration({
    VERCEL_GIT_COMMIT_SHA: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });

  assert.equal(generationA, "deploy-" + "a".repeat(40));
  assert.equal(generationB, "deploy-" + "b".repeat(40));
  assert.notEqual(generationA, generationB);
  assert.deepEqual(
    getRadarCacheKeyParts("radar-core-cache-v6", generationA),
    getRadarCacheKeyParts("radar-core-cache-v6", generationA),
  );
  assert.notDeepEqual(
    getRadarCacheKeyParts("radar-core-cache-v6", generationA),
    getRadarCacheKeyParts("radar-core-cache-v6", generationB),
  );
});

test("local cache generation has an explicit fallback and shared core keys are locale-independent", () => {
  assert.equal(
    resolveRadarCacheGeneration({ VERCEL_GIT_COMMIT_SHA: "   " }),
    RADAR_CACHE_GENERATION_FALLBACK,
  );
  assert.deepEqual(
    getRadarCacheKeyParts("radar-core-cache-v6", "deploy-same"),
    getRadarCacheKeyParts("radar-core-cache-v6", "deploy-same"),
  );
  assert.equal(RADAR_DATA_CACHE_TAG, "radar-data");
});
