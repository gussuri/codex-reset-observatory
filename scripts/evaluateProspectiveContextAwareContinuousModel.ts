import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  evaluateContextAwareContinuousModelProspectively,
  type ContextAwareProspectiveEvaluationReport,
  type ContextAwareProspectiveMetric,
} from "../lib/radar/prospectiveContextAwareContinuousModelEvaluation";
import { loadPredictionHistoryRows } from "./evaluateProspectiveProbabilityForecasts";
import { loadProductionBoundaries } from "./evaluateRandomContinuousModelProspectively";

function loadOptionalLocalEnv() {
  try {
    const processWithLoader = process as typeof process & {
      loadEnvFile?: (path?: string) => void;
    };
    processWithLoader.loadEnvFile?.(".env.local");
  } catch {
    // Missing local env is reported as unavailable input by the loaders.
  }
}

function parseAsOf(args: string[]) {
  const index = args.indexOf("--as-of");
  const value = index >= 0 ? args[index + 1] : undefined;
  const asOf = value ? new Date(value) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid --as-of timestamp: ${value}`);
  return asOf;
}

function formatMetric(metric: ContextAwareProspectiveMetric) {
  return [
    `n=${metric.count}`,
    `positive=${metric.positiveCount}`,
    `actual=${metric.actualRate.toFixed(4)}`,
    `mean=${metric.averagePrediction.toFixed(4)}`,
    `bias=${metric.bias.toFixed(4)}`,
    `Brier=${metric.brier.toFixed(6)}`,
    `logLoss=${metric.logLoss.toFixed(6)}`,
    `targets=${metric.targetResetCount}`,
  ].join(", ");
}

function formatMarkdown(report: ContextAwareProspectiveEvaluationReport) {
  const segmentLines = Object.values(report.contextSegments).flatMap((segment) => [
    `- ${segment.contextState} 24h: ${formatMetric(segment.metrics24h)}`,
    `- ${segment.contextState} 48h: ${formatMetric(segment.metrics48h)}`,
  ]);
  const lines = [
    "# Prospective Context-Aware Continuous Probability Evaluation",
    "",
    `- Status: ${report.status}`,
    `- Evaluation mode: ${report.evaluationMode}`,
    `- Backfilled: ${report.backfilled}`,
    `- Candidate: ${report.candidateModelVersion}`,
    `- Challenger: ${report.challengerModelVersion}`,
    `- Freeze at: ${report.freezeAt}`,
    `- As of: ${report.asOf}`,
    `- Evaluation start: ${report.evaluationStartAt ?? "not started"}`,
    `- Saved forecasts: candidate=${report.forecastCounts.candidate}, challenger=${report.forecastCounts.challenger}, comparable=${report.forecastCounts.comparable}`,
    "",
    "## Same-origin daily-first metrics",
    "",
    `- Candidate 24h: ${formatMetric(report.models.candidate.metrics24h)}`,
    `- Candidate 48h: ${formatMetric(report.models.candidate.metrics48h)}`,
    `- Age-only 18/54 24h: ${formatMetric(report.models.ageOnly.metrics24h)}`,
    `- Age-only 18/54 48h: ${formatMetric(report.models.ageOnly.metrics48h)}`,
    `- Challenger 18/54 24h: ${formatMetric(report.models.challenger.metrics24h)}`,
    `- Challenger 18/54 48h: ${formatMetric(report.models.challenger.metrics48h)}`,
    "",
    "## Candidate deltas",
    "",
    `- Candidate minus age-only: ${JSON.stringify(report.comparison.candidateMinusAgeOnly)}`,
    `- Candidate minus challenger: ${JSON.stringify(report.comparison.candidateMinusChallenger)}`,
    `- Target resets: ${report.comparison.targetResetCount}`,
    "",
    "## Context segments",
    "",
    ...segmentLines,
    "",
    "## Latest fit audit",
    "",
    `- Origin: ${report.latestFit.generatedAt ?? "unavailable"}`,
    `- 24h coefficients: alpha=${report.latestFit.alpha24h ?? "unavailable"}, weak=${report.latestFit.betaWeak24h ?? "unavailable"}, strong=${report.latestFit.betaStrong24h ?? "unavailable"}`,
    `- 48h coefficients: alpha=${report.latestFit.alpha48h ?? "unavailable"}, weak=${report.latestFit.betaWeak48h ?? "unavailable"}, strong=${report.latestFit.betaStrong48h ?? "unavailable"}`,
    `- Training samples: 24h=${report.latestFit.trainingSampleCount24h ?? "unavailable"}, 48h=${report.latestFit.trainingSampleCount48h ?? "unavailable"}`,
    `- Excluded training rows: 24h=${report.latestFit.excludedTrainingRowCount24h ?? "unavailable"}, 48h=${report.latestFit.excludedTrainingRowCount48h ?? "unavailable"}`,
    `- Training read status: ${report.latestFit.trainingReadStatus}`,
    "",
    "## Manual review gate",
    "",
    `- Auto publish: ${report.gate.autoPublish}`,
    `- Manual review only: ${report.gate.manualReviewOnly}`,
    `- Target resets: ${report.gate.targetResetCount}/${report.gate.thresholds.targetResetCount}`,
    `- Resolved daily: 24h=${report.gate.resolvedDaily24h}/${report.gate.thresholds.resolvedDaily24h}, 48h=${report.gate.resolvedDaily48h}/${report.gate.thresholds.resolvedDaily48h}`,
    `- Eligible for manual review: ${report.gate.eligibleForManualReview}`,
    "",
    "## Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function writeContextAwareProspectiveReports(
  report: ContextAwareProspectiveEvaluationReport,
  reportsDirectory = join(process.cwd(), "reports"),
) {
  mkdirSync(reportsDirectory, { recursive: true });
  writeFileSync(
    join(reportsDirectory, "prospective-context-aware-continuous-model-evaluation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(reportsDirectory, "prospective-context-aware-continuous-model-evaluation.md"),
    formatMarkdown(report),
    "utf8",
  );
}

async function main() {
  loadOptionalLocalEnv();
  const asOf = parseAsOf(process.argv.slice(2));
  const history = await loadPredictionHistoryRows();
  const production = await loadProductionBoundaries(asOf);
  const baseReport = evaluateContextAwareContinuousModelProspectively(
    history.rows,
    production.boundaries,
    asOf,
  );
  const report: ContextAwareProspectiveEvaluationReport = {
    ...baseReport,
    notes: [
      ...baseReport.notes,
      ...(history.reason ? [`Prediction history availability: ${history.reason}`] : []),
      ...(production.reason ? [`Boundary availability: ${production.reason}`] : []),
      "Production inputs are read-only; this script does not write, backfill, relabel, or publish forecasts.",
    ],
  };
  writeContextAwareProspectiveReports(report);
  console.log(JSON.stringify({
    status: report.status,
    candidateModelVersion: report.candidateModelVersion,
    freezeAt: report.freezeAt,
    evaluationStartAt: report.evaluationStartAt,
    comparableForecastRows: report.forecastCounts.comparable,
    resolved24h: report.comparison.resolved24h,
    resolved48h: report.comparison.resolved48h,
    targetResetCount: report.comparison.targetResetCount,
    backfilled: report.backfilled,
  }, null, 2));
}

if (basename(process.argv[1] ?? "") === "evaluateProspectiveContextAwareContinuousModel.ts") {
  void main();
}
