import assert from "node:assert/strict";
import { spawn as spawnProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import type { CodexUsageSnapshot } from "../lib/codexUsageRecovery";
import type { PendingMonitorPost } from "../tools/codex-usage-monitor";
import {
  acquirePendingMonitorPostLock,
  createPendingMonitorPostQueue,
  createPendingPostDeliveryLimiter,
  createPendingMonitorPostStore,
  deliverPendingMonitorPost,
  getMonitorPendingPostsPath,
  PendingMonitorPostLockError,
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

test("new observations wait behind an in-flight resend and remain ordered after its acceptance", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-usage-monitor-serialized-"));
  try {
    const queuePath = path.join(directory, "pending-posts.json");
    const first = { reason: "initial", snapshot: snapshot("2026-09-25T00:00:00.000Z") } as const;
    const second = { reason: "structure_change", snapshot: snapshot("2026-09-25T00:02:00.000Z") } as const;
    const store = createPendingMonitorPostStore(queuePath);
    store.save([first]);
    const queue = createPendingMonitorPostQueue(store);
    const callbacks: { notifySendStarted?: () => void; unblockSend?: () => void } = {};
    const sendStarted = new Promise<void>((resolve) => { callbacks.notifySendStarted = resolve; });
    const sendGate = new Promise<void>((resolve) => { callbacks.unblockSend = resolve; });
    const delivered: string[] = [];

    const sending = queue.withExclusive(async (access) => access.deliverOldest(async (post) => {
      delivered.push(post.snapshot.observedAt);
      callbacks.notifySendStarted?.();
      await sendGate;
      return { accepted: true };
    }));
    await sendStarted;
    const enqueueing = queue.withExclusive((access) => access.enqueue(second));
    assert.deepEqual(store.load(), [first], "the new item is not persisted ahead of the active queue head");

    callbacks.unblockSend?.();
    await sending;
    await enqueueing;
    assert.deepEqual(delivered, [first.snapshot.observedAt]);
    assert.deepEqual(store.load(), [second], "the newer observation is saved after the accepted head is removed");
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

test("two real processes cannot mutate one pending queue, and a killed owner lock is recovered", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-usage-monitor-lock-"));
  let owner: ReturnType<typeof spawnProcess> | null = null;
  try {
    const queuePath = path.join(directory, "pending-posts.json");
    const entry = { reason: "recovery_candidate", snapshot: snapshot("2026-09-25T00:05:00.000Z") } as const;
    const store = createPendingMonitorPostStore(queuePath);
    store.save([entry]);
    const originalQueue = readFileSync(queuePath, "utf8");
    const moduleUrl = new URL("../tools/codex-usage-monitor-persistence.ts", import.meta.url).href;
    const childModule = JSON.stringify(moduleUrl);
    const childLockPath = JSON.stringify(queuePath);
    const childQueuePath = JSON.stringify(queuePath);
    const ownerSource = `
      (async () => {
        const { acquirePendingMonitorPostLock } = await import(${childModule});
        acquirePendingMonitorPostLock(${childLockPath});
        process.stdout.write("owner-locked\\n");
        setInterval(() => {}, 1000);
      })().catch((error) => { process.stderr.write(error.reason || "owner-error"); process.exitCode = 1; });
    `;
    const ownerProcess = spawnProcess(process.execPath, ["--import", "tsx", "--eval", ownerSource], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    owner = ownerProcess;

    let ownerOutput = "";
    const ownerStdout = ownerProcess.stdout;
    assert.ok(ownerStdout);
    ownerStdout.setEncoding("utf8");
    ownerStdout.on("data", (chunk: string) => { ownerOutput += chunk; });
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const check = () => {
          if (ownerOutput.includes("owner-locked")) resolve();
        };
        ownerStdout.on("data", check);
        ownerProcess.once("error", reject);
        ownerProcess.once("exit", (code) => reject(new Error(`owner exited before lock: ${code}`)));
      }),
      delay(5_000).then(() => { throw new Error("owner did not acquire the process lock"); }),
    ]);

    const contenderSource = `
      (async () => {
        const { acquirePendingMonitorPostLock, createPendingMonitorPostStore } = await import(${childModule});
        try {
          const lock = acquirePendingMonitorPostLock(${childLockPath});
          createPendingMonitorPostStore(${childQueuePath}).save([]);
          lock.release();
          process.stdout.write("unexpectedly-acquired");
        } catch (error) {
          process.stdout.write(error.reason || "unknown-error");
        }
      })().catch(() => { process.exitCode = 2; });
    `;
    const contender = spawnProcess(process.execPath, ["--import", "tsx", "--eval", contenderSource], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let contenderOutput = "";
    contender.stdout.setEncoding("utf8");
    contender.stdout.on("data", (chunk: string) => { contenderOutput += chunk; });
    await once(contender, "exit");
    assert.equal(contenderOutput, "pending_posts_lock_owned");
    assert.equal(readFileSync(queuePath, "utf8"), originalQueue, "a blocked second process cannot overwrite queued observations");

    owner.kill();
    await once(owner, "exit");
    owner = null;

    const recoveredLock = acquirePendingMonitorPostLock(queuePath);
    const queue = createPendingMonitorPostQueue(store);
    const recoveredPosts = await queue.withExclusive((access) => access.list());
    assert.deepEqual(recoveredPosts, [entry], "stale lock recovery preserves the pending queue contents");
    recoveredLock.release();

    const normalRelease = acquirePendingMonitorPostLock(queuePath);
    normalRelease.release();
    assert.doesNotThrow(() => acquirePendingMonitorPostLock(queuePath).release());
  } finally {
    if (owner && owner.exitCode === null) {
      owner.kill();
      await once(owner, "exit");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a corrupt process lock is reported and never replaced", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-usage-monitor-corrupt-lock-"));
  try {
    const queuePath = path.join(directory, "pending-posts.json");
    const lockPath = `${queuePath}.lock`;
    writeFileSync(lockPath, "partial owner record", "utf8");
    assert.throws(
      () => acquirePendingMonitorPostLock(queuePath),
      (error: unknown) => error instanceof PendingMonitorPostLockError && error.reason === "pending_posts_lock_corrupt",
    );
    assert.equal(readFileSync(lockPath, "utf8"), "partial owner record");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("outbox retry resumes after three short attempts with increasing recovery delays", () => {
  const limiter = createPendingPostDeliveryLimiter(120_000);
  assert.equal(limiter.tryBegin("oldest", 10_000), "ready");
  limiter.recordFailure("oldest", { category: "transport" }, 10_000);
  assert.equal(limiter.tryBegin("oldest", 129_999), "wait");
  assert.equal(limiter.tryBegin("oldest", 130_000), "ready");
  limiter.recordFailure("oldest", { category: "rate_limited", httpStatus: 429 }, 130_000);
  assert.equal(limiter.tryBegin("oldest", 250_000), "ready");
  limiter.recordFailure("oldest", { category: "server_error", httpStatus: 503 }, 250_000);
  assert.equal(limiter.tryBegin("oldest", 549_999), "wait");
  assert.equal(limiter.tryBegin("oldest", 550_000), "ready");
  limiter.recordFailure("oldest", { category: "transport" }, 550_000);
  assert.equal(limiter.tryBegin("oldest", 1_449_999), "wait");
  assert.equal(limiter.tryBegin("oldest", 1_450_000), "ready");
  assert.equal(limiter.tryBegin("new-head", 1_450_000), "ready");
  limiter.reset();
  assert.equal(limiter.tryBegin("after-monitor-restart", 1), "ready");
});

test("the shared monitor entry locks before queue restore and serializes enqueue with replay", () => {
  const monitorSource = readFileSync(path.resolve("tools/codex-usage-monitor.ts"), "utf8");
  const entryStart = monitorSource.indexOf("export async function runCodexUsageMonitor");
  const lockAcquire = monitorSource.indexOf("acquirePendingMonitorPostLock(queuePath)", entryStart);
  const queueRestore = monitorSource.indexOf("createPendingMonitorPostQueue(createPendingMonitorPostStore(queuePath))", entryStart);
  assert.ok(lockAcquire > entryStart && queueRestore > lockAcquire,
    "every entrypoint owns the queue lock before the persisted queue is read");

  const sessionStart = monitorSource.indexOf("async function runAppServerSession");
  const queueExclusive = monitorSource.indexOf("pendingQueue.withExclusive(async (queue)", sessionStart);
  const queueEnqueue = monitorSource.indexOf("queue.enqueue({ reason: postReason", queueExclusive);
  const requestFlush = monitorSource.indexOf("requestPendingPostFlush()", queueEnqueue);
  assert.ok(queueExclusive > sessionStart && queueEnqueue > queueExclusive && requestFlush > queueEnqueue,
    "new observations are durably enqueued in the same serial queue used by the sender");
  assert.match(monitorSource.slice(entryStart), /setInterval\(\(\) => \{ void flushPendingPosts\(\); \}, queueCheckIntervalMs\)/);
  assert.match(monitorSource.slice(entryStart), /checkIntervalMs: config\.pollIntervalMs/,
    "the production outbox retry check retains the existing observation polling cadence");

  const storeSource = readFileSync(path.resolve("lib/codexUsageRecoveryStore.ts"), "utf8");
  assert.match(storeSource, /onConflict:\s*"source_key,observed_at,current_resets_at"/);
  const sql = readFileSync(
    path.resolve("supabase/migrations/20260830100000_add_codex_usage_atomic_write_rpc.sql"),
    "utf8",
  );
  assert.match(sql, /on conflict \(source_key, observed_at, current_resets_at\)/i);
  assert.match(sql, /expected_previous_observed_at/);
});
