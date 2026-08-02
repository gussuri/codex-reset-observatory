import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import {
  getLastGlobalResetAt,
  getRecent7DayResetCount,
} from "../lib/radar/probability";
import {
  combineResetHistory,
  convertTiboResetSignalToHistoryEvent,
  findRelatedTiboNotice,
  isFormalTiboResetSignal,
  type FormalTiboResetSignal,
  type TiboNoticeSignal,
} from "../lib/radar/tiboHistory";

function resetSignal(overrides: Partial<FormalTiboResetSignal> = {}): FormalTiboResetSignal {
  return {
    tweet_id: "2083395449814229287",
    text: "I have reset usage limits for Codex and ChatGPT Work.",
    tweet_url: "https://x.com/thsottiaux/status/2083395449814229287",
    tweet_created_at: "2026-08-01T09:00:00.000Z",
    detected_at: "2026-08-01T09:01:00.000Z",
    signal_type: "reset_executed",
    confidence: 0.98,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    ai_classification_status: "success",
    ai_reset_type_ja: "ご祝儀リセット",
    ai_notice_to_execution: null,
    expires_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function noticeSignal(overrides: Partial<TiboNoticeSignal> = {}): TiboNoticeSignal {
  return {
    tweet_id: "notice-1",
    text: "A reset is coming soon.",
    tweet_url: "https://x.com/thsottiaux/status/notice-1",
    tweet_created_at: "2026-08-01T07:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.96,
    verification_status: "auto_unverified",
    ...overrides,
  };
}

test("Gemini reset_executed is eligible for formal history", () => {
  assert.equal(isFormalTiboResetSignal(resetSignal()), true);
});

test("rule_fallback reset_executed is eligible for formal history", () => {
  assert.equal(
    isFormalTiboResetSignal(
      resetSignal({ classification_source: "rule_fallback", ai_classification_status: "rate_limited" }),
    ),
    true,
  );
});

test("rule reset_executed is eligible for formal history", () => {
  assert.equal(
    isFormalTiboResetSignal(resetSignal({ classification_source: "rule" })),
    true,
  );
});

test("shadow reset_executed is eligible for formal history", () => {
  assert.equal(
    isFormalTiboResetSignal(resetSignal({ classification_source: "shadow" })),
    true,
  );
});

test("reset_executed below the confidence threshold is excluded", () => {
  assert.equal(
    isFormalTiboResetSignal(resetSignal({ classification_source: "rule", confidence: 0.94 })),
    false,
  );
});

test("teaser and irrelevant signals are excluded from formal history", () => {
  assert.equal(isFormalTiboResetSignal(resetSignal({ signal_type: "teaser" })), false);
  assert.equal(isFormalTiboResetSignal(resetSignal({ signal_type: "irrelevant" })), false);
});

test("rejected reset_executed is excluded while confirmed reset_executed is accepted", () => {
  assert.equal(
    isFormalTiboResetSignal(
      resetSignal({ classification_source: "rule", verification_status: "rejected" }),
    ),
    false,
  );
  assert.equal(
    isFormalTiboResetSignal(
      resetSignal({ verification_status: "confirmed", classification_source: "rule" }),
    ),
    true,
  );
});

test("formal adoption ignores expires_at", () => {
  const signal = resetSignal({ expires_at: "2026-07-01T00:00:00.000Z" });
  assert.equal(isFormalTiboResetSignal(signal), true);
  assert.equal(convertTiboResetSignalToHistoryEvent(signal).id, `tibo-reset-${signal.tweet_id}`);
});

test("official notice is preferred over a teaser and only a prior post is linked", () => {
  const reset = resetSignal();
  const related = findRelatedTiboNotice(reset, [
    noticeSignal({ tweet_id: "teaser-1", signal_type: "teaser", tweet_created_at: "2026-08-01T08:00:00.000Z" }),
    noticeSignal({ tweet_id: "notice-2", tweet_created_at: "2026-08-01T07:30:00.000Z" }),
    noticeSignal({ tweet_id: "future", tweet_created_at: "2026-08-01T09:30:00.000Z" }),
  ]);

  assert.equal(related?.tweet_id, "notice-2");
  assert.equal(findRelatedTiboNotice(reset, [noticeSignal({ tweet_created_at: "2026-07-29T00:00:00.000Z" })]), null);
});

test("notice-to-execution duration and notice type are stored in the converted event", () => {
  const reset = resetSignal();
  const notice = noticeSignal({ tweet_created_at: "2026-08-01T07:00:00.000Z" });
  const event = convertTiboResetSignalToHistoryEvent(reset, notice);

  assert.equal(event.opened_at, notice.tweet_created_at);
  assert.equal(event.completed_at, reset.tweet_created_at);
  assert.equal(event.window_minutes, 120);
  assert.equal(event.details?.noticeToExecution, "2時間");
  assert.equal(event.details?.noticeType, "公式予告あり");
});

test("converted event uses a conservative scope and a fixed factual summary", () => {
  const event = convertTiboResetSignalToHistoryEvent(
    resetSignal({ text: "I have reset usage limits." }),
  );

  assert.equal(event.scope, "Codex / ChatGPT Work");
  assert.equal(event.title, "ランダムリセット");
  assert.equal(event.summary, "Tibo氏がCodexの利用上限リセット完了を発表しました。");
  assert.equal(event.details?.cycleType, "ランダムリセット");
  assert.equal(event.details?.reasonType, "ご祝儀リセット");
  assert.equal(event.details?.note, "Tibo氏がCodexの利用上限リセット完了を発表しました。");
  assert.equal(event.details?.resetMethod, "強制リセット");
});

test("automatically generated Tibo history is localized without Japanese leakage", () => {
  const japaneseCharacters = /[\u3040-\u30FF]/;
  const cases = [
    { id: "celebration", reason: "ご祝儀リセット", text: "I reset usage limits for Codex and ChatGPT Work." },
    { id: "compensation", reason: "詫びリセット", text: "I reset usage limits for Codex." },
    { id: "regular", reason: "定期リセット", text: "I reset usage limits for ChatGPT Work." },
    { id: "fallback", reason: null, text: "I reset usage limits." },
  ] as const;

  for (const testCase of cases) {
    const signal = resetSignal({
      tweet_id: `i18n-auto-reset-${testCase.id}`,
      tweet_url: `https://x.com/thsottiaux/status/i18n-auto-reset-${testCase.id}`,
      text: testCase.text,
      ai_reset_type_ja: testCase.reason,
    });
    const data = getLocalRadarData({ formalTiboResets: [signal] });

    for (const locale of ["en", "zh"] as const) {
      const viewModel = getRadarViewModel(data, locale, false);
      const item = viewModel.recentHistory.find(
        (historyItem) => historyItem.key === `tibo-reset-${signal.tweet_id}`,
      );

      assert.ok(item, `${locale} Tibo history item should be present`);
      assert.equal(item.title, locale === "en" ? "Unscheduled reset" : "随机重置");
      assert.equal(
        item.details?.reasonType,
        locale === "en"
          ? testCase.reason === "ご祝儀リセット"
              ? "Celebration reset"
            : testCase.reason === "詫びリセット"
              ? "Compensation reset"
              : testCase.reason === "定期リセット"
                ? "Weekly reset"
                : "Unscheduled reset"
          : testCase.reason === "ご祝儀リセット"
            ? "庆祝重置"
            : testCase.reason === "詫びリセット"
              ? "故障补偿重置"
              : testCase.reason === "定期リセット"
                ? "定期重置"
                : "随机重置",
      );
      assert.equal(
        item.summary,
        locale === "en"
          ? "Tibo announced that Codex usage limits were reset."
          : "Tibo 宣布 Codex 的使用限制已重置。",
      );
      assert.equal(item.details?.note, item.summary);
      const visibleText = [
        item.title,
        item.summary,
        item.details?.cycleType,
        item.details?.reasonType,
        item.details?.resetMethod,
        item.details?.scope,
        item.details?.noticeToExecution,
        item.details?.noticeType,
        item.details?.note,
        viewModel.latestWindow.title,
        viewModel.latestWindow.summary,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ");

      assert.doesNotMatch(
        visibleText,
        japaneseCharacters,
        `${locale} Tibo history contains un-translated Japanese text: ${visibleText}`,
      );
    }
  }
});

test("static and dynamic history entries with the same tweet URL are merged once", () => {
  const dynamic = convertTiboResetSignalToHistoryEvent(resetSignal());
  const staticItem = {
    ...dynamic,
    id: "static-copy",
    title: "手動で詳しく記録したリセット",
    summary: "静的履歴の詳しい概要",
  };

  const combined = combineResetHistory([staticItem], [resetSignal()]);

  assert.equal(combined.length, 1);
  assert.equal(combined[0].id, dynamic.id);
  assert.equal(combined[0].title, staticItem.title);
  assert.equal(combined[0].summary, staticItem.summary);
});

test("manual static history overrides automatic Tibo values for the same tweet", () => {
  const signal = resetSignal({
    tweet_id: "2083999999999999999",
    tweet_url: "https://x.com/thsottiaux/status/2083999999999999999",
    text: "I reset usage limits.",
  });
  const manualItem = {
    id: "manual-corrected-reset",
    title: "2026年8月1日 ランダムリセット",
    kind: "reset_completed",
    status: "closed",
    opened_at: "2026-08-01T08:00:00.000Z",
    closed_at: "2026-08-01T09:00:00.000Z",
    completed_at: "2026-08-01T09:00:00.000Z",
    window_minutes: 60,
    scope: "全有料プラン",
    summary: "手動確認済みの正確な補足です。",
    source_url: signal.tweet_url,
    details: {
      cycleType: "ランダムリセット",
      reasonType: "詫びリセット",
      resetMethod: "任意リセット権1回配布",
      scope: "全有料プラン",
      noticeToExecution: "1時間",
      noticeType: "公式予告あり",
      note: "手動確認済みの正確な補足です。",
    },
  };

  const combined = combineResetHistory([manualItem], [signal]);
  const merged = combined.find((item) => item.id === `tibo-reset-${signal.tweet_id}`);

  assert.ok(merged);
  assert.equal(merged.title, manualItem.title);
  assert.equal(merged.summary, manualItem.summary);
  assert.equal(merged.closed_at, manualItem.closed_at);
  assert.deepEqual(merged.details, manualItem.details);
});

test("legacy static entries sharing a profile URL remain separate history records", () => {
  const combined = combineResetHistory([
    {
      id: "legacy-reset-1",
      title: "過去のリセット1",
      kind: "reset_completed",
      status: "closed",
      closed_at: "2026-07-28T03:00:00.000Z",
      completed_at: "2026-07-28T03:00:00.000Z",
      source_url: "https://x.com/thsottiaux",
      details: {
        cycleType: "ランダムリセット",
        reasonType: "ご祝儀リセット",
        resetMethod: "強制リセット",
        scope: "全有料プラン",
        noticeToExecution: "0分",
        note: "過去の記録1",
      },
    },
    {
      id: "legacy-reset-2",
      title: "過去のリセット2",
      kind: "reset_completed",
      status: "closed",
      closed_at: "2026-07-29T03:00:00.000Z",
      completed_at: "2026-07-29T03:00:00.000Z",
      source_url: "https://x.com/thsottiaux",
      details: {
        cycleType: "ランダムリセット",
        reasonType: "詫びリセット",
        resetMethod: "強制リセット",
        scope: "全有料プラン",
        noticeToExecution: "0分",
        note: "過去の記録2",
      },
    },
  ], []);

  assert.equal(combined.length, 2);
  assert.deepEqual(
    combined.map((item) => item.id).sort(),
    ["legacy-reset-1", "legacy-reset-2"],
  );
});

test("legacy static entries sharing a tweet URL remain separate when their reset methods differ", () => {
  const combined = combineResetHistory([
    {
      id: "legacy-forced-reset",
      title: "定期リセット",
      kind: "reset_completed",
      status: "closed",
      closed_at: "2026-06-18T07:00:00.000Z",
      completed_at: "2026-06-18T07:00:00.000Z",
      source_url: "https://x.com/thsottiaux/status/2066956441173323943",
      details: {
        cycleType: "定期リセット",
        reasonType: "定期更新",
        resetMethod: "強制リセット",
        scope: "全有料プラン",
        noticeToExecution: "0分（定期）",
        note: "定期リセット",
      },
    },
    {
      id: "legacy-manual-reset",
      title: "詫びリセット権配布",
      kind: "reset_completed",
      status: "closed",
      closed_at: "2026-06-18T07:00:00.000Z",
      completed_at: "2026-06-18T07:00:00.000Z",
      source_url: "https://x.com/thsottiaux/status/2066956441173323943",
      details: {
        cycleType: "ランダムリセット",
        reasonType: "詫びリセット",
        resetMethod: "任意リセット権1回配布",
        scope: "全有料プラン",
        noticeToExecution: "0分",
        note: "任意リセット権配布",
      },
    },
  ], []);

  assert.equal(combined.length, 2);
  assert.deepEqual(
    combined.map((item) => item.id).sort(),
    ["legacy-forced-reset", "legacy-manual-reset"],
  );
});

test("formal reset updates latest reset time and regular forecast anchor", () => {
  const signal = resetSignal({
    tweet_id: "2083999999999999998",
    tweet_url: "https://x.com/thsottiaux/status/2083999999999999998",
  });
  const data = getLocalRadarData({ formalTiboResets: [signal] });
  const latest = getLastGlobalResetAt(data);
  const viewModel = getRadarViewModel(data, "ja", false);

  assert.equal(latest?.toISOString(), signal.tweet_created_at);
  assert.equal(viewModel.regularResetForecast.lastCompletedAt, signal.tweet_created_at);
  assert.equal(
    viewModel.regularResetForecast.expectedAt,
    new Date(new Date(signal.tweet_created_at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  );
});

test("formal reset contributes to the recent seven-day reset count", () => {
  const withoutDynamic = getRecent7DayResetCount(getLocalRadarData({ formalTiboResets: [] }));
  const withDynamic = getRecent7DayResetCount(
    getLocalRadarData({
      formalTiboResets: [
        resetSignal({
          tweet_id: "unique-recent-reset",
          tweet_url: "https://x.com/thsottiaux/status/unique-recent-reset",
          tweet_created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        }),
      ],
    }),
  );

  assert.equal(withDynamic, withoutDynamic + 1);
});

test("formal reset remains in history after its signal expiry", () => {
  const data = getLocalRadarData({
    formalTiboResets: [resetSignal({ expires_at: "2026-07-01T00:00:00.000Z" })],
  });
  const history = getRadarViewModel(data, "ja", false).recentHistory;

  assert.equal(history.some((item) => item.key === "tibo-reset-2083395449814229287"), true);
});

test("rejected dynamic reset allows the latest reset to fall back to static history", () => {
  const acceptedData = getLocalRadarData({ formalTiboResets: [resetSignal()] });
  const rejectedData = getLocalRadarData({
    formalTiboResets: [],
    rejectedTiboResets: [resetSignal()],
  });

  const acceptedLatest = getLastGlobalResetAt(acceptedData)?.getTime() ?? 0;
  const rejectedLatest = getLastGlobalResetAt(rejectedData)?.getTime() ?? 0;

  assert.ok(acceptedLatest > rejectedLatest);
  assert.notEqual(rejectedLatest, new Date(resetSignal().tweet_created_at).getTime());
});

test("the corrected static 2026-08-01 record points to the executed tweet", () => {
  const record = LOCAL_RESET_HISTORY.find((item) => item.id === "local-luna-100k-threads-efficiency-reset-2026-08-01");
  assert.equal(record?.source_url, "https://x.com/thsottiaux/status/2083395449814229287");
});
