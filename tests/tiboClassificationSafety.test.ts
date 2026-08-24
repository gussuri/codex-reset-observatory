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
const compositeResetText =
  "Good Sunday. Reset has been propagated to accounts and we landed some fixes to usage for things mentioned yesterday as issues we found. You should feel a positive difference. More to come tomorrow and will keep communicating.";

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

test("BANKED distribution completion is not a generic usage-limit reset", () => {
  const bankedCompletionTexts = [
    "The banked reset has landed.",
    "The banked reset is available.",
    "The banked reset has arrived.",
    "The reset credit has been distributed to everyone.",
  ];

  for (const text of bankedCompletionTexts) {
    assert.equal(
      getTiboClassificationSafetyDecision(text, "reset_executed").signalType,
      "irrelevant",
      text,
    );

    const guarded = applyTiboClassificationSafetyGuard(text, geminiResult("reset_executed"));
    assert.equal(guarded.signalType, "irrelevant", text);
    assert.equal(guarded.teaserStrength, "none", text);
  }

  const usageLimitReset = "The usage limits have been reset for all paid users of Codex.";
  assert.equal(
    getTiboClassificationSafetyDecision(usageLimitReset, "reset_executed").signalType,
    "reset_executed",
  );
  assert.equal(
    applyTiboClassificationSafetyGuard(usageLimitReset, geminiResult("reset_executed")).signalType,
    "reset_executed",
  );
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

test("Gemini weak teaser guidance is intentionally high-recall without becoming keyword-only", () => {
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /weak.*intentionally high-recall/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /indirect[\s\S]*playful[\s\S]*jok(?:e|es|ing)[\s\S]*metaphor[\s\S]*cryptic/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /does not require[\s\S]*explicit future tense/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /visible[\s\S]*reply context/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /keyword occurrence[\s\S]*historical memories[\s\S]*UI\/product[\s\S]*unrelated technical resets/i);
});

test("Gemini teaser strength is independent from signal type and covers ambiguous reset replies", () => {
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /teaserStrength MUST be judged independently from signalType/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /irrelevant[\s\S]*does NOT imply[\s\S]*teaserStrength["'=]*none/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /signalType[\s\S]*irrelevant[\s\S]*teaserStrength[\s\S]*weak/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /Parent context:[\s\S]*are we going to get a reset when codex crosses 20M users\?[\s\S]*Tibo reply:[\s\S]*Maybe[\s\S]*weak/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /reply status alone[\s\S]*not enough/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /signalType = ["']teaser["'][\s\S]*teaserStrength = ["']strong["']/i);
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

test("composite reset completion keeps the completed primary signal and weak independent teaser", () => {
  const guarded = applyTiboClassificationSafetyGuard(compositeResetText, {
    ...geminiResult("reset_executed"),
    confidence: 0.98,
    temporalDirection: "completed_now",
    evidenceQuote: "Reset has been propagated to accounts",
    teaserStrength: "weak",
    teaserStrengthEvidenceQuote: "More to come tomorrow",
  });

  assert.equal(classifyTiboTweet(compositeResetText, url).signalType, "reset_executed");
  assert.equal(
    getTiboClassificationSafetyDecision(compositeResetText, "reset_executed").signalType,
    "reset_executed",
  );
  assert.equal(guarded.signalType, "reset_executed");
  assert.equal(guarded.temporalDirection, "completed_now");
  assert.match(guarded.evidenceQuote ?? "", /Reset has been propagated to accounts/);
  assert.equal(guarded.teaserStrength, "weak");
});

test("completed-now evidence prevents a contradictory official notice result", () => {
  const guarded = applyTiboClassificationSafetyGuard(compositeResetText, {
    ...geminiResult("official_notice"),
    confidence: 0.98,
    temporalDirection: "completed_now",
    evidenceQuote: "Reset has been propagated to accounts",
    teaserStrength: "weak",
    teaserStrengthEvidenceQuote: "More to come tomorrow",
  });

  assert.equal(guarded.signalType, "reset_executed");
  assert.equal(guarded.temporalDirection, "completed_now");
  assert.equal(guarded.teaserStrength, "weak");
});

test("generic future continuation is capped at weak teaser strength after completion", () => {
  const text = "Reset has been propagated to accounts. More to come tomorrow.";
  const guarded = applyTiboClassificationSafetyGuard(text, {
    ...geminiResult("reset_executed"),
    temporalDirection: "completed_now",
    evidenceQuote: "Reset has been propagated to accounts",
    teaserStrength: "strong",
    teaserStrengthEvidenceQuote: "More to come tomorrow",
  });

  assert.equal(guarded.signalType, "reset_executed");
  assert.equal(guarded.teaserStrength, "weak");
});

test("explicit future reset language can retain strong independent teaser strength", () => {
  const text = "Reset has been propagated to accounts. More resets tomorrow.";
  const guarded = applyTiboClassificationSafetyGuard(text, {
    ...geminiResult("reset_executed"),
    temporalDirection: "completed_now",
    evidenceQuote: "Reset has been propagated to accounts",
    teaserStrength: "strong",
    teaserStrengthEvidenceQuote: "More resets tomorrow",
  });

  assert.equal(guarded.signalType, "reset_executed");
  assert.equal(guarded.teaserStrength, "strong");
});

test("unrelated tomorrow work does not become a completed-reset teaser", () => {
  const text = "Reset has been propagated to accounts. More work on reliability tomorrow.";
  const guarded = applyTiboClassificationSafetyGuard(text, {
    ...geminiResult("reset_executed"),
    temporalDirection: "completed_now",
    evidenceQuote: "Reset has been propagated to accounts",
    teaserStrength: "strong",
    teaserStrengthEvidenceQuote: "More work on reliability tomorrow",
  });

  assert.equal(guarded.signalType, "reset_executed");
  assert.equal(guarded.teaserStrength, "none");
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
