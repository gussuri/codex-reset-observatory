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
