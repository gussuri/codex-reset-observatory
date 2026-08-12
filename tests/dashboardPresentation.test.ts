import React from "react";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AboutView } from "../components/AboutView";
import { formatScheduledSourceDay, RadarDashboard } from "../components/RadarDashboard";
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
  assert.match(html, />23%</);
  assert.match(html, />77%</);
  assert.match(html, /rounded-lg border p-4 pl-6 lg:p-5 lg:pl-7/);
  assert.match(html, /text-sm font-medium lg:text-base/);
  assert.match(html, /mt-2 text-3xl font-semibold lg:mt-3 lg:text-4xl/);
  assert.match(html, /aria-valuenow="23"/);
  assert.match(html, /aria-valuenow="77"/);
});

test("formats probability cards as localized whole percentages", () => {
  assert.equal(formatProbabilityDisplay(0.213, "ja"), "21%");
  assert.equal(formatProbabilityDisplay(0.765, "en"), "77%");
  assert.equal(formatProbabilityDisplay(0.405, "zh"), "41%");
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
        teaserStrength: null,
        text: "リセットとは関係のない投稿です。",
        createdAt: "2026-08-07T05:23:00.000Z",
        sourceUrl: "https://x.com/thsottiaux/status/123",
      },
    }),
  );

  assert.match(html, /Tiboの最新投稿/);
  assert.match(html, /<blockquote[^>]*>/);
  assert.match(html, /aria-hidden="true"[^>]*>「<\/span>/);
  assert.match(html, />リセットとは関係のない投稿です。<\/span>/);
  assert.match(html, /aria-hidden="true"[^>]*>」<\/span>/);
  assert.match(html, /リセットとは無関係/);
  assert.match(html, /Tibo \(@thsottiaux\)/);
  assert.doesNotMatch(html, /Tibo氏の最新動向|>その他</);
});

test("uses the UI teaser strength for card classification without changing signal type", () => {
  const html = renderToStaticMarkup(
    React.createElement(TiboActivityCard, {
      locale: "ja",
      activity: {
        classification: "irrelevant",
        teaserStrength: "weak",
        text: "I feel Theo is in need of a reset",
        createdAt: "2026-08-07T21:46:56.000Z",
        sourceUrl: "https://x.com/thsottiaux/status/2085845171363791135",
      },
    }),
  );

  assert.match(html, /弱いリセット匂わせ/);
  assert.doesNotMatch(html, /リセットとは無関係/);
});

test("renders a related Tibo heading when the card uses the related variant", () => {
  const html = renderToStaticMarkup(
    React.createElement(TiboActivityCard, {
      locale: "en",
      variant: "related",
      activity: {
        classification: "official_notice",
        teaserStrength: null,
        text: "A current notice",
        createdAt: "2026-08-07T21:46:56.000Z",
        sourceUrl: "https://x.com/thsottiaux/status/related-variant",
      },
    }),
  );

  assert.match(html, /Related Tibo post/);
  assert.match(html, /Tibo \(@thsottiaux\)/);
  assert.doesNotMatch(html, /Latest Tibo post/);
});

test("keeps the Tibo handle unchanged across supported locales", () => {
  for (const locale of ["ja", "en", "zh"] as const) {
    const html = renderToStaticMarkup(
      React.createElement(TiboActivityCard, {
        locale,
        variant: "related",
        activity: {
          classification: "official_notice",
          teaserStrength: null,
          text: "A current notice",
          createdAt: "2026-08-07T21:46:56.000Z",
          sourceUrl: "https://x.com/thsottiaux/status/locale-handle",
        },
      }),
    );

    assert.match(html, /Tibo \(@thsottiaux\)/);
  }
});

