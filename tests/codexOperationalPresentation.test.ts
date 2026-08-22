import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RadarDashboard } from "../components/RadarDashboard";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function healthyDataHealth(checkedAt: string) {
  return {
    overall: "ok" as const,
    checkedAt,
    sources: {
      supabaseSignals: { state: "ok" as const },
      openAIStatus: { state: "ok" as const },
    },
  };
}

test("public DTO exposes an unexpired Tibo investigating state", () => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const internal = getLocalRadarData({
    calculationNow: now,
    checkedAt: now.toISOString(),
    dataHealth: healthyDataHealth(now.toISOString()),
    openAIStatus: {
      updatedAt: now.toISOString(),
      statusIncidents24h: 0,
      activeCodexIncidents: 0,
      recentCodexIncidents: 0,
      affectedCodexComponents: 0,
      suppressCodexIncidents: false,
      latestCodexIncidentName: null,
      history: [],
    },
    recentTiboSignals: [{
      tweet_id: "2091033630147854385",
      signal_type: "irrelevant",
      text: "We are investigating and will have an update tomorrow.",
      tweet_url: "https://x.com/thsottiaux/status/2091033630147854385",
      tweet_created_at: "2026-08-22T05:24:01.000Z",
      verification_status: "auto_unverified",
      codex_operational_status: "investigating",
      codex_operational_expires_at: "2026-08-22T17:24:01.000Z",
    } as any],
  });

  const snapshot = toPublicRadarSnapshot(internal, "ja", { calculationNow: now });
  assert.equal(snapshot.codexOperationalStatus, "investigating");
});

test("dashboard consumes explicit status instead of parsing the reasoning sentence", () => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const base = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow: now,
      checkedAt: now.toISOString(),
      dataHealth: healthyDataHealth(now.toISOString()),
    }),
    "ja",
    { calculationNow: now },
  );
  const snapshot = {
    ...base,
    codexOperationalStatus: "none" as const,
    viewModel: {
      ...base.viewModel,
      displayReasoningSummary: "Codex関連の障害が確認されています。",
    },
  };

  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, { initialData: snapshot, locale: "ja" }),
  );
  assert.match(html, /Codex関連状況/);
  assert.match(html, /Codex関連状況[\s\S]*なし/);
  assert.doesNotMatch(html, /Codex関連障害/);
});

test("dashboard renders all explicit operational labels", () => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const base = toPublicRadarSnapshot(
    getLocalRadarData({
      calculationNow: now,
      checkedAt: now.toISOString(),
      dataHealth: healthyDataHealth(now.toISOString()),
    }),
    "ja",
    { calculationNow: now },
  );
  const cases = [
    ["none", "なし"],
    ["investigating", "問題を調査中"],
    ["active", "障害発生中"],
    ["recovered", "復旧直後"],
    ["unknown", "不明"],
  ] as const;

  for (const [status, label] of cases) {
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, {
        initialData: { ...base, codexOperationalStatus: status },
        locale: "ja",
      }),
    );
    assert.match(html, /Codex関連状況/);
    assert.ok(html.includes(label), `${status} should render ${label}`);
  }
});
