import assert from "node:assert/strict";
import test from "node:test";

import {
  createSixHourOrigins,
  getCensorAwareOutcome,
  selectNonOverlappingOrigins,
  selectPrequentialCandidate,
  type RegimeEvaluationRow,
} from "../scripts/evaluateRegimeElapsedProbability";
import type { RecoveryResetBoundary } from "../lib/radar/recoveryBoundary";
import type { ShadowResetEvent } from "../lib/radar/shadowProbability";

function event(id: string, resetAt: string): ShadowResetEvent {
  return { id, resetAt };
}

function row(recordedAt: string, probability24h: number, actual24h: boolean | null): RegimeEvaluationRow {
  return {
    recordedAt,
    probability24h,
    probability48h: probability24h,
    actual24h,
    actual48h: actual24h,
  };
}

test("six-hour origins are aligned and leave the requested horizon for labels", () => {
  const origins = createSixHourOrigins(
    Array.from({ length: 8 }, (_, index) => event(`e${index}`, `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`)),
    "2026-06-15T00:00:00.000Z",
  );
  assert.ok(origins.length > 0);
  assert.equal(new Date(origins[0]).getUTCHours() % 6, 0);
  assert.equal(new Date(origins[1]).getTime() - new Date(origins[0]).getTime(), 6 * 60 * 60 * 1000);
  assert.ok(new Date(origins.at(-1)!).getTime() <= new Date("2026-06-13T00:00:00.000Z").getTime());
  assert.deepEqual(selectNonOverlappingOrigins(origins, 24).slice(0, 3), [origins[0], origins[4], origins[8]]);
});

test("regular recovery boundaries censor a no-event horizon but random boundaries score positive", () => {
  const regular: RecoveryResetBoundary = {
    id: "regular",
    resetAt: "2026-08-01T12:00:00.000Z",
    isRandom: false,
    isRegular: true,
    sourceIds: ["regular"],
  };
  const random: RecoveryResetBoundary = {
    id: "random",
    resetAt: "2026-08-01T18:00:00.000Z",
    isRandom: true,
    isRegular: false,
    sourceIds: ["random"],
  };
  assert.equal(getCensorAwareOutcome([regular], "2026-08-01T00:00:00.000Z", 24), null);
  assert.equal(getCensorAwareOutcome([regular, random], "2026-08-01T00:00:00.000Z", 24), true);
  assert.equal(getCensorAwareOutcome([], "2026-08-01T00:00:00.000Z", 24), false);
});

test("prequential candidate selection uses only rows already supplied", () => {
  const candidateA = [row("2026-08-01T00:00:00.000Z", 0.2, false)];
  const candidateB = [row("2026-08-01T00:00:00.000Z", 0.9, true)];
  const first = selectPrequentialCandidate([
    { key: "A", rows: [] },
    { key: "B", rows: [] },
  ], "A");
  const afterPastOrigin = selectPrequentialCandidate([
    { key: "A", rows: candidateA },
    { key: "B", rows: candidateB },
  ], "A");

  assert.equal(first, "A");
  assert.equal(afterPastOrigin, "B");
});
