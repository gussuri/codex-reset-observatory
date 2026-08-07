import React from "react";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RadarDashboard } from "../components/RadarDashboard";
import { FaqView } from "../components/FaqView";
import { formatProbabilityDisplay, ProbabilityMetrics } from "../components/ProbabilityMetrics";
import { TiboActivityCard } from "../components/TiboActivityCard";
import { getLocalRadarData, getRandomResetHeatmapEventTimes } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import { getDisplayProbabilityReason, getLocalSignalEvaluation } from "../lib/radar/probability";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("renders only the 24-hour and 48-hour probability progressbars", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProbabilityMetrics, {
      locale: "en",
      probability24h: 0.23,
      probability48h: 0.765,
    }),
  );

  assert.match(html, /^<dl class="mt-4 grid w-full grid-cols-2 gap-3">/);
  assert.strictEqual((html.match(/role="progressbar"/g) ?? []).length, 2);
  assert.match(html, /aria-label="Within 24h"/);
  assert.match(html, /aria-label="Within 48h"/);
  assert.doesNotMatch(html, /aria-label="Within 12 hours"/);
  assert.doesNotMatch(html, /aria-label="Within 72 hours"/);
  assert.strictEqual((html.match(/aria-valuemin="0"/g) ?? []).length, 2);
  assert.strictEqual((html.match(/aria-valuemax="100"/g) ?? []).length, 2);
  assert.match(html, />23\.0%</);
  assert.match(html, />76\.5%</);
  assert.match(html, /rounded-lg border p-5/);
  assert.match(html, /text-base font-medium/);
  assert.match(html, /text-4xl font-semibold/);
  assert.match(html, /aria-valuenow="23"/);
  assert.match(html, /aria-valuenow="77"/);
});

test("formats probability cards with one localized decimal place", () => {
  assert.equal(formatProbabilityDisplay(0.213, "ja"), "21.3%");
  assert.equal(formatProbabilityDisplay(0.765, "en"), "76.5%");
  assert.equal(formatProbabilityDisplay(0.405, "zh"), "40.5%");
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

test("dashboard shows the latest Tibo activity below history for the experiment", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow,
      activeTiboSignals: [
        {
          tweet_id: "private-tweet-id",
          signal_type: "teaser",
          text: "A reset hint from Tibo",
          tweet_url: "https://x.com/thsottiaux/status/123",
          tweet_created_at: "2026-08-03T23:00:00.000Z",
          expires_at: "2026-08-05T00:00:00.000Z",
          verification_status: "auto_unverified",
          confidence: 0.87,
          classification_reason: "private internal reason",
        },
      ],
    }),
    "en",
    { calculationNow },
  );
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: snapshot, locale: "en" }),
  );

  const activityIndex = html.indexOf("Latest Tibo post");
  const historyIndex = html.indexOf("Recent reset events");
  const heatmapIndex = html.indexOf("Past random reset times");
  assert.ok(activityIndex > historyIndex && activityIndex > heatmapIndex);
  assert.doesNotMatch(html, /Latest post/);
  assert.match(html, /A reset hint from Tibo/);
  assert.match(html, /Automated observation/);
  assert.match(html, /Reset hint/);
  assert.match(html, /href="https:\/\/x\.com\/thsottiaux\/status\/123"/);
  assert.doesNotMatch(html, /private-tweet-id|private internal reason|classification_reason/);

  const postIndex = html.indexOf("A reset hint from Tibo");
  const classificationIndex = html.indexOf("Automated observation");
  assert.ok(postIndex >= 0 && postIndex < classificationIndex);
});

test("uses clear Japanese labels for the Tibo post card and unrelated classification", () => {
  const html = renderToStaticMarkup(
    React.createElement(TiboActivityCard, {
      locale: "ja",
      activity: {
        classification: "irrelevant",
        text: "リセットとは関係のない投稿です。",
        createdAt: "2026-08-07T05:23:00.000Z",
        sourceUrl: "https://x.com/thsottiaux/status/123",
      },
    }),
  );

  assert.match(html, /Tiboの最新投稿/);
  assert.match(html, /リセットとは無関係/);
  assert.doesNotMatch(html, /Tibo氏の最新動向|>その他</);
});

