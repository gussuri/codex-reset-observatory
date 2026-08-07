import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  formatDateTimeInZone,
  getBrowserTimeZone,
  getTimeZoneLabel,
  LocalizedDateTime,
} from "../components/LocalizedDateTime";
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
  assert.doesNotMatch(serialized, /private-model|private reason|private-tweet/);
  assert.equal(publicSnapshot.viewModel.recentHistory.length >= 0, true);

  const staleSnapshot = toPublicRadarSnapshot(internal, "en", {
    stale: true,
    generatedAt: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(staleSnapshot.dataHealth.stale, true);
  assert.equal(staleSnapshot.dataHealth.generatedAt, "2026-08-03T00:00:00.000Z");
});

test("public Tibo activity exposes only a short post projection and classification", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const internal = getLocalRadarData({
    calculationNow,
    activeTiboSignals: [
      {
        tweet_id: "private-tweet-id",
        signal_type: "teaser",
        text: "There will be signs... Resets soon.",
        tweet_url: "https://x.com/thsottiaux/status/123",
        tweet_created_at: "2026-08-03T23:00:00.000Z",
        expires_at: "2026-08-05T00:00:00.000Z",
        verification_status: "auto_unverified",
        confidence: 0.87,
        classification_reason: "private internal reason",
      },
    ],
  });

  const snapshot = toPublicRadarSnapshot(internal, "en", { calculationNow });
  const serialized = JSON.stringify(snapshot);

  assert.deepEqual(snapshot.latestTiboActivity, {
    classification: "teaser",
    text: "There will be signs... Resets soon.",
    createdAt: "2026-08-03T23:00:00.000Z",
    sourceUrl: "https://x.com/thsottiaux/status/123",
  });
  assert.doesNotMatch(
    serialized,
    /private-tweet-id|private internal reason|confidence|classification_reason/,
  );
});

test("public Tibo activity can use a recent signal after its active expiry", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const internal = getLocalRadarData({
    calculationNow,
    recentTiboSignals: [
      {
        tweet_id: "expired-active-tweet",
        signal_type: "reset_executed",
        text: "Usage limits reset for Codex users.",
        tweet_url: "https://x.com/thsottiaux/status/456",
        tweet_created_at: "2026-08-03T23:00:00.000Z",
        expires_at: "2026-08-03T23:30:00.000Z",
        verification_status: "auto_unverified",
      },
    ],
  });

  const snapshot = toPublicRadarSnapshot(internal, "en", { calculationNow });

  assert.equal(snapshot.latestTiboActivity?.classification, "reset_executed");
  assert.equal(snapshot.latestTiboActivity?.createdAt, "2026-08-03T23:00:00.000Z");
});

test("public Tibo activity uses the newest stored post even when it is irrelevant", () => {
  const calculationNow = new Date("2026-08-07T00:00:00.000Z");
  const internal = getLocalRadarData({
    calculationNow,
    recentTiboSignals: [
      {
        tweet_id: "newest-irrelevant-tweet",
        signal_type: "irrelevant",
        text: "A newer Tibo post unrelated to resets.",
        tweet_url: "https://x.com/thsottiaux/status/789",
        tweet_created_at: "2026-08-06T23:00:00.000Z",
        verification_status: "auto_unverified",
      },
      {
        tweet_id: "older-reset-tweet",
        signal_type: "reset_executed",
        text: "An older reset post.",
        tweet_url: "https://x.com/thsottiaux/status/790",
        tweet_created_at: "2026-08-01T03:32:00.000Z",
        verification_status: "auto_unverified",
      },
    ],
  });

  const snapshot = toPublicRadarSnapshot(internal, "en", { calculationNow });

  assert.deepEqual(snapshot.latestTiboActivity, {
    classification: "irrelevant",
    text: "A newer Tibo post unrelated to resets.",
    createdAt: "2026-08-06T23:00:00.000Z",
    sourceUrl: "https://x.com/thsottiaux/status/789",
  });
});

test("SSR datetime waits with a JST-free skeleton until the browser timezone is known", () => {
  const props = {
    value: "2026-08-04T00:00:00.000Z",
    locale: "ja" as const,
  };
  const html = renderToStaticMarkup(
    React.createElement(LocalizedDateTime, props),
  );
  const firstClientRender = renderToStaticMarkup(
    React.createElement(LocalizedDateTime, {
      ...props,
    }),
  );

  assert.match(html, /<time[^>]*dateTime="2026-08-04T00:00:00\.000Z"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /min-w-\[12rem\]/);
  assert.doesNotMatch(html, /2026年8月4日|JST|GMT\+9/);
  assert.doesNotMatch(html, /Detecting time zone|タイムゾーンを検出中/);
  assert.doesNotMatch(html, /undefined|null|false/);
  assert.equal(firstClientRender, html);
});

