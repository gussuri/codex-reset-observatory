import assert from "node:assert/strict";
import test from "node:test";

import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import { interpretTiboSignal, type ResetTeaserSignal } from "../lib/radar/teaserStrength";
import type { ActiveTiboSignal } from "../lib/radar/types";

const parentId = "2113162277688070445";
const replyId = "2113162413008884099";
const revision = "a".repeat(64);
const parentText = "Day 17/ Bet you thought we forgot, but no, it’s reset day today.";
const replyText = "Lands tomorrow before 10am PST.";

function verifiedReplySignal(overrides: Record<string, unknown> = {}) {
  return {
    tweet_id: replyId,
    signal_type: "official_notice",
    text: replyText,
    tweet_url: `https://x.com/thsottiaux/status/${replyId}`,
    tweet_created_at: "2026-10-22T06:55:54.000Z",
    expires_at: "2026-10-23T06:55:54.000Z",
    confidence: 0.98,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    ai_signal_type: "official_notice",
    ai_confidence: 0.98,
    ai_classification_status: "success",
    ai_temporal_direction: "future",
    ai_notice_timing_status: "known",
    ai_evidence_quote: replyText,
    ai_temporal_expression: "tomorrow before 10am PST",
    ai_temporal_precision: "range",
    ai_temporal_timezone: "PST",
    ai_contextual_reset_assessment: "same_global_reset",
    ai_contextual_reset_tweet_id: parentId,
    is_reply: true,
    is_quote: false,
    reply_to_handles: ["@thsottiaux"],
    reply_context_text: parentText,
    source_context_snapshot: {
      parent: {
        tweetId: parentId,
        tweetUrl: `https://x.com/thsottiaux/status/${parentId}`,
        authorHandle: "@thsottiaux",
        text: parentText,
      },
    },
    source_context_revision_hashes: [revision],
    source_context_classified_revision_hashes: [revision],
    source_context_generation: 1,
    temporal_expression: "tomorrow before 10am PST",
    temporal_precision: "range",
    temporal_timezone: "PST",
    temporal_confidence: 0.95,
    temporal_resolution_status: "resolved",
    temporal_resolution_version: "tibo-temporal-v9-deadline-start-estimate",
    expected_start_at: "2026-10-22T15:00:00.000Z",
    expected_end_at: "2026-10-22T18:00:00.000Z",
    ...overrides,
  } as unknown as ResetTeaserSignal;
}

test("a complete source-validated future self-reply is an official deadline notice", () => {
  const signal = verifiedReplySignal();
  const interpretation = interpretTiboSignal(signal, new Date("2026-10-22T10:00:00.000Z"));

  assert.equal(interpretation.officialNoticeEligible, true);

  const internal = getLocalRadarData({
    calculationNow: new Date("2026-10-22T10:00:00.000Z"),
    activeTiboSignals: [signal as unknown as ActiveTiboSignal],
    recentTiboSignals: [signal as unknown as ActiveTiboSignal],
  });
  const snapshot = toPublicRadarSnapshot(internal, "en", {
    calculationNow: new Date("2026-10-22T10:00:00.000Z"),
  });

  assert.equal(snapshot.viewModel.activeWindow.kind, "official");
  assert.equal(snapshot.viewModel.activeWindow.expectedAt, "2026-10-22T15:00:00.000Z");
  assert.equal(snapshot.viewModel.activeWindow.expectedEndAt, "2026-10-22T18:00:00.000Z");
  assert.equal(snapshot.viewModel.activeWindow.source, `https://x.com/thsottiaux/status/${replyId}`);
});

test("manual confirmation keeps the existing official reply admission path", () => {
  const signal = verifiedReplySignal({
    verification_status: "confirmed",
    classification_source: "manual",
  });

  assert.equal(
    interpretTiboSignal(signal, new Date("2026-10-22T10:00:00.000Z")).officialNoticeEligible,
    true,
  );
});

test("future self-reply notice fails closed when its raw AI and source revision evidence disagree", () => {
  const mismatches: Array<[string, Record<string, unknown>]> = [
    ["revision mismatch", { source_context_classified_revision_hashes: ["b".repeat(64)] }],
    ["different parent", { ai_contextual_reset_tweet_id: "2113162277688070446" }],
    ["third-party parent", {
      reply_to_handles: ["@thirdparty"],
      reply_context_text: "Third party reset context.",
      ai_contextual_reset_tweet_id: "2113162277688070411",
      source_context_snapshot: {
        parent: {
          tweetId: "2113162277688070411",
          tweetUrl: "https://x.com/thirdparty/status/2113162277688070411",
          authorHandle: "@thirdparty",
          text: "Third party reset context.",
        },
      },
    }],
    ["incomplete source context", { source_context_snapshot: null }],
  ];

  for (const [label, override] of mismatches) {
    const interpretation = interpretTiboSignal(
      verifiedReplySignal(override),
      new Date("2026-10-22T10:00:00.000Z"),
    );
    assert.equal(interpretation.officialNoticeEligible, false, label);
  }
});
