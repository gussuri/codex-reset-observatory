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

test("classifyTiboTweet correctly classifies teasers", () => {
  const result = classifyTiboTweet("Should we reset the Codex reset button tonight?", "https://x.com/thsottiaux/status/12347");
  assert.strictEqual(result.signalType, "teaser");
  assert.ok(result.confidence >= 0.80);
});

test("classifyTiboTweet defaults past reset chatter to irrelevant", () => {
  const result = classifyTiboTweet("Last week's reset was great, working on models now.", "https://x.com/thsottiaux/status/12348");
  assert.strictEqual(result.signalType, "irrelevant");
});
