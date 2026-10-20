import assert from "node:assert/strict";
import test from "node:test";

import { isTiboUnscheduledOfficialNoticeEligible } from "../lib/radar/tiboNoticeEligibility";
import {
  findRelatedTiboNotices,
  type FormalTiboResetSignal,
  type TiboNoticeSignal,
} from "../lib/radar/tiboHistory";
import { interpretTiboSignal } from "../lib/radar/teaserStrength";

const TEXT = "Day 13/ Le limit reset";

function notice(overrides: Record<string, unknown> = {}) {
  return {
    tweet_id: "2115992673890824348",
    tweet_url: "https://x.com/thsottiaux/status/2115992673890824348",
    tweet_created_at: "2026-10-17T16:20:57.000Z",
    text: TEXT,
    signal_type: "official_notice",
    confidence: 0.85,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    is_reply: false,
    is_quote: false,
    ai_signal_type: "official_notice",
    ai_classification_status: "success",
    ai_temporal_direction: "unclear",
    ai_notice_timing_status: "unknown",
    ai_evidence_quote: TEXT,
    ai_temporal_expression: null,
    ai_notice_to_execution: null,
    temporal_resolution_status: "unresolved",
    temporal_expression: null,
    expected_start_at: null,
    expected_end_at: null,
    ...overrides,
  };
}

test("a high-confidence unscheduled official notice is eligible without inventing a time window", () => {
  assert.equal(isTiboUnscheduledOfficialNoticeEligible(notice()), true);
});

test("classification-contract-equivalent wording remains eligible for display and history", () => {
  const variants = [
    { tweet_id: "2115992673890824348", text: "Day 13/ Le limit reset" },
    { tweet_id: "2115992673890824349", text: "Codex usage allowances reset — timing to follow." },
    { tweet_id: "2115992673890824350", text: "Codex 的使用额度重置，时间稍后公布。" },
  ];

  for (const variant of variants) {
    const candidate = notice({
      ...variant,
      ai_evidence_quote: variant.text,
    });
    assert.equal(isTiboUnscheduledOfficialNoticeEligible(candidate), true, variant.text);
    assert.equal(
      interpretTiboSignal(candidate as Parameters<typeof interpretTiboSignal>[0]).officialNoticeEligible,
      true,
      variant.text,
    );

    const resetAt = new Date(Date.parse(candidate.tweet_created_at) + 2 * 60 * 60 * 1000).toISOString();
    const reset: FormalTiboResetSignal = {
      tweet_id: "2115992673890824399",
      tweet_url: "https://x.com/thsottiaux/status/2115992673890824399",
      tweet_created_at: resetAt,
      text: "I reset usage limits for all paid users.",
      signal_type: "reset_executed",
      confidence: 0.99,
      verification_status: "confirmed",
      classification_source: "gemini",
    };
    assert.deepEqual(
      findRelatedTiboNotices(reset, [candidate as TiboNoticeSignal]).map((item) => item.tweet_id),
      [variant.tweet_id],
      variant.text,
    );
  }
});

test("explicit cancellation, historical, and unrelated controls remain ineligible", () => {
  const rejectedCandidates = [
    notice({
      text: "Codex usage allowances reset — timing to follow, but the reset was cancelled.",
      ai_evidence_quote: "Codex usage allowances reset — timing to follow, but the reset was cancelled.",
    }),
    notice({
      text: "Codex usage allowances reset yesterday.",
      ai_evidence_quote: "Codex usage allowances reset yesterday.",
    }),
    notice({
      text: "Day 13/ server reset",
      ai_evidence_quote: "Day 13/ server reset",
    }),
    notice({
      text: "Day 13/ cooking something",
      signal_type: "irrelevant",
      ai_signal_type: "irrelevant",
      ai_evidence_quote: "Day 13/ cooking something",
    }),
  ];

  for (const candidate of rejectedCandidates) {
    assert.equal(isTiboUnscheduledOfficialNoticeEligible(candidate), false, String(candidate.text));
  }
});

test("scheduled, replied, rejected, weak, and incomplete notices do not use the unscheduled exception", () => {
  const rejectedCases = [
    notice({ ai_notice_timing_status: "known", ai_temporal_direction: "future" }),
    notice({ confidence: 0.79 }),
    notice({ is_reply: true }),
    notice({ is_quote: true }),
    notice({ verification_status: "rejected" }),
    notice({ classification_source: "rule_fallback" }),
    notice({ ai_classification_status: "invalid_schema" }),
    notice({ ai_signal_type: "irrelevant" }),
    notice({ ai_temporal_expression: "Day 13", ai_notice_to_execution: "Day 13" }),
    notice({ temporal_resolution_status: "resolved" }),
    notice({ expected_start_at: "2026-10-18T00:00:00.000Z" }),
    notice({ ai_evidence_quote: "A quote from somewhere else" }),
  ];
  for (const candidate of rejectedCases) {
    assert.equal(isTiboUnscheduledOfficialNoticeEligible(candidate), false);
  }
});
