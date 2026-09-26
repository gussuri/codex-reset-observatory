import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";

import type { CodexUsageSnapshot } from "../lib/codexUsageRecovery";
import {
  createJsonMonitorLogger,
  runCodexUsageMonitor,
  updateMonitorSnapshotState,
  type MonitorLogger,
} from "../tools/codex-usage-monitor";
import {
  createMonitorRecoveryCandidateStore,
  getMonitorRecoveryCandidatePath,
  MONITOR_RECOVERY_CANDIDATE_TTL_MS,
  type PendingRecoveryCandidateRecord,
} from "../tools/codex-usage-monitor-recovery-candidate";
import { createPendingMonitorPostStore, getMonitorPendingPostsPath } from "../tools/codex-usage-monitor-persistence";

const STARTED_AT = Date.parse("2026-09-27T00:00:00.000Z");

function snapshot(overrides: Partial<CodexUsageSnapshot> = {}): CodexUsageSnapshot {
  return {
    observedAt: new Date(STARTED_AT).toISOString(),
    limitId: "codex",
    planType: "plus",
    usedPercent: 80,
    windowDurationMins: 10080,
    resetsAt: 1_790_064_000,
    ...overrides,
  };
}

function candidate(): PendingRecoveryCandidateRecord {
  const baseline = snapshot();
  const firstEvidence = snapshot({
    observedAt: new Date(STARTED_AT + 120_000).toISOString(),
    usedPercent: 0,
    resetsAt: baseline.resetsAt + 3_600,
  });
  return {
    preRecoveryBaseline: baseline,
    firstEvidenceSnapshot: firstEvidence,
    candidateStartedAtMs: STARTED_AT + 120_000,
    lastObservation: firstEvidence,
    observationCount: 1,
    lastSuccessfulPostAtMs: STARTED_AT,
    lastKnownBankedResetAvailableCount: 3,
  };
}

function createRateLimitResponse(value: CodexUsageSnapshot) {
  return {
    ...(typeof value.bankedResetAvailableCount === "number"
      ? { rateLimitResetCredits: { availableCount: value.bankedResetAvailableCount } }
      : {}),
    rateLimits: {
      limitId: value.limitId,
      planType: value.planType,
      primary: {
        usedPercent: value.usedPercent,
        windowDurationMins: value.windowDurationMins,
        resetsAt: value.resetsAt,
      },
    },
  };
}

function createSnapshotAppServer(onRead: () => unknown, notifyAfterReadCount = -1) {
  const emitter = new EventEmitter();
  const child = emitter as unknown as ChildProcessWithoutNullStreams;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let closed = false;
  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    kill: () => {
      if (!closed) {
        closed = true;
        setImmediate(() => emitter.emit("close", null, "SIGTERM"));
      }
      return true;
    },
  });

  let readCount = 0;
  stdin.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
      const request = JSON.parse(line) as { id?: string; method?: string };
      if (!request.id) continue;
      const result = request.method === "initialize" ? {} : onRead();
      setImmediate(() => {
        stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
        if (request.method === "account/rateLimits/read" && ++readCount === notifyAfterReadCount) {
          stdout.write('{"jsonrpc":"2.0","method":"account/rateLimits/updated"}\n');
        }
      });
    }
  });
  return child;
}

async function waitForCondition(condition: () => boolean, description: string, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await delay(2);
  }
}

