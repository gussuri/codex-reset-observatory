import assert from "node:assert";
import test from "node:test";
import type { CachedRadarData, PublicRadarSnapshot } from "../lib/radar/types";
import {
  applyRefreshFailure,
  applyRefreshSuccess,
  getDashboardDataState,
  type RadarLoadState,
} from "../lib/radar/clientState";

function snapshot(checkedAt: string, overall: "ok" | "degraded" = "ok"): PublicRadarSnapshot {
  return {
    schemaVersion: "public-v1",
    checkedAt,
    updatedAt: null,
    dataHealth: {
      overall,
      stale: false,
      generatedAt: checkedAt,
      sources: {
        supabaseSignals: { state: overall === "ok" ? "ok" : "degraded" },
        openAIStatus: { state: overall === "ok" ? "ok" : "degraded" },
      },
    },
    viewModel: {} as PublicRadarSnapshot["viewModel"],
  };
}

const currentData = snapshot("2026-08-01T00:00:00.000Z");
const cachedData = snapshot("2026-07-31T00:00:00.000Z");

test("applyRefreshSuccess clears an earlier refresh failure", () => {
  assert.deepStrictEqual(
    applyRefreshSuccess(currentData, "2026-08-01T12:00:00.000Z"),
    {
      data: currentData,
      fetchedAt: "2026-08-01T12:00:00.000Z",
      isStale: false,
      refreshError: null,
    },
  );
});

test("applyRefreshFailure preserves current data ahead of an older cache", () => {
  const current: RadarLoadState = {
    data: currentData,
    fetchedAt: "2026-08-01T12:00:00.000Z",
    isStale: false,
    refreshError: null,
  };
  const cached: CachedRadarData = {
    data: cachedData,
    fetchedAt: "2026-07-31T12:00:00.000Z",
  };

  assert.deepStrictEqual(applyRefreshFailure(current, cached), {
    data: currentData,
    fetchedAt: "2026-08-01T12:00:00.000Z",
    isStale: true,
    refreshError: "request_failed",
  });
});

test("applyRefreshFailure falls back to cached data when current data is absent", () => {
  const current: RadarLoadState = {
    data: null,
    fetchedAt: null,
    isStale: false,
    refreshError: null,
  };
  const cached: CachedRadarData = {
    data: cachedData,
    fetchedAt: "2026-07-31T12:00:00.000Z",
  };

  assert.deepStrictEqual(applyRefreshFailure(current, cached), {
    data: cachedData,
    fetchedAt: "2026-07-31T12:00:00.000Z",
    isStale: true,
    refreshError: "request_failed",
  });
});

test("applyRefreshFailure without current or cached data is unavailable", () => {
  const failed = applyRefreshFailure(
    { data: null, fetchedAt: null, isStale: false, refreshError: null },
    null,
  );

  assert.deepStrictEqual(failed, {
    data: null,
    fetchedAt: null,
    isStale: true,
    refreshError: "request_failed",
  });
  assert.strictEqual(getDashboardDataState(failed), "unavailable");
});

test("getDashboardDataState gives unavailable, stale, and degraded data the required precedence", () => {
  const degradedData = snapshot("2026-08-01T12:00:00.000Z", "degraded");

  assert.strictEqual(
    getDashboardDataState({ data: null, fetchedAt: null, isStale: true, refreshError: "request_failed" }),
    "unavailable",
  );
  assert.strictEqual(
    getDashboardDataState({ data: degradedData, fetchedAt: null, isStale: true, refreshError: "request_failed" }),
    "stale",
  );
  assert.strictEqual(
    getDashboardDataState({ data: degradedData, fetchedAt: null, isStale: false, refreshError: null }),
    "degraded",
  );
  assert.strictEqual(
    getDashboardDataState({ data: currentData, fetchedAt: null, isStale: false, refreshError: null }),
    "ready",
  );
});
