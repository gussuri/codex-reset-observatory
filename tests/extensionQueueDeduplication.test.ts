import test from "node:test";
import assert from "node:assert";
import { TweetDeduplicator, StorageAdapter, FetchAdapter } from "../lib/extension/deduplicator";

/**
 * In-memory Storage Adapter simulating chrome.storage.local for tests
 */
class InMemoryStorageAdapter implements StorageAdapter {
  private processedIds: string[] = [];

  public async getProcessedIds(): Promise<string[]> {
    // Simulate slight async read delay
    await new Promise((r) => setTimeout(r, 5));
    return [...this.processedIds];
  }

  public async saveProcessedIds(ids: string[]): Promise<void> {
    // Simulate async write delay
    await new Promise((r) => setTimeout(r, 5));
    this.processedIds = [...ids];
  }
}

test("TweetDeduplicator handles concurrent identical tweetId requests from multiple tabs without duplicate fetch", async () => {
  const storage = new InMemoryStorageAdapter();
  let fetchCallCount = 0;

  const mockFetcher: FetchAdapter = async (payload) => {
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

  const mockFetcher: FetchAdapter = async (payload) => {
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
        json: async () => ({ error: "Internal Error" }),
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
  const tweetId = "failed_then_retry_id";

  // First call fails
  await assert.rejects(
    deduplicator.processTweet({ tweetId, text: "Failing tweet" }),
    /HTTP 500/
  );

  const storedAfterFail = await storage.getProcessedIds();
  assert.strictEqual(storedAfterFail.length, 0, "Failed tweet must not be saved to storage");

  // Retry succeeds
  const retryResult = await deduplicator.processTweet({ tweetId, text: "Failing tweet" });
  assert.strictEqual(retryResult.success, true);

  const storedAfterRetry = await storage.getProcessedIds();
  assert.deepStrictEqual(storedAfterRetry, [tweetId], "Retried tweet must be saved to storage");
});