test("recovery candidate is atomically persisted separately and restored after a process restart", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-recovery-candidate-"));
  try {
    const queuePath = path.join(directory, "pending-posts.json");
    const candidatePath = getMonitorRecoveryCandidatePath(queuePath);
    const firstStore = createMonitorRecoveryCandidateStore(candidatePath);
    const pending = candidate();

    firstStore.save(pending, STARTED_AT + 120_000);

    assert.notEqual(candidatePath, queuePath, "candidate state must not share the outbox file");
    assert.equal(path.dirname(candidatePath), path.dirname(queuePath));
    assert.equal(existsSync(candidatePath), true);
    assert.doesNotMatch(readFileSync(candidatePath, "utf8"), /api.?key|secret|token/i);
    const restored = createMonitorRecoveryCandidateStore(candidatePath).load(STARTED_AT + 180_000);
    assert.deepEqual(restored, { candidate: pending });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stale and corrupt persisted candidates are diagnosed and discarded safely", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-recovery-candidate-invalid-"));
  try {
    const filePath = path.join(directory, "pending-recovery-candidate.json");
    const store = createMonitorRecoveryCandidateStore(filePath);
    store.save(candidate(), STARTED_AT + 120_000);
    assert.deepEqual(
      store.load(STARTED_AT + 120_000 + MONITOR_RECOVERY_CANDIDATE_TTL_MS + 1),
      { candidate: null, discardedReason: "stale" },
    );
    assert.equal(existsSync(filePath), false);

    writeFileSync(filePath, "{corrupt", "utf8");
    assert.deepEqual(store.load(STARTED_AT + 120_000), { candidate: null, discardedReason: "corrupt" });
    assert.equal(existsSync(filePath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("candidate with a different source identity, schedule, or recovered usage is discarded", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-recovery-candidate-identity-"));
  const filePath = path.join(directory, "pending-recovery-candidate.json");
  const store = createMonitorRecoveryCandidateStore(filePath);
  try {
    store.save(candidate(), STARTED_AT + 120_000);
    const wrongSource = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, any>;
    wrongSource.source = "another-monitor-source";
    writeFileSync(filePath, JSON.stringify(wrongSource), "utf8");
    assert.deepEqual(store.load(STARTED_AT + 180_000), { candidate: null, discardedReason: "identity_mismatch" });

    store.save(candidate(), STARTED_AT + 120_000);
    const wrongLimit = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, any>;
    wrongLimit.identity.limitId = "another-limit";
    writeFileSync(filePath, JSON.stringify(wrongLimit), "utf8");
    assert.deepEqual(store.load(STARTED_AT + 180_000), { candidate: null, discardedReason: "identity_mismatch" });

    store.save(candidate(), STARTED_AT + 120_000);
    const wrongSchedule = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, any>;
    wrongSchedule.candidate.lastObservation.resetsAt += 31;
    writeFileSync(filePath, JSON.stringify(wrongSchedule), "utf8");
    assert.deepEqual(store.load(STARTED_AT + 180_000), { candidate: null, discardedReason: "inconsistent" });

    store.save(candidate(), STARTED_AT + 120_000);
    const usageReverted = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, any>;
    usageReverted.candidate.lastObservation.usedPercent = usageReverted.candidate.preRecoveryBaseline.usedPercent;
    writeFileSync(filePath, JSON.stringify(usageReverted), "utf8");
    assert.deepEqual(store.load(STARTED_AT + 180_000), { candidate: null, discardedReason: "inconsistent" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a restored candidate is cancelled when the next snapshot no longer matches recovery evidence", () => {
  const pending = candidate();
  const state = {
    baselineSnapshot: pending.preRecoveryBaseline,
    previousLocalSnapshot: pending.lastObservation,
    lastSuccessfulPostAt: pending.candidateStartedAtMs,
    pendingRecoveryCandidate: pending,
    pendingPosts: [],
  };
  const nowMs = STARTED_AT + 240_000;
  const current = (overrides: Partial<CodexUsageSnapshot> = {}) => snapshot({
    ...pending.firstEvidenceSnapshot,
    observedAt: new Date(nowMs).toISOString(),
    ...overrides,
  });

  const usageReverted = updateMonitorSnapshotState(
    state,
    current({ usedPercent: pending.preRecoveryBaseline.usedPercent }),
    false,
    nowMs,
    { nowMs, trigger: "poll" },
  );
  assert.equal(usageReverted.pendingRecoveryCandidate, null);
  assert.equal(usageReverted.baselineSnapshot?.usedPercent, pending.preRecoveryBaseline.usedPercent);

  const scheduleChanged = updateMonitorSnapshotState(
    state,
    current({ resetsAt: pending.firstEvidenceSnapshot.resetsAt + 120 }),
    false,
    nowMs,
    { nowMs, trigger: "poll" },
  );
  assert.equal(scheduleChanged.pendingRecoveryCandidate, null);
  assert.equal(scheduleChanged.baselineSnapshot?.resetsAt, pending.firstEvidenceSnapshot.resetsAt + 120);
});

test("monitor restores a persisted candidate after restart and queues one recovery observation durably", async () => {
  const localAppData = mkdtempSync(path.join(os.tmpdir(), "codex-recovery-restart-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    LOCALAPPDATA: localAppData,
    CODEX_USAGE_MONITOR_SECRET: "test-only-secret",
    CODEX_USAGE_WEBHOOK_URL: "https://example.invalid/api/webhook/codex-usage",
    CODEX_USAGE_POLL_INTERVAL_MS: "60000",
    CODEX_CLI_PATH: "test-codex",
  };
  const queuePath = getMonitorPendingPostsPath(env);
  const queueStore = createPendingMonitorPostStore(queuePath);
  const candidatePath = getMonitorRecoveryCandidatePath(queuePath);
  const baseline = snapshot({
    observedAt: new Date(Date.now()).toISOString(),
    usedPercent: 80,
    resetsAt: 1_790_064_000,
  });
  const firstEvidence = snapshot({
    observedAt: new Date(Date.now() + 120_000).toISOString(),
    usedPercent: 0,
    resetsAt: baseline.resetsAt + 3_600,
  });
  let monitorNowMs = Date.now();
  const firstController = new AbortController();
  const firstEvents: Array<Record<string, unknown>> = [];
  const firstLogger: MonitorLogger = createJsonMonitorLogger((line) => {
    firstEvents.push(JSON.parse(line) as Record<string, unknown>);
    if (line.includes('"event":"recovery_candidate_persisted"')) firstController.abort();
  });
  let firstReadCount = 0;
  const firstRun = runCodexUsageMonitor(env, {
    signal: firstController.signal,
    logger: firstLogger,
    monitorTiming: { now: () => monitorNowMs, pollIntervalMs: 2 },
    pendingQueueRetryTiming: { checkIntervalMs: 2, shortRetryIntervalMs: 10, recoveryBackoffMs: [20] },
    spawnAppServer: () => createSnapshotAppServer(() => {
      const value = firstReadCount++ === 0 ? baseline : firstEvidence;
      monitorNowMs = Date.parse(value.observedAt);
      return createRateLimitResponse(value);
    }, 1),
    sendSnapshot: async () => ({ accepted: true }),
  });

  try {
    try {
      await waitForCondition(
        () => firstEvents.some((event) => event.event === "recovery_candidate_started"),
        "first recovery evidence to start a candidate",
        5_000,
      );
      firstController.abort();
      await firstRun;
    } finally {
      firstController.abort();
      await firstRun;
    }
    assert.ok(firstEvents.some((event) => event.event === "recovery_candidate_persisted"),
      "first evidence must be durable before the process exits");
    assert.equal(queueStore.load().length, 0, "an unconfirmed candidate must not enter the outbox");
    assert.equal(existsSync(candidatePath), true);
    const persistedCandidate = createMonitorRecoveryCandidateStore(candidatePath).load(monitorNowMs).candidate;
    assert.equal(persistedCandidate?.lastSuccessfulPostAtMs, Date.parse(baseline.observedAt),
      "restart must retain the monitor heartbeat baseline");
    assert.equal(persistedCandidate?.lastKnownBankedResetAvailableCount, null,
      "restart must retain the prior BANKED availability knowledge");

    monitorNowMs = Date.parse(firstEvidence.observedAt) + 60_000;
    const secondController = new AbortController();
    const secondEvents: Array<Record<string, unknown>> = [];
    const secondLogger: MonitorLogger = createJsonMonitorLogger((line) => {
      secondEvents.push(JSON.parse(line) as Record<string, unknown>);
    });
    let secondReadCount = 0;
    const deliveries: string[] = [];
    const secondRun = runCodexUsageMonitor(env, {
      signal: secondController.signal,
      logger: secondLogger,
      monitorTiming: { now: () => monitorNowMs, pollIntervalMs: 2 },
      pendingQueueRetryTiming: { checkIntervalMs: 2, shortRetryIntervalMs: 60_000, recoveryBackoffMs: [60_000] },
      spawnAppServer: () => createSnapshotAppServer(() => {
        const time = secondReadCount++ === 0
          ? Date.parse(firstEvidence.observedAt) + 60_000
          : Date.parse(firstEvidence.observedAt) + 120_000;
        monitorNowMs = time;
        return createRateLimitResponse({ ...firstEvidence, observedAt: new Date(time).toISOString() });
      }),
      sendSnapshot: async (_snapshot, reason) => {
        deliveries.push(reason);
        return { accepted: false, failure: { category: "transport" } };
      },
    });

    try {
      await waitForCondition(() => deliveries.includes("recovery_candidate"), "confirmed recovery delivery attempt");
      secondController.abort();
      await secondRun;
    } finally {
      secondController.abort();
      await secondRun;
    }

    const queuedRecovery = queueStore.load().filter((post) => post.reason === "recovery_candidate");
    assert.equal(queuedRecovery.length, 1, "restart must create one durable recovery observation");
    assert.equal(queuedRecovery[0]?.snapshot.observedAt, firstEvidence.observedAt,
      "the queued event retains the first evidence timestamp");
    assert.equal(existsSync(candidatePath), false, "confirmed evidence moves from candidate storage to the outbox");
    assert.ok(secondEvents.some((event) => event.event === "recovery_candidate_restored"));
    assert.equal(secondEvents.filter((event) => event.event === "recovery_candidate_confirmed").length, 1);
    assert.ok(secondEvents.some((event) => event.event === "pending_queue_delivery_deferred"));
    assert.deepEqual(deliveries, ["recovery_candidate"], "the normal initial snapshot is not relabeled as recovery");
  } finally {
    firstController.abort();
    rmSync(localAppData, { recursive: true, force: true });
  }
});

test("an already queued confirmation clears its stale candidate before replay", async () => {
  const localAppData = mkdtempSync(path.join(os.tmpdir(), "codex-recovery-candidate-queued-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    LOCALAPPDATA: localAppData,
    CODEX_USAGE_MONITOR_SECRET: "test-only-secret",
    CODEX_USAGE_WEBHOOK_URL: "https://example.invalid/api/webhook/codex-usage",
    CODEX_USAGE_POLL_INTERVAL_MS: "60000",
    CODEX_CLI_PATH: "test-codex",
  };
  const queuePath = getMonitorPendingPostsPath(env);
  const candidatePath = getMonitorRecoveryCandidatePath(queuePath);
  const pendingCandidate = candidate();
  createMonitorRecoveryCandidateStore(candidatePath).save(pendingCandidate, STARTED_AT + 120_000);
  const confirmedPost = {
    reason: "recovery_candidate" as const,
    snapshot: pendingCandidate.firstEvidenceSnapshot,
  };
  const pendingStore = createPendingMonitorPostStore(queuePath);
  pendingStore.save([confirmedPost]);

  const controller = new AbortController();
  const events: Array<Record<string, unknown>> = [];
  const logger: MonitorLogger = createJsonMonitorLogger((line) => {
    events.push(JSON.parse(line) as Record<string, unknown>);
  });
  const deliveries: string[] = [];
  const monitor = runCodexUsageMonitor(env, {
    signal: controller.signal,
    logger,
    monitorTiming: { now: () => STARTED_AT + 180_000, pollIntervalMs: 60_000 },
    pendingQueueRetryTiming: { checkIntervalMs: 60_000, shortRetryIntervalMs: 60_000, recoveryBackoffMs: [60_000] },
    spawnAppServer: () => createSnapshotAppServer(() => createRateLimitResponse(pendingCandidate.lastObservation)),
    sendSnapshot: async (_snapshot, reason) => {
      deliveries.push(reason);
      controller.abort();
      return { accepted: false, failure: { category: "transport" } };
    },
  });

  try {
    await monitor;
    assert.deepEqual(deliveries, ["recovery_candidate"]);
    assert.equal(existsSync(candidatePath), false, "the queued event is the durable source after confirmation");
    assert.deepEqual(pendingStore.load(), [confirmedPost], "failed delivery keeps the confirmed outbox item");
    assert.ok(events.some((event) => event.event === "recovery_candidate_outbox_reconciled"));
    assert.equal(events.filter((event) => event.event === "recovery_candidate_restored").length, 0,
      "a candidate already represented in the queue cannot be restored or reconfirmed");
  } finally {
    controller.abort();
    await monitor;
    rmSync(localAppData, { recursive: true, force: true });
  }
});

test("a cancelled candidate is retained until its replacement event is durable", async () => {
  const localAppData = mkdtempSync(path.join(os.tmpdir(), "codex-recovery-candidate-replacement-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    LOCALAPPDATA: localAppData,
    CODEX_USAGE_MONITOR_SECRET: "test-only-secret",
    CODEX_USAGE_WEBHOOK_URL: "https://example.invalid/api/webhook/codex-usage",
    CODEX_USAGE_POLL_INTERVAL_MS: "60000",
    CODEX_CLI_PATH: "test-codex",
  };
  const queuePath = getMonitorPendingPostsPath(env);
  const pendingStore = createPendingMonitorPostStore(queuePath);
  const candidatePath = getMonitorRecoveryCandidatePath(queuePath);
  const pendingCandidate = candidate();
  createMonitorRecoveryCandidateStore(candidatePath).save(pendingCandidate, STARTED_AT + 120_000);

  const controller = new AbortController();
  const deliveries: string[] = [];
  let read = 0;
  const nowMs = STARTED_AT + 180_000;
  const monitor = runCodexUsageMonitor(env, {
    signal: controller.signal,
    logger: createJsonMonitorLogger(() => {}),
    monitorTiming: { now: () => nowMs, pollIntervalMs: 60_000 },
    pendingQueueRetryTiming: { checkIntervalMs: 60_000, shortRetryIntervalMs: 60_000, recoveryBackoffMs: [60_000] },
    spawnAppServer: () => createSnapshotAppServer(() => {
      const value = read++ === 0
        ? { ...pendingCandidate.lastObservation, observedAt: new Date(nowMs).toISOString(), bankedResetAvailableCount: 4 }
        : { ...pendingCandidate.lastObservation, observedAt: new Date(nowMs + 60_000).toISOString(), bankedResetAvailableCount: 4 };
      return createRateLimitResponse(value);
    }),
    sendSnapshot: async (_snapshot, reason) => {
      deliveries.push(reason);
      controller.abort();
      return { accepted: false, failure: { category: "transport" } };
    },
  });

  try {
    await monitor;
    assert.deepEqual(deliveries, ["banked_reset_count_change"]);
    assert.equal(existsSync(candidatePath), false, "the cancelled recovery candidate must not survive its replacement event");
    assert.deepEqual(
      pendingStore.load().map((post) => post.reason),
      ["banked_reset_count_change"],
      "the replacement event must remain durable when delivery fails",
    );
  } finally {
    controller.abort();
    await monitor;
    rmSync(localAppData, { recursive: true, force: true });
  }
});
