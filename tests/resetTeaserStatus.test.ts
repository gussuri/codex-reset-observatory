import assert from "node:assert/strict";
import test from "node:test";

import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import { createObservedRegularResetEventRow } from "../lib/radar/regularResetSchedule";
import {
  aggregateResetTeaserStatus,
  getEffectiveTeaserStrength,
  getFallbackUiTeaserStrength,
  interpretTiboSignal,
} from "../lib/radar/teaserStrength";
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

function activitySignal(
  id: string,
  createdAt: string,
  teaserStrength: TeaserSignal["teaser_strength"],
  options: Partial<TeaserSignal> = {},
) {
  return signal(id, createdAt, teaserStrength, {
    text: `${id} post text`,
    tweet_url: `https://x.com/thsottiaux/status/${id}`,
    expires_at: "2026-08-05T00:00:00.000Z",
    ...options,
  });
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

test("manual final teaser strength takes precedence over the raw AI strength", () => {
  assert.equal(
    getEffectiveTeaserStrength({ teaser_strength: "weak", ai_teaser_strength: "strong" }),
    "weak",
  );
  assert.equal(
    getEffectiveTeaserStrength({ teaser_strength: null, ai_teaser_strength: "weak" }),
    "weak",
  );
  assert.equal(
    getEffectiveTeaserStrength({ teaser_strength: null, ai_teaser_strength: null }),
    null,
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

test("keeps a resolved future teaser when its forecast window follows the reset", () => {
  const resetAt = "2026-08-04T00:00:00.000Z";
  const futureWindow = {
    temporal_resolution_status: "resolved" as const,
    expected_start_at: "2026-08-04T12:00:00.000Z",
    expected_end_at: "2026-08-05T12:00:00.000Z",
  };

  assert.equal(
    aggregateResetTeaserStatus([
      signal("future-after-observation", "2026-08-03T23:58:00.000Z", "strong", futureWindow),
    ], resetAt, NOW),
    "strong",
  );
  assert.equal(
    aggregateResetTeaserStatus([
      signal("old-before-observation", "2026-08-03T23:54:59.000Z", "strong", futureWindow),
    ], resetAt, NOW),
    "strong",
  );
});

test("a later random reset consumes a teaser even after a regular boundary", () => {
  const regular = createObservedRegularResetEventRow(
    "2026-08-03T12:00:00.000Z",
    "2026-08-03T12:00:00.000Z",
  );
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow: NOW,
      regularResetEvents: [regular],
      formalTiboResets: [formalReset("2026-08-03T13:00:00.000Z")],
      recentTiboSignals: [
        signal("before-both-resets", "2026-08-03T11:00:00.000Z", "strong", {
          text: "A reset hint before both boundaries.",
          tweet_url: "https://x.com/thsottiaux/status/before-both-resets",
        }),
      ],
    }),
    "ja",
    { calculationNow: NOW },
  );

  assert.equal(snapshot.resetTeaserStatus, "none");
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

test("uses an active weak reply teaser for the related activity card", () => {
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow: NOW,
      recentTiboSignals: [
        signal("newer-irrelevant", "2026-08-03T23:30:00.000Z", "none", {
          text: "A newer unrelated post.",
          tweet_url: "https://x.com/thsottiaux/status/newer-irrelevant",
        }),
        signal("reply-weak", "2026-08-03T23:00:00.000Z", "weak", {
          is_reply: true,
          tweet_id: "reply-weak",
          signal_type: "irrelevant",
          text: "Maybe",
          tweet_url: "https://x.com/thsottiaux/status/reply-weak",
          reply_to_handles: ["@Ananth7e"],
          reply_context_text: "are we going to get a reset when codex crosses 20M users?",
        }),
      ],
    }),
    "en",
    { calculationNow: NOW },
  );

  assert.equal(snapshot.resetTeaserStatus, "weak");
  assert.equal(snapshot.latestTiboActivity?.text, "Maybe");
  assert.equal(snapshot.latestTiboActivity?.isReply, true);
  assert.equal(snapshot.latestTiboActivity?.replyContextText, "are we going to get a reset when codex crosses 20M users?");
  assert.deepEqual(snapshot.latestTiboActivity?.replyToHandles, ["@Ananth7e"]);
});

test("derives a weak UI teaser for an ambiguous reset-related official reply", () => {
  const ambiguousReply = signal("ambiguous-official-reply", "2026-08-03T23:00:00.000Z", null, {
    signal_type: "official_notice",
    confidence: 0.85,
    is_reply: true,
    text: "OK fine. But it's also still coming in Tuesday",
    reply_context_text: "you owe us a banked reset",
    temporal_resolution_status: "resolved",
    expected_start_at: "2026-08-05T00:00:00.000Z",
    expected_end_at: "2026-08-06T00:00:00.000Z",
  });

  assert.equal(getFallbackUiTeaserStrength(ambiguousReply, NOW), "weak");
  assert.equal(
    aggregateResetTeaserStatus([ambiguousReply], null, NOW),
    "weak",
  );
});

