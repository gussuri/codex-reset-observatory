import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTiboTweet,
  getTiboClassificationSafetyDecision,
} from "../lib/radar/classification";
import {
  applyTiboClassificationSafetyGuard,
  type GeminiClassificationOutput,
} from "../lib/radar/geminiClassification";

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
  ];

  for (const [text, expected] of cases) {
    assert.equal(getTiboClassificationSafetyDecision(text, expected).signalType, expected, text);
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
