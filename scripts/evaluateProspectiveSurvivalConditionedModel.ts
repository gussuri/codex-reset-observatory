import { basename, resolve } from "node:path";
import { writeFileSync } from "node:fs";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import {
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
} from "../data/shadowProbabilityConfig";
import {
  loadPredictionHistoryRows,
  loadProductionCanonicalRadarData,
} from "./evaluateProspectiveProbabilityForecasts";
import {
  evaluateProspectiveSurvivalConditionedModel,
} from "../lib/radar/prospectiveSurvivalConditionedModelEvaluation";
import { getRecoveryResetEvents } from "../lib/radar/recoveryBoundary";

function loadOptionalLocalEnv() {
  try {
    const processWithLoader = process as typeof process & {
      loadEnvFile?: (path?: string) => void;
    };
    processWithLoader.loadEnvFile?.(".env.local");
  } catch {
    // Missing local credentials are reported by the read-only loaders.
  }
}

function parseAsOf(args: string[]) {
  const index = args.indexOf("--as-of");
  const value = index >= 0 ? args[index + 1] : undefined;
  const asOf = value ? new Date(value) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid --as-of timestamp: ${value}`);
  return asOf;
}

function getOutputPath(args: string[]) {
  const index = args.indexOf("--output");
  const value = index >= 0 ? args[index + 1] : undefined;
  return value ? resolve(value) : null;
}

async function main() {
  loadOptionalLocalEnv();
  const args = process.argv.slice(2);
  const asOf = parseAsOf(args);
  const history = await loadPredictionHistoryRows();
  const canonical = await loadProductionCanonicalRadarData(asOf);
  const boundaries = canonical.data
    ? getRecoveryResetEvents(
        canonical.data,
        asOf,
        LOCAL_RESET_HISTORY,
        undefined,
        BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
      )
    : [];
  const report = evaluateProspectiveSurvivalConditionedModel(history.rows, boundaries, asOf);
  const notes = [
    ...report.notes,
    ...(history.rows.length === 0 && history.reason
      ? [`Prediction history availability: ${history.reason}`]
      : []),
    ...(canonical.reason ? [`Canonical history availability: ${canonical.reason}`] : []),
  ];
  const finalReport = { ...report, notes };
  const output = getOutputPath(args);
  if (output) writeFileSync(output, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: finalReport.status,
    asOf: finalReport.asOf,
    evaluationStartAt: finalReport.evaluationStartAt,
    commonComparableOrigins: finalReport.forecastCounts.commonComparable,
    canonicalRandomBoundaryCount: finalReport.canonicalRandomBoundaryCount,
    output: output ?? null,
  }, null, 2));
}

if (basename(process.argv[1] ?? "") === "evaluateProspectiveSurvivalConditionedModel.ts") {
  void main();
}
