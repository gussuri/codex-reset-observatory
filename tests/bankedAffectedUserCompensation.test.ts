import assert from "node:assert/strict";
import test from "node:test";

import {
  isBankedDistributionNotice,
  isBroadBankedDistributionNotice,
  isConditionalBankedDistributionNotice,
} from "../lib/radar/bankedReset";
import { isEligibleRandomResetEvent } from "../lib/radar/resetEligibility";
import { findBankedDistributionEvents } from "../lib/radar/tiboHistory";

const TIBO_COMPENSATION_TEXT =
  "There was a bit of a kerfuffle this morning with some banked resets not fully applying when used in ChatGPT Work and Codex. Everyone who used one in the affected time window is getting another one and an email to apologize.";

const notice = {
  tweet_id: "2097752790177370535",
  text: TIBO_COMPENSATION_TEXT,
  tweet_url: "https://x.com/thsottiaux/status/2097752790177370535",
  tweet_created_at: "2026-09-09T18:23:34.000Z",
  signal_type: "official_notice" as const,
  confidence: 1,
  verification_status: "confirmed" as const,
};

const estimate = {
  resetEventKey: "banked-reset-2097752790177370535",
  displayExecutionAt: "2026-09-09T18:23:34.000Z",
  executionTimeSource: "manual_override" as const,
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
  estimatorVersion: "banked-distribution-observation-v2",
  manualOverrideAt: "2026-09-09T18:24:00.000Z",
  manualOverrideBy: "operator",
  manualOverrideReason: "Production manual correction for the affected-user compensation notice.",
  manualExecutionAt: "2026-09-09T18:23:34.000Z",
  manualExecutionPrecision: "approximate" as const,
};

test("recognizes affected-user BANKED compensation across adjacent sentences", () => {
  assert.equal(isBankedDistributionNotice(TIBO_COMPENSATION_TEXT), true);
  assert.equal(isBroadBankedDistributionNotice(TIBO_COMPENSATION_TEXT), true);
  assert.equal(isConditionalBankedDistributionNotice(TIBO_COMPENSATION_TEXT), true);
});

test("keeps affected-user BANKED compensation in history but out of the broad random-reset target", () => {
  const [event] = findBankedDistributionEvents([notice], [estimate]);

  assert.ok(event);
  assert.equal(event.recordKind, "banked_distribution");
  assert.equal(event.id, estimate.resetEventKey);
  assert.equal(event.randomResetTargetScope, "conditional");

  const completedAt = Date.parse(event.completed_at ?? event.closed_at ?? event.date ?? "");
  assert.equal(
    isEligibleRandomResetEvent(event, completedAt, Date.parse("2026-09-10T00:00:00.000Z")),
    false,
  );
});

test("does not treat a vague personal replacement as a BANKED distribution", () => {
  assert.equal(
    isBankedDistributionNotice(
      "I used one of my banked resets this morning. Support said I might get another one.",
    ),
    false,
  );
});

test("ties cross-sentence compensation to a reset or credit target", () => {
  assert.equal(
    isBankedDistributionNotice(
      "Banked resets had an issue. Everyone who used one in the affected time window is getting another one.",
    ),
    true,
  );
  assert.equal(
    isBankedDistributionNotice(
      "Banked resets had an issue. Everyone who was affected will receive an additional reset credit.",
    ),
    true,
  );
  assert.equal(
    isBankedDistributionNotice(
      "Banked resets had an issue. Everyone who was affected will be given a replacement banked reset.",
    ),
    true,
  );
  assert.equal(
    isBankedDistributionNotice(
      "Banked resets had an issue. Everyone who used one is getting another email.",
    ),
    false,
  );
  assert.equal(
    isBankedDistributionNotice(
      "Banked resets had an issue. Everyone who used one is getting an email.",
    ),
    false,
  );
});
