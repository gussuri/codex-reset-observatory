import assert from "node:assert/strict";
import test from "node:test";

import {
  fitContextualBurstContext,
  getContextualBurstMultiplier,
  type ContextualBurstFit,
} from "../lib/radar/contextualBurstContext";
import type { RecoveryResetBoundary } from "../lib/radar/recoveryBoundary";

const HOUR_MS = 60 * 60 * 1000;

function boundaries() {
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: 23 }, (_, index): RecoveryResetBoundary => {
    const id = `r${index}`;
    return {
      id,
      resetAt: new Date(base + index * 48 * HOUR_MS).toISOString(),
      isRandom: true,
      isRegular: false,
      sourceIds: [id],
    };
  });
}

test("survival context fitting excludes the current live interval when requested", () => {
  const asOf = new Date(Date.parse("2026-01-01T00:00:00.000Z") + 23 * 48 * HOUR_MS);
  const allCells = fitContextualBurstContext(boundaries(), asOf, null, {
    getHazardAtAge: () => 0.001,
  });
  const completedCells = fitContextualBurstContext(boundaries(), asOf, null, {
    includeLiveInterval: false,
    getHazardAtAge: () => 0.001,
  });

  assert.equal(completedCells.fallbackUsed, false);
  assert.ok(allCells.exposureCellCount > completedCells.exposureCellCount);
  assert.equal(completedCells.exposureCellCount, 1008);
  assert.equal(allCells.exposureCellCount, 1056);
});

test("survival context arm ablations expose only their intended terms", () => {
  const fit: ContextualBurstFit = {
    coefficients: { count72: 0.4, previousInterval: -0.3, hourSin: 0.2, hourCos: 0.1 },
    burstStats: {
      count72Mean: 0,
      count72StdDev: 1,
      previousIntervalMean: 0,
      previousIntervalStdDev: 1,
    },
    trainingEventCount: 20,
    exposureCellCount: 1000,
    fallbackUsed: false,
    fallbackReason: null,
    solver: { converged: true, iterations: 1, objective: 0, reason: null },
  };
  const raw = {
    randomResetCount72h: 2,
    previousRandomIntervalHours: 48,
    hourSin: 0.5,
    hourCos: 0.25,
  };

  for (const ablation of [
    "previousIntervalOnly",
    "circadianOnly",
    "previousIntervalCircadianOnly",
  ] as const) {
    const value = getContextualBurstMultiplier(raw, fit, ablation);
    assert.ok(Number.isFinite(value) && value >= 0.5 && value <= 2);
  }
  assert.notEqual(
    getContextualBurstMultiplier(raw, fit, "previousIntervalOnly"),
    getContextualBurstMultiplier(raw, fit, "circadianOnly"),
  );
});
