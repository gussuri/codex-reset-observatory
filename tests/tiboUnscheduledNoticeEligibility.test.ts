import assert from "node:assert/strict";
import test from "node:test";

import { isTiboUnscheduledOfficialNoticeEligible } from "../lib/radar/tiboNoticeEligibility";

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

test("only semantically grounded usage-limit notices use the unscheduled notice threshold", () => {
  for (const text of [
    "Day 13/ Le limit reset was cancelled",
    "Day 13/ Le limit reset happened yesterday",
    "Day 13/ cooking something",
    "Day 13/ server reset",
  ]) {
    assert.equal(
      isTiboUnscheduledOfficialNoticeEligible(notice({ text, ai_evidence_quote: text })),
      false,
      text,
    );
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