test("renders the random reset time heatmap after history with a timezone-free SSR skeleton", () => {
  const calculationNow = new Date("2026-08-06T00:00:00.000Z");
  const internalData = getLocalRadarData({ calculationNow });
  const eventTimes = getRandomResetHeatmapEventTimes(internalData, calculationNow);
  const headings = {
    ja: "過去のランダムリセット時刻",
    en: "Past random reset times",
    zh: "过去的随机重置时刻",
  } as const;
  const descriptions = {
    ja: "過去のランダムリセット時刻を2時間ごとに集計しています。",
    en: "Past random reset times are grouped into two-hour intervals.",
    zh: "过去的随机重置时刻按每两小时汇总。",
  } as const;
  const weekdayHeadings = {
    ja: "過去のランダムリセット曜日",
    en: "Past random reset weekdays",
    zh: "过去的随机重置星期几",
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const snapshot = toPublicRadarSnapshot(internalData, locale, { calculationNow });
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, {
        initialData: snapshot,
        randomResetHeatmapEventTimes: eventTimes,
        locale,
      }),
    );
    const historyIndex = html.indexOf(locale === "ja" ? "直近のリセット履歴" : locale === "en" ? "Recent reset events" : "最近的重置历史");
    const heatmapIndex = html.indexOf(headings[locale]);

    assert.ok(historyIndex >= 0);
    assert.ok(heatmapIndex > historyIndex);
    assert.ok(html.includes(descriptions[locale]));
    assert.match(html, new RegExp(locale === "ja" ? "時刻" : locale === "en" ? "Time" : "时间"));
    assert.match(html, new RegExp(locale === "ja" ? "全期間" : locale === "en" ? "All time" : "全部期间"));
    assert.match(html, new RegExp(locale === "ja" ? "直近1か月" : locale === "en" ? "Last month" : "最近1个月"));
    assert.match(html, new RegExp(locale === "ja" ? "過去のランダムリセット曜日" : locale === "en" ? "Past random reset weekdays" : "过去的随机重置星期几"));
    assert.match(html, new RegExp(locale === "ja" ? "aria-pressed=\"true\"[^>]*>直近1か月" : locale === "en" ? "aria-pressed=\"true\"[^>]*>Last month" : "aria-pressed=\"true\"[^>]*>最近1个月"));
    assert.doesNotMatch(html, /mx-auto w-full max-w-2xl|mx-auto mt-4 w-full max-w-md/);
    assert.match(html, new RegExp(`<h2 class="text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">${weekdayHeadings[locale]}`));
    assert.doesNotMatch(html, /閲覧者のタイムゾーン|Viewer time zone|查看者时区/);
    assert.match(html, new RegExp(`aria-busy="true"[^>]*aria-label="${headings[locale]}"`));
    assert.match(html, /class="block aspect-\[1\.35\] min-w-0 rounded bg-slate-200/);
    assert.doesNotMatch(html, /少ない|多い|Raw count|Weighted share|加权构成比/);
    assert.doesNotMatch(html, /実際のシステム実行時刻|Some records may reflect|部分记录反映/);
    assert.doesNotMatch(html, /Asia\/Tokyo|JST|00:00–02:00/);
  }
});

