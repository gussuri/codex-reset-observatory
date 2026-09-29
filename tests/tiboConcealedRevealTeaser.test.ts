import assert from "node:assert/strict";
import test from "node:test";
import scenariosJson from "./fixtures/tibo-scenarios.json";
import { classifyTiboTweet, getTiboClassificationSafetyDecision } from "../lib/radar/classification";
import { applyTiboClassificationSafetyGuard, TIBO_GEMINI_SYSTEM_PROMPT, type GeminiClassificationOutput } from "../lib/radar/geminiClassification";
import { getTiboContextSafetyDecision } from "../lib/radar/tiboContextSafety";
import {
  applyTimedTeaserProbabilityReallocation,
  getTimedTeaserCandidates,
  getTimedTeaserReallocationWeight,
} from "../lib/radar/timedTeaserProbability";
import { parseTiboTemporalSemantics, resolveTiboTemporalSchedule, TIBO_SOURCE_TIME_ZONE } from "../lib/radar/tiboTemporal";
import { calculateSurvivalConditionedProbability } from "../lib/radar/survivalConditionedProbability";
import { selectTiboClassification } from "../lib/radar/tiboClassificationMode";
import { runTiboScenario, type TiboScenario, type TiboScenarioFixture } from "./tiboScenarioSupport";

const targetText = "That was yesterday, today is DevDay. And it's all good news. I'm surprised we've kept it all under wraps.";
const targetUrl = "https://x.com/thsottiaux/status/2104838506363408740";
const concealedCases = (scenariosJson as TiboScenarioFixture).scenarios.filter(
  (scenario) => scenario.regressionGroup === "concealed-imminent-release-teaser",
);

test("Gemini prompt allows only a combined near-term product reveal teaser without explicit reset wording", () => {
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /not require an explicit usage-reset word/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /near-term OpenAI\/Codex event, product, subscription, or usage announcement/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /deliberately concealed/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /combined evidence/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /ordinary feature or release announcements? alone remain irrelevant/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /good news alone is not enough/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /implicit teasers, keep confidence moderate \(0\.80-0\.90\)/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /For an accepted teaser, also extract/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /hinted or concealed event/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /not a reset commitment/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /do not let an unrelated historical passage/i);
});

test("an incidental yesterday reference does not suppress the strong DevDay teaser from Gemini", () => {
  const rule = classifyTiboTweet(targetText, targetUrl, { isReply: false, isQuote: false });
  assert.equal(rule.signalType, "irrelevant", "deterministic fallback must not hard-code release phrases");

  const modelResult: GeminiClassificationOutput = {
    signalType: "teaser",
    confidence: 0.85,
    temporalDirection: "unclear",
    evidenceQuote: "all good news",
    reasonJa: "A near-term OpenAI event and deliberately concealed announcement make a reset plausible as a teaser, not a commitment.",
    resetTypeJa: null,
    noticeToExecution: null,
    teaserStrength: "strong",
    teaserStrengthConfidence: 0.85,
    teaserStrengthEvidenceQuote: "kept it all under wraps",
    teaserStrengthReasonJa: "The imminent event and strong concealment cue combine into an indirect hint.",
    model: "test-model",
    status: "success",
    classifiedAt: "2026-09-29T00:00:00.000Z",
  };

  const safety = getTiboClassificationSafetyDecision(targetText, "teaser");
  assert.equal(safety.signalType, "teaser");
  assert.equal(safety.suppressTeaserStrength, false);
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: targetText,
      selectedSignalType: "teaser",
      aiTeaserStrength: "strong",
    }),
    null,
  );

  const guarded = applyTiboClassificationSafetyGuard(targetText, modelResult);
  assert.equal(guarded.signalType, "teaser");
  assert.equal(guarded.teaserStrength, "strong");
  assert.equal(guarded.confidence, 0.85);

  const selected = selectTiboClassification("primary", rule, guarded);
  assert.equal(selected.signalType, "teaser");
  assert.equal(selected.classificationSource, "gemini");
});

