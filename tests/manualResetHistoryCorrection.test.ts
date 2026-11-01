import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import { ResetHistoryDetails } from "../components/ResetHistoryDetails";

test("2026-09-12 latest reset has canonical manual correction for scope and reason", () => {
  const latestStatic = LOCAL_RESET_HISTORY.find(
    (item) => item.id === "local-codex-sweet-dreams-reset-2026-09-12",
  );
  assert.ok(latestStatic);
  assert.equal(latestStatic.id, "local-codex-sweet-dreams-reset-2026-09-12");
  assert.equal(latestStatic.scope, "全有料プラン");
  assert.equal(latestStatic.details?.scope, "全有料プラン");
  assert.equal(latestStatic.details?.reasonType, "詫びリセット");
  assert.equal(latestStatic.details?.cycleType, "ランダムリセット");
  assert.equal(latestStatic.details?.resetMethod, "強制リセット");
  assert.equal(latestStatic.source_url, "https://x.com/thsottiaux/status/2098685367058612394");
});

test("merging live Tibo execution signal with canonical static history produces corrected scope and reason", () => {
  const calculationNow = new Date("2026-09-12T10:00:00.000Z");
  const notice = {
    tweet_id: "2098612714704891959",
    text: "Hello Astra users. A quick update on resets and the quality issues posted recently...\n\nAnd of course, resets also happening by midnight today.",
    tweet_url: "https://x.com/thsottiaux/status/2098612714704891959",
    tweet_created_at: "2026-09-12T03:20:36+00:00",
    signal_type: "official_notice" as const,
    confidence: 1,
    verification_status: "confirmed" as const,
    classification_source: "gemini" as const,
    expected_start_at: "2026-09-12T03:20:36+00:00",
    expected_end_at: "2026-09-12T07:00:00+00:00",
    temporal_resolution_status: "resolved" as const,
  };

  const executed = {
    tweet_id: "2098685367058612394",
    text: "Reset all propagated. Sweet dreams.",
    tweet_url: "https://x.com/thsottiaux/status/2098685367058612394",
    tweet_created_at: "2026-09-12T08:09:17+00:00",
    signal_type: "reset_executed" as const,
    confidence: 1,
    verification_status: "auto_unverified" as const,
    classification_source: "gemini" as const,
  };

  const data = getLocalRadarData({
    calculationNow,
    recentTiboSignals: [notice as any, executed as any],
  });
  data.formal_tibo_resets = [executed as any];

  const jaVm = getRadarViewModel(data, "ja", false, undefined, calculationNow);
  const jaItem = jaVm.recentHistory[0];
  assert.equal(jaItem.key, "local-codex-sweet-dreams-reset-2026-09-12");
  assert.equal(jaItem.title, "品質問題修正に伴う詫びリセット");
  assert.equal(jaItem.summary, "品質問題への対応に伴い、CodexおよびChatGPT Workの利用上限が強制リセットされました。");
  assert.equal(jaItem.details?.note, "品質問題への対応に伴い、CodexおよびChatGPT Workの利用上限が強制リセットされました。");
  assert.equal(jaItem.scope, "全有料プラン");
  assert.equal(jaItem.details?.scope, "全有料プラン");
  assert.equal(jaItem.details?.reasonType, "詫びリセット");
  assert.deepEqual(jaItem.resetTypes, ["詫びリセット"]);
  assert.equal(jaItem.resetType, "詫びリセット");

  const enVm = getRadarViewModel(data, "en", false, undefined, calculationNow);
  const enItem = enVm.recentHistory[0];
  assert.equal(enItem.title, "Compensation Reset Following Quality Fixes");
  assert.equal(enItem.summary, "In response to quality issues, usage limits for Codex and ChatGPT Work were forcibly reset.");
  assert.equal(enItem.details?.note, "In response to quality issues, usage limits for Codex and ChatGPT Work were forcibly reset.");
  assert.equal(enItem.scope, "All paid plans");
  assert.equal(enItem.details?.scope, "All paid plans");
  assert.equal(enItem.details?.reasonType, "Compensation reset");
  assert.deepEqual(enItem.resetTypes, ["Compensation reset"]);

  const zhVm = getRadarViewModel(data, "zh", false, undefined, calculationNow);
  const zhItem = zhVm.recentHistory[0];
  assert.equal(zhItem.title, "质量问题修复补偿重置");
  assert.equal(zhItem.summary, "为应对质量问题，Codex 和 ChatGPT Work 的使用额度已被强制重置。");
  assert.equal(zhItem.details?.note, "为应对质量问题，Codex 和 ChatGPT Work 的使用额度已被强制重置。");
  assert.equal(zhItem.scope, "所有付费套餐");
  assert.equal(zhItem.details?.scope, "所有付费套餐");
  assert.equal(zhItem.details?.reasonType, "故障补偿重置");
  assert.deepEqual(zhItem.resetTypes, ["故障补偿重置"]);
});

