import assert from "node:assert/strict";
import test from "node:test";
import {
  GA_OPT_OUT_STORAGE_KEY,
  PRODUCTION_ANALYTICS_HOSTNAME,
  buildGa4InitializationScript,
  createSponsorClickEvent,
  dispatchSponsorClickEvent,
  isAnalyticsHostAllowed,
  isAnalyticsOptedOut,
  isValidGa4MeasurementId,
} from "../lib/sponsorAnalytics";

test("sponsor_click contains only placement, locale, and page type", () => {
  const event = createSponsorClickEvent("panel", "ja", "home");

  assert.deepEqual(event, {
    name: "sponsor_click",
    properties: { placement: "panel", locale: "ja", page_type: "home" },
  });
  assert.equal(Object.keys(event.properties).length, 3);
  for (const forbiddenProperty of [
    "url",
    "query",
    "hash",
    "email",
    "userId",
    "tweetText",
    "resetValue",
  ]) {
    assert.doesNotMatch(JSON.stringify(event), new RegExp(forbiddenProperty, "i"));
  }
});

test("sponsor click dispatches once and treats absent or throwing analytics as best effort", () => {
  const event = createSponsorClickEvent("panel", "en", "home");
  const calls: unknown[][] = [];

  dispatchSponsorClickEvent(event, (...args: unknown[]) => calls.push(args));
  assert.deepEqual(calls, [["event", "sponsor_click", event.properties]]);

  assert.doesNotThrow(() => dispatchSponsorClickEvent(event, undefined));
  assert.doesNotThrow(() =>
    dispatchSponsorClickEvent(event, () => {
      throw new Error("blocked analytics");
    }),
  );
});

test("GA4 loader accepts a standard G- measurement ID and sanitizes page location", () => {
  const id = "G-PSW1MY7HB4";

  assert.equal(isValidGa4MeasurementId(id), true);
  const script = buildGa4InitializationScript(id);
  assert.ok(script);
  assert.match(script, /allow_google_signals: false/);
  assert.match(script, /allow_ad_personalization_signals: false/);
  assert.match(script, /window\.location\.origin \+ window\.location\.pathname/);
  assert.doesNotMatch(script, /location\.search|location\.hash|user_id|ad_storage/);
  assert.equal(buildGa4InitializationScript(undefined), null);
});

test("invalid and legacy IDs never generate GA4 script markup", () => {
  for (const id of [undefined, "", "UA-12345678-9", "G-short", " G-PSW1MY7HB4", "G-PSW1MY7HB4\n"]) {
    assert.equal(isValidGa4MeasurementId(id), false);
    assert.equal(buildGa4InitializationScript(id), null);
  }
});

test("GA4 host guard blocks Vercel preview URLs and restricts production env to canonical domain", () => {
  assert.equal(isAnalyticsHostAllowed(PRODUCTION_ANALYTICS_HOSTNAME, "production"), true);
  assert.equal(isAnalyticsHostAllowed("codex-reset-observatory-abc123-gussuris-projects.vercel.app", "production"), false);
  assert.equal(isAnalyticsHostAllowed("codex-reset-observatory.vercel.app", undefined), false);
  assert.equal(isAnalyticsHostAllowed(PRODUCTION_ANALYTICS_HOSTNAME, "preview"), false);
  assert.equal(isAnalyticsHostAllowed("127.0.0.1", "preview"), false);
  assert.equal(isAnalyticsHostAllowed("127.0.0.1", undefined), true);
  assert.equal(isAnalyticsHostAllowed("", undefined), false);
});

test("GA4 opt-out helper honors localStorage flag and fails open safely", () => {
  assert.equal(isAnalyticsOptedOut(undefined), false);
  assert.equal(isAnalyticsOptedOut({ getItem: () => null }), false);
  assert.equal(isAnalyticsOptedOut({ getItem: () => "0" }), false);
  assert.equal(
    isAnalyticsOptedOut({ getItem: (key) => (key === GA_OPT_OUT_STORAGE_KEY ? "1" : null) }),
    true,
  );
  assert.equal(
    isAnalyticsOptedOut({
      getItem: () => {
        throw new Error("storage blocked");
      },
    }),
    false,
  );
});
