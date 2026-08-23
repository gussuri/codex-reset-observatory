import assert from "node:assert/strict";
import test from "node:test";

import {
  NEXT_GENERATION_B_MODEL_VERSION,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import { getLocalRadarData } from "../lib/radar";
import { calculatePublishedProbability } from "../lib/radar/publishedProbability";

// Public calculations are evaluated on ten-minute buckets; 02:10 is the
// first rounded bucket at or after the 02:04 adoption timestamp.
const NOW = new Date("2026-08-23T02:10:00.000Z");

test("next-generation B is the manually adopted public probability model", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const published = calculatePublishedProbability(data, {
    now: NOW,
    activeOfficialNotice: null,
    nextGenerationBTrainingRows: [],
    nextGenerationBTrainingReadStatus: "ok",
  });

  assert.equal(PUBLISHED_PROBABILITY_MODEL_VERSION, NEXT_GENERATION_B_MODEL_VERSION);
  assert.equal(published.source, "calibrated");
  assert.equal(published.adoptedModel, NEXT_GENERATION_B_MODEL_VERSION);
  assert.equal(published.fallbackReason, null);
  assert.ok(published.nextGenerationB);
  assert.deepEqual(
    {
      probability12h: published.probability12h,
      probability24h: published.probability24h,
      probability48h: published.probability48h,
      probability72h: published.probability72h,
    },
    published.nextGenerationB.predictions,
  );
});