test("indirect announcement and negative controls keep their fixture expectations through the offline pipeline", () => {
  assert.equal(concealedCases.length, 12);

  for (const scenario of concealedCases) {
    const run = runTiboScenario(scenario);
    assert.equal(run.ruleResult.signalType, "irrelevant", `${scenario.id}: rules stay narrow`);
    assert.equal(run.selected.signalType, scenario.expected.signalType, scenario.id);
    assert.equal(run.teaserStatus, scenario.expected.teaserStrength ?? "none", scenario.id);
    assert.equal(run.publicSnapshot.viewModel.activeWindow.active, false, scenario.id);
    assert.equal(run.formalAccepted, false, `${scenario.id}: teaser/irrelevant is not reset history`);
    if (scenario.expected.signalType === "irrelevant") {
      assert.equal(run.temporalResolution, null, `${scenario.id}: event timing alone is not a reset teaser window`);
    }
  }
});

test("today attached to an unrelated event does not retime a historical reset", () => {
  const scenario = {
    id: "historical-reset-unrelated-event-day",
    category: "multiple_events",
    description: "A historical reset and a separate event date stay separate.",
    tweetText: "Yesterday we reset everyone. DevDay is today.",
    tweetCreatedAt: "2026-09-29T00:00:00.000Z",
    tweetUrl: "https://x.com/thsottiaux/status/910000000000001200",
    pipeline: true,
    expected: {
      signalType: "irrelevant",
      temporalDirection: "historical",
      teaserStrength: "none",
      shouldCreateActiveNotice: false,
      shouldCreateTeaser: false,
      shouldCreateResetHistoryEvent: false,
      shouldRemainActive: false,
    },
    mockGeminiOutput: {
      signalType: "irrelevant",
      confidence: 0.98,
      temporalDirection: "historical",
      evidenceQuote: "Yesterday we reset everyone",
      teaserStrength: "none",
      temporalExpression: "today",
      temporalKind: "relative_day",
      temporalPrecision: "day",
      relativeDayOffset: 0,
      temporalConfidence: 0.9,
    },
  } satisfies TiboScenario;

  const run = runTiboScenario(scenario);
  assert.equal(run.selected.signalType, "irrelevant");
  assert.equal(run.temporalResolution, null);
  assert.equal(
    getTimedTeaserCandidates(run.radarData, null, run.now)
      .some((candidate) => candidate.signal.tweet_id === "910000000000001200"),
    false,
  );
});