test("places a related Tibo card after current status and before history", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow,
      activeTiboSignals: [
        {
          tweet_id: "presentation-related-official",
          signal_type: "official_notice",
          text: "A reset notice from Tibo",
          tweet_url: "https://x.com/thsottiaux/status/presentation-related-official",
          tweet_created_at: "2026-08-03T23:00:00.000Z",
          expires_at: "2026-08-05T00:00:00.000Z",
          confidence: 0.96,
          verification_status: "auto_unverified",
        },
        {
          tweet_id: "presentation-related-weak",
          signal_type: "irrelevant",
          text: "I might reset limits for good feedback.",
          tweet_url: "https://x.com/thsottiaux/status/presentation-related-weak",
          tweet_created_at: "2026-08-03T22:00:00.000Z",
          expires_at: "2026-08-05T00:00:00.000Z",
          verification_status: "auto_unverified",
          teaser_strength: "weak",
        },
      ],
    }),
    "en",
    { calculationNow },
  );
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: snapshot, locale: "en" }),
  );

  const noticeIndex = html.indexOf("Reset-related notice");
  const relatedIndex = html.indexOf("Related Tibo post");
  const statusIndex = html.indexOf("Current status");
  const historyIndex = html.indexOf("Recent reset events");

  assert.ok(noticeIndex >= 0 && noticeIndex < statusIndex);
  assert.ok(statusIndex < relatedIndex && relatedIndex < historyIndex);
  assert.equal((html.match(/Related Tibo post/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Latest Tibo post/);
});

