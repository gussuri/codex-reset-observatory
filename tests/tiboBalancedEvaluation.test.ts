import test from "node:test";
import assert from "node:assert/strict";
import balancedJson from "./fixtures/tibo-classification-balanced-v1.json";
import {
  buildFixedGeminiOutput,
  type TiboScenario,
  type TiboScenarioExpected,
  runTiboScenarioPipeline,
} from "./tiboScenarioSupport";
import {
  calculateScenarioMetrics,
  canStartEvaluationRequest,
  getClassificationFailureStage,
  isScenarioResumeEligible,
  measureScenarioPromptSize,
  requestBudgetForBatch,
  type ScenarioEvaluationRow,
} from "../scripts/evaluate-tibo-scenarios";
import { TIBO_GEMINI_SYSTEM_PROMPT } from "../lib/radar/geminiClassification";

type BalancedExpected = TiboScenarioExpected & {
  resetMeaningMethod?: string;
  resetMeaningScope?: string;
};

type BalancedScenario = TiboScenario & {
  expected: BalancedExpected;
};

type BalancedFixture = {
  schemaVersion: number;
  fixtureId: string;
  evaluationScope: string;
  sourceEvidence: {
    tweetId: string;
    tweetUrl: string;
    tweetCreatedAtDatabaseValue: string;
  };
  scenarios: BalancedScenario[];
};

const fixture = balancedJson as BalancedFixture;
const scenarios = fixture.scenarios;
const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

