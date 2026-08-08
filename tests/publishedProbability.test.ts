import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RadarDashboard } from "../components/RadarDashboard";
import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import { buildProbabilityDebugInfo } from "../lib/logProbability";
import { getLocalProbabilityCalculation } from "../lib/radar/probability";
import {
  calculatePublishedProbability,
  selectPublishedProbability,
} from "../lib/radar/publishedProbability";
import {
  LEGACY_SHADOW_PROBABILITY_MODEL_VERSION,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  PUBLISHED_RECENCY_HALF_LIFE_DAYS,
  SHADOW_PROBABILITY_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import {
  calculateShadowProbability,
  getShadowCompletedResetEvents,
  probabilityToOdds,
} from "../lib/radar/shadowProbability";
import { calculateRecencyWeightedShadowProbability } from "../lib/radar/recencyWeightedProbability";
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
  assert.equal(published.adoptedModel, PUBLISHED_PROBABILITY_MODEL_VERSION);
  assert.equal(published.fallbackReason, null);
  assert.equal(published.probability12h, 0.13090841139870835);
  assert.equal(published.probability24h, 0.24519376978467242);
  assert.equal(published.probability48h, 0.4361750242757559);
  assert.equal(published.probability72h, 0.5630471678283646);
  assert.equal(published.probability72h, published.shadow?.predictions.probability72h);
  const recency = calculateRecencyWeightedShadowProbability(
    data,
    PUBLISHED_RECENCY_HALF_LIFE_DAYS,
    {
      now: NOW,
      regularResetExpectedAt: viewModel.regularResetForecast.expectedAt,
    },
  );
  assert.equal(published.shadow?.modelVersion, recency.modelVersion);
  assert.deepEqual(published.shadow?.predictions, recency.predictions);
  assert.equal(viewModel.probability24h, published.probability24h);
  assert.equal(viewModel.probability48h, published.probability48h);
  assert.equal(viewModel.probability12h, published.probability12h);
  assert.equal(viewModel.probability72h, published.probability72h);
  assert.ok(published.probability12h <= published.probability24h);
  assert.equal(snapshot.viewModel.probability24h, published.probability24h);
  assert.equal(snapshot.viewModel.probability48h, published.probability48h);
  assert.equal(snapshot.viewModel.probability12h, published.probability12h);
  assert.equal(snapshot.viewModel.probability72h, published.probability72h);
  assert.equal(publishedDebug.version, PUBLISHED_PROBABILITY_MODEL_VERSION);
  assert.equal(publishedDebug.source, "shadow");
  assert.equal(publishedDebug.probability12h, snapshot.viewModel.probability12h);
  assert.equal(publishedDebug.probability24h, snapshot.viewModel.probability24h);
  assert.equal(publishedDebug.probability48h, snapshot.viewModel.probability48h);
  assert.equal(publishedDebug.probability72h, snapshot.viewModel.probability72h);
  // The emergency display cap is presentation-only; the published/API values
  // above remain the uncapped model output.
  assert.match(html, />14%<\/dd>/);
  assert.match(html, />27%<\/dd>/);
  assert.ok(published.probability24h <= published.probability48h);
  assert.ok(published.probability48h <= published.probability72h);
 });

function dataWithTeaserStrength(
  teaserStrength: "strong" | "weak" | "none",
  tweetCreatedAt: string,
  extra: Record<string, unknown> = {},
) {
  return getLocalRadarData({
    calculationNow: NOW,
    recentTiboSignals: [
      {
        tweet_id: `strength-${teaserStrength}-${tweetCreatedAt}`,
        signal_type: "irrelevant",
        text: "I might reset later.",
        tweet_url: "https://x.com/thsottiaux/status/strength-test",
        tweet_created_at: tweetCreatedAt,
        expires_at: "2026-08-03T00:00:00.000Z",
        verification_status: "auto_unverified",
        teaser_strength: teaserStrength,
        is_reply: false,
        ...extra,
      },
    ],
  });
}

