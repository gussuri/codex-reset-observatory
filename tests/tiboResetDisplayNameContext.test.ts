import assert from "node:assert/strict";
import test from "node:test";

import {
  findRelatedTiboNotices,
  type FormalTiboResetSignal,
  type TiboNoticeSignal,
} from "../lib/radar/tiboHistory";
import { resolveTiboResetDisplayNameSourceIds } from "../lib/radar/tiboResetDisplayNameContext";

function reset(
  tweetId: string,
  tweetCreatedAt: string,
  identity: Pick<FormalTiboResetSignal, "logical_post_id" | "edit_history_tweet_ids" | "edit_metadata_source"> = {},
): FormalTiboResetSignal {
  return {
    tweet_id: tweetId,
    text: "Put the reset in the bag. All propagated.",
    tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
    tweet_created_at: tweetCreatedAt,
    signal_type: "reset_executed",
    confidence: 0.98,
    verification_status: "confirmed",
    classification_source: "gemini",
    is_reply: false,
    ...identity,
  };
}

function notice(tweetId: string, tweetCreatedAt: string, text: string): TiboNoticeSignal {
  return {
    tweet_id: tweetId,
    text,
    tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
    tweet_created_at: tweetCreatedAt,
    signal_type: "official_notice",
    confidence: 0.99,
    verification_status: "confirmed",
    is_reply: false,
  };
}

test("generation context excludes a nearby independent completion but keeps the resolved edit chain", () => {
  const candidate = reset("current-edit", "2026-10-11T12:04:00Z", {
    logical_post_id: "logical-current",
    edit_history_tweet_ids: ["current-original", "current-edit"],
    edit_metadata_source: "x_api",
  });
  const nearby = reset("other-reset", "2026-10-11T12:02:00Z", {
    logical_post_id: "logical-other",
    edit_history_tweet_ids: ["other-reset"],
    edit_metadata_source: "x_api",
  });
  const sameChainVersion = reset("current-original", "2026-10-11T12:01:00Z", {
    logical_post_id: "logical-current",
    edit_history_tweet_ids: ["current-original", "current-edit"],
    edit_metadata_source: "x_api",
  });

  const result = resolveTiboResetDisplayNameSourceIds({
    candidate,
    canonicalSourceTweetIds: ["current-original", "current-edit"],
    acceptedResets: [nearby, sameChainVersion],
    notices: [],
  });

  assert.deepEqual(result, ["current-edit", "current-original"]);
  assert.equal(result?.includes("other-reset"), false);
});

test("generation context does not reuse a notice consumed by the prior forced reset", () => {
  const candidate = reset("current-reset", "2026-10-11T12:00:00Z");
  const prior = reset("prior-reset", "2026-10-11T11:00:00Z");
  const consumedNotice = notice("notice", "2026-10-11T10:00:00Z", "Reset will happen later today.");
  consumedNotice.expires_at = "2026-10-12T00:00:00Z";

  const result = resolveTiboResetDisplayNameSourceIds({
    candidate,
    canonicalSourceTweetIds: ["current-reset"],
    acceptedResets: [prior],
    notices: [consumedNotice],
  });

  assert.deepEqual(result, ["current-reset"]);
});

test("generation notice association matches read-side selection for uncertain notices", () => {
  const candidate = reset("current-reset", "2026-10-11T12:00:00Z");
  const earlier = notice("notice-a", "2026-10-11T08:00:00Z", "Reset later today.");
  const later = notice("notice-b", "2026-10-11T09:00:00Z", "Another reset update later today.");
  const notices = [earlier, later];
  const related = findRelatedTiboNotices(candidate, notices, null);
  const result = resolveTiboResetDisplayNameSourceIds({
    candidate,
    canonicalSourceTweetIds: ["current-reset"],
    acceptedResets: [],
    notices,
  });

  assert.deepEqual(result, ["current-reset", ...related.map((item) => item.tweet_id)]);
});

test("a BANKED-only boundary does not consume a forced-reset notice", () => {
  const candidate = reset("current-reset", "2026-10-11T12:00:00Z");
  const futureNotice = notice("notice", "2026-10-11T10:00:00Z", "Reset by the end of the day.");
  const result = resolveTiboResetDisplayNameSourceIds({
    candidate,
    canonicalSourceTweetIds: ["current-reset"],
    acceptedResets: [],
    notices: [futureNotice],
  });

  assert.ok(result?.includes("notice"));
});