test("browser timezone detection uses IANA values and falls back to JST only on failure", () => {
  assert.equal(getBrowserTimeZone(() => "America/New_York"), "America/New_York");
  assert.equal(getBrowserTimeZone(() => ""), "Asia/Tokyo");
  assert.equal(getBrowserTimeZone(() => {
    throw new Error("timezone unavailable");
  }), "Asia/Tokyo");
});

test("formats Tokyo time with one JST label in Japanese and Chinese", () => {
  const date = new Date("2026-08-01T03:32:00.000Z");

  const japanese = formatDateTimeInZone(date, "Asia/Tokyo", "ja-JP");
  const chinese = formatDateTimeInZone(date, "Asia/Tokyo", "zh-CN");

  assert.equal(japanese, "2026年8月1日 12:32 JST");
  assert.equal(chinese, "2026年8月1日 12:32 JST");
  assert.equal((chinese.match(/JST/g) ?? []).length, 1);
  assert.doesNotMatch(chinese, /GMT\+9/);
});

test("uses IANA zone identity for Seoul instead of the shared UTC+9 offset", () => {
  const value = formatDateTimeInZone(
    new Date("2026-08-01T03:32:00.000Z"),
    "Asia/Seoul",
    "en-US",
  );

  assert.match(value, /Aug 1, 2026, 12:32 PM KST$/);
  assert.doesNotMatch(value, /JST/);
  assert.equal(getTimeZoneLabel(new Date("2026-08-01T03:32:00.000Z"), "Asia/Seoul"), "KST");
});

test("uses UTC for the explicit UTC IANA zones", () => {
  const date = new Date("2026-08-01T03:32:00.000Z");

  assert.equal(getTimeZoneLabel(date, "UTC"), "UTC");
  assert.equal(getTimeZoneLabel(date, "Etc/UTC"), "UTC");
  assert.match(formatDateTimeInZone(date, "UTC", "en-US"), /UTC$/);
});

test("uses seasonal abbreviations for New York and Los Angeles", () => {
  const newYorkSummer = formatDateTimeInZone(
    new Date("2026-08-01T16:32:00.000Z"),
    "America/New_York",
    "en-US",
  );
  const newYorkWinter = formatDateTimeInZone(
    new Date("2026-01-01T17:32:00.000Z"),
    "America/New_York",
    "en-US",
  );
  const losAngelesSummer = formatDateTimeInZone(
    new Date("2026-08-01T19:32:00.000Z"),
    "America/Los_Angeles",
    "en-US",
  );
  const losAngelesWinter = formatDateTimeInZone(
    new Date("2026-01-01T20:32:00.000Z"),
    "America/Los_Angeles",
    "en-US",
  );

  assert.match(newYorkSummer, /Aug 1, 2026, 12:32 PM EDT$/);
  assert.match(newYorkWinter, /Jan 1, 2026, 12:32 PM EST$/);
  assert.match(losAngelesSummer, /Aug 1, 2026, 12:32 PM PDT$/);
  assert.match(losAngelesWinter, /Jan 1, 2026, 12:32 PM PST$/);
});

test("formats the same ISO instant in the local zone and changes the calendar date when needed", () => {
  const value = "2026-08-01T03:32:00.000Z";
  const tokyo = formatDateTimeInZone(new Date(value), "Asia/Tokyo", "en-US");
  const newYork = formatDateTimeInZone(new Date(value), "America/New_York", "en-US");

  assert.match(tokyo, /Aug 1, 2026, 12:32 PM JST$/);
  assert.match(newYork, /Jul 31, 2026, 11:32 PM EDT$/);
  assert.notEqual(tokyo, newYork);
});