test("UI rendering shows 詫びリセット reason and omits standard 全有料プラン scope row", () => {
  const calculationNow = new Date("2026-09-12T10:00:00.000Z");
  const data = getLocalRadarData({ calculationNow });
  const jaVm = getRadarViewModel(data, "ja", false, undefined, calculationNow);
  const item = jaVm.recentHistory[0];

  const html = renderToStaticMarkup(
    React.createElement(ResetHistoryDetails, { item, locale: "ja" }),
  );

  assert.ok(html.includes("詫びリセット"), "HTML should display 詫びリセット as reason");
  assert.ok(!html.includes("全有料プラン"), "HTML should omit standard 全有料プラン scope row");
});

test("Day 26 BANKED distribution observation uses historical correction and preserves active notice window", () => {
  const calculationNow = new Date("2026-10-31T20:50:00.000Z");
  const day26Notice = {
    tweet_id: "2116405414921384099",
    text: "Day 26/ You can now easily switch between multiple accounts on mobile, and coming soon to desktop too. Next two days will be resets… banked… do with this what you may .",
    tweet_url: "https://x.com/thsottiaux/status/2116405414921384099",
    tweet_created_at: "2026-10-31T05:42:26+00:00",
    signal_type: "official_notice" as const,
    confidence: 0.98,
    verification_status: "confirmed" as const,
    classification_source: "manual" as const,
    expected_start_at: "2026-11-01T07:00:00+00:00",
    expected_end_at: "2026-11-02T07:00:00+00:00",
    expires_at: "2026-11-02T15:00:00+00:00",
    temporal_resolution_status: "resolved" as const,
    temporal_expression: "Next two days",
    temporal_kind: "relative_day",
    temporal_precision: "day",
    temporal_timezone: "America/Los_Angeles",
    temporal_confidence: 0.95,
  };

  const bankedEstimate = {
    resetEventKey: "banked-reset-local-codex-app-server-observation-20261031T204018257Z",
    displayExecutionAt: "2026-10-31T20:40:18.257+00:00",
    executionTimeSource: "usage_observation" as const,
    executionTimeConfidence: "high" as const,
    executionTimePrecision: "approximate" as const,
    tiboAnnouncedAt: "2026-10-31T05:42:26+00:00",
    tiboPrimaryTweetId: "2116405414921384099",
    tiboSourceTweetIds: ["2116405414921384099"],
    officialNoticeTweetId: "2116405414921384099",
    officialNoticeAt: "2026-10-31T05:42:26+00:00",
    estimatorVersion: "banked-distribution-observation-v2" as const,
  };

  const data = getLocalRadarData({
    calculationNow,
    activeTiboSignals: [day26Notice as any],
    recentTiboSignals: [day26Notice as any],
    resetExecutionEstimates: [bankedEstimate as any],
    regularResetEvents: [],
  });

  const jaVm = getRadarViewModel(data, "ja", false, undefined, calculationNow);
  const jaItem = jaVm.recentHistory[0];
  assert.equal(jaItem.key, "banked-reset-local-codex-app-server-observation-20261031T204018257Z");
  assert.equal(jaItem.title, "アカウント切り替え機能公開記念BANKEDリセット（1日目）");
  assert.equal(jaItem.recordKind, "banked_distribution");
  assert.equal(jaItem.details?.resetMethod, "任意リセット権配布");
  assert.equal(jaItem.details?.cycleType, "ランダムリセット");
  assert.equal(jaItem.details?.reasonType, "ご祝儀リセット");
  assert.equal(jaItem.scope, "全有料プラン");
  assert.equal(jaItem.details?.scope, "全有料プラン");
  assert.equal(jaVm.activeWindow.active, true);
  assert.equal(jaVm.activeWindow.kind, "official");
});

