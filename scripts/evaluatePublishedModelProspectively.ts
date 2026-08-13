import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import {
  getShadowCompletedResetEvents,
  type ShadowResetEvent,
} from "../lib/radar/shadowProbability";
import {
  evaluatePublishedModelProspectively,
  formatPublishedProspectiveMetric,
  type PublishedProspectiveEvaluationReport,
} from "../lib/radar/prospectivePublishedModelEvaluation";
import {
  loadFormalTiboResets,
  loadPredictionHistoryRows,
} from "./evaluateProspectiveProbabilityForecasts";

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

function parseAsOf(args: Array<string>) {
  const index = args.indexOf("--as-of");
  const value = index >= 0 ? args[index + 1] : undefined;
  const asOf = value ? new Date(value) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid --as-of timestamp: ${value}`);
  return asOf;
}

function writeMarkdown(report: PublishedProspectiveEvaluationReport) {
  const active24h = report.models.active.metrics24h;
  const active48h = report.models.active.metrics48h;
  const baseline24h = report.models.baseline.metrics24h;
  const baseline48h = report.models.baseline.metrics48h;
  const lines = [
    "# Prospective Published Model Evaluation",
    "",
    `- Status: ${report.status}`,
    `- Evaluation mode: ${report.evaluationMode}`,
    `- Backfilled: ${report.backfilled}`,
    `- Evaluation start: ${report.evaluationStartAt ?? "not started"}`,
    `- Active model: ${report.activeModelVersion}`,
    `- Baseline model: ${report.baselineModelVersion}`,
    `- As of: ${report.asOf}`,
    `- Saved forecasts: active=${report.forecastCounts.active}, baseline=${report.forecastCounts.baseline}, comparable=${report.forecastCounts.comparable}`,
    `- Source: ${report.source}`,
    `- Target definition: ${report.targetDefinition}`,
    "",
    "## Daily first forecast comparison",
    "",
    `### ${report.activeModelVersion}`,
    `- 24h: ${formatPublishedProspectiveMetric(active24h)}`,
    `- 48h: ${formatPublishedProspectiveMetric(active48h)}`,
    "",
    `### ${report.baselineModelVersion}`,
    `- 24h: ${formatPublishedProspectiveMetric(baseline24h)}`,
    `- 48h: ${formatPublishedProspectiveMetric(baseline48h)}`,
    "",
    "## Active minus baseline",
    "",
    `- 24h Brier: ${report.comparison.activeMinusBaseline.brier24h ?? "unavailable"}`,
    `- 48h Brier: ${report.comparison.activeMinusBaseline.brier48h ?? "unavailable"}`,
    `- 24h Log loss: ${report.comparison.activeMinusBaseline.logLoss24h ?? "unavailable"}`,
    `- 48h Log loss: ${report.comparison.activeMinusBaseline.logLoss48h ?? "unavailable"}`,
    `- Resolved forecasts: 24h=${report.comparison.resolved24h}, 48h=${report.comparison.resolved48h}`,
    `- Positive forecasts: 24h=${report.comparison.positiveCount24h}, 48h=${report.comparison.positiveCount48h}`,
    `- Target random reset count: ${report.comparison.targetResetCount}`,
    "",
    "## Manual review gate",
    "",
    `- Auto publish: ${report.gate.autoPublish}`,
    `- Manual review only: ${report.gate.manualReviewOnly}`,
    `- Target resets: ${report.gate.targetResetCount}/${report.gate.thresholds.targetResetCount}`,
    `- Resolved daily 24h: ${report.gate.resolvedDaily24h}/${report.gate.thresholds.resolvedDaily24h}`,
    `- Resolved daily 48h: ${report.gate.resolvedDaily48h}/${report.gate.thresholds.resolvedDaily48h}`,
    `- Eligible for manual review: ${report.gate.eligibleForManualReview}`,
    "",
    "## Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function writePublishedProspectiveReports(
  report: PublishedProspectiveEvaluationReport,
  reportsDirectory = join(process.cwd(), "reports"),
) {
  mkdirSync(reportsDirectory, { recursive: true });
  writeFileSync(
    join(reportsDirectory, "prospective-published-model-evaluation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(reportsDirectory, "prospective-published-model-evaluation.md"),
    writeMarkdown(report),
    "utf8",
  );
}

async function main() {
  loadOptionalLocalEnv();
  const asOf = parseAsOf(process.argv.slice(2));
  const history = await loadPredictionHistoryRows();
  const formalTiboResets = await loadFormalTiboResets();
  const events: Array<ShadowResetEvent> = getShadowCompletedResetEvents(
    { formal_tibo_resets: formalTiboResets },
    asOf,
    LOCAL_RESET_HISTORY,
  );
  const baseReport = evaluatePublishedModelProspectively(history.rows, events, asOf);
  const availabilityReason = baseReport.forecastCounts.comparable === 0
    ? history.reason?.includes("environment")
      ? history.reason
      : history.reason?.includes("query")
        ? history.reason
        : "No prediction_history rows contain both the published hazard-elapsed-v1 and h30-r3 forecasts yet."
    : null;
  const report = availabilityReason
    ? {
        ...baseReport,
        notes: [...baseReport.notes, `Data availability: ${availabilityReason}`],
      }
    : baseReport;
  writePublishedProspectiveReports(report);
  console.log(JSON.stringify({
    status: report.status,
    evaluationStartAt: report.evaluationStartAt,
    activeModelVersion: report.activeModelVersion,
    baselineModelVersion: report.baselineModelVersion,
    savedActiveForecasts: report.forecastCounts.active,
    savedBaselineForecasts: report.forecastCounts.baseline,
    comparableForecastRows: report.forecastCounts.comparable,
    resolved24h: report.comparison.resolved24h,
    resolved48h: report.comparison.resolved48h,
    targetResetCount: report.comparison.targetResetCount,
  }, null, 2));
}

if (basename(process.argv[1] ?? "") === "evaluatePublishedModelProspectively.ts") {
  void main();
}