test("the accepted mixed-timeline strong teaser resolves its own today window and reaches timed reallocation", () => {
  const scenario = concealedCases.find((candidate) => candidate.id === "prod-concealed-devday-teaser");
  assert.ok(scenario);

  const run = runTiboScenario(scenario);
  assert.equal(run.selected.signalType, "teaser");
  assert.equal(run.teaserStatus, "strong");
  assert.equal(run.geminiResult?.temporalDirection, "unclear");
  assert.equal(run.geminiResult?.temporalExpression, "today");
  assert.equal(run.geminiResult?.temporalKind, "relative_day");
  assert.equal(run.geminiResult?.temporalPrecision, "day");
  assert.equal(run.temporalResolution?.status, "resolved");
  assert.equal(run.temporalResolution?.timezone, TIBO_SOURCE_TIME_ZONE);
  assert.equal(run.temporalResolution?.expectedStartAt, scenario.expected.expectedStartAt);
  assert.equal(run.temporalResolution?.expectedEndAt, scenario.expected.expectedEndAt);
  assert.ok(run.temporalResolution?.expectedStartAt);
  assert.ok(run.temporalResolution?.expectedEndAt);
  assert.equal(run.formalAccepted, false);
  assert.equal(run.historyEvent, null);

  const candidate = getTimedTeaserCandidates(run.radarData, null, run.now)
    .find((entry) => entry.signal.tweet_id === "2104838506363408740");
  assert.ok(candidate, "the teaser should enter the existing timed candidate path");
  assert.deepEqual(getTimedTeaserReallocationWeight(candidate.interpretation), {
    timedEvidenceClass: "strong_direct",
    reallocationWeight: 0.5,
  });

  const reallocation = applyTimedTeaserProbabilityReallocation({
    probability12h: 0.2,
    probability24h: 0.35,
    probability48h: 0.6,
    probability72h: 0.8,
  }, candidate, run.now);
  assert.equal(reallocation.audit.applied, true);
  assert.equal(reallocation.audit.timedEvidenceClass, "strong_direct");
  assert.equal(reallocation.audit.reallocationWeight, 0.5);
  assert.ok((reallocation.audit.cdf?.probability24h ?? 0) > 0);
  assert.ok(reallocation.predictions.probability24h > 0.35);

  const unresolvedScenario: TiboScenario = {
    ...scenario,
    expected: {
      ...scenario.expected,
      temporalResolutionStatus: undefined,
      temporalPrecision: undefined,
    },
    mockGeminiOutput: {
      ...scenario.mockGeminiOutput,
      temporalExpression: null,
      temporalKind: "none",
      temporalPrecision: "unknown",
      relativeDayOffset: null,
      temporalConfidence: 0,
    },
  };
  const unresolved = runTiboScenario(unresolvedScenario, run.now);
  const resolvedSurvival = calculateSurvivalConditionedProbability(run.radarData, { now: run.now });
  const unresolvedSurvival = calculateSurvivalConditionedProbability(unresolved.radarData, { now: run.now });
  const appliedAudit = resolvedSurvival.survival.timedTeaserReallocation;
  assert.equal(appliedAudit?.applied, true);
  assert.equal(appliedAudit?.timedEvidenceClass, "strong_direct");
  assert.equal(appliedAudit?.reallocationWeight, 0.5);
  assert.equal(appliedAudit?.cdf?.probability24h, 1);
  assert.equal(appliedAudit?.cdf?.probability48h, 1);
  assert.ok(
    resolvedSurvival.predictions.probability24h > unresolvedSurvival.predictions.probability24h,
    "the Survival-conditioned prediction should reflect the resolved timed teaser over the same unresolved baseline",
  );
});

test("accepted Codex teasers bind today and tomorrow to the hinted reveal rather than an earlier clause", () => {
  const cases = [
    {
      id: "accepted-codex-teaser-today",
      text: "Yesterday was quiet. Big surprise for Codex today. We've kept it secret.",
      expression: "today",
      kind: "relative_day" as const,
      precision: "day" as const,
      expectedOffset: 0,
    },
    {
      id: "accepted-codex-teaser-tomorrow",
      text: "Big surprise tomorrow for Codex. We've kept it under wraps.",
      expression: "tomorrow",
      kind: "relative_day" as const,
      precision: "day" as const,
      expectedOffset: 1,
    },
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index]!;
    const scenario: TiboScenario = {
      id: item.id,
      category: "indirect_release_teaser",
      description: "An accepted teaser has an explicit temporal anchor for its own hinted event.",
      tweetText: item.text,
      tweetCreatedAt: "2026-09-29T16:00:00.000Z",
      tweetUrl: `https://x.com/thsottiaux/status/91000000000000120${index}`,
      pipeline: true,
      expected: {
        signalType: "teaser",
        temporalDirection: "unclear",
        teaserStrength: "strong",
        temporalResolutionStatus: "resolved",
        temporalPrecision: item.precision,
      },
      mockGeminiOutput: {
        signalType: "teaser",
        confidence: 0.85,
        temporalDirection: "unclear",
        evidenceQuote: item.text,
        teaserStrength: "strong",
        teaserStrengthConfidence: 0.85,
        teaserStrengthEvidenceQuote: item.text,
        temporalExpression: item.expression,
        temporalKind: item.kind,
        temporalPrecision: item.precision,
        relativeDayOffset: item.expectedOffset,
        temporalConfidence: 0.9,
      },
    };
    const run = runTiboScenario(scenario);
    assert.equal(run.selected.signalType, "teaser", item.id);
    assert.equal(run.geminiResult?.temporalDirection, "unclear", item.id);
    assert.equal(run.temporalResolution?.status, "resolved", item.id);
    assert.equal(run.temporalResolution?.temporalExpression, item.expression, item.id);
    assert.equal(run.temporalResolution?.timezone, TIBO_SOURCE_TIME_ZONE, item.id);
    assert.ok(
      getTimedTeaserCandidates(run.radarData, null, run.now)
        .some((candidate) => candidate.signal.tweet_id === scenario.tweetUrl.match(/status\/(\d+)/)?.[1]),
      `${item.id}: accepted teaser should enter existing timed candidate path`,
    );
  }
});

