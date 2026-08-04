import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LocalizedDateTime } from "../components/LocalizedDateTime";
import { HistoryView } from "../components/HistoryView";
import { RadarDashboard } from "../components/RadarDashboard";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import { translateDynamic, translateUI } from "../lib/radar/i18n";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

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
  assert.doesNotMatch(html, /Global reset|Banked Reset/);
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

test("history page combines confirmed events and banked distributions in one chronological list", () => {
  const data = toPublicRadarSnapshot(getLocalRadarData({}), "en", { limitHistory: false });
  const html = renderToStaticMarkup(React.createElement(HistoryView, { data, locale: "en" }));

  assert.match(html, /<h2[^>]*>Reset history<\/h2>/);
  assert.doesNotMatch(html, /<h2[^>]*>Confirmed global resets|<h2[^>]*>Banked Reset distributions/);
  assert.doesNotMatch(html, /text-\[11px\]/);
  const visibleItems = data.viewModel.recentHistory.filter(
    (item) => item.recordKind === "confirmed_global" || item.recordKind === "banked_distribution",
  );
  assert.ok(visibleItems.length >= 2);
  const firstTitle = translateDynamic(visibleItems[0].title, "en");
  const secondTitle = translateDynamic(visibleItems[1].title, "en");
  for (const item of visibleItems) {
    assert.match(html, new RegExp(escapeRegExp(escapeHtml(translateDynamic(item.title, "en")))));
  }
  assert.ok(html.indexOf(firstTitle) < html.indexOf(secondTitle));
  assert.match(html, /August 2026/);
  assert.match(html, /Original post/);
  assert.match(html, /Source profile/);
  assert.doesNotMatch(html, /Source not recorded/);
  assert.doesNotMatch(html, /Weekly reset reference/);
  assert.doesNotMatch(html, /Unclassified history sentinel/);

  const unclassifiedData = toPublicRadarSnapshot(getLocalRadarData({}), "en", { limitHistory: false });
  const firstItem = unclassifiedData.viewModel.recentHistory[0];
  unclassifiedData.viewModel.recentHistory = [
    ...unclassifiedData.viewModel.recentHistory,
    { ...firstItem, key: "unclassified-history-test", title: "Unclassified history sentinel", recordKind: undefined },
  ];
  const unclassifiedHtml = renderToStaticMarkup(
    React.createElement(HistoryView, { data: unclassifiedData, locale: "en" }),
  );
  assert.doesNotMatch(unclassifiedHtml, /Unclassified history sentinel/);

  const localizedAssertions = {
    ja: {
      title: "リセット履歴",
      reference: "週間リセット参考日時",
    },
    en: {
      title: "Reset history",
      reference: "Weekly reset reference time",
    },
    zh: {
      title: "重置记录",
      reference: "每周重置参考时间",
    },
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const localizedData = toPublicRadarSnapshot(getLocalRadarData({}), locale, { limitHistory: false });
    const localizedHtml = renderToStaticMarkup(
      React.createElement(HistoryView, { data: localizedData, locale }),
    );
    assert.match(localizedHtml, new RegExp(`<h2[^>]*>${localizedAssertions[locale].title}<\\/h2>`));
    assert.doesNotMatch(localizedHtml, /text-\[11px\]/);
    assert.doesNotMatch(localizedHtml, new RegExp(localizedAssertions[locale].reference));

    const description = {
      ja: "Codexの全体リセットと任意リセット配布を、新しい順にまとめています。",
      en: "Global resets and Banked Reset distributions are listed together in chronological order.",
      zh: "按时间倒序汇总 Codex 全局重置和手动重置发放记录。",
    }[locale];
    assert.equal((localizedHtml.match(new RegExp(escapeRegExp(description), "g")) ?? []).length, 1);
  }
});