test("preserves unknown and invalid datetime fallback text", () => {
  const unknown = renderToStaticMarkup(
    React.createElement(LocalizedDateTime, { value: null, locale: "en" }),
  );
  const invalid = renderToStaticMarkup(
    React.createElement(LocalizedDateTime, { value: "not-a-date", locale: "zh" }),
  );

  assert.equal(unknown, "<span>Unknown</span>");
  assert.equal(invalid, "<span>not-a-date</span>");
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

test("history page combines confirmed, banked, and regular reference records chronologically", () => {
  const data = toPublicRadarSnapshot(getLocalRadarData({}), "en", { limitHistory: false });
  const html = renderToStaticMarkup(React.createElement(HistoryView, { data, locale: "en" }));

  assert.match(html, /<h2[^>]*>Reset history<\/h2>/);
  assert.doesNotMatch(html, /<h2[^>]*>Confirmed global resets|<h2[^>]*>Banked Reset distributions/);
  assert.doesNotMatch(html, /text-\[11px\]/);
  const visibleItems = data.viewModel.recentHistory.filter(
    (item) => item.recordKind === "confirmed_global" ||
      item.recordKind === "banked_distribution" ||
      item.recordKind === "reference",
  );
  assert.ok(visibleItems.length >= 3);
  const firstTitle = translateDynamic(visibleItems[0].title, "en");
  const secondTitle = translateDynamic(visibleItems[1].title, "en");
  for (const item of visibleItems) {
    assert.match(html, new RegExp(escapeRegExp(escapeHtml(translateDynamic(item.title, "en")))));
  }
  assert.ok(html.indexOf(firstTitle) < html.indexOf(secondTitle));
  assert.match(html, /August 2026/);
  assert.match(html, /Original post/);
  assert.match(html, /Source profile/);
  assert.match(html, /Source not recorded/);
  assert.match(html, /Weekly reset \(reference record\)/);
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
    reference: "定期リセット（参考記録）",
    },
    en: {
      title: "Reset history",
      reference: "Weekly reset \(reference record\)",
    },
    zh: {
      title: "重置记录",
      reference: "定期重置（参考记录）",
    },
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const localizedData = toPublicRadarSnapshot(getLocalRadarData({}), locale, { limitHistory: false });
    const localizedHtml = renderToStaticMarkup(
      React.createElement(HistoryView, { data: localizedData, locale }),
    );
    assert.match(localizedHtml, new RegExp(`<h2[^>]*>${localizedAssertions[locale].title}<\\/h2>`));
    assert.doesNotMatch(localizedHtml, /text-\[11px\]/);
    assert.match(localizedHtml, new RegExp(escapeRegExp(localizedAssertions[locale].reference)));

    const description = {
      ja: "Codexの全体リセットと任意リセット配布を、新しい順にまとめています。",
      en: "Global resets and Banked Reset distributions are listed together in chronological order.",
      zh: "按时间倒序汇总 Codex 全局重置和手动重置发放记录。",
    }[locale];
    assert.equal((localizedHtml.match(new RegExp(escapeRegExp(description), "g")) ?? []).length, 1);
  }
});

test("top dashboard omits latest reset and weekly reference cards", () => {
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
  const calculationNow = new Date("2026-08-04T03:32:00.000Z");

  for (const locale of ["ja", "en", "zh"] as const) {
    const data = toPublicRadarSnapshot(
      getLocalRadarData({ calculationNow }),
      locale,
      { calculationNow },
    );
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, { initialData: data, locale }),
    );
    const currentStatusStart = html.indexOf(translateUI("currentStatus", locale));
    const historyStart = html.indexOf(translateUI("resetHistory", locale));
    const forecast = data.viewModel.regularResetForecast;

    assert.ok(currentStatusStart >= 0);
    assert.ok(historyStart > currentStatusStart);
    assert.doesNotMatch(html, new RegExp(escapeRegExp(translateUI("latestReset", locale))));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(weeklyLabels[locale])));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(weeklyNotes[locale])));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(forecast.date)));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(forecast.remaining)));
    assert.match(html, new RegExp(escapeRegExp(translateUI("within24h", locale))));
    assert.match(html, new RegExp(escapeRegExp(translateUI("within48h", locale))));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(translateUI("within12h", locale))));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(translateUI("within72h", locale))));
  }
});

test("shows the next regular reset reference only within 72 hours", () => {
  const calculationNow = new Date("2026-08-05T03:32:00.000Z");
  const labels = {
    ja: "次回定期リセット参考日",
    en: "Next regular reset reference",
    zh: "下次定期重置参考日期",
  } as const;
  const notes = {
    ja: "任意リセットを使用すると、次回の定期リセットは使用時刻から1週間後になります。その場合、この参考日時とは異なります。",
    en: "If you use a Banked Reset, your next regular reset will be one week after the time you use it, so it may differ from this reference time.",
    zh: "如果使用手动重置，下一次定期重置将从使用时间起算一周，因此可能与此参考时间不同。",
  } as const;
  for (const locale of ["ja", "en", "zh"] as const) {
    const data = toPublicRadarSnapshot(
      getLocalRadarData({ calculationNow }),
      locale,
      { calculationNow },
    );
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, { initialData: data, locale }),
    );

    assert.equal(data.viewModel.regularResetForecast.isNoticeWindow, true);
    assert.match(html, new RegExp(escapeRegExp(labels[locale])));
    assert.match(html, new RegExp(escapeRegExp(notes[locale])));
    assert.doesNotMatch(html, /<dt[^>]*>参考日時<\/dt>|<dt[^>]*>Reference date and time<\/dt>|<dt[^>]*>参考日期和时间<\/dt>/);
    assert.doesNotMatch(html, /残り3日|3 days remaining|剩余3天/);
    assert.match(html, /dateTime="2026-08-08T03:32:00\.000Z"/);
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