test("Day 26 Day 2 BANKED distribution observation uses historical correction and terminates notice window", () => {
  const calculationNow = new Date("2026-11-01T22:20:00.000Z");
  const day26Notice = {
    tweet_id: "2116405414921384099",
    text: "Day 26/ You can now easily switch between multiple accounts on mobile, and coming soon to desktop too. Next two days will be resets… banked… do with this what you may .",
    tweet_url: "https://x.com/thsottiaux/status/2116405414921384099",
    tweet_created_at: "2026-10-31T05:42:26+00:00",
    signal_type: "official_notice" as const,
    confidence: 0.98,
    verification_status: "confirmed" as const,
    classification_source: "manual" as const,
    expected_start_at: "2026-11-01T07:00:00+00:00",
    expected_end_at: "2026-11-02T07:00:00+00:00",
    expires_at: "2026-11-02T15:00:00+00:00",
    temporal_resolution_status: "resolved" as const,
    temporal_expression: "Next two days",
    temporal_kind: "relative_day",
    temporal_precision: "day",
    temporal_timezone: "America/Los_Angeles",
    temporal_confidence: 0.95,
  };

  const day1Estimate = {
    resetEventKey: "banked-reset-local-codex-app-server-observation-20261031T204018257Z",
    displayExecutionAt: "2026-10-31T20:40:18.257+00:00",
    executionTimeSource: "usage_observation" as const,
    executionTimeConfidence: "high" as const,
    executionTimePrecision: "approximate" as const,
    tiboAnnouncedAt: "2026-10-31T05:42:26+00:00",
    tiboPrimaryTweetId: "2116405414921384099",
    tiboSourceTweetIds: ["2116405414921384099"],
    officialNoticeTweetId: "2116405414921384099",
    officialNoticeAt: "2026-10-31T05:42:26+00:00",
    estimatorVersion: "banked-distribution-observation-v2" as const,
  };

  const day2Estimate = {
    resetEventKey: "banked-reset-local-codex-app-server-observation-20261101T221624351Z",
    displayExecutionAt: "2026-11-01T22:16:24.351+00:00",
    executionTimeSource: "usage_observation" as const,
    executionTimeConfidence: "high" as const,
    executionTimePrecision: "approximate" as const,
    tiboAnnouncedAt: "2026-10-31T05:42:26+00:00",
    tiboPrimaryTweetId: "2116405414921384099",
    tiboSourceTweetIds: ["2116405414921384099"],
    officialNoticeTweetId: "2116405414921384099",
    officialNoticeAt: "2026-10-31T05:42:26+00:00",
    estimatorVersion: "banked-distribution-observation-v2" as const,
  };

  const data = getLocalRadarData({
    calculationNow,
    activeTiboSignals: [day26Notice as any],
    recentTiboSignals: [day26Notice as any],
    resetExecutionEstimates: [day1Estimate as any, day2Estimate as any],
    regularResetEvents: [],
  });

  const jaVm = getRadarViewModel(data, "ja", false, undefined, calculationNow);
  const day2Item = jaVm.recentHistory[0];
  assert.equal(day2Item.key, "banked-reset-local-codex-app-server-observation-20261101T221624351Z");
  assert.equal(day2Item.title, "アカウント切り替え機能公開記念BANKEDリセット（2日目）");
  assert.equal(day2Item.recordKind, "banked_distribution");
  assert.equal(day2Item.details?.resetMethod, "任意リセット権配布");
  assert.equal(day2Item.details?.cycleType, "ランダムリセット");
  assert.equal(day2Item.details?.reasonType, "ご祝儀リセット");
  assert.equal(day2Item.scope, "全有料プラン");
  assert.equal(day2Item.details?.scope, "全有料プラン");

  const day1Item = jaVm.recentHistory.find((item) => item.key === "banked-reset-local-codex-app-server-observation-20261031T204018257Z");
  assert.ok(day1Item);
  assert.equal(day1Item.title, "アカウント切り替え機能公開記念BANKEDリセット（1日目）");

  assert.equal(jaVm.activeWindow.active, false);
});
