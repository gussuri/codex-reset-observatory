import assert from "node:assert/strict";
import test from "node:test";

import { isNewFormalAdoption } from "../lib/radar/formalAdoption";
import type { FormalTiboResetSignal } from "../lib/radar/tiboHistory";
import { preserveTiboWebhookState } from "../lib/radar/tiboWebhookState";

const receivedAt = "2026-08-05T00:00:00.000Z";

function payload() {
  return {
    tweet_id: "2084000000000000200",
    detected_at: receivedAt,
    verification_status: "auto_unverified" as const,
  };
}

function formalCandidate(verificationStatus: "auto_unverified" | "confirmed" | "rejected"): FormalTiboResetSignal {
  return {
    tweet_id: "2084000000000000200",
    text: "I reset usage limits for Codex.",
    tweet_url: "https://x.com/thsottiaux/status/2084000000000000200",
    tweet_created_at: "2026-08-04T00:00:00.000Z",
    signal_type: "reset_executed",
    confidence: 0.98,
    verification_status: verificationStatus,
    classification_source: "gemini",
  };
}

test("new webhook rows receive auto_unverified and the current detection time", () => {
  assert.deepEqual(preserveTiboWebhookState(payload(), null, receivedAt), payload());
});

test("resending an auto_unverified row preserves its first detection time", () => {
  const result = preserveTiboWebhookState(payload(), {
    detected_at: "2026-08-04T12:00:00.000Z",
    verification_status: "auto_unverified",
  }, receivedAt);

  assert.equal(result.verification_status, "auto_unverified");
  assert.equal(result.detected_at, "2026-08-04T12:00:00.000Z");
});

test("resending a confirmed row never demotes it to auto_unverified", () => {
  const result = preserveTiboWebhookState(payload(), {
    detected_at: "2026-08-04T12:00:00.000Z",
    verification_status: "confirmed",
  }, receivedAt);

  assert.equal(result.verification_status, "confirmed");
  assert.equal(result.detected_at, "2026-08-04T12:00:00.000Z");
});

test("resending a rejected row never promotes it or changes its detection time", () => {
  const result = preserveTiboWebhookState(payload(), {
    detected_at: "2026-08-04T12:00:00.000Z",
    verification_status: "rejected",
  }, receivedAt);

  assert.equal(result.verification_status, "rejected");
  assert.equal(result.detected_at, "2026-08-04T12:00:00.000Z");
});

test("a null detection time is initialized on the next delivery", () => {
  const result = preserveTiboWebhookState(payload(), {
    detected_at: null,
    verification_status: "auto_unverified",
  }, receivedAt);

  assert.equal(result.verification_status, "auto_unverified");
  assert.equal(result.detected_at, receivedAt);
});

test("manual final classification and reply context survive webhook reprocessing", () => {
  const result = preserveTiboWebhookState({
    ...payload(),
    signal_type: "irrelevant",
    confidence: 0.95,
    classification_reason: "Gemini saw no parent context.",
    classification_source: "gemini",
    teaser_strength: null,
    is_reply: false,
    reply_to_handles: [],
    reply_context_text: null,
    source_timeline: "with_replies",
  }, {
    detected_at: "2026-08-16T19:06:58.000Z",
    verification_status: "confirmed",
    signal_type: "teaser",
    confidence: 0.95,
    classification_reason: "手動修正: 親投稿への条件付き返信としてweak teaserと確認。",
    classification_source: "manual",
    teaser_strength: "weak",
    is_reply: true,
    reply_to_handles: ["@Ananth7e"],
    reply_context_text: "are we going to get a reset when codex crosses 20M users?",
    source_timeline: "with_replies",
  }, receivedAt);

  assert.equal(result.signal_type, "teaser");
  assert.equal(result.confidence, 0.95);
  assert.equal(result.classification_source, "manual");
  assert.equal(result.teaser_strength, "weak");
  assert.equal(result.is_reply, true);
  assert.deepEqual(result.reply_to_handles, ["@Ananth7e"]);
  assert.equal(result.reply_context_text, "are we going to get a reset when codex crosses 20M users?");
  assert.equal(result.verification_status, "confirmed");
});

