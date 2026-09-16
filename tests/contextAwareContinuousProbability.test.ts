import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MINIMUM_SAMPLES,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import { getLocalRadarData } from "../lib/radar";
import {
  applyContextAwareLogitAdjustment,
  calculateContextAwareContinuousProbability,
  fitContextAwareLogitMAP,
  getContextAwareFeatureVector,
  getContextAwareLogitAdjustment,
  resolveContextAwareContext,
  selectContextAwareTrainingRows,
  type ContextAwareCalibrationRow,
} from "../lib/radar/contextAwareContinuousProbability";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import type { ActiveOfficialNotice } from "../lib/radar/probability";

const NOW = new Date("2026-09-20T12:00:00.000Z");

function row(
  generatedAt: string,
  contextState: ContextAwareCalibrationRow["contextState"],
  actual24h: boolean | undefined = false,
  actual48h: boolean | undefined = false,
): ContextAwareCalibrationRow {
  return {
    generatedAt,
    baselineProbability24h: 0.2,
    baselineProbability48h: 0.35,
    contextState,
    actual24h,
    actual48h,
    trainingEligible: contextState !== "unknown",
    contextStateProvenance: contextState === "unknown" ? "unknown" : "saved-feature-snapshot",
  };
}

function trainingRows() {
  return Array.from({ length: 12 }, (_, index) => row(
    new Date(Date.parse("2026-08-25T00:00:00.000Z") + index * 24 * 60 * 60 * 1000).toISOString(),
    index % 3 === 0 ? "strong" : index % 3 === 1 ? "weak" : "none",
    index % 4 === 0,
    index % 5 === 0,
  ));
}

test("context feature states are mutually exclusive and alpha/selected beta are explicit", () => {
  assert.deepEqual(getContextAwareFeatureVector("none"), [1, 0, 0]);
  assert.deepEqual(getContextAwareFeatureVector("weak"), [1, 1, 0]);
  assert.deepEqual(getContextAwareFeatureVector("strong"), [1, 0, 1]);
  assert.deepEqual(getContextAwareFeatureVector("unknown"), [0, 0, 0]);

  const fit = fitContextAwareLogitMAP([
    ...Array.from({ length: 4 }, () => ({ probability: 0.2, actual: false, contextState: "none" as const })),
    ...Array.from({ length: 4 }, () => ({ probability: 0.2, actual: true, contextState: "weak" as const })),
    ...Array.from({ length: 4 }, () => ({ probability: 0.2, actual: true, contextState: "strong" as const })),
  ]);
  assert.equal(getContextAwareLogitAdjustment(fit, "none"), fit.alpha);
  assert.equal(getContextAwareLogitAdjustment(fit, "weak"), fit.alpha + fit.betaWeak);
  assert.equal(getContextAwareLogitAdjustment(fit, "strong"), fit.alpha + fit.betaStrong);
  assert.equal(getContextAwareLogitAdjustment(fit, "unknown"), 0);
  assert.ok(applyContextAwareLogitAdjustment(0.2, "weak", fit) > applyContextAwareLogitAdjustment(0.2, "none", fit));
});

test("training selection is PIT and daily-first, and never coerces unknown to none", () => {
  const selected = selectContextAwareTrainingRows([
    row("2026-08-25T00:00:00.000Z", "weak", true, true),
    row("2026-08-25T01:00:00.000Z", "strong", true, true),
    { ...row("2026-08-24T00:00:00.000Z", "none", true, true), contextStateProvenance: undefined },
    row("2026-08-26T00:00:00.000Z", "unknown", true, true),
    { ...row("2026-08-27T00:00:00.000Z", "none", true, true), trainingEligible: false, contextExclusionReason: "official_notice_active" },
    row("2026-09-19T00:00:00.000Z", "weak", true, true),
    row("2026-08-28T00:00:00.000Z", "none", undefined, true),
    row("2026-08-29T00:00:00.000Z", "none", true, undefined),
  ], NOW, 24);

  assert.deepEqual(selected.map((item) => item.generatedAt), [
    "2026-08-25T00:00:00.000Z",
    "2026-08-28T00:00:00.000Z",
    "2026-08-29T00:00:00.000Z",
    "2026-09-19T00:00:00.000Z",
  ]);
  assert.equal(selected.some((item) => item.contextState === "unknown"), false);
  assert.equal(selected.some((item) => item.contextExclusionReason === "official_notice_active"), false);
});

