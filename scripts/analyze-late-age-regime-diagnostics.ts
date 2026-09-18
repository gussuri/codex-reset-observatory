import {
  evaluateLateAgeRegimeDiagnostics,
} from "../lib/radar/prospectiveLateAgeRegimeDiagnostics";
import { loadPredictionHistoryRows } from "./evaluateProspectiveProbabilityForecasts";
import { loadProductionBoundaries } from "./evaluateRandomContinuousModelProspectively";

function loadOptionalLocalEnv() {
  try {
    const processWithLoader = process as typeof process & {
      loadEnvFile?: (path?: string) => void;
    };
    processWithLoader.loadEnvFile?.(".env.local");
  } catch {
    // Missing local environment configuration is reported as insufficient data.
  }
}

function parseAsOf(args: Array<string>) {
  const index = args.indexOf("--as-of");
  const value = index >= 0 ? args[index + 1] : undefined;
  const asOf = value ? new Date(value) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid --as-of timestamp: ${value}`);
  return asOf;
}

async function main() {
  loadOptionalLocalEnv();
  const asOf = parseAsOf(process.argv.slice(2));
  const history = await loadPredictionHistoryRows();
  const production = await loadProductionBoundaries(asOf);
  const evaluation = evaluateLateAgeRegimeDiagnostics(
    history.rows,
    production.boundaries,
    asOf,
  );
  console.log(JSON.stringify({
    evaluation,
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
    "Late-age regime diagnostic analysis failed",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
});
