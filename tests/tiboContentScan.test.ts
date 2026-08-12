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

function getScanUtilities() {
  const context: Record<string, unknown> = { URL };
  createContext(context);
  runInContext(
    readFileSync("extension/tibo-monitor/scan-utils.js", "utf8"),
    context,
  );
  return context.TiboMonitorScan as {
    getTimelineSource: (url: string) => string | null;
    isTiboStatusUrl: (url: string) => boolean;
    shouldRestoreMonitoredTimeline: (url: string, timeline: string | null) => boolean;
    createTimelineRestoreGate: (debounceMs?: number, now?: () => number) => {
      tryStart: () => boolean;
      finish: () => void;
      reset: () => void;
    };
  };
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

test("timeline ownership recognizes canonical pages but never status pages", () => {
  const scan = getScanUtilities();

  assert.equal(scan.getTimelineSource("https://x.com/thsottiaux"), "profile");
  assert.equal(scan.getTimelineSource("https://x.com/thsottiaux/with_replies"), "with_replies");
  assert.equal(scan.getTimelineSource("https://x.com/thsottiaux/status/123"), null);
  assert.equal(scan.isTiboStatusUrl("https://twitter.com/thsottiaux/status/123"), true);
  assert.equal(scan.isTiboStatusUrl("https://x.com/other/status/123"), false);
});

test("only the owned Tibo status page requests timeline restoration", () => {
  const scan = getScanUtilities();
  const statusUrl = "https://x.com/thsottiaux/status/123";

  assert.equal(scan.shouldRestoreMonitoredTimeline(statusUrl, "profile"), true);
  assert.equal(scan.shouldRestoreMonitoredTimeline(statusUrl, "with_replies"), true);
  assert.equal(scan.shouldRestoreMonitoredTimeline("https://x.com/other/status/123", "profile"), false);
  assert.equal(scan.shouldRestoreMonitoredTimeline("https://x.com/home", "profile"), false);
  assert.equal(scan.shouldRestoreMonitoredTimeline("https://x.com/search?q=reset", "profile"), false);
  assert.equal(scan.shouldRestoreMonitoredTimeline("https://x.com/notifications", "profile"), false);
});

test("timeline restore gate suppresses in-flight and rapid duplicate requests", () => {
  const scan = getScanUtilities();
  let now = 1000;
  const gate = scan.createTimelineRestoreGate(3000, () => now);

  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  gate.finish();
  now += 1000;
  assert.equal(gate.tryStart(), false);
  now += 2000;
  assert.equal(gate.tryStart(), true);
  gate.reset();
  assert.equal(gate.tryStart(), true);
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

test("content.js does not access storage.local directly after trusted-context hardening", () => {
  const source = readFileSync("extension/tibo-monitor/content.js", "utf8");

  assert.doesNotMatch(source, /chrome\.storage\.local/);
  assert.match(source, /GET_CONTENT_MONITOR_STATE/);
  assert.match(source, /SAVE_CONTENT_SCAN_DIAGNOSTIC/);
});
