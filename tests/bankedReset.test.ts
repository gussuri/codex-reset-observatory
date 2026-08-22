import assert from "node:assert/strict";
import test from "node:test";

import {
  BANKED_NOTICE_MATCH_WINDOW_MS,
  isBankedCreditGrant,
  isBankedDistributionNotice,
  isBroadBankedDistributionNotice,
  isBankedObservationWithinNoticeWindow,
} from "../lib/radar/bankedReset";
import { getLocalRadarData } from "../lib/radar";
import { getLastGlobalResetAt } from "../lib/radar/probability";
import { combineResetHistory } from "../lib/radar/tiboHistory";

const notice = {
  tweet_id: "banked-notice-1",
  text: "During the day we will credit all Codex and ChatGPT Work users with a BANKED reset.",
  tweet_url: "https://x.com/thsottiaux/status/banked-notice-1",
  tweet_created_at: "2026-08-21T12:00:00.000Z",
  signal_type: "official_notice" as const,
  confidence: 0.96,
  verification_status: "auto_unverified" as const,
};

const estimate = {
  resetEventKey: "banked-reset-banked-notice-1",
  displayExecutionAt: "2026-08-21T13:00:00.000Z",
  executionTimeSource: "usage_observation" as const,
  executionTimeConfidence: "high" as const,
  executionTimePrecision: "approximate" as const,
  executionWindowStartAt: null,
  executionWindowEndAt: null,
  recoveryObservationId: null,
  tiboAnnouncedAt: notice.tweet_created_at,
  tiboPrimaryTweetId: notice.tweet_id,
  tiboSourceTweetIds: [notice.tweet_id],
  officialNoticeTweetId: notice.tweet_id,
  officialNoticeAt: notice.tweet_created_at,
  estimatorVersion: "banked-credit-observation-v1",
};

test("recognizes a broad BANKED distribution notice without treating generic reset wording as one", () => {
  const text = "During the day we will credit all Codex and ChatGPT Work users with a BANKED reset.";

  assert.equal(isBankedDistributionNotice(text), true);
  assert.equal(isBroadBankedDistributionNotice(text), true);
  assert.equal(isBankedDistributionNotice("The reset button is my favorite product feature."), false);
  assert.equal(isBroadBankedDistributionNotice("I received a BANKED reset."), false);
  assert.equal(isBroadBankedDistributionNotice("I gave all my friends a BANKED reset."), false);
});

test("recognizes a future BANKED availability promise and its explicit broad scope", () => {
  const text = "The banked reset will be there by 8pm PST. For all paid users of ChatGPT Work and Codex.";

  assert.equal(isBankedDistributionNotice(text), true);
  assert.equal(isBroadBankedDistributionNotice(text), true);
  assert.equal(isBankedDistributionNotice("The reset button will be there by 8pm."), false);
  assert.equal(isBankedDistributionNotice("The banked reset was there yesterday."), false);
  assert.equal(isBroadBankedDistributionNotice("The banked reset will be available."), false);
});

test("accepts only a positive local credit transition as a grant observation", () => {
  assert.equal(isBankedCreditGrant({ available: false, unlimited: false, balance: "0" }, { available: true, unlimited: false, balance: "1" }), true);
  assert.equal(isBankedCreditGrant({ available: true, unlimited: false, balance: "1" }, { available: true, unlimited: false, balance: "2" }), true);
  assert.equal(isBankedCreditGrant({ available: true, unlimited: false, balance: "1" }, { available: false, unlimited: false, balance: "0" }), false);
  assert.equal(isBankedCreditGrant({ available: false, unlimited: false, balance: "0" }, { available: false, unlimited: false, balance: "0" }), false);
});

test("matches a credit observation to the resolved BANKED notice window", () => {
  const notice = {
    observedAt: "2026-08-21T12:00:00.000Z",
    expectedAt: "2026-08-21T12:30:00.000Z",
    expectedEndAt: "2026-08-22T07:00:00.000Z",
  };

  assert.equal(isBankedObservationWithinNoticeWindow(notice, "2026-08-21T12:29:00.000Z"), true);
  assert.equal(isBankedObservationWithinNoticeWindow(notice, "2026-08-22T08:31:00.000Z"), false);
  assert.equal(BANKED_NOTICE_MATCH_WINDOW_MS, 90 * 60 * 1000);
});

test("falls back to the announcement matching window when the notice has no resolved time", () => {
  const notice = {
    observedAt: "2026-08-21T12:00:00.000Z",
    expectedAt: null,
    expectedEndAt: null,
  };

  assert.equal(isBankedObservationWithinNoticeWindow(notice, "2026-08-21T13:29:00.000Z"), true);
  assert.equal(isBankedObservationWithinNoticeWindow(notice, "2026-08-21T13:31:00.000Z"), false);
});

test("does not create a BANKED history event from a notice alone", () => {
  const history = combineResetHistory([], [], [], [], [notice], [], []);
  assert.equal(history.some((item) => item.recordKind === "banked_distribution"), false);
});

test("creates one eligible banked_distribution from corroborated observation evidence", () => {
  const history = combineResetHistory([], [], [], [], [notice], [], [estimate, estimate]);
  const banked = history.filter((item) => item.recordKind === "banked_distribution");

  assert.equal(banked.length, 1);
  assert.equal(banked[0].details?.cycleType, "ランダムリセット");
  assert.equal(banked[0].details?.resetMethod, "任意リセット権1回配布");
  assert.equal(banked[0].completed_at, estimate.displayExecutionAt);
  assert.equal(banked[0].officialNoticeTweetId, notice.tweet_id);
});

test("a confirmed BANKED distribution becomes the latest eligible random boundary", () => {
  const data = getLocalRadarData({
    recentTiboSignals: [notice],
    resetExecutionEstimates: [estimate],
    calculationNow: new Date("2026-08-21T14:00:00.000Z"),
  });

  assert.equal(
    getLastGlobalResetAt(data, new Date("2026-08-21T14:00:00.000Z"))?.toISOString(),
    estimate.displayExecutionAt,
  );
});