test("preserved confirmed and rejected states cannot trigger formal adoption again", () => {
  const confirmedPayload = preserveTiboWebhookState(payload(), {
    verification_status: "confirmed",
    detected_at: "2026-08-04T12:00:00.000Z",
  }, receivedAt);
  const rejectedPayload = preserveTiboWebhookState(payload(), {
    verification_status: "rejected",
    detected_at: "2026-08-04T12:00:00.000Z",
  }, receivedAt);

  assert.equal(
    isNewFormalAdoption(formalCandidate(confirmedPayload.verification_status), formalCandidate("confirmed")),
    false,
  );
  assert.equal(
    isNewFormalAdoption(formalCandidate(rejectedPayload.verification_status), formalCandidate("rejected")),
    false,
  );
  assert.equal(
    isNewFormalAdoption(
      formalCandidate("confirmed"),
      { ...formalCandidate("confirmed"), classification_source: "manual" },
    ),
    false,
  );
});

test("confirmed and rejected rows lock automatic classification fields while audit fields refresh", () => {
  for (const verificationStatus of ["confirmed", "rejected"] as const) {
    const result = preserveTiboWebhookState({
      ...payload(),
      signal_type: "official_notice",
      confidence: 0.51,
      classification_reason: "new automatic result",
      classification_source: "gemini",
      teaser_strength: "strong",
      ai_signal_type: "official_notice",
    }, {
      ...formalCandidate(verificationStatus),
      tweet_id: payload().tweet_id,
      signal_type: "teaser",
      confidence: 0.95,
      classification_reason: "reviewed decision",
      classification_source: "manual",
      teaser_strength: "weak",
      detected_at: "2026-08-04T12:00:00.000Z",
    }, receivedAt);

    assert.equal(result.signal_type, "teaser");
    assert.equal(result.confidence, 0.95);
    assert.equal(result.classification_reason, "reviewed decision");
    assert.equal(result.classification_source, "manual");
    assert.equal(result.teaser_strength, "weak");
    assert.equal(result.verification_status, verificationStatus);
    assert.equal(result.ai_signal_type, "official_notice");
  }
});

test("reviewed classification does not propagate to a different tweet id", () => {
  const result = preserveTiboWebhookState({
    ...payload(),
    tweet_id: "2084000000000000201",
    signal_type: "official_notice",
    confidence: 0.51,
    classification_reason: "new automatic result",
    classification_source: "gemini",
    teaser_strength: "strong",
  }, {
    ...formalCandidate("confirmed"),
    tweet_id: "2084000000000000200",
    signal_type: "teaser",
    confidence: 0.95,
    classification_reason: "reviewed decision",
    classification_source: "manual",
    teaser_strength: "weak",
  }, receivedAt);

  assert.equal(result.tweet_id, "2084000000000000201");
  assert.equal(result.signal_type, "official_notice");
  assert.equal(result.confidence, 0.51);
  assert.equal(result.classification_reason, "new automatic result");
  assert.equal(result.classification_source, "gemini");
  assert.equal(result.teaser_strength, "strong");
  assert.equal(result.verification_status, "auto_unverified");
});

test("webhook retries preserve a non-none operational assessment when the retry has none", () => {
  const result = preserveTiboWebhookState({
    ...payload(),
    text: "We are investigating cache hit rates.",
    codex_operational_status: "none" as const,
    codex_operational_confidence: 0.92,
    codex_operational_evidence_quote: null,
    codex_operational_reason_ja: null,
    codex_operational_expires_at: null,
  }, {
    tweet_id: payload().tweet_id,
    text: "We are investigating cache hit rates.",
    verification_status: "auto_unverified",
    codex_operational_status: "investigating",
    codex_operational_confidence: 0.88,
    codex_operational_evidence_quote: "investigating cache hit rates",
    codex_operational_reason_ja: "キャッシュヒット率を調査中です。",
    codex_operational_expires_at: "2026-09-23T12:00:00.000Z",
  }, receivedAt);

  assert.equal(result.codex_operational_status, "investigating");
  assert.equal(result.codex_operational_confidence, 0.88);
  assert.equal(result.codex_operational_evidence_quote, "investigating cache hit rates");
  assert.equal(result.codex_operational_expires_at, "2026-09-23T12:00:00.000Z");
});