test("does not render the omitted 12-hour and 72-hour metrics", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({ calculationNow }),
    "en",
    { calculationNow },
  );
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: snapshot,
      locale: "en",
    }),
  );

  assert.match(html, /aria-label="Within 24h"/);
  assert.match(html, /aria-label="Within 48h"/);
  assert.doesNotMatch(html, /Within 12 hours|Within 72 hours/);
  assert.strictEqual((html.match(/role="progressbar"/g) ?? []).length, 2);
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
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const data = getLocalRadarData({ calculationNow });
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(data, "ja", { calculationNow }),
      locale: "ja",
    }),
  );

  const probabilityIndex = html.indexOf("24時間以内");
  const noticeIndex = html.indexOf("公式リセット予告");
  const incidentIndex = html.indexOf("Codex関連障害");
  const elapsedIndex = html.indexOf("前回のリセットから");
  const teaserIndex = html.indexOf("リセット匂わせ投稿");
  const outlookIndex = html.indexOf("現在の見立て");
  const historyIndex = html.indexOf("リセット履歴", outlookIndex);
  const outlookText = html.slice(outlookIndex, historyIndex);

  assert.ok(probabilityIndex >= 0 && probabilityIndex < noticeIndex);
  assert.match(html, /lg:grid-cols-\[minmax\(0,1\.4fr\)_minmax\(20rem,1fr\)\]/);
  assert.ok(noticeIndex >= 0 && noticeIndex < teaserIndex);
  assert.ok(teaserIndex < incidentIndex && incidentIndex < elapsedIndex && elapsedIndex < outlookIndex);
  assert.ok(outlookIndex >= 0);
  assert.match(html, /公式リセット予告[\s\S]*なし/);
  assert.match(html, /Codex関連障害[\s\S]*なし/);
  assert.match(html, /前回のリセットから[\s\S]*2日20時間/);
  assert.match(html, /リセット匂わせ投稿[\s\S]*なし/);
  assert.match(html, /<dl class="grid gap-2 sm:grid-cols-2 lg:grid-cols-2">/);
  assert.match(html, /現在の見立て/);
  assert.match(html, /現在、目立った観測変化はありません。/);
  assert.match(
    html,
    /現在、目立った観測変化はありません。/,
  );
  assert.doesNotMatch(outlookText, /直近のリセットから2日20時間経過しています。/);
  assert.doesNotMatch(outlookText, /公式予告や発生中のCodex関連障害はありません。/);
  assert.doesNotMatch(outlookText, /直近7日間でリセットが3回/);
  assert.doesNotMatch(outlookText, /現在の見立ては24時間以内/);
  assert.doesNotMatch(outlookText, /現在の可能性/);
  assert.doesNotMatch(outlookText, /基礎確率を算出/);
  assert.doesNotMatch(outlookText, /観測シグナルで補正/);
  assert.doesNotMatch(outlookText, /。 /);
  assert.doesNotMatch(outlookText, /\d+%/);
  assert.doesNotMatch(html, /非公式の予測です。実際の実施時期は公式情報をご確認ください。/);
  assert.doesNotMatch(html, /今日、全体リセットはありましたか？|次のリセットはいつですか？|予測のしくみを見る →/);
  assert.doesNotMatch(html, /border-amber-300 bg-amber-50/);
});

test("observation status row reflects an active Codex incident without changing the calculation", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow,
      openAIStatus: {
        updatedAt: "2026-08-03T23:00:00.000Z",
        statusIncidents24h: 1,
        activeCodexIncidents: 1,
        recentCodexIncidents: 1,
        affectedCodexComponents: 0,
        suppressCodexIncidents: false,
        latestCodexIncidentName: "Codex incident",
        history: [
          {
            id: "dashboard-active-incident",
            title: "Codex incident",
            status: "investigating",
            impact: "minor",
            createdAt: "2026-08-03T22:00:00.000Z",
            updatedAt: "2026-08-03T23:00:00.000Z",
            resolvedAt: null,
            source: "openai_status",
            url: "https://status.openai.com/incidents/dashboard-active-incident",
          },
        ],
      },
    }),
    "en",
    { calculationNow },
  );
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: snapshot, locale: "en" }),
  );

  assert.match(html, /Codex incidents[\s\S]*Active/);
  assert.match(html, /A Codex-related incident is currently active/);
});

test("observation status row reflects an active reset teaser from the latest Tibo activity", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow,
      activeTiboSignals: [
        {
          tweet_id: "dashboard-active-teaser",
          signal_type: "teaser",
          text: "There will be signs... Resets",
          tweet_url: "https://x.com/thsottiaux/status/dashboard-active-teaser",
          tweet_created_at: "2026-08-03T23:00:00.000Z",
          expires_at: "2026-08-05T23:00:00.000Z",
          verification_status: "auto_unverified",
        },
      ],
    }),
    "ja",
    { calculationNow },
  );
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: snapshot, locale: "ja" }),
  );

  assert.match(html, /リセット匂わせ投稿[\s\S]*あり/);
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
  assert.match(html, /Official reset notice[\s\S]*Notice available/);
  assert.doesNotMatch(html, /Official notice: None/);
  assert.doesNotMatch(html, /border-slate-50/);
});

