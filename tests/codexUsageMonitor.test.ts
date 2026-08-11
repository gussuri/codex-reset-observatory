import assert from "node:assert/strict";
import test from "node:test";

import {
  createJsonLineParser,
  createNotificationDebouncer,
  getMonitorPollIntervalMs,
  getRestartBackoffMs,
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