test("MAP fit is deterministic, regularized, and falls back below the minimum", () => {
  const samples = trainingRows().map((item) => ({
    probability: item.baselineProbability24h,
    actual: item.actual24h === true,
    contextState: item.contextState as "none" | "weak" | "strong",
  }));
  const first = fitContextAwareLogitMAP(samples);
  const second = fitContextAwareLogitMAP(samples);
  assert.deepEqual(first, second);
  assert.equal(first.fallbackUsed, false);
  assert.equal(first.sampleCount, 12);
  assert.ok([first.alpha, first.betaWeak, first.betaStrong].every(Number.isFinite));
  assert.ok(Math.abs(first.alpha) < 20);

  const fallback = fitContextAwareLogitMAP(samples.slice(0, CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MINIMUM_SAMPLES - 1));
  assert.equal(fallback.fallbackUsed, true);
  assert.equal(fallback.fallbackReason, "insufficient_training_samples");
  assert.deepEqual(
    [fallback.alpha, fallback.betaWeak, fallback.betaStrong],
    [0, 0, 0],
  );
});

test("point-in-time context excludes future teaser and status information", () => {
  const data = getLocalRadarData({
    calculationNow: NOW,
    activeTiboSignals: [{
      tweet_id: "future-teaser",
      signal_type: "teaser",
      teaser_strength: "strong",
      tweet_created_at: "2026-09-20T13:00:00.000Z",
      detected_at: "2026-09-20T13:01:00.000Z",
      expires_at: "2026-09-21T00:00:00.000Z",
    }],
  });
  const before = resolveContextAwareContext(data, new Date("2026-09-20T12:00:00.000Z"));
  assert.equal(before.contextState, "none");
  assert.equal(before.trainingEligible, true);

  const after = resolveContextAwareContext(data, new Date("2026-09-20T14:00:00.000Z"));
  assert.equal(after.contextState, "strong");
  assert.equal(after.trainingEligible, true);
});

test("unknown source data remains unknown and excluded rather than becoming none", () => {
  const resolved = resolveContextAwareContext(null, NOW);
  assert.equal(resolved.contextState, "unknown");
  assert.equal(resolved.trainingEligible, false);
  assert.equal(resolved.contextExclusionReason, "unknown_context");
});

test("candidate uses the fixed 18/54 baseline, derives horizons, and keeps official notice priority", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const result = calculateContextAwareContinuousProbability(data, {
    now: NOW,
    staticHistory: [],
    activeOfficialNotice: null,
    trainingRows: trainingRows(),
    trainingReadStatus: "ok",
  });
  assert.equal(result.modelVersion, CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION);
  assert.equal(result.underlyingModelVersion, RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION);
  assert.equal(result.bandwidthHours, 18);
  assert.equal(result.truncationHours, 54);
  assert.ok(result.predictions.probability48h >= result.predictions.probability24h);
  assert.ok(result.predictions.probability12h <= result.predictions.probability24h);
  assert.ok(result.predictions.probability72h >= result.predictions.probability48h);
  assert.equal(result.officialNoticeOverride.active, false);
  assert.ok(result.fit24h.sampleCount >= CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MINIMUM_SAMPLES);

  const notice: ActiveOfficialNotice = {
    origin: "local",
    id: "notice",
    title: "Reset notice",
    summary: "Reset notice",
    observedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    expectedAt: null,
    expectedEndAt: null,
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    source: null,
    sourceLabel: "test",
  };
  const noticeResult = calculateContextAwareContinuousProbability(data, {
    now: NOW,
    staticHistory: [],
    activeOfficialNotice: notice,
    trainingRows: trainingRows(),
    trainingReadStatus: "ok",
  });
  assert.equal(noticeResult.officialNoticeOverride.active, true);
  assert.equal(noticeResult.predictions.probability24h, 0.9);
  assert.equal(noticeResult.predictions.probability48h, 0.96);
});

test("training read failure is a safe age-only fallback and candidate audit is not public", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const result = calculateContextAwareContinuousProbability(getLocalRadarData({ calculationNow: now }), {
    now,
    staticHistory: [],
    activeOfficialNotice: null,
    trainingRows: [],
    trainingReadStatus: "error",
  });
  assert.equal(result.fit24h.fallbackUsed, true);
  assert.equal(result.fitFallbackReason, "prediction_history_training_query_failed");
  assert.equal(result.predictions.probability24h, result.baseline.probability24h);
  const serialized = JSON.stringify(toPublicRadarSnapshot(getLocalRadarData({ calculationNow: now }), "ja"));
  assert.equal(serialized.includes(CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION), false);
  assert.equal(serialized.includes("contextAware"), false);
});
