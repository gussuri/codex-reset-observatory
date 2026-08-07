import assert from "node:assert/strict";
import test from "node:test";

import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import { aggregateResetTeaserStatus } from "../lib/radar/teaserStrength";
import type { ActiveTiboSignal } from "../lib/radar/types";

const NOW = new Date("2026-08-04T00:00:00.000Z");

type TeaserSignal = ActiveTiboSignal;

function signal(
  id: string,
  createdAt: string,
  teaserStrength: TeaserSignal["teaser_strength"] = null,
  options: Partial<TeaserSignal> = {},
): TeaserSignal {
  return {
    tweet_id: id,
    signal_type: "irrelevant",
    tweet_created_at: createdAt,
    teaser_strength: teaserStrength,
    verification_status: "auto_unverified",
    ...options,
  };
}

function formalReset(tweetCreatedAt: string) {
  return {
    tweet_id: "formal-reset",
    text: "Usage limits reset for all paid users of Codex and ChatGPT Work.",
    tweet_url: "https://x.com/thsottiaux/status/formal-reset",
    tweet_created_at: tweetCreatedAt,
    signal_type: "reset_executed" as const,
    confidence: 1,
    verification_status: "auto_unverified" as const,
    classification_source: "gemini",
  };
}

test("aggregates strong over a newer none within the 48-hour window", () => {
  assert.equal(
    aggregateResetTeaserStatus([
      signal("strong", "2026-08-03T23:00:00.000Z", "strong"),
      signal("none", "2026-08-03T23:30:00.000Z", "none"),
    ], null, NOW),
    "strong",
  );
});

test("aggregates weak over newer none and none when no stronger strength exists", () => {
  assert.equal(
    aggregateResetTeaserStatus([
      signal("weak", "2026-08-03T21:00:00.000Z", "weak"),
      signal("none", "2026-08-03T23:30:00.000Z", "none"),
    ], null, NOW),
    "weak",
  );
  assert.equal(
    aggregateResetTeaserStatus([
      signal("none-1", "2026-08-03T21:00:00.000Z", "none"),
      signal("none-2", "2026-08-03T23:30:00.000Z", "none"),
    ], null, NOW),
    "none",
  );
});

test("uses the strongest classified signal among mixed posts", () => {
  assert.equal(
    aggregateResetTeaserStatus([
      signal("none", "2026-08-03T20:00:00.000Z", "none"),
      signal("weak", "2026-08-03T21:00:00.000Z", "weak"),
      signal("strong", "2026-08-03T22:00:00.000Z", "strong"),
    ], null, NOW),
    "strong",
  );
});

test("includes the 48-hour boundary, excludes older posts, and ignores expires_at", () => {
  assert.equal(
    aggregateResetTeaserStatus([
      signal("boundary", "2026-08-02T00:00:00.000Z", "strong", {
        expires_at: "2026-08-02T01:00:00.000Z",
      }),
    ], null, NOW),
    "strong",
  );
  assert.equal(
    aggregateResetTeaserStatus([
      signal("old", "2026-08-01T23:59:59.000Z", "strong"),
    ], null, NOW),
    "none",
  );
});

test("clears pre-reset strengths and keeps post-reset strengths", () => {
  const beforeReset = getLocalRadarData({
    calculationNow: NOW,
    recentTiboSignals: [
      signal("strong-before-reset", "2026-08-03T11:00:00.000Z", "strong"),
    ],
    formalTiboResets: [formalReset("2026-08-03T12:00:00.000Z")],
  });
  const afterReset = getLocalRadarData({
    calculationNow: NOW,
    recentTiboSignals: [
      signal("strong-after-reset", "2026-08-03T13:00:00.000Z", "strong"),
    ],
    formalTiboResets: [formalReset("2026-08-03T12:00:00.000Z")],
  });

  assert.equal(toPublicRadarSnapshot(beforeReset, "ja", { calculationNow: NOW }).resetTeaserStatus, "none");
  assert.equal(toPublicRadarSnapshot(afterReset, "ja", { calculationNow: NOW }).resetTeaserStatus, "strong");
});

test("returns unknown for unclassified posts, none for no posts, and accepts replies", () => {
  assert.equal(
    aggregateResetTeaserStatus([
      signal("unclassified", "2026-08-03T23:00:00.000Z", null),
    ], null, NOW),
    "unknown",
  );
  assert.equal(aggregateResetTeaserStatus([], null, NOW), "none");
  assert.equal(
    aggregateResetTeaserStatus([
      signal("reply-strong", "2026-08-03T23:00:00.000Z", "strong", { is_reply: true }),
    ], null, NOW),
    "strong",
  );
  assert.equal(
    aggregateResetTeaserStatus([
      signal("rejected-strong", "2026-08-03T23:00:00.000Z", "strong", {
        verification_status: "rejected",
      }),
    ], null, NOW),
    "none",
  );
});

test("uses reply teaser strength for the UI status without turning the reply into latest activity", () => {
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow: NOW,
      recentTiboSignals: [
        signal("reply-strong", "2026-08-03T23:00:00.000Z", "strong", {
          is_reply: true,
          tweet_id: "reply-strong",
          signal_type: "irrelevant",
          text: "A reply with a strong reset hint.",
          tweet_url: "https://x.com/thsottiaux/status/reply-strong",
        }),
      ],
    }),
    "en",
    { calculationNow: NOW },
  );

  assert.equal(snapshot.resetTeaserStatus, "strong");
  assert.equal(snapshot.latestTiboActivity, null);
});

test("keeps the latest post projection separate from the aggregated teaser status", () => {
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow: NOW,
      recentTiboSignals: [
        signal("latest-none", "2026-08-03T23:30:00.000Z", "none", {
          tweet_id: "latest-none",
          signal_type: "irrelevant",
          text: "A newer unrelated post.",
          tweet_url: "https://x.com/thsottiaux/status/latest-none",
        }),
        signal("older-strong", "2026-08-03T23:00:00.000Z", "strong", {
          tweet_id: "older-strong",
          signal_type: "teaser",
          text: "A strong reset hint.",
          tweet_url: "https://x.com/thsottiaux/status/older-strong",
        }),
      ],
    }),
    "en",
    { calculationNow: NOW },
  );

  assert.equal(snapshot.latestTiboActivity?.teaserStrength, "none");
  assert.equal(snapshot.resetTeaserStatus, "strong");
});

test("changing teaser strength only changes the UI status, not published probabilities", () => {
  const makeSnapshot = (teaserStrength: TeaserSignal["teaser_strength"]) =>
    toPublicRadarSnapshot(
      getLocalRadarData({
        calculationNow: NOW,
        activeTiboSignals: [
          {
            tweet_id: `probability-${teaserStrength ?? "unknown"}`,
            signal_type: "irrelevant",
            text: "Unrelated post",
            tweet_url: "https://x.com/thsottiaux/status/probability",
            tweet_created_at: "2026-08-03T23:00:00.000Z",
            expires_at: "2026-08-05T23:00:00.000Z",
            verification_status: "auto_unverified",
            teaser_strength: teaserStrength,
          },
        ],
      }),
      "ja",
      { calculationNow: NOW },
    );

  const none = makeSnapshot("none");
  const weak = makeSnapshot("weak");
  const strong = makeSnapshot("strong");

  assert.deepEqual(
    [weak.viewModel.probability24h, weak.viewModel.probability48h],
    [none.viewModel.probability24h, none.viewModel.probability48h],
  );
  assert.deepEqual(
    [strong.viewModel.probability24h, strong.viewModel.probability48h],
    [none.viewModel.probability24h, none.viewModel.probability48h],
  );
});
