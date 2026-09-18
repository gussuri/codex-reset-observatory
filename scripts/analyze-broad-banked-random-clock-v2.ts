import { basename } from "node:path";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import {
  BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
} from "../data/shadowProbabilityConfig";
import {
  calculateRandomClockSensitivityComparison,
  compareRandomBoundaryIntervals,
} from "../lib/radar/broadBankedRandomClockV2Diagnostics";
import { getRecoveryResetEvents, type RecoveryResetBoundary } from "../lib/radar/recoveryBoundary";
import { loadProductionBoundaries } from "./evaluateRandomContinuousModelProspectively";

function loadOptionalLocalEnv() {
  try {
    const processWithLoader = process as typeof process & {
      loadEnvFile?: (path?: string) => void;
    };
    processWithLoader.loadEnvFile?.(".env.local");
  } catch {
    // Missing or unsupported local env files are reported as insufficient data.
  }
}

function parseArgs(args: Array<string>) {
  const index = args.indexOf("--as-of");
  const value = index >= 0 ? args[index + 1] : undefined;
  const asOf = value ? new Date(value) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid --as-of timestamp: ${value}`);
  return {
    asOf,
    staticOnly: args.includes("--static-only"),
  };
}

function loadStaticBoundaries(asOf: Date, policy: typeof LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY | typeof BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY) {
  return getRecoveryResetEvents(null, asOf, LOCAL_RESET_HISTORY, undefined, policy);
}

async function loadBoundaries(
  asOf: Date,
  policy: typeof LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY | typeof BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  staticOnly: boolean,
): Promise<{ boundaries: Array<RecoveryResetBoundary>; reason: string | null }> {
  if (staticOnly) return { boundaries: loadStaticBoundaries(asOf, policy), reason: null };
  return loadProductionBoundaries(asOf, policy);
}

async function main() {
  loadOptionalLocalEnv();
  const { asOf, staticOnly } = parseArgs(process.argv.slice(2));
  const [legacy, v2] = await Promise.all([
    loadBoundaries(asOf, LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY, staticOnly),
    loadBoundaries(asOf, BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY, staticOnly),
  ]);
  const intervalComparison = compareRandomBoundaryIntervals(
    legacy.boundaries,
    v2.boundaries,
    asOf,
  );
  const sensitivity = calculateRandomClockSensitivityComparison(
    legacy.boundaries,
    v2.boundaries,
  );
  const lateSensitivity = {
    legacy: sensitivity.legacy.filter((row) => row.ageHours >= 288),
    v2: sensitivity.v2.filter((row) => row.ageHours >= 288),
  };

  console.log(JSON.stringify({
    status: "ok",
    asOf: asOf.toISOString(),
    freezeAt: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
    randomEligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    readOnly: true,
    writesPerformed: false,
    source: staticOnly ? "LOCAL_RESET_HISTORY" : "Production Supabase recovery inputs",
    dataAvailability: {
      legacyBoundaryCount: legacy.boundaries.length,
      legacyBoundaryReason: legacy.reason,
      v2BoundaryCount: v2.boundaries.length,
      v2BoundaryReason: v2.reason,
    },
    intervalComparison,
    sensitivity,
    secondPeak12to15d: lateSensitivity,
    notes: [
      "Interval bins are derived from valid completed random boundaries at or before asOf.",
      "The split proof derives elapsed hours from boundary timestamps; it does not hardcode the ~333.567-hour interval.",
      "Sensitivity rows use pure reset-clock structure with the frozen regime multiplier and post-reset attenuation; signal/notice inputs are intentionally excluded.",
      "This diagnostic does not write prediction_history, backfill, relabel, retune, or publish any model.",
    ],
  }, null, 2));
}

if (basename(process.argv[1] ?? "") === "analyze-broad-banked-random-clock-v2.ts") {
  main().catch((error) => {
    console.error(
      "Broad banked random clock v2 diagnostic analysis failed",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  });
}
