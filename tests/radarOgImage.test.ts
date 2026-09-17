import assert from "node:assert/strict";
import test from "node:test";

import { buildRadarOgImageModel } from "../lib/radarOgImage";
import type { PublicRadarSnapshot } from "../lib/radar/types";

function snapshot(overrides: Partial<PublicRadarSnapshot> = {}): PublicRadarSnapshot {
  return {
    schemaVersion: "public-v1",
    checkedAt: "2026-09-17T13:54:00.000Z",
    updatedAt: null,
    lastRandomResetAt: "2026-09-12T08:54:00.000Z",
    dataHealth: {
      overall: "ok",
      stale: false,
      generatedAt: "2026-09-17T13:54:00.000Z",
      sources: {
        supabaseSignals: { state: "ok" },
        openAIStatus: { state: "ok" },
      },
    },
    viewModel: {
      status: "ok",
      expectation: "低",
      probability12h: 0.04,
      probability24h: 0.07,
      probability48h: 0.16,
      probability72h: 0.21,
      lastUpdated: "2026-09-17T13:54:00.000Z",
      regularResetForecast: {} as PublicRadarSnapshot["viewModel"]["regularResetForecast"],
      activeWindow: {
        active: false,
        kind: "none",
        label: "none",
        summary: "none",
        openedAt: null,
        expectedAt: null,
        expectedEndAt: null,
        expectedPrecision: null,
        expectedTimeZone: null,
        source: null,
        sourceLabel: null,
        forecastDate: undefined,
        forecastTime: null,
        remaining: "",
        isOverduePending: false,
        overdueText: null,
      },
      displayReasoningSummary: null,
      codexOperationalStatus: "none",
      latestWindow: {} as PublicRadarSnapshot["viewModel"]["latestWindow"],
      recentHistory: [],
    },
    resetTeaserStatus: "none",
    latestTiboActivity: null,
    recoveryObservation: null,
    ...overrides,
  };
}

test("OG model uses the public snapshot probabilities and current signal state", () => {
  const model = buildRadarOgImageModel(snapshot(), "ja");

  assert.ok(model);
  assert.equal(model.probability24h, "7%");
  assert.equal(model.probability48h, "16%");
  assert.equal(model.expectation, "低");
  assert.equal(model.officialNotice, "なし");
  assert.equal(model.teaser, "なし");
  assert.equal(model.incident, "なし");
  assert.equal(model.elapsed, "5日5時間");
  assert.equal(model.updated, "2026/09/17 22:54 JST");
});

test("OG model localizes labels without changing the shared values", () => {
  const model = buildRadarOgImageModel(snapshot({ resetTeaserStatus: "weak" }), "en");

  assert.ok(model);
  assert.equal(model.probability24h, "7%");
  assert.equal(model.probability48h, "16%");
  assert.equal(model.officialNotice, "No");
  assert.equal(model.teaser, "Yes");
  assert.equal(model.incident, "No");
  assert.equal(model.elapsed, "5 days and 5 hours");
  assert.equal(model.updated, "2026/09/17 22:54 JST");
});

test("OG model localizes the full card copy for the Chinese route", () => {
  const model = buildRadarOgImageModel(snapshot(), "zh");

  assert.ok(model);
  assert.equal(model.copy.title, "Codex 重置观测站");
  assert.equal(model.copy.expectation, "随机重置倾向");
  assert.equal(model.copy.within24h, "未来24小时");
  assert.equal(model.copy.within48h, "未来48小时");
  assert.equal(model.copy.officialNotice, "官方预告");
  assert.equal(model.copy.teaser, "暗示");
  assert.equal(model.copy.incident, "故障");
  assert.equal(model.copy.elapsed, "距上次随机重置");
});

test("OG generation fails closed to the static fallback when the snapshot is degraded or invalid", () => {
  assert.equal(
    buildRadarOgImageModel(snapshot({ dataHealth: { ...snapshot().dataHealth, overall: "degraded" } }), "ja"),
    null,
  );
  assert.equal(
    buildRadarOgImageModel(snapshot({ viewModel: { ...snapshot().viewModel, probability24h: Number.NaN } }), "ja"),
    null,
  );
});