test("published h30 model applies teaser strength as a weak odds multiplier", () => {
  const baseline = calculatePublishedProbability(
    dataWithTeaserStrength("none", NOW.toISOString()),
    { now: NOW, activeOfficialNotice: null },
  );
  const weak = calculatePublishedProbability(
    dataWithTeaserStrength("weak", NOW.toISOString()),
    { now: NOW, activeOfficialNotice: null },
  );
  const strong = calculatePublishedProbability(
    dataWithTeaserStrength("strong", NOW.toISOString()),
    { now: NOW, activeOfficialNotice: null },
  );

  assert.ok(weak.probability24h > baseline.probability24h);
  assert.ok(strong.probability24h > weak.probability24h);
  assert.ok(
    Math.abs(
      probabilityToOdds(weak.probability24h) / probabilityToOdds(baseline.probability24h) - 1.15,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      probabilityToOdds(weak.probability48h) / probabilityToOdds(baseline.probability48h) - 1.2,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      probabilityToOdds(strong.probability24h) / probabilityToOdds(baseline.probability24h) - 1.35,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      probabilityToOdds(strong.probability48h) / probabilityToOdds(baseline.probability48h) - 1.5,
    ) < 1e-9,
  );
});

test("teaser strength decays over 48 hours and ignores replies, rejected, and future posts", () => {
  const baseline = calculatePublishedProbability(
    dataWithTeaserStrength("none", NOW.toISOString()),
    { now: NOW, activeOfficialNotice: null },
  );
  const halfLife = calculatePublishedProbability(
    dataWithTeaserStrength("weak", new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString()),
    { now: NOW, activeOfficialNotice: null },
  );
  const expiredEffect = calculatePublishedProbability(
    dataWithTeaserStrength("strong", new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString()),
    { now: NOW, activeOfficialNotice: null },
  );
  const excluded = calculatePublishedProbability(
    dataWithTeaserStrength("strong", NOW.toISOString(), { is_reply: true }),
    { now: NOW, activeOfficialNotice: null },
  );
  const rejected = calculatePublishedProbability(
    dataWithTeaserStrength("strong", NOW.toISOString(), { verification_status: "rejected" }),
    { now: NOW, activeOfficialNotice: null },
  );
  const future = calculatePublishedProbability(
    dataWithTeaserStrength("strong", new Date(NOW.getTime() + 60 * 60 * 1000).toISOString()),
    { now: NOW, activeOfficialNotice: null },
  );

  assert.ok(
    Math.abs(
      probabilityToOdds(halfLife.probability24h) / probabilityToOdds(baseline.probability24h) - 1.075,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      probabilityToOdds(halfLife.probability48h) / probabilityToOdds(baseline.probability48h) - 1.1,
    ) < 1e-9,
  );
  assert.equal(expiredEffect.probability24h, baseline.probability24h);
  assert.equal(expiredEffect.probability48h, baseline.probability48h);
  assert.equal(excluded.probability24h, baseline.probability24h);
  assert.equal(rejected.probability24h, baseline.probability24h);
  assert.equal(future.probability24h, baseline.probability24h);
});

test("teaser strength before the latest formal reset has no probability effect", () => {
  const resetAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
  const strengthBeforeReset = new Date(resetAt.getTime() - 60 * 60 * 1000).toISOString();
  const formalReset = {
    tweet_id: "latest-formal-reset",
    text: "All paid users received a reset",
    tweet_url: "https://x.com/thsottiaux/status/latest-formal-reset",
    tweet_created_at: resetAt.toISOString(),
    signal_type: "reset_executed" as const,
    confidence: 0.98,
    verification_status: "confirmed" as const,
    classification_source: "gemini" as const,
    ai_reset_type_ja: "ランダムリセット",
    is_reply: false,
  };
  const baseline = getLocalRadarData({
    calculationNow: NOW,
    formalTiboResets: [formalReset],
  });
  const withOldStrength = getLocalRadarData({
    calculationNow: NOW,
    formalTiboResets: [formalReset],
    recentTiboSignals: [{
      tweet_id: "strength-before-latest-reset",
      signal_type: "irrelevant",
      tweet_created_at: strengthBeforeReset,
      verification_status: "auto_unverified",
      teaser_strength: "strong",
      is_reply: false,
    }],
  });

  const basePublished = calculatePublishedProbability(
    baseline,
    { now: NOW, activeOfficialNotice: null },
  );
  const oldStrengthPublished = calculatePublishedProbability(
    withOldStrength,
    { now: NOW, activeOfficialNotice: null },
  );

  assert.equal(oldStrengthPublished.probability24h, basePublished.probability24h);
  assert.equal(oldStrengthPublished.probability48h, basePublished.probability48h);
});

