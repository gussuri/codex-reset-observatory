import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { getLocalRadarData, getRandomResetHeatmapEventTimes } from "../lib/radar";
import {
  buildRandomResetTimeHeatmap,
  formatHeatmapAxisLabel,
  formatHeatmapBarLabel,
  getRawBarHeightPercent,
  getHeatmapHour,
} from "../lib/radar/resetTimeHeatmap";
import type { HistoryRecordKind, WindowEventLike } from "../lib/radar/types";

const NOW = new Date("2026-08-06T00:00:00.000Z");

function historyEvent(
  id: string,
  completedAt: string,
  recordKind: HistoryRecordKind,
  cycleType: "定期リセット" | "ランダムリセット",
  scope: string,
  extra: Partial<WindowEventLike> = {},
): WindowEventLike {
  return {
    id,
    recordKind,
    title: cycleType,
    kind: "reset_completed",
    status: "closed",
    opened_at: completedAt,
    closed_at: completedAt,
    completed_at: completedAt,
    scope,
    details: {
      cycleType,
      reasonType: cycleType === "定期リセット" ? "定期更新" : "詫びリセット",
      resetMethod: cycleType === "定期リセット" ? "強制リセット" : "任意リセット権1回配布",
      scope,
      noticeToExecution: "0分",
    },
    ...extra,
  };
}

function withLocalHistory<T>(history: WindowEventLike[], callback: () => T) {
  const previous = LOCAL_RESET_HISTORY.splice(0, LOCAL_RESET_HISTORY.length, ...history);
  try {
    return callback();
  } finally {
    LOCAL_RESET_HISTORY.splice(0, LOCAL_RESET_HISTORY.length, ...previous);
  }
}

test("uses the same random broad reset population as the probability model", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const eventTimes = getRandomResetHeatmapEventTimes(data, NOW);
  const heatmap = buildRandomResetTimeHeatmap(eventTimes, "Asia/Tokyo", NOW);

  assert.equal(eventTimes.length, 23);
  assert.deepEqual(
    heatmap.bins.map((bin) => bin.rawCount),
    [1, 6, 4, 2, 3, 0, 6, 1, 0, 0, 0, 0],
  );
  assert.equal(heatmap.totalCount, 23);
});

test("excludes regular, reference, narrow, pending, future, and invalid history", () => {
  const history = [
    historyEvent("random-forced", "2026-08-01T00:00:00.000Z", "confirmed_global", "ランダムリセット", "全有料プラン"),
    historyEvent("random-banked", "2026-08-01T02:00:00.000Z", "banked_distribution", "ランダムリセット", "全有料プラン"),
    historyEvent("regular-forced", "2026-08-01T04:00:00.000Z", "confirmed_global", "定期リセット", "全有料プラン"),
    historyEvent("regular-banked", "2026-08-01T06:00:00.000Z", "banked_distribution", "定期リセット", "全有料プラン"),
    historyEvent("reference", "2026-08-01T08:00:00.000Z", "reference", "ランダムリセット", "全有料プラン"),
    historyEvent("narrow", "2026-08-01T10:00:00.000Z", "banked_distribution", "ランダムリセット", "不具合対象ユーザー（約50万人）"),
    historyEvent("pending", "2026-08-01T12:00:00.000Z", "confirmed_global", "ランダムリセット", "全有料プラン", {
      kind: "window_opened",
      status: "open",
      closed_at: null,
      completed_at: null,
    }),
    historyEvent("future", "2026-08-07T00:00:00.000Z", "confirmed_global", "ランダムリセット", "全有料プラン"),
    historyEvent("invalid", "not-a-date", "confirmed_global", "ランダムリセット", "全有料プラン"),
  ];

  withLocalHistory(history, () => {
    const eventTimes = getRandomResetHeatmapEventTimes(getLocalRadarData({ calculationNow: NOW }), NOW);
    assert.deepEqual([...eventTimes].sort(), [
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T02:00:00.000Z",
    ]);
  });
});

test("uses the viewer IANA timezone and applies daylight saving time per event", () => {
  const instant = "2026-08-01T00:30:00.000Z";
  assert.equal(getHeatmapHour(instant, "Asia/Tokyo"), 9);
  assert.equal(getHeatmapHour(instant, "America/Los_Angeles"), 17);
  assert.equal(getHeatmapHour("2026-07-01T16:00:00.000Z", "America/New_York"), 12);
  assert.equal(getHeatmapHour("2026-12-01T17:00:00.000Z", "America/New_York"), 12);

  const tokyo = buildRandomResetTimeHeatmap([instant], "Asia/Tokyo", NOW);
  const losAngeles = buildRandomResetTimeHeatmap([instant], "America/Los_Angeles", NOW);
  assert.equal(tokyo.bins[4].rawCount, 1);
  assert.equal(losAngeles.bins[8].rawCount, 1);
});

test("uses raw record counts for bar heights and keeps empty bins", () => {
  const eventTimes = [
    "2026-08-06T00:00:00.000Z",
    "2026-07-07T00:00:00.000Z",
    "2026-06-07T00:00:00.000Z",
  ];
  const heatmap = buildRandomResetTimeHeatmap(eventTimes, "UTC", NOW);
  const bin = heatmap.bins[0];

  assert.equal(bin.rawCount, 3);
  assert.equal(heatmap.totalCount, 3);
  assert.equal(heatmap.bins.filter((item) => item.rawCount === 0).length, 11);
  assert.equal(getRawBarHeightPercent(3, 6), 50);
  assert.equal(getRawBarHeightPercent(6, 6), 100);
  assert.ok(getRawBarHeightPercent(6, 7) < 100);
  assert.equal(getRawBarHeightPercent(0, 6), 0);
  assert.equal(formatHeatmapAxisLabel(heatmap.bins[0]), "00–02");
  assert.equal(formatHeatmapAxisLabel(heatmap.bins[1]), "02–04");
  assert.equal(formatHeatmapBarLabel(heatmap.bins[0], "ja"), "00:00〜02:00・3件");
  assert.equal(formatHeatmapBarLabel(heatmap.bins[0], "en"), "00:00–02:00, 3 records");
  assert.equal(formatHeatmapBarLabel(heatmap.bins[0], "zh"), "00:00〜02:00，3条记录");
  assert.equal(Object.hasOwn(bin, "weightedCount"), false);
});
