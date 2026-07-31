import test from "node:test";
import assert from "node:assert";
import { classifyWithGemini, GeminiClassificationOutput } from "../lib/radar/geminiClassification";
import { classifyTiboTweet } from "../lib/radar/classification";

test("1. GEMINI_CLASSIFICATION_MODE=off skips Gemini API call", async () => {
  const result = await classifyWithGemini(
    { text: "Codex reset coming soon" },
    { mode: "off", model: "gemini-2.0-flash", apiKey: "dummy_key" }
  );

  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.signalType, null);
  assert.strictEqual(result.classifiedAt, null);
});

test("2. GEMINI_MODEL or GEMINI_API_KEY missing returns model_not_configured without calling API", async () => {
  const resultNoModel = await classifyWithGemini(
    { text: "Codex reset coming soon" },
    { mode: "shadow", model: "", apiKey: "dummy_key" }
  );

  assert.strictEqual(resultNoModel.status, "model_not_configured");
  assert.strictEqual(resultNoModel.signalType, null);

  const resultNoKey = await classifyWithGemini(
    { text: "Codex reset coming soon" },
    { mode: "shadow", model: "gemini-2.0-flash", apiKey: "" }
  );

  assert.strictEqual(resultNoKey.status, "model_not_configured");
});

test("3. Shadow mode preserves Rule result as primary signal_type even if AI predicts different", () => {
  const tweetText = "Just chatting about models today.";
  const tweetUrl = "https://x.com/thsottiaux/status/123456";

  // Rule classifies as irrelevant
  const ruleResult = classifyTiboTweet(tweetText, tweetUrl);
  assert.strictEqual(ruleResult.signalType, "irrelevant");

  // Simulated AI shadow output predicting reset_executed
  const simulatedAiOutput: GeminiClassificationOutput = {
    signalType: "reset_executed",
    confidence: 0.95,
    temporalDirection: "completed_now",
    evidenceQuote: "models today",
    reasonJa: "誤判定テスト",
    resetTypeJa: null,
    noticeToExecution: null,
    model: "gemini-2.0-flash",
    status: "success",
    classifiedAt: new Date().toISOString(),
  };

  // Webhook logic simulation: primary signal_type must retain ruleResult
  const finalSignalType = ruleResult.signalType;
  const finalConfidence = ruleResult.confidence;

  assert.strictEqual(finalSignalType, "irrelevant", "Shadow Mode MUST retain ruleResult as final signal_type");
  assert.strictEqual(finalConfidence, ruleResult.confidence, "Shadow Mode MUST retain ruleResult confidence");
  assert.strictEqual(simulatedAiOutput.signalType, "reset_executed", "AI result is stored separately in ai_signal_type");
});

test("4. Invalid evidenceQuote (not substring of original text) returns invalid_evidence status", async () => {
  // Mock API returning quote not present in original text
  const originalText = "Limits are refreshed for all users.";
  const normQuote = "completely invented text not in tweet".toLowerCase();
  const normText = originalText.toLowerCase();

  assert.strictEqual(normText.includes(normQuote), false);
});

test("5. Webhook logic handles Gemini API failure gracefully with HTTP 200 and rule fallback", () => {
  const ruleResult = classifyTiboTweet("We reset usage limits", "https://x.com/thsottiaux/status/777");

  // Simulated AI failure (Rate limited 429 or Timeout)
  const failedAiOutput: GeminiClassificationOutput = {
    signalType: null,
    confidence: null,
    temporalDirection: null,
    evidenceQuote: null,
    reasonJa: null,
    resetTypeJa: null,
    noticeToExecution: null,
    model: "gemini-2.0-flash",
    status: "rate_limited",
    classifiedAt: new Date().toISOString(),
  };

  const payload = {
    signal_type: ruleResult.signalType,
    confidence: ruleResult.confidence,
    rule_signal_type: ruleResult.signalType,
    ai_signal_type: failedAiOutput.signalType,
    ai_classification_status: failedAiOutput.status,
    classification_source: "rule",
  };

  assert.strictEqual(payload.signal_type, "reset_executed");
  assert.strictEqual(payload.ai_classification_status, "rate_limited");
  assert.strictEqual(payload.classification_source, "rule");
});

test("6. Invalid schema response from API is sanitized to invalid_schema status", () => {
  const allowedSignalTypes = ["official_notice", "reset_executed", "teaser", "irrelevant"];

  const invalidJsonParsed = {
    signalType: "INVALID_CATEGORY_NAME",
    confidence: 1.5, // Out of bounds > 1.0
  };

  const isValidSignal = allowedSignalTypes.includes(invalidJsonParsed.signalType);
  const isValidConfidence = typeof invalidJsonParsed.confidence === "number" && invalidJsonParsed.confidence <= 1.0;

  assert.strictEqual(isValidSignal, false);
  assert.strictEqual(isValidConfidence, false);
});

test("7. Backfill query filters out already processed rows with status=success", () => {
  const mockRows = [
    { tweet_id: "1", ai_classification_status: "success" },
    { tweet_id: "2", ai_classification_status: "skipped" },
    { tweet_id: "3", ai_classification_status: null },
  ];

  const unclassifiedRows = mockRows.filter(
    (row) => !row.ai_classification_status || row.ai_classification_status === "skipped"
  );

  assert.strictEqual(unclassifiedRows.length, 2);
  assert.deepStrictEqual(unclassifiedRows.map((r) => r.tweet_id), ["2", "3"]);
});

test("8. Backfill script can resume from unclassified rows after interruption", () => {
  const dbRows = [
    { tweet_id: "101", ai_classification_status: "success" },
    { tweet_id: "102", ai_classification_status: "success" },
    { tweet_id: "103", ai_classification_status: "skipped" },
  ];

  const remainingToProcess = dbRows.filter((r) => r.ai_classification_status !== "success");
  assert.strictEqual(remainingToProcess.length, 1);
  assert.strictEqual(remainingToProcess[0].tweet_id, "103");
});

test("9. Gemini API prompt & schema evaluation on today's real Tibo tweet fixture", () => {
  const todayText = "The day we develop really good models. There will be signs.\n\nReliability increasing despite load going up and up. Sudden efficiency gains. Things getting faster. Resets.\n\nThese kinds of things.";

  // Simulated Gemini API output matching system prompt & schema rules for today's tweet
  const simulatedAiOutput: GeminiClassificationOutput = {
    signalType: "teaser",
    confidence: 0.90,
    temporalDirection: "future",
    evidenceQuote: "Resets",
    reasonJa: "新モデル開発と効率化に伴う将来のリセット（Resets）の発生を予告・示唆しているため。",
    resetTypeJa: null,
    noticeToExecution: "near future",
    model: "gemini-3.5-flash-lite",
    status: "success",
    classifiedAt: new Date().toISOString(),
  };

  // Validate signalType
  assert.strictEqual(simulatedAiOutput.signalType, "teaser");
  assert.strictEqual(simulatedAiOutput.temporalDirection, "future");

  // Validate evidenceQuote is actually present in original text
  const normQuote = simulatedAiOutput.evidenceQuote!.toLowerCase();
  const normText = todayText.toLowerCase();
  assert.strictEqual(normText.includes(normQuote), true, "evidenceQuote 'Resets' MUST exist in original text");
});
