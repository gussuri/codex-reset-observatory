import { basename } from "node:path";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import {
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
} from "../data/shadowProbabilityConfig";
import {
  buildSurvivalConditionedHazard,
  getSurvivalConditionedHazardDiagnosticsAtAge,
  integrateSurvivalConditionedHazard,
} from "../lib/radar/survivalConditionedProbability";
import { getRecoveryResetEvents } from "../lib/radar/recoveryBoundary";
import { getRandomElapsedBoundaries } from "../lib/radar/randomElapsedProbability";
import { loadProductionCanonicalRadarData } from "./evaluateProspectiveProbabilityForecasts";

function loadOptionalLocalEnv() {
  try {
    const processWithLoader = process as typeof process & {
      loadEnvFile?: (path?: string) => void;
    };
    processWithLoader.loadEnvFile?.(".env.local");
  } catch {
    // Missing local credentials are reported as an unavailable read-only result.
  }
}

function parseAsOf(args: string[]) {
  const index = args.indexOf("--as-of");
  const value = index >= 0 ? args[index + 1] : undefined;
  const asOf = value ? new Date(value) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid --as-of timestamp: ${value}`);
  return asOf;
}

async function main() {
  loadOptionalLocalEnv();
  const asOf = parseAsOf(process.argv.slice(2));
  const loaded = await loadProductionCanonicalRadarData(asOf);
  if (!loaded.data) {
    console.log(JSON.stringify({
      status: "unavailable",
      source: "production-canonical-read-only",
      asOf: asOf.toISOString(),
      reason: loaded.reason,
    }, null, 2));
    return;
  }

  const boundaries = getRecoveryResetEvents(
    loaded.data,
    asOf,
    LOCAL_RESET_HISTORY,
    undefined,
    BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  );
  const randomBoundaries = getRandomElapsedBoundaries(boundaries);
  const hazard = buildSurvivalConditionedHazard(randomBoundaries, asOf);
  const ages = Array.from({ length: 16 }, (_, index) => index * 24);
  const curve = ages.map((ageHours) => {
    const diagnostics = getSurvivalConditionedHazardDiagnosticsAtAge(hazard, ageHours);
    return {
      ageHours,
      qRaw: diagnostics.qRaw,
      qNeighbor: diagnostics.qNeighbor,
      ess: diagnostics.ess,
      smoothingBandwidthHours: diagnostics.smoothingBandwidthHours,
      lambdaPerHour: diagnostics.lambdaPerHour,
      probability12h: integrateSurvivalConditionedHazard(hazard, ageHours, 12),
      probability24h: integrateSurvivalConditionedHazard(hazard, ageHours, 24),
      probability48h: integrateSurvivalConditionedHazard(hazard, ageHours, 48),
      probability72h: integrateSurvivalConditionedHazard(hazard, ageHours, 72),
    };
  });

  console.log(JSON.stringify({
    status: "ok",
    source: "production-canonical-read-only",
    asOf: asOf.toISOString(),
    boundaryCount: randomBoundaries.length,
    completedIntervalCount: hazard.completedIntervalCount,
    maxSupportedAgeHours: hazard.maxSupportedAgeHours,
    longTermHazardPerHour: hazard.longTermHazardPerHour,
    tailAnchorHazardPerHour: hazard.tailAnchorHazardPerHour,
    curve,
  }, null, 2));
}

if (basename(process.argv[1] ?? "") === "inspectProductionSurvivalConditionedHazard.ts") {
  void main();
}
