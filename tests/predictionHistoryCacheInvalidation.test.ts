import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("prediction history invalidation runs only after a new saved row", () => {
  const source = readFileSync(resolve("app/api/log-probability/route.ts"), "utf8");

  assert.match(source, /savedRecord\.action === "inserted"/);
  assert.match(source, /invalidateRadarCache\("prediction-history"\)/);
  assert.match(source, /savePredictionHistoryOnce/);
});
