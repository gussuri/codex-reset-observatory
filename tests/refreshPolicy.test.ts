import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartRadarRefresh,
  getEventRefreshPlan,
  getInitialRefreshPlan,
  getRefreshRetryDelayMs,
  RADAR_FETCH_TIMEOUT_MS,
  startAbortTimeout,
} from "../lib/radar/refreshPolicy";
import type { PublicRadarSnapshot } from "../lib/radar/types";

function snapshot(
  checkedAt: string,
  options: { stale?: boolean; overall?: "ok" | "degraded" } = {},
): PublicRadarSnapshot {
  return {
    schemaVersion: "public-v1",
    checkedAt,
    updatedAt: null,
    dataHealth: {
      overall: options.overall ?? "ok",
      stale: options.stale ?? false,
      generatedAt: checkedAt,
      sources: {
        supabaseSignals: { state: "ok" },
        openAIStatus: { state: "ok" },
      },
    },
    viewModel: {
      status: "ok",
      expectation: "低",
      probability24h: 0.02,
      probability48h: 0.05,
      lastUpdated: checkedAt,
      regularResetForecast: {
        date: "2026-08-08",
        time: null,
        remaining: "7 days",
        sourceResetAt: checkedAt,
        expectedAt: null,
        lastCompletedAt: checkedAt,
        remainingDays: 7,
        isNoticeWindow: false,
      },
      activeWindow: {
        active: false,
        kind: "none",
        label: "none",
        summary: "none",
      },
      displayReasoningSummary: null,
      latestWindow: {
        kind: "observed",
        title: "none",
        summary: "none",
        scope: "all",
        windowLength: "0 minutes",
      },
      recentHistory: [],
    },
  };
}

const NOW = Date.parse("2026-08-04T01:00:00.000Z");
const FRESH_AT = "2026-08-04T00:55:00.000Z";

test("fresh initial data waits for the remaining update interval", () => {
  assert.deepEqual(getInitialRefreshPlan(snapshot(FRESH_AT), FRESH_AT, NOW), {
    action: "wait",
    delayMs: 5 * 60 * 1000,
  });
});

test("wake events fetch after thirty seconds but coalesce rapid events", () => {
  assert.deepEqual(
    getEventRefreshPlan(snapshot(FRESH_AT), FRESH_AT, Date.parse(FRESH_AT) + 29_000),
    { action: "wait", delayMs: 1_000 },
  );
  assert.deepEqual(
    getEventRefreshPlan(snapshot(FRESH_AT), FRESH_AT, Date.parse(FRESH_AT) + 30_000),
    { action: "fetch", delayMs: 0 },
  );
});

test("stale data also coalesces wake events within thirty seconds of a success", () => {
  const stale = snapshot(FRESH_AT, { stale: true });
  assert.deepEqual(
    getEventRefreshPlan(stale, FRESH_AT, Date.parse(FRESH_AT) + 29_000),
    { action: "wait", delayMs: 1_000 },
  );
  assert.deepEqual(
    getEventRefreshPlan(stale, FRESH_AT, Date.parse(FRESH_AT) + 30_000),
    { action: "fetch", delayMs: 0 },
  );
});

test("visible refresh is capped at ten minutes even for low probability", () => {
  assert.deepEqual(
    getInitialRefreshPlan(snapshot(FRESH_AT), FRESH_AT, Date.parse(FRESH_AT)),
    { action: "wait", delayMs: 10 * 60 * 1000 },
  );
});

test("missing, invalid, stale, degraded, and expired initial data fetch immediately", () => {
  assert.deepEqual(getInitialRefreshPlan(null, null, NOW), { action: "fetch", delayMs: 0 });
  assert.deepEqual(getInitialRefreshPlan(snapshot(FRESH_AT), "invalid", NOW), { action: "fetch", delayMs: 0 });
  assert.deepEqual(
    getInitialRefreshPlan(snapshot(FRESH_AT, { stale: true }), FRESH_AT, NOW),
    { action: "fetch", delayMs: 0 },
  );
  assert.deepEqual(
    getInitialRefreshPlan(snapshot(FRESH_AT, { overall: "degraded" }), FRESH_AT, NOW),
    { action: "fetch", delayMs: 0 },
  );
  assert.deepEqual(
    getInitialRefreshPlan(snapshot(FRESH_AT), FRESH_AT, NOW + 6 * 60 * 60 * 1000),
    { action: "fetch", delayMs: 0 },
  );
});

test("retry delays are one minute, five minutes, and fifteen minutes", () => {
  assert.equal(getRefreshRetryDelayMs(1), 60 * 1000);
  assert.equal(getRefreshRetryDelayMs(2), 5 * 60 * 1000);
  assert.equal(getRefreshRetryDelayMs(3), 15 * 60 * 1000);
  assert.equal(getRefreshRetryDelayMs(99), 15 * 60 * 1000);
});

test("refresh is blocked while hidden, offline, or already in flight", () => {
  assert.equal(canStartRadarRefresh({ visibilityState: "visible", onLine: true, inFlight: false }), true);
  assert.equal(canStartRadarRefresh({ visibilityState: "hidden", onLine: true, inFlight: false }), false);
  assert.equal(canStartRadarRefresh({ visibilityState: "visible", onLine: false, inFlight: false }), false);
  assert.equal(canStartRadarRefresh({ visibilityState: "visible", onLine: true, inFlight: true }), false);
});

test("abort timeout cancels the request at fifteen seconds", () => {
  const controller = new AbortController();
  const timeoutCallback: { current: (() => void) | null } = { current: null };
  let clearedHandle: unknown = null;

  const timeout = startAbortTimeout(
    controller,
    RADAR_FETCH_TIMEOUT_MS,
    (callback) => {
      timeoutCallback.current = callback;
      return "timeout-handle";
    },
    (handle) => {
      clearedHandle = handle;
    },
  );

  assert.equal(controller.signal.aborted, false);
  assert.equal(timeout.hasTimedOut(), false);
  timeoutCallback.current?.();
  assert.equal(controller.signal.aborted, true);
  assert.equal(timeout.hasTimedOut(), true);
  timeout.cancel();
  assert.equal(clearedHandle, "timeout-handle");
});
