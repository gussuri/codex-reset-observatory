import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";

import type { CodexUsageSnapshot } from "../lib/codexUsageRecovery";
import {
  classifyMonitorWebhookStatus,
  createJsonMonitorLogger,
  runCodexUsageMonitor,
  type MonitorLogger,
} from "../tools/codex-usage-monitor";
import { createPendingMonitorPostStore, getMonitorPendingPostsPath } from "../tools/codex-usage-monitor-persistence";

function pendingSnapshot(): CodexUsageSnapshot {
  return {
    observedAt: "2026-09-27T00:00:00.000Z",
    limitId: "codex",
    planType: "plus",
    usedPercent: 18,
    windowDurationMins: 10080,
    resetsAt: 1_790_064_000,
  };
}

test("webhook HTTP failures distinguish retryable outages from authentication and input errors", () => {
  assert.deepEqual(classifyMonitorWebhookStatus(429), { category: "rate_limited", httpStatus: 429 });
  assert.deepEqual(classifyMonitorWebhookStatus(503), { category: "server_error", httpStatus: 503 });
  assert.deepEqual(classifyMonitorWebhookStatus(401), { category: "authentication", httpStatus: 401 });
  assert.deepEqual(classifyMonitorWebhookStatus(403), { category: "authentication", httpStatus: 403 });
  assert.deepEqual(classifyMonitorWebhookStatus(400), { category: "invalid_request", httpStatus: 400 });
  assert.deepEqual(classifyMonitorWebhookStatus(422), { category: "invalid_request", httpStatus: 422 });
  assert.deepEqual(classifyMonitorWebhookStatus(409), { category: "client_error", httpStatus: 409 });
});

function createFakeAppServer(mode: "rpc_failure" | "invalid_snapshot") {
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

  stdin.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
      const request = JSON.parse(line) as { id?: string; method?: string };
      if (!request.id) continue;
      const response = request.method === "initialize" && mode === "rpc_failure"
        ? { jsonrpc: "2.0", id: request.id, error: { code: -32_000 } }
        : { jsonrpc: "2.0", id: request.id, result: {} };
      setImmediate(() => stdout.write(`${JSON.stringify(response)}\n`));
    }
  });
  return child;
}

function waitForEvent(events: string[], expected: string) {
  if (events.includes(expected)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      if (events.includes(expected)) {
        clearInterval(timer);
        resolve();
      }
    }, 5);
    void delay(2_000).then(() => {
      clearInterval(timer);
      reject(new Error(`Timed out waiting for monitor event: ${expected}`));
    });
  });
}

async function waitForCondition(condition: () => boolean, description: string, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await delay(2);
  }
}

for (const scenario of [
  { mode: "spawn_failure" as const, requiredEvent: "session_restart" },
  { mode: "rpc_failure" as const, requiredEvent: "session_restart" },
  { mode: "invalid_snapshot" as const, requiredEvent: "snapshot_rejected" },
]) {
  test(`persisted outbox delivers while Codex path has ${scenario.mode}`, async () => {
    const localAppData = mkdtempSync(path.join(os.tmpdir(), `codex-outbox-${scenario.mode}-`));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      LOCALAPPDATA: localAppData,
      CODEX_USAGE_MONITOR_SECRET: "test-only-secret",
      CODEX_USAGE_WEBHOOK_URL: "https://example.invalid/api/webhook/codex-usage",
      CODEX_CLI_PATH: "test-codex",
    };
    const queuePath = getMonitorPendingPostsPath(env);
    const store = createPendingMonitorPostStore(queuePath);
    const pending = { reason: "recovery_candidate", snapshot: pendingSnapshot() } as const;
    store.save([pending]);

    const controller = new AbortController();
    const events: string[] = [];
    let resolveExpectedEvent: (() => void) | null = null;
    const expectedEvent = new Promise<void>((resolve) => { resolveExpectedEvent = resolve; });
    const logs: string[] = [];
    const logger: MonitorLogger = createJsonMonitorLogger((line) => {
      logs.push(line);
      const parsed = JSON.parse(line) as { event: string };
      events.push(parsed.event);
      if (parsed.event === scenario.requiredEvent) resolveExpectedEvent?.();
    });
    let deliveryCount = 0;
    let spawnCount = 0;

    try {
      await runCodexUsageMonitor(env, {
        signal: controller.signal,
        logger,
        spawnAppServer: () => {
          spawnCount += 1;
          if (scenario.mode === "spawn_failure") throw new Error("test_app_server_spawn_failure");
          return createFakeAppServer(scenario.mode);
        },
        sendSnapshot: async () => {
          deliveryCount += 1;
          await Promise.race([
            expectedEvent,
            delay(2_000).then(() => { throw new Error(`Codex failure did not occur before webhook retry in ${scenario.mode}`); }),
          ]);
          controller.abort();
          return { accepted: true };
        },
      });

      assert.equal(deliveryCount, 1, "one saved observation is sent once, without a rapid retry loop");
      assert.equal(store.load().length, 0, "accepted queue data is durably removed");
      assert.ok(events.includes(scenario.requiredEvent));
      if (scenario.mode === "invalid_snapshot") {
        assert.ok(logs.some((line) => line.includes('"reason":"invalid_weekly_window"')));
      }
      assert.ok(spawnCount >= 1);
    } finally {
      controller.abort();
      rmSync(localAppData, { recursive: true, force: true });
    }
  });
}