test("central interpretation separates source facts from presentation and eligibility", () => {
  const ambiguousReply = signal("ambiguous-interpretation", "2026-08-03T23:00:00.000Z", null, {
    signal_type: "official_notice",
    confidence: 0.85,
    is_reply: true,
    text: "OK fine. But it's also still coming in Tuesday",
    reply_context_text: "you owe us a banked reset",
    temporal_resolution_status: "resolved",
    expected_start_at: "2026-08-05T00:00:00.000Z",
    expected_end_at: "2026-08-06T00:00:00.000Z",
  });

  assert.deepEqual(interpretTiboSignal(ambiguousReply, NOW), {
    presentationDisposition: "weak_teaser",
    officialNoticeEligible: false,
    probabilityTeaserEligible: false,
    historyEligible: false,
    contextDependence: "reply_context",
    reason: "ambiguous_context",
    uiTeaserFallback: true,
  });
});

test("central interpretation keeps a strict official notice from becoming a duplicate teaser", () => {
  const official = signal("strict-official", "2026-08-03T23:00:00.000Z", "weak", {
    signal_type: "official_notice",
    confidence: 0.99,
    is_reply: false,
    text: "The usage reset is scheduled for tomorrow.",
    expires_at: "2026-08-05T00:00:00.000Z",
  });

  assert.deepEqual(interpretTiboSignal(official, NOW), {
    presentationDisposition: "official",
    officialNoticeEligible: true,
    probabilityTeaserEligible: false,
    historyEligible: false,
    contextDependence: "direct",
    reason: "official_source",
    uiTeaserFallback: false,
  });
});

test("central interpretation preserves direct teaser and history eligibility as separate axes", () => {
  const directTeaser = signal("direct-teaser", "2026-08-03T23:00:00.000Z", "strong", {
    signal_type: "teaser",
    confidence: 0.9,
    is_reply: false,
    text: "Maybe I will press the reset button tomorrow.",
  });
  const completed = signal("completed-reset", "2026-08-03T23:00:00.000Z", null, {
    signal_type: "reset_executed",
    confidence: 0.99,
    is_reply: false,
    text: "Usage limits have been reset for everyone.",
  });

  assert.equal(interpretTiboSignal(directTeaser, NOW).presentationDisposition, "strong_teaser");
  assert.equal(interpretTiboSignal(directTeaser, NOW).probabilityTeaserEligible, true);
  assert.equal(interpretTiboSignal(directTeaser, NOW).historyEligible, false);
  assert.equal(interpretTiboSignal(completed, NOW).presentationDisposition, "none");
  assert.equal(interpretTiboSignal(completed, NOW).historyEligible, true);
});

test("does not derive a UI teaser from ordinary, unrelated, rejected, or context-free replies", () => {
  const base = {
    is_reply: true,
    signal_type: "official_notice" as const,
    confidence: 0.85,
    temporal_resolution_status: "resolved" as const,
    expected_start_at: "2026-08-05T00:00:00.000Z",
    expected_end_at: "2026-08-06T00:00:00.000Z",
  };
  const ordinaryReply = signal("ordinary-reply", "2026-08-03T23:00:00.000Z", null, {
    ...base,
    signal_type: "irrelevant",
    text: "Always improving",
    reply_context_text: "Thanks for the update.",
  });
  const unrelatedTuesday = signal("unrelated-tuesday", "2026-08-03T23:00:00.000Z", null, {
    ...base,
    text: "I will check Tuesday",
    reply_context_text: "See you then.",
  });
  const rejected = signal("rejected-reply", "2026-08-03T23:00:00.000Z", null, {
    ...base,
    text: "The reset is still coming Tuesday",
    reply_context_text: "you owe us a reset",
    verification_status: "rejected",
  });
  const contextFree = signal("context-free-reply", "2026-08-03T23:00:00.000Z", null, {
    ...base,
    text: "The reset is still coming Tuesday",
    reply_context_text: null,
  });
  const explicitNo = signal("explicit-no-reply", "2026-08-03T23:00:00.000Z", null, {
    ...base,
    text: "No reset tonight",
    reply_context_text: "you owe us a banked reset",
  });
  const completed = signal("completed-reply", "2026-08-03T23:00:00.000Z", null, {
    ...base,
    text: "I already pressed the reset button Tuesday",
    reply_context_text: "you owe us a banked reset",
  });
  const old = signal("old-reply", "2026-07-31T23:00:00.000Z", null, {
    ...base,
    text: "It is still coming Tuesday",
    reply_context_text: "you owe us a banked reset",
  });
  const highConfidenceNotice = signal("high-confidence-notice", "2026-08-03T23:00:00.000Z", null, {
    ...base,
    is_reply: false,
    confidence: 0.99,
    text: "The reset is still coming Tuesday",
    reply_context_text: "you owe us a banked reset",
  });

  for (const candidate of [ordinaryReply, unrelatedTuesday, rejected, contextFree, explicitNo, completed, old, highConfidenceNotice]) {
    assert.equal(getFallbackUiTeaserStrength(candidate, NOW), null, candidate.tweet_id);
  }
  assert.equal(aggregateResetTeaserStatus([ordinaryReply], null, NOW), "unknown");
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

  assert.equal(snapshot.latestTiboActivity?.teaserStrength, "strong");
  assert.equal(snapshot.latestTiboActivity?.text, "A strong reset hint.");
  assert.equal(snapshot.resetTeaserStatus, "strong");
});

