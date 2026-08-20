import assert from "node:assert/strict";
import test from "node:test";

import {
  PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
  PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION,
  evaluatePublishedModelProspectively,
  selectComparablePublishedForecasts,
  selectDailyFirstPublishedForecasts,
  type PublishedProspectiveEvaluationReport,
} from "../lib/radar/prospectivePublishedModelEvaluation";
import type { ProspectiveForecastRow } from "../lib/radar/prospectiveProbabilityEvaluation";

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
  return { generatedAt, loggedHour: generatedAt, forecasts };
}

function emptyReport(rows: ProspectiveForecastRow[] = []) {
  return evaluatePublishedModelProspectively(rows, [], new Date("2026-08-05T00:00:00.000Z"), { adoptionAt: null });
}

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

test("pre-adoption experimental v2 rows are not counted as public forecasts", () => {
  const preAdoption = forecastRow("2026-08-20T09:00:00.000Z");
  const adopted = forecastRow("2026-08-20T09:30:00.000Z");
  const report = evaluatePublishedModelProspectively(
    [preAdoption, adopted],
    [],
    new Date("2026-08-21T00:00:00.000Z"),
  );

  assert.deepEqual(report.forecastCounts, { active: 1, baseline: 1, comparable: 1 });
  assert.equal(report.evaluationStartAt, adopted.generatedAt);
});