test("a stronger non-none operational reassessment replaces the previous same-tweet result", () => {
  const result = preserveTiboWebhookState({
    ...payload(),
    text: "The cache issue is back to normal now.",
    codex_operational_status: "recovered" as const,
    codex_operational_confidence: 0.96,
    codex_operational_evidence_quote: "back to normal",
    codex_operational_reason_ja: "復旧しました。",
    codex_operational_expires_at: "2026-09-23T13:00:00.000Z",
  }, {
    tweet_id: payload().tweet_id,
    text: "We are investigating cache hit rates.",
    verification_status: "auto_unverified",
    codex_operational_status: "investigating",
    codex_operational_confidence: 0.88,
    codex_operational_evidence_quote: "investigating cache hit rates",
    codex_operational_reason_ja: "キャッシュヒット率を調査中です。",
    codex_operational_expires_at: "2026-09-23T12:00:00.000Z",
  }, receivedAt);

  assert.equal(result.codex_operational_status, "recovered");
  assert.equal(result.codex_operational_evidence_quote, "back to normal");
});

test("does not preserve operational evidence after the same tweet text changes", () => {
  const result = preserveTiboWebhookState({
    ...payload(),
    text: "The cache issue is fixed now.",
    codex_operational_status: null,
    codex_operational_confidence: null,
    codex_operational_evidence_quote: null,
    codex_operational_reason_ja: null,
    codex_operational_expires_at: null,
  }, {
    tweet_id: payload().tweet_id,
    text: "We are investigating cache hit rates.",
    verification_status: "auto_unverified",
    codex_operational_status: "investigating",
    codex_operational_confidence: 0.88,
    codex_operational_evidence_quote: "investigating cache hit rates",
    codex_operational_reason_ja: "キャッシュヒット率を調査中です。",
    codex_operational_expires_at: "2026-09-23T12:00:00.000Z",
  }, receivedAt);

  assert.equal(result.codex_operational_status, null);
  assert.equal(result.codex_operational_evidence_quote, null);
});

test("webhook redelivery preserves resolved temporal schedule and expires_at when incoming is unresolved", () => {
  const result = preserveTiboWebhookState({
    ...payload(),
    temporal_expression: null,
    temporal_kind: null,
    temporal_precision: null,
    temporal_timezone: null,
    temporal_confidence: null,
    temporal_resolution_source: null,
    expected_start_at: null,
    expected_end_at: null,
    temporal_resolution_status: "unresolved",
    temporal_resolution_version: null,
    expires_at: "2026-08-06T00:00:00.000Z",
  }, {
    tweet_id: payload().tweet_id,
    verification_status: "confirmed",
    temporal_expression: "by EOD",
    temporal_kind: "daypart",
    temporal_precision: "daypart",
    temporal_timezone: "America/Los_Angeles",
    temporal_confidence: 0.95,
    temporal_resolution_source: "deterministic",
    expected_start_at: "2026-08-05T07:00:00.000Z",
    expected_end_at: "2026-08-05T19:00:00.000Z",
    temporal_resolution_status: "resolved",
    temporal_resolution_version: "tibo-temporal-v1",
    expires_at: "2026-08-05T21:00:00.000Z",
  }, receivedAt);

  assert.equal(result.temporal_resolution_status, "resolved");
  assert.equal(result.temporal_expression, "by EOD");
  assert.equal(result.expected_start_at, "2026-08-05T07:00:00.000Z");
  assert.equal(result.expected_end_at, "2026-08-05T19:00:00.000Z");
  assert.equal(result.expires_at, "2026-08-05T21:00:00.000Z");
});

