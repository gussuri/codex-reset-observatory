import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { CodexUsageSnapshot } from "../lib/codexUsageRecovery";
import type { PendingMonitorPost } from "../tools/codex-usage-monitor";
import {
  createPendingMonitorPostStore,
  deliverPendingMonitorPost,
  getMonitorPendingPostsPath,
} from "../tools/codex-usage-monitor-persistence";

function snapshot(observedAt: string, overrides: Partial<CodexUsageSnapshot> = {}): CodexUsageSnapshot {
  return {
    observedAt,
    limitId: "codex",
    planType: "plus",
    usedPercent: 20,
    windowDurationMins: 10080,
    resetsAt: 1_787_012_727,
    ...overrides,
  };
}

test("failed delivery survives process and app-server session restarts and resumes oldest-first", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-usage-monitor-"));
  try {
    const queuePath = path.join(directory, "pending-posts.json");
    const first = { reason: "initial", snapshot: snapshot("2026-09-25T00:00:00.000Z") } as const;
    const second = { reason: "structure_change", snapshot: snapshot("2026-09-25T00:02:00.000Z") } as const;
    const firstStore = createPendingMonitorPostStore(queuePath);
    firstStore.save([first, second]);

    const failedAttempt = await deliverPendingMonitorPost(
      firstStore.load(),
      async () => null,
      (posts) => firstStore.save(posts),
    );
    assert.equal(failedAttempt.attempted, true);
    assert.equal(failedAttempt.accepted, false);
    assert.deepEqual(failedAttempt.pendingPosts, [first, second]);

    const rejectedAttempt = await deliverPendingMonitorPost(
      firstStore.load(),
      async () => ({ accepted: false }),
      (posts) => firstStore.save(posts),
    );
    assert.equal(rejectedAttempt.accepted, false, "an HTTP success without server acceptance is still pending");
    assert.deepEqual(firstStore.load(), [first, second]);

    // A new store instance represents either a process restart or an internal app-server session restart.
    const restartedStore = createPendingMonitorPostStore(queuePath);
    const restored = restartedStore.load();
    assert.deepEqual(restored, [first, second]);

    let deliveredObservedAt: string | null = null;
    const accepted = await deliverPendingMonitorPost(
      restored,
      async (post) => {
        deliveredObservedAt = post.snapshot.observedAt;
        return { accepted: true };
      },
      (posts) => restartedStore.save(posts),
    );
    assert.equal(deliveredObservedAt, first.snapshot.observedAt, "the oldest observation is retried first");
    assert.equal(accepted.accepted, true);
    assert.deepEqual(accepted.pendingPosts, [second]);
    assert.deepEqual(restartedStore.load(), [second], "accepted observations are removed durably");

    const nextSession = createPendingMonitorPostStore(queuePath);
    assert.deepEqual(nextSession.load(), [second], "newer observations survive removing the accepted head");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepted response followed by local deletion failure replays safely with a stable observation identity", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-usage-monitor-replay-"));
  try {
    const queuePath = path.join(directory, "pending-posts.json");
    const entry = { reason: "recovery_candidate", snapshot: snapshot("2026-09-25T00:04:00.000Z") } as const;
    const store = createPendingMonitorPostStore(queuePath);
    store.save([entry]);

    const acceptedServerKeys = new Set<string>();
    let createdHistoryRows = 0;
    const acceptIdempotently = async (post: PendingMonitorPost) => {
      const identity = `${post.snapshot.observedAt}:${post.snapshot.resetsAt}`;
      if (!acceptedServerKeys.has(identity)) {
        acceptedServerKeys.add(identity);
        createdHistoryRows += 1;
      }
      return { accepted: true };
    };

    await assert.rejects(() => deliverPendingMonitorPost(
      store.load(),
      acceptIdempotently,
      () => { throw new Error("pending_posts_write_failed"); },
    ));
    assert.deepEqual(store.load(), [entry], "the durable queue remains intact if local acknowledgement fails");

    const restartedStore = createPendingMonitorPostStore(queuePath);
    const replay = await deliverPendingMonitorPost(
      restartedStore.load(),
      acceptIdempotently,
      (posts) => restartedStore.save(posts),
    );
    assert.equal(replay.accepted, true);
    assert.equal(createdHistoryRows, 1, "the same server-side observation identity does not create duplicate history");
    assert.deepEqual(restartedStore.load(), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pending queue storage is atomic, minimal, and rejects corrupt or unwritable state without discarding it", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-usage-monitor-store-"));
  try {
    const queuePath = path.join(directory, "pending-posts.json");
    const store = createPendingMonitorPostStore(queuePath);
    const unsafeEntry = {
      reason: "initial",
      snapshot: { ...snapshot("2026-09-25T00:00:00.000Z"), token: "do-not-persist", secret: "do-not-persist" },
      webhookSecret: "do-not-persist",
    } as unknown as PendingMonitorPost;
    store.save([unsafeEntry]);

    const storedText = readFileSync(queuePath, "utf8");
    assert.equal(storedText.includes("do-not-persist"), false);
    assert.deepEqual(readdirSync(directory), ["pending-posts.json"], "temporary atomic-write files are cleaned up");
    assert.equal(store.load()[0]?.snapshot.observedAt, "2026-09-25T00:00:00.000Z");

    const corruptPath = path.join(directory, "corrupt.json");
    writeFileSync(corruptPath, "{not-json", "utf8");
    const corruptStore = createPendingMonitorPostStore(corruptPath);
    assert.throws(() => corruptStore.load());
    assert.equal(readFileSync(corruptPath, "utf8"), "{not-json", "corrupt data is preserved for recovery");

    const blocker = path.join(directory, "not-a-directory");
    writeFileSync(blocker, "preserve", "utf8");
    const unwritableStore = createPendingMonitorPostStore(path.join(blocker, "queue.json"));
    assert.throws(() => unwritableStore.save([]));
    assert.equal(readFileSync(blocker, "utf8"), "preserve");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("monitor queue path uses the same stable LocalAppData folder as the desktop host", async () => {
  assert.equal(
    getMonitorPendingPostsPath({
      NODE_ENV: "test",
      LOCALAPPDATA: "C:\\Users\\Tester\\AppData\\Local",
    }),
    path.join("C:\\Users\\Tester\\AppData\\Local", "CodexUsageMonitor", "pending-posts.json"),
  );

  const hostSource = readFileSync(path.resolve("apps/codex-usage-monitor/Program.cs"), "utf8");
  assert.match(hostSource, /new Mutex/);
});

test("session code restores and persists the queue, while the existing webhook contract is replay-idempotent", () => {
  const monitorSource = readFileSync(path.resolve("tools/codex-usage-monitor.ts"), "utf8");
  const sessionStart = monitorSource.indexOf("async function runAppServerSession");
  const sessionLoad = monitorSource.indexOf("pendingPostStore.load()", sessionStart);
  assert.ok(sessionLoad > sessionStart, "each internal app-server session restores durable pending observations");
  const firstEnqueue = monitorSource.indexOf("monitorSnapshotState = enqueueMonitorSnapshotPost(", sessionLoad);
  const queueSave = monitorSource.indexOf("persistPendingPosts(getPendingMonitorPosts(monitorSnapshotState))", firstEnqueue);
  const deliveryCall = monitorSource.indexOf("deliverPendingMonitorPost(", queueSave);
  assert.ok(firstEnqueue > sessionLoad && queueSave > firstEnqueue && deliveryCall > queueSave,
    "the session persists a queued post before delivery");
  assert.match(monitorSource.slice(sessionStart), /deliverPendingMonitorPost/);

  const storeSource = readFileSync(path.resolve("lib/codexUsageRecoveryStore.ts"), "utf8");
  assert.match(storeSource, /onConflict:\s*"source_key,observed_at,current_resets_at"/);
  const sql = readFileSync(
    path.resolve("supabase/migrations/20260830100000_add_codex_usage_atomic_write_rpc.sql"),
    "utf8",
  );
  assert.match(sql, /on conflict \(source_key, observed_at, current_resets_at\)/i);
  assert.match(sql, /expected_previous_observed_at/);
});
