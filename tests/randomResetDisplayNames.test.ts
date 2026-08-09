import assert from "node:assert/strict";
import test from "node:test";

import { getRadarViewModel } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import {
  assessRandomResetNameResult,
  buildRandomResetNamePrompt,
  parseRandomResetNameResponse,
  toRandomResetNameInput,
} from "../lib/radar/randomResetNaming";
import {
  getResetDisplayNameEventKey,
  isGenericResetDisplayTitle,
  resolveJapaneseResetDisplayName,
  resolveResetDisplayTitle,
} from "../lib/radar/resetDisplayNames";
import { getLocalRadarData } from "../lib/radar";
import { getCompletedResetTimestamp } from "../lib/radar/probability";
import { isEligibleRandomResetEvent } from "../lib/radar/resetEligibility";
import {
  getResetDisplayNameWritePayload,
  hashResetDisplayNameInput,
  shouldReuseResetDisplayNameResult,
} from "../lib/radar/resetDisplayNameStore";
import {
  canApplyRandomResetDisplayNameStatus,
  isRandomResetDisplayNameApplyMode,
} from "../scripts/backfill-random-reset-display-names";
import type { ResetDisplayNameRecord, WindowEventLike } from "../lib/radar/types";

const completedAt = "2026-08-08T04:32:00.000Z";
const sourceUrl = "https://x.com/thsottiaux/status/2086188036493344823";

function resetItem(overrides: Partial<WindowEventLike> = {}): WindowEventLike {
  return {
    id: "tibo-reset-2086188036493344823",
    recordKind: "confirmed_global",
    title: "ランダムリセット",
    kind: "reset_completed",
    status: "closed",
    closed_at: completedAt,
    completed_at: completedAt,
    opened_at: completedAt,
    source_url: sourceUrl,
    scope: "全有料プラン",
    details: {
      cycleType: "ランダムリセット",
      reasonType: "ご祝儀リセット",
      resetMethod: "強制リセット",
      scope: "全有料プラン",
      noticeToExecution: "0分",
      noticeType: "なし",
      note: "Tibo氏がCodexの利用上限リセット完了を発表しました。",
    },
    ...overrides,
  };
}

function acceptedRecord(overrides: Partial<ResetDisplayNameRecord> = {}): ResetDisplayNameRecord {
  return {
    event_key: "tibo-reset-2086188036493344823",
    source_tweet_id: "2086188036493344823",
    manual_name_ja: null,
    ai_name_ja: "週末の利用上限リセット",
    ai_confidence: 0.86,
    ai_evidence: "weekend",
    ai_reason: "入力された投稿の週末という特徴を使った。",
    ai_model: "gemini-3.5-flash-lite",
    ai_prompt_version: "random-reset-name-v1",
    ai_input_mode: "metadata+source",
    ai_status: "accepted",
    ai_flags: [],
    ai_generated_at: "2026-08-08T04:00:00.000Z",
    input_hash: "hash",
    ...overrides,
  };
}

test("display-name safety accepts only grounded, sufficiently confident names", () => {
  const item = resetItem({ summary: "weekend reset" });
  const input = toRandomResetNameInput(item, Date.parse(completedAt));
  input.sourcePostText = "A weekend reset is live.";

  const accepted = parseRandomResetNameResponse(
    {
      name: "週末の利用上限リセット",
      confidence: 0.86,
      evidence: "weekend",
      reason: "入力にある特徴だけを使った。",
    },
    input,
    "gemini-3.5-flash-lite",
  );
  assert.equal(assessRandomResetNameResult(accepted).status, "accepted");

  const lowConfidence = parseRandomResetNameResponse(
    {
      name: "週末の利用上限リセット",
      confidence: 0.69,
      evidence: "weekend",
      reason: "入力にある特徴だけを使った。",
    },
    input,
    "gemini-3.5-flash-lite",
  );
  assert.equal(assessRandomResetNameResult(lowConfidence).status, "review_required");

  const hallucinated = parseRandomResetNameResponse(
    {
      name: "GPT-5公開記念リセット",
      confidence: 0.95,
      evidence: "weekend",
      reason: "モデル名を補った。",
    },
    input,
    "gemini-3.5-flash-lite",
  );
  assert.equal(assessRandomResetNameResult(hallucinated).status, "review_required");
});

