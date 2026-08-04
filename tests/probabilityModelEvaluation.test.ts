import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBlockBootstrapDifference,
  calculateMetric,
  classifyModelResult,
  createWalkForwardOrigins,
  getActualWithinHorizon,
  partitionEventsAtOrigin,
  type EvaluationRow,
} from "../scripts/evaluateProbabilityModels";
import type { ShadowResetEvent } from "../lib/radar/shadowProbability";

function event(id: string, resetAt: string): ShadowResetEvent {
  return { id, resetAt };
}

test("events at the origin are training data and later events are labels only", () => {
  const origin = "2026-08-01T00:00:00.000Z";
  const events = [
    event("before", "2026-07-31T23:59:59.999Z"),
    event("at-origin", origin),
    event("after", "2026-08-01T00:00:00.001Z"),
    event("at-24h", "2026-08-02T00:00:00.000Z"),
    event("at-48h", "2026-08-03T00:00:00.000Z"),
    event("after-as-of", "2026-08-04T00:00:00.000Z"),
  ];
  const split = partitionEventsAtOrigin(events, origin, "2026-08-03T12:00:00.000Z");

  assert.deepEqual(split.training.map((item) => item.id), ["before", "at-origin"]);
  assert.deepEqual(split.future.map((item) => item.id), ["after", "at-24h", "at-48h"]);
  assert.equal(getActualWithinHorizon(events, origin, 24), true);
  assert.equal(getActualWithinHorizon(events, origin, 48), true);
  assert.equal(getActualWithinHorizon([event("only-48h", "2026-08-03T00:00:00.000Z")], origin, 24), false);
});

test("walk-forward origins start only after five completed intervals and at JST midnight", () => {
  const events = Array.from({ length: 7 }, (_, index) =>
    event(`event-${index}`, `2026-06-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`),
  );
  const origins = createWalkForwardOrigins(events, "2026-06-15T12:00:00.000Z");

  assert.ok(origins.length > 0);
  assert.equal(origins[0], "2026-06-06T15:00:00.000Z");
  assert.ok(origins.every((origin) => origin.endsWith("T15:00:00.000Z")));
});

test("metric calculation reports brier, log loss, rate, mean, and all calibration buckets", () => {
  const rows: Array<EvaluationRow> = [
    { recordedAt: "2026-08-01T00:00:00.000Z", probability24h: 0.2, probability48h: 0.4, actual24h: false, actual48h: true },
    { recordedAt: "2026-08-02T00:00:00.000Z", probability24h: 0.8, probability48h: 0.6, actual24h: true, actual48h: false },
  ];
  const metric = calculateMetric(rows, "24h");

  assert.equal(metric.count, 2);
  assert.equal(metric.actualRate, 0.5);
  assert.equal(metric.averagePrediction, 0.5);
  assert.ok(Math.abs(metric.brier - 0.04) < 1e-12);
  assert.ok(metric.logLoss > 0);
  assert.deepEqual(metric.calibration.map((bucket) => bucket.range), [
    "0-20%", "20-40%", "40-60%", "60-80%", "80-100%",
  ]);
  assert.equal(metric.calibration.reduce((sum, bucket) => sum + bucket.count, 0), 2);
});

test("block bootstrap is deterministic for a fixed seed", () => {
  const current: Array<EvaluationRow> = Array.from({ length: 14 }, (_, index) => ({
    recordedAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    probability24h: 0.2,
    probability48h: 0.3,
    actual24h: index % 3 === 0,
    actual48h: index % 4 === 0,
  }));
  const candidate = current.map((row) => ({ ...row, probability24h: 0.25, probability48h: 0.35 }));
  const first = calculateBlockBootstrapDifference(candidate, current, "24h", 20260804, 128);
  const second = calculateBlockBootstrapDifference(candidate, current, "24h", 20260804, 128);

  assert.deepEqual(first, second);
  assert.equal(first.blockDays, 7);
  assert.equal(first.iterations, 128);
  assert.ok(first.lower <= first.upper);
});

test("model recommendation does not declare a winner when either horizon interval crosses zero", () => {
  const result = classifyModelResult({
    brier24h: 0.01,
    brier48h: 0.02,
    currentBrier24h: 0.02,
    currentBrier48h: 0.03,
    bootstrap24h: { lower: -0.01, upper: 0.02 },
    bootstrap48h: { lower: 0.005, upper: 0.02 },
  });

  assert.equal(result, "promising_but_inconclusive");
});