test("teaser strength is isolated from the unweighted, h14, and h60 comparison models", () => {
  const baseline = getLocalRadarData({ calculationNow: NOW });
  const withStrength = dataWithTeaserStrength("strong", NOW.toISOString());

  const unweightedBaseline = calculateShadowProbability(baseline, { now: NOW });
  const unweightedWithStrength = calculateShadowProbability(withStrength, { now: NOW });
  assert.deepEqual(unweightedWithStrength.predictions, unweightedBaseline.predictions);

  for (const halfLifeDays of [14, 60]) {
    const baselineModel = calculateRecencyWeightedShadowProbability(
      baseline,
      halfLifeDays,
      { now: NOW },
    );
    const strengthModel = calculateRecencyWeightedShadowProbability(
      withStrength,
      halfLifeDays,
      { now: NOW },
    );
    assert.deepEqual(strengthModel.predictions, baselineModel.predictions);
    assert.deepEqual(strengthModel.multipliers.teaserStrength, { probability24h: 1, probability48h: 1 });
  }
});

test("the strongest decayed strength wins without multiplying multiple posts", () => {
  const baseline = calculatePublishedProbability(
    dataWithTeaserStrength("none", NOW.toISOString()),
    { now: NOW, activeOfficialNotice: null },
  );
  const oneHourWeak = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
  const fortySevenHoursStrong = new Date(NOW.getTime() - 47 * 60 * 60 * 1000).toISOString();
  const data = getLocalRadarData({
    calculationNow: NOW,
    recentTiboSignals: [
      {
        tweet_id: "old-strong",
        signal_type: "irrelevant",
        tweet_created_at: fortySevenHoursStrong,
        verification_status: "auto_unverified",
        teaser_strength: "strong",
        is_reply: false,
      },
      {
        tweet_id: "new-weak",
        signal_type: "irrelevant",
        tweet_created_at: oneHourWeak,
        verification_status: "auto_unverified",
        teaser_strength: "weak",
        is_reply: false,
      },
    ],
  });
  const result = calculatePublishedProbability(data, { now: NOW, activeOfficialNotice: null });
  const expected24h = 1 + (1.15 - 1) * (47 / 48);
  const expected48h = 1 + (1.2 - 1) * (47 / 48);

  assert.ok(
    Math.abs(probabilityToOdds(result.probability24h) / probabilityToOdds(baseline.probability24h) - expected24h) < 1e-9,
  );
  assert.ok(
    Math.abs(probabilityToOdds(result.probability48h) / probabilityToOdds(baseline.probability48h) - expected48h) < 1e-9,
  );
  assert.ok(
    probabilityToOdds(result.probability24h) / probabilityToOdds(baseline.probability24h) < 1.35 * 1.15,
  );
});

test("formal teaser owns its existing multiplier instead of double-counting teaser strength", () => {
  const formalTeaser = {
    tweet_id: "formal-teaser",
    signal_type: "teaser" as const,
    tweet_created_at: NOW.toISOString(),
    confidence: 0.9,
    verification_status: "auto_unverified" as const,
    is_reply: false,
  };
  const formalOnly = getLocalRadarData({
    calculationNow: NOW,
    activeTiboSignals: [formalTeaser],
  });
  const formalAndStrength = getLocalRadarData({
    calculationNow: NOW,
    activeTiboSignals: [formalTeaser],
    recentTiboSignals: [{
      tweet_id: "strength-alongside-formal",
      signal_type: "irrelevant",
      tweet_created_at: NOW.toISOString(),
      confidence: 0.2,
      verification_status: "auto_unverified",
      teaser_strength: "strong",
      is_reply: false,
    }],
  });

  const formal = calculatePublishedProbability(formalOnly, { now: NOW, activeOfficialNotice: null });
  const combined = calculatePublishedProbability(formalAndStrength, { now: NOW, activeOfficialNotice: null });
  assert.equal(combined.probability24h, formal.probability24h);
  assert.equal(combined.probability48h, formal.probability48h);
});