test("null, API error, and rate-limited results remain safe fallbacks", () => {
  const input = toRandomResetNameInput(resetItem(), Date.parse(completedAt));
  const empty = parseRandomResetNameResponse(
    { name: null, confidence: 0.2, evidence: null, reason: "特徴が不足している。" },
    input,
    "gemini-3.5-flash-lite",
  );
  assert.equal(assessRandomResetNameResult(empty).status, "null");
  assert.equal(assessRandomResetNameResult({ ...empty, status: "api_error" }).status, "api_error");
  assert.equal(assessRandomResetNameResult({ ...empty, status: "rate_limited" }).status, "rate_limited");
  assert.equal(resolveJapaneseResetDisplayName(resetItem(), null), "ランダムリセット");
});

test("production prompt uses recorded facts without passing an existing human title", () => {
  const input = toRandomResetNameInput(
    resetItem({ title: "1000万人到達記念リセット", summary: "weekend reset" }),
    Date.parse(completedAt),
  );
  input.sourcePostText = "A weekend reset is live.";
  const prompt = buildRandomResetNamePrompt(input);
  assert.equal(prompt.includes("1000万人到達記念リセット"), false);
  assert.equal(prompt.includes("A weekend reset is live."), true);
  assert.equal(prompt.includes("existing title"), false);
});

test("Japanese display priority preserves human titles and accepts only safe AI names", () => {
  const item = resetItem();
  const record = acceptedRecord();
  assert.equal(isGenericResetDisplayTitle("ご祝儀リセット"), true);
  assert.equal(resolveJapaneseResetDisplayName(item, record), "週末の利用上限リセット");
  assert.equal(
    resolveJapaneseResetDisplayName(
      { ...item, title: "1000万人到達記念リセット" },
      record,
    ),
    "1000万人到達記念リセット",
  );
  assert.equal(
    resolveJapaneseResetDisplayName(item, { ...record, manual_name_ja: "手動確認名" }),
    "手動確認名",
  );
  assert.equal(resolveResetDisplayTitle(item, record, "en"), "ランダムリセット");
  assert.equal(resolveResetDisplayTitle(item, record, "zh"), "ランダムリセット");
});

test("only completed broad random resets are naming candidates", () => {
  const now = Date.parse("2026-08-09T00:00:00.000Z");
  const regular = resetItem({
    id: "regular-reset",
    recordKind: "regular_completed",
    details: { ...resetItem().details!, cycleType: "定期リセット", reasonType: "定期更新" },
  });
  const narrow = resetItem({ scope: "限定ユーザー" });
  const pending = resetItem({ status: "pending", closed_at: null, completed_at: null });
  assert.equal(isEligibleRandomResetEvent(resetItem(), getCompletedResetTimestamp(resetItem()), now), true);
  assert.equal(isEligibleRandomResetEvent(regular, getCompletedResetTimestamp(regular), now), false);
  assert.equal(isEligibleRandomResetEvent(narrow, getCompletedResetTimestamp(narrow), now), false);
  assert.equal(isEligibleRandomResetEvent(pending, getCompletedResetTimestamp(pending), now), false);
});

test("metadata-only and exact source inputs are distinguishable without title leakage", () => {
  const item = resetItem({ title: "具体的な人間タイトル" });
  const input = toRandomResetNameInput(item, Date.parse(completedAt));
  assert.equal(input.sourcePostText, null);
  assert.equal(buildRandomResetNamePrompt(input).includes("具体的な人間タイトル"), false);
  input.sourcePostText = "Exact source text";
  assert.equal(buildRandomResetNamePrompt(input).includes("Exact source text"), true);
});

test("display-name event keys are stable and source-linked", () => {
  assert.equal(getResetDisplayNameEventKey(resetItem()), "tibo-reset-2086188036493344823");
  assert.equal(
    getResetDisplayNameEventKey({ title: "ランダムリセット", source_url: sourceUrl }),
    "tibo-reset-2086188036493344823",
  );
});