test("top latest reset card keeps only its title, execution time, and safe source link", () => {
  const labels = {
    ja: { latest: "最新のリセット", resetTime: "リセット実施時刻", source: "ソース", sourceLink: "元投稿" },
    en: { latest: "Latest reset", resetTime: "Reset time", source: "Source", sourceLink: "Original post" },
    zh: { latest: "最新重置", resetTime: "重置执行时间", source: "来源", sourceLink: "原帖" },
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const data = toPublicRadarSnapshot(getLocalRadarData({}), locale);
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, { initialData: data, locale }),
    );
    const latestStart = html.indexOf(labels[locale].latest);
    const historyStart = html.indexOf(translateUI("resetHistory", locale));
    const latestCard = html.slice(latestStart, historyStart);
    const latestWindow = data.viewModel.latestWindow;

    assert.ok(latestStart >= 0);
    assert.ok(historyStart > latestStart);
    assert.match(latestCard, new RegExp(escapeRegExp(escapeHtml(translateDynamic(latestWindow.title, locale)))));
    assert.match(latestCard, new RegExp(labels[locale].resetTime));
    assert.match(latestCard, new RegExp(labels[locale].source));
    assert.match(latestCard, new RegExp(labels[locale].sourceLink));
    assert.doesNotMatch(html, /text-\[11px\]/);
    assert.doesNotMatch(latestCard, new RegExp(escapeRegExp(escapeHtml(translateDynamic(latestWindow.summary, locale)))));
    assert.doesNotMatch(latestCard, new RegExp(escapeRegExp(escapeHtml(translateDynamic(latestWindow.scope, locale)))));
    assert.doesNotMatch(latestCard, /Notice|予告|预告|告知から実施まで|Time from notice to reset|从预告到执行/);
  }
});

test("top dashboard omits the weekly reference and keeps the simplified DOM order", () => {
  const weeklyLabels = {
    ja: "1週間サイクルのリセット参考日",
    en: "Weekly reset reference",
    zh: "每周重置参考日期",
  } as const;
  const weeklyNotes = {
    ja: "過去の全体リセット時刻から7日後を計算した参考値です。各アカウントの実際の表示日時や利用枠とは異なる場合があります。",
    en: "This is a shared reference calculated as seven days after the latest confirmed global reset. Your account’s actual usage window may differ.",
    zh: "这是根据最近一次已确认的全局重置时间向后计算七天得到的公共参考值。您账号的实际使用周期可能不同。",
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const data = toPublicRadarSnapshot(getLocalRadarData({}), locale);
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, { initialData: data, locale }),
    );
    const currentStatusStart = html.indexOf(translateUI("currentStatus", locale));
    const latestResetStart = html.indexOf(translateUI("latestReset", locale));
    const historyStart = html.indexOf(translateUI("resetHistory", locale));
    const forecast = data.viewModel.regularResetForecast;

    assert.ok(currentStatusStart >= 0);
    assert.ok(latestResetStart > currentStatusStart);
    assert.ok(historyStart > latestResetStart);
    assert.doesNotMatch(html, new RegExp(escapeRegExp(weeklyLabels[locale])));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(weeklyNotes[locale])));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(forecast.date)));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(forecast.remaining)));
    assert.match(html, new RegExp(escapeRegExp(translateUI("within24h", locale))));
    assert.match(html, new RegExp(escapeRegExp(translateUI("within48h", locale))));
  }
});

test("history uses a short notice label only for a signal before execution", () => {
  const expectedLabels = {
    ja: "予告：",
    en: "Notice:",
    zh: "预告：",
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const base = toPublicRadarSnapshot(getLocalRadarData({}), locale, { limitHistory: false });
    const sourceItem = base.viewModel.recentHistory.find((item) => item.recordKind === "confirmed_global");
    assert.ok(sourceItem);

    const makeSnapshot = (signalAt: string) => ({
      ...base,
      viewModel: {
        ...base.viewModel,
        recentHistory: [
          {
            ...sourceItem,
            signalAt,
            resetAt: "2026-08-02T00:00:00.000Z",
          },
        ],
      },
    });

    const priorSignalHtml = renderToStaticMarkup(
      React.createElement(HistoryView, {
        data: makeSnapshot("2026-08-01T23:00:00.000Z"),
        locale,
      }),
    );
    const immediateHtml = renderToStaticMarkup(
      React.createElement(HistoryView, {
        data: makeSnapshot("2026-08-02T00:00:00.000Z"),
        locale,
      }),
    );

    assert.match(priorSignalHtml, new RegExp(expectedLabels[locale]));
    assert.doesNotMatch(immediateHtml, new RegExp(expectedLabels[locale]));
  }
});

test("current API keeps its shared cache and excludes responses from search indexing", () => {
  const routeSource = readFileSync(resolve("app/api/current/route.ts"), "utf8");

  assert.match(routeSource, /"Cache-Control": API_CACHE_CONTROL/);
  assert.match(routeSource, /"X-Robots-Tag": "noindex, nofollow"/);
});
