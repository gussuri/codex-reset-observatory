import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";

import { createJsonMonitorLogger, evaluateMonitorRecoveryCandidate, getMonitorDiagnosticComparison, MONITOR_HEARTBEAT_INTERVAL_MS, runCodexUsageMonitor, type MonitorSnapshotState } from "../tools/codex-usage-monitor";
import { createMonitorDiagnosticSink, MONITOR_DIAGNOSTIC_RECOVERY_OUTCOMES } from "../tools/codex-usage-monitor-diagnostics";
import { acquirePendingMonitorPostLock, getMonitorPendingPostsPath } from "../tools/codex-usage-monitor-persistence";

function logFiles(directory: string) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.startsWith("monitor-diagnostics") && name.endsWith(".jsonl"))
    .map((name) => path.join(directory, name));
}

test("diagnostic comparison reasons cover usage-only, structure, gap, clock cancellation, and heartbeat context", () => {
  const now = Date.parse("2026-10-18T00:20:00.000Z");
  const base = {
    observedAt: "2026-10-18T00:10:00.000Z",
    limitId: "codex",
    planType: "plus",
    usedPercent: 80,
    windowDurationMins: 10080,
    resetsAt: 1_800_000_000,
  } as const;
  const state: MonitorSnapshotState = {
    baselineSnapshot: base,
    previousLocalSnapshot: base,
    lastSuccessfulPostAt: now - 60_000,
    pendingPosts: [],
  };
  const selected = (overrides: Record<string, unknown> = {}) => ({
    ...base,
    observedAt: "2026-10-18T00:20:00.000Z",
    ...overrides,
  }) as any;

  assert.equal(getMonitorDiagnosticComparison(selected({ usedPercent: 79.5, resetsAt: base.resetsAt + 3600 }), state, now).reason, "usage_condition_unmet");
  assert.equal(getMonitorDiagnosticComparison(selected({ planType: "pro" }), state, now).reason, "structure_change");
  assert.equal(getMonitorDiagnosticComparison(selected({ observedAt: "2026-10-18T00:20:00.001Z" }), state, now).reason, "comparison_gap");

  const candidateSnapshot = selected({ usedPercent: 20, resetsAt: base.resetsAt + 3600 });
  const started = evaluateMonitorRecoveryCandidate(candidateSnapshot, state, now - 20 * 60_000, "poll");
  assert.equal(started.status, "started");
  const candidateState = { ...state, pendingRecoveryCandidate: started.nextPendingRecoveryCandidate };
  assert.equal(getMonitorDiagnosticComparison(selected({ usedPercent: 20, resetsAt: base.resetsAt + 3600 }), candidateState, now).reason, "comparison_gap", "candidate clock expiry is surfaced as a comparison gap");
  assert.equal(getMonitorDiagnosticComparison(selected({ usedPercent: 20, resetsAt: base.resetsAt + 3600, planType: "pro" }), candidateState, now).reason, "structure_change");

  const heartbeatState = { ...state, lastSuccessfulPostAt: now - MONITOR_HEARTBEAT_INTERVAL_MS };
  const heartbeat = getMonitorDiagnosticComparison(selected(), heartbeatState, now);
  assert.equal(heartbeat.reason, "both_conditions_unmet", "heartbeat does not hide the comparison result");
  assert.equal(heartbeat.evaluation.postReason, "heartbeat", "the send decision remains separately available");
});

