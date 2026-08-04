import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";

type ParsedTweet = {
  tweetId: string;
  createdAt: string;
  timestamp: number;
};

function getNewestSelector() {
  const context: Record<string, unknown> = {};
  createContext(context);
  runInContext(
    readFileSync("extension/tibo-monitor/scan-utils.js", "utf8"),
    context,
  );
  return (context.TiboMonitorScan as { selectNewestParsedTweet: (current: ParsedTweet | null, candidate: Partial<ParsedTweet>) => ParsedTweet }).selectNewestParsedTweet;
}

function newestInOrder(
  selector: ReturnType<typeof getNewestSelector>,
  tweets: Array<Partial<ParsedTweet>>,
) {
  return tweets.reduce<ParsedTweet | null>(
    (current, tweet) => selector(current, tweet),
    null,
  );
}

test("selects the same newest tweet regardless of DOM order", () => {
  const selectNewest = getNewestSelector();
  const tweets = [
    { tweetId: "old", createdAt: "2026-08-05T00:01:00.000Z" },
    { tweetId: "newest", createdAt: "2026-08-05T00:05:00.000Z" },
    { tweetId: "middle", createdAt: "2026-08-05T00:03:00.000Z" },
  ];

  assert.equal(newestInOrder(selectNewest, tweets)?.tweetId, "newest");
  assert.equal(newestInOrder(selectNewest, [...tweets].reverse())?.tweetId, "newest");
});

test("a newer parsed tweet is not rolled back by an older article at the end", () => {
  const selectNewest = getNewestSelector();
  const result = newestInOrder(selectNewest, [
    { tweetId: "newest", createdAt: "2026-08-05T00:05:00.000Z" },
    { tweetId: "old", createdAt: "2026-08-05T00:01:00.000Z" },
  ]);

  assert.equal(result?.tweetId, "newest");
  assert.equal(result?.createdAt, "2026-08-05T00:05:00.000Z");
});

test("processed or in-flight parsed tweets remain eligible for newest-post diagnostics", () => {
  const selectNewest = getNewestSelector();
  const result = newestInOrder(selectNewest, [
    { tweetId: "processed-newest", createdAt: "2026-08-05T00:05:00.000Z" },
    { tweetId: "in-flight", createdAt: "2026-08-05T00:04:00.000Z" },
  ]);

  assert.equal(result?.tweetId, "processed-newest");
});

test("invalid datetime candidates are ignored by the selector", () => {
  const selectNewest = getNewestSelector();
  const result = newestInOrder(selectNewest, [
    { tweetId: "invalid", createdAt: "not-a-date" },
    { tweetId: "valid", createdAt: "2026-08-05T00:02:00.000Z" },
  ]);

  assert.equal(result?.tweetId, "valid");
});

test("content.js selects after a valid parse and before deduplication", () => {
  const source = readFileSync("extension/tibo-monitor/content.js", "utf8");
  const selectionIndex = source.indexOf("TiboMonitorScan.selectNewestParsedTweet");
  const processedCheckIndex = source.indexOf("processedTweetIds.has(tweetId)");

  assert.ok(selectionIndex >= 0);
  assert.ok(processedCheckIndex > selectionIndex);
  assert.ok(selectionIndex > source.indexOf("if (translated)"));
  assert.match(source, /newestSeenTweetCreatedAt/);
});