test("teaser timing resolves explicit today, tomorrow, evening, weekday-clock, and relative-duration expressions", () => {
  const cases = [
    {
      text: "Yesterday was quiet. Big surprise for Codex today. We've kept it secret.",
      expression: "today",
      kind: "relative_day",
      precision: "day",
      temporal: { relativeDayOffset: 0 },
    },
    {
      text: "Big surprise tomorrow. We've kept it under wraps.",
      expression: "tomorrow",
      kind: "relative_day",
      precision: "day",
      temporal: { relativeDayOffset: 1 },
    },
    {
      text: "Big Codex reveal tonight. We've kept it secret.",
      expression: "tonight",
      kind: "daypart",
      precision: "daypart",
      temporal: { daypart: "tonight" },
    },
    {
      text: "Big Codex reveal next Tuesday at 3am. We've kept it secret.",
      expression: "next Tuesday at 3am",
      kind: "weekday",
      precision: "exact_time",
      temporal: { weekday: "tuesday", explicitTimeParts: { hour: 3, minute: 0 } },
    },
    {
      text: "Big Codex reveal next week. We've kept it secret.",
      expression: "next week",
      kind: "range",
      precision: "range",
      temporal: { rangeKind: "next_week" },
    },
    {
      text: "Big Codex surprise in 2 hours. We've kept it secret.",
      expression: "in 2 hours",
      kind: "relative_duration",
      precision: "exact_time",
      temporal: { relativeAmount: 2, relativeUnit: "hours" },
    },
  ] as const;

  for (const item of cases) {
    const raw = {
      signalType: "teaser",
      confidence: 0.85,
      temporalDirection: "unclear",
      temporalExpression: item.expression,
      temporalKind: item.kind,
      temporalPrecision: item.precision,
      temporalConfidence: 0.9,
      ...item.temporal,
    };
    const semantics = parseTiboTemporalSemantics(raw, item.text);
    assert.ok(semantics, item.expression);
    assert.equal(semantics.temporalExpression, item.expression);
    const resolved = resolveTiboTemporalSchedule(semantics, "2026-09-29T00:00:00.000Z", TIBO_SOURCE_TIME_ZONE);
    assert.equal(resolved.status, "resolved", item.expression);
    assert.equal(resolved.timezone, TIBO_SOURCE_TIME_ZONE, item.expression);
  }
});

test("explicit reset negation and technical database reset still suppress a model teaser", () => {
  const controls = [
    {
      text: "No reset today. DevDay will be fun.",
      url: "https://x.com/thsottiaux/status/910000000000001112",
    },
    {
      text: "No reset tomorrow, but DevDay will be fun.",
      url: "https://x.com/thsottiaux/status/910000000000001108",
    },
    {
      text: "Reset the test database before tomorrow's launch.",
      url: "https://x.com/thsottiaux/status/910000000000001109",
    },
  ];

  for (const control of controls) {
    const candidate: GeminiClassificationOutput = {
      signalType: "teaser",
      confidence: 0.85,
      temporalDirection: "future",
      evidenceQuote: control.text,
      reasonJa: "simulated model candidate",
      resetTypeJa: null,
      noticeToExecution: null,
      teaserStrength: "strong",
      teaserStrengthConfidence: 0.85,
      teaserStrengthEvidenceQuote: control.text,
      teaserStrengthReasonJa: "simulated model candidate",
      model: "test-model",
      status: "success",
      classifiedAt: "2026-09-29T00:00:00.000Z",
    };

    const guarded = applyTiboClassificationSafetyGuard(control.text, candidate);
    assert.equal(guarded.signalType, "irrelevant", control.text);
    assert.equal(guarded.teaserStrength, "none", control.text);
  }
});
