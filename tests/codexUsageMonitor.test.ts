import assert from "node:assert/strict";
import test from "node:test";

import {
  createJsonMonitorLogger,
  createJsonLineParser,
  createNotificationDebouncer,
  enqueueMonitorSnapshotPost,
  getPendingMonitorPosts,
  getSafeMonitorErrorCode,
  getMonitorPollIntervalMs,
  getMonitorSnapshotPostReason,
  getRestartBackoffMs,
  markMonitorSnapshotPostSucceeded,
  MONITOR_HEARTBEAT_INTERVAL_MS,
  shouldRestartAppServerAfterRpcFailure,
  toSafeMonitorPayload,
  updateMonitorSnapshotState,
} from "../tools/codex-usage-monitor";

function snapshot(overrides: Partial<{
  observedAt: string;
  limitId: "codex";
  planType: string;
  usedPercent: number;
  windowDurationMins: 10080;
  resetsAt: number;
  bankedCredit?: {
    available: boolean;
    unlimited: boolean;
    balance: string;
  } | null;
  bankedResetAvailableCount?: number | null;
  bankedResetDisplayCount?: number | null;
}> = {}) {
  return {
    observedAt: "2026-08-21T00:00:00.000Z",
    limitId: "codex" as const,
    planType: "plus",
    usedPercent: 20,
    windowDurationMins: 10080 as const,
    resetsAt: 1_787_012_727,
    ...overrides,
  };
}

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

test("the monitor heartbeat is shorter than the server comparison gap", () => {
  assert.equal(MONITOR_HEARTBEAT_INTERVAL_MS, 8 * 60 * 1000);
  assert.ok(MONITOR_HEARTBEAT_INTERVAL_MS < 10 * 60 * 1000);
});

test("the first valid snapshot is posted immediately", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot(), {
      previousLocalSnapshot: null,
      lastSuccessfulPostAt: null,
    }, 0),
    "initial",
  );
});

test("ordinary used-percent increases are suppressed", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({ usedPercent: 21 }), {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    null,
  );
});

test("a used-percent decrease without a reset-at advance is suppressed", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({ usedPercent: 19 }), {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    null,
  );
});

test("a reset-at advance without a used-percent decrease is suppressed", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({ resetsAt: 1_787_016_327 }), {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    null,
  );
});

test("a meaningful recovery is posted immediately as a recovery candidate", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({ usedPercent: 19, resetsAt: 1_787_016_327 }), {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    "recovery_candidate",
  );
});

test("a newly observed local BANKED credit is posted as an explicit credit change", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({
      bankedCredit: { available: true, unlimited: false, balance: "1" },
    }), {
      previousLocalSnapshot: snapshot({
        bankedCredit: { available: false, unlimited: false, balance: "0" },
      }),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    "banked_credit_change",
  );
});

test("a BANKED credit change remains explicit when it coincides with weekly recovery", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({
      usedPercent: 19,
      resetsAt: 1_787_016_327,
      bankedCredit: { available: true, unlimited: false, balance: "1" },
    }), {
      previousLocalSnapshot: snapshot({
        bankedCredit: { available: false, unlimited: false, balance: "0" },
      }),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    "banked_credit_change",
  );
});

