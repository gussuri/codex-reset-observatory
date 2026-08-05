import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { getLocalRadarData } from "../lib/radar";
import {
  getDisplayProbabilityReason,
  getLocalSignalEvaluation,
} from "../lib/radar/probability";
import { formatElapsedResetDuration } from "../lib/radar/helpers";
import type { HistoryRecordKind, WindowEventLike } from "../lib/radar/types";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-08-10T12:00:00.000Z");

function resetEvent(
  id: string,
  completedAt: string,
  recordKind: HistoryRecordKind,
  cycleType: "定期リセット" | "ランダムリセット",
  scope: string,
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
      resetMethod: "任意リセット権1回配布",
      scope,
      noticeToExecution: "0分",
    },
  };
}

function withLocalHistory<T>(history: WindowEventLike[], callback: () => T) {
  const original = LOCAL_RESET_HISTORY.splice(0, LOCAL_RESET_HISTORY.length, ...history);
  try {
    return callback();
  } finally {
    LOCAL_RESET_HISTORY.splice(0, LOCAL_RESET_HISTORY.length, ...original);
  }
}

function getReason(locale: "ja" | "en" | "zh") {
  const data = getLocalRadarData({ calculationNow: NOW });
  return getDisplayProbabilityReason(
    data,
    0.2,
    0.3,
    locale,
    getLocalSignalEvaluation(data, NOW),
    null,
    NOW,
  ) ?? "";
}

test("formats elapsed reset durations by truncated hours in Japanese", () => {
  assert.equal(formatElapsedResetDuration(59 * 60 * 1000, "ja"), "1時間未満");
  assert.equal(formatElapsedResetDuration(HOUR_MS, "ja"), "1時間");
  assert.equal(formatElapsedResetDuration(23 * HOUR_MS, "ja"), "23時間");
  assert.equal(formatElapsedResetDuration(24 * HOUR_MS, "ja"), "1日");
  assert.equal(formatElapsedResetDuration(25 * HOUR_MS, "ja"), "1日1時間");
  assert.equal(formatElapsedResetDuration(90 * HOUR_MS, "ja"), "3日18時間");
});

test("formats English singular and plural elapsed reset durations", () => {
  assert.equal(formatElapsedResetDuration(59 * 60 * 1000, "en"), "less than 1 hour");
  assert.equal(formatElapsedResetDuration(HOUR_MS, "en"), "1 hour");
  assert.equal(formatElapsedResetDuration(2 * HOUR_MS, "en"), "2 hours");
  assert.equal(formatElapsedResetDuration(24 * HOUR_MS, "en"), "1 day");
  assert.equal(formatElapsedResetDuration(25 * HOUR_MS, "en"), "1 day and 1 hour");
  assert.equal(formatElapsedResetDuration(49 * HOUR_MS, "en"), "2 days and 1 hour");
  assert.equal(formatElapsedResetDuration(4 * 24 * HOUR_MS, "en"), "4 days");
});

test("formats Chinese elapsed reset durations without spaces", () => {
  assert.equal(formatElapsedResetDuration(59 * 60 * 1000, "zh"), "不到1小时");
  assert.equal(formatElapsedResetDuration(HOUR_MS, "zh"), "1小时");
  assert.equal(formatElapsedResetDuration(90 * HOUR_MS, "zh"), "3天18小时");
  assert.equal(formatElapsedResetDuration(4 * 24 * HOUR_MS, "zh"), "4天");
});

test("uses the latest broad regular reset for elapsed display, ignoring newer reference and narrow records", () => {
  withLocalHistory(
    [
      resetEvent("regular", "2026-08-09T10:00:00.000Z", "confirmed_global", "定期リセット", "全有料プラン"),
      resetEvent("random-banked", "2026-08-09T09:00:00.000Z", "banked_distribution", "ランダムリセット", "全有料プラン"),
      resetEvent("newer-reference", "2026-08-09T11:00:00.000Z", "reference", "定期リセット", "全有料プラン"),
      resetEvent("newer-narrow", "2026-08-09T12:00:00.000Z", "banked_distribution", "ランダムリセット", "不具合対象ユーザー（約50万人）"),
    ],
    () => {
      assert.match(getReason("ja"), /直近のリセットから1日2時間経過しています。/);
    },
  );
});

test("uses a broad random banked distribution when it is the latest eligible reset", () => {
  withLocalHistory(
    [
      resetEvent("random-banked", "2026-08-09T09:00:00.000Z", "banked_distribution", "ランダムリセット", "全有料プラン"),
      resetEvent("newer-reference", "2026-08-09T10:00:00.000Z", "reference", "定期リセット", "全有料プラン"),
      resetEvent("newer-narrow", "2026-08-09T11:00:00.000Z", "banked_distribution", "ランダムリセット", "限定ユーザー"),
    ],
    () => {
      assert.match(getReason("ja"), /直近のリセットから1日3時間経過しています。/);
    },
  );
});

test("does not use reference or narrow distributions as the elapsed reset baseline", () => {
  withLocalHistory(
    [
      resetEvent("reference", "2026-08-09T10:00:00.000Z", "reference", "定期リセット", "全有料プラン"),
      resetEvent("narrow", "2026-08-09T11:00:00.000Z", "banked_distribution", "ランダムリセット", "限定ユーザー"),
    ],
    () => {
      assert.doesNotMatch(getReason("ja"), /直近のリセットから/);
    },
  );
});

test("renders the elapsed reset sentence in all supported locales", () => {
  withLocalHistory(
    [resetEvent("regular", "2026-08-09T10:00:00.000Z", "confirmed_global", "定期リセット", "全有料プラン")],
    () => {
      assert.match(getReason("ja"), /直近のリセットから1日2時間経過しています。/);
      assert.match(getReason("en"), /It has been 1 day and 2 hours since the last reset\./);
      assert.match(getReason("zh"), /距离上次重置已过去1天2小时。/);
    },
  );
});
