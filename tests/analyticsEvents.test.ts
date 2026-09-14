import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ANALYTICS_EVENT_NAMES,
  createHistoryRangeChangeEvent,
  createLocaleSwitchEvent,
  createSourceLinkClickEvent,
  getAnalyticsSourceType,
} from "../lib/analyticsEvents";

test("analytics event factories use the fixed low-cardinality contract", () => {
  assert.deepEqual(
    createSourceLinkClickEvent("ja", "history", "tibo"),
    {
      name: "source_link_click",
      properties: { locale: "ja", route: "history", sourceType: "tibo" },
    },
  );
  assert.deepEqual(
    createLocaleSwitchEvent("en", "zh", "home"),
    {
      name: "locale_switch",
      properties: { fromLocale: "en", toLocale: "zh", route: "home" },
    },
  );
  assert.deepEqual(
    createHistoryRangeChangeEvent("zh", "last_month"),
    {
      name: "history_range_change",
      properties: { locale: "zh", range: "last_month" },
    },
  );

  assert.deepEqual(ANALYTICS_EVENT_NAMES, {
    sourceLinkClick: "source_link_click",
    localeSwitch: "locale_switch",
    historyRangeChange: "history_range_change",
  });
});

test("source kinds map to a fixed source type and never include source data", () => {
  assert.equal(getAnalyticsSourceType("direct_post"), "tibo");
  assert.equal(getAnalyticsSourceType("official_status"), "official_status");
  assert.equal(getAnalyticsSourceType("profile"), "profile");
  assert.equal(getAnalyticsSourceType("none"), "other");
  assert.equal(getAnalyticsSourceType(undefined), "other");

  const sourceEvent = JSON.stringify(createSourceLinkClickEvent("en", "home", "tibo"));
  for (const forbiddenProperty of [
    "tweetId",
    "tweetText",
    "url",
    "query",
    "email",
    "userId",
    "cookie",
    "resetValue",
  ]) {
    assert.doesNotMatch(sourceEvent, new RegExp(forbiddenProperty, "i"));
  }
});

test("events are wired to user actions rather than render or polling", () => {
  const dashboardSource = readFileSync("components/RadarDashboard.tsx", "utf8");
  const historySource = readFileSync("components/LocalizedHistoryEvents.tsx", "utf8");
  const activitySource = readFileSync("components/TiboActivityCard.tsx", "utf8");
  const heatmapSource = readFileSync("components/RandomResetTimeHeatmap.tsx", "utf8");
  const localeLinkSource = readFileSync("components/TrackedLocaleLink.tsx", "utf8");

  assert.match(dashboardSource, /TrackedLocaleLink/);
  assert.match(dashboardSource, /trackSourceLinkClick/);
  assert.match(historySource, /trackSourceLinkClick/);
  assert.match(activitySource, /trackSourceLinkClick/);
  assert.match(heatmapSource, /trackHistoryRangeChange/);
  assert.match(localeLinkSource, /onClick=\{\(\) => trackLocaleSwitch/);
  assert.doesNotMatch(heatmapSource, /trackHistoryRangeChange\([^)]*\)\s*;?\s*\/\/\s*render/i);
});
