import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
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
  parseTiboGeminiPromptProfile,
  requestBudgetForBatch,
  runTiboScenarioEvaluation,
  type ScenarioEvaluationRow,
} from "../scripts/evaluate-tibo-scenarios";
import {
  TIBO_GEMINI_SYSTEM_PROMPT,
  TIBO_GEMINI_COMPACT_V1_SYSTEM_PROMPT,
  classifyWithGemini,
  type GeminiClassificationInput,
  type GeminiClassificationOutput,
} from "../lib/radar/geminiClassification";

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
  teaserStrengthGoldPolicy: string;
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

function createFakeClassifier(throwOnFirstCall = false) {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    classify: async (input: GeminiClassificationInput): Promise<GeminiClassificationOutput> => {
      callCount += 1;
      if (throwOnFirstCall && callCount === 1) throw new Error("simulated process interruption");
      const scenario = scenarios.find((item) => item.tweetText === input.text);
      assert.ok(scenario, "evaluation must pass the selected fixture scenario to the injected classifier");
      return buildFixedGeminiOutput(scenario);
    },
  };
}

function tempOutputDirectory() {
  return mkdtempSync(path.join(os.tmpdir(), "tibo-balanced-evaluation-"));
}

function evaluationDependencies(classifier: ReturnType<typeof createFakeClassifier>) {
  return {
    apiKey: "test-placeholder",
    model: "fake-gemini-model",
    classify: classifier.classify,
  };
}

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

test("official notice teaser-strength gold follows the independent prompt axis", () => {
  assert.match(fixture.teaserStrengthGoldPolicy, /independently/i);
  const exact = scenarioById.get("balanced-notice-exact-time")!;
  const unknown = scenarioById.get("balanced-notice-time-unknown")!;
  const tomorrow = scenarioById.get("balanced-notice-day-n")!;
  const weekday = scenarioById.get("balanced-notice-window")!;

  assert.equal(exact.expected.teaserStrength, "strong");
  assert.equal(tomorrow.expected.teaserStrength, "strong");
  assert.equal(weekday.expected.teaserStrength, "strong");
  assert.equal(Object.hasOwn(unknown.expected, "teaserStrength"), false);
  for (const scenario of [exact, unknown, tomorrow, weekday]) {
    assert.match((scenario as BalancedScenario & { goldingNote?: string }).goldingNote ?? "", /near-future|unscored/i);
  }
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
  assert.ok(creditReply.validatedSourceContext);
  for (const scenario of [creditReply, forcedReply]) {
    assert.equal(scenario.replyToHandles?.[0]?.toLowerCase(), `@${scenario.replyParentTweetUrl?.match(/https:\/\/x\.com\/([^/]+)/)?.[1]?.toLowerCase()}`);
    assert.equal(scenario.validatedSourceContext?.status, "complete");
    assert.deepEqual(
      scenario.validatedSourceContext?.target?.sourceContextRevisionHashes,
      scenario.sourceContextRevisionHashes,
    );
  }

  const creditRun = runTiboScenarioPipeline(creditReply, buildFixedGeminiOutput(creditReply));
  const forcedRun = runTiboScenarioPipeline(forcedReply, buildFixedGeminiOutput(forcedReply));
  assert.equal(creditRun.effectiveSignalType, "irrelevant");
  assert.equal(forcedRun.effectiveSignalType, "reset_executed");
  assert.equal(forcedRun.contextSafetyDecision, null);
  assert.equal(forcedRun.formalSignal.ai_confidence, 0.98);
  assert.equal(forcedRun.formalSignal.ai_temporal_direction, "completed_now");
  assert.equal(forcedRun.formalSignal.ai_evidence_quote, "Done.");
  assert.deepEqual(
    forcedRun.formalSignal.source_context_revision_hashes,
    forcedReply.sourceContextRevisionHashes,
  );
  assert.deepEqual(
    forcedRun.formalSignal.source_context_classified_revision_hashes,
    forcedReply.sourceContextClassifiedRevisionHashes,
  );
  assert.equal(forcedRun.formalSignal.source_context_generation, 1);
  assert.equal(forcedRun.formalAccepted, true, "a current proof over the complete verified reply graph admits the reset");
  assert.equal(forcedRun.historyEvent?.recordKind, "confirmed_global");
  assert.equal(creditRun.formalAccepted, false);
  assert.equal(creditRun.historyEvent, null);
});

