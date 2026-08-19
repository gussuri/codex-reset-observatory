import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTiboTweet,
  getTiboClassificationSafetyDecision,
} from "../lib/radar/classification";
import {
  applyTiboClassificationSafetyGuard,
  TIBO_GEMINI_SYSTEM_PROMPT,
  type GeminiClassificationOutput,
} from "../lib/radar/geminiClassification";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";

const url = "https://x.com/thsottiaux/status/910000000000009999";

function geminiResult(signalType: GeminiClassificationOutput["signalType"]): GeminiClassificationOutput {
  return {
    signalType,
    confidence: 0.9,
    temporalDirection: signalType === "reset_executed" ? "completed_now" : "future",
    evidenceQuote: "reset",
    reasonJa: "テスト判定",
    resetTypeJa: null,
    noticeToExecution: null,
    teaserStrength: signalType === "irrelevant" ? "none" : "strong",
    teaserStrengthConfidence: 0.9,
    teaserStrengthEvidenceQuote: "reset",
    teaserStrengthReasonJa: "テスト判定",
    model: "test-model",
    status: "success",
    classifiedAt: "2026-08-14T00:00:00.000Z",
  };
}

test("unrelated reset objects are excluded without requiring a cache-specific rule", () => {
  const cases = [
    "We reset the cache and the dashboard is fast again.",
    "The server reset was just a routine restart.",
    "Resetting the benchmark before the next run.",
    "I need to reset my sleep schedule.",
    "Reset the conversation and start over.",
    "The database reset completed successfully.",
  ];

  for (const text of cases) {
    assert.equal(classifyTiboTweet(text, url).signalType, "irrelevant", text);
    assert.equal(
      getTiboClassificationSafetyDecision(text, "reset_executed").signalType,
      "irrelevant",
      text,
    );
  }
});

test("usage-limit reset positive controls remain eligible", () => {
  const cases: Array<[string, "reset_executed" | "official_notice"]> = [
    ["Enjoy a usage limit reset everyone.", "reset_executed"],
    ["Codex limits are reset.", "reset_executed"],
    ["Everyone's usage should be topped up now.", "reset_executed"],
    ["Reset landing in the next hour.", "official_notice"],
    ["We just flipped the switch and reset everyone's usage limits.", "reset_executed"],
  ];

  for (const [text, expected] of cases) {
    assert.equal(getTiboClassificationSafetyDecision(text, expected).signalType, expected, text);
  }
});

test("non-reset feature activation and rollout completions are irrelevant", () => {
  const cases = [
    "GPT-X 1M context in Codex. This used to only work for API keys, but we just flipped the switch and it works through ChatGPT accounts now too.",
    "We just flipped the switch. The larger context window works for ChatGPT accounts now.",
    "The new Codex feature is now live for everyone.",
    "We just enabled Model X in Codex.",
  ];

  for (const text of cases) {
    assert.equal(
      getTiboClassificationSafetyDecision(text, "reset_executed").signalType,
      "irrelevant",
      text,
    );

    const guarded = applyTiboClassificationSafetyGuard(text, geminiResult("reset_executed"));
    assert.equal(guarded.signalType, "irrelevant", text);
    assert.equal(guarded.teaserStrength, "none", text);
  }
});

test("pure hypothetical and wish speech acts do not become teaser", () => {
  const cases = [
    "What if we reset everyone after the launch?",
    "Would be nice to reset everyone.",
    "Imagine if everyone got a reset.",
    "I wish I could reset limits.",
    "Could use a reset right now.",
  ];

  for (const text of cases) {
    assert.equal(getTiboClassificationSafetyDecision(text, "teaser").signalType, "irrelevant", text);
  }
});

test("Gemini prompt distinguishes recent reset-button acquisition from historical or UI mentions", () => {
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /gifted.*new reset button|received.*new reset button/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /past tense describes/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /receiving the button/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /years ago|UI\/product|product feature/i);
});

test("recent reset-button acquisition keeps a strong teaser result", () => {
  const guarded = applyTiboClassificationSafetyGuard(
    "I was gifted a very fancy new reset button today",
    {
      ...geminiResult("teaser"),
      teaserStrength: "strong",
    },
  );

  assert.equal(guarded.signalType, "teaser");
  assert.equal(guarded.teaserStrength, "strong");
});

test("conditional present discretion remains distinct from pure hypothetical speech", () => {
  const cases = [
    "If we hit 20M, maybe I will reset everyone.",
    "I could reset everyone later if needed.",
    "A reset is possible if enough people need it.",
  ];

  for (const text of cases) {
    assert.equal(getTiboClassificationSafetyDecision(text, "teaser").signalType, "teaser", text);
  }
});

test("current execution takes priority over a secondary future event", () => {
  const text = "One reset now and another if needed later.";
  assert.equal(getTiboClassificationSafetyDecision(text, "official_notice").signalType, "reset_executed");
  assert.equal(classifyTiboTweet(text, url).signalType, "reset_executed");
});

test("explicit negation stays irrelevant while a reconsidered positive execution remains executable", () => {
  assert.equal(
    getTiboClassificationSafetyDecision("Changed my mind. I will not reset anyone.", "reset_executed").signalType,
    "irrelevant",
  );
  assert.equal(
    getTiboClassificationSafetyDecision("I said no reset earlier, but changed my mind. Enjoy.", "irrelevant").signalType,
    "reset_executed",
  );
  assert.equal(
    getTiboClassificationSafetyDecision("It will not happen for at least two hours.", "official_notice").signalType,
    "irrelevant",
  );
});

