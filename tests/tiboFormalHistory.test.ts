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

test("reset_executed below the confidence threshold is excluded", () => {
  assert.equal(isFormalTiboResetSignal(resetSignal({ confidence: 0.94 })), false);
});

test("teaser and irrelevant signals are excluded from formal history", () => {
  assert.equal(isFormalTiboResetSignal(resetSignal({ signal_type: "teaser" })), false);
  assert.equal(isFormalTiboResetSignal(resetSignal({ signal_type: "irrelevant" })), false);
});

test("rejected reset_executed is excluded while confirmed reset_executed is accepted", () => {
  assert.equal(
    isFormalTiboResetSignal(resetSignal({ verification_status: "rejected" })),
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
  assert.equal(event.summary, "Tibo氏がCodexとChatGPT Workの利用上限リセット完了を発表しました。");
  assert.equal(event.details?.resetMethod, "強制リセット");
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
  assert.equal(combined[0].title, dynamic.title);
  assert.equal(combined[0].summary, dynamic.summary);
});

test("formal reset updates latest reset time and regular forecast anchor", () => {
  const data = getLocalRadarData({ formalTiboResets: [resetSignal()] });
  const latest = getLastGlobalResetAt(data);
  const viewModel = getRadarViewModel(data, "ja", false);

  assert.equal(latest?.toISOString(), resetSignal().tweet_created_at);
  assert.equal(viewModel.regularResetForecast.lastCompletedAt, resetSignal().tweet_created_at);
  assert.equal(
    viewModel.regularResetForecast.expectedAt,
    new Date(new Date(resetSignal().tweet_created_at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