test("webhook redelivery preserves quote metadata when incoming lacks quote context", () => {
  const result = preserveTiboWebhookState({
    ...payload(),
    is_quote: false,
    quote_context_text: null,
    quote_tweet_url: null,
    quote_author_handle: null,
  }, {
    tweet_id: payload().tweet_id,
    verification_status: "auto_unverified",
    is_quote: true,
    quote_context_text: "Resetting usage limits today",
    quote_tweet_url: "https://x.com/thsottiaux/status/2084000000000000100",
    quote_author_handle: "@thsottiaux",
  }, receivedAt);

  assert.equal(result.is_quote, true);
  assert.equal(result.quote_context_text, "Resetting usage limits today");
  assert.equal(result.quote_tweet_url, "https://x.com/thsottiaux/status/2084000000000000100");
  assert.equal(result.quote_author_handle, "@thsottiaux");
});

test("webhook redelivery on confirmed row preserves resolved temporal schedule and expires_at even if incoming is resolved", () => {
  const result = preserveTiboWebhookState({
    ...payload(),
    temporal_expression: "in 1 hour",
    temporal_kind: "relative_duration",
    temporal_precision: "exact_time",
    temporal_timezone: null,
    temporal_confidence: 0.9,
    temporal_resolution_source: "deterministic",
    expected_start_at: "2026-08-05T13:00:00.000Z",
    expected_end_at: "2026-08-05T13:00:00.000Z",
    temporal_resolution_status: "resolved",
    temporal_resolution_version: "tibo-temporal-v1",
    expires_at: "2026-08-05T14:00:00.000Z",
  }, {
    tweet_id: payload().tweet_id,
    verification_status: "confirmed",
    temporal_expression: "by EOD",
    temporal_kind: "daypart",
    temporal_precision: "daypart",
    temporal_timezone: "America/Los_Angeles",
    temporal_confidence: 0.95,
    temporal_resolution_source: "deterministic",
    expected_start_at: "2026-08-05T07:00:00.000Z",
    expected_end_at: "2026-08-05T19:00:00.000Z",
    temporal_resolution_status: "resolved",
    temporal_resolution_version: "tibo-temporal-v1",
    expires_at: "2026-08-05T21:00:00.000Z",
  }, receivedAt);

  assert.equal(result.temporal_resolution_status, "resolved");
  assert.equal(result.temporal_expression, "by EOD");
  assert.equal(result.expected_start_at, "2026-08-05T07:00:00.000Z");
  assert.equal(result.expected_end_at, "2026-08-05T19:00:00.000Z");
  assert.equal(result.expires_at, "2026-08-05T21:00:00.000Z");
});

test("preserveTiboWebhookState does not downgrade an existing reset_executed row to irrelevant on redelivery", () => {
  const existing = {
    tweet_id: "2084000000000000300",
    detected_at: "2026-08-04T12:00:00.000Z",
    verification_status: "auto_unverified" as const,
    signal_type: "reset_executed",
    confidence: 0.98,
    classification_reason: "Promoted to reset_executed by usage recovery observation.",
    classification_source: "gemini",
  };

  const redeliveryPayload = {
    tweet_id: "2084000000000000300",
    detected_at: receivedAt,
    verification_status: "auto_unverified" as const,
    signal_type: "irrelevant",
    confidence: 0.8,
    classification_reason: "Deferred because usage monitor is fresh but recovery not confirmed.",
    classification_source: "rule",
  };

  const result = preserveTiboWebhookState(redeliveryPayload, existing, receivedAt);

  assert.equal(result.signal_type, "reset_executed");
  assert.equal(result.confidence, 0.98);
  assert.equal(result.classification_reason, "Promoted to reset_executed by usage recovery observation.");
  assert.equal(result.classification_source, "gemini");
  assert.equal(result.detected_at, "2026-08-04T12:00:00.000Z");
});

