import test from "node:test";
import assert from "node:assert";
import { LOCAL_OBSERVATION_SIGNALS } from "../data/observationSignals";
import { getLocalRadarData } from "../lib/radar";
import {
  getActiveOfficialNotice,
  getLocalResetProbability,
  getDaysSinceLastGlobalReset,
} from "../lib/radar/probability";

test("reset_executed resets days since last reset to 0 and updates effectiveLatestResetAt", () => {
  const now = new Date("2026-07-18T15:00:00.000Z");
  const recentExecutionTime = now.toISOString();
  const mockRadarData = getLocalRadarData({
    formalTiboResets: [
      {
        tweet_id: "1111",
        text: "All Codex limits have been reset.",
        tweet_url: "https://x.com/thsottiaux/status/1111",
        signal_type: "reset_executed",
        confidence: 0.98,
        tweet_created_at: recentExecutionTime,
        verification_status: "confirmed",
      },
    ],
    calculationNow: now,
  });

  const days = getDaysSinceLastGlobalReset(mockRadarData as any, now);
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
  const teaserSignal = LOCAL_OBSERVATION_SIGNALS.find(
    (signal) => signal.id === "official-tibo-signs-resets-teaser-2026-07-31",
  );
  assert.ok(teaserSignal, "The Tibo teaser fixture must exist");

  const previousStatus = teaserSignal.status;
  const previousResolvedAt = teaserSignal.resolvedAt;
  const previousExpiresAt = teaserSignal.expiresAt;
  teaserSignal.status = "active";
  delete teaserSignal.resolvedAt;
  teaserSignal.expiresAt = "2099-01-01T00:00:00.000Z";

  try {
    const viewModel = getRadarViewModel(
      getLocalRadarData({
        activeTiboSignals: [
          {
            tweet_id: "tibo-teaser-fixture",
            signal_type: "teaser",
            confidence: 0.85,
            tweet_created_at: "2026-07-31T13:50:00.000Z",
            expires_at: "2099-01-01T00:00:00.000Z",
            verification_status: "auto_unverified",
          },
        ],
      }),
      "en",
    );
    const englishReason = viewModel.reasoningSummary;

    assert.ok(englishReason);
    assert.ok(englishReason.includes("Tibo's teaser post stating 'There will be signs... Resets'"), `Expected English translation, but got: "${englishReason}"`);
    assert.strictEqual(englishReason.includes("匂わせ投稿"), false, "English summary MUST NOT contain Japanese text '匂わせ投稿'");
  } finally {
    teaserSignal.status = previousStatus;
    if (previousResolvedAt === undefined) delete teaserSignal.resolvedAt;
    else teaserSignal.resolvedAt = previousResolvedAt;
    if (previousExpiresAt === undefined) delete teaserSignal.expiresAt;
    else teaserSignal.expiresAt = previousExpiresAt;
  }
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

test("dynamic official notice drives probability, card, reason, and action together", () => {
  const now = Date.now();
  const resetCreatedAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const noticeCreatedAt = new Date(now - 60 * 60 * 1000).toISOString();
  const noticeUrl = "https://x.com/tibo_maker/status/dynamic-notice";
  const data = getLocalRadarData({
    activeTiboSignals: [
      {
        tweet_id: "dynamic-reset",
        signal_type: "reset_executed",
        confidence: 0.98,
        tweet_created_at: resetCreatedAt,
        expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
      {
        tweet_id: "dynamic-notice",
        signal_type: "official_notice",
        text: "A reset notice from Tibo",
        tweet_url: noticeUrl,
        confidence: 0.96,
        tweet_created_at: noticeCreatedAt,
        expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
    ],
  });

  const viewModel = getRadarViewModel(data, "en");

  assert.strictEqual(viewModel.probability24h, 0.9);
  assert.strictEqual(viewModel.probability48h, 0.96);
  assert.strictEqual(viewModel.activeWindow.active, true);
  assert.strictEqual(viewModel.activeWindow.kind, "official");
  assert.strictEqual(viewModel.activeWindow.source, noticeUrl);
  assert.strictEqual(viewModel.activeWindow.openedAt, noticeCreatedAt);
  assert.strictEqual(viewModel.activeWindow.expectedAt, null);
  assert.match(viewModel.reasoningSummary ?? "", /official reset notice/i);
  assert.match(viewModel.action, /official reset notice/i);
});

for (const { name, signal } of [
  {
    name: "expired notice",
    signal: {
      tweet_id: "expired-notice",
      signal_type: "official_notice" as const,
      confidence: 0.95,
      tweet_created_at: "2026-08-01T11:00:00.000Z",
      expires_at: "2026-08-01T11:30:00.000Z",
      verification_status: "auto_unverified" as const,
    },
  },
  {
    name: "rejected notice",
    signal: {
      tweet_id: "rejected-notice",
      signal_type: "official_notice" as const,
      confidence: 0.95,
      tweet_created_at: "2026-08-01T11:00:00.000Z",
      expires_at: "2026-08-01T13:00:00.000Z",
      verification_status: "rejected" as const,
    },
  },
]) {
  test(`${name} is not selected as an active official notice`, () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const data = getLocalRadarData({ activeTiboSignals: [signal] });

    assert.strictEqual(getActiveOfficialNotice(data, null, now), null);
  });
}

test("notice older than latest accepted reset is not selected as an active official notice", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const data = getLocalRadarData({
    activeTiboSignals: [
      {
        tweet_id: "older-notice",
        signal_type: "official_notice",
        confidence: 0.95,
        tweet_created_at: "2026-08-01T10:00:00.000Z",
        expires_at: "2026-08-01T13:00:00.000Z",
        verification_status: "auto_unverified",
      },
      {
        tweet_id: "newer-reset",
        signal_type: "reset_executed",
        confidence: 0.95,
        tweet_created_at: "2026-08-01T11:00:00.000Z",
        expires_at: "2026-08-01T13:00:00.000Z",
        verification_status: "auto_unverified",
      },
    ],
  });

  assert.strictEqual(getActiveOfficialNotice(data, null, now), null);
});
