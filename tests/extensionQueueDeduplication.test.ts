import test from "node:test";
import assert from "node:assert";

/**
 * Simulates Chrome extension queue deduplication and storage-first inFlight removal
 */
class ExtensionQueueSimulator {
  private inFlightTweetIds = new Set<string>();
  private processedIds: string[] = [];

  public getInFlightCount(): number {
    return this.inFlightTweetIds.size;
  }

  public getProcessedIds(): string[] {
    return [...this.processedIds];
  }

  public async scanTweet(tweetId: string, apiResponseSuccess: boolean): Promise<boolean> {
    // 1. Skip if already processed in storage OR currently in-flight
    if (this.processedIds.includes(tweetId) || this.inFlightTweetIds.has(tweetId)) {
      return false; // Skipped (Deduplicated)
    }

    // 2. Add to inFlight Set BEFORE initiating network request
    this.inFlightTweetIds.add(tweetId);

    // Simulate async network Webhook call
    await new Promise((r) => setTimeout(r, 10));

    if (apiResponseSuccess) {
      // FIRST: Save to storage completely
      await this.saveToStorage(tweetId);
      // LAST: Remove from inFlight Set AFTER storage is updated
      this.inFlightTweetIds.delete(tweetId);
      return true; // Sent & Processed successfully
    } else {
      // On failure: Remove from inFlight to allow retry on next scan
      this.inFlightTweetIds.delete(tweetId);
      return false;
    }
  }

  private async saveToStorage(tweetId: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 10));
    if (!this.processedIds.includes(tweetId)) {
      this.processedIds.push(tweetId);
      if (this.processedIds.length > 100) {
        this.processedIds.shift();
      }
    }
  }
}

test("ExtensionQueueSimulator prevents concurrent duplicate sends while in-flight", async () => {
  const sim = new ExtensionQueueSimulator();
  const tweetId = "998877665544";

  // Trigger two concurrent scans for the same tweet ID
  const p1 = sim.scanTweet(tweetId, true);
  const p2 = sim.scanTweet(tweetId, true);

  const [res1, res2] = await Promise.all([p1, p2]);

  // One scan must succeed and one must be skipped due to inFlight guard
  assert.strictEqual(res1 || res2, true);
  assert.strictEqual(res1 && res2, false, "Concurrent scan for same tweetId must be deduplicated");
  assert.deepStrictEqual(sim.getProcessedIds(), [tweetId]);
  assert.strictEqual(sim.getInFlightCount(), 0);
});

test("ExtensionQueueSimulator prevents re-sending immediately after success", async () => {
  const sim = new ExtensionQueueSimulator();
  const tweetId = "112233445566";

  // First scan succeeds
  const firstResult = await sim.scanTweet(tweetId, true);
  assert.strictEqual(firstResult, true);

  // Subsequent scan immediately after success
  const secondResult = await sim.scanTweet(tweetId, true);
  assert.strictEqual(secondResult, false, "Subsequent scan after storage save must be skipped");
});

test("ExtensionQueueSimulator allows retry on API failure", async () => {
  const sim = new ExtensionQueueSimulator();
  const tweetId = "555555555555";

  // First scan fails on API
  const failResult = await sim.scanTweet(tweetId, false);
  assert.strictEqual(failResult, false);
  assert.strictEqual(sim.getInFlightCount(), 0);

  // Next scan retries and succeeds
  const retryResult = await sim.scanTweet(tweetId, true);
  assert.strictEqual(retryResult, true);
  assert.deepStrictEqual(sim.getProcessedIds(), [tweetId]);
});
