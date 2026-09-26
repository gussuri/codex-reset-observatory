import assert from "node:assert/strict";
import { spawn as spawnProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
        const persistenceModule = await import(${childModule});
        const { acquirePendingMonitorPostLock } = persistenceModule.default ?? persistenceModule;
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
    let ownerStderr = "";
    const ownerStdout = ownerProcess.stdout;
    const ownerStderrStream = ownerProcess.stderr;
    assert.ok(ownerStdout);
    assert.ok(ownerStderrStream);
    ownerStdout.setEncoding("utf8");
    ownerStdout.on("data", (chunk: string) => { ownerOutput += chunk; });
    ownerStderrStream.setEncoding("utf8");
    ownerStderrStream.on("data", (chunk: string) => { ownerStderr += chunk; });
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const check = () => {
          if (ownerOutput.includes("owner-locked")) resolve();
        };
        ownerStdout.on("data", check);
        ownerProcess.once("error", reject);
        ownerProcess.once("exit", (code) => reject(new Error(`owner exited before lock: ${code}; stderr=${ownerStderr}`)));
      }),
      delay(5_000).then(() => { throw new Error("owner did not acquire the process lock"); }),
    ]);

    const contenderSource = `
      (async () => {
        const persistenceModule = await import(${childModule});
        const { acquirePendingMonitorPostLock, createPendingMonitorPostStore } = persistenceModule.default ?? persistenceModule;
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

test("two real processes cannot reclaim the same stale lock or displace the new owner", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-usage-monitor-lock-recovery-race-"));
  let staleOwner: ReturnType<typeof spawnProcess> | null = null;
  let recoveringOwner: ReturnType<typeof spawnProcess> | null = null;
  let contender: ReturnType<typeof spawnProcess> | null = null;
  const waitForFile = async (filePath: string, timeoutMs = 5_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(filePath)) return;
      await delay(10);
    }
    throw new Error(`Timed out waiting for ${path.basename(filePath)}`);
  };

  try {
    const queuePath = path.join(directory, "pending-posts.json");
    const lockPath = `${queuePath}.lock`;
    const entry = { reason: "recovery_candidate", snapshot: snapshot("2026-09-27T00:05:00.000Z") } as const;
    const store = createPendingMonitorPostStore(queuePath);
    store.save([entry]);
    const originalQueue = readFileSync(queuePath, "utf8");
    const moduleUrl = JSON.stringify(new URL("../tools/codex-usage-monitor-persistence.ts", import.meta.url).href);
    const encodedQueuePath = JSON.stringify(queuePath);
    const staleOwnerReadyPath = path.join(directory, "stale-owner-ready");
    const renameEnteredPath = path.join(directory, "rename-entered");
    const releaseRenamePath = path.join(directory, "release-rename");
    const ownerResultPath = path.join(directory, "owner-result.json");
    const releaseOwnerPath = path.join(directory, "release-owner");
    const contenderResultPath = path.join(directory, "contender-result.json");
    const releaseContenderPath = path.join(directory, "release-contender");

    const staleOwnerSource = `
      (async () => {
        const fs = await import("node:fs");
        const persistenceModule = await import(${moduleUrl});
        const { acquirePendingMonitorPostLock } = persistenceModule.default ?? persistenceModule;
        acquirePendingMonitorPostLock(${encodedQueuePath});
        fs.writeFileSync(${JSON.stringify(staleOwnerReadyPath)}, "locked");
        setInterval(() => {}, 1000);
      })().catch((error) => { process.stderr.write(error.stack || String(error)); process.exitCode = 1; });
    `;
    staleOwner = spawnProcess(process.execPath, ["--import", "tsx", "--eval", staleOwnerSource], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let staleOwnerStderr = "";
    staleOwner.stderr?.setEncoding("utf8");
    staleOwner.stderr?.on("data", (chunk: string) => { staleOwnerStderr += chunk; });
    try {
      await waitForFile(staleOwnerReadyPath);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; stale owner stderr=${staleOwnerStderr}`);
    }
    assert.equal(existsSync(lockPath), true, "the seed process acquired the canonical lock");
    staleOwner.kill();
    await once(staleOwner, "exit");
    staleOwner = null;
    assert.equal(existsSync(lockPath), true, `a killed owner leaves its canonical lock for safe stale recovery; files: ${readdirSync(directory).join(",")}`);

    const recoveringOwnerSource = `
      (async () => {
        const fs = (await import("node:fs")).default;
        const lockPath = ${JSON.stringify(lockPath)};
        const renameEnteredPath = ${JSON.stringify(renameEnteredPath)};
        const releaseRenamePath = ${JSON.stringify(releaseRenamePath)};
        const ownerResultPath = ${JSON.stringify(ownerResultPath)};
        const releaseOwnerPath = ${JSON.stringify(releaseOwnerPath)};
        const originalRename = fs.renameSync.bind(fs);
        fs.renameSync = (from, to) => {
          if (from === lockPath) {
            fs.writeFileSync(renameEnteredPath, "entered");
            const deadline = Date.now() + 8_000;
            while (!fs.existsSync(releaseRenamePath) && Date.now() < deadline) {
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            }
            if (!fs.existsSync(releaseRenamePath)) throw new Error("rename_barrier_timeout");
          }
          return originalRename(from, to);
        };
        const persistenceModule = await import(${moduleUrl});
        const { acquirePendingMonitorPostLock } = persistenceModule.default ?? persistenceModule;
        try {
          const lease = acquirePendingMonitorPostLock(${encodedQueuePath});
          fs.writeFileSync(ownerResultPath, JSON.stringify({
            status: "acquired",
            pid: process.pid,
            lock: JSON.parse(fs.readFileSync(lockPath, "utf8")),
          }));
          while (!fs.existsSync(releaseOwnerPath)) await new Promise((resolve) => setTimeout(resolve, 10));
          lease.release();
          fs.writeFileSync(ownerResultPath, JSON.stringify({ status: "released", pid: process.pid }));
        } catch (error) {
          fs.writeFileSync(ownerResultPath, JSON.stringify({ status: "error", reason: error.reason || error.message }));
        }
      })().catch((error) => { process.stderr.write(error.stack || String(error)); process.exitCode = 1; });
    `;
    recoveringOwner = spawnProcess(process.execPath, ["--import", "tsx", "--eval", recoveringOwnerSource], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "ignore", "inherit"],
    });
    try {
      await waitForFile(renameEnteredPath);
    } catch (error) {
      if (existsSync(ownerResultPath)) {
        throw new Error(`Recovery process exited before the race barrier: ${readFileSync(ownerResultPath, "utf8")}`);
      }
      throw error;
    }

    const contenderSource = `
      (async () => {
        const fs = await import("node:fs");
        const persistenceModule = await import(${moduleUrl});
        const { acquirePendingMonitorPostLock } = persistenceModule.default ?? persistenceModule;
        const resultPath = ${JSON.stringify(contenderResultPath)};
        try {
          const lease = acquirePendingMonitorPostLock(${encodedQueuePath});
          fs.writeFileSync(resultPath, JSON.stringify({ status: "acquired", pid: process.pid }));
          while (!fs.existsSync(${JSON.stringify(releaseContenderPath)})) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          lease.release();
        } catch (error) {
          fs.writeFileSync(resultPath, JSON.stringify({ status: "error", reason: error.reason || error.message }));
        }
      })().catch((error) => { process.stderr.write(error.stack || String(error)); process.exitCode = 1; });
    `;
    contender = spawnProcess(process.execPath, ["--import", "tsx", "--eval", contenderSource], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: "ignore",
    });
    await waitForFile(contenderResultPath);

    const contenderResult = JSON.parse(readFileSync(contenderResultPath, "utf8")) as { status: string; reason?: string };
    assert.deepEqual(contenderResult, {
      status: "error",
      reason: "pending_posts_lock_recovery_busy",
    }, "a second process must stop while another process owns stale-lock recovery");
    if (contender.exitCode === null) await once(contender, "exit");

    writeFileSync(releaseRenamePath, "continue");
    await waitForFile(ownerResultPath);
    const ownerResult = JSON.parse(readFileSync(ownerResultPath, "utf8")) as {
      status: string;
      pid?: number;
      lock?: { pid: number; token: string };
    };
    assert.equal(ownerResult.status, "acquired");
    assert.equal(ownerResult.pid, recoveringOwner.pid);
    assert.equal(ownerResult.lock?.pid, recoveringOwner.pid, "the canonical lock belongs to the sole successful acquirer");
    assert.match(ownerResult.lock?.token ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(existsSync(`${lockPath}.recovery`), false, "the short-lived recovery gate is released after acquisition");
    assert.equal(readFileSync(queuePath, "utf8"), originalQueue, "recovery must preserve the unsent queue");

    writeFileSync(releaseOwnerPath, "release");
    await once(recoveringOwner, "exit");
    recoveringOwner = null;
    assert.equal(JSON.parse(readFileSync(ownerResultPath, "utf8")).status, "released");
    assert.equal(existsSync(lockPath), false, "the successful owner's normal release removes its lock");
    assert.equal(readFileSync(queuePath, "utf8"), originalQueue);
  } finally {
    writeFileSync(path.join(directory, "release-rename"), "continue");
    writeFileSync(path.join(directory, "release-owner"), "release");
    writeFileSync(path.join(directory, "release-contender"), "release");
    for (const child of [staleOwner, recoveringOwner, contender]) {
      if (child && child.exitCode === null) {
        child.kill();
        await once(child, "exit");
      }
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

test("existing recovery gates are diagnosed read-only and never change queue or canonical lock", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-usage-monitor-recovery-gate-diagnostics-"));
  try {
    const queuePath = path.join(directory, "pending-posts.json");
    const lockPath = `${queuePath}.lock`;
    const recoveryGatePath = `${lockPath}.recovery`;
    const entry = { reason: "recovery_candidate", snapshot: snapshot("2026-09-27T00:10:00.000Z") } as const;
    const store = createPendingMonitorPostStore(queuePath);
    store.save([entry]);
    const originalQueue = readFileSync(queuePath, "utf8");
    const originalLock = JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      token: "01234567-89ab-4cde-8fab-0123456789ab",
      acquiredAt: "2026-09-27T00:00:00.000Z",
    });
    writeFileSync(lockPath, originalLock, "utf8");
    const deadOwner = spawnProcess(process.execPath, ["-e", "process.exit(0)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    const deadPid = deadOwner.pid;
    assert.ok(deadPid);
    await once(deadOwner, "exit");

    const recordFor = (pid: number) => JSON.stringify({
      schemaVersion: 1,
      pid,
      token: "11234567-89ab-4cde-8fab-0123456789ab",
      acquiredAt: "2026-09-27T00:01:00.000Z",
    });
    const cases = [
      { raw: recordFor(process.pid), reason: "pending_posts_lock_recovery_busy" },
      { raw: recordFor(deadPid), reason: "pending_posts_lock_recovery_orphaned" },
      { raw: "partial recovery owner record", reason: "pending_posts_lock_recovery_corrupt" },
    ] as const;

    for (const scenario of cases) {
      writeFileSync(recoveryGatePath, scenario.raw, "utf8");
      assert.throws(
        () => acquirePendingMonitorPostLock(queuePath),
        (error: unknown) => error instanceof PendingMonitorPostLockError && error.reason === scenario.reason,
      );
      assert.equal(readFileSync(recoveryGatePath, "utf8"), scenario.raw, `${scenario.reason}: recovery gate is read-only`);
      assert.equal(readFileSync(lockPath, "utf8"), originalLock, `${scenario.reason}: canonical lock is unchanged`);
      assert.equal(readFileSync(queuePath, "utf8"), originalQueue, `${scenario.reason}: pending queue is unchanged`);
    }

    rmSync(recoveryGatePath);
    mkdirSync(recoveryGatePath);
    const unreadableGateMarker = path.join(recoveryGatePath, "marker");
    writeFileSync(unreadableGateMarker, "preserve this directory", "utf8");
    assert.throws(
      () => acquirePendingMonitorPostLock(queuePath),
      (error: unknown) => error instanceof PendingMonitorPostLockError && error.reason === "pending_posts_lock_recovery_corrupt",
    );
    assert.equal(readFileSync(unreadableGateMarker, "utf8"), "preserve this directory");
    assert.equal(readFileSync(lockPath, "utf8"), originalLock, "unreadable gate: canonical lock is unchanged");
    assert.equal(readFileSync(queuePath, "utf8"), originalQueue, "unreadable gate: pending queue is unchanged");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("monitor host exits cleanly for live recovery contention and fails closed for unsafe gates", async () => {
  const hostPath = path.resolve("apps/codex-usage-monitor/monitor-host.ts");
  const scenarios = [
    { name: "live owner", pid: process.pid, rawGate: null, reason: "pending_posts_lock_recovery_busy", exitCode: 0 },
    { name: "orphaned owner", pid: null, rawGate: null, reason: "pending_posts_lock_recovery_orphaned", exitCode: 1 },
    { name: "corrupt gate", pid: null, rawGate: "partial recovery owner record", reason: "pending_posts_lock_recovery_corrupt", exitCode: 1 },
  ] as const;
  let deadPid: number | null = null;
  const deadOwner = spawnProcess(process.execPath, ["-e", "process.exit(0)"], {
    windowsHide: true,
    stdio: "ignore",
  });
  deadPid = deadOwner.pid ?? null;
  assert.ok(deadPid);
  await once(deadOwner, "exit");

  for (const scenario of scenarios) {
    const localAppData = mkdtempSync(path.join(os.tmpdir(), "codex-monitor-host-gate-diagnostic-"));
    let host: ReturnType<typeof spawnProcess> | null = null;
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "test",
        LOCALAPPDATA: localAppData,
        CODEX_USAGE_MONITOR_SECRET: "test-only-secret",
        CODEX_USAGE_WEBHOOK_URL: "https://example.invalid/api/webhook/codex-usage",
        CODEX_CLI_PATH: path.join(localAppData, "codex-that-is-not-started.exe"),
      };
      const queuePath = getMonitorPendingPostsPath(env);
      const store = createPendingMonitorPostStore(queuePath);
      store.save([{ reason: "recovery_candidate", snapshot: snapshot("2026-09-27T00:10:00.000Z") }]);
      const originalQueue = readFileSync(queuePath, "utf8");
      const lockPath = `${queuePath}.lock`;
      const originalLock = JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        token: "21234567-89ab-4cde-8fab-0123456789ab",
        acquiredAt: "2026-09-27T00:00:00.000Z",
      });
      const ownerPid: number = scenario.name === "live owner" ? process.pid : deadPid!;
      const gateRecord: string = JSON.stringify({
        schemaVersion: 1,
        pid: ownerPid,
        token: "31234567-89ab-4cde-8fab-0123456789ab",
        acquiredAt: "2026-09-27T00:01:00.000Z",
      });
      const gatePath = `${lockPath}.recovery`;
      const gate: string = scenario.rawGate ?? gateRecord;
      writeFileSync(lockPath, originalLock, "utf8");
      writeFileSync(gatePath, gate, "utf8");

      host = spawnProcess(process.execPath, ["--import", "tsx", hostPath], {
        cwd: process.cwd(),
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      host.stdout?.setEncoding("utf8");
      host.stdout?.on("data", (chunk: string) => { stdout += chunk; });
      host.stderr?.resume();
      const [exitCode] = await Promise.race([
        once(host, "close") as Promise<[number | null, NodeJS.Signals | null]>,
        delay(5_000).then(() => { throw new Error(`monitor-host did not exit for ${scenario.name}`); }),
      ]);
      assert.equal(exitCode, scenario.exitCode, `${scenario.name}: monitor-host exit code`);
      const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
      const conflict = events.find((event) => event.event === "pending_queue_lock_conflict");
      assert.equal(conflict?.reason, scenario.reason, `${scenario.name}: conflict reason reaches the host log`);
      assert.equal(
        conflict?.action,
        scenario.exitCode === 1 ? "manual_review_required_queue_untouched" : "monitor_exited_without_reading_or_writing_queue",
      );
      if (scenario.exitCode === 0) {
        assert.ok(events.some((event) => event.event === "stopped"));
        assert.equal(events.some((event) => event.event === "error"), false);
      } else {
        assert.ok(events.some((event) => event.event === "error" && event.reason === scenario.reason));
      }
      assert.equal(readFileSync(queuePath, "utf8"), originalQueue);
      assert.equal(readFileSync(lockPath, "utf8"), originalLock);
      assert.equal(readFileSync(gatePath, "utf8"), gate);
    } finally {
      if (host && host.exitCode === null) {
        host.kill();
        await once(host, "close");
      }
      rmSync(localAppData, { recursive: true, force: true });
    }
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