test("input hashes and stored result reuse are idempotent", () => {
  const input = toRandomResetNameInput(resetItem(), Date.parse(completedAt));
  const hash = hashResetDisplayNameInput(input, null);
  const same = hashResetDisplayNameInput(input, null);
  assert.equal(hash, same);
  const record = acceptedRecord({ input_hash: hash });
  assert.equal(shouldReuseResetDisplayNameResult(record, hash, "gemini-3.5-flash-lite"), true);
  assert.equal(shouldReuseResetDisplayNameResult(record, "different", "gemini-3.5-flash-lite"), false);
  assert.equal(shouldReuseResetDisplayNameResult({ ...record, ai_status: "api_error" }, hash, "gemini-3.5-flash-lite"), false);
});

test("accepted-only backfill writes are explicit and retryable failures stay retryable", () => {
  assert.equal(isRandomResetDisplayNameApplyMode(["node", "script"]), false);
  assert.equal(isRandomResetDisplayNameApplyMode(["node", "script", "--apply"]), true);
  assert.equal(canApplyRandomResetDisplayNameStatus("accepted"), true);
  assert.equal(canApplyRandomResetDisplayNameStatus("null"), false);
  assert.equal(canApplyRandomResetDisplayNameStatus("review_required"), false);
  assert.equal(canApplyRandomResetDisplayNameStatus("api_error"), false);
});

test("accepted write payload keeps manual and audit fields separate", () => {
  const input = toRandomResetNameInput(resetItem(), Date.parse(completedAt));
  const result = parseRandomResetNameResponse(
    { name: "週末の利用上限リセット", confidence: 0.9, evidence: "weekend", reason: "記録済み。" },
    { ...input, recordedSummary: "weekend" },
    "gemini-3.5-flash-lite",
  );
  const payload = getResetDisplayNameWritePayload({
    eventKey: "event-key",
    sourceTweetId: "2086188036493344823",
    inputMode: "metadata+source",
    inputHash: "hash",
    result,
    existing: acceptedRecord({ manual_name_ja: "手動名" }),
    generatedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.equal(payload.event_key, "event-key");
  assert.equal(payload.manual_name_ja, "手動名");
  assert.equal(payload.ai_name_ja, "週末の利用上限リセット");
  assert.equal("title" in payload, false);
});

test("AI display names affect Japanese titles only and never public audit fields or probabilities", () => {
  const now = new Date("2026-08-09T00:00:00.000Z");
  const withName = getLocalRadarData({
    calculationNow: now,
    formalTiboResets: [{
      tweet_id: "2086188036493344823",
      text: "A weekend reset is live.",
      tweet_url: sourceUrl,
      tweet_created_at: completedAt,
      detected_at: completedAt,
      signal_type: "reset_executed",
      confidence: 0.98,
      verification_status: "confirmed",
      classification_source: "gemini",
    }],
    resetDisplayNames: [acceptedRecord()],
  });
  const withoutName = getLocalRadarData({
    calculationNow: now,
    formalTiboResets: withName.formal_tibo_resets,
  });
  const ja = getRadarViewModel(withName, "ja", true, undefined, now);
  const en = getRadarViewModel(withName, "en", true, undefined, now);
  const baseline = getRadarViewModel(withoutName, "ja", true, undefined, now);
  assert.equal(ja.recentHistory[0]?.title, "週末の利用上限リセット");
  assert.equal(en.recentHistory[0]?.title, "Unscheduled reset");
  assert.equal(ja.probability24h, baseline.probability24h);
  assert.equal(ja.probability48h, baseline.probability48h);

  const publicSnapshot = toPublicRadarSnapshot(withName, "ja", { calculationNow: now });
  const serialized = JSON.stringify(publicSnapshot);
  assert.equal(publicSnapshot.schemaVersion, "public-v1");
  assert.equal(serialized.includes("ai_reason"), false);
  assert.equal(serialized.includes("reset_display_names"), false);
  assert.equal(serialized.includes("random-reset-name-v1"), false);
});