test("reply-history proof fails closed for stale, missing, low-confidence, BANKED, and partial-scope inputs", () => {
  const forcedReply = scenarioById.get("balanced-reply-forced-reset")!;
  const output = buildFixedGeminiOutput(forcedReply);
  const stale = {
    ...forcedReply,
    sourceContextRevisionHashes: ["b".repeat(64)],
    sourceContextClassifiedRevisionHashes: ["b".repeat(64)],
  };
  const missing = { ...forcedReply, validatedSourceContext: null };
  const bankedOutput = {
    ...output,
    resetMeaning: { ...output.resetMeaning!, method: "banked_distribution" as const },
  };
  const partialScopeOutput = {
    ...output,
    resetMeaning: { ...output.resetMeaning!, scope: "affected_users" as const },
  };
  const cases = [
    ["stale revisions", stale, output],
    ["missing graph", missing, output],
    ["low confidence", forcedReply, { ...output, confidence: 0.94 }],
    ["BANKED method", forcedReply, bankedOutput],
    ["partial scope", forcedReply, partialScopeOutput],
  ] as const;

  for (const [label, scenario, geminiOutput] of cases) {
    const pipeline = runTiboScenarioPipeline(scenario, geminiOutput);
    assert.equal(pipeline.formalAccepted, false, label);
    assert.equal(pipeline.historyEvent, null, label);
  }
});