test("historical reset with an actionable future event stays an official notice", () => {
  const text = "We reset yesterday; another one is coming tonight.";
  assert.equal(getTiboClassificationSafetyDecision(text, "reset_executed").signalType, "official_notice");
});

test("historical-only reset is not a current execution", () => {
  const text = "We reset everyone yesterday.";
  assert.equal(getTiboClassificationSafetyDecision(text, "reset_executed").signalType, "irrelevant");
  assert.equal(classifyTiboTweet(text, url).signalType, "irrelevant");
});

test("Gemini safety guard normalizes signal and teaser strength together", () => {
  const guarded = applyTiboClassificationSafetyGuard(
    "We reset the cache and the dashboard is fast again.",
    geminiResult("reset_executed"),
  );

  assert.equal(guarded.signalType, "irrelevant");
  assert.equal(guarded.teaserStrength, "none");
  assert.match(guarded.reasonJa ?? "", /別の対象/);
});

test("Gemini safety guard applies current-event precedence", () => {
  const guarded = applyTiboClassificationSafetyGuard(
    "One reset now and another if needed later.",
    geminiResult("official_notice"),
  );

  assert.equal(guarded.signalType, "reset_executed");
  assert.equal(guarded.teaserStrength, "none");
});

test("completed reset never retains teaser strength even when Gemini picked reset_executed", () => {
  const guarded = applyTiboClassificationSafetyGuard(
    "One reset now and another if needed later.",
    geminiResult("reset_executed"),
  );

  assert.equal(guarded.signalType, "reset_executed");
  assert.equal(guarded.teaserStrength, "none");
  assert.equal(guarded.teaserStrengthConfidence, null);
  assert.equal(guarded.teaserStrengthEvidenceQuote, null);
  assert.equal(guarded.teaserStrengthReasonJa, null);
});

function projectGuardedSignal(text: string, result: GeminiClassificationOutput) {
  const guarded = applyTiboClassificationSafetyGuard(text, result);
  const signalType = guarded.signalType ?? "irrelevant";
  const createdAt = "2026-08-14T00:00:00.000Z";
  const signal = {
    tweet_id: `safety-${text.length}`,
    signal_type: signalType,
    text,
    tweet_url: url,
    tweet_created_at: createdAt,
    detected_at: createdAt,
    expires_at: "2026-08-15T00:00:00.000Z",
    verification_status: "auto_unverified" as const,
    confidence: guarded.confidence ?? 0,
    teaser_strength: guarded.teaserStrength,
    ai_temporal_expression: guarded.temporalExpression ?? null,
    ai_temporal_kind: guarded.temporalKind ?? null,
    ai_temporal_precision: guarded.temporalPrecision ?? null,
    ai_temporal_timezone: guarded.explicitTimezone ?? null,
    ai_temporal_confidence: guarded.temporalConfidence ?? null,
    expected_start_at: null,
    expected_end_at: null,
    temporal_resolution_status: null,
    temporal_resolution_version: null,
    is_reply: false,
  };
  const now = new Date("2026-08-14T01:00:00.000Z");
  const data = getLocalRadarData({
    calculationNow: now,
    activeTiboSignals: signalType === "irrelevant" ? [] : [signal],
    recentTiboSignals: [signal],
  });
  const publicSnapshot = toPublicRadarSnapshot(data, "ja", {
    calculationNow: now,
    limitHistory: false,
  });

  return { guarded, signal, publicSnapshot };
}

test("safety downgrades stay out of active notice, teaser, and history state", () => {
  const cases = [
    "We reset the cache and the dashboard is fast again.",
    "What if we reset everyone after the launch?",
    "No reset tonight.",
    "We reset everyone yesterday.",
  ];

  for (const text of cases) {
    const projected = projectGuardedSignal(text, geminiResult("official_notice"));
    assert.equal(projected.guarded.signalType, "irrelevant", text);
    assert.equal(projected.guarded.teaserStrength, "none", text);
    assert.equal(projected.publicSnapshot.resetTeaserStatus, "none", text);
    assert.equal(projected.publicSnapshot.viewModel.activeWindow.active, false, text);
    assert.equal(projected.publicSnapshot.latestTiboActivity?.classification, "irrelevant", text);
  }
});

test("current execution keeps future audit metadata but cannot create an active notice", () => {
  const guarded = applyTiboClassificationSafetyGuard(
    "One reset now and another if needed later.",
    {
      ...geminiResult("official_notice"),
      temporalDirection: "future",
      temporalExpression: "later",
    },
  );
  assert.equal(guarded.signalType, "reset_executed");
  assert.equal(guarded.temporalDirection, "future");
  assert.equal(guarded.temporalExpression, "later");
  assert.equal(guarded.teaserStrength, "none");

  const projected = projectGuardedSignal(
    "One reset now and another if needed later.",
    {
      ...geminiResult("official_notice"),
      temporalDirection: "future",
      temporalExpression: "later",
    },
  );
  assert.equal(projected.publicSnapshot.viewModel.activeWindow.active, false);
  assert.equal(projected.publicSnapshot.resetTeaserStatus, "none");
});

test("historical reset followed by a future notice keeps only the future primary signal", () => {
  const guarded = applyTiboClassificationSafetyGuard(
    "We reset yesterday; another one is coming tonight.",
    { ...geminiResult("reset_executed"), temporalDirection: "future" },
  );

  assert.equal(guarded.signalType, "official_notice");
  assert.equal(guarded.temporalDirection, "future");
});