test("a consumed local BANKED credit does not look like a distribution", () => {
  assert.notEqual(
    getMonitorSnapshotPostReason(snapshot({
      bankedCredit: { available: false, unlimited: false, balance: "0" },
    }), {
      previousLocalSnapshot: snapshot({
        bankedCredit: { available: true, unlimited: false, balance: "1" },
      }),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    "banked_credit_change",
  );
});

test("a BANKED reset count change remains local-only and does not trigger a webhook post", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({ bankedResetAvailableCount: 1 }), {
      previousLocalSnapshot: snapshot({ bankedResetAvailableCount: 0 }),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    null,
  );

  const payload = toSafeMonitorPayload(snapshot({ bankedResetAvailableCount: 1 }), "heartbeat");
  assert.equal("bankedResetAvailableCount" in payload, false);
});

test("a failed event post stays pending with its detection snapshot until success", () => {
  const detected = snapshot({
    observedAt: "2026-08-21T00:02:00.000Z",
    bankedCredit: { available: true, unlimited: false, balance: "1" },
  });
  let state = enqueueMonitorSnapshotPost({
    previousLocalSnapshot: snapshot({
      bankedCredit: { available: false, unlimited: false, balance: "0" },
    }),
    lastSuccessfulPostAt: 0,
  }, "banked_credit_change", detected);

  assert.deepEqual(getPendingMonitorPosts(state), [{
    reason: "banked_credit_change",
    snapshot: detected,
  }]);

  state = {
    ...state,
    previousLocalSnapshot: snapshot({
      observedAt: "2026-08-21T00:04:00.000Z",
      bankedCredit: { available: true, unlimited: false, balance: "1" },
    }),
  };
  assert.equal(getPendingMonitorPosts(state)[0]?.snapshot.observedAt, detected.observedAt);

  state = markMonitorSnapshotPostSucceeded(state, 240_000);
  assert.deepEqual(getPendingMonitorPosts(state), []);
  assert.equal(state.lastSuccessfulPostAt, 240_000);
});

test("recovery and structure events can queue behind an earlier failed event post", () => {
  let state = enqueueMonitorSnapshotPost({
    previousLocalSnapshot: snapshot(),
    lastSuccessfulPostAt: 0,
  }, "recovery_candidate", snapshot({ usedPercent: 19, resetsAt: 1_787_016_327 }));
  state = enqueueMonitorSnapshotPost(state, "structure_change", snapshot({ planType: "team" }));

  assert.deepEqual(getPendingMonitorPosts(state).map((pending) => pending.reason), [
    "recovery_candidate",
    "structure_change",
  ]);
});

test("repeated initial failures keep one pending initial post", () => {
  let state = enqueueMonitorSnapshotPost({
    previousLocalSnapshot: null,
    lastSuccessfulPostAt: null,
  }, "initial", snapshot({ observedAt: "2026-08-21T00:02:00.000Z" }));
  state = enqueueMonitorSnapshotPost(
    state,
    "initial",
    snapshot({ observedAt: "2026-08-21T00:04:00.000Z" }),
  );

  assert.equal(getPendingMonitorPosts(state).length, 1);
  assert.equal(getPendingMonitorPosts(state)[0]?.snapshot.observedAt, "2026-08-21T00:02:00.000Z");
});

test("plan changes are posted as a structure change", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({ planType: "team" }), {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    "structure_change",
  );
});

test("limit and window changes are also structure changes", () => {
  assert.equal(
    getMonitorSnapshotPostReason({
      ...snapshot(),
      limitId: "other",
    } as unknown as ReturnType<typeof snapshot>, {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    "structure_change",
  );
  assert.equal(
    getMonitorSnapshotPostReason({
      ...snapshot(),
      windowDurationMins: 300,
    } as unknown as ReturnType<typeof snapshot>, {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, 120_000),
    "structure_change",
  );
});

test("a snapshot before the heartbeat deadline is suppressed", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot(), {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, MONITOR_HEARTBEAT_INTERVAL_MS - 1),
    null,
  );
});

test("a snapshot at the heartbeat deadline is posted as a heartbeat", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot(), {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, MONITOR_HEARTBEAT_INTERVAL_MS),
    "heartbeat",
  );
});

test("a failed post advances the local snapshot but not the successful-post time", () => {
  const state = updateMonitorSnapshotState({
    previousLocalSnapshot: snapshot(),
    lastSuccessfulPostAt: 0,
  }, snapshot({ usedPercent: 19 }), false, MONITOR_HEARTBEAT_INTERVAL_MS);

  assert.equal(state.previousLocalSnapshot?.usedPercent, 19);
  assert.equal(state.lastSuccessfulPostAt, 0);
});

test("a successful post records its completion time", () => {
  const state = updateMonitorSnapshotState({
    previousLocalSnapshot: snapshot(),
    lastSuccessfulPostAt: 0,
  }, snapshot(), true, MONITOR_HEARTBEAT_INTERVAL_MS);

  assert.equal(state.lastSuccessfulPostAt, MONITOR_HEARTBEAT_INTERVAL_MS);
});

test("a failed initial post remains eligible for retry on the next poll", () => {
  const state = updateMonitorSnapshotState({
    previousLocalSnapshot: null,
    lastSuccessfulPostAt: null,
  }, snapshot(), false, 0);

  assert.equal(getMonitorSnapshotPostReason(snapshot({ observedAt: "2026-08-21T00:02:00.000Z" }), state, 120_000), "initial");
});

test("a notification-triggered recovery uses the same post policy as polling", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({ usedPercent: 19, resetsAt: 1_787_016_327 }), {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, 2_000),
    "recovery_candidate",
  );
});