test("official notice override wins over teaser strength", () => {
  const data = getLocalRadarData({
    calculationNow: NOW,
    activeTiboSignals: [{
      tweet_id: "strength-with-notice",
      signal_type: "irrelevant",
      tweet_created_at: NOW.toISOString(),
      verification_status: "auto_unverified",
      teaser_strength: "strong",
      is_reply: false,
    }, {
      tweet_id: "official-notice-with-strength",
      signal_type: "official_notice",
      tweet_created_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      expires_at: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
      confidence: 0.98,
      verification_status: "auto_unverified",
    }],
  });
  const result = calculatePublishedProbability(data, { now: NOW });
  assert.equal(result.probability24h, 0.9);
  assert.equal(result.probability48h, 0.96);
});

test("the published model uses broad random distributions and excludes regular or narrow records", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const events = getShadowCompletedResetEvents(data, NOW);
  const unweightedBaseline = calculateShadowProbability(data, { now: NOW });
  const eventIds = new Set(events.map((event) => event.id));
  const published = calculatePublishedProbability(data, { now: NOW }, { logFallback: false });

  assert.equal(published.adoptedModel, PUBLISHED_PROBABILITY_MODEL_VERSION);
  assert.equal(unweightedBaseline.modelVersion, SHADOW_PROBABILITY_MODEL_VERSION);
  assert.notEqual(published.adoptedModel, LEGACY_SHADOW_PROBABILITY_MODEL_VERSION);
  assert.equal(events.length, 23);
  assert.ok(eventIds.has("personal-compensation-reset-credit-2026-06-18"));
  assert.ok(eventIds.has("personal-codex-reset-button-aie-2026-07-02"));
  assert.ok(eventIds.has("personal-tibo-7m-users-banked-reset-2026-07-14"));
  assert.ok(!eventIds.has("personal-reset-credit-2026-06-11"));
  assert.ok(!eventIds.has("personal-tibo-500k-compensation-reset-2026-07-13"));
  assert.equal(published.shadow?.hazard.completedEventCount, events.length);
});

test("the h30 recency public model keeps the fixed-time forecast deterministic", () => {
  const fixedNow = new Date("2026-08-04T03:32:00.000Z");
  const data = getLocalRadarData({ calculationNow: fixedNow });
  const published = calculatePublishedProbability(data, { now: fixedNow }, { logFallback: false });
  const unweightedBaseline = calculateShadowProbability(data, { now: fixedNow });

  assert.equal(published.adoptedModel, PUBLISHED_PROBABILITY_MODEL_VERSION);
  assert.equal(published.source, "shadow");
  assert.equal(published.fallbackReason, null);
  assert.equal(published.probability12h, 0.13111217470479297);
  assert.equal(published.probability24h, 0.2450339470537658);
  assert.equal(published.probability48h, 0.4364474582890776);
  assert.equal(published.probability72h, 0.5599740647880459);
  assert.equal(unweightedBaseline.modelVersion, SHADOW_PROBABILITY_MODEL_VERSION);
  assert.equal(unweightedBaseline.predictions.probability24h, 0.26063284833834355);
  assert.equal(unweightedBaseline.predictions.probability48h, 0.44994539803274325);
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
    assert.equal(selected.adoptedModel, PUBLISHED_PROBABILITY_MODEL_VERSION);
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

  const mismatchedModel = selectPublishedProbability(primary, {
    ...validShadow,
    modelVersion: SHADOW_PROBABILITY_MODEL_VERSION,
  });
  assert.equal(mismatchedModel.source, "heuristic-fallback");
  assert.equal(mismatchedModel.fallbackReason, "shadow_invalid_prediction");
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
    assert.doesNotMatch(JSON.stringify(snapshot), /hazard-odds-v3-random-inclusive|hazard-odds-v2-random-only|publishedProbabilityModel|基礎確率|観測シグナルで補正/);
  }
});
