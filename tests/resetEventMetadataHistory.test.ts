import assert from "node:assert/strict";
import test from "node:test";

import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import type { ResetDisplayNameRecord } from "../lib/radar/types";

const tweetId = "2099000000000000001";
const eventKey = `tibo-reset-${tweetId}`;
const completedAt = "2026-09-13T00:00:00.000Z";
const now = new Date("2026-09-13T01:00:00.000Z");

const sourceSignal = {
  tweet_id: tweetId,
  text: "Reset all propagated.",
  tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
  tweet_created_at: completedAt,
  detected_at: completedAt,
  expires_at: "2026-09-14T00:00:00.000Z",
  signal_type: "reset_executed" as const,
  confidence: 0.99,
  verification_status: "confirmed" as const,
  classification_source: "rule" as const,
};

function metadataRecord(overrides: Partial<ResetDisplayNameRecord> = {}): ResetDisplayNameRecord {
  return {
    event_key: eventKey,
    source_tweet_id: tweetId,
    manual_name_ja: null,
    manual_name_en: null,
    manual_name_zh: null,
    ai_name_ja: null,
    ai_name_en: null,
    ai_name_zh: null,
    ai_confidence: null,
    ai_evidence: null,
    ai_reason: null,
    ai_model: null,
    ai_prompt_version: null,
    ai_input_mode: null,
    ai_status: null,
    ai_flags: null,
    ai_generated_at: null,
    input_hash: null,
    event_reason_type: "詫びリセット",
    event_scope: "一部ユーザー",
    event_summary_ja: "品質問題への対応リセット",
    event_summary_en: "Reset in response to a quality issue",
    event_summary_zh: "应对质量问题的重置",
    event_note_ja: "関連する品質問題の修正が根拠です。",
    event_note_en: "The related quality fix is the recorded basis.",
    event_note_zh: "相关质量问题修复是记录依据。",
    event_metadata_status: "success",
    event_metadata_model: "test-model",
    event_metadata_prompt_version: "reset-event-metadata-v1",
    event_metadata_flags: [],
    event_metadata_generated_at: completedAt,
    event_metadata_input_hash: "metadata-hash",
    created_at: completedAt,
    updated_at: completedAt,
    ...overrides,
  };
}

function data(record: ResetDisplayNameRecord) {
  return getLocalRadarData({
    calculationNow: now,
    formalTiboResets: [sourceSignal],
    resetDisplayNames: [record],
  });
}

test("uses safe generated event metadata for dynamic history presentation in all locales", () => {
  const source = data(metadataRecord());
  const expected = {
    ja: {
      summary: "品質問題への対応リセット",
      note: "関連する品質問題の修正が根拠です。",
      reason: "詫びリセット",
      scope: "一部ユーザー",
    },
    en: {
      summary: "Reset in response to a quality issue",
      note: "The related quality fix is the recorded basis.",
      reason: "Compensation reset",
      scope: "Some users",
    },
    zh: {
      summary: "应对质量问题的重置",
      note: "相关质量问题修复是记录依据。",
      reason: "故障补偿重置",
      scope: "部分用户",
    },
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const item = getRadarViewModel(source, locale, false, undefined, now)
      .recentHistory.find((historyItem) => historyItem.key === eventKey);
    assert.ok(item, locale);
    assert.equal(item.summary, expected[locale].summary, locale);
    assert.equal(item.details?.note, expected[locale].note, locale);
    assert.equal(item.details?.reasonType, expected[locale].reason, locale);
    assert.equal(item.details?.scope, expected[locale].scope, locale);
  }
});

test("invalid or incomplete metadata never becomes public history metadata", () => {
  const source = data(metadataRecord({
    event_metadata_status: "invalid_schema",
    event_reason_type: "ご祝儀リセット",
    event_scope: "全有料プラン",
  }));
  const item = getRadarViewModel(source, "ja", false, undefined, now)
    .recentHistory.find((historyItem) => historyItem.key === eventKey);

  assert.ok(item);
  assert.equal(item.details?.reasonType, "ご祝儀リセット");
  assert.equal(item.details?.scope, "");
  assert.notEqual(item.summary, "品質問題への対応リセット");
});

test("event metadata audit columns stay out of public-v1", () => {
  const snapshot = toPublicRadarSnapshot(data(metadataRecord()), "ja", {
    calculationNow: now,
    limitHistory: false,
  });
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.schemaVersion, "public-v1");
  assert.equal(serialized.includes("event_metadata_model"), false);
  assert.equal(serialized.includes("event_metadata_input_hash"), false);
  assert.equal(serialized.includes("reset-event-metadata-v1"), false);
  assert.equal(serialized.includes("metadata-hash"), false);
});
