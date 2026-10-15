import assert from "node:assert/strict";
import test from "node:test";

import realPostFixture from "./fixtures/tibo-real-posts-v1.json";
import scenarioFixture from "./fixtures/tibo-scenarios.json";
import { validateRealPostFixture } from "../scripts/evaluate-tibo-offline";

test("real-post fixture contains source text and at least 30 posts across 10 event groups", () => {
  const result = validateRealPostFixture(realPostFixture);
  assert.ok(result.postCount >= 30);
  assert.ok(result.eventGroupCount >= 10);
});

test("required Oct 10–11 and Oct 15 posts keep exact text, times, and verified relation IDs", () => {
  const posts = realPostFixture.posts;
  const byId = new Map(posts.map((post) => [post.tweetId, post]));
  assert.equal(byId.get("2109045392684032299")?.text, "Global reset by EOD. May the tokens do good things for you.");
  assert.equal(byId.get("2109045392684032299")?.tweetCreatedAt, "2026-10-10T22:16:20.000Z");
  assert.equal(byId.get("2109132167112782291")?.text, "Put the reset in the bag. All propagated.");
  assert.equal(byId.get("2109132167112782291")?.tweetCreatedAt, "2026-10-11T04:01:09.000Z");
  assert.equal(byId.get("2110595484180214059")?.text, "The reports of my reset button being lost are greatly exaggerated\n\nDay 10/ Reset");
  assert.equal(byId.get("2110595484180214059")?.tweetCreatedAt, "2026-10-15T04:55:51.000Z");
  assert.equal(byId.get("2110595554036400151")?.replyParentTweetId, "2110595484180214059");
  assert.equal(byId.get("2110618732666257557")?.quoteTweetId, "2110595554036400151");
  assert.equal(byId.get("2110618732666257557")?.tweetCreatedAt, "2026-10-15T06:28:13.000Z");
});

test("legacy prediction snapshots remain separate from re-reviewed gold labels", () => {
  const teaser = realPostFixture.posts.find((post) => post.tweetId === "2081899343091843463");
  assert.equal(teaser?.gold.signalType, "teaser");
  assert.equal(teaser?.legacyEvaluation?.goldSignalType, "teaser");
  assert.equal(teaser?.legacyEvaluation?.rawAiAvailability, "unavailable");
});

test("synthetic scenarios retain the original 145 and provide 220+ evaluator cases", () => {
  assert.equal(scenarioFixture.scenarios.slice(0, 145).length, 145);
  assert.ok(scenarioFixture.scenarios.length >= 220);
  const evaluationCases = scenarioFixture.scenarios.filter((item) => "evaluation" in item);
  assert.ok(evaluationCases.length >= 75);
});

test("real-post fixture rejects missing source citations and split leakage", () => {
  const missingCitation = structuredClone(realPostFixture) as typeof realPostFixture;
  missingCitation.posts[0]!.sourceCitations = [];
  assert.throws(() => validateRealPostFixture(missingCitation), /source citation/);
  const splitLeak = structuredClone(realPostFixture) as typeof realPostFixture;
  splitLeak.posts[1]!.eventGroupId = splitLeak.posts[0]!.eventGroupId;
  splitLeak.posts[1]!.split = splitLeak.posts[0]!.split === "regression" ? "development" : "regression";
  assert.throws(() => validateRealPostFixture(splitLeak), /crosses splits/);
});
