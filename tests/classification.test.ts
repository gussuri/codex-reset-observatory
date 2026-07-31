import test from "node:test";
import assert from "node:assert";
import { classifyTiboTweet } from "../lib/radar/classification";

test("classifyTiboTweet correctly classifies official notices", () => {
  const result = classifyTiboTweet("Codex limits will reset in 2 hours! Get ready.", "https://x.com/thsottiaux/status/12345");
  assert.strictEqual(result.signalType, "official_notice");
  assert.ok(result.confidence >= 0.95);
});

test("classifyTiboTweet correctly classifies reset_executed (immediate resets)", () => {
  const cases = [
    "We just reset everyone's limits for Codex. Enjoy!",
    "I've reset usage limits",
    "I have reset usage limits",
    "I've reset the usage limits",
    "I reset usage limits for all paid users",
  ];

  for (const text of cases) {
    const result = classifyTiboTweet(text, "https://x.com/thsottiaux/status/12346");
    assert.strictEqual(result.signalType, "reset_executed", `Failed on: "${text}"`);
    assert.ok(result.confidence >= 0.95);
  }
});

test("classifyTiboTweet correctly classifies real past Tibo reset execution tweets", () => {
  const t1 = classifyTiboTweet("We just reset all paid users limits for Codex!", "https://x.com/thsottiaux/status/2061106703446450392");
  assert.strictEqual(t1.signalType, "reset_executed");
  assert.ok(t1.confidence >= 0.95);

  const t2 = classifyTiboTweet("Codex rate limits are reset for all Pro and Plus users.", "https://x.com/thsottiaux/status/2058280452851638313");
  assert.strictEqual(t2.signalType, "reset_executed");
  assert.ok(t2.confidence >= 0.95);
});

test("classifyTiboTweet correctly classifies teaser tweets with future indicators", () => {
  const result = classifyTiboTweet("Thinking about pushing the Codex reset button tonight... Should we reset?", "https://x.com/thsottiaux/status/2056806923391877438");
  assert.strictEqual(result.signalType, "teaser");
  assert.ok(result.confidence >= 0.80);

  const result2 = classifyTiboTweet("Reset button incoming soon! Cooking something nice.", "https://x.com/thsottiaux/status/2056806923391877439");
  assert.strictEqual(result2.signalType, "teaser");
  assert.ok(result2.confidence >= 0.80);

  const todayRealTweet = classifyTiboTweet(
    "The day we develop really good models. There will be signs.\n\nReliability increasing despite load going up and up. Sudden efficiency gains. Things getting faster. Resets.\n\nThese kinds of things.",
    "https://x.com/thsottiaux/status/206987654321"
  );
  assert.strictEqual(todayRealTweet.signalType, "teaser");
  assert.ok(todayRealTweet.confidence >= 0.80);
});

test("classifyTiboTweet classifies standalone reset button and retrospective past mentions as irrelevant", () => {
  const cases = [
    "I already reset everyone yesterday.",
    "The reset was completed last week.",
    "No reset tonight.",
    "We are not going to reset tonight.",
    "I don't think we should reset.",
    "One day we created the reset button and the rest is history.",
    "We created the reset button a long time ago.",
    "Remember when we built the reset button?",
    "The reset button", // Standalone reset button without future indicator
  ];

  for (const text of cases) {
    const res = classifyTiboTweet(text, "https://x.com/thsottiaux/status/99999");
    assert.strictEqual(res.signalType, "irrelevant", `Failed on text: "${text}"`);
  }
});
