import test from "node:test";
import assert from "node:assert/strict";

import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import {
  calculateSurvivalConditionedProbability,
} from "../lib/radar/survivalConditionedProbability";
import type { ActiveOfficialNotice } from "../lib/radar/probability";
import {
  applyTimedTeaserProbabilityReallocation,
  getTimedTeaserCandidates,
} from "../lib/radar/timedTeaserProbability";
import { interpretTiboSignal } from "../lib/radar/teaserStrength";
import type { ActiveTiboSignal } from "../lib/radar/types";
import { frozenSupportShapeSurvivalStaticHistory } from "./fixtures/survivalConditionedHistory";

const NOW = new Date("2026-09-19T22:00:00.000Z");
const WINDOW_START = "2026-09-22T07:00:00.000Z";
const WINDOW_END = "2026-09-23T07:00:00.000Z";

function contextualSignal(overrides: Partial<ActiveTiboSignal> = {}): ActiveTiboSignal {
  return {
    tweet_id: "contextual-timed",
    tweet_created_at: "2026-09-19T07:00:00.000Z",
    text: "OK fine. But it is still coming Tuesday.",
    signal_type: "official_notice",
    confidence: 0.85,
    verification_status: "auto_unverified",
    is_reply: true,
    reply_context_text: "you owe us a banked reset",
    temporal_resolution_status: "resolved",
    temporal_precision: "day",
    temporal_confidence: 0.98,
    expected_start_at: WINDOW_START,
    expected_end_at: WINDOW_END,
    ...overrides,
  };
}

function survivalData(signals: ActiveTiboSignal[] = []) {
  return getLocalRadarData({
    calculationNow: NOW,
    recentTiboSignals: signals,
  });
}

function calculate(
  signals: ActiveTiboSignal[] = [],
  activeOfficialNotice: ActiveOfficialNotice | null = null,
) {
  return calculateSurvivalConditionedProbability(survivalData(signals), {
    now: NOW,
    activeOfficialNotice,
    staticHistory: frozenSupportShapeSurvivalStaticHistory(),
  });
}

test("contextual timed replies become strong presentation evidence without becoming official or ordinary teasers", () => {
  const interpretation = interpretTiboSignal(contextualSignal(), NOW);
  assert.equal(interpretation.presentationDisposition, "strong_teaser");
  assert.equal(interpretation.officialNoticeEligible, false);
  assert.equal(interpretation.probabilityTeaserEligible, false);
  assert.equal(interpretation.timedProbabilityEligible, true);
  assert.equal(interpretation.historyEligible, false);
  assert.equal(interpretation.contextDependence, "reply_context");
  assert.equal(contextualSignal().signal_type, "official_notice");
});

test("the public timed teaser card shares the interpretation and keeps its resolved window", () => {
  const snapshot = toPublicRadarSnapshot(survivalData([contextualSignal()]), "en", {
    calculationNow: NOW,
  });

  assert.equal(snapshot.resetTeaserStatus, "strong");
  assert.equal(snapshot.latestTiboActivity?.classification, "teaser");
  assert.equal(snapshot.latestTiboActivity?.teaserStrength, "strong");
  assert.equal(snapshot.latestTiboActivity?.isReply, true);
  assert.equal(snapshot.latestTiboActivity?.temporalResolutionStatus, "resolved");
  assert.equal(snapshot.latestTiboActivity?.expectedStartAt, WINDOW_START);
  assert.equal(snapshot.latestTiboActivity?.expectedEndAt, WINDOW_END);
});

