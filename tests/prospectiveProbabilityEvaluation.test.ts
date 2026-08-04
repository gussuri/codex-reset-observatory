import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateProspectiveProbabilityForecasts,
  getActualWithinHorizon,
  selectDailyFirstForecasts,
  type ProspectiveForecastRow,
} from "../lib/radar/prospectiveProbabilityEvaluation";

function forecastRow(
  loggedHour: string,
  generatedAt: string,
  probability24h = 0.2,
  probability48h = 0.4,
): ProspectiveForecastRow {
  return {
    loggedHour,
    generatedAt,
    forecasts: {
      "hazard-odds-v2-random-only": {
        modelVersion: "hazard-odds-v2-random-only",
        generatedAt,
        probability24h,
        probability48h,
      },
      "hazard-odds-v4-logit-calibrated-prequential-v1": {
        modelVersion: "hazard-odds-v4-logit-calibrated-prequential-v1",
        generatedAt,
        probability24h: Math.min(1, probability24h + 0.1),
        probability48h: Math.min(1, probability48h + 0.1),
      },
    },
  };
}

test("selects the first saved forecast for each JST calendar day", () => {
  const selected = selectDailyFirstForecasts([
    forecastRow("2026-08-01T00:30:00.000Z", "2026-08-01T00:30:00.000Z"),
    forecastRow("2026-08-01T01:00:00.000Z", "2026-08-01T01:00:00.000Z"),
    forecastRow("2026-08-01T15:00:00.000Z", "2026-08-01T15:00:00.000Z"),
    forecastRow("2026-08-02T00:01:00.000Z", "2026-08-02T00:01:00.000Z"),
  ]);

  assert.deepEqual(selected.map((row) => row.generatedAt), [
    "2026-08-01T00:30:00.000Z",
    "2026-08-01T15:00:00.000Z",
  ]);
});

test("horizon labels exclude simultaneous events and include the exact endpoint", () => {
  const event = { id: "reset", resetAt: "2026-08-02T00:00:00.000Z" };
  assert.equal(getActualWithinHorizon([event], "2026-08-02T00:00:00.000Z", 24), false);
  assert.equal(getActualWithinHorizon([event], "2026-08-01T00:00:00.000Z", 24), true);
  assert.equal(getActualWithinHorizon([event], "2026-08-01T00:00:00.000Z", 23), false);
});

test("prospective evaluation resolves only completed horizons and compares the same origins", () => {
  const asOf = new Date("2026-08-02T00:00:00.000Z");
  const report = evaluateProspectiveProbabilityForecasts(
    [
      forecastRow("2026-07-31T00:00:00.000Z", "2026-07-31T00:00:00.000Z", 0.1, 0.2),
      forecastRow("2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z", 0.3, 0.5),
      forecastRow("2026-08-02T00:00:00.000Z", "2026-08-02T00:00:00.000Z", 0.2, 0.4),
    ],
    [
      { id: "at-origin", resetAt: "2026-07-31T00:00:00.000Z" },
      { id: "within-24h", resetAt: "2026-08-01T00:00:00.000Z" },
      { id: "within-48h", resetAt: "2026-08-02T00:00:00.000Z" },
    ],
    asOf,
  );

  assert.equal(report.status, "insufficient_data");
  assert.equal(report.comparison.resolved24h, 2);
  assert.equal(report.comparison.resolved48h, 1);
  assert.equal(report.models.v2.metrics24h.count, 2);
  assert.equal(report.models.v4.metrics24h.count, 2);
  assert.equal(report.models.v2.metrics48h.count, 1);
  assert.equal(report.models.v4.metrics48h.count, 1);
  assert.equal(report.gate.autoPublish, false);
  assert.equal(report.gate.thresholds.targetResetCount, 5);
});

test("empty prospective history produces an insufficient-data report", () => {
  const report = evaluateProspectiveProbabilityForecasts(
    [],
    [],
    new Date("2026-08-04T00:00:00.000Z"),
  );

  assert.equal(report.status, "insufficient_data");
  assert.equal(report.models.v2.metrics24h.count, 0);
  assert.equal(report.models.v4.metrics48h.count, 0);
  assert.equal(report.comparison.targetResetCount, 0);
});
