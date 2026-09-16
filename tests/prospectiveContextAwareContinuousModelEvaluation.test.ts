import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import {
  evaluateContextAwareContinuousModelProspectively,
  selectComparableContextAwareForecasts,
} from "../lib/radar/prospectiveContextAwareContinuousModelEvaluation";
import type { ProspectiveForecastRow } from "../lib/radar/prospectiveProbabilityEvaluation";

function candidate(
  generatedAt: string,
  probability24h: number,
  probability48h: number,
  contextState: "none" | "weak" | "strong" | "unknown" = "none",
): ProspectiveForecastRow["forecasts"][string] {
  return {
    modelVersion: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
    generatedAt,
    probability24h,
    probability48h,
    contextAware: {
      contextSnapshotVersion: "v1",
      contextState,
      contextStateProvenance: "saved-feature-snapshot",
      trainingEligible: contextState !== "unknown",
      contextExclusionReason: contextState === "unknown" ? "unknown_context" : null,
      baselineProbability24h: 0.2,
      baselineProbability48h: 0.4,
      contextAdjustedProbability24h: probability24h,
      contextAdjustedProbability48h: probability48h,
      alpha24h: 0,
      alpha48h: 0,
      betaWeak24h: 0,
      betaWeak48h: 0,
      betaStrong24h: 0,
      betaStrong48h: 0,
      trainingSampleCount24h: 10,
      trainingSampleCount48h: 10,
      positiveTrainingCount24h: 2,
      positiveTrainingCount48h: 3,
      noneSampleCount24h: contextState === "none" ? 10 : 0,
      noneSampleCount48h: contextState === "none" ? 10 : 0,
      nonePositiveCount24h: contextState === "none" ? 2 : 0,
      nonePositiveCount48h: contextState === "none" ? 3 : 0,
      weakSampleCount24h: contextState === "weak" ? 10 : 0,
      weakSampleCount48h: contextState === "weak" ? 10 : 0,
      weakPositiveCount24h: contextState === "weak" ? 5 : 0,
      weakPositiveCount48h: contextState === "weak" ? 6 : 0,
      strongSampleCount24h: contextState === "strong" ? 10 : 0,
      strongSampleCount48h: contextState === "strong" ? 10 : 0,
      strongPositiveCount24h: contextState === "strong" ? 5 : 0,
      strongPositiveCount48h: contextState === "strong" ? 6 : 0,
      lastResolvedOrigin24h: generatedAt,
      lastResolvedOrigin48h: generatedAt,
      excludedTrainingRowCount24h: 0,
      excludedTrainingRowCount48h: 0,
      excludedTrainingReasons24h: {},
      excludedTrainingReasons48h: {},
      priorStdDev: 0.5,
      minimumSamples: 10,
      fitFallbackUsed: false,
      fitFallbackReason: null,
      trainingReadStatus: "ok",
      horizonCoherenceAdjusted: false,
      officialNoticeOverride: false,
      ordinarySemanticSignalsApplied: false,
      underlyingModelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
      bandwidthHours: 18,
      truncationHours: 54,
    },
  };
}

function challenger(generatedAt: string, probability24h = 0.25, probability48h = 0.45) {
  return {
    modelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    generatedAt,
    probability24h,
    probability48h,
    baseline24h: 0.2,
    baseline48h: 0.4,
  };
}

function row(generatedAt: string, state: "none" | "weak" | "strong" | "unknown" = "none") {
  return {
    generatedAt,
    loggedHour: generatedAt,
    forecasts: {
      [CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION]: candidate(generatedAt, 0.2, 0.4, state),
      [RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION]: challenger(generatedAt),
    },
  };
}

test("context-aware evaluator uses the same-origin candidate, age baseline, and challenger", () => {
  const rows = [
    row("2026-09-17T00:00:00.000Z", "none"),
    row("2026-09-18T00:00:00.000Z", "weak"),
    row("2026-09-19T00:00:00.000Z", "strong"),
    row("2026-09-20T00:00:00.000Z", "unknown"),
  ];
  const report = evaluateContextAwareContinuousModelProspectively(
    rows,
    [
      {
        id: "random-1",
        resetAt: "2026-09-17T12:00:00.000Z",
        isRandom: true,
        isRegular: false,
        sourceIds: [],
      },
    ],
    new Date("2026-09-22T00:00:00.000Z"),
  );

  assert.equal(report.status, "insufficient_data");
  assert.equal(report.forecastCounts.candidate, 4);
  assert.equal(report.forecastCounts.challenger, 4);
  assert.equal(report.forecastCounts.comparable, 4);
  assert.equal(report.models.candidate.metrics24h.count, 4);
  assert.equal(report.models.ageOnly.metrics24h.count, 4);
  assert.equal(report.models.challenger.metrics24h.count, 4);
  assert.equal(report.models.candidate.metrics24h.positiveCount, 1);
  assert.equal(report.contextSegments.none.metrics24h.count, 1);
  assert.equal(report.contextSegments.weak.metrics24h.count, 1);
  assert.equal(report.contextSegments.strong.metrics24h.count, 1);
  assert.equal(report.contextSegments.unknown.metrics24h.count, 1);
  assert.equal(report.comparison.candidateMinusAgeOnly.brier24h, 0);
  assert.ok(Number.isFinite(report.comparison.candidateMinusChallenger.brier24h));
  assert.equal(report.gate.autoPublish, false);
  assert.equal(report.gate.manualReviewOnly, true);
  assert.equal(report.backfilled, false);
});

test("context-aware evaluator excludes pre-freeze rows and requires shared origin timestamps", () => {
  const beforeFreeze = new Date(Date.parse(CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT) - 1).toISOString();
  const afterFreeze = new Date(Date.parse(CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT) + 60_000).toISOString();
  const mismatched = row(afterFreeze);
  mismatched.forecasts[RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION] = challenger(
    new Date(Date.parse(afterFreeze) + 60_000).toISOString(),
  );
  const invalidProvenance = row(afterFreeze);
  const invalidCandidate = invalidProvenance.forecasts[
    CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION
  ] as Record<string, unknown>;
  (invalidCandidate.contextAware as Record<string, unknown>).contextStateProvenance = "untrusted";
  const comparable = selectComparableContextAwareForecasts([
    row(beforeFreeze),
    mismatched,
    invalidProvenance,
    row("2026-09-17T00:00:00.000Z"),
  ]);

  assert.deepEqual(comparable.map((item) => item.generatedAt), ["2026-09-17T00:00:00.000Z"]);
});
