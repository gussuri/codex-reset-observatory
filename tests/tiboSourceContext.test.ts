import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { TextEncoder } from "node:util";

import {
  parseTiboSourceContextEnrichment,
  storeTiboSourceContextEnrichment,
} from "../lib/radar/tiboSourceContext";

const root = {
  kind: "source_context_enrichment",
  tweetId: "987654321098765432",
  tweetUrl: "https://x.com/thsottiaux/status/987654321098765432",
  tweetCreatedAt: "2026-10-18T00:00:00.000Z",
  text: "Child root body",
  sourceTimeline: "profile",
  detectedAt: "2026-10-18T01:00:00.000Z",
  clientRevisionHash: "untrusted-client-hash",
  isReply: true,
  replyToHandles: ["@Parent_Author"],
  replyParentTweetId: "123456789012345678",
  replyParentTweetUrl: "https://twitter.com/Parent_Author/status/123456789012345678",
  replyContextText: " Parent context ",
};

test("normalizes verified parent context and hashes only stable source evidence", () => {
  const first = parseTiboSourceContextEnrichment(root);
  const second = parseTiboSourceContextEnrichment({
    ...root,
    sourceTimeline: "with_replies",
    detectedAt: "2026-10-19T00:00:00.000Z",
    clientRevisionHash: "different-untrusted-hash",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value.snapshot.parent, {
    tweetId: "123456789012345678",
    tweetUrl: "https://x.com/parent_author/status/123456789012345678",
    authorHandle: "@parent_author",
    text: "Parent context",
  });
  assert.equal(first.value.revisionHash, second.value.revisionHash);
  assert.notEqual(first.value.revisionHash, root.clientRevisionHash);
});

test("accepts quote and reply source context independently in one snapshot", () => {
  const result = parseTiboSourceContextEnrichment({
    ...root,
    isQuote: true,
    quoteTweetUrl: "https://x.com/Quote_Author/status/222222222222222222",
    quoteAuthorHandle: "@Quote_Author",
    quoteContextText: "quoted context",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.snapshot.parent?.tweetId, "123456789012345678");
  assert.equal(result.value.snapshot.quote?.tweetId, "222222222222222222");
});

test("canonicalizes quote URL aliases and stable reply evidence before hashing", () => {
  const quoteOnly = parseTiboSourceContextEnrichment({
    ...root,
    isReply: false,
    replyToHandles: [],
    replyParentTweetId: null,
    replyParentTweetUrl: null,
    replyContextText: null,
    isQuote: true,
    quoteTweetUrl: "https://twitter.com/Author/status/222222222222222222",
    quoteAuthorHandle: "@author",
    quoteContextText: " Quote ",
  });
  assert.equal(quoteOnly.ok, true);
  if (!quoteOnly.ok) return;
  assert.equal(quoteOnly.value.snapshot.quote?.tweetUrl, "https://x.com/author/status/222222222222222222");

  const first = parseTiboSourceContextEnrichment(root);
  const equivalent = parseTiboSourceContextEnrichment({
    ...root,
    tweetUrl: "https://twitter.com/thsottiaux/status/987654321098765432",
    replyToHandles: ["Other_Handle", "Parent_Author"],
    replyParentTweetUrl: "https://x.com/parent_author/status/123456789012345678",
    replyContextText: "Parent context",
    sourceTimeline: "with_replies",
    detectedAt: "2099-01-01T00:00:00.000Z",
    text: " Child root body ",
    tweetCreatedAt: "2026-10-18T00:00:00Z",
  });
  assert.equal(first.ok, true);
  assert.equal(equivalent.ok, true);
  if (!first.ok || !equivalent.ok) return;
  assert.equal(first.value.revisionHash, equivalent.value.revisionHash);
});

test("rejects weak, malformed, unsafe, and root-mismatched enrichment payloads", () => {
  const cases: Array<Record<string, unknown>> = [
    { ...root, isReply: false },
    { ...root, replyToHandles: ["@different"] },
    { ...root, replyParentTweetId: "123456789012345679" },
    { ...root, replyContextText: null },
    { ...root, tweetUrl: "https://x.com/thsottiaux/status/111111111111111111" },
    { ...root, tweetUrl: "https://x.com/thsottiaux/status/987654321098765432?x=1" },
    { ...root, tweetCreatedAt: "bad date" },
    { ...root, kind: "ordinary_post" },
    { ...root, isReply: false, replyToHandles: [], replyParentTweetId: null, replyParentTweetUrl: null },
  ];
  for (const payload of cases) {
    assert.equal(parseTiboSourceContextEnrichment(payload).ok, false);
  }
  assert.equal(parseTiboSourceContextEnrichment({
    ...root,
    replyParentTweetId: null,
    replyParentTweetUrl: null,
    isReply: false,
  }).ok, false);
  assert.equal(parseTiboSourceContextEnrichment({
    ...root,
    replyParentTweetId: null,
    replyParentTweetUrl: null,
    isReply: false,
    replyToHandles: [],
    replyContextText: null,
    isQuote: true,
    quoteTweetUrl: "https://x.com/quote/status/222222222222222222?tracking=1",
    quoteAuthorHandle: "@quote",
    quoteContextText: "quote text",
  }).ok, false);
});

test("recomputes a narrow server revision and invokes only the source-context RPC", async () => {
  let capturedName = "";
  let capturedArgs: Record<string, unknown> = {};
  const parsed = parseTiboSourceContextEnrichment(root);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await storeTiboSourceContextEnrichment({
    async rpc(name, args) {
      capturedName = name;
      capturedArgs = args;
      return { data: { status: "applied" }, error: null };
    },
  }, parsed.value);
  assert.equal(capturedName, "merge_tibo_source_context_enrichment");
  assert.deepEqual(Object.keys(capturedArgs).sort(), [
    "p_revision_hash",
    "p_snapshot",
    "p_text",
    "p_tweet_created_at",
    "p_tweet_id",
    "p_tweet_url",
  ]);
  assert.equal(capturedArgs.p_revision_hash, parsed.value.revisionHash);
});

test("service worker persists terminal revisions across retries and worker restarts", async () => {
  const storage: Record<string, unknown> = {
    webhook_secret: "test-only-secret",
    observatory_domain: "https://example.test",
  };
  let fetchCount = 0;
  let responseStatus = 409;
  const workerSource = fs.readFileSync(path.join(process.cwd(), "extension/tibo-monitor/service-worker.js"), "utf8");
  const startWorker = (fetchImpl: () => Promise<{ ok: boolean; status: number; text?: () => Promise<string>; json?: () => Promise<unknown> }> = async () => {
    fetchCount += 1;
    return responseStatus === 200
      ? { ok: true, status: 200, json: async () => ({ success: true, status: "applied" }) }
      : { ok: false, status: responseStatus, text: async () => "temporary" };
  }) => {
    const local = {
      async get(keys: string[]) {
        return Object.fromEntries(keys.filter((key) => Object.hasOwn(storage, key)).map((key) => [key, storage[key]]));
      },
      async set(items: Record<string, unknown>) { Object.assign(storage, items); },
      async setAccessLevel() {},
    };
    const context = vm.createContext({
      chrome: {
        storage: { local },
        runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getManifest: () => ({ version: "test" }) },
        alarms: { get(_name: string, callback: (alarm: unknown) => void) { callback(null); }, create() {}, onAlarm: { addListener() {} } },
        tabs: { query: async () => [] },
      },
      TiboDiagnostics: { appendDiagnosticLog: async () => {}, markSuccessfulScan: async () => {} },
      TiboMonitorScan: { isTiboStatusUrl: () => false },
      importScripts() {},
      crypto: webcrypto,
      TextEncoder,
      URL,
      fetch: fetchImpl,
      console,
    });
    vm.runInContext(`${workerSource}\nglobalThis.__enqueueSourceContext = enqueueSourceContextEnrichment; globalThis.__normalizeSourceContext = normalizeSourceContextPayload; globalThis.__retryPendingTweet = retryPendingTweet; globalThis.__retryTweet = retryTweet; globalThis.__clearAuth = clearAuthBlockedQuarantine;`, context);
    return context as typeof context & {
      __enqueueSourceContext: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
      __normalizeSourceContext: (payload: Record<string, unknown>) => unknown;
      __retryPendingTweet: () => Promise<Record<string, unknown>>;
      __retryTweet: (tweetId: string) => Promise<Record<string, unknown>>;
      __clearAuth: () => Promise<{ clearedCount: number }>;
    };
  };

  const firstWorker = startWorker();
  const payload = {
    kind: "source_context_enrichment",
    tweetId: "987654321098765432",
    tweetUrl: "https://x.com/thsottiaux/status/987654321098765432",
    tweetCreatedAt: "2026-10-18T00:00:00.000Z",
    text: "Child root body",
    isReply: true,
    replyToHandles: ["@parent"],
    replyParentTweetId: "123456789012345678",
    replyParentTweetUrl: "https://x.com/parent/status/123456789012345678",
    replyContextText: "Parent evidence",
  };
  assert.ok(firstWorker.__normalizeSourceContext(payload), "test payload must match the worker contract");
  const equivalentWorkerPayload = firstWorker.__normalizeSourceContext({
    ...payload,
    tweetUrl: "https://twitter.com/THSOTTIAUX/status/987654321098765432",
    replyParentTweetUrl: "https://twitter.com/PARENT/status/123456789012345678",
    replyToHandles: ["Other_Handle", "Parent"],
    replyContextText: " Parent evidence ",
    sourceTimeline: "with_replies",
    detectedAt: "2099-01-01T00:00:00.000Z",
  }) as { snapshot: Record<string, unknown> };
  assert.deepEqual(JSON.parse(JSON.stringify(equivalentWorkerPayload.snapshot)),
    JSON.parse(JSON.stringify((firstWorker.__normalizeSourceContext(payload) as { snapshot: Record<string, unknown> }).snapshot)));
  const response = await firstWorker.__enqueueSourceContext(payload);
  assert.equal(response.error, undefined, JSON.stringify(response));
  assert.equal(response.success, false);
  assert.equal(fetchCount, 1);
  assert.equal((storage.tibo_source_context_revision_ledger as Array<{ terminalRevisions: Record<string, string> }>)[0].terminalRevisions[Object.keys((storage.tibo_source_context_revision_ledger as Array<{ terminalRevisions: Record<string, string> }>)[0].terminalRevisions)[0]], "terminal");
  assert.deepEqual(Array.from(storage.tibo_pending_source_context_enrichments as unknown[]), []);

  const restartedWorker = startWorker();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const repeated = await restartedWorker.__enqueueSourceContext(payload);
    assert.equal(repeated.success, false);
    assert.equal(repeated.terminal, true);
  }
  assert.equal(fetchCount, 1, "terminal revision must stay suppressed after a worker restart");

  responseStatus = 503;
  const retryPayload = {
    ...payload,
    replyParentTweetId: "223456789012345678",
    replyParentTweetUrl: "https://x.com/parent/status/223456789012345678",
    replyContextText: "Updated parent evidence",
  };
  const failed = await restartedWorker.__enqueueSourceContext(retryPayload);
  assert.equal(failed.retryable, true);
  assert.equal(Array.from(storage.tibo_pending_source_context_enrichments as unknown[]).length, 1);
  (storage.tibo_pending_source_context_enrichments as Array<{ nextAttemptAt: number }>)[0].nextAttemptAt = 0;
  responseStatus = 200;
  const retried = await restartedWorker.__retryPendingTweet();
  assert.equal(retried.status, "applied");
  assert.deepEqual(Array.from(storage.tibo_pending_source_context_enrichments as unknown[]), []);
  assert.equal(fetchCount, 3, "503 is retried once, while terminal 409 never is");
  await Promise.all(Array.from({ length: 5 }, () => restartedWorker.__enqueueSourceContext(retryPayload)));
  assert.equal(fetchCount, 3, "same-revision submissions from multiple tabs are deduplicated");

  responseStatus = 401;
  const authPayload = { ...retryPayload, replyParentTweetId: "323456789012345678", replyParentTweetUrl: "https://x.com/parent/status/323456789012345678" };
  const authResult = await restartedWorker.__enqueueSourceContext(authPayload);
  assert.equal(authResult.success, false);
  assert.equal(authResult.quarantined, true);
  assert.ok(Object.keys(storage.tibo_quarantined_tweet_ids as Record<string, unknown>).some((key) => key.startsWith("source-context:")));
  const cleared = await restartedWorker.__clearAuth();
  assert.equal(cleared.clearedCount, 1);
  responseStatus = 200;
  const recovered = await restartedWorker.__enqueueSourceContext(authPayload);
  assert.equal(recovered.status, "applied", "clearing auth quarantine allows the same revision to retry");
  assert.equal(fetchCount, 5);
  const overLimit = await restartedWorker.__enqueueSourceContext({
    ...authPayload,
    replyParentTweetId: "423456789012345678",
    replyParentTweetUrl: "https://x.com/parent/status/423456789012345678",
    replyContextText: "Fourth evidence revision",
  });
  assert.equal(overLimit.terminal, true);
  assert.equal(overLimit.success, false, "terminal refusal is not an applied acknowledgement");
  assert.equal(overLimit.error, "revision_limit");
  assert.equal(fetchCount, 5, "terminal revisions count toward the per-tweet maximum");

  responseStatus = 503;
  const secondTweet = { ...payload, tweetId: "887654321098765432", tweetUrl: "https://x.com/thsottiaux/status/887654321098765432" };
  await restartedWorker.__enqueueSourceContext(secondTweet);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    (storage.tibo_pending_source_context_enrichments as Array<{ nextAttemptAt: number }>)[0].nextAttemptAt = 0;
    await restartedWorker.__retryPendingTweet();
  }
  assert.equal((storage.tibo_pending_source_context_enrichments as Array<{ retryExhausted: boolean }>)[0].retryExhausted, true);
  const exhaustedFetchCount = fetchCount;
  await restartedWorker.__retryPendingTweet();
  assert.equal(fetchCount, exhaustedFetchCount, "retry attempts stop at the existing maximum");
  await restartedWorker.__retryTweet(secondTweet.tweetId);
  responseStatus = 200;
  await restartedWorker.__retryPendingTweet();
  assert.equal(Array.from(storage.tibo_pending_source_context_enrichments as unknown[]).length, 0, "explicit tweet retry resets an exhausted source-context item");

  responseStatus = 503;
  const concurrentTweet = { ...payload, tweetId: "777654321098765432", tweetUrl: "https://x.com/thsottiaux/status/777654321098765432" };
  await restartedWorker.__enqueueSourceContext(concurrentTweet);
  await restartedWorker.__enqueueSourceContext({
    ...concurrentTweet,
    replyParentTweetId: "223456789012345678",
    replyParentTweetUrl: "https://x.com/parent/status/223456789012345678",
    replyContextText: "Second pending evidence",
  });
  assert.equal(Array.from(storage.tibo_pending_source_context_enrichments as unknown[]).length, 2);
  (storage.tibo_pending_source_context_enrichments as Array<{ nextAttemptAt: number }>).forEach((entry) => { entry.nextAttemptAt = 0; });
  responseStatus = 200;
  await restartedWorker.__retryPendingTweet();
  assert.equal(Array.from(storage.tibo_pending_source_context_enrichments as unknown[]).length, 1, "ack removes only its exact pending revision");
  await restartedWorker.__retryPendingTweet();
  assert.deepEqual(Array.from(storage.tibo_pending_source_context_enrichments as unknown[]), []);
});\n