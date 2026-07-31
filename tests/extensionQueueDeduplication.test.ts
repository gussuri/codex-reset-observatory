import test from "node:test";
import assert from "node:assert";
import { TweetDeduplicator, StorageAdapter, FetchAdapter } from "../lib/extension/deduplicator";

/**
 * In-memory Storage Adapter simulating chrome.storage.local for tests
 */
class InMemoryStorageAdapter implements StorageAdapter {
  private processedIds: string[] = [];

  constructor(initialIds: string[] = []) {
    this.processedIds = [...initialIds];
  }

  public async getProcessedIds(): Promise<string[]> {
    await new Promise((r) => setTimeout(r, 2));
    return [...this.processedIds];
  }

  public async saveProcessedIds(ids: string[]): Promise<void> {
    await new Promise((r) => setTimeout(r, 2));
    this.processedIds = [...ids];
  }
}

test("TweetDeduplicator handles concurrent identical tweetId requests from multiple tabs without duplicate fetch", async () => {
  const storage = new InMemoryStorageAdapter();
  let fetchCallCount = 0;

  const mockFetcher: FetchAdapter = async () => {
    fetchCallCount++;
    await new Promise((r) => setTimeout(r, 10)); // Network delay
    return {
      ok: true,
      status: 200,
      text: async () => "OK",
      json: async () => ({ success: true }),
    };
  };

  const deduplicator = new TweetDeduplicator(storage, mockFetcher);
  const sameTweetId = "998877665544";

  // Simulate 5 concurrent requests from different tabs for the exact same tweetId
  const reqs = Array.from({ length: 5 }).map(() =>
    deduplicator.processTweet({ tweetId: sameTweetId, text: "Sample tweet" })
  );

  const results = await Promise.all(reqs);

  // Exactly 1 request must execute fetch, others must be skipped
  assert.strictEqual(fetchCallCount, 1, "Webhook fetch must be called exactly once");

  const skippedCount = results.filter((r) => r.skipped === true).length;
  assert.strictEqual(skippedCount, 4, "4 duplicate requests must return skipped: true");

  const storedIds = await storage.getProcessedIds();
  assert.deepStrictEqual(storedIds, [sameTweetId], "Storage must contain exactly 1 processed tweet ID");
});

test("TweetDeduplicator safely preserves all IDs when multiple distinct tweetIds complete concurrently", async () => {
  const storage = new InMemoryStorageAdapter();
  let fetchCallCount = 0;

  const mockFetcher: FetchAdapter = async () => {
    fetchCallCount++;
    await new Promise((r) => setTimeout(r, 5));
    return {
      ok: true,
      status: 200,
      text: async () => "OK",
      json: async () => ({ success: true }),
    };
  };

  const deduplicator = new TweetDeduplicator(storage, mockFetcher);
  const distinctTweetIds = ["tweet_101", "tweet_102", "tweet_103", "tweet_104", "tweet_105"];

  // Simulate 5 concurrent requests for 5 DIFFERENT tweet IDs at the exact same time
  const reqs = distinctTweetIds.map((id) =>
    deduplicator.processTweet({ tweetId: id, text: `Tweet content ${id}` })
  );

  const results = await Promise.all(reqs);

  assert.strictEqual(fetchCallCount, 5, "All 5 distinct tweets must trigger fetch");
  assert.ok(results.every((r) => r.success && !r.skipped), "All 5 distinct tweets must succeed");

  const storedIds = await storage.getProcessedIds();
  assert.strictEqual(storedIds.length, 5, "Storage must preserve all 5 processed tweet IDs without race conditions");
  assert.deepStrictEqual(storedIds, distinctTweetIds, "All distinct IDs must be present in storage");
});

test("TweetDeduplicator allows retry when fetch fails", async () => {
  const storage = new InMemoryStorageAdapter();
  let attempt = 0;

  const mockFetcher: FetchAdapter = async () => {
    attempt++;
    if (attempt === 1) {
      return {
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
        json: async () => ({ error: "Failed" }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => "OK",
      json: async () => ({ success: true }),
    };
  };

  const deduplicator = new TweetDeduplicator(storage, mockFetcher);
  const tweetId = "retry_tweet_123";

  // First call fails
  await assert.rejects(
    () => deduplicator.processTweet({ tweetId, text: "Sample" }),
    /HTTP 500/
  );

  const storedAfterFail = await storage.getProcessedIds();
  assert.strictEqual(storedAfterFail.includes(tweetId), false, "Failed tweet must not be saved in storage");

  // Second call succeeds
  const res2 = await deduplicator.processTweet({ tweetId, text: "Sample" });
  assert.strictEqual(res2.success, true);

  const storedAfterSuccess = await storage.getProcessedIds();
  assert.strictEqual(storedAfterSuccess.includes(tweetId), true, "Successful tweet must be saved in storage");
});

test("REQUIREMENT 5: Scanning the same tweetId 100 times triggers Webhook fetch EXACTLY 1 time", async () => {
  const storage = new InMemoryStorageAdapter();
  let fetchCallCount = 0;

  const mockFetcher: FetchAdapter = async () => {
    fetchCallCount++;
    return {
      ok: true,
      status: 200,
      text: async () => "OK",
      json: async () => ({ success: true }),
    };
  };

  const deduplicator = new TweetDeduplicator(storage, mockFetcher);
  const targetTweetId = "repeat_scan_9999";

  // Simulate 100 continuous MutationObserver scans for the same tweetId
  for (let i = 0; i < 100; i++) {
    await deduplicator.processTweet({ tweetId: targetTweetId, text: "Repeated scan tweet" });
  }

  assert.strictEqual(fetchCallCount, 1, "Webhook fetch MUST be executed EXACTLY 1 time even after 100 scans");
  const storedIds = await storage.getProcessedIds();
  assert.deepStrictEqual(storedIds, [targetTweetId]);
});

test("REQUIREMENT 6: Chrome extension restart retains deduplication via chrome.storage.local persistence", async () => {
  // Shared persistent storage simulating chrome.storage.local
  const sharedStorage = new InMemoryStorageAdapter();
  let totalFetchCount = 0;

  const mockFetcher: FetchAdapter = async () => {
    totalFetchCount++;
    return {
      ok: true,
      status: 200,
      text: async () => "OK",
      json: async () => ({ success: true }),
    };
  };

  const existingTweetId = "persisted_tweet_777";

  // 1. Session 1 (Before Extension Restart)
  const deduplicatorInstance1 = new TweetDeduplicator(sharedStorage, mockFetcher);
  const res1 = await deduplicatorInstance1.processTweet({ tweetId: existingTweetId, text: "Tweet before restart" });
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.skipped, undefined);
  assert.strictEqual(totalFetchCount, 1);

  // 2. Extension Restart Simulation (Service Worker / Content Script killed & re-instantiated)
  // New Deduplicator instance created with the same underlying persistent storage
  const deduplicatorInstance2 = new TweetDeduplicator(sharedStorage, mockFetcher);

  // 3. Session 2 (After Extension Restart)
  const res2 = await deduplicatorInstance2.processTweet({ tweetId: existingTweetId, text: "Tweet after restart" });
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.skipped, true, "Must be skipped due to persistent storage deduplication");
  assert.strictEqual(totalFetchCount, 1, "Webhook fetch MUST NOT be called again after extension restart");
});