test("outbox retries after three transient failures and drains FIFO after recovery without restarting", async () => {
  const localAppData = mkdtempSync(path.join(os.tmpdir(), "codex-outbox-recovery-"));
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
  const store = createPendingMonitorPostStore(queuePath);
  const first = { reason: "recovery_candidate", snapshot: pendingSnapshot() } as const;
  const second = {
    reason: "structure_change",
    snapshot: { ...pendingSnapshot(), observedAt: "2026-09-27T00:01:00.000Z", usedPercent: 19 },
  } as const;
  store.save([first, second]);

  const controller = new AbortController();
  const events: Array<Record<string, unknown>> = [];
  const logger: MonitorLogger = createJsonMonitorLogger((line) => {
    events.push(JSON.parse(line) as Record<string, unknown>);
  });
  const attempts: Array<{ at: number; reason: string }> = [];
  let spawnCount = 0;
  const monitor = runCodexUsageMonitor(env, {
    signal: controller.signal,
    logger,
    spawnAppServer: () => {
      spawnCount += 1;
      return createFakeAppServer("invalid_snapshot");
    },
    pendingQueueRetryTiming: {
      checkIntervalMs: 2,
      shortRetryIntervalMs: 10,
      recoveryBackoffMs: [80, 160],
    },
    fetchWebhook: async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { postReason: string };
      attempts.push({ at: Date.now(), reason: payload.postReason });
      if (attempts.length === 1) throw new TypeError("network unavailable");
      if (attempts.length === 2) return new Response("rate limited", { status: 429 });
      if (attempts.length === 3) return new Response("temporarily unavailable", { status: 503 });
      if (attempts.length > 3) {
        return new Response(JSON.stringify({ accepted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("unexpected_attempt_count");
    },
  });

  try {
    await waitForCondition(() => attempts.length >= 5, "the first and following queued observations to be accepted");
    controller.abort();
    await monitor;

    assert.deepEqual(attempts.map(({ reason }) => reason), [
      "recovery_candidate",
      "recovery_candidate",
      "recovery_candidate",
      "recovery_candidate",
      "structure_change",
    ]);
    assert.ok(attempts[3]!.at - attempts[2]!.at >= 60, "the fourth attempt waits through the extended recovery delay");
    assert.equal(spawnCount, 1, "recovery does not restart the Codex app-server session");
    assert.deepEqual(store.load(), [], "both accepted queue heads are durably removed in order");
    assert.ok(events.some((event) => event.event === "snapshot_rejected"),
      "the synthetic app-server snapshot stays invalid during delivery recovery");
    assert.deepEqual(
      events.filter((event) => event.event === "pending_queue_delivery_deferred").slice(0, 3)
        .map((event) => event.category),
      ["transport", "rate_limited", "server_error"],
    );
  } finally {
    controller.abort();
    await monitor;
    rmSync(localAppData, { recursive: true, force: true });
  }
});

for (const permanentFailure of [
  { httpStatus: 401, category: "authentication" },
  { httpStatus: 400, category: "invalid_request" },
]) {
test(`permanent HTTP ${permanentFailure.httpStatus} failure retains the FIFO head and logs a safe reason`, async () => {
  const localAppData = mkdtempSync(path.join(os.tmpdir(), `codex-outbox-${permanentFailure.category}-`));
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
  const store = createPendingMonitorPostStore(queuePath);
  const pending = { reason: "recovery_candidate", snapshot: pendingSnapshot() } as const;
  store.save([pending]);

  const controller = new AbortController();
  const events: Array<Record<string, unknown>> = [];
  const logger: MonitorLogger = createJsonMonitorLogger((line) => {
    events.push(JSON.parse(line) as Record<string, unknown>);
  });
  let deliveryCount = 0;
  const monitor = runCodexUsageMonitor(env, {
    signal: controller.signal,
    logger,
    spawnAppServer: () => createFakeAppServer("invalid_snapshot"),
    pendingQueueRetryTiming: { checkIntervalMs: 2, shortRetryIntervalMs: 10, recoveryBackoffMs: [80] },
    fetchWebhook: async () => {
      deliveryCount += 1;
      return new Response("request rejected", { status: permanentFailure.httpStatus });
    },
  });

  try {
    await waitForCondition(
      () => events.some((event) => event.event === "pending_queue_delivery_blocked"),
      "an authentication failure diagnostic",
    );
    await delay(25);
    controller.abort();
    await monitor;

    const blocked = events.find((event) => event.event === "pending_queue_delivery_blocked");
    assert.equal(blocked?.category, permanentFailure.category);
    assert.equal(blocked?.httpStatus, permanentFailure.httpStatus);
    assert.equal(blocked?.action, "queue_retained_for_diagnosis_and_slow_retry");
    assert.equal(deliveryCount, 1, "permanent authorization failures are not retried in a tight loop");
    assert.deepEqual(store.load(), [pending], "a rejected item and the following FIFO queue remain durable");
  } finally {
    controller.abort();
    await monitor;
    rmSync(localAppData, { recursive: true, force: true });
  }
});
}
