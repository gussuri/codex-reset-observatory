import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RadarDashboard } from "../components/RadarDashboard";
import { getLocalRadarData, getRadarViewModel, probabilityToPercent } from "../lib/radar";
import { buildProbabilityDebugInfo } from "../lib/logProbability";
import { getLocalProbabilityCalculation } from "../lib/radar/probability";
import {
  calculatePublishedProbability,
  selectPublishedProbability,
} from "../lib/radar/publishedProbability";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const NOW = new Date("2026-08-04T00:00:00.000Z");

test("low-confidence Shadow values fall back consistently across DTO, UI, and history fields", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const viewModel = getRadarViewModel(data, "ja", false, undefined, NOW);
  const published = calculatePublishedProbability(data, {
    now: NOW,
    regularResetExpectedAt: viewModel.regularResetForecast.expectedAt,
  });
  const snapshot = toPublicRadarSnapshot(data, "ja", {
    calculationNow: NOW,
    limitHistory: false,
  });
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: snapshot,
      locale: "ja",
    }),
  );
  const debugInfo = buildProbabilityDebugInfo(
    {},
    published.primary,
    data.checked_at,
    NOW,
    published.shadow,
    published,
  );
  const publishedDebug = debugInfo.publishedProbabilityModel as {
    version: string;
    source: string;
    probability24h: number;
    probability48h: number;
  };

  assert.equal(published.source, "heuristic-fallback");
  assert.ok(published.shadow);
  assert.equal(viewModel.probability24h, published.probability24h);
  assert.equal(viewModel.probability48h, published.probability48h);
  assert.equal(snapshot.viewModel.probability24h, published.probability24h);
  assert.equal(snapshot.viewModel.probability48h, published.probability48h);
  assert.equal(publishedDebug.version, published.primary.modelVersion);
  assert.equal(publishedDebug.source, "heuristic-fallback");
  assert.equal(publishedDebug.probability24h, snapshot.viewModel.probability24h);
  assert.equal(publishedDebug.probability48h, snapshot.viewModel.probability48h);
  assert.match(html, new RegExp(probabilityToPercent(published.probability24h, "ja")));
  assert.match(html, new RegExp(probabilityToPercent(published.probability48h, "ja")));
 assert.ok(published.probability24h <= published.probability48h);
 });

test("medium-confidence Shadow values are adopted as the public model", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const primary = getLocalProbabilityCalculation(data, { now: NOW });
  const shadow = calculatePublishedProbability(data, { now: NOW }, { logFallback: false }).shadow;
  assert.ok(shadow);

  const selected = selectPublishedProbability(primary, {
    ...shadow,
    confidence: {
      ...shadow.confidence,
      level: "medium",
    },
    predictions: {
      probability24h: 0.18,
      probability48h: 0.31,
    },
  });

  assert.equal(selected.source, "shadow");
  assert.equal(selected.adoptedModel, "hazard-odds-v2-random-only");
  assert.equal(selected.fallbackReason, null);
  assert.equal(selected.probability24h, 0.18);
  assert.equal(selected.probability48h, 0.31);
});

test("official notice keeps the existing 90% and 96% override in the public model", () => {
  const data = getLocalRadarData({
    calculationNow: NOW,
    activeTiboSignals: [
      {
        tweet_id: "published-notice",
        signal_type: "official_notice",
        text: "A current official notice",
        tweet_created_at: "2026-08-03T12:00:00.000Z",
        expires_at: "2026-08-05T00:00:00.000Z",
        confidence: 0.98,
        verification_status: "auto_unverified",
      },
    ],
  });
  const published = calculatePublishedProbability(data, { now: NOW });
  const snapshot = toPublicRadarSnapshot(data, "en", { calculationNow: NOW });

  assert.equal(published.source, "shadow");
  assert.equal(published.probability24h, 0.9);
  assert.equal(published.probability48h, 0.96);
  assert.equal(snapshot.viewModel.probability24h, 0.9);
  assert.equal(snapshot.viewModel.probability48h, 0.96);
});

test("invalid Shadow predictions fall back to the old heuristic model", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const primary = getLocalProbabilityCalculation(data, { now: NOW });
  const validShadow = calculatePublishedProbability(data, { now: NOW }).shadow;
  assert.ok(validShadow);

  for (const predictions of [
    { probability24h: Number.NaN, probability48h: 0.4 },
    { probability24h: -0.01, probability48h: 0.4 },
    { probability24h: 0.8, probability48h: 1.01 },
    { probability24h: 0.8, probability48h: 0.3 },
  ]) {
    const selected = selectPublishedProbability(primary, {
      ...validShadow,
      predictions,
    });

    assert.equal(selected.source, "heuristic-fallback");
    assert.equal(selected.adoptedModel, primary.modelVersion);
    assert.equal(selected.fallbackReason, "shadow_invalid_prediction");
    assert.equal(selected.probability24h, primary.probability24h);
    assert.equal(selected.probability48h, primary.probability48h);
  }

  const exceptionFallback = selectPublishedProbability(primary, null, "shadow_exception");
  assert.equal(exceptionFallback.source, "heuristic-fallback");
  assert.equal(exceptionFallback.fallbackReason, "shadow_exception");

  const lowConfidence = selectPublishedProbability(primary, validShadow);
  assert.equal(lowConfidence.fallbackReason, "shadow_low_confidence");
});

test("public probability fields stay aligned in Japanese, English, and Chinese", () => {
  const data = getLocalRadarData({ calculationNow: NOW });

  for (const locale of ["ja", "en", "zh"] as const) {
    const snapshot = toPublicRadarSnapshot(data, locale, { calculationNow: NOW });
    const viewModel = getRadarViewModel(data, locale, true, undefined, NOW);

    assert.equal(snapshot.viewModel.probability24h, viewModel.probability24h);
    assert.equal(snapshot.viewModel.probability48h, viewModel.probability48h);
    assert.equal(snapshot.viewModel.expectation, viewModel.expectation);
    assert.equal("reasoningSummary" in snapshot.viewModel, false);
    assert.equal("action" in snapshot.viewModel, false);
    assert.doesNotMatch(JSON.stringify(snapshot), /hazard-odds-v2-random-only|publishedProbabilityModel|基礎確率|観測シグナルで補正/);
  }
});
