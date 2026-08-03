import React from "react";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RadarDashboard } from "../components/RadarDashboard";
import { FaqView } from "../components/FaqView";
import { ProbabilityMetrics } from "../components/ProbabilityMetrics";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("renders two named probability progressbars in a definition list", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProbabilityMetrics, {
      locale: "en",
      probability24h: 0.23,
      probability48h: 0.765,
    }),
  );

  assert.match(html, /^<dl class="mt-5 grid grid-cols-2 gap-3">/);
  assert.strictEqual((html.match(/role="progressbar"/g) ?? []).length, 2);
  assert.match(html, /aria-label="Within 24h"/);
  assert.match(html, /aria-label="Within 48h"/);
  assert.strictEqual((html.match(/aria-valuemin="0"/g) ?? []).length, 2);
  assert.strictEqual((html.match(/aria-valuemax="100"/g) ?? []).length, 2);
  assert.match(html, /aria-valuenow="23"/);
  assert.match(html, /aria-valuenow="77"/);
});

test("renders unknown probabilities without aria-valuenow and with localized value text", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProbabilityMetrics, {
      locale: "en",
      probability24h: undefined,
      probability48h: undefined,
    }),
  );

  assert.strictEqual((html.match(/role="progressbar"/g) ?? []).length, 2);
  assert.strictEqual((html.match(/aria-valuenow=/g) ?? []).length, 0);
  assert.strictEqual((html.match(/aria-valuetext="Unknown"/g) ?? []).length, 2);
});

test("labels a dynamic notice by its post time when no execution time is scheduled", (t: TestContext) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-08-02T00:00:00.000Z"),
  });
  const openedAt = "2026-08-01T23:45:00.000Z";
  const expiresAt = "2026-08-02T12:00:00.000Z";
  const data = getLocalRadarData({
    activeTiboSignals: [
      {
        tweet_id: "presentation-notice",
        signal_type: "official_notice",
        text: "A reset notice from Tibo",
        tweet_url: "https://x.com/tibo_maker/status/presentation-notice",
        tweet_created_at: openedAt,
        expires_at: expiresAt,
        confidence: 0.96,
        verification_status: "auto_unverified",
      },
    ],
  });

  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(data, "en"),
      initialFetchedAt: openedAt,
      locale: "en",
    }),
  );

  assert.match(html, /Notice posted/);
  assert.doesNotMatch(html, /Estimated reset window/);
  assert.match(html, /Tibo \(@tibo_maker\)/);
});

test("keeps the normal dashboard focused on the current outlook", () => {
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(getLocalRadarData({}), "ja"),
      locale: "ja",
    }),
  );

  const probabilityIndex = html.indexOf("24時間以内");
  const noticeIndex = html.indexOf("公式予告：なし");
  const outlookIndex = html.indexOf("現在の見立て");
  const disclaimerIndex = html.indexOf("非公式の予測です");
  const outlookText = html.slice(outlookIndex, disclaimerIndex);

  assert.ok(probabilityIndex >= 0 && probabilityIndex < noticeIndex);
  assert.ok(noticeIndex >= 0 && noticeIndex < outlookIndex);
  assert.ok(outlookIndex >= 0 && outlookIndex < disclaimerIndex);
  assert.match(html, /公式予告：なし/);
  assert.match(html, /現在の見立て/);
  assert.match(html, /直近のリセットから\d+日経過しています/);
  assert.doesNotMatch(outlookText, /現在の見立ては24時間以内/);
  assert.doesNotMatch(outlookText, /基礎確率を算出/);
  assert.doesNotMatch(outlookText, /観測シグナルで補正/);
  assert.doesNotMatch(outlookText, /\d+%/);
  assert.match(html, /非公式の予測です。実際の実施時期は公式情報をご確認ください。/);
  assert.match(html, /予測のしくみを見る →/);
  assert.doesNotMatch(html, /border-amber-300 bg-amber-50/);
});

test("keeps the large official notice card above the probability card", (t: TestContext) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-08-02T00:00:00.000Z"),
  });
  const openedAt = "2026-08-01T23:45:00.000Z";
  const data = getLocalRadarData({
    activeTiboSignals: [
      {
        tweet_id: "presentation-official-notice",
        signal_type: "official_notice",
        text: "A reset notice from Tibo",
        tweet_url: "https://x.com/tibo_maker/status/presentation-official-notice",
        tweet_created_at: openedAt,
        expires_at: "2026-08-02T12:00:00.000Z",
        confidence: 0.96,
        verification_status: "auto_unverified",
      },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(data, "en"),
      initialFetchedAt: openedAt,
      locale: "en",
    }),
  );

  const noticeIndex = html.indexOf("Notice posted");
  const probabilityIndex = html.indexOf("Within 24h");

  assert.ok(noticeIndex >= 0 && noticeIndex < probabilityIndex);
  assert.match(html, /Notice posted/);
  assert.match(html, /Tibo \(@tibo_maker\)/);
  assert.doesNotMatch(html, /Official notice: None/);
  assert.doesNotMatch(html, /border-slate-50/);
});

test("keeps the forecast method link and labels localized across all dashboard locales", () => {
  const cases = [
    { locale: "ja" as const, notice: "公式予告：なし", description: "Codexのリセット予測、最新情報、過去の履歴をまとめて確認できます。", link: "/faq#forecast-method", method: "予測のしくみを見る →" },
    { locale: "en" as const, notice: "Official notice: None", description: "Check the latest Codex reset forecast, official updates, and recent reset history.", link: "/en/faq#forecast-method", method: "How the forecast works →" },
    { locale: "zh" as const, notice: "官方预告：无", description: "集中查看 Codex 重置预测、最新信息和近期重置记录。", link: "/zh/faq#forecast-method", method: "查看预测方式 →" },
  ];

  for (const item of cases) {
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, {
        initialData: toPublicRadarSnapshot(getLocalRadarData({}), item.locale),
        locale: item.locale,
      }),
    );

    assert.match(html, new RegExp(item.notice));
    assert.match(html, new RegExp(item.description));
    assert.match(html, new RegExp(`href="${item.link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(html, new RegExp(item.method));
    assert.doesNotMatch(
      html,
      /過去のリセット間隔から算出した基礎確率|Track Codex reset history and a statistical forecast|查看 Codex 重置历史，以及根据过去重置间隔计算基础概率/,
    );
    assert.doesNotMatch(
      html,
      /This is a statistical reference estimate based on past reset intervals|過去のリセット間隔を基礎に現在の公開シグナルで補正した参考値|本预测以过去的重置间隔为基础，并根据当前公开信号调整/,
    );
  }
});

test("adds the forecast-method anchor to each localized FAQ", () => {
  for (const locale of ["ja", "en", "zh"] as const) {
    const html = renderToStaticMarkup(React.createElement(FaqView, { locale }));
    assert.match(html, /id="forecast-method"/);
  }
});