test("places strong and weak related cards before history, while none and unknown stay below history", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const cases = [
    { strength: "strong" as const, text: "I feel like a reset soon." },
    { strength: "weak" as const, text: "I might reset limits for good feedback." },
  ];

  for (const item of cases) {
    const snapshot = toPublicRadarSnapshot(
      getLocalRadarData({
        calculationNow,
        recentTiboSignals: [
          {
            tweet_id: `presentation-${item.strength}`,
            signal_type: "irrelevant",
            text: item.text,
            tweet_url: `https://x.com/thsottiaux/status/presentation-${item.strength}`,
            tweet_created_at: "2026-08-03T23:00:00.000Z",
            expires_at: "2026-08-05T00:00:00.000Z",
            verification_status: "auto_unverified",
            teaser_strength: item.strength,
          },
        ],
      }),
      "en",
      { calculationNow },
    );
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, { initialData: snapshot, locale: "en" }),
    );
    const statusIndex = html.indexOf("Current status");
    const relatedIndex = html.indexOf("Related Tibo post");
    const historyIndex = html.indexOf("Recent reset events");

    assert.ok(statusIndex >= 0 && statusIndex < relatedIndex);
    assert.ok(relatedIndex < historyIndex);
    assert.equal((html.match(/Related Tibo post/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Latest Tibo post/);
  }

  for (const strength of ["none", null] as const) {
    const snapshot = toPublicRadarSnapshot(
      getLocalRadarData({
        calculationNow,
        recentTiboSignals: [
          {
            tweet_id: `presentation-${strength ?? "unknown"}`,
            signal_type: "irrelevant",
            text: "An unrelated Tibo post.",
            tweet_url: `https://x.com/thsottiaux/status/presentation-${strength ?? "unknown"}`,
            tweet_created_at: "2026-08-03T23:00:00.000Z",
            expires_at: "2026-08-05T00:00:00.000Z",
            verification_status: "auto_unverified",
            teaser_strength: strength,
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
    assert.equal((html.match(/Latest Tibo post/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Related Tibo post/);
  }
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
  const intervalHeadings = {
    ja: "過去のランダムリセット間隔",
    en: "Past random reset intervals",
    zh: "过去的随机重置间隔",
  } as const;
  const intervalDescriptions = {
    ja: "過去のランダムリセットどうしの間隔を集計しています。前回のランダムリセットから次のランダムリセットまでの経過時間です。",
    en: "Past intervals between consecutive random resets are grouped by elapsed time. Each interval runs from one random reset to the next.",
    zh: "按经过时间汇总连续两次随机重置之间的间隔。每个间隔从一次随机重置到下一次随机重置。",
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
    const weekdayIndex = html.indexOf(weekdayHeadings[locale]);
    const heatmapIndex = html.indexOf(headings[locale]);
    const intervalIndex = html.indexOf(intervalHeadings[locale]);

    assert.ok(historyIndex >= 0);
    assert.ok(heatmapIndex > historyIndex);
    assert.ok(intervalIndex > weekdayIndex);
    assert.ok(html.includes(descriptions[locale]));
    assert.match(html, new RegExp(locale === "ja" ? "時刻" : locale === "en" ? "Time" : "时间"));
    assert.match(html, new RegExp(locale === "ja" ? "全期間" : locale === "en" ? "All time" : "全部期间"));
    assert.match(html, new RegExp(locale === "ja" ? "直近1か月" : locale === "en" ? "Last month" : "最近1个月"));
    assert.match(html, new RegExp(locale === "ja" ? "過去のランダムリセット曜日" : locale === "en" ? "Past random reset weekdays" : "过去的随机重置星期几"));
    assert.match(html, new RegExp(intervalHeadings[locale]));
    assert.match(html, new RegExp(intervalDescriptions[locale]));
    assert.match(html, new RegExp(locale === "ja" ? "aria-pressed=\"true\"[^>]*>直近1か月" : locale === "en" ? "aria-pressed=\"true\"[^>]*>Last month" : "aria-pressed=\"true\"[^>]*>最近1个月"));
    assert.doesNotMatch(html, /mx-auto w-full max-w-2xl|mx-auto mt-4 w-full max-w-md/);
    assert.match(html, new RegExp(`<h2 class="text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">${weekdayHeadings[locale]}`));
    assert.doesNotMatch(html, /閲覧者のタイムゾーン|Viewer time zone|查看者时区/);
    assert.match(html, new RegExp(`aria-busy="true"[^>]*aria-label="${headings[locale]}"`));
    assert.match(html, /class="block aspect-\[1\.35\] min-w-0 rounded bg-slate-200/);
    assert.match(html, /grid grid-cols-8/);
    assert.doesNotMatch(html, /Raw count|Weighted share|加权构成比/);
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

test("shows an unresolved notice without inventing a planned datetime", (t: TestContext) => {
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
        tweet_url: "https://x.com/thsottiaux/status/presentation-notice",
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

  assert.match(html, /Planned reset/);
  assert.match(html, /time not specified/);
  assert.doesNotMatch(html, /An official reset notice has been detected\. Please check the latest status\./);
  assert.doesNotMatch(html, /Notice posted/);
  assert.match(html, /Tibo \(@thsottiaux\)/);
});

test("shows a resolved notice window with only the viewer-local schedule and source", () => {
  const openedAt = "2026-08-08T20:34:50.000Z";
  const expectedStartAt = "2026-08-10T07:00:00.000Z";
  const expectedEndAt = "2026-08-11T07:00:00.000Z";
  const data = getLocalRadarData({
    calculationNow: new Date(openedAt),
    activeTiboSignals: [
      {
        tweet_id: "presentation-resolved-notice",
        signal_type: "official_notice",
        text: "I'll do another performative reset on Monday",
        tweet_url: "https://x.com/thsottiaux/status/presentation-resolved-notice",
        tweet_created_at: openedAt,
        expires_at: "2026-08-11T09:00:00.000Z",
        confidence: 0.96,
        verification_status: "auto_unverified",
        ai_temporal_expression: "on Monday",
        ai_temporal_kind: "weekday",
        ai_temporal_precision: "day",
        ai_temporal_timezone: "America/Los_Angeles",
        ai_temporal_confidence: 0.95,
        expected_start_at: expectedStartAt,
        expected_end_at: expectedEndAt,
        temporal_resolution_status: "resolved",
        temporal_resolution_version: "tibo-temporal-v1",
      },
    ],
  });

  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(data, "en", { calculationNow: new Date(openedAt) }),
      initialFetchedAt: openedAt,
      locale: "en",
    }),
  );

  assert.match(html, /Planned reset/);
  assert.doesNotMatch(html, /An official notice says another reset is planned for Monday\. Please check the latest status\./);
  assert.match(html, /An official reset notice is active, making a reset more likely\./);
  assert.doesNotMatch(html, /time not specified|Pacific Time|In the viewer(?:&#x27;|')s local time/);
  assert.equal((html.match(/I(?:&#x27;|')ll do another performative reset on Monday/g) ?? []).length, 1);
  assert.doesNotMatch(html, />[^<]*2026-08-10T07:00:00\.000Z/);

  const jaHtml = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(data, "ja", { calculationNow: new Date(openedAt) }),
      initialFetchedAt: openedAt,
      locale: "ja",
    }),
  );
  assert.doesNotMatch(jaHtml, /月曜日に再度リセットを行う予定との予告があります。最新状況をご確認ください。/);
  assert.match(jaHtml, /公式のリセット予告があり、リセットの見込みが高まっています。/);
  assert.match(jaHtml, /リセット予定/);
  assert.doesNotMatch(jaHtml, /Pacific Time|閲覧者の現地時刻換算|時刻未定/);
  assert.equal((jaHtml.match(/I(?:&#x27;|')ll do another performative reset on Monday/g) ?? []).length, 1);

  const zhHtml = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(data, "zh", { calculationNow: new Date(openedAt) }),
      initialFetchedAt: openedAt,
      locale: "zh",
    }),
  );
  assert.doesNotMatch(zhHtml, /有官方预告称计划在星期一再次重置。请确认最新状态。/);
  assert.match(zhHtml, /重置安排/);
  assert.match(zhHtml, /有官方重置预告，重置的可能性正在上升。/);
  assert.doesNotMatch(zhHtml, /太平洋时间|按查看者当地时间换算/);
});

test("formats all Japanese schedule weekdays with compact parentheses", () => {
  const mondayAtSourceMidnight = Date.parse("2026-08-10T07:00:00.000Z");
  const labels = Array.from({ length: 7 }, (_, offset) =>
    formatScheduledSourceDay(
      new Date(mondayAtSourceMidnight + offset * 24 * 60 * 60 * 1000).toISOString(),
      "America/Los_Angeles",
      "ja",
    ),
  );

  assert.deepEqual(labels, [
    "8月10日（月）",
    "8月11日（火）",
    "8月12日（水）",
    "8月13日（木）",
    "8月14日（金）",
    "8月15日（土）",
    "8月16日（日）",
  ]);
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
  const outlookIndex = html.indexOf("現在の見込み");
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
  assert.match(html, /現在の見込み/);
  assert.doesNotMatch(html, /現在、目立った観測変化はありません。/);
  assert.match(outlookText, /前回のリセット|最近はリセット|現在、大きな変化/);
  assert.match(html, /radar-grid relative h-11 w-11 shrink-0/);
  assert.match(html, /mt-2 max-w-2xl text-xs leading-5 text-slate-600/);
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

test("aligns reset history notice and execution timestamps in a desktop grid", () => {
  const calculationNow = new Date("2026-08-12T00:00:00.000Z");
  const baseSnapshot = toPublicRadarSnapshot(getLocalRadarData({ calculationNow }), "ja", { calculationNow });
  const template = baseSnapshot.viewModel.recentHistory.find((item) => item.resetAt);
  if (!template) throw new Error("Expected a reset history item for the presentation test");

  const historyItem = {
    ...template,
    key: "timestamp-alignment-test",
    recordKind: "confirmed_global" as const,
    title: "テストリセット",
    signalLabel: "予告",
    signalAt: "2026-08-10T20:34:00.000Z",
    resetLabel: "実施",
    resetAt: "2026-08-11T00:00:00.000Z",
    executionTimePrecision: "approximate" as const,
    source: "https://x.com/thsottiaux/status/timestamp-alignment-test",
    details: {
      ...(template.details ?? {
        cycleType: "ランダムリセット",
        reasonType: "ランダムリセット",
        resetMethod: "強制リセット",
        scope: "全体",
        noticeToExecution: "0分",
      }),
      cycleType: "ランダムリセット",
    },
  };
  const alignedSnapshot = {
    ...baseSnapshot,
    viewModel: {
      ...baseSnapshot.viewModel,
      recentHistory: [historyItem],
    },
  };
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: alignedSnapshot, locale: "ja" }),
  );

  const historyIndex = html.indexOf("テストリセット");
  const noticeLabelIndex = html.indexOf(">予告：</span>", historyIndex);
  const executionLabelIndex = html.indexOf(">実施：</span>", historyIndex);
  const sourceIndex = html.indexOf("ソース", executionLabelIndex);
  assert.ok(historyIndex >= 0);
  assert.ok(noticeLabelIndex > historyIndex);
  assert.ok(executionLabelIndex > noticeLabelIndex);
  assert.ok(sourceIndex > executionLabelIndex);
  assert.match(html, /sm:grid sm:grid-cols-\[auto_auto\] sm:justify-end sm:gap-x-3/);
  assert.match(html, /tabular-nums/);

  const labels = {
    ja: [">予告：</span>", ">実施：</span>"],
    en: [">Notice: </span>", ">Reset: </span>"],
    zh: [">预告：</span>", ">执行：</span>"],
  } as const;
  for (const locale of ["ja", "en", "zh"] as const) {
    const localizedHtml = renderToStaticMarkup(
      React.createElement(RadarDashboard, { initialData: alignedSnapshot, locale }),
    );
    for (const label of labels[locale]) assert.match(localizedHtml, new RegExp(label));
  }

  const withoutNoticeSnapshot = {
    ...alignedSnapshot,
    viewModel: {
      ...alignedSnapshot.viewModel,
      recentHistory: [{ ...historyItem, signalLabel: "", signalAt: null }],
    },
  };
  const withoutNoticeHtml = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: withoutNoticeSnapshot, locale: "ja" }),
  );
  assert.doesNotMatch(withoutNoticeHtml, />予告：<\/span>/);
  assert.match(withoutNoticeHtml, />実施：<\/span>/);
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
  assert.match(html, /A Codex incident is active, making a reset more likely/);
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
          teaser_strength: "strong",
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

test("the existing reset teaser status row displays weak and none without adding another status", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const weakSnapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow,
      recentTiboSignals: [
        {
          tweet_id: "dashboard-weak-teaser",
          signal_type: "irrelevant",
          text: "I occasionally do oblige for solid feedback.",
          tweet_url: "https://x.com/thsottiaux/status/dashboard-weak-teaser",
          tweet_created_at: "2026-08-03T23:00:00.000Z",
          expires_at: "2026-08-05T23:00:00.000Z",
          verification_status: "auto_unverified",
          teaser_strength: "weak",
        },
      ],
    }),
    "ja",
    { calculationNow },
  );
  const noneSnapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow,
      recentTiboSignals: [
        {
          tweet_id: "dashboard-none-teaser",
          signal_type: "irrelevant",
          text: "No reset tonight.",
          tweet_url: "https://x.com/thsottiaux/status/dashboard-none-teaser",
          tweet_created_at: "2026-08-03T23:00:00.000Z",
          expires_at: "2026-08-05T23:00:00.000Z",
          verification_status: "auto_unverified",
          teaser_strength: "none",
        },
      ],
    }),
    "ja",
    { calculationNow },
  );

  const weakHtml = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: weakSnapshot, locale: "ja" }),
  );
  const noneHtml = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: noneSnapshot, locale: "ja" }),
  );

  assert.match(weakHtml, /リセット匂わせ投稿[\s\S]*あり（弱）/);
  assert.equal((weakHtml.match(/リセット匂わせ投稿/g) ?? []).length, 1);
  assert.match(noneHtml, /リセット匂わせ投稿[\s\S]*なし/);
  assert.doesNotMatch(noneHtml, /リセットへの前向き発言/);
});

