import assert from "node:assert/strict";
import test from "node:test";

import realPostFixture from "./fixtures/tibo-real-posts-v1.json";
import scenarioFixture from "./fixtures/tibo-scenarios.json";
import { buildEvaluationCases, formatEvaluationInput, validateRealPostFixture } from "../scripts/evaluate-tibo-offline";

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
  assert.equal(scenarioFixture.scenarios.length, 194);
  const evaluationCases = scenarioFixture.scenarios.filter((item) => "evaluation" in item);
  assert.equal(evaluationCases.length, 194);
  assert.equal(buildEvaluationCases().length, 230);
});

test("real-post fixture rejects missing source citations and split leakage", () => {
  const missingCitation = structuredClone(realPostFixture) as typeof realPostFixture;
  missingCitation.posts[0]!.sourceCitations = [];
  assert.throws(() => validateRealPostFixture(missingCitation), /source citation/);
  const splitLeak = structuredClone(realPostFixture) as typeof realPostFixture;
  splitLeak.posts[1]!.eventGroupId = splitLeak.posts[0]!.eventGroupId;
  splitLeak.posts[1]!.split = splitLeak.posts[0]!.split === "regression" ? "development" : "regression";
  assert.throws(() => validateRealPostFixture(splitLeak), /crosses splits/);
  const badGold = structuredClone(realPostFixture) as typeof realPostFixture;
  (badGold.posts[0]!.gold as { signalType: string }).signalType = "unsupported";
  assert.throws(() => validateRealPostFixture(badGold), /decision\/signalType mismatch/);
  const missingRelation = structuredClone(realPostFixture) as typeof realPostFixture;
  missingRelation.posts.find((post) => post.relationVerification === "verified_by_sol_x_dom")!.relatedPostIds = ["9999999999999999999"];
  assert.throws(() => validateRealPostFixture(missingRelation), /Unknown relation ID/);
  const verifiedLinkDoesNotMergeEvents = structuredClone(realPostFixture) as typeof realPostFixture;
  verifiedLinkDoesNotMergeEvents.posts.find((post) => post.relationVerification === "verified_by_sol_x_dom")!.relatedPostIds = [verifiedLinkDoesNotMergeEvents.posts.find((post) => post.role === "standalone_post")!.tweetId];
  assert.doesNotThrow(() => validateRealPostFixture(verifiedLinkDoesNotMergeEvents));
});

test("known 14pm example follows the tested compatibility contract and known holdout candidates are regression", () => {
  const source = realPostFixture.posts.find((post) => post.tweetId === "2091412393368945027")!;
  assert.equal(source.split, "regression");
  assert.equal(source.gold.temporalExpected?.expectedStartAt, "2026-08-23T22:00:00.000Z");
  assert.equal(source.gold.temporalExpected?.precision, "exact_time");
  assert.ok(realPostFixture.posts.filter((post) => post.legacyEvaluation).every((post) => post.originalTextVerified === false));
  assert.equal(realPostFixture.posts.filter((post) => post.split === "holdout_candidate").length, 0);
});

test("synthetic context conditions provide distinct original input evidence and preserve event time", () => {
  const allCases = buildEvaluationCases();
  const cases = allCases.filter((item) => item.eventGroupId === "synthetic-event-landing");
  assert.equal(new Set(cases.map((item) => item.providerInput.target.text)).size, 1);
  assert.equal(new Set(cases.map((item) => item.providerInput.target.createdAt)).size, 1);
  assert.equal(cases.find((item) => item.inputCondition === "verified_parent")?.providerInput.contextPosts[0]?.text, "The reset is scheduled to happen in the next two hours.");
  assert.match(cases.find((item) => item.inputCondition === "unrelated_parent")?.providerInput.contextPosts[0]?.text ?? "", /no reset is discussed/);
  assert.equal(cases.find((item) => item.inputCondition === "other_author_quote")?.providerInput.contextPosts[0]?.author, "@another_author");
  assert.equal(cases.find((item) => item.inputCondition === "verified_parent")?.gold.temporal?.precision, "range");
  const formatted = cases.map((item) => formatEvaluationInput(item));
  assert.equal(new Set(formatted).size, 4);
  assert.ok(formatted.find((text) => text.includes("Parent context shown in the same article: The reset is scheduled to happen")));
  assert.ok(formatted.find((text) => text.includes("QUOTED CONTEXT (not Tibo's own text): I reset my own account")));
  const teaser = allCases.filter((item) => item.eventGroupId === "synthetic-event-codex-teaser");
  assert.equal(teaser.find((item) => item.inputCondition === "text_only")?.gold.decision, "ambiguous");
  assert.deepEqual(teaser.find((item) => item.inputCondition === "text_only")?.gold.acceptedSignalTypes, ["abstain", "teaser"]);
  assert.equal(teaser.find((item) => item.inputCondition === "verified_parent")?.gold.signalType, "teaser");
  const banked = allCases.find((item) => item.eventGroupId === "synthetic-event-banked-parent-fragment" && item.inputCondition === "verified_parent");
  assert.equal(banked?.gold.signalType, "official_notice");
  assert.equal(banked?.gold.publicOutcome?.resetMethod, "banked_distribution");
  assert.equal(banked?.gold.publicOutcome?.historyCreated, false);
});

