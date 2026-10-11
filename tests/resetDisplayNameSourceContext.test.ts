import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResetDisplayNameSourceContext,
  type ResetDisplayNameSourceRow,
} from "../lib/radar/resetDisplayNameSourceContext";

const contextPost: ResetDisplayNameSourceRow = {
  tweet_id: "2095000000000000001",
  text: "GPT Astra is launching today.",
  tweet_created_at: "2026-08-31T00:00:00.000Z",
  signal_type: "official_notice",
  is_reply: false,
  verification_status: "auto_unverified",
};

const resetPost: ResetDisplayNameSourceRow = {
  tweet_id: "2095000000000000002",
  text: "Reset is live.",
  tweet_created_at: "2026-08-31T00:02:00.000Z",
  signal_type: "reset_executed",
  is_reply: false,
  verification_status: "auto_unverified",
};

test("display-name context includes only canonical Tibo provenance in deterministic order", () => {
  const unrelatedPost: ResetDisplayNameSourceRow = {
    tweet_id: "2095000000000000003",
    text: "GPT Nova is launching today.",
    tweet_created_at: "2026-08-31T00:01:00.000Z",
    is_reply: false,
    verification_status: "auto_unverified",
  };

  const context = buildResetDisplayNameSourceContext({
    effectiveFormalCandidate: resetPost,
    sourceTweetIds: [resetPost.tweet_id, contextPost.tweet_id],
    sourceRows: [resetPost, unrelatedPost, contextPost],
  });

  assert.equal(
    context,
    [
      `[Tibo post 1 | role=official_notice | tweet_created_at=${contextPost.tweet_created_at} | tweet_id=${contextPost.tweet_id}]`,
      `AUTHOR TEXT: ${JSON.stringify(contextPost.text)}`,
      `[End Tibo post 1]`,
      "",
      `[Tibo post 2 | role=completion | tweet_created_at=${resetPost.tweet_created_at} | tweet_id=${resetPost.tweet_id}]`,
      `AUTHOR TEXT: ${JSON.stringify(resetPost.text)}`,
      `[End Tibo post 2]`,
    ].join("\n"),
  );
  assert.equal(context?.includes(unrelatedPost.text), false);
});

test("display-name context excludes replies and rejected source rows", () => {
  const reply: ResetDisplayNameSourceRow = {
    ...contextPost,
    tweet_id: "2095000000000000004",
    text: "A reply that is not event evidence.",
    is_reply: true,
  };
  const rejected: ResetDisplayNameSourceRow = {
    ...contextPost,
    tweet_id: "2095000000000000005",
    text: "A rejected post.",
    verification_status: "rejected",
  };

  const context = buildResetDisplayNameSourceContext({
    effectiveFormalCandidate: resetPost,
    sourceTweetIds: [resetPost.tweet_id, reply.tweet_id, rejected.tweet_id],
    sourceRows: [reply, rejected],
  });

  assert.equal(context, [
    `[Tibo post 1 | role=completion | tweet_created_at=${resetPost.tweet_created_at} | tweet_id=${resetPost.tweet_id}]`,
    `AUTHOR TEXT: ${JSON.stringify(resetPost.text)}`,
    `[End Tibo post 1]`,
  ].join("\n"));
});

test("forced-reset source context excludes BANKED notice evidence while retaining canonical posts", () => {
  const bankedNotice: ResetDisplayNameSourceRow = {
    tweet_id: "2095000000000000006",
    text: "I am distributing banked resets for eligible users.",
    tweet_created_at: "2026-08-31T00:01:00.000Z",
    signal_type: "official_notice",
    is_reply: false,
    verification_status: "confirmed",
  };
  const context = buildResetDisplayNameSourceContext({
    effectiveFormalCandidate: resetPost,
    sourceTweetIds: [contextPost.tweet_id, bankedNotice.tweet_id, resetPost.tweet_id],
    sourceRows: [contextPost, bankedNotice, resetPost],
    eventKind: "forced_reset",
  });

  assert.match(context ?? "", /GPT Astra is launching today/);
  assert.match(context ?? "", /Reset is live/);
  assert.doesNotMatch(context ?? "", /banked resets/);
});

test("forced-reset source context excludes BANKED completion posts even when marked reset_executed", () => {
  const bankedCompletion: ResetDisplayNameSourceRow = {
    tweet_id: "2095000000000000008",
    text: "Banked resets have been distributed to all accounts.",
    tweet_created_at: "2026-08-31T00:01:00.000Z",
    signal_type: "reset_executed",
    is_reply: false,
    verification_status: "confirmed",
  };
  const context = buildResetDisplayNameSourceContext({
    effectiveFormalCandidate: resetPost,
    sourceTweetIds: [contextPost.tweet_id, bankedCompletion.tweet_id, resetPost.tweet_id],
    sourceRows: [contextPost, bankedCompletion, resetPost],
    eventKind: "forced_reset",
  });

  assert.match(context ?? "", /GPT Astra is launching today/);
  assert.match(context ?? "", /Reset is live/);
  assert.doesNotMatch(context ?? "", /Banked resets have been distributed/);
});

test("BANKED candidate context does not borrow forced-reset announcement text", () => {
  const bankedNotice: ResetDisplayNameSourceRow = {
    tweet_id: "2095000000000000007",
    text: "I am distributing banked resets to all paid users.",
    tweet_created_at: "2026-08-31T00:01:00.000Z",
    signal_type: "official_notice",
    is_reply: false,
    verification_status: "confirmed",
  };
  const context = buildResetDisplayNameSourceContext({
    effectiveFormalCandidate: bankedNotice,
    sourceTweetIds: [contextPost.tweet_id, bankedNotice.tweet_id],
    sourceRows: [contextPost, bankedNotice],
    eventKind: "banked_distribution",
  });

  assert.match(context ?? "", /distributing banked resets/);
  assert.doesNotMatch(context ?? "", /GPT Astra is launching today/);
});
