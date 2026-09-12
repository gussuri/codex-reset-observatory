import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import { ResetHistoryDetails } from "../components/ResetHistoryDetails";

test("2026-09-12 latest reset has canonical manual correction for scope and reason", () => {
  const latestStatic = LOCAL_RESET_HISTORY[0];
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
  assert.equal(jaItem.title, "Sweet dreams リセット");
  assert.equal(jaItem.scope, "全有料プラン");
  assert.equal(jaItem.details?.scope, "全有料プラン");
  assert.equal(jaItem.details?.reasonType, "詫びリセット");
  assert.deepEqual(jaItem.resetTypes, ["詫びリセット"]);
  assert.equal(jaItem.resetType, "詫びリセット");

  const enVm = getRadarViewModel(data, "en", false, undefined, calculationNow);
  const enItem = enVm.recentHistory[0];
  assert.equal(enItem.scope, "All paid plans");
  assert.equal(enItem.details?.scope, "All paid plans");
  assert.equal(enItem.details?.reasonType, "Compensation reset");
  assert.deepEqual(enItem.resetTypes, ["Compensation reset"]);

  const zhVm = getRadarViewModel(data, "zh", false, undefined, calculationNow);
  const zhItem = zhVm.recentHistory[0];
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
