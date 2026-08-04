import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LocalizedDateTime } from "../components/LocalizedDateTime";
import { RadarDashboard } from "../components/RadarDashboard";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("public radar DTO uses an allowlist and excludes internal audit fields", () => {
  const internal = getLocalRadarData({
    checkedAt: "2026-08-04T00:00:00.000Z",
  }) as typeof getLocalRadarData extends (...args: never[]) => infer T ? T : never;

  Object.assign(internal, {
    ai_reason_ja: "internal reason",
    classification_reason: "internal classification",
    rule_confidence: 0.9,
    ai_confidence: 0.99,
    ai_model: "private-model",
    ai_classification_status: "success",
    rejected_tibo_resets: [{ tweet_id: "private-id" }],
    active_tibo_signals: [
      {
        tweet_id: "private-tweet",
        signal_type: "irrelevant",
        text: "private full tweet text",
        tweet_created_at: "2026-08-04T00:00:00.000Z",
      },
    ],
  });

  const publicSnapshot = toPublicRadarSnapshot(internal, "en");
  const serialized = JSON.stringify(publicSnapshot);

  assert.equal(publicSnapshot.schemaVersion, "public-v1");
  assert.equal(publicSnapshot.checkedAt, "2026-08-04T00:00:00.000Z");
  assert.equal("ai_reason_ja" in publicSnapshot, false);
  assert.equal("classification_reason" in publicSnapshot, false);
  assert.equal("rule_confidence" in publicSnapshot, false);
  assert.equal("ai_confidence" in publicSnapshot, false);
  assert.equal("ai_model" in publicSnapshot, false);
   assert.equal("ai_classification_status" in publicSnapshot, false);
   assert.equal("rejected_tibo_resets" in publicSnapshot, false);
   assert.equal("reasoningSummary" in publicSnapshot.viewModel, false);
   assert.equal("action" in publicSnapshot.viewModel, false);
   assert.doesNotMatch(serialized, /private full tweet text|private-model|private reason/);
  assert.equal(publicSnapshot.viewModel.recentHistory.length >= 0, true);

  const staleSnapshot = toPublicRadarSnapshot(internal, "en", {
    stale: true,
    generatedAt: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(staleSnapshot.dataHealth.stale, true);
  assert.equal(staleSnapshot.dataHealth.generatedAt, "2026-08-03T00:00:00.000Z");
});

test("SSR datetime has a JST fallback and never renders a timezone detector", () => {
  const html = renderToStaticMarkup(
    React.createElement(LocalizedDateTime, {
      value: "2026-08-04T00:00:00.000Z",
      locale: "ja",
    }),
  );

  assert.match(html, /<time[^>]*dateTime="2026-08-04T00:00:00\.000Z"/);
  assert.match(html, /JST/);
  assert.doesNotMatch(html, /Detecting time zone|タイムゾーンを検出中/);
  assert.doesNotMatch(html, /undefined|null|false/);
});

test("date class composition omits an absent className", () => {
  const html = renderToStaticMarkup(
    React.createElement(LocalizedDateTime, {
      value: "2026-08-04T00:00:00.000Z",
      locale: "en",
    }),
  );

  assert.doesNotMatch(html, /class="[^"]*(undefined|null|false)/);
});

test("dashboard renders the translated reset history label", () => {
  const data = toPublicRadarSnapshot(getLocalRadarData({}), "en");
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: data, locale: "en" }),
  );

  assert.match(html, /Reset history/);
  assert.doesNotMatch(html, />resetHistory</);
});

test("stale fallback data renders normally without a public warning in every locale", () => {
  const warningText = {
    ja: "最新データの取得に失敗したため、最後に取得できた結果を表示しています。",
    en: "Live refresh failed. Showing the last successfully fetched result.",
    zh: "实时更新失败，当前显示上次成功获取的结果。",
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const data = toPublicRadarSnapshot(getLocalRadarData({}), locale, {
      stale: true,
      generatedAt: "2026-08-03T00:00:00.000Z",
    });
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, { initialData: data, locale }),
    );

    assert.doesNotMatch(html, new RegExp(warningText[locale]));
    assert.match(html, /24/);
    assert.match(html, /48/);
  }
});

test("unavailable data keeps the existing public error warning", () => {
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: null, locale: "ja" }),
  );

  assert.match(html, /ライブデータも保存済みデータも取得できません/);
});