test("diagnostic sink rotates within its byte and generation caps and resumes after restart", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostics-"));
  const directory = path.join(parent, "logs");
  try {
    let sink = createMonitorDiagnosticSink({ directory, maxBytes: 256, generations: 3 });
    for (let index = 0; index < 12; index += 1) {
      sink({ event: "diagnostic_rpc_completed", readCompletedAt: new Date(1_800_000_000_000 + index).toISOString(), rpcDurationMs: index } as any);
    }
    sink = createMonitorDiagnosticSink({ directory, maxBytes: 256, generations: 3 });
    sink({ event: "diagnostic_poll_started", trigger: "poll" });

    const files = logFiles(directory);
    assert.ok(files.length <= 3);
    assert.ok(files.every((file) => readFileSync(file).byteLength <= 256));
    assert.ok(files.reduce((sum, file) => sum + readFileSync(file).byteLength, 0) <= 768);
    assert.ok(readdirSync(directory).every((name) => !name.endsWith(".tmp")));
    const lines = files.flatMap((file) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean));
    assert.ok(lines.length > 0);
    assert.ok(lines.every((line) => JSON.parse(line).schemaVersion === 1));
    assert.ok(lines.some((line) => JSON.parse(line).event === "diagnostic_poll_started"), "new process appends to the bounded current generation");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("diagnostic sink enforces each generation cap at exact newline-inclusive boundaries", () => {
  for (const generations of [1, 2, 3]) {
    const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostics-cap-"));
    const directory = path.join(parent, "logs");
    try {
      let sink = createMonitorDiagnosticSink({ directory, maxBytes: 256, generations });
      const row = { event: "diagnostic_poll_started", trigger: "poll" };
      const rowBytes = Buffer.byteLength(`${JSON.stringify({ schemaVersion: 1, event: row.event, at: "2026-10-18T00:00:00.000Z", trigger: row.trigger })}\n`);
      for (let index = 0; index < 8; index += 1) sink(row);
      const afterRotation = logFiles(directory);
      assert.ok(afterRotation.every((file) => readFileSync(file).byteLength <= 256), `generation ${generations} stays under the per-file cap`);
      assert.ok(afterRotation.reduce((total, file) => total + readFileSync(file).byteLength, 0) <= 256 * generations);
      sink = createMonitorDiagnosticSink({ directory, maxBytes: 256, generations });
      sink(row);
      const files = logFiles(directory);
      assert.ok(files.every((file) => readFileSync(file).byteLength <= 256), `restart preserves generation ${generations} cap`);
      assert.ok(files.reduce((total, file) => total + readFileSync(file).byteLength, 0) <= 256 * generations);
      const retainedRows = files.flatMap((file) => readFileSync(file, "utf8").split("\n").filter(Boolean));
      assert.ok(retainedRows.length > 0);
      assert.ok(retainedRows.every((line) => Buffer.byteLength(`${line}\n`) === rowBytes), "new-line bytes are included in capacity");
      sink({ event: "diagnostic_rpc_completed", readCompletedAt: `2026-10-18T${"1".repeat(300)}Z`, rpcDurationMs: 2 } as any);
      assert.ok(logFiles(directory).every((file) => readFileSync(file).byteLength <= 256), "oversized event is skipped without violating the cap");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
  const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostics-exact-boundary-"));
  const directory = path.join(parent, "logs");
  try {
    const row = { event: "diagnostic_poll_started", trigger: "poll" };
    const rowBytes = Buffer.byteLength(`${JSON.stringify({ schemaVersion: 1, event: row.event, at: "2026-10-18T00:00:00.000Z", trigger: row.trigger })}\n`);
    const sink = createMonitorDiagnosticSink({ directory, maxBytes: rowBytes * 2, generations: 1 });
    sink(row);
    sink(row);
    assert.equal(readFileSync(path.join(directory, "monitor-diagnostics.0.jsonl")).byteLength, rowBytes * 2, "a write ending exactly at the byte cap remains in the same generation");
    sink(row);
    assert.equal(readFileSync(path.join(directory, "monitor-diagnostics.0.jsonl")).byteLength, rowBytes, "the next row rotates at the boundary");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("diagnostic sink ignores prototype event names and continues with later allowed events", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostics-prototype-"));
  const directory = path.join(parent, "logs");
  try {
    const sink = createMonitorDiagnosticSink({ directory });
    for (const event of ["constructor", "toString", "__proto__"]) assert.doesNotThrow(() => sink({ event }));
    sink({ event: "diagnostic_poll_started", trigger: "poll" });
    const contents = logFiles(directory).map((file) => readFileSync(file, "utf8")).join("");
    assert.equal(contents.trim().split("\n").length, 1);
    assert.match(contents, /diagnostic_poll_started/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("sink construction and a lock-rejected monitor leave existing diagnostic files and temporary files untouched", async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostics-lock-owner-"));
  const localAppData = path.join(parent, "local");
  const directory = path.join(localAppData, "CodexUsageMonitor", "diagnostics");
  const env = { LOCALAPPDATA: localAppData, CODEX_USAGE_MONITOR_SECRET: "local-test-placeholder", NODE_ENV: "test" } as NodeJS.ProcessEnv;
  const queuePath = getMonitorPendingPostsPath(env);
  const owner = acquirePendingMonitorPostLock(queuePath);
  try {
    const fs = await import("node:fs");
    fs.mkdirSync(directory, { recursive: true });
    const current = path.join(directory, "monitor-diagnostics.0.jsonl");
    const temp = `${current}.tmp`;
    writeFileSync(current, "corrupt-but-owned-by-the-running-monitor\n", "utf8");
    writeFileSync(temp, "in-progress-generation\n", "utf8");
    const beforeCurrent = statSync(current);
    const beforeTemp = statSync(temp);
    const beforeDirectory = statSync(directory);
    const sink = createMonitorDiagnosticSink({ directory });
    const controller = new AbortController();
    await runCodexUsageMonitor(env, { signal: controller.signal, diagnosticSink: sink, logger: () => {} });
    assert.equal(readFileSync(current, "utf8"), "corrupt-but-owned-by-the-running-monitor\n");
    assert.equal(readFileSync(temp, "utf8"), "in-progress-generation\n");
    assert.equal(statSync(current).mtimeMs, beforeCurrent.mtimeMs);
    assert.equal(statSync(temp).mtimeMs, beforeTemp.mtimeMs);
    assert.equal(statSync(directory).mtimeMs, beforeDirectory.mtimeMs, "lock rejection does not modify the diagnostics directory metadata");
    assert.deepEqual(readdirSync(directory).sort(), ["monitor-diagnostics.0.jsonl", "monitor-diagnostics.0.jsonl.tmp"]);
  } finally {
    owner.release();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("diagnostic sink drops oversized events, repairs corrupt rows, and leaves no temporary file", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostics-corrupt-"));
  const directory = path.join(parent, "logs");
  try {
    const sink = createMonitorDiagnosticSink({ directory, maxBytes: 256, generations: 2 });
    sink({ event: "diagnostic_poll_started", trigger: "initial" });
    const active = logFiles(directory).find((file) => file.endsWith(".0.jsonl"))!;
    writeFileSync(active, `${readFileSync(active, "utf8")}not-json\n{"event":"broken"`, "utf8");
    const restarted = createMonitorDiagnosticSink({ directory, maxBytes: 256, generations: 2 });
    restarted({ event: "diagnostic_rpc_completed", readCompletedAt: "2026-10-18T00:00:00.000Z", rpcDurationMs: 12, rawResponse: "MUST_NOT_PERSIST" } as any);
    restarted({ event: "diagnostic_rpc_completed", readCompletedAt: `2026-10-18T${"1".repeat(500)}Z`, rpcDurationMs: 12 } as any);

    const files = logFiles(directory);
    assert.ok(files.every((file) => readFileSync(file).byteLength <= 256));
    const contents = files.map((file) => readFileSync(file, "utf8")).join("");
    assert.doesNotMatch(contents, /not-json|broken|MUST_NOT_PERSIST/);
    for (const line of contents.trim().split("\n").filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
    assert.ok(readdirSync(directory).every((name) => !name.endsWith(".tmp")));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("diagnostic sink never serializes secrets, raw errors, or arbitrary nested objects", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostics-private-"));
  const directory = path.join(parent, "logs");
  try {
    const sink = createMonitorDiagnosticSink({ directory });
    sink({
      event: "diagnostic_rpc_failed", errorCode: "app_server_request_timeout",
      apiKey: "FAKE_API_KEY_TEST_ONLY", cookie: "FAKE_COOKIE_TEST_ONLY",
      authorization: "Bearer FAKE_AUTH_TEST_ONLY", accountId: "FAKE_ACCOUNT_TEST_ONLY",
      stdout: "FAKE_STDOUT_TEST_ONLY", stderr: "FAKE_STDERR_TEST_ONLY",
      response: { body: "FAKE_RESPONSE_TEST_ONLY" }, exception: { message: "FAKE_EXCEPTION_TEST_ONLY" },
    } as any);
    for (const recovery of MONITOR_DIAGNOSTIC_RECOVERY_OUTCOMES) {
      sink({ event: "diagnostic_webhook_result", status: "success", reason: "recovery_candidate", recoveryOutcome: recovery, postObservedAt: "2026-10-18T00:00:00.000Z" } as any);
    }
    for (const recovery of ["FAKE_RECOVERY_SECRET", "future_server_status", undefined]) {
      sink({ event: "diagnostic_webhook_result", status: "success", reason: "recovery_candidate", recoveryOutcome: recovery, postObservedAt: "2026-10-18T00:00:00.000Z" } as any);
    }

    const data = logFiles(directory).map((file) => readFileSync(file, "utf8")).join("");
    assert.match(data, /app_server_request_timeout/);
    for (const secret of ["FAKE_API_KEY_TEST_ONLY", "FAKE_COOKIE_TEST_ONLY", "FAKE_AUTH_TEST_ONLY", "FAKE_ACCOUNT_TEST_ONLY", "FAKE_STDOUT_TEST_ONLY", "FAKE_STDERR_TEST_ONLY", "FAKE_RESPONSE_TEST_ONLY", "FAKE_EXCEPTION_TEST_ONLY"]) {
      assert.equal(data.includes(secret), false, `${secret} is excluded from local diagnostics`);
    }
    const webhookRows = data.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((row) => row.event === "diagnostic_webhook_result");
    assert.deepEqual(
      webhookRows.map((row) => row.recoveryOutcome),
      [...MONITOR_DIAGNOSTIC_RECOVERY_OUTCOMES, "unknown", "unknown", "missing"],
      "every fixed route/evaluator recovery outcome is preserved and arbitrary values are normalized",
    );
    assert.ok(webhookRows.every((row) => row.postObservedAt === "2026-10-18T00:00:00.000Z"));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("diagnostic write failure is swallowed and disables repeated disk retries", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostics-failure-"));
  const directory = path.join(parent, "not-a-directory");
  try {
    writeFileSync(directory, "block directory creation", "utf8");
    const sink = createMonitorDiagnosticSink({ directory });
    assert.doesNotThrow(() => sink({ event: "diagnostic_poll_started", trigger: "poll" }));
    assert.doesNotThrow(() => sink({ event: "diagnostic_poll_started", trigger: "poll" }));
    assert.equal(readFileSync(directory, "utf8"), "block directory creation");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("local fake app-server traces weekly reads through condition reason, candidate confirmation, and webhook", async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostic-flow-"));
  const localAppData = path.join(parent, "local");
  const diagnosticDirectory = path.join(localAppData, "CodexUsageMonitor", "diagnostics");
  const diagnosticSink = createMonitorDiagnosticSink({ directory: diagnosticDirectory });
  const stdout: Array<Record<string, unknown>> = [];
  const sentSnapshots: Array<{ observedAt: string; reason: string }> = [];
  const controller = new AbortController();
  const startedAt = Date.parse("2026-10-18T00:00:00.000Z");
  let now = startedAt;
  let readCount = 0;
  const readValues = [
    { usedPercent: 80, resetsAt: 1_800_000_000 },
    { usedPercent: 79, resetsAt: 1_800_000_000 },
    { usedPercent: 80, resetsAt: 1_800_000_000 },
    { usedPercent: 20, resetsAt: 1_800_003_600 },
    { usedPercent: 80, resetsAt: 1_800_003_600 },
    { usedPercent: 20, resetsAt: 1_800_007_200 },
    { usedPercent: 22, resetsAt: 1_800_007_200 },
  ];
  const spawnAppServer = () => {
    const emitter = new EventEmitter();
    const child = emitter as unknown as ChildProcessWithoutNullStreams;
    const stdin = new PassThrough();
    const stdoutStream = new PassThrough();
    const stderr = new PassThrough();
    let closed = false;
    Object.assign(child, {
      stdin, stdout: stdoutStream, stderr,
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
        let result: unknown = {};
        if (request.method === "account/rateLimits/read") {
          now += 60_000;
          const picked = readValues[Math.min(readCount, readValues.length - 1)]!;
          readCount += 1;
          result = { rateLimits: { limitId: "codex", planType: "plus", primary: {
            usedPercent: picked.usedPercent, windowDurationMins: 10080, resetsAt: picked.resetsAt,
          } } };
        }
        setImmediate(() => stdoutStream.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`));
      }
    });
    return child;
  };
  try {
    await runCodexUsageMonitor({ LOCALAPPDATA: localAppData, CODEX_USAGE_MONITOR_SECRET: "local-test-placeholder", NODE_ENV: "test" } as NodeJS.ProcessEnv, {
      signal: controller.signal,
      logger: createJsonMonitorLogger((line) => stdout.push(JSON.parse(line) as Record<string, unknown>)),
      diagnosticSink,
      spawnAppServer,
      monitorTiming: { now: () => now, pollIntervalMs: 5 },
      pendingQueueRetryTiming: { checkIntervalMs: 5, shortRetryIntervalMs: 5, recoveryBackoffMs: [5] },
      sendSnapshot: async (snapshot: any, reason: string) => {
        sentSnapshots.push({ observedAt: snapshot.observedAt, reason });
        if (reason === "heartbeat") controller.abort();
        return {
          accepted: true,
          ...(reason === "initial" ? { recovery: "rebase" } : reason === "recovery_candidate" ? { recovery: "confirmed" } : { recovery: "FAKE_RECOVERY_SECRET" }),
        };
      },
    } as any);

    assert.ok(readCount >= 7, "the fake app-server provides baseline, unmet conditions, cancellation, candidate, and confirmation reads");
    const rows = logFiles(diagnosticDirectory).flatMap((file) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>));
    const comparisons = rows.filter((row) => row.event === "diagnostic_comparison_evaluated");
    assert.ok(comparisons.some((row) => row.reason === "time_condition_unmet"));
    assert.ok(comparisons.some((row) => row.reason === "both_conditions_unmet"));
    assert.ok(comparisons.some((row) => row.reason === "candidate_started"));
    assert.ok(comparisons.some((row) => row.reason === "usage_reverted"));
    assert.ok(comparisons.some((row) => row.reason === "candidate_confirmed"));
    assert.ok(rows.some((row) => row.event === "recovery_candidate_started"));
    assert.ok(rows.some((row) => row.event === "recovery_candidate_cancelled" && row.reason === "usage_reverted"));
    assert.ok(rows.some((row) => row.event === "recovery_candidate_confirmed"));
    assert.ok(rows.some((row) => row.event === "diagnostic_webhook_result" && row.status === "success" && row.reason === "recovery_candidate"));
    assert.ok(rows.some((row) => row.event === "diagnostic_webhook_result" && row.reason === "initial" && row.recoveryOutcome === "rebase"));
    assert.ok(rows.some((row) => row.event === "diagnostic_webhook_result" && row.reason === "recovery_candidate" && row.recoveryOutcome === "confirmed"));
    assert.ok(rows.some((row) => row.event === "diagnostic_webhook_result" && row.reason === "heartbeat" && row.status === "success"));
    assert.ok(rows.some((row) => row.event === "diagnostic_webhook_result" && row.reason === "heartbeat" && row.recoveryOutcome === "unknown"));
    assert.doesNotMatch(JSON.stringify(rows), /FAKE_RECOVERY_SECRET/);
    assert.doesNotMatch(JSON.stringify(stdout), /FAKE_RECOVERY_SECRET/);
    assert.ok(comparisons.some((row) => row.reason === "both_conditions_unmet" && row.postReason === "heartbeat"));
    for (const row of rows.filter((item) => item.event === "diagnostic_webhook_result")) {
      assert.ok(sentSnapshots.some((sent) => sent.reason === row.reason && sent.observedAt === row.postObservedAt), "webhook diagnostics identify the exact sent observation");
    }
    const selected = rows.find((row) => row.event === "diagnostic_snapshot_selected");
    assert.equal(selected?.upstreamGeneratedAt, "unknown");
    assert.equal(typeof selected?.readCompletedAt, "string");
    assert.equal(typeof selected?.rpcDurationMs, "number");
    const originalStdoutObservation = stdout.find((row) => row.event === "snapshot_observed");
    assert.equal(originalStdoutObservation?.usedPercent, 80, "existing stdout event fields keep their original contract");
    assert.equal(Object.hasOwn(originalStdoutObservation ?? {}, "readCompletedAt"), false);
  } finally {
    controller.abort();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("fake app-server RPC timeout is logged with a safe fixed code while the monitor remains stoppable", async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "monitor-diagnostic-timeout-"));
  const localAppData = path.join(parent, "local");
  const diagnosticDirectory = path.join(localAppData, "CodexUsageMonitor", "diagnostics");
  const sink = createMonitorDiagnosticSink({ directory: diagnosticDirectory });
  const controller = new AbortController();
  let readRequests = 0;
  const spawnAppServer = () => {
    const emitter = new EventEmitter();
    const child = emitter as unknown as ChildProcessWithoutNullStreams;
    const stdin = new PassThrough();
    const stdoutStream = new PassThrough();
    const stderr = new PassThrough();
    let closed = false;
    Object.assign(child, {
      stdin, stdout: stdoutStream, stderr,
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
        if (request.method === "account/rateLimits/read") { readRequests += 1; continue; }
        setImmediate(() => stdoutStream.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} })}\n`));
      }
    });
    return child;
  };
  const monitor = runCodexUsageMonitor({ LOCALAPPDATA: localAppData, CODEX_USAGE_MONITOR_SECRET: "local-test-placeholder", NODE_ENV: "test" } as NodeJS.ProcessEnv, {
    signal: controller.signal,
    diagnosticSink: sink,
    spawnAppServer,
    monitorTiming: { now: Date.now, pollIntervalMs: 60_000, rpcTimeoutMs: 10 },
  } as any);
  try {
    const deadline = Date.now() + 2_000;
    let rows: Array<Record<string, unknown>> = [];
    while (Date.now() < deadline) {
      rows = logFiles(diagnosticDirectory).flatMap((file) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>));
      if (rows.some((row) => row.event === "diagnostic_rpc_failed")) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(readRequests, 1);
    assert.ok(rows.some((row) => row.event === "diagnostic_rpc_failed" && row.errorCode === "app_server_request_timeout"));
  } finally {
    controller.abort();
    await monitor;
    rmSync(parent, { recursive: true, force: true });
  }
});
