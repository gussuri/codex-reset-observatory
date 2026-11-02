import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGa4InitializationScript,
  createSponsorClickEvent,
  dispatchSponsorClickEvent,
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
