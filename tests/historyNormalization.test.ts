import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import { getCanonicalHistoryDetails } from "../lib/radar/historyNormalization";
import type { WindowEventLike } from "../lib/radar/types";

function withLocalHistory<T>(history: WindowEventLike[], callback: () => T) {
  const original = LOCAL_RESET_HISTORY.splice(0, LOCAL_RESET_HISTORY.length, ...history);
  try {
    return callback();
  } finally {
    LOCAL_RESET_HISTORY.splice(0, LOCAL_RESET_HISTORY.length, ...original);
  }
}

function historyEvent(overrides: Partial<WindowEventLike> = {}): WindowEventLike {
  return {
    id: "canonical-history-test",
    recordKind: "confirmed_global",
    title: "ランダムリセット",
    kind: "reset_completed",
    status: "closed",
    opened_at: "2026-08-01T07:00:00.000Z",
    closed_at: "2026-08-01T09:00:00.000Z",
    completed_at: "2026-08-01T09:00:00.000Z",
    window_minutes: 120,
    scope: "全有料プラン",
    summary: "Codexの利用上限がリセットされました。",
    source_url: "https://x.com/thsottiaux/status/1234567890",
    details: {
      cycleType: "ランダムリセット",
      reasonType: "ご祝儀リセット",
      resetMethod: "強制リセット",
      scope: "全有料プラン",
      noticeToExecution: "2時間",
      noticeType: "公式告知あり",
      note: "Codexの利用上限がリセットされました。",
    },
    ...overrides,
  };
}

test("all static history entries use the locale-neutral canonical contract", () => {
  const cycleTypes = new Set(["random", "regular", "account_specific"]);
  const reasonTypes = new Set(["celebration", "compensation", "regular_update"]);
  const resetMethods = new Set(["hard_reset", "banked_reset_distribution"]);
  const noticeTypes = new Set(["present", "none"]);

  for (const item of LOCAL_RESET_HISTORY) {
    const canonical = getCanonicalHistoryDetails(item);
    assert.ok(cycleTypes.has(canonical.cycleType), item.id);
    assert.ok(reasonTypes.has(canonical.reasonType), item.id);
    assert.ok(resetMethods.has(canonical.resetMethod), item.id);
    assert.ok(noticeTypes.has(canonical.noticeType), item.id);

    if (canonical.noticeType === "none") {
      assert.equal(canonical.noticeToExecutionMinutes, null, item.id);
      continue;
    }

    const noticeAt = Date.parse(item.opened_at ?? "");
    const resetAt = Date.parse(item.closed_at ?? item.completed_at ?? "");
    assert.ok(Number.isFinite(noticeAt) && Number.isFinite(resetAt), item.id);
    assert.ok(noticeAt <= resetAt, item.id);
    assert.equal(
      canonical.noticeToExecutionMinutes,
      Math.max(0, Math.round((resetAt - noticeAt) / 60000)),
      item.id,
    );
  }
});

test("a direct official post becomes history announcement while a teaser stays separate", () => {
  const announcement = getCanonicalHistoryDetails(historyEvent());
  assert.deepEqual(
    {
      noticeType: announcement.noticeType,
      noticeToExecutionMinutes: announcement.noticeToExecutionMinutes,
      signalKind: announcement.signalKind,
    },
    { noticeType: "present", noticeToExecutionMinutes: 120, signalKind: "announcement" },
  );

  const teaser = getCanonicalHistoryDetails(historyEvent({
    details: {
      ...historyEvent().details!,
      noticeType: "匂わせ投稿あり",
    },
  }));
  assert.deepEqual(
    {
      noticeType: teaser.noticeType,
      noticeToExecutionMinutes: teaser.noticeToExecutionMinutes,
      signalKind: teaser.signalKind,
    },
    { noticeType: "none", noticeToExecutionMinutes: null, signalKind: "teaser" },
  );
});

test("a profile-only source cannot manufacture a history announcement", () => {
  const canonical = getCanonicalHistoryDetails(historyEvent({
    source_url: "https://x.com/thsottiaux",
  }));

  assert.equal(canonical.noticeType, "none");
  assert.equal(canonical.noticeToExecutionMinutes, null);
});

test("audited static records keep an evidence-backed source and conservative notice state", () => {
  const luna = LOCAL_RESET_HISTORY.find(
    (item) => item.id === "local-luna-100k-threads-efficiency-reset-2026-08-01",
  );
  assert.ok(luna);
  assert.equal(luna.source_url, "https://x.com/thsottiaux/status/2083053369351090254");
  assert.equal(luna.opened_at, "2026-07-31T04:53:19.000Z");
  assert.equal(luna.window_minutes, 1359);
  assert.equal(luna.details?.noticeToExecution, "22時間39分");
  assert.equal(luna.details?.noticeType, "匂わせ投稿あり");
  assert.equal(getCanonicalHistoryDetails(luna).noticeType, "none");

  const aie = LOCAL_RESET_HISTORY.find(
    (item) => item.id === "personal-codex-reset-button-aie-2026-07-02",
  );
  assert.ok(aie);
  assert.equal(aie.source_url, "https://x.com/dkundel");
  assert.equal(aie.details?.noticeType, "なし");
  assert.equal(aie.details?.noticeToExecution, "0分");
  assert.equal(getCanonicalHistoryDetails(aie).noticeType, "none");
});

test("notice-free history keeps the same canonical field set in every locale", () => {
  const item = historyEvent({
    id: "monitor-only-history",
    opened_at: "2026-08-01T09:00:00.000Z",
    closed_at: "2026-08-01T09:00:00.000Z",
    completed_at: "2026-08-01T09:00:00.000Z",
    window_minutes: 0,
    source_url: null,
    details: {
      cycleType: "ランダムリセット",
      reasonType: "詫びリセット",
      resetMethod: "強制リセット",
      scope: "全有料プラン",
      noticeToExecution: "0分",
      noticeType: "なし",
    },
  });

  withLocalHistory([item], () => {
    const fieldSets = (["ja", "en", "zh"] as const).map((locale) => {
      const view = getRadarViewModel(
        getLocalRadarData({ calculationNow: new Date("2026-08-02T00:00:00.000Z") }),
        locale,
        false,
        undefined,
        new Date("2026-08-02T00:00:00.000Z"),
      );
      const history = view.recentHistory.find((candidate) => candidate.key === item.id);
      assert.ok(history, `${locale} history item should be present`);
      assert.equal(history.canonicalDetails?.noticeType, "none");
      assert.equal(history.canonicalDetails?.noticeToExecutionMinutes, null);
      assert.equal(history.details?.noticeToExecution, "");
      return Object.keys(history.details ?? {}).sort();
    });

    assert.deepEqual(fieldSets[0], fieldSets[1]);
    assert.deepEqual(fieldSets[1], fieldSets[2]);
  });
});