test("balanced development fixture has sixteen evenly distributed cases", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.fixtureId, "tibo-classification-balanced-v1");
  assert.equal(scenarios.length, 16);

  const classCounts = scenarios.reduce<Record<string, number>>((counts, scenario) => {
    counts[scenario.expected.signalType!] = (counts[scenario.expected.signalType!] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(classCounts, {
    official_notice: 4,
    reset_executed: 4,
    teaser: 4,
    irrelevant: 4,
  });

  const ids = new Set(scenarios.map((scenario) => scenario.id));
  assert.equal(ids.size, 16);
  assert.match(fixture.evaluationScope, /not a holdout/i);
});

test("production credit-compensation post keeps its exact source identity, text, and timestamp", () => {
  const scenario = scenarioById.get("balanced-credit-compensation-source")!;
  assert.equal(scenario.tweetUrl, "https://x.com/thsottiaux/status/2112592264686149749");
  assert.equal(scenario.tweetCreatedAt, "2026-10-20T17:10:20.000Z");
  assert.equal(scenario.tweetText, "There were reports of usage draining faster than anticipated for some users over the weekend. We've identified approximately 40,000 accounts that had an inconsistency on which usage limits where the actual usage that was applied did not correspond to their actual selected plan. We are reaching out individually to all these users and have corrected the issue. If this affected you, we'll add credits to your account. Sorry we got this wrong.");
  assert.equal(fixture.sourceEvidence.tweetId, "2112592264686149749");
  assert.equal(fixture.sourceEvidence.tweetCreatedAtDatabaseValue, "2026-10-20 17:10:20+00");

  const pipeline = runTiboScenarioPipeline(scenario, buildFixedGeminiOutput(scenario));
  assert.equal(pipeline.effectiveSignalType, "irrelevant");
  assert.equal(pipeline.effectiveTeaserStrength, "none");
  assert.equal(pipeline.formalAccepted, false);
  assert.equal(pipeline.historyEvent, null);
});

test("scope and reset method are independent gold dimensions", () => {
  const banked = scenarioById.get("balanced-banked-distribution")!;
  const partial = scenarioById.get("balanced-reset-affected-users-forced")!;
  const global = scenarioById.get("balanced-reset-all-paid-forced")!;
  const credits = scenarioById.get("balanced-credit-compensation-source")!;

  assert.deepEqual(
    [banked.expected.resetMeaningMethod, banked.expected.resetMeaningScope],
    ["banked_distribution", "affected_users"],
  );
  assert.deepEqual(
    [partial.expected.resetMeaningMethod, partial.expected.resetMeaningScope],
    ["forced", "affected_users"],
  );
  assert.deepEqual(
    [global.expected.resetMeaningMethod, global.expected.resetMeaningScope],
    ["forced", "all_paid_users"],
  );
  assert.deepEqual(
    [credits.expected.resetMeaningMethod, credits.expected.resetMeaningScope],
    ["unknown", "unknown"],
  );

  assert.deepEqual(buildFixedGeminiOutput(banked).resetMeaning, banked.mockGeminiOutput!.resetMeaning);
  assert.deepEqual(buildFixedGeminiOutput(partial).resetMeaning, partial.mockGeminiOutput!.resetMeaning);
  assert.deepEqual(buildFixedGeminiOutput(global).resetMeaning, global.mockGeminiOutput!.resetMeaning);
});

test("live evaluation scores method and scope separately from class accuracy", () => {
  const rows = scenarios
    .filter((scenario) => scenario.expected.noticeTimingStatus || scenario.expected.resetMeaningMethod || scenario.expected.resetMeaningScope)
    .map((scenario) => {
      const output = buildFixedGeminiOutput(scenario);
      return {
        id: scenario.id,
        category: scenario.category,
        ambiguous: false,
        expectedSignalType: scenario.expected.signalType ?? "irrelevant",
        expectedNoticeTimingStatus: scenario.expected.noticeTimingStatus,
        expectedResetMeaningMethod: scenario.expected.resetMeaningMethod,
        expectedResetMeaningScope: scenario.expected.resetMeaningScope,
        predictedSignalType: output.signalType,
        status: "success",
        modelOutputNoticeTimingStatus: output.noticeTimingStatus ?? null,
        modelOutputResetMeaningMethod: output.resetMeaning?.method ?? null,
        modelOutputResetMeaningScope: output.resetMeaning?.scope ?? null,
      } as unknown as ScenarioEvaluationRow;
    });
  const metrics = calculateScenarioMetrics(rows);

  assert.equal(metrics.noticeTimingStatusAccuracy, 1);
  assert.equal(metrics.resetMeaningMethodAccuracy, 1);
  assert.equal(metrics.resetMeaningScopeAccuracy, 1);
});

test("the same short reply changes meaning with its parent and graph context", () => {
  const creditReply = scenarioById.get("balanced-reply-credit-compensation")!;
  const forcedReply = scenarioById.get("balanced-reply-forced-reset")!;
  assert.equal(creditReply.tweetText, forcedReply.tweetText);
  assert.notEqual(creditReply.replyContextText, forcedReply.replyContextText);
  assert.ok(forcedReply.validatedSourceContext);

  const creditRun = runTiboScenarioPipeline(creditReply, buildFixedGeminiOutput(creditReply));
  const forcedRun = runTiboScenarioPipeline(forcedReply, buildFixedGeminiOutput(forcedReply));
  assert.equal(creditRun.effectiveSignalType, "irrelevant");
  assert.equal(forcedRun.effectiveSignalType, "reset_executed");
  assert.equal(forcedRun.formalAccepted, false, "a short reply still needs formal reply-admission proof");
});

test("mocked pipeline expectations are labeled and tested separately from live model metrics", () => {
  for (const scenario of scenarios) {
    const mockedOutput = buildFixedGeminiOutput(scenario);
    const pipeline = runTiboScenarioPipeline(scenario, mockedOutput);
    assert.equal(pipeline.effectiveSignalType, scenario.expected.signalType, scenario.id);
    if (scenario.expected.teaserStrength) {
      assert.equal(pipeline.effectiveTeaserStrength, scenario.expected.teaserStrength, scenario.id);
    }
    if (scenario.expected.shouldCreateResetHistoryEvent !== undefined) {
      assert.equal(pipeline.formalAccepted, scenario.expected.shouldCreateResetHistoryEvent, scenario.id);
    }
    if (scenario.expected.resetMeaningMethod) {
      assert.equal(mockedOutput.resetMeaning?.method, scenario.expected.resetMeaningMethod, scenario.id);
    }
    if (scenario.expected.resetMeaningScope) {
      assert.equal(mockedOutput.resetMeaning?.scope, scenario.expected.resetMeaningScope, scenario.id);
    }
  }
});

test("prompt measurement reports current system and user parts with and without graph context", () => {
  const forcedReply = scenarioById.get("balanced-reply-forced-reset")!;
  const noGraphReply = scenarioById.get("balanced-reply-credit-compensation")!;
  const graphMeasurements = measureScenarioPromptSize(forcedReply);
  const noGraphMeasurements = measureScenarioPromptSize(noGraphReply);

  assert.equal(graphMeasurements.systemPromptChars, TIBO_GEMINI_SYSTEM_PROMPT.length);
  assert.equal(graphMeasurements.graphInputIncluded, true);
  assert.ok(graphMeasurements.userPromptCharsWithGraph > graphMeasurements.userPromptCharsWithoutGraph);
  assert.equal(noGraphMeasurements.graphInputIncluded, false);
  assert.equal(noGraphMeasurements.userPromptCharsWithGraph, noGraphMeasurements.userPromptCharsWithoutGraph);
  assert.equal(
    graphMeasurements.combinedPromptCharsWithGraph,
    graphMeasurements.systemPromptChars + graphMeasurements.userPromptCharsWithGraph,
  );
});

test("live evaluation budget is capped and counts each classifier invocation", () => {
  assert.equal(requestBudgetForBatch(undefined, 16), 16);
  assert.equal(requestBudgetForBatch(5, 16), 5);
  assert.throws(() => requestBudgetForBatch(17, 16), /maximum/i);
  assert.equal(canStartEvaluationRequest(15, 16), true);
  assert.equal(canStartEvaluationRequest(16, 16), false);
  assert.equal(canStartEvaluationRequest(1, 1), false);
});

test("resume reuses successful rows and gives transient failures at most one further invocation", () => {
  assert.equal(isScenarioResumeEligible({ status: "success", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({ status: "invalid_json", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({ status: "invalid_schema", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({ status: "invalid_evidence", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({ status: "api_error", attempts: 1 }), true);
  assert.equal(isScenarioResumeEligible({ status: "timeout", attempts: 1 }), true);
  assert.equal(isScenarioResumeEligible({ status: "rate_limited", attempts: 1 }), true);
  assert.equal(isScenarioResumeEligible({ status: "api_error", attempts: 2 }), false);
  assert.equal(isScenarioResumeEligible({ status: "api_error", attempts: 1, retrySuppressed: true }), false);
});

test("live result reporting separates transport, JSON, schema, and evidence failures", () => {
  assert.equal(getClassificationFailureStage("api_error"), "provider_api");
  assert.equal(getClassificationFailureStage("timeout"), "timeout");
  assert.equal(getClassificationFailureStage("rate_limited"), "rate_limit");
  assert.equal(getClassificationFailureStage("invalid_json"), "json_parse");
  assert.equal(getClassificationFailureStage("invalid_schema"), "schema_validation");
  assert.equal(getClassificationFailureStage("invalid_evidence"), "evidence_validation");
  assert.equal(getClassificationFailureStage("success"), "none");
});