test("formal signal preserves read-side AI notice timing status", () => {
  const scenario = scenarioById.get("balanced-notice-time-unknown")!;
  const pipeline = runTiboScenarioPipeline(scenario, buildFixedGeminiOutput(scenario));
  assert.equal(pipeline.formalSignal.ai_notice_timing_status, "unknown");
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
  const noGraphReply = scenarioById.get("balanced-reply-missing-context")!;
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

test("compact-v1 changes only the fixed prompt in offline size measurements", () => {
  const scenario = scenarioById.get("balanced-reply-forced-reset")!;
  const production = measureScenarioPromptSize(scenario, "production");
  const compact = measureScenarioPromptSize(scenario, "compact-v1");

  assert.equal(production.systemPromptChars, TIBO_GEMINI_SYSTEM_PROMPT.length);
  assert.equal(compact.systemPromptChars, TIBO_GEMINI_COMPACT_V1_SYSTEM_PROMPT.length);
  assert.ok(compact.systemPromptChars < production.systemPromptChars);
  assert.equal(compact.userPromptCharsWithGraph, production.userPromptCharsWithGraph);
  assert.equal(compact.userPromptCharsWithoutGraph, production.userPromptCharsWithoutGraph);
});

test("live evaluation budget is capped and counts each classifier invocation", () => {
  assert.equal(requestBudgetForBatch(undefined, 16), 16);
  assert.equal(requestBudgetForBatch(5, 16), 5);
  assert.throws(() => requestBudgetForBatch(17, 16), /maximum/i);
  assert.equal(canStartEvaluationRequest(15, 16), true);
  assert.equal(canStartEvaluationRequest(16, 16), false);
  assert.equal(canStartEvaluationRequest(1, 1), false);
  assert.equal(parseTiboGeminiPromptProfile(undefined), "production");
  assert.equal(parseTiboGeminiPromptProfile("compact-v1"), "compact-v1");
  assert.throws(() => parseTiboGeminiPromptProfile("unknown"), /prompt-profile/i);
});

test("resume reuses successful rows and gives transient failures at most one further invocation", () => {
  assert.equal(isScenarioResumeEligible({ status: "success", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({ status: "invalid_json", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({ status: "invalid_schema", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({ status: "invalid_evidence", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({
    status: "api_error",
    attempts: 1,
    failureDiagnostics: [{ category: "provider_server", httpStatus: 503 }],
  }), true);
  assert.equal(isScenarioResumeEligible({ status: "timeout", attempts: 1 }), true);
  assert.equal(isScenarioResumeEligible({ status: "rate_limited", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({
    status: "api_error",
    attempts: 1,
    failureDiagnostics: [{ category: "auth", httpStatus: 403 }],
  }), false);
  assert.equal(isScenarioResumeEligible({ status: "api_error", attempts: 1 }), false);
  assert.equal(isScenarioResumeEligible({ status: "api_error", attempts: 2 }), false);
  assert.equal(isScenarioResumeEligible({ status: "api_error", attempts: 1, retrySuppressed: true }), false);
});

test("live evaluation stops and stays stopped after auth, quota, or unknown provider failures", async () => {
  const failures = [
    { status: "api_error" as const, diagnostic: { category: "auth" as const, httpStatus: 401 } },
    { status: "api_error" as const, diagnostic: { category: "auth" as const, httpStatus: 403 } },
    { status: "rate_limited" as const, diagnostic: { category: "rate_limit" as const, httpStatus: 429 } },
    { status: "api_error" as const, diagnostic: { category: "provider_rejected" as const, httpStatus: 400 } },
  ];

  for (let index = 0; index < failures.length; index += 1) {
    const failure = failures[index];
    const parent = tempOutputDirectory();
    const outputDir = path.join(parent, `run-${index}`);
    let callCount = 0;
    const classifier: typeof classifyWithGemini = async (input) => {
      callCount += 1;
      const scenario = scenarios.find((item) => item.tweetText === input.text)!;
      return {
        ...buildFixedGeminiOutput(scenario),
        status: failure.status,
        signalType: null,
        confidence: null,
        temporalDirection: null,
        failureDiagnostics: [failure.diagnostic],
      };
    };
    const args = [
      "--live", "--fixture", "balanced-canonical",
      "--ids", "balanced-notice-time-unknown,balanced-notice-day-n",
      "--prompt-profile", "compact-v1", "--request-budget", "2", "--output-dir", outputDir,
    ];

    try {
      const report = await runTiboScenarioEvaluation(args, {
        apiKey: "offline-test-placeholder",
        model: "fake-gemini-model",
        classify: classifier,
      });
      assert.equal(callCount, 1, `${failure.diagnostic.category} must stop the selected evaluation`);
      assert.equal(report?.stoppedAfterProviderFailure, true);
      assert.equal(report?.stoppedAfterRateLimit, failure.status === "rate_limited");
      assert.equal(report?.classifierInvocations, 1);

      await runTiboScenarioEvaluation([...args, "--resume"], {
        apiKey: "offline-test-placeholder",
        model: "fake-gemini-model",
        classify: classifier,
      });
      assert.equal(callCount, 1, "resume must preserve the stop after a fatal provider failure");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("direct model evaluation is blocked until evaluation-only free quota is confirmed", async () => {
  const parent = tempOutputDirectory();
  const outputDir = path.join(parent, "run");
  const originalRequest = https.request;
  const originalConfirmation = process.env.GEMINI_EVALUATION_FREE_TIER_CONFIRMED;
  let httpRequests = 0;
  https.request = (() => {
    httpRequests += 1;
    throw new Error("unexpected model request");
  }) as typeof https.request;
  delete process.env.GEMINI_EVALUATION_FREE_TIER_CONFIRMED;
  try {
    await assert.rejects(
      runTiboScenarioEvaluation([
        "--live", "--fixture", "balanced-canonical", "--prompt-profile", "compact-v1",
        "--request-budget", "1", "--output-dir", outputDir,
      ], {
        apiKey: "offline-test-placeholder",
        model: "gemini-3.5-flash-lite",
      }),
      /FREE_TIER_CONFIRMED/i,
    );
    assert.equal(httpRequests, 0);
  } finally {
    https.request = originalRequest;
    if (originalConfirmation === undefined) delete process.env.GEMINI_EVALUATION_FREE_TIER_CONFIRMED;
    else process.env.GEMINI_EVALUATION_FREE_TIER_CONFIRMED = originalConfirmation;
    rmSync(parent, { recursive: true, force: true });
  }
});

test("evaluation CLI resumes a success only when the complete processing fingerprint matches", async () => {
  const parent = tempOutputDirectory();
  const outputDir = path.join(parent, "run");
  const classifier = createFakeClassifier();
  const args = [
    "--live", "--fixture", "balanced-v1", "--ids", "balanced-notice-time-unknown",
    "--request-budget", "1", "--output-dir", outputDir,
  ];
  try {
    const first = await runTiboScenarioEvaluation(args, evaluationDependencies(classifier));
    assert.equal(first?.classifierInvocations, 1);
    assert.equal(classifier.callCount, 1);

    const checkpointPath = path.join(outputDir, "checkpoint.json");
    const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
    assert.equal(checkpoint.evaluationFingerprint.commitSha, first?.commitSha);
    assert.equal(checkpoint.evaluationFingerprint.schemaVersion, 2);
    assert.equal(checkpoint.evaluationFingerprint.promptProfile, "production");
    assert.equal(checkpoint.evaluationFingerprint.generationSettings.temperature, 0);
    assert.equal(checkpoint.evaluationFingerprint.generationSettings.timeoutMs, 7000);
    assert.equal(checkpoint.evaluationFingerprint.responseObservationMode, "none");
    assert.ok(checkpoint.evaluationFingerprint.systemPromptSha256);
    assert.ok(checkpoint.evaluationFingerprint.userPromptSha256ByScenario["balanced-notice-time-unknown"]);
    assert.ok(checkpoint.evaluationFingerprint.processingSourceHashes["lib/radar/tiboContextSafety.ts"]);
    assert.equal(first?.directHttpRequestAttempts, null, "injected classifiers do not claim observable HTTP sends");

    const resumed = await runTiboScenarioEvaluation([...args, "--resume"], evaluationDependencies(classifier));
    assert.equal(resumed?.classifierInvocations, 1);
    assert.equal(resumed?.freshApiSuccessesThisRun, 0);
    assert.equal(resumed?.reusedCheckpointSuccesses, 1);
    assert.equal(classifier.callCount, 1, "a matching successful row must be reused with zero classifier calls");

    checkpoint.evaluationFingerprint.value = "0".repeat(64);
    writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    await assert.rejects(
      runTiboScenarioEvaluation([...args, "--resume"], evaluationDependencies(classifier)),
      /fingerprint/i,
    );
    assert.equal(classifier.callCount, 1, "a fingerprint mismatch must fail before a classifier call");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("evaluation selects compact-v1 explicitly and fingerprints its prompt before resume", async () => {
  const parent = tempOutputDirectory();
  const outputDir = path.join(parent, "run");
  const observedProfiles: string[] = [];
  const classifier: typeof classifyWithGemini = async (input, options = {}) => {
    observedProfiles.push(options.promptProfile ?? "production");
    const scenario = scenarios.find((item) => item.tweetText === input.text);
    assert.ok(scenario);
    return buildFixedGeminiOutput(scenario);
  };
  const args = [
    "--live", "--fixture", "balanced-canonical", "--ids", "balanced-notice-time-unknown",
    "--prompt-profile", "compact-v1", "--request-budget", "1", "--output-dir", outputDir,
  ];

  try {
    const first = await runTiboScenarioEvaluation(args, evaluationDependencies({
      get callCount() { return observedProfiles.length; },
      classify: classifier,
    }));
    assert.equal(first?.promptProfile, "compact-v1");
    assert.equal(first?.evaluationFingerprint.promptProfile, "compact-v1");
    assert.ok(first?.evaluationFingerprint.systemPromptSha256);
    assert.equal(observedProfiles[0], "compact-v1");
    assert.equal(first?.classifierInvocations, 1);
    assert.equal(first?.directHttpRequestAttempts, null);

    await assert.rejects(
      runTiboScenarioEvaluation([
        ...args.slice(0, args.indexOf("--prompt-profile")),
        "--prompt-profile", "production", ...args.slice(args.indexOf("--prompt-profile") + 2), "--resume",
      ], evaluationDependencies({
        get callCount() { return observedProfiles.length; },
        classify: classifier,
      })),
      /fingerprint/i,
    );
    assert.equal(observedProfiles.length, 1, "a profile hash mismatch must fail before any additional classifier call");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("evaluation CLI recovers an in-flight request as unknown and persists its request budget", async () => {
  const parent = tempOutputDirectory();
  const outputDir = path.join(parent, "run");
  const interruptedClassifier = createFakeClassifier(true);
  const args = [
    "--live", "--fixture", "balanced-v1", "--ids", "balanced-notice-time-unknown",
    "--request-budget", "1", "--output-dir", outputDir,
  ];
  try {
    await assert.rejects(
      runTiboScenarioEvaluation(args, evaluationDependencies(interruptedClassifier)),
      /interruption/,
    );
    const inFlightCheckpoint = JSON.parse(readFileSync(path.join(outputDir, "checkpoint.json"), "utf8"));
    assert.equal(inFlightCheckpoint.requestCount, 1);
    assert.equal(inFlightCheckpoint.requestBudget, 1);
    assert.equal(inFlightCheckpoint.inFlightRequest.scenarioId, "balanced-notice-time-unknown");

    const recovered = await runTiboScenarioEvaluation([...args, "--resume"], evaluationDependencies(interruptedClassifier));
    assert.equal(recovered?.classifierInvocations, 1);
    assert.equal(recovered?.requestBudget, 1);
    assert.equal(recovered?.rows[0]?.failureStage, "interrupted_unknown");
    assert.equal(recovered?.rows[0]?.retrySuppressed, true);
    assert.equal(interruptedClassifier.callCount, 1, "recovery must not duplicate an invocation with unknown outcome");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("evaluation CLI keeps the original request budget across resume", async () => {
  const parent = tempOutputDirectory();
  const outputDir = path.join(parent, "run");
  const classifier = createFakeClassifier();
  const ids = "balanced-credit-compensation-source,balanced-reply-credit-compensation";
  const args = ["--live", "--fixture", "balanced-v1", "--ids", ids, "--request-budget", "1", "--output-dir", outputDir];
  try {
    const first = await runTiboScenarioEvaluation(args, evaluationDependencies(classifier));
    assert.equal(first?.classifierInvocations, 1);
    assert.equal(first?.stoppedAtRequestBudget, true);
    const resumed = await runTiboScenarioEvaluation(
      ["--live", "--fixture", "balanced-v1", "--ids", ids, "--resume", "--output-dir", outputDir],
      evaluationDependencies(classifier),
    );
    assert.equal(resumed?.requestBudget, 1);
    assert.equal(resumed?.classifierInvocations, 1);
    assert.equal(resumed?.stoppedAtRequestBudget, true);
    assert.equal(classifier.callCount, 1, "resume must preserve the original cap and make no second call");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
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