test("uses the newest related post while keeping status aggregation independent", () => {
  const snapshotFor = (signals: TeaserSignal[]) =>
    toPublicRadarSnapshot(
      getLocalRadarData({ calculationNow: NOW, recentTiboSignals: signals }),
      "en",
      { calculationNow: NOW },
    );

  const olderStrongNewerNone = snapshotFor([
    activitySignal("strong", "2026-08-03T21:00:00.000Z", "strong"),
    activitySignal("none", "2026-08-03T23:00:00.000Z", "none"),
  ]);
  assert.equal(olderStrongNewerNone.latestTiboActivity?.text, "strong post text");
  assert.equal(olderStrongNewerNone.resetTeaserStatus, "strong");

  const olderWeakNewerNone = snapshotFor([
    activitySignal("weak", "2026-08-03T21:00:00.000Z", "weak"),
    activitySignal("none", "2026-08-03T23:00:00.000Z", "none"),
  ]);
  assert.equal(olderWeakNewerNone.latestTiboActivity?.text, "weak post text");
  assert.equal(olderWeakNewerNone.resetTeaserStatus, "weak");

  const olderStrongNewerWeak = snapshotFor([
    activitySignal("strong", "2026-08-03T21:00:00.000Z", "strong"),
    activitySignal("weak", "2026-08-03T23:00:00.000Z", "weak"),
  ]);
  assert.equal(olderStrongNewerWeak.latestTiboActivity?.text, "weak post text");
  assert.equal(olderStrongNewerWeak.resetTeaserStatus, "strong");

  const newerNotice = snapshotFor([
    activitySignal("weak", "2026-08-03T21:00:00.000Z", "weak"),
    activitySignal("notice", "2026-08-03T23:00:00.000Z", null, {
      signal_type: "official_notice",
      confidence: 0.99,
      expires_at: "2026-08-05T01:00:00.000Z",
    }),
  ]);
  assert.equal(newerNotice.latestTiboActivity?.text, "notice post text");
  assert.equal(newerNotice.latestTiboActivity?.classification, "official_notice");

  const specificNotice = snapshotFor([
    activitySignal("daypart-notice", "2026-08-03T21:00:00.000Z", null, {
      signal_type: "official_notice",
      confidence: 0.99,
      text: "The BANKED reset will arrive during the day.",
      ai_temporal_precision: "daypart",
      temporal_resolution_status: "resolved",
      expected_start_at: "2026-08-04T00:00:00.000Z",
      expected_end_at: "2026-08-04T12:00:00.000Z",
    }),
    activitySignal("deadline-notice", "2026-08-03T22:00:00.000Z", null, {
      signal_type: "official_notice",
      confidence: 0.99,
      text: "The BANKED reset will be there by 8pm PST.",
      ai_temporal_precision: "range",
      temporal_resolution_status: "resolved",
      expected_start_at: "2026-08-04T03:00:00.000Z",
      expected_end_at: "2026-08-04T04:00:00.000Z",
    }),
    activitySignal("low-information-notice", "2026-08-03T23:00:00.000Z", null, {
      signal_type: "official_notice",
      confidence: 0.99,
      text: "Yep, still coming!",
    }),
  ]);
  assert.equal(specificNotice.latestTiboActivity?.text, "The BANKED reset will be there by 8pm PST.");
});

