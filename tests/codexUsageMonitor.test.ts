import assert from "node:assert/strict";
import test from "node:test";

import {
  createJsonMonitorLogger,
  createJsonLineParser,
  createNotificationDebouncer,
  getSafeMonitorErrorCode,
  getMonitorPollIntervalMs,
  getRestartBackoffMs,
  shouldRestartAppServerAfterRpcFailure,
  toSafeMonitorPayload,
} from "../tools/codex-usage-monitor";

test("JSONL parser emits complete messages and fails closed on malformed lines", () => {
  const messages: unknown[] = [];
  let malformed = 0;
  const parser = createJsonLineParser(
    (message) => messages.push(message),
    () => { malformed += 1; },
  );

  parser.push('{"jsonrpc":"2.0"');
  parser.push(',"id":1}\nnot-json\n{"result":{"ok":true}}\n');

  assert.deepEqual(messages, [
    { jsonrpc: "2.0", id: 1 },
    { result: { ok: true } },
  ]);
  assert.equal(malformed, 1);
});

test("notification refreshes are debounced into one read", async () => {
  let calls = 0;
  const debouncer = createNotificationDebouncer(() => { calls += 1; }, 5);

  debouncer.schedule();
  debouncer.schedule();
  debouncer.schedule();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(calls, 1);
});

test("polling never falls below the sixty second minimum", () => {
  assert.equal(getMonitorPollIntervalMs(undefined), 120_000);
  assert.equal(getMonitorPollIntervalMs("180000"), 180_000);
  assert.equal(getMonitorPollIntervalMs("500"), 60_000);
  assert.equal(getMonitorPollIntervalMs("invalid"), 120_000);
});

test("restart backoff caps at two minutes", () => {
  assert.deepEqual([0, 1, 2, 3].map(getRestartBackoffMs), [5_000, 30_000, 120_000, 120_000]);
});

test("app-server restarts only after three consecutive RPC failures", () => {
  assert.equal(shouldRestartAppServerAfterRpcFailure(1), false);
  assert.equal(shouldRestartAppServerAfterRpcFailure(2), false);
  assert.equal(shouldRestartAppServerAfterRpcFailure(3), true);
  assert.equal(shouldRestartAppServerAfterRpcFailure(4), true);
});

test("monitor payload contains only safe rate-limit fields", () => {
  assert.deepEqual(
    toSafeMonitorPayload({
      observedAt: "2026-08-11T00:02:00.000Z",
      limitId: "codex",
      planType: "plus",
      usedPercent: 0,
      windowDurationMins: 10080,
      resetsAt: 1787012727,
    }),
    {
      observedAt: "2026-08-11T00:02:00.000Z",
      limitId: "codex",
      planType: "plus",
      usedPercent: 0,
      windowDurationMins: 10080,
      resetsAt: 1787012727,
    },
  );
});

test("GUI event output exposes safe snapshot state without credentials", () => {
  const lines: string[] = [];
  const logger = createJsonMonitorLogger((line) => lines.push(line));

  logger("snapshot_sent", {
    observedAt: "2026-08-11T00:02:00.000Z",
    usedPercent: 6,
    resetsAt: 1787012727,
    planType: "plus",
    windowDurationMins: 10080,
    secret: "must-not-leak",
  });

  const event = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(event.event, "snapshot_sent");
  assert.equal(typeof event.at, "string");
  assert.deepEqual({
    observedAt: event.observedAt,
    usedPercent: event.usedPercent,
    resetsAt: event.resetsAt,
    planType: event.planType,
    windowDurationMins: event.windowDurationMins,
  }, {
    observedAt: "2026-08-11T00:02:00.000Z",
    usedPercent: 6,
    resetsAt: 1787012727,
    planType: "plus",
    windowDurationMins: 10080,
  });
  assert.equal(lines[0].includes("must-not-leak"), false);
});

test("GUI-safe error codes preserve only known machine-readable reasons", () => {
  assert.equal(getSafeMonitorErrorCode(new Error("monitor_secret_missing")), "monitor_secret_missing");
  assert.equal(getSafeMonitorErrorCode(new Error("private error details")), "Error");
});
