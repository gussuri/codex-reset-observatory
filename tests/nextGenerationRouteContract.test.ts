import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("next-generation A/B/C work is confined to the probability logging route", () => {
  const loggingRoute = readFileSync(join(root, "app/api/log-probability/route.ts"), "utf8");
  const currentRoute = readFileSync(join(root, "app/api/current/route.ts"), "utf8");

  assert.match(loggingRoute, /fetchCurrentRadarDataWithTrainingState/);
  assert.match(loggingRoute, /buildNextGenerationExperimentalProbabilityForecasts/);
  assert.match(loggingRoute, /NEXT_GENERATION_FREEZE_AT/);
  assert.doesNotMatch(loggingRoute, /loadNextGenerationTrainingState/);
  assert.doesNotMatch(loggingRoute, /getNextGenerationRandomTargetEvents/);
  assert.doesNotMatch(currentRoute, /nextGeneration/i);
  assert.doesNotMatch(currentRoute, /contextualBurst|NEXT_GENERATION_C/i);
});

test("logging route receives one shared training state for public and shadow forecasts", () => {
  const loggingRoute = readFileSync(join(root, "app/api/log-probability/route.ts"), "utf8");
  const radarFetch = readFileSync(join(root, "lib/radarFetch.ts"), "utf8");

  assert.match(loggingRoute, /const \{ data: rawData, trainingState \} = await fetchCurrentRadarDataWithTrainingState/);
  assert.match(loggingRoute, /buildNextGenerationExperimentalProbabilityForecasts\([\s\S]*trainingState,/);

  const combinedFetchSource = radarFetch.slice(
    radarFetch.indexOf("export async function fetchCurrentRadarDataWithTrainingState"),
    radarFetch.indexOf("type SharedRadarCore"),
  );
  assert.equal(
    (combinedFetchSource.match(/readNextGenerationTrainingState\(data, calculationNow\)/g) ?? []).length,
    1,
  );
});
