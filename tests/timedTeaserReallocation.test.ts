import test from "node:test";
import assert from "node:assert/strict";

import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import {
  calculateSurvivalConditionedProbability,
  calculateSurvivalConditionedContextArms,
} from "../lib/radar/survivalConditionedProbability";
import type { ActiveOfficialNotice } from "../lib/radar/probability";
import {
  applyTimedTeaserProbabilityReallocation,
  getTimedTeaserReallocationWeight,
  getTimedTeaserCandidates,
} from "../lib/radar/timedTeaserProbability";
import { interpretTiboSignal } from "../lib/radar/teaserStrength";
import { getTiboReadSideSignals } from "../lib/radar/tiboLogicalProjection";
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

function survivalData(
  signals: ActiveTiboSignal[] = [],
  timedTiboSignals: ActiveTiboSignal[] = [],
) {
  return getLocalRadarData({
    calculationNow: NOW,
    recentTiboSignals: signals,
    timedTiboSignals,
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

test("manual confirmed cryptic reply teasers keep their resolved timed policy", () => {
  const signal = contextualSignal({
    tweet_id: "manual-cryptic-reply",
    text: "3am on a tuesday",
    signal_type: "teaser",
    confidence: 1,
    classification_source: "manual",
    verification_status: "confirmed",
    teaser_strength: "strong",
    temporal_precision: "exact_time",
    expected_start_at: "2026-09-22T10:00:00.000Z",
    expected_end_at: "2026-09-22T10:00:00.000Z",
  });
  const interpretation = interpretTiboSignal(signal, NOW);

  assert.equal(interpretation.presentationDisposition, "strong_teaser");
  assert.equal(interpretation.officialNoticeEligible, false);
  assert.equal(interpretation.probabilityTeaserEligible, false);
  assert.equal(interpretation.timedProbabilityEligible, true);
  assert.equal(interpretation.historyEligible, false);
  assert.equal(interpretation.contextDependence, "reply_context");
  assert.deepEqual(getTimedTeaserReallocationWeight(interpretation), {
    timedEvidenceClass: "strong_contextual",
    reallocationWeight: 0.4,
  });

  const snapshot = toPublicRadarSnapshot(survivalData([signal]), "ja", {
    calculationNow: NOW,
  });
  assert.equal(snapshot.resetTeaserStatus, "strong");
  assert.equal(snapshot.latestTiboActivity?.classification, "teaser");
  assert.equal(snapshot.latestTiboActivity?.teaserStrength, "strong");
  assert.equal(snapshot.latestTiboActivity?.isReply, true);
  assert.equal(snapshot.latestTiboActivity?.temporalResolutionStatus, "resolved");
  assert.equal(snapshot.latestTiboActivity?.expectedStartAt, "2026-09-22T10:00:00.000Z");
  assert.equal(snapshot.latestTiboActivity?.expectedEndAt, "2026-09-22T10:00:00.000Z");
});

test("stored strong contextual replies remain eligible for the timed policy", () => {
  const signal = contextualSignal({ teaser_strength: "strong" });
  const interpretation = interpretTiboSignal(signal, NOW);
  assert.equal(interpretation.presentationDisposition, "strong_teaser");
  assert.equal(interpretation.timedProbabilityEligible, true);
  assert.deepEqual(getTimedTeaserReallocationWeight(interpretation), {
    timedEvidenceClass: "strong_contextual",
    reallocationWeight: 0.4,
  });
  const baseline = calculate();
  const adjusted = calculate([signal]);
  assert.equal(adjusted.survival.timedTeaserReallocation?.applied, true);
  assert.ok(adjusted.predictions.probability24h < baseline.predictions.probability24h);
});

test("timed evidence weight is derived from the shared interpretation", () => {
  const contextual = interpretTiboSignal(contextualSignal(), NOW);
  assert.deepEqual(getTimedTeaserReallocationWeight(contextual), {
    timedEvidenceClass: "strong_contextual",
    reallocationWeight: 0.4,
  });

  const direct = interpretTiboSignal(contextualSignal({
    signal_type: "teaser",
    is_reply: false,
    reply_context_text: null,
    teaser_strength: "strong",
    text: "The reset is coming Tuesday.",
  }), NOW);
  assert.deepEqual(getTimedTeaserReallocationWeight(direct), {
    timedEvidenceClass: "strong_direct",
    reallocationWeight: 0.5,
  });

  const weak = interpretTiboSignal(contextualSignal({
    teaser_strength: "weak",
    text: "Maybe tomorrow.",
  }), NOW);
  assert.equal(getTimedTeaserReallocationWeight(weak), null);
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
  assert.equal(adjusted.survival.timedTeaserReallocation?.timedEvidenceClass, "strong_contextual");
  assert.equal(adjusted.survival.timedTeaserReallocation?.reallocationWeight, 0.4);
  assert.equal(adjusted.survival.timedTeaserReallocation?.policyVersion, "teaser-temporal-reallocation-v2");
  const timedAudit = adjusted.survival.timedTeaserReallocation;
  assert.ok(timedAudit?.cdf);
  assert.equal(timedAudit.cdf.probability48h, 0);
  assert.ok(timedAudit.cdf.probability72h > 0);
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

test("window-before horizons use the exact contextual 0.6 baseline mixture", () => {
  const base = {
    probability12h: 0.2,
    probability24h: 0.3,
    probability48h: 0.5,
    probability72h: 0.7,
  };
  const candidate = getTimedTeaserCandidates(
    getLocalRadarData({ calculationNow: NOW, recentTiboSignals: [contextualSignal()] }),
    null,
    NOW,
  )[0];
  assert.ok(candidate);

  const result = applyTimedTeaserProbabilityReallocation(base, candidate, NOW);
  assert.equal(result.audit.reallocationWeight, 0.4);
  assert.deepEqual(result.predictions, {
    probability12h: 0.12,
    probability24h: 0.18,
    probability48h: 0.3,
    probability72h: result.predictions.probability72h,
  });
  assert.ok(result.predictions.probability72h > result.predictions.probability48h);
});

test("the current pre-window target is lower than the former 0.2 policy on one snapshot", () => {
  const base = {
    probability12h: 0.23258,
    probability24h: 0.39248,
    probability48h: 0.69465,
    probability72h: 0.88994,
  };
  const candidate = getTimedTeaserCandidates(
    getLocalRadarData({ calculationNow: NOW, recentTiboSignals: [contextualSignal()] }),
    null,
    NOW,
  )[0];
  assert.ok(candidate);

  const adjusted = applyTimedTeaserProbabilityReallocation(base, candidate, NOW).predictions;
  const formerPolicy = [base.probability12h, base.probability24h, base.probability48h]
    .map((value) => value * 0.8);
  assert.ok(adjusted.probability12h < formerPolicy[0]);
  assert.ok(adjusted.probability24h < formerPolicy[1]);
  assert.ok(adjusted.probability48h < formerPolicy[2]);
  assert.ok(adjusted.probability72h > adjusted.probability48h);
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

test("resolved timed teasers remain eligible after the former 48-hour tweet lookback", () => {
  const oldSignal = contextualSignal({
    tweet_id: "old-but-unexpired-timed",
    tweet_created_at: "2026-09-18T00:00:00.000Z",
    teaser_strength: "strong",
  });
  const lateNow = new Date("2026-09-20T12:00:00.000Z");
  const candidate = getTimedTeaserCandidates(
    getLocalRadarData({ calculationNow: lateNow, recentTiboSignals: [oldSignal] }),
    null,
    lateNow,
  )[0];

  assert.ok(lateNow.getTime() - Date.parse(oldSignal.tweet_created_at) > 48 * 60 * 60 * 1000);
  assert.ok(candidate);
  assert.equal(candidate.signal.tweet_id, oldSignal.tweet_id);
});

test("unresolved timed evidence keeps the existing 48-hour lookback", () => {
  const oldSignal = contextualSignal({
    tweet_id: "old-unresolved-timed",
    tweet_created_at: "2026-09-18T00:00:00.000Z",
    temporal_resolution_status: "unresolved",
    expected_start_at: null,
    expected_end_at: null,
    teaser_strength: "strong",
  });
  const lateNow = new Date("2026-09-20T12:00:00.000Z");

  assert.equal(
    getTimedTeaserCandidates(
      getLocalRadarData({ calculationNow: lateNow, recentTiboSignals: [oldSignal] }),
      null,
      lateNow,
    )[0] ?? null,
    null,
  );
});

test("resolved timed teasers expire by their temporal CDF rather than tweet age", () => {
  const signal = contextualSignal({
    tweet_id: "resolved-window-expiry",
    tweet_created_at: "2026-09-18T00:00:00.000Z",
  });
  const afterWindow = new Date("2026-09-23T08:00:00.000Z");
  const candidate = getTimedTeaserCandidates(
    getLocalRadarData({ calculationNow: afterWindow, recentTiboSignals: [signal] }),
    null,
    afterWindow,
  )[0] ?? null;

  assert.equal(candidate, null);
});

test("resolved timed teasers outside the 72-hour horizon do not become candidates", () => {
  const farFuture = contextualSignal({
    tweet_id: "resolved-far-future",
    tweet_created_at: "2026-09-19T07:00:00.000Z",
    expected_start_at: "2026-09-25T07:00:00.000Z",
    expected_end_at: "2026-09-26T07:00:00.000Z",
  });
  const candidate = getTimedTeaserCandidates(
    getLocalRadarData({ calculationNow: NOW, recentTiboSignals: [farFuture] }),
    null,
    NOW,
  )[0] ?? null;

  assert.equal(candidate, null);
});

test("the narrow timed read-side projection participates without widening recent signals", () => {
  const timedOnly = contextualSignal({
    tweet_id: "timed-only-projection",
    tweet_created_at: "2026-09-18T00:00:00.000Z",
  });
  const candidate = getTimedTeaserCandidates(
    survivalData([], [timedOnly]),
    null,
    NOW,
  )[0];

  assert.ok(candidate);
  assert.equal(candidate.signal.tweet_id, timedOnly.tweet_id);
  assert.equal(
    getTiboReadSideSignals(survivalData([], [timedOnly]), "all")
      .some((signal) => signal.tweet_id === timedOnly.tweet_id),
    false,
  );
});

test("the timed overlay is applied to every Survival context arm", () => {
  const staticHistory = frozenSupportShapeSurvivalStaticHistory();
  const baselineArms = calculateSurvivalConditionedContextArms(
    survivalData(),
    { now: NOW, staticHistory },
  );
  const timedArms = calculateSurvivalConditionedContextArms(
    survivalData([contextualSignal()]),
    { now: NOW, staticHistory },
  );

  for (const modelVersion of Object.keys(baselineArms)) {
    const baseline = baselineArms[modelVersion];
    const timed = timedArms[modelVersion];
    assert.ok(baseline);
    assert.ok(timed);
    assert.ok(timed.predictions.probability24h < baseline.predictions.probability24h);
    assert.equal(timed.base.survival.timedTeaserReallocation?.applied, true);
  }
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

test("weak contextual teasers keep the probability unchanged", () => {
  const weak = contextualSignal({
    tweet_id: "weak-contextual",
    teaser_strength: "weak",
    text: "Maybe tomorrow.",
  });
  const baseline = calculate();
  const result = calculate([weak]);
  assert.deepEqual(result.predictions, baseline.predictions);
  assert.equal(result.survival.timedTeaserReallocation, null);
});

test("multiple timed candidates are represented once and direct strong teasers get the stronger timed policy", () => {
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
  assert.equal(selected.audit.timedEvidenceClass, "strong_contextual");
  assert.equal(selected.audit.reallocationWeight, 0.4);

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
    true,
  );
  const directResult = applyTimedTeaserProbabilityReallocation(
    { probability12h: 0.2, probability24h: 0.3, probability48h: 0.5, probability72h: 0.7 },
    directCandidate,
    NOW,
  );
  assert.equal(directResult.audit.timedEvidenceClass, "strong_direct");
  assert.equal(directResult.audit.reallocationWeight, 0.5);
});

test("direct strong timed teasers use one reallocation policy without ordinary double counting", () => {
  const direct = contextualSignal({
    tweet_id: "direct-active-strong",
    signal_type: "teaser",
    is_reply: false,
    reply_context_text: null,
    teaser_strength: "strong",
    text: "The reset is coming Tuesday.",
  });
  const baseData = getLocalRadarData({ calculationNow: NOW });
  const directData = getLocalRadarData({
    calculationNow: NOW,
    activeTiboSignals: [direct],
    recentTiboSignals: [direct],
  });
  const base = calculateSurvivalConditionedProbability(baseData, {
    now: NOW,
    staticHistory: frozenSupportShapeSurvivalStaticHistory(),
  });
  const directResult = calculateSurvivalConditionedProbability(directData, {
    now: NOW,
    staticHistory: frozenSupportShapeSurvivalStaticHistory(),
  });
  const candidate = getTimedTeaserCandidates(directData, null, NOW)[0];
  assert.ok(candidate);
  assert.equal(candidate.interpretation.contextDependence, "direct");

  const expected = applyTimedTeaserProbabilityReallocation(
    base.predictions,
    candidate,
    NOW,
  );
  assert.deepEqual(directResult.predictions, expected.predictions);
  assert.equal(directResult.survival.timedTeaserReallocation?.timedEvidenceClass, "strong_direct");
  assert.equal(directResult.survival.timedTeaserReallocation?.reallocationWeight, 0.5);
});

test("direct strong timed teasers require confidence at the automatic 0.80 boundary", () => {
  const direct = (confidence: number | null, strength: "strong" | "weak" = "strong") =>
    contextualSignal({
      signal_type: "teaser",
      is_reply: false,
      is_quote: false,
      reply_context_text: null,
      teaser_strength: strength,
      confidence: confidence ?? undefined,
      text: "The reset is coming Tuesday.",
    });

  assert.equal(interpretTiboSignal(direct(0.95), NOW).timedProbabilityEligible, true);
  assert.equal(interpretTiboSignal(direct(0.8), NOW).timedProbabilityEligible, true);
  assert.equal(interpretTiboSignal(direct(0.79), NOW).timedProbabilityEligible, false);
  assert.equal(interpretTiboSignal(direct(null), NOW).timedProbabilityEligible, false);
  assert.equal(interpretTiboSignal(direct(0.95, "weak"), NOW).timedProbabilityEligible, false);
});

test("validated manual direct strong override is not rejected solely for missing source confidence", () => {
  const signal = contextualSignal({
    signal_type: "teaser",
    is_reply: false,
    is_quote: false,
    reply_context_text: null,
    teaser_strength: "strong",
    confidence: undefined,
    classification_source: "manual",
    text: "The reset is coming Tuesday.",
  });

  assert.equal(interpretTiboSignal(signal, NOW).timedProbabilityEligible, true);
});
