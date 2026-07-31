import test from "node:test";
import assert from "node:assert";
import { getLocalRadarData } from "../lib/radar";
import { getLocalResetProbability, getDaysSinceLastGlobalReset } from "../lib/radar/probability";

test("reset_executed resets days since last reset to 0 and updates effectiveLatestResetAt", () => {
  const recentExecutionTime = new Date().toISOString();
  const mockRadarData = getLocalRadarData({
    activeTiboSignals: [
      {
        tweet_id: "1111",
        signal_type: "reset_executed",
        confidence: 0.98,
        tweet_created_at: recentExecutionTime,
        expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
    ],
  });

  const days = getDaysSinceLastGlobalReset(mockRadarData as any);
  assert.strictEqual(days, 0, "Days since last reset should be 0 when a recent reset_executed exists");
});

test("old teaser before reset_executed is not counted into probability boost", () => {
  const now = Date.now();
  const oldTeaserTime = new Date(now - 2 * 3600 * 1000).toISOString(); // 2 hours ago
  const resetExecutedTime = new Date(now - 1 * 3600 * 1000).toISOString(); // 1 hour ago

  const mockRadarData = getLocalRadarData({
    activeTiboSignals: [
      {
        tweet_id: "teaser_1",
        signal_type: "teaser",
        confidence: 0.85,
        tweet_created_at: oldTeaserTime,
        expires_at: new Date(now + 22 * 3600 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
      {
        tweet_id: "reset_1",
        signal_type: "reset_executed",
        confidence: 0.98,
        tweet_created_at: resetExecutedTime,
        expires_at: new Date(now + 23 * 3600 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
    ],
  });

  const p24 = getLocalResetProbability(mockRadarData as any, "24h");
  // Old teaser before reset_executed must NOT trigger 90% notice mode or boost
  assert.ok(p24 < 0.90, "Old teaser before reset_executed must not boost or trigger notice mode");
});

test("new official_notice after reset_executed triggers Notice Mode (90%/96%)", () => {
  const now = Date.now();
  const resetExecutedTime = new Date(now - 2 * 3600 * 1000).toISOString(); // 2 hours ago
  const newNoticeTime = new Date(now - 1 * 3600 * 1000).toISOString(); // 1 hour ago (AFTER reset)

  const mockRadarData = getLocalRadarData({
    activeTiboSignals: [
      {
        tweet_id: "reset_1",
        signal_type: "reset_executed",
        confidence: 0.98,
        tweet_created_at: resetExecutedTime,
        expires_at: new Date(now + 22 * 3600 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
      {
        tweet_id: "notice_1",
        signal_type: "official_notice",
        confidence: 0.96,
        tweet_created_at: newNoticeTime,
        expires_at: new Date(now + 23 * 3600 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
    ],
  });

  const p24 = getLocalResetProbability(mockRadarData as any, "24h");
  const p48 = getLocalResetProbability(mockRadarData as any, "48h");

  assert.strictEqual(p24, 0.90, "New notice after execution must trigger 24h 90% Notice Mode");
  assert.strictEqual(p48, 0.96, "New notice after execution must trigger 48h 96% Notice Mode");
});

import { getRadarViewModel } from "../lib/radar";

test("getLocalResetProbabilityReason formats English summary without un-translated Japanese text for Tibo Teaser", () => {
  const viewModel = getRadarViewModel(getLocalRadarData(), "en");
  const englishReason = viewModel.reasoningSummary;

  assert.strictEqual(typeof englishReason, "string");
  assert.ok(englishReason.includes("Tibo's teaser post stating 'There will be signs... Resets'"), `Expected English translation, but got: "${englishReason}"`);
  assert.strictEqual(englishReason.includes("匂わせ投稿"), false, "English summary MUST NOT contain Japanese text '匂わせ投稿'");
});

test("old reset_executed does not cancel newer official_notice", () => {
  const now = Date.now();
  const oldExecutionTime = new Date(now - 5 * 3600 * 1000).toISOString(); // 5 hours ago
  const newNoticeTime = new Date(now - 1 * 3600 * 1000).toISOString(); // 1 hour ago

  const mockRadarData = getLocalRadarData({
    activeTiboSignals: [
      {
        tweet_id: "old_reset",
        signal_type: "reset_executed",
        confidence: 0.98,
        tweet_created_at: oldExecutionTime,
        expires_at: new Date(now + 19 * 3600 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
      {
        tweet_id: "new_notice",
        signal_type: "official_notice",
        confidence: 0.96,
        tweet_created_at: newNoticeTime,
        expires_at: new Date(now + 23 * 3600 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
    ],
  });

  const p24 = getLocalResetProbability(mockRadarData as any, "24h");
  assert.strictEqual(p24, 0.90, "Old execution must not cancel newer notice");
});