test("timed reallocation moves pre-window mass toward the future window without changing the survival hazard", () => {
  const hoursUntilWindow = (Date.parse(WINDOW_START) - NOW.getTime()) / (60 * 60 * 1000);
  assert.ok(hoursUntilWindow > 48 && hoursUntilWindow < 72);
  const baseline = calculate();
  const adjusted = calculate([contextualSignal()]);

  assert.equal(adjusted.officialNoticeOverride.active, false);
  assert.equal(adjusted.survival.timedTeaserReallocation?.applied, true);
  assert.equal(adjusted.survival.timedTeaserReallocation?.contextDependence, "reply_context");
  assert.equal(adjusted.survival.timedTeaserReallocation?.weight, 0.2);
  const timedAudit = adjusted.survival.timedTeaserReallocation;
  assert.ok(timedAudit?.cdf);
  assert.equal(timedAudit.cdf.probability48h, 0);
  assert.ok(adjusted.predictions.probability12h < baseline.predictions.probability12h);
  assert.ok(adjusted.predictions.probability24h < baseline.predictions.probability24h);
  assert.ok(adjusted.predictions.probability48h < baseline.predictions.probability48h);
  assert.equal(adjusted.survival.completedIntervalCount, baseline.survival.completedIntervalCount);
  assert.equal(adjusted.survival.latestRandomResetAt, baseline.survival.latestRandomResetAt);
  assert.deepEqual(adjusted.hazard.intervals, baseline.hazard.intervals);

  const values = [
    adjusted.predictions.probability12h,
    adjusted.predictions.probability24h,
    adjusted.predictions.probability48h,
    adjusted.predictions.probability72h,
  ];
  assert.ok(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.ok(values[0] <= values[1] && values[1] <= values[2] && values[2] <= values[3]);
});

test("window completion releases the timed adjustment instead of creating a permanent boost", () => {
  const base = {
    probability12h: 0.2,
    probability24h: 0.3,
    probability48h: 0.5,
    probability72h: 0.7,
  };
  const signal = contextualSignal();
  const candidate = getTimedTeaserCandidates(
    getLocalRadarData({ calculationNow: NOW, recentTiboSignals: [signal] }),
    null,
    NOW,
  )[0];
  assert.ok(candidate);

  const before = applyTimedTeaserProbabilityReallocation(base, candidate, NOW);
  assert.equal(before.audit.applied, true);

  const afterNow = new Date("2026-09-24T07:00:00.000Z");
  const afterCandidate = getTimedTeaserCandidates(
    getLocalRadarData({ calculationNow: afterNow, recentTiboSignals: [signal] }),
    null,
    afterNow,
  )[0] ?? null;
  assert.equal(afterCandidate, null);
  assert.deepEqual(applyTimedTeaserProbabilityReallocation(base, afterCandidate, afterNow).predictions, base);
});

test("official notice timing remains authoritative and ordinary replies have no timed effect", () => {
  const official = calculate([contextualSignal()], {
    origin: "dynamic",
    id: "active-official",
    title: "Official reset",
    summary: "An official reset notice",
    observedAt: NOW.toISOString(),
    expectedAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    expectedEndAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 72 * 60 * 60 * 1000).toISOString(),
    source: "https://example.com/notice",
    sourceLabel: "test",
  });
  assert.equal(official.officialNoticeOverride.active, true);
  assert.equal(official.survival.timedTeaserReallocation, null);

  const ordinary = contextualSignal({
    tweet_id: "ordinary-reply",
    signal_type: "irrelevant",
    text: "Maybe tomorrow",
  });
  const interpretation = interpretTiboSignal(ordinary, NOW);
  assert.equal(interpretation.presentationDisposition, "none");
  assert.equal(interpretation.timedProbabilityEligible, false);
});

test("multiple timed candidates are represented once and direct strong teasers keep the ordinary path", () => {
  const signals = [
    contextualSignal({ tweet_id: "older-context" }),
    contextualSignal({ tweet_id: "newer-context", tweet_created_at: "2026-09-20T06:00:00.000Z" }),
  ];
  const candidates = getTimedTeaserCandidates(
    getLocalRadarData({ calculationNow: NOW, recentTiboSignals: signals }),
    null,
    NOW,
  );
  assert.ok(candidates.length >= 1);
  assert.equal(new Set(candidates.map((candidate) => candidate.signal.tweet_id)).size, candidates.length);
  const selected = applyTimedTeaserProbabilityReallocation(
    { probability12h: 0.2, probability24h: 0.3, probability48h: 0.5, probability72h: 0.7 },
    candidates[0],
    NOW,
  );
  assert.equal(selected.audit.applied, true);
  assert.equal(selected.audit.weight, 0.2);

  const direct = contextualSignal({
    tweet_id: "direct-strong",
    signal_type: "teaser",
    is_reply: false,
    reply_context_text: null,
    teaser_strength: "strong",
    text: "The reset is coming Tuesday.",
  });
  const directCandidate = getTimedTeaserCandidates(
    getLocalRadarData({ calculationNow: NOW, recentTiboSignals: [direct] }),
    null,
    NOW,
  )[0];
  assert.ok(directCandidate);
  assert.equal(directCandidate.interpretation.probabilityTeaserEligible, true);
  assert.equal(
    applyTimedTeaserProbabilityReallocation(
      { probability12h: 0.2, probability24h: 0.3, probability48h: 0.5, probability72h: 0.7 },
      directCandidate,
      NOW,
    ).audit.applied,
    false,
  );
});
