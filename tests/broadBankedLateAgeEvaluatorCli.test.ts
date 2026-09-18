import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import {
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
} from "../data/shadowProbabilityConfig";
import {
  formatBroadBankedLateAgeRegimeDiagnosticOutput,
  parseBroadBankedLateAgeRegimeDiagnosticAsOf,
  runBroadBankedLateAgeRegimeDiagnostic,
} from "../scripts/analyze-broad-banked-late-age-regime-diagnostics";
import { getRecoveryResetEvents } from "../lib/radar/recoveryBoundary";

test("v2 late-age evaluator runner passes the explicit v2 policy to Production boundary loading", async () => {
  const asOf = new Date("2026-09-22T00:00:00.000Z");
  let receivedPolicy: string | undefined;
  const run = await runBroadBankedLateAgeRegimeDiagnostic(asOf, {
    loadPredictionHistoryRows: async () => ({ rows: [], reason: "fixture has no saved v2 rows" }),
    loadProductionBoundaries: async (_requestedAsOf, policy) => {
      receivedPolicy = policy;
      return { boundaries: [], reason: null };
    },
  });

  assert.equal(receivedPolicy, BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY);
  assert.equal(run.evaluation.randomEligibilityPolicyVersion, BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION);
  assert.equal(run.evaluation.status, "insufficient_data");
});

test("the broad banked fixture makes legacy and v2 boundary inputs observably different", () => {
  const fixture = LOCAL_RESET_HISTORY.find((item) => item.id === "personal-reset-credit-2026-06-11");
  assert.ok(fixture);
  const asOf = new Date("2026-06-13T00:00:00.000Z");
  const legacy = getRecoveryResetEvents(
    null,
    asOf,
    [fixture],
    undefined,
    LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
  );
  const v2 = getRecoveryResetEvents(
    null,
    asOf,
    [fixture],
    undefined,
    BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  );

  assert.equal(legacy[0]?.isRandom, false);
  assert.equal(v2[0]?.isRandom, true);
  assert.equal(v2[0]?.isRegular, true);
});

test("no saved v2 forecast rows produce a normal insufficient-data read-only CLI result", async () => {
  const asOf = new Date("2026-09-22T00:00:00.000Z");
  const run = await runBroadBankedLateAgeRegimeDiagnostic(asOf, {
    loadPredictionHistoryRows: async () => ({ rows: [], reason: "no prediction history rows" }),
    loadProductionBoundaries: async () => ({ boundaries: [], reason: "fixture boundaries unavailable" }),
  });
  const output = formatBroadBankedLateAgeRegimeDiagnosticOutput(run);

  assert.equal(output.status, "insufficient_data");
  assert.equal(output.asOf, asOf.toISOString());
  assert.equal(output.evaluationStartAt, null);
  assert.equal(output.canonicalRandomBoundaryCount, 0);
  assert.deepEqual(output.forecastCounts, {
    "hazard-regime-broad-banked-random-continuous-bw18-tr54-late-regime-control-v2": 0,
    "hazard-regime-broad-banked-random-continuous-bw18-tr54-late-neutral-144h-v2": 0,
    "hazard-regime-broad-banked-random-continuous-bw18-tr54-late-no-downward-144h-v2": 0,
    "hazard-regime-broad-banked-random-continuous-bw18-tr54-pre-reset-frozen-regime-v2": 0,
  });
  assert.equal(Object.keys(output.armMetrics).length, 4);
  assert.equal(output.primaryOverallDifferences.brier24h, null);
  assert.equal(output.primaryLateAgeOnlyDifferences.brier24h, null);
  assert.equal(output.dataAvailability.predictionHistoryRows, 0);
  assert.equal(output.dataAvailability.canonicalBoundaryRows, 0);
  assert.equal(output.readOnly, true);
  assert.equal(output.writesPerformed, false);
});

test("v2 late-age evaluator CLI parses --as-of explicitly", () => {
  const asOf = parseBroadBankedLateAgeRegimeDiagnosticAsOf([
    "--as-of",
    "2026-09-22T00:00:00.000Z",
  ]);
  assert.equal(asOf.toISOString(), "2026-09-22T00:00:00.000Z");
});