test("keeps dashboard labels localized without extra direct-answer links", () => {
  const cases = [
    { locale: "ja" as const, notice: "公式リセット予告", noticeValue: "なし", incident: "Codex関連障害", description: "Codexのリセット予測、最新情報、過去の履歴をまとめて確認できます。", directAnswer: "今日、全体リセットはありましたか？" },
    { locale: "en" as const, notice: "Official reset notice", noticeValue: "None", incident: "Codex incidents", description: "Check Codex reset forecasts, official updates, and recent reset history in one place.", directAnswer: "Did Codex reset today?" },
    { locale: "zh" as const, notice: "官方重置预告", noticeValue: "无", incident: "Codex 相关故障", description: "集中查看 Codex 的重置预测、最新信息和近期重置记录。", directAnswer: "今天有全局重置吗？" },
  ];

  for (const item of cases) {
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, {
        initialData: toPublicRadarSnapshot(getLocalRadarData({ calculationNow: new Date("2026-08-04T00:00:00.000Z") }), item.locale, { calculationNow: new Date("2026-08-04T00:00:00.000Z") }),
        locale: item.locale,
      }),
    );

    assert.match(html, new RegExp(item.notice));
    assert.match(html, new RegExp(item.noticeValue));
    assert.match(html, new RegExp(item.incident));
    assert.match(html, new RegExp(item.description));
    assert.doesNotMatch(html, new RegExp(item.directAnswer));
    assert.doesNotMatch(html, /When is the next Codex reset\?|下一次 Codex 重置是什么时候？|予測のしくみを見る →|How the forecast works →|查看预测方式 →/);
    const outlookLabel = item.locale === "ja" ? "現在の見立て" : item.locale === "en" ? "Current outlook" : "当前判断";
    const outlookIndex = html.indexOf(outlookLabel);
    const historyLabel = item.locale === "ja" ? "リセット履歴" : item.locale === "en" ? "Reset history" : "重置历史";
    const historyIndex = html.indexOf(historyLabel, outlookIndex);
    const outlookText = html.slice(outlookIndex, historyIndex);
    assert.ok(outlookIndex >= 0);
    assert.doesNotMatch(html, /非公式の予測です|This is an unofficial forecast|本预测并非官方信息/);
    assert.doesNotMatch(outlookText, /。 /);
    if (item.locale === "en") {
      assert.doesNotMatch(outlookText, / {2,}/);
    }
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

test("joins display outlook sentences without locale-specific spacing errors", () => {
  const now = new Date("2026-08-04T00:00:00.000Z");
  const data = getLocalRadarData({ calculationNow: now });
  const baseEvaluation = getLocalSignalEvaluation(data, now);
  const branchEvaluations = [
    {
      environment: { official_updates_24h: 1 },
      statusIncidents: {},
    },
    {
      environment: {},
      statusIncidents: { activeStatusIncidentCount: 1 },
    },
    {
      environment: { issue_or_limit_anomalies_24h: 1 },
      statusIncidents: {},
    },
  ];

  for (const branch of branchEvaluations) {
    const evaluation = {
      ...baseEvaluation,
      environment: { ...baseEvaluation.environment, ...branch.environment },
      statusIncidents: { ...baseEvaluation.statusIncidents, ...branch.statusIncidents },
    };

    for (const locale of ["ja", "en", "zh"] as const) {
      const reason = getDisplayProbabilityReason(
        data,
        0.25,
        0.45,
        locale,
        evaluation,
        null,
        now,
      );

      assert.ok(reason);
      if (locale === "en") {
        assert.doesNotMatch(reason, / {2,}/);
      } else {
        assert.doesNotMatch(reason, /。 /);
      }
    }
  }
});