test("legacy reply and quote context survives normalization and ambiguous Done is a safe hold", () => {
  const cases = buildEvaluationCases();
  const reply = cases.find((item) => item.id === "reply-03")!;
  assert.equal(reply.inputCondition, "legacy_context");
  assert.equal(reply.providerInput.isReply, true);
  assert.equal(reply.providerInput.contextPosts[0]?.text, "Reset us please!");
  assert.match(reply.providerInput.contextPosts[0]?.tweetId ?? "", /^synthetic-parent-/);
  assert.match(formatEvaluationInput(reply), /Source timeline: with_replies/);
  assert.equal(reply.gold.decision, "ambiguous");
  assert.equal(reply.gold.signalType, null);
  assert.match(formatEvaluationInput(reply), /Parent context shown in the same article: Reset us please!/);
  const done = cases.find((item) => item.id === "exec-03")!;
  assert.equal(done.gold.decision, "ambiguous");
  assert.equal(done.gold.signalType, null);
  assert.equal(cases.filter((item) => item.gold.decision === "ambiguous").length > 0, true);
});

test("quoted completion retains true graph edges and separates baseline from verified graph serialization", () => {
  const completion = buildEvaluationCases().find((item) => item.id === "2110618732666257557::verified-quote-reply-parent-chain")!;
  const targetId = completion.providerInput.target.tweetId;
  const quoteEdge = completion.providerInput.edges?.find((edge) => edge.relation === "quote");
  const ancestorReply = completion.providerInput.edges?.find((edge) => edge.relation === "reply");
  assert.deepEqual(quoteEdge && [quoteEdge.fromTweetId, quoteEdge.toTweetId], [targetId, "2110595554036400151"]);
  assert.deepEqual(ancestorReply && [ancestorReply.fromTweetId, ancestorReply.toTweetId], ["2110595554036400151", "2110595484180214059"]);
  assert.notEqual(ancestorReply?.fromTweetId, targetId, "quoted post's parent must not become target's direct reply parent");
  assert.equal(quoteEdge?.verification, "verified_by_sol_x_dom");
  assert.equal(completion.providerInput.edges?.some((edge) => edge.fromTweetId === targetId && edge.toTweetId === "2110595484180214059"), false, "matching text or a related ID must not fabricate a direct edge");
  const baseline = formatEvaluationInput(completion, "production_baseline");
  const graph = formatEvaluationInput(completion, "verified_graph");
  assert.match(baseline, /QUOTED CONTEXT/);
  assert.doesNotMatch(baseline, /Day 10\/ Reset/);
  assert.match(graph, /\"fromTweetId\": \"2110595554036400151\"/);
  assert.match(graph, /\"toTweetId\": \"2110595484180214059\"/);
  assert.notEqual(baseline, graph);
});

test("layer gold separates BANKED delivery safety correction and avoids unsupported public-state assertions", () => {
  const cases = buildEvaluationCases();
  const banked = cases.find((item) => item.id === "eval-syn-033")!;
  assert.equal(banked.gold.signalType, "irrelevant");
  assert.equal(banked.gold.correctedSignalType, undefined);
  for (const id of ["eval-syn-045", "eval-syn-047", "eval-syn-048"]) assert.equal(cases.find((item) => item.id === id)?.gold.publicOutcome, undefined);
  const timing = cases.find((item) => item.id === "2110595554036400151::text-only")!;
  assert.ok(realPostFixture.posts.find((post) => post.tweetId === "2110595554036400151")?.gold.preState?.activeNotice);
  assert.deepEqual(timing.evaluationState?.preState, realPostFixture.posts.find((post) => post.tweetId === "2110595554036400151")?.gold.preState);
  assert.equal(timing.providerInput.target.text.includes("activeNotice"), false, "prior public state must stay outside model evidence");
  assert.equal(timing.gold.publicOutcome?.activeNotice, true);
});

test("contextless child abstention preserves the parent notice while verified completion updates history", () => {
  const cases = buildEvaluationCases();
  const timingReply = cases.find((item) => item.id === "2110595554036400151::text-only")!;
  assert.equal(timingReply.gold.decision, "abstain");
  assert.equal(timingReply.gold.publicOutcome?.activeNotice, true);
  assert.equal(timingReply.gold.publicOutcome?.historyCreated, false);
  const completionOnly = cases.find((item) => item.id === "2110618732666257557::text-only")!;
  const completionWithChain = cases.find((item) => item.id === "2110618732666257557::verified-quote-reply-parent-chain")!;
  assert.equal(completionOnly.gold.publicOutcome?.activeNotice, true);
  assert.equal(completionOnly.gold.publicOutcome?.historyCreated, false);
  assert.equal(completionWithChain.gold.decision, "classify");
  assert.equal(completionWithChain.gold.publicOutcome?.activeNotice, false);
  assert.equal(completionWithChain.gold.publicOutcome?.historyCreated, true);
});