test("falls back to the latest normal post when no related post is valid", () => {
  const snapshotFor = (signals: TeaserSignal[]) =>
    toPublicRadarSnapshot(
      getLocalRadarData({ calculationNow: NOW, recentTiboSignals: signals }),
      "en",
      { calculationNow: NOW },
    );

  const noRelated = snapshotFor([
    activitySignal("old-strong", "2026-08-01T23:59:59.000Z", "strong"),
    activitySignal("new-none", "2026-08-03T23:30:00.000Z", "none"),
  ]);
  assert.equal(noRelated.latestTiboActivity?.text, "new-none post text");

  const beforeReset = snapshotFor([
    activitySignal("before-reset", "2026-08-01T02:00:00.000Z", "strong"),
    activitySignal("after-reset-none", "2026-08-03T23:30:00.000Z", "none"),
  ]);
  assert.equal(beforeReset.latestTiboActivity?.text, "after-reset-none post text");

  const rejected = snapshotFor([
    activitySignal("rejected-strong", "2026-08-03T21:00:00.000Z", "strong", {
      verification_status: "rejected",
    }),
    activitySignal("accepted-none", "2026-08-03T23:30:00.000Z", "none"),
  ]);
  assert.equal(rejected.latestTiboActivity?.text, "accepted-none post text");

});

test("keeps an eligible UI teaser related after its expires_at", () => {
  const snapshot = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow: NOW,
      recentTiboSignals: [
        activitySignal("expired-reply", "2026-08-03T23:00:00.000Z", "weak", {
          is_reply: true,
          expires_at: "2026-08-03T23:30:00.000Z",
          reply_to_handles: ["@Ananth7e"],
          reply_context_text: "An expired parent context.",
        }),
        activitySignal("newest-normal", "2026-08-03T23:30:00.000Z", "none"),
      ],
    }),
    "en",
    { calculationNow: NOW },
  );

  assert.equal(snapshot.resetTeaserStatus, "weak");
  assert.equal(snapshot.latestTiboActivity?.text, "expired-reply post text");
  assert.equal(snapshot.latestTiboActivity?.isReply, true);
  assert.equal(snapshot.latestTiboActivity?.replyContextText, "An expired parent context.");
  assert.deepEqual(snapshot.latestTiboActivity?.replyToHandles, ["@Ananth7e"]);
  assert.equal(snapshot.latestTiboActivity?.teaserStrength, "weak");
});

test("terminates the Astra rollout teaser at its explicit completion boundary without affecting unrelated teasers", () => {
  const beforeTermination = new Date("2026-09-04T22:30:28.999Z");
  const terminationAt = new Date("2026-09-04T22:30:29.000Z");
  const astraTeaser = activitySignal(
    "2095597168816226335",
    "2026-09-03T19:37:54.000Z",
    "weak",
  );
  const unrelatedTeaser = activitySignal(
    "unrelated-weak-teaser",
    "2026-09-04T21:30:00.000Z",
    "weak",
  );

  assert.equal(aggregateResetTeaserStatus([astraTeaser], null, beforeTermination), "weak");
  assert.equal(aggregateResetTeaserStatus([astraTeaser], null, terminationAt), "none");
  assert.equal(aggregateResetTeaserStatus([unrelatedTeaser], null, terminationAt), "weak");
});

test("expires the confirmed weak teaser at its own explicit expires_at boundary", () => {
  const beforeExpiry = new Date("2026-09-04T15:46:10.999Z");
  const expiry = new Date("2026-09-04T15:46:11.000Z");
  const teaser = activitySignal(
    "2095538856296898868",
    "2026-09-03T15:46:11.000Z",
    "weak",
  );

  assert.equal(aggregateResetTeaserStatus([teaser], null, beforeExpiry), "weak");
  assert.equal(aggregateResetTeaserStatus([teaser], null, expiry), "none");
  assert.equal(aggregateResetTeaserStatus([
    teaser,
    activitySignal("unrelated-after-expiry", "2026-09-04T15:00:00.000Z", "weak"),
  ], null, expiry), "weak");
});

test("teaser strength changes calibrated probabilities while preserving UI status", () => {
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

  assert.ok(weak.viewModel.probability24h !== undefined);
  assert.ok(weak.viewModel.probability48h !== undefined);
  assert.ok(strong.viewModel.probability24h !== undefined);
  assert.ok(strong.viewModel.probability48h !== undefined);
  assert.ok(none.viewModel.probability24h !== undefined);
  assert.ok(none.viewModel.probability48h !== undefined);
  assert.ok(weak.viewModel.probability24h > none.viewModel.probability24h);
  assert.ok(weak.viewModel.probability48h > none.viewModel.probability48h);
  assert.ok(strong.viewModel.probability24h > weak.viewModel.probability24h);
  assert.ok(strong.viewModel.probability48h > weak.viewModel.probability48h);
  assert.equal(none.resetTeaserStatus, "none");
  assert.equal(weak.resetTeaserStatus, "weak");
  assert.equal(strong.resetTeaserStatus, "strong");
});
