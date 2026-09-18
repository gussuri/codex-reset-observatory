import { basename } from "node:path";

import {
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
} from "../data/shadowProbabilityConfig";
import {
  evaluateBroadBankedLateAgeRegimeDiagnostics,
  type ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport,
} from "../lib/radar/prospectiveBroadBankedLateAgeRegimeDiagnostics";
import {
  loadPredictionHistoryRows,
  type PredictionHistoryLoadResult,
} from "./evaluateProspectiveProbabilityForecasts";
import {
  loadProductionBoundaries,
} from "./evaluateRandomContinuousModelProspectively";

export type BroadBankedLateAgeRegimeDiagnosticRun = {
  evaluation: ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport;
  dataAvailability: {
    predictionHistoryRows: number;
    predictionHistoryReason: string | null;
    canonicalBoundaryRows: number;
    canonicalBoundaryReason: string | null;
  };
};

export type BroadBankedLateAgeRegimeDiagnosticDependencies = {
  loadPredictionHistoryRows?: () => Promise<PredictionHistoryLoadResult>;
  loadProductionBoundaries?: typeof loadProductionBoundaries;
  evaluate?: typeof evaluateBroadBankedLateAgeRegimeDiagnostics;
};

export type BroadBankedLateAgeRegimeDiagnosticOutput = {
  status: ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport["status"];
  asOf: string;
  freezeAt: typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT;
  randomEligibilityPolicyVersion: typeof BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION;
  evaluationStartAt: string | null;
  canonicalRandomBoundaryCount: number;
  forecastCounts: Record<string, number>;
  armMetrics: Record<string, {
    forecastCount: number;
    comparableOriginCount: number;
    dailyFirstOriginCount: number;
    metrics24h: ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport["models"][typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[number]]["metrics24h"];
    metrics48h: ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport["models"][typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[number]]["metrics48h"];
    ageBuckets: ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport["models"][typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[number]]["ageBuckets"];
    unknownAgeCount: number;
  }>;
  primaryOverallDifferences: {
    brier24h: number | null;
    brier48h: number | null;
    logLoss24h: number | null;
    logLoss48h: number | null;
  };
  primaryLateAgeOnlyDifferences: {
    brier24h: number | null;
    brier48h: number | null;
    logLoss24h: number | null;
    logLoss48h: number | null;
  };
  dataAvailability: BroadBankedLateAgeRegimeDiagnosticRun["dataAvailability"];
  readOnly: true;
  writesPerformed: false;
};

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

export function parseBroadBankedLateAgeRegimeDiagnosticAsOf(args: Array<string>) {
  const index = args.indexOf("--as-of");
  const value = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && !value) throw new Error("--as-of requires an ISO timestamp");
  const asOf = value ? new Date(value) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid --as-of timestamp: ${value}`);
  return asOf;
}

export async function runBroadBankedLateAgeRegimeDiagnostic(
  asOf: Date,
  dependencies: BroadBankedLateAgeRegimeDiagnosticDependencies = {},
): Promise<BroadBankedLateAgeRegimeDiagnosticRun> {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError("asOf must be a valid date");

  const history = dependencies.loadPredictionHistoryRows
    ? await dependencies.loadPredictionHistoryRows()
    : await loadPredictionHistoryRows();
  const production = dependencies.loadProductionBoundaries
    ? await dependencies.loadProductionBoundaries(asOf, BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY)
    : await loadProductionBoundaries(asOf, BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY);
  const evaluate = dependencies.evaluate ?? evaluateBroadBankedLateAgeRegimeDiagnostics;
  const evaluation = evaluate(history.rows, production.boundaries, asOf);

  return {
    evaluation,
    dataAvailability: {
      predictionHistoryRows: history.rows.length,
      predictionHistoryReason: history.reason,
      canonicalBoundaryRows: production.boundaries.length,
      canonicalBoundaryReason: production.reason,
    },
  };
}

export function formatBroadBankedLateAgeRegimeDiagnosticOutput(
  run: BroadBankedLateAgeRegimeDiagnosticRun,
): BroadBankedLateAgeRegimeDiagnosticOutput {
  const { evaluation } = run;
  const primary = evaluation.comparison.primary;
  return {
    status: evaluation.status,
    asOf: evaluation.asOf,
    freezeAt: evaluation.freezeAt,
    randomEligibilityPolicyVersion: evaluation.randomEligibilityPolicyVersion,
    evaluationStartAt: evaluation.evaluationStartAt,
    canonicalRandomBoundaryCount: evaluation.canonicalRandomBoundaryCount,
    forecastCounts: evaluation.forecastCounts,
    armMetrics: Object.fromEntries(
      BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.map((modelVersion) => {
        const model = evaluation.models[modelVersion];
        return [modelVersion, {
          forecastCount: model.forecastCount,
          comparableOriginCount: model.comparableOriginCount,
          dailyFirstOriginCount: model.dailyFirstOriginCount,
          metrics24h: model.metrics24h,
          metrics48h: model.metrics48h,
          ageBuckets: model.ageBuckets,
          unknownAgeCount: model.unknownAgeCount,
        }];
      }),
    ) as BroadBankedLateAgeRegimeDiagnosticOutput["armMetrics"],
    primaryOverallDifferences: {
      brier24h: primary.overallBrierDifference24h,
      brier48h: primary.overallBrierDifference48h,
      logLoss24h: primary.overallLogLossDifference24h,
      logLoss48h: primary.overallLogLossDifference48h,
    },
    primaryLateAgeOnlyDifferences: {
      brier24h: primary.lateAgeBrierDifference24h,
      brier48h: primary.lateAgeBrierDifference48h,
      logLoss24h: primary.lateAgeLogLossDifference24h,
      logLoss48h: primary.lateAgeLogLossDifference48h,
    },
    dataAvailability: run.dataAvailability,
    readOnly: true,
    writesPerformed: false,
  };
}

async function main() {
  loadOptionalLocalEnv();
  const asOf = parseBroadBankedLateAgeRegimeDiagnosticAsOf(process.argv.slice(2));
  const run = await runBroadBankedLateAgeRegimeDiagnostic(asOf);
  console.log(JSON.stringify(formatBroadBankedLateAgeRegimeDiagnosticOutput(run), null, 2));
}

if (basename(process.argv[1] ?? "") === "analyze-broad-banked-late-age-regime-diagnostics.ts") {
  main().catch((error) => {
    console.error(
      "Broad banked late-age regime diagnostic evaluation failed",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  });
}
