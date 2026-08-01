import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL_OBSERVATION_SIGNALS } from "../data/observationSignals";
import { LOCAL_PROBABILITY_WEIGHTS } from "../data/predictionWeights";
import { getLocalRadarData } from "../lib/radar";
import {
  getLocalResetProbability,
  getTeaserBoost,
} from "../lib/radar/probability";

test("weekend calm correction is not configured", () => {
  assert.equal("weekendCalmAdjustment" in LOCAL_PROBABILITY_WEIGHTS, false);
});

test("Tibo teaser boost starts lower and decays to zero over 48 hours", () => {
  const observedAt = "2026-08-03T00:00:00.000Z";
  const observed = new Date(observedAt);
  const after24Hours = new Date("2026-08-04T00:00:00.000Z");
  const after48Hours = new Date("2026-08-05T00:00:00.000Z");

  assert.equal(getTeaserBoost("24h", observedAt, observed), 0.2);
  assert.equal(getTeaserBoost("48h", observedAt, observed), 0.3);
  assert.equal(getTeaserBoost("24h", observedAt, after24Hours), 0.1);
  assert.equal(getTeaserBoost("48h", observedAt, after24Hours), 0.15);
  assert.equal(getTeaserBoost("24h", observedAt, after48Hours), 0);
  assert.equal(getTeaserBoost("48h", observedAt, after48Hours), 0);
});

test("an older Tibo teaser contributes less than a fresh teaser", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  const makeData = (tweetCreatedAt: string) =>
    getLocalRadarData({
      activeTiboSignals: [
        {
          tweet_id: `teaser-${tweetCreatedAt}`,
          signal_type: "teaser",
          confidence: 0.85,
          tweet_created_at: tweetCreatedAt,
          expires_at: "2026-08-06T12:00:00.000Z",
          verification_status: "auto_unverified",
        },
      ],
    });

  const fresh = getLocalResetProbability(
    makeData("2026-08-03T12:00:00.000Z"),
    "24h",
    undefined,
    null,
    now,
  );
  const older = getLocalResetProbability(
    makeData("2026-08-02T12:00:00.000Z"),
    "24h",
    undefined,
    null,
    now,
  );

  assert.ok(fresh > older, `expected fresh=${fresh} to exceed older=${older}`);
});

test("48-hour probability is never lower than 24-hour probability", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  const monotonicityFixture = {
    id: "test-24h-only-boost",
    observedAt: now.toISOString(),
    type: "probability_boost" as const,
    status: "active" as const,
    expiresAt: "2026-08-06T12:00:00.000Z",
    boostValue24h: 0.7,
    boostValue48h: 0,
    title: "test fixture",
    source: "test",
    sourceLabel: "test",
  };

  LOCAL_OBSERVATION_SIGNALS.push(monotonicityFixture);
  try {
    const data = getLocalRadarData({});
    const p24 = getLocalResetProbability(data, "24h", undefined, null, now);
    const p48 = getLocalResetProbability(data, "48h", undefined, null, now);

    assert.ok(p48 >= p24, `expected p48=${p48} to be >= p24=${p24}`);
    assert.equal(p48, p24);
  } finally {
    LOCAL_OBSERVATION_SIGNALS.pop();
  }
});
