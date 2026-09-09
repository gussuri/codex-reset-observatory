import assert from "node:assert/strict";
import test from "node:test";

import {
  PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
  PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION,
  PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS,
  buildSavedArtifactHybridForecast,
  evaluatePublishedModelProspectively,
  formatPublishedProspectiveMetric,
  selectComparablePublishedForecasts,
  selectDailyFirstPublishedForecasts,
  type PublishedProspectiveEvaluationReport,
} from "../lib/radar/prospectivePublishedModelEvaluation";
import {
  NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION,
  NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION,
  NEXT_GENERATION_V3_MODEL_VERSION,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import type { ProspectiveForecastRow } from "../lib/radar/prospectiveProbabilityEvaluation";
import { parsePredictionHistoryRows } from "../scripts/evaluateProspectiveProbabilityForecasts";

function forecastRow(
  generatedAt: string,
  activeProbability24h = 0.2,
  activeProbability48h = 0.4,
  baselineProbability24h = 0.25,
  baselineProbability48h = 0.45,
  includeActive = true,
  includeBaseline = true,
): ProspectiveForecastRow {
  const forecasts: ProspectiveForecastRow["forecasts"] = {};
  if (includeActive) {
    forecasts[PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION] = {
      modelVersion: PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
      generatedAt,
      probability24h: activeProbability24h,
      probability48h: activeProbability48h,
    };
  }
  if (includeBaseline) {
    forecasts[PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION] = {
      modelVersion: PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION,
      generatedAt,
      probability24h: baselineProbability24h,
      probability48h: baselineProbability48h,
    };
  }
  const active = forecasts[PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION];
  if (active) {
    active.rawProbability24h = activeProbability24h;
    active.rawProbability48h = activeProbability48h;
  }
  return { generatedAt, loggedHour: generatedAt, forecasts };
}

function hybridForecast(generatedAt: string, probability24h = 0.3, probability48h = 0.55) {
  return {
    modelVersion: NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION,
    generatedAt,
    probability24h,
    probability48h,
  };
}

function withSavedPostResetMetadata(
  row: ProspectiveForecastRow,
  resetAt: string,
  elapsedHours: number,
) {
  for (const forecast of Object.values(row.forecasts)) {
    forecast.latestRandomResetAt = resetAt;
    forecast.elapsedHoursSinceRandom = elapsedHours;
    forecast.randomElapsedHours = elapsedHours;
  }
  return row;
}

function emptyReport(rows: ProspectiveForecastRow[] = []) {
  return evaluatePublishedModelProspectively(rows, [], new Date("2026-08-05T00:00:00.000Z"), { adoptionAt: null });
}

test("published prospective evaluation uses selective hybrid v3 after its boundary and v2 as the baseline", () => {
  assert.equal(PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION, PUBLISHED_PROBABILITY_MODEL_VERSION);
  assert.equal(PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION, NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION);
  assert.equal(PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION, PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION);
  assert.equal(PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION, NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION);
});

test("published metric formatting includes bias without breaking legacy metric callers", () => {
  const formatted = formatPublishedProspectiveMetric({
    count: 2,
    positiveCount: 1,
    actualRate: 0.5,
    averagePrediction: 0.6,
    bias: 0.1,
    brier: 0.04,
    logLoss: 0.2,
    targetResetCount: 1,
  });
  assert.match(formatted, /bias=0\.1000/);
  assert.doesNotThrow(() => formatPublishedProspectiveMetric({
    count: 0,
    positiveCount: 0,
    actualRate: 0,
    averagePrediction: 0,
    brier: 0,
    logLoss: 0,
    targetResetCount: 0,
  }));
});

test("saved-artifact hybrid uses raw 24h and saved calibrated 48h", () => {
  const generatedAt = "2026-09-01T00:00:00.000Z";
  const savedV2 = {
    modelVersion: PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
    generatedAt,
    rawProbability24h: 0.2,
    rawProbability48h: 0.4,
    probability24h: 0.3,
    probability48h: 0.6,
    alpha24h: Math.log(0.3 / 0.7) - Math.log(0.2 / 0.8),
    alpha48h: Math.log(0.6 / 0.4) - Math.log(0.4 / 0.6),
    officialNoticeOverride: false,
    horizonCoherenceAdjusted: false,
  };

  const result = buildSavedArtifactHybridForecast(savedV2);

  assert.equal(result.forecast.probability24h, savedV2.rawProbability24h);
  assert.equal(result.forecast.probability48h, savedV2.probability48h);
  assert.equal(result.audit.calibration24h, "match");
  assert.equal(result.audit.calibration48h, "match");
  assert.equal(result.audit.coherenceAdjusted, false);
  assert.equal(result.forecast.savedArtifactCounterfactual, true);
});

test("saved-artifact hybrid preserves official notice final values and audits unexplained overlays", () => {
  const notice = buildSavedArtifactHybridForecast({
    modelVersion: PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
    generatedAt: "2026-09-02T00:00:00.000Z",
    rawProbability24h: 0.2,
    rawProbability48h: 0.4,
    probability24h: 0.9,
    probability48h: 0.96,
    alpha24h: 0,
    alpha48h: 0,
    officialNoticeOverride: true,
    horizonCoherenceAdjusted: false,
  });
  assert.equal(notice.forecast.probability24h, 0.9);
  assert.equal(notice.forecast.probability48h, 0.96);
  assert.equal(notice.audit.finalMismatchExplanation24h, "official-notice");
  assert.equal(notice.audit.finalMismatchExplanation48h, "official-notice");

  const nonNoticeMismatch = buildSavedArtifactHybridForecast({
    modelVersion: PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
    generatedAt: "2026-09-03T00:00:00.000Z",
    rawProbability24h: 0.2,
    rawProbability48h: 0.4,
    probability24h: 0.8,
    probability48h: 0.6,
    alpha24h: 0,
    alpha48h: 0,
    officialNoticeOverride: false,
    horizonCoherenceAdjusted: false,
  });
  assert.equal(nonNoticeMismatch.forecast.probability24h, 0.2);
  assert.equal(nonNoticeMismatch.audit.finalMismatchExplanation24h, "unexplained");
});

test("saved-artifact hybrid applies horizon coherence only when candidate 24h exceeds saved 48h", () => {
  const result = buildSavedArtifactHybridForecast({
    modelVersion: PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
    generatedAt: "2026-09-04T00:00:00.000Z",
    rawProbability24h: 0.8,
    rawProbability48h: 0.4,
    probability24h: 0.7,
    probability48h: 0.7,
    alpha24h: 0,
    alpha48h: 0,
    officialNoticeOverride: false,
    horizonCoherenceAdjusted: false,
  });

  assert.equal(result.forecast.probability24h, 0.8);
  assert.equal(result.forecast.probability48h, 0.8);
  assert.equal(result.audit.coherenceAdjusted, true);
  assert.equal(result.audit.finalMismatchExplanation48h, "unexplained");
});

test("primary prospective gate thresholds remain unchanged", () => {
  assert.deepEqual(PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS, {
    targetResetCount: 5,
    resolvedDaily24h: 20,
    resolvedDaily48h: 15,
    maxLogLossWorsening: 0.05,
  });
});

test("only rows containing both published models are comparable and evaluation starts there", () => {
  const prePublished = forecastRow(
    "2026-07-31T00:00:00.000Z",
    0.1,
    0.2,
    0.15,
    0.3,
    false,
    true,
  );
  const firstComparable = forecastRow("2026-08-01T00:00:00.000Z");
  const nextDay = forecastRow("2026-08-02T00:00:00.000Z");

  assert.deepEqual(
    selectComparablePublishedForecasts([prePublished, firstComparable, nextDay])
      .map((row) => row.generatedAt),
    [firstComparable.generatedAt, nextDay.generatedAt],
  );
  const report = emptyReport([prePublished, firstComparable, nextDay]);
  assert.equal(report.evaluationStartAt, firstComparable.generatedAt);
  assert.deepEqual(report.forecastCounts, { active: 2, baseline: 3, comparable: 2 });
  assert.equal(report.backfilled, false);
  assert.equal(report.gate.autoPublish, false);
});

test("selects the first comparable forecast by Asia/Tokyo calendar day", () => {
  const selected = selectDailyFirstPublishedForecasts([
    forecastRow("2026-08-01T00:30:00.000Z"),
    forecastRow("2026-08-01T01:00:00.000Z"),
    forecastRow("2026-08-01T14:00:00.000Z"),
    forecastRow("2026-08-02T00:01:00.000Z"),
  ]);

  assert.deepEqual(selected.map((row) => row.generatedAt), [
    "2026-08-01T00:30:00.000Z",
    "2026-08-02T00:01:00.000Z",
  ]);
});

test("does not score unresolved horizons and treats only supplied random events as positives", () => {
  const rows = [
    forecastRow("2026-08-01T00:00:00.000Z", 0.2, 0.4, 0.25, 0.45),
    forecastRow("2026-08-02T00:00:00.000Z", 0.3, 0.5, 0.35, 0.55),
  ];
  const report = evaluatePublishedModelProspectively(
    rows,
    [{ id: "random-reset", resetAt: "2026-08-01T12:00:00.000Z" }],
    new Date("2026-08-02T12:00:00.000Z"),
    { adoptionAt: null },
  );

  assert.equal(report.comparison.resolved24h, 1);
  assert.equal(report.comparison.resolved48h, 0);
  assert.equal(report.comparison.positiveCount24h, 1);
  assert.equal(report.comparison.positiveCount48h, 0);
  assert.equal(report.comparison.targetResetCount, 1);
});

test("insufficient data is a normal report state and never enables automatic publication", () => {
  const report: PublishedProspectiveEvaluationReport = emptyReport();

  assert.equal(report.status, "insufficient_data");
  assert.equal(report.evaluationStartAt, null);
  assert.equal(report.comparison.resolved24h, 0);
  assert.equal(report.comparison.resolved48h, 0);
  assert.equal(report.comparison.targetResetCount, 0);
  assert.equal(report.gate.autoPublish, false);
  assert.equal(report.gate.manualReviewOnly, true);
  assert.ok(report.notes.some((note) => note.includes("never auto-publish")));
});

test("a forecast from the previous model set is not rewritten or compared", () => {
  const legacyOnly = forecastRow(
    "2026-08-01T00:00:00.000Z",
    0.1,
    0.2,
    0.15,
    0.3,
    false,
    false,
  );
  legacyOnly.forecasts["hazard-odds-v3-random-inclusive"] = {
    modelVersion: "hazard-odds-v3-random-inclusive",
    generatedAt: legacyOnly.generatedAt,
    probability24h: 0.4,
    probability48h: 0.6,
  };
  const report = emptyReport([legacyOnly]);

  assert.equal(report.evaluationStartAt, null);
  assert.equal(report.models.active.metrics24h.count, 0);
  assert.equal(report.models.baseline.metrics24h.count, 0);
});

test("a comparable forecast after asOf is excluded from the prospective start and scores", () => {
  const future = forecastRow("2026-08-06T00:00:00.000Z");
  const report = evaluatePublishedModelProspectively(
    [future],
    [],
    new Date("2026-08-05T00:00:00.000Z"),
    { adoptionAt: null },
  );

  assert.equal(report.evaluationStartAt, null);
  assert.equal(report.comparison.resolved24h, 0);
  assert.equal(report.comparison.resolved48h, 0);
});

test("pre-adoption forecast rows are not counted as public forecasts", () => {
  const adoptionAt = Date.parse("2026-09-01T01:04:00.000Z");
  const preAdoption = forecastRow(new Date(adoptionAt - 60_000).toISOString());
  const adopted = forecastRow(new Date(adoptionAt + 60_000).toISOString());
  const report = evaluatePublishedModelProspectively(
    [preAdoption, adopted],
    [],
    new Date("2026-09-01T03:00:00.000Z"),
    { adoptionAt: "2026-09-01T01:04:00.000Z" },
  );

  assert.deepEqual(report.forecastCounts, { active: 1, baseline: 1, comparable: 1 });
  assert.equal(report.evaluationStartAt, adopted.generatedAt);
});

test("post-reset diagnostic uses the first saved 0-24h origin per canonical reset", () => {
  const resetAt = "2026-09-08T12:00:00.000Z";
  const firstOrigin = withSavedPostResetMetadata(
    forecastRow("2026-09-08T18:00:00.000Z", 0.2, 0.3, 0.4, 0.5),
    resetAt,
    6,
  );
  const laterOrigin = withSavedPostResetMetadata(
    forecastRow("2026-09-08T20:00:00.000Z", 0.8, 0.7, 0.6, 0.5),
    resetAt,
    8,
  );
  const report = evaluatePublishedModelProspectively(
    [firstOrigin, laterOrigin],
    [
      { id: "reset-before-origin", resetAt },
      { id: "reset-after-origin", resetAt: "2026-09-09T12:00:00.000Z" },
    ],
    new Date("2026-09-09T18:00:00.000Z"),
    { adoptionAt: null },
  );

  assert.equal(report.postResetDiagnostic.allEligibleOriginCount, 2);
  assert.equal(report.postResetDiagnostic.representativeOriginCount, 1);
  assert.deepEqual(report.postResetDiagnostic.representativeOrigins, [{
    resetId: "reset-before-origin",
    resetAt,
    generatedAt: firstOrigin.generatedAt,
  }]);

  const metrics24 = report.postResetDiagnostic.metrics24h;
  assert.equal(metrics24.sampleCount, 1);
  assert.equal(metrics24.positiveCount, 1);
  assert.equal(metrics24.activeMeanPrediction, 0.2);
  assert.equal(metrics24.baselineMeanPrediction, 0.4);
  assert.ok(Math.abs((metrics24.activeBrier ?? 0) - 0.64) < 1e-12);
  assert.ok(Math.abs((metrics24.baselineBrier ?? 0) - 0.36) < 1e-12);
  assert.ok(Math.abs((metrics24.brierDelta ?? 0) - 0.28) < 1e-12);
  assert.ok(Math.abs((metrics24.activeLogLoss ?? 0) - (-Math.log(0.2))) < 1e-12);
  assert.ok(Math.abs((metrics24.baselineLogLoss ?? 0) - (-Math.log(0.4))) < 1e-12);
  assert.ok(Math.abs((metrics24.logLossDelta ?? 0) - Math.log(2)) < 1e-12);
  assert.ok(Math.abs((metrics24.meanProbabilityDelta ?? 0) + 0.2) < 1e-12);

  assert.equal(report.postResetDiagnostic.metrics48h.sampleCount, 0);
  assert.equal(report.postResetDiagnostic.metrics48h.activeBrier, null);
  assert.equal(report.postResetDiagnostic.metrics48h.logLossDelta, null);
});

test("post-reset diagnostic requires saved metadata, positive age, and both models", () => {
  const resetAt = "2026-09-08T00:00:00.000Z";
  const ageZero = withSavedPostResetMetadata(
    forecastRow("2026-09-08T00:00:00.000Z"),
    resetAt,
    0,
  );
  const ageTooOld = withSavedPostResetMetadata(
    forecastRow("2026-09-09T01:00:00.000Z"),
    resetAt,
    25,
  );
  const missingMetadata = forecastRow("2026-09-08T06:00:00.000Z");
  const missingBaseline = withSavedPostResetMetadata(
    forecastRow("2026-09-08T07:00:00.000Z", 0.2, 0.3, 0.4, 0.5, true, false),
    resetAt,
    7,
  );
  const validAtBoundary = withSavedPostResetMetadata(
    forecastRow("2026-09-09T00:00:00.000Z"),
    resetAt,
    24,
  );
  const report = evaluatePublishedModelProspectively(
    [ageZero, ageTooOld, missingMetadata, missingBaseline, validAtBoundary],
    [{ id: "reset", resetAt }],
    new Date("2026-09-10T00:00:00.000Z"),
    { adoptionAt: null },
  );

  assert.equal(report.postResetDiagnostic.allEligibleOriginCount, 1);
  assert.equal(report.postResetDiagnostic.representativeOriginCount, 1);
  assert.equal(report.postResetDiagnostic.representativeOrigins[0]?.generatedAt, validAtBoundary.generatedAt);
});

test("secondary post-reset diagnostics never change primary gate or status", () => {
  const row = forecastRow("2026-08-01T00:00:00.000Z");
  const withMetadata = withSavedPostResetMetadata(row, "2026-07-31T18:00:00.000Z", 6);
  const withoutMetadata = forecastRow("2026-08-01T00:00:00.000Z");
  const events = [{ id: "reset", resetAt: "2026-07-31T18:00:00.000Z" }];
  const diagnosticReport = evaluatePublishedModelProspectively(
    [withMetadata],
    events,
    new Date("2026-08-02T00:00:00.000Z"),
    { adoptionAt: null },
  );
  const primaryOnlyReport = evaluatePublishedModelProspectively(
    [withoutMetadata],
    events,
    new Date("2026-08-02T00:00:00.000Z"),
    { adoptionAt: null },
  );

  assert.equal(diagnosticReport.status, primaryOnlyReport.status);
  assert.deepEqual(diagnosticReport.comparison, primaryOnlyReport.comparison);
  assert.deepEqual(diagnosticReport.models, primaryOnlyReport.models);
  assert.deepEqual(diagnosticReport.gate, primaryOnlyReport.gate);
});

test("unified model comparison uses the same daily origins and reads final displayed probabilities from the saved row", () => {
  const generatedAt = "2026-09-01T00:00:00.000Z";
  const row = forecastRow(generatedAt, 0.6, 0.7, 0.4, 0.5);
  row.finalDisplayed = {
    modelVersion: "published-final-displayed",
    generatedAt,
    probability24h: 0.12,
    probability48h: 0.24,
  };
  const report = evaluatePublishedModelProspectively(
    [row],
    [],
    new Date("2026-09-04T00:00:00.000Z"),
    {
      adoptionAt: null,
      v3Forecasts: {
        [generatedAt]: {
          modelVersion: NEXT_GENERATION_V3_MODEL_VERSION,
          generatedAt,
          probability24h: 0.2,
          probability48h: 0.3,
        },
      },
      hybridForecasts: {
        [generatedAt]: hybridForecast(generatedAt),
      },
    },
  );

  assert.equal(report.unifiedComparison.originCount, 1);
  assert.deepEqual(report.unifiedComparison.origins, [generatedAt]);
  assert.equal(report.unifiedComparison.series.finalDisplayed.metrics24h.averagePrediction, 0.12);
  assert.equal(report.unifiedComparison.series.v3.metrics24h.averagePrediction, 0.2);
  assert.equal(report.unifiedComparison.series.hybrid.metrics24h.averagePrediction, 0.3);
  assert.equal(report.unifiedComparison.series.currentV2.metrics24h.averagePrediction, 0.6);
  assert.equal(report.unifiedComparison.series.rawContinuous.metrics24h.averagePrediction, 0.6);
  assert.equal(report.unifiedComparison.series.v1.metrics24h.averagePrediction, 0.4);
  assert.equal(report.unifiedComparison.series.currentV2.metrics24h.count, 1);
  assert.equal(report.unifiedComparison.series.v3.metrics48h.count, 1);
  assert.equal(report.unifiedComparison.retrospectiveV3, true);
});

test("saved-artifact hybrid is primary while point-in-time replay remains diagnostic", () => {
  const generatedAt = "2026-09-01T00:00:00.000Z";
  const row = forecastRow(generatedAt, 0.3, 0.5, 0.4, 0.6);
  const savedV2 = row.forecasts[PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION];
  assert.ok(savedV2);
  savedV2.probability24h = 0.2;
  savedV2.probability48h = 0.4;
  savedV2.rawProbability24h = 0.2;
  savedV2.rawProbability48h = 0.4;
  savedV2.alpha24h = 0;
  savedV2.alpha48h = 0;
  savedV2.officialNoticeOverride = false;
  savedV2.horizonCoherenceAdjusted = false;
  row.finalDisplayed = {
    modelVersion: "published-final-displayed",
    generatedAt,
    probability24h: 0.12,
    probability48h: 0.24,
  };
  const savedArtifact = buildSavedArtifactHybridForecast(savedV2);
  const report = evaluatePublishedModelProspectively(
    [row],
    [],
    new Date("2026-09-04T00:00:00.000Z"),
    {
      adoptionAt: null,
      v3Forecasts: {
        [generatedAt]: {
          modelVersion: NEXT_GENERATION_V3_MODEL_VERSION,
          generatedAt,
          probability24h: 0.2,
          probability48h: 0.3,
        },
      },
      hybridForecasts: { [generatedAt]: savedArtifact.forecast },
      hybridReplayForecasts: { [generatedAt]: hybridForecast(generatedAt, 0.8, 0.9) },
      savedArtifactHybridAudits: { [generatedAt]: savedArtifact.audit },
    },
  );

  assert.equal(report.unifiedComparison.series.hybrid.metrics24h.averagePrediction, 0.2);
  assert.equal(report.unifiedComparison.hybridReplay?.metrics24h.averagePrediction, 0.8);
  assert.equal(report.unifiedComparison.savedArtifactHybridAudit.origins.length, 1);
  assert.deepEqual(report.unifiedComparison.savedArtifactHybridAudit.originsWithUnexplainedSavedFinalMismatch, []);
});

test("unified comparison reports per-origin hybrid and uncalibrated contributions", () => {
  const generatedAt = "2026-09-01T00:00:00.000Z";
  const row = forecastRow(generatedAt, 0.6, 0.7, 0.4, 0.5);
  const active = row.forecasts[PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION];
  assert.ok(active);
  active.officialNoticeOverride = true;
  active.latestRandomResetAt = "2026-08-31T12:00:00.000Z";
  active.elapsedHoursSinceRandom = 12;
  row.finalDisplayed = {
    modelVersion: "published-final-displayed",
    generatedAt,
    probability24h: 0.12,
    probability48h: 0.24,
    finalDisplaySpecialOverlay: false,
  };
  const report = evaluatePublishedModelProspectively(
    [row],
    [{ id: "reset", resetAt: "2026-09-01T12:00:00.000Z" }],
    new Date("2026-09-04T00:00:00.000Z"),
    {
      adoptionAt: null,
      v3Forecasts: {
        [generatedAt]: {
          modelVersion: NEXT_GENERATION_V3_MODEL_VERSION,
          generatedAt,
          probability24h: 0.2,
          probability48h: 0.3,
        },
      },
      hybridForecasts: {
        [generatedAt]: hybridForecast(generatedAt, 0.3, 0.55),
      },
    },
  );

  assert.equal(report.unifiedComparison.perOrigin.length, 1);
  const origin = report.unifiedComparison.perOrigin[0];
  assert.ok(origin);
  assert.equal(origin.origin, generatedAt);
  assert.deepEqual(origin.probabilities24h, { v2: 0.6, uncalibrated: 0.2, hybrid: 0.3 });
  assert.deepEqual(origin.probabilities48h, { v2: 0.7, uncalibrated: 0.3, hybrid: 0.55 });
  assert.equal(origin.actual24h, 1);
  assert.equal(origin.actual48h, 1);
  assert.equal(origin.brierContributions24h.v2, (0.6 - 1) ** 2);
  assert.equal(origin.brierContributions24h.uncalibrated, (0.2 - 1) ** 2);
  assert.equal(origin.brierContributions24h.hybrid, (0.3 - 1) ** 2);
  assert.equal(origin.brierContributions48h.v2, (0.7 - 1) ** 2);
  assert.equal(origin.brierContributions48h.uncalibrated, (0.3 - 1) ** 2);
  assert.equal(origin.brierContributions48h.hybrid, (0.55 - 1) ** 2);
  assert.equal(origin.officialNotice, true);
  assert.equal(origin.finalDisplayOverlay, false);
  assert.equal(origin.postReset0To24h, true);
});

test("unified comparison excludes unresolved horizons for every series", () => {
  const generatedAt = "2026-09-01T00:00:00.000Z";
  const row = forecastRow(generatedAt);
  row.finalDisplayed = {
    modelVersion: "published-final-displayed",
    generatedAt,
    probability24h: 0.12,
    probability48h: 0.24,
  };
  const report = evaluatePublishedModelProspectively(
    [row],
    [],
    new Date("2026-09-02T00:00:00.000Z"),
    {
      adoptionAt: null,
      v3Forecasts: {
        [generatedAt]: {
          modelVersion: NEXT_GENERATION_V3_MODEL_VERSION,
          generatedAt,
          probability24h: 0.2,
          probability48h: 0.3,
        },
      },
      hybridForecasts: {
        [generatedAt]: hybridForecast(generatedAt),
      },
    },
  );

  const series = Object.values(report.unifiedComparison.series);
  assert.ok(series.every((item) => item.metrics24h.count === 1));
  assert.ok(series.every((item) => item.metrics48h.count === 0));
});

test("unified comparison rejects a v1 forecast from a different saved origin", () => {
  const generatedAt = "2026-09-01T00:00:00.000Z";
  const row = forecastRow(generatedAt);
  const baseline = row.forecasts[PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION];
  assert.ok(baseline);
  baseline.generatedAt = "2026-09-02T00:00:00.000Z";
  row.finalDisplayed = {
    modelVersion: "published-final-displayed",
    generatedAt,
    probability24h: 0.12,
    probability48h: 0.24,
  };

  const report = evaluatePublishedModelProspectively(
    [row],
    [],
    new Date("2026-09-04T00:00:00.000Z"),
    {
      adoptionAt: null,
      v3Forecasts: {
        [generatedAt]: {
          modelVersion: NEXT_GENERATION_V3_MODEL_VERSION,
          generatedAt,
          probability24h: 0.2,
          probability48h: 0.3,
        },
      },
      hybridForecasts: {
        [generatedAt]: hybridForecast(generatedAt),
      },
    },
  );

  assert.equal(report.unifiedComparison.originCount, 0);
});

test("prediction history evaluation reads final displayed probabilities from top-level saved values", () => {
  const generatedAt = "2026-09-01T00:00:00.000Z";
  const parsed = parsePredictionHistoryRows([{
    logged_hour: generatedAt,
    probability_24h: 0.12,
    probability_48h: 0.24,
    debug_info: {
      calculated_at: generatedAt,
      publishedProbabilityModel: {
        majorModelReleaseAdjustment: { active: true },
      },
      experimentalProbabilityForecasts: {
        [PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION]: {
          modelVersion: PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
          generatedAt,
          probability24h: 0.6,
          probability48h: 0.7,
          rawProbability24h: 0.5,
          rawProbability48h: 0.6,
        },
        [PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION]: {
          modelVersion: PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION,
          generatedAt,
          probability24h: 0.4,
          probability48h: 0.5,
        },
      },
    },
  }]);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].finalDisplayed?.probability24h, 0.12);
  assert.equal(parsed[0].finalDisplayed?.probability48h, 0.24);
  assert.equal(parsed[0].finalDisplayed?.finalDisplaySpecialOverlay, true);
  assert.equal(parsed[0].forecasts[PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION]?.probability24h, 0.6);
});
