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

test("Shadow values stay aligned across DTO, UI, and history fields", () => {
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
    probability12h: number;
    probability24h: number;
    probability48h: number;
    probability72h: number;
  };

  assert.equal(published.source, "shadow");
  assert.ok(published.shadow);
  assert.equal(published.adoptedModel, "hazard-odds-v2-random-only");
  assert.equal(published.fallbackReason, null);
  assert.equal(published.probability12h, 0.13102489061598874);
  assert.equal(published.probability24h, 0.2529165872411576);
  assert.equal(published.probability48h, 0.44490264967436377);
  assert.equal(published.probability72h, 0.557507536423617);
  assert.equal(published.probability72h, published.shadow?.predictions.probability72h);
  assert.equal(viewModel.probability24h, published.probability24h);
  assert.equal(viewModel.probability48h, published.probability48h);
  assert.equal(viewModel.probability12h, published.probability12h);
  assert.equal(viewModel.probability72h, published.probability72h);
  assert.ok(published.probability12h <= published.probability24h);
  assert.equal(snapshot.viewModel.probability24h, published.probability24h);
  assert.equal(snapshot.viewModel.probability48h, published.probability48h);
  assert.equal(snapshot.viewModel.probability12h, published.probability12h);
  assert.equal(snapshot.viewModel.probability72h, published.probability72h);
  assert.equal(publishedDebug.version, "hazard-odds-v2-random-only");
  assert.equal(publishedDebug.source, "shadow");
  assert.equal(publishedDebug.probability12h, snapshot.viewModel.probability12h);
  assert.equal(publishedDebug.probability24h, snapshot.viewModel.probability24h);
  assert.equal(publishedDebug.probability48h, snapshot.viewModel.probability48h);
  assert.equal(publishedDebug.probability72h, snapshot.viewModel.probability72h);
  assert.match(html, new RegExp(probabilityToPercent(published.probability24h, "ja")));
  assert.match(html, new RegExp(probabilityToPercent(published.probability48h, "ja")));
  assert.ok(published.probability24h <= published.probability48h);
  assert.ok(published.probability48h <= published.probability72h);
 });

test("valid Shadow values are adopted at every confidence level", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const primary = getLocalProbabilityCalculation(data, { now: NOW });
  const shadow = calculatePublishedProbability(data, { now: NOW }, { logFallback: false }).shadow;
  assert.ok(shadow);

  for (const level of ["low", "medium", "high"] as const) {
    const selected = selectPublishedProbability(primary, {
      ...shadow,
      confidence: {
        ...shadow.confidence,
        level,
      },
      predictions: {
        probability12h: 0.09,
        probability24h: 0.18,
        probability48h: 0.31,
        probability72h: 0.45,
      },
    });

    assert.equal(selected.source, "shadow");
    assert.equal(selected.adoptedModel, "hazard-odds-v2-random-only");
    assert.equal(selected.fallbackReason, null);
    assert.equal(selected.probability24h, 0.18);
    assert.equal(selected.probability48h, 0.31);
    assert.equal(selected.probability12h, 0.09);
    assert.equal(selected.probability72h, 0.45);
  }
});

test("valid low-confidence Shadow values do not emit a fallback warning", () => {
  const originalWarn = console.warn;
  let warningCount = 0;
  console.warn = () => {
    warningCount += 1;
  };

  try {
    const published = calculatePublishedProbability(
      getLocalRadarData({ calculationNow: NOW }),
      { now: NOW },
    );

    assert.equal(published.source, "shadow");
    assert.equal(published.fallbackReason, null);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warningCount, 0);
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
  assert.equal(published.probability12h, 1 - Math.pow(1 - 0.9, 12 / 24));
  assert.equal(published.probability72h, 1 - Math.pow(1 - 0.96, 72 / 48));
  assert.ok(published.probability12h <= published.probability24h);
  assert.equal(snapshot.viewModel.probability24h, 0.9);
  assert.equal(snapshot.viewModel.probability48h, 0.96);
  assert.equal(snapshot.viewModel.probability12h, published.probability12h);
  assert.equal(snapshot.viewModel.probability72h, published.probability72h);
});

test("invalid Shadow predictions fall back to the old heuristic model", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const primary = getLocalProbabilityCalculation(data, { now: NOW });
  const validShadow = calculatePublishedProbability(data, { now: NOW }).shadow;
  assert.ok(validShadow);

  for (const predictions of [
    { probability12h: 0.1, probability24h: Number.NaN, probability48h: 0.4, probability72h: 0.5 },
    { probability12h: 0.1, probability24h: -0.01, probability48h: 0.4, probability72h: 0.5 },
    { probability12h: 0.1, probability24h: 0.8, probability48h: 1.01, probability72h: 1.01 },
    { probability12h: 0.7, probability24h: 0.8, probability48h: 0.3, probability72h: 0.5 },
    { probability12h: 0.3, probability24h: 0.2, probability48h: 0.4, probability72h: 0.5 },
    { probability12h: 0.1, probability24h: 0.2, probability48h: 0.4, probability72h: Number.NaN },
    { probability12h: 0.1, probability24h: 0.2, probability48h: 0.6, probability72h: 0.5 },
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
    assert.equal(selected.probability12h, 1 - Math.pow(1 - primary.probability24h, 12 / 24));
    assert.equal(selected.probability72h, 1 - Math.pow(1 - primary.probability48h, 72 / 48));
  }

  const exceptionFallback = selectPublishedProbability(primary, null, "shadow_exception");
  assert.equal(exceptionFallback.source, "heuristic-fallback");
  assert.equal(exceptionFallback.fallbackReason, "shadow_exception");

  const lowConfidence = selectPublishedProbability(primary, {
    ...validShadow,
    confidence: {
      ...validShadow.confidence,
      level: "low",
    },
  });
  assert.equal(lowConfidence.source, "shadow");
  assert.equal(lowConfidence.fallbackReason, null);
});

test("public probability fields stay aligned in Japanese, English, and Chinese", () => {
  const data = getLocalRadarData({ calculationNow: NOW });

  for (const locale of ["ja", "en", "zh"] as const) {
    const snapshot = toPublicRadarSnapshot(data, locale, { calculationNow: NOW });
    const viewModel = getRadarViewModel(data, locale, true, undefined, NOW);

    assert.equal(snapshot.viewModel.probability24h, viewModel.probability24h);
    assert.equal(snapshot.viewModel.probability48h, viewModel.probability48h);
    assert.equal(snapshot.viewModel.probability12h, viewModel.probability12h);
    assert.equal(snapshot.viewModel.probability72h, viewModel.probability72h);
    assert.equal(snapshot.viewModel.expectation, viewModel.expectation);
    assert.equal("reasoningSummary" in snapshot.viewModel, false);
    assert.equal("action" in snapshot.viewModel, false);
    assert.doesNotMatch(JSON.stringify(snapshot), /hazard-odds-v2-random-only|publishedProbabilityModel|基礎確率|観測シグナルで補正/);
  }
});