test("the strongest reason wins when recovery, structure, and heartbeat coincide", () => {
  assert.equal(
    getMonitorSnapshotPostReason(snapshot({ planType: "team", usedPercent: 19, resetsAt: 1_787_016_327 }), {
      previousLocalSnapshot: snapshot(),
      lastSuccessfulPostAt: 0,
    }, MONITOR_HEARTBEAT_INTERVAL_MS),
    "recovery_candidate",
  );
});

test("successful heartbeats keep the server comparison interval below ten minutes", () => {
  const first = snapshot();
  let state = updateMonitorSnapshotState({
    previousLocalSnapshot: null,
    lastSuccessfulPostAt: null,
  }, first, true, 0);
  const heartbeatAt = MONITOR_HEARTBEAT_INTERVAL_MS;
  assert.equal(getMonitorSnapshotPostReason(snapshot({ observedAt: "2026-08-21T00:08:00.000Z" }), state, heartbeatAt), "heartbeat");
  state = updateMonitorSnapshotState(state, snapshot({ observedAt: "2026-08-21T00:08:00.000Z" }), true, heartbeatAt);
  assert.ok(heartbeatAt - (state.lastSuccessfulPostAt ?? 0) <= 10 * 60 * 1000);
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

test("monitor payload includes credit state only for an explicit credit change", () => {
  assert.deepEqual(
    toSafeMonitorPayload({
      observedAt: "2026-08-21T00:02:00.000Z",
      limitId: "codex",
      planType: "plus",
      usedPercent: 0,
      windowDurationMins: 10080,
      resetsAt: 1787012727,
      bankedCredit: { available: true, unlimited: false, balance: "1" },
    }, "banked_credit_change"),
    {
      observedAt: "2026-08-21T00:02:00.000Z",
      limitId: "codex",
      planType: "plus",
      usedPercent: 0,
      windowDurationMins: 10080,
      resetsAt: 1787012727,
      bankedCredit: { available: true, unlimited: false, balance: "1" },
      bankedCreditChange: true,
    },
  );
});

test("GUI event output exposes safe snapshot state without credentials", () => {
  const lines: string[] = [];
  const logger = createJsonMonitorLogger((line) => lines.push(line));

  logger("snapshot_sent", {
    reason: "initial",
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
    reason: event.reason,
    observedAt: event.observedAt,
    usedPercent: event.usedPercent,
    resetsAt: event.resetsAt,
    planType: event.planType,
    windowDurationMins: event.windowDurationMins,
  }, {
    reason: "initial",
    observedAt: "2026-08-11T00:02:00.000Z",
    usedPercent: 6,
    resetsAt: 1787012727,
    planType: "plus",
    windowDurationMins: 10080,
  });
  assert.equal(lines[0].includes("must-not-leak"), false);
});

test("local GUI snapshot events expose the normalized BANKED reset count without credentials", () => {
  const lines: string[] = [];
  const logger = createJsonMonitorLogger((line) => lines.push(line));

  for (const availableCount of [0, 1, 2]) {
    logger("snapshot_observed", {
      observedAt: "2026-08-21T00:02:00.000Z",
      usedPercent: 6,
      resetsAt: 1787012727,
      planType: "plus",
      windowDurationMins: 10080,
      bankedResetDisplayCount: availableCount,
      secret: "must-not-leak",
    });
  }

  const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(events.map((event) => event.bankedResetDisplayCount), [0, 1, 2]);
  assert.equal(lines.every((line) => line.includes("must-not-leak") === false), true);
});

test("local GUI snapshot events omit an unavailable BANKED reset count", () => {
  const lines: string[] = [];
  const logger = createJsonMonitorLogger((line) => lines.push(line));

  logger("snapshot_observed", {
    observedAt: "2026-08-21T00:02:00.000Z",
    usedPercent: 6,
    resetsAt: 1787012727,
    planType: "plus",
    windowDurationMins: 10080,
    bankedResetDisplayCount: null,
  });

  const event = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal("bankedResetDisplayCount" in event, false);
});

test("GUI-safe error codes preserve only known machine-readable reasons", () => {
  assert.equal(getSafeMonitorErrorCode(new Error("monitor_secret_missing")), "monitor_secret_missing");
  assert.equal(getSafeMonitorErrorCode(new Error("private error details")), "Error");
});
