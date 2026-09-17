import {
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_COMMON_OPTIONS,
} from "../data/shadowProbabilityConfig";
import {
  buildRandomContinuousHazard,
  getRandomContinuousHazardDiagnosticsAtAge,
} from "../lib/radar/randomContinuousProbability";
import {
  evaluateRandomContinuousBandwidthAgeDiagnostics,
  summarizeRandomResetIntervals,
} from "../lib/radar/prospectiveRandomBandwidthAgeDiagnostics";
import type { RecoveryResetBoundary } from "../lib/radar/recoveryBoundary";
import {
  loadPredictionHistoryRows,
} from "./evaluateProspectiveProbabilityForecasts";
import {
  loadProductionBoundaries,
} from "./evaluateRandomContinuousModelProspectively";

const HOUR_MS = 60 * 60 * 1000;

function loadOptionalLocalEnv() {
  try {
    const processWithLoader = process as typeof process & {
      loadEnvFile?: (path?: string) => void;
    };
    processWithLoader.loadEnvFile?.(".env.local");
  } catch {
    // Missing or unsupported local env files are reported in the output.
  }
}

function parseAsOf(args: Array<string>) {
  const index = args.indexOf("--as-of");
  const value = index >= 0 ? args[index + 1] : undefined;
  const asOf = value ? new Date(value) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid --as-of timestamp: ${value}`);
  return asOf;
}

function boundary(id: string, resetAt: string): RecoveryResetBoundary {
  return { id, resetAt, isRandom: true, isRegular: false, sourceIds: [id] };
}

function buildSyntheticCliff() {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const intervals = [24, 48, 72, 96, 180, 176, 184, 186];
  const boundaries = [boundary("r0", new Date(start).toISOString())];
  let cursor = start;
  for (let index = 0; index < intervals.length; index += 1) {
    const intervalHours = intervals[index];
    cursor += intervalHours * HOUR_MS;
    boundaries.push(boundary(`r${index + 1}`, new Date(cursor).toISOString()));
  }
  const now = new Date(cursor + 240 * HOUR_MS);
  const ages = [120, 144, 168, 192, 216];
  const byBandwidth = Object.fromEntries(
    RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS.map((bandwidthHours) => {
      const hazard = buildRandomContinuousHazard(boundaries, now, {
        ...RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_COMMON_OPTIONS,
        bandwidthHours,
      });
      return [bandwidthHours, Object.fromEntries(ages.map((ageHours) => [
        ageHours,
        getRandomContinuousHazardDiagnosticsAtAge(hazard, ageHours).dailyProbability,
      ]))];
    }),
  );
  return { asOf: now.toISOString(), ages, byBandwidth };
}

async function main() {
  loadOptionalLocalEnv();
  const asOf = parseAsOf(process.argv.slice(2));
  const history = await loadPredictionHistoryRows();
  const production = await loadProductionBoundaries(asOf);
  const evaluation = evaluateRandomContinuousBandwidthAgeDiagnostics(
    history.rows,
    production.boundaries,
    asOf,
  );
  const intervalSummary = summarizeRandomResetIntervals(production.boundaries, asOf);
  console.log(JSON.stringify({
    evaluation,
    canonicalIntervalHistogram: intervalSummary,
    syntheticCliff: buildSyntheticCliff(),
    dataAvailability: {
      predictionHistoryRows: history.rows.length,
      predictionHistoryReason: history.reason,
      canonicalBoundaryRows: production.boundaries.length,
      canonicalBoundaryReason: production.reason,
      readOnly: true,
      writesPerformed: false,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(
    "Bandwidth-age diagnostic analysis failed",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
});