test("teaser strength labels stay natural in English and Simplified Chinese", () => {
  const calculationNow = new Date("2026-08-04T00:00:00.000Z");
  const internal = getLocalRadarData({
    calculationNow,
    recentTiboSignals: [
      {
        tweet_id: "localized-weak-teaser",
        signal_type: "irrelevant",
        text: "I occasionally do oblige for solid feedback.",
        tweet_url: "https://x.com/thsottiaux/status/localized-weak-teaser",
        tweet_created_at: "2026-08-03T23:00:00.000Z",
        expires_at: "2026-08-05T23:00:00.000Z",
        verification_status: "auto_unverified",
        teaser_strength: "weak",
      },
    ],
  });

  const englishHtml = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(internal, "en", { calculationNow }),
      locale: "en",
    }),
  );
  const chineseHtml = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(internal, "zh", { calculationNow }),
      locale: "zh",
    }),
  );

  assert.match(englishHtml, /Reset teaser[\s\S]*Present \(weak\)/);
  assert.match(chineseHtml, /重置暗示帖[\s\S]*有（较弱）/);
});

test("keeps the simplified official notice card above the probability card", (t: TestContext) => {
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
        tweet_url: "https://x.com/thsottiaux/status/presentation-official-notice",
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

  const noticeIndex = html.indexOf("Planned reset");
  const probabilityIndex = html.indexOf("Within 24h");

  assert.ok(noticeIndex >= 0 && noticeIndex < probabilityIndex);
  assert.doesNotMatch(html, /Notice posted/);
  assert.match(html, /Tibo \(@thsottiaux\)/);
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
    const outlookLabel = item.locale === "ja" ? "現在の見込み" : item.locale === "en" ? "Current outlook" : "当前判断";
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

test("explains the shared Codex and Work usage pool in localized About and FAQ content", () => {
  const cases = {
    ja: {
      about: "CodexとChatGPT Workは、対象プランでは同じエージェント利用量・クレジットのプールを共有しています。",
      question: "ChatGPT Workのリセットも関係ありますか？",
      answer: "その共有利用枠に対するリセットであれば、CodexだけでなくChatGPT Workの利用にも関係します。",
    },
    en: {
      about: "On eligible plans, Codex and ChatGPT Work share the same agentic usage and credits pool.",
      question: "Does a Codex reset also affect ChatGPT Work?",
      answer: "A reset affecting that shared pool can therefore affect both Codex and ChatGPT Work",
    },
    zh: {
      about: "在符合条件的方案中，Codex 和 ChatGPT Work 共享同一个代理式使用量和额度池。",
      question: "Codex 的重置也会影响 ChatGPT Work 吗？",
      answer: "影响这一共享额度池的重置也可能影响两者。",
    },
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const aboutHtml = renderToStaticMarkup(React.createElement(AboutView, { locale }));
    const faqHtml = renderToStaticMarkup(React.createElement(FaqView, { locale }));

    assert.ok(aboutHtml.includes(cases[locale].about), locale);
    assert.ok(aboutHtml.includes("Codex") || locale === "zh", locale);
    assert.ok(faqHtml.includes(cases[locale].question), locale);
    assert.ok(faqHtml.includes(cases[locale].answer), locale);
    assert.match(faqHtml, /"@type":"FAQPage"/);
  }
});

test("adds stable ChatGPT reset FAQ anchors and keeps the whole-service distinction", () => {
  const cases = {
    ja: {
      work: "ChatGPT Workのリセットも関係ありますか？",
      reset: "ChatGPTのリセットとCodexのリセットは同じですか？",
      distinction: "すべてのChatGPT利用制限がCodexと同じわけではありません。",
    },
    en: {
      work: "Does a Codex reset also affect ChatGPT Work?",
      reset: "Is a ChatGPT reset the same as a Codex reset?",
      distinction: "Not all ChatGPT usage limits are the same as Codex limits.",
    },
    zh: {
      work: "Codex 的重置也会影响 ChatGPT Work 吗？",
      reset: "ChatGPT 的重置和 Codex 的重置是同一回事吗？",
      distinction: "并非所有 ChatGPT 使用限制都与 Codex 的限制相同。",
    },
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const html = renderToStaticMarkup(React.createElement(FaqView, { locale }));

    assert.match(html, new RegExp(`id="chatgpt-work-reset"`));
    assert.match(html, new RegExp(`id="chatgpt-reset"`));
    assert.ok(html.includes(cases[locale].work), locale);
    assert.ok(html.includes(cases[locale].reset), locale);
    assert.ok(html.includes(cases[locale].distinction), locale);
    assert.match(html, /"@type":"FAQPage"/);
  }
});

test("public FAQ wording names only the displayed 24-hour and 48-hour forecasts", () => {
  const html = renderToStaticMarkup(React.createElement(FaqView, { locale: "en" }));

  assert.match(html, /within the next 24 or 48 hours/);
  assert.doesNotMatch(html, /next 12, 24, 48, or 72 hours/);
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
