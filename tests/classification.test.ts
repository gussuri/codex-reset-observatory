import test from "node:test";
import assert from "node:assert";
import { classifyTiboTweet } from "../lib/radar/classification";

test("classifyTiboTweet correctly classifies official notices", () => {
  const result = classifyTiboTweet("Codex limits will reset in 2 hours! Get ready.", "https://x.com/thsottiaux/status/12345");
  assert.strictEqual(result.signalType, "official_notice");
  assert.ok(result.confidence >= 0.95);
});

test("classifyTiboTweet correctly classifies reset_executed (immediate resets)", () => {
  const result = classifyTiboTweet("We just reset everyone's limits for Codex. Enjoy!", "https://x.com/thsottiaux/status/12346");
  assert.strictEqual(result.signalType, "reset_executed");
  assert.ok(result.confidence >= 0.95);
});

test("classifyTiboTweet correctly classifies real past Tibo reset execution tweets", () => {
  const t1 = classifyTiboTweet("We just reset all paid users limits for Codex!", "https://x.com/thsottiaux/status/2061106703446450392");
  assert.strictEqual(t1.signalType, "reset_executed");
  assert.ok(t1.confidence >= 0.95);

  const t2 = classifyTiboTweet("Codex rate limits are reset for all Pro and Plus users.", "https://x.com/thsottiaux/status/2058280452851638313");
  assert.strictEqual(t2.signalType, "reset_executed");
  assert.ok(t2.confidence >= 0.95);
});

test("classifyTiboTweet correctly classifies real past Tibo teaser tweets", () => {
  const result = classifyTiboTweet("Thinking about pushing the Codex reset button tonight... Should we reset?", "https://x.com/thsottiaux/status/2056806923391877438");
  assert.strictEqual(result.signalType, "teaser");
  assert.ok(result.confidence >= 0.80);
});

test("classifyTiboTweet defaults negative and past phrases to irrelevant", () => {
  const cases = [
    "I already reset everyone yesterday.",
    "The reset was completed last week.",
    "No reset tonight.",
    "We are not going to reset tonight.",
    "I don't think we should reset.",
  ];

  for (const text of cases) {
    const res = classifyTiboTweet(text, "https://x.com/thsottiaux/status/99999");
    assert.strictEqual(res.signalType, "irrelevant", `Failed on text: "${text}"`);
  }
});
