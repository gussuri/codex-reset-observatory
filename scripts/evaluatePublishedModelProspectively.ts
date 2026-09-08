import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import {
  getShadowCompletedResetEvents,
  type ShadowResetEvent,
} from "../lib/radar/shadowProbability";
import {
  evaluatePublishedModelProspectively,
  PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
  PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION,
  formatPublishedProspectiveMetric,
  type PublishedProspectiveEvaluationReport,
} from "../lib/radar/prospectivePublishedModelEvaluation";
import {
  loadProductionCanonicalRadarData,
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

function formatPostResetDiagnosticMetric(metric: PublishedProspectiveEvaluationReport["postResetDiagnostic"]["metrics24h"]) {
  const value = (number: number | null) => number === null ? "unavailable" : number.toFixed(4);
  return [
    `n=${metric.sampleCount}`,
    `positive=${metric.positiveCount}`,
    `activeMean=${value(metric.activeMeanPrediction)}`,
    `baselineMean=${value(metric.baselineMeanPrediction)}`,
    `activeBrier=${value(metric.activeBrier)}`,
    `baselineBrier=${value(metric.baselineBrier)}`,
    `brierDelta=${value(metric.brierDelta)}`,
    `activeLogLoss=${value(metric.activeLogLoss)}`,
    `baselineLogLoss=${value(metric.baselineLogLoss)}`,
    `logLossDelta=${value(metric.logLossDelta)}`,
    `meanProbabilityDelta=${value(metric.meanProbabilityDelta)}`,
  ].join(", ");
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
    "## Primary prospective evaluation",
    "",
    "### Canonical random reset truth",
    `- Post-adoption canonical random reset events: ${report.canonicalRandomResetEvents.length}`,
    ...(report.canonicalRandomResetEvents.length === 0
      ? ["- Events: none"]
      : report.canonicalRandomResetEvents.map((event) => `- ${event.id}: ${event.resetAt}`)),
    "",
    "### Daily first forecast comparison",
    "",
    `### ${report.activeModelVersion}`,
    `- 24h: ${formatPublishedProspectiveMetric(active24h)}`,
    `- 48h: ${formatPublishedProspectiveMetric(active48h)}`,
    "",
    `### ${report.baselineModelVersion}`,
    `- 24h: ${formatPublishedProspectiveMetric(baseline24h)}`,
    `- 48h: ${formatPublishedProspectiveMetric(baseline48h)}`,
    "",
    "### Active minus baseline",
    "",
    `- 24h Brier: ${report.comparison.activeMinusBaseline.brier24h ?? "unavailable"}`,
    `- 48h Brier: ${report.comparison.activeMinusBaseline.brier48h ?? "unavailable"}`,
    `- 24h Log loss: ${report.comparison.activeMinusBaseline.logLoss24h ?? "unavailable"}`,
    `- 48h Log loss: ${report.comparison.activeMinusBaseline.logLoss48h ?? "unavailable"}`,
    `- Resolved forecasts: 24h=${report.comparison.resolved24h}, 48h=${report.comparison.resolved48h}`,
    `- Positive forecasts: 24h=${report.comparison.positiveCount24h}, 48h=${report.comparison.positiveCount48h}`,
    `- Target random reset count: ${report.comparison.targetResetCount}`,
    "",
    "### Manual review gate",
    "",
    `- Auto publish: ${report.gate.autoPublish}`,
    `- Manual review only: ${report.gate.manualReviewOnly}`,
    `- Target resets: ${report.gate.targetResetCount}/${report.gate.thresholds.targetResetCount}`,
    `- Resolved daily 24h: ${report.gate.resolvedDaily24h}/${report.gate.thresholds.resolvedDaily24h}`,
    `- Resolved daily 48h: ${report.gate.resolvedDaily48h}/${report.gate.thresholds.resolvedDaily48h}`,
    `- Eligible for manual review: ${report.gate.eligibleForManualReview}`,
    "",
    "## Post-reset 0-24h diagnostic",
    "",
    "This is a separate descriptive diagnostic comparing the active post-reset-age model with the v1 baseline. It never affects the primary gate, status, manual-review eligibility, model selection, or publication.",
    `- All eligible saved origins: ${report.postResetDiagnostic.allEligibleOriginCount}`,
    `- Representative origins (first comparable origin per canonical reset): ${report.postResetDiagnostic.representativeOriginCount}`,
    ...(report.postResetDiagnostic.representativeOrigins.length === 0
      ? ["- Representative origins: none"]
      : report.postResetDiagnostic.representativeOrigins.map((origin) =>
        `- ${origin.resetId}: reset=${origin.resetAt}, forecast=${origin.generatedAt}`)),
    "",
    "### 24h",
    `- ${formatPostResetDiagnosticMetric(report.postResetDiagnostic.metrics24h)}`,
    "",
    "### 48h",
    `- ${formatPostResetDiagnosticMetric(report.postResetDiagnostic.metrics48h)}`,
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
  const production = await loadProductionCanonicalRadarData(asOf);
  const events: Array<ShadowResetEvent> = production.data
    ? getShadowCompletedResetEvents(production.data, asOf, LOCAL_RESET_HISTORY, {
        preserveDistinctCanonicalIds: true,
      })
    : [];
  const baseReport = evaluatePublishedModelProspectively(history.rows, events, asOf);
  const availabilityNotes: string[] = [];
  if (baseReport.forecastCounts.comparable === 0) {
    availabilityNotes.push(
      history.reason?.includes("environment") || history.reason?.includes("query")
        ? history.reason
        : `No prediction_history rows contain both the published ${PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION} and ${PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION} forecasts yet.`,
    );
  }
  if (production.reason) availabilityNotes.push(production.reason);
  const report = availabilityNotes.length > 0
    ? { ...baseReport, notes: [...baseReport.notes, ...availabilityNotes.map((note) => `Data availability: ${note}`)] }
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
    canonicalRandomResetEvents: report.canonicalRandomResetEvents,
    postResetDiagnostic: {
      allEligibleOriginCount: report.postResetDiagnostic.allEligibleOriginCount,
      representativeOriginCount: report.postResetDiagnostic.representativeOriginCount,
      metrics24hSampleCount: report.postResetDiagnostic.metrics24h.sampleCount,
      metrics48hSampleCount: report.postResetDiagnostic.metrics48h.sampleCount,
    },
  }, null, 2));
}

if (basename(process.argv[1] ?? "") === "evaluatePublishedModelProspectively.ts") {
  void main();
}
