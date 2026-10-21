import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildFixedGeminiOutput,
  runTiboScenarioPipeline,
  type TiboScenario,
} from "./tiboScenarioSupport";
import { runTiboScenarioEvaluation } from "../scripts/evaluate-tibo-scenarios";

const canonicalFixturePath = path.join(
  process.cwd(),
  "tests/fixtures/tibo-classification-canonical-v2.json",
);

test("canonical v2 keeps the old BANKED gold and moves the corrected completion into canonical taxonomy", () => {
  assert.equal(existsSync(canonicalFixturePath), true, "canonical fixture must be versioned separately from the old gold");
  const canonical = JSON.parse(readFileSync(canonicalFixturePath, "utf8")) as {
    fixtureId: string;
    evaluationScope: string;
    scenarios: TiboScenario[];
  };
  const legacy = JSON.parse(readFileSync(
    path.join(process.cwd(), "tests/fixtures/tibo-classification-balanced-v1.json"),
    "utf8",
  )) as { scenarios: TiboScenario[] };
  const canonicalById = new Map(canonical.scenarios.map((scenario) => [scenario.id, scenario]));
  const legacyBanked = legacy.scenarios.find((scenario) => scenario.id === "balanced-banked-distribution")!;
  const banked = canonicalById.get("balanced-banked-distribution")!;
  const credits = canonicalById.get("balanced-credit-compensation-source")!;
  const classCounts = canonical.scenarios.reduce<Record<string, number>>((counts, scenario) => {
    const signalType = scenario.expected.signalType ?? "irrelevant";
    counts[signalType] = (counts[signalType] ?? 0) + 1;
    return counts;
  }, {});

  assert.equal(canonical.fixtureId, "tibo-classification-canonical-v2");
  assert.match(canonical.evaluationScope, /not a holdout/i);
  assert.equal(legacyBanked.expected.signalType, "reset_executed", "the original 16-case baseline gold stays preserved");
  assert.deepEqual(classCounts, {
    official_notice: 4,
    reset_executed: 3,
    teaser: 4,
    irrelevant: 5,
  });
  assert.equal(banked.expected.signalType, "irrelevant");
  assert.equal(banked.expected.resetMeaningMethod, "banked_distribution");
  assert.equal(banked.expected.resetMeaningScope, "affected_users");
  assert.equal(banked.expected.historyRecordKind, "banked_distribution");
  assert.equal(credits.expected.signalType, "irrelevant");
  assert.equal(credits.expected.resetMeaningMethod, "unknown");
  assert.equal(credits.expected.resetMeaningScope, "unknown");
  assert.equal(credits.expected.historyRecordKind ?? null, null);
});

test("canonical BANKED completion stays irrelevant while retaining method, scope, and dedicated history kind", () => {
  assert.equal(existsSync(canonicalFixturePath), true, "canonical fixture must be versioned separately from the old gold");
  const fixture = JSON.parse(readFileSync(canonicalFixturePath, "utf8")) as { scenarios: TiboScenario[] };
  const banked = fixture.scenarios.find((scenario) => scenario.id === "balanced-banked-distribution")!;
  const credits = fixture.scenarios.find((scenario) => scenario.id === "balanced-credit-compensation-source")!;

  const bankedPipeline = runTiboScenarioPipeline(banked, buildFixedGeminiOutput(banked));
  const creditsPipeline = runTiboScenarioPipeline(credits, buildFixedGeminiOutput(credits));

  assert.equal(bankedPipeline.effectiveSignalType, "irrelevant");
  assert.equal(bankedPipeline.formalAccepted, false);
  assert.equal(bankedPipeline.historyEvent, null, "a BANKED grant must not become a confirmed global reset");
  assert.equal(bankedPipeline.bankedHistoryEvent?.recordKind, "banked_distribution");
  assert.equal(bankedPipeline.bankedHistoryEvent?.details?.resetMethod, "任意リセット権配布");
  assert.equal(banked.expected.resetMeaningMethod, "banked_distribution");
  assert.equal(banked.expected.resetMeaningScope, "affected_users");
  assert.equal(creditsPipeline.effectiveSignalType, "irrelevant");
  assert.equal(creditsPipeline.bankedHistoryEvent, null, "ordinary credits do not enter the BANKED history path");
});

test("BANKED history projection follows source facts despite model status, class, method, or scope errors", () => {
  const fixture = JSON.parse(readFileSync(canonicalFixturePath, "utf8")) as { scenarios: TiboScenario[] };
  const banked = fixture.scenarios.find((scenario) => scenario.id === "balanced-banked-distribution")!;
  const baseline = buildFixedGeminiOutput(banked);
  const outputs = [
    ["wrong method", {
      ...baseline,
      resetMeaning: { ...baseline.resetMeaning!, method: "unknown" as const },
    }],
    ["wrong scope", {
      ...baseline,
      resetMeaning: { ...baseline.resetMeaning!, scope: "unknown" as const },
    }],
    ["wrong method and scope", {
      ...baseline,
      resetMeaning: { ...baseline.resetMeaning!, method: "unknown" as const, scope: "unknown" as const },
    }],
    ["wrong model class", { ...baseline, signalType: "reset_executed" as const }],
    ["non-success model status", { ...baseline, status: "invalid_schema" as const }],
  ] as const;

  for (const [label, output] of outputs) {
    const pipeline = runTiboScenarioPipeline(banked, output);
    assert.equal(
      pipeline.bankedHistoryEvent?.id,
      "banked-reset-canonical-v2-920000000000000017",
      `${label} must fail only its independent model-output score, not source-backed history projection`,
    );
    assert.equal(pipeline.bankedHistoryEvent?.recordKind, "banked_distribution", label);
  }
});

test("BANKED history still requires source-backed notice identity and a supported estimate", () => {
  const fixture = JSON.parse(readFileSync(canonicalFixturePath, "utf8")) as { scenarios: TiboScenario[] };
  const banked = fixture.scenarios.find((scenario) => scenario.id === "balanced-banked-distribution")!;
  const output = buildFixedGeminiOutput(banked);
  const context = banked.bankedHistoryContext!;
  const cases: Array<[string, TiboScenario]> = [
    ["missing context", { ...banked, bankedHistoryContext: undefined }],
    ["non-BANKED notice source text", {
      ...banked,
      bankedHistoryContext: {
        ...context,
        officialNotice: { ...context.officialNotice, text: "We shared an update about usage limits." },
      },
    }],
    ["unrelated notice identity", {
      ...banked,
      bankedHistoryContext: {
        ...context,
        officialNotice: { ...context.officialNotice, tweet_id: "unrelated-notice" },
      },
    }],
    ["unsupported estimate", {
      ...banked,
      bankedHistoryContext: {
        ...context,
        estimate: { ...context.estimate, estimatorVersion: "unsupported-estimator" },
      },
    }],
  ];

  for (const [label, scenario] of cases) {
    assert.equal(runTiboScenarioPipeline(scenario, output).bankedHistoryEvent, null, label);
  }
});

test("canonical evaluator reports BANKED kind without scoring the completed grant as a reset", async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "tibo-canonical-evaluation-"));
  const scenarioId = "balanced-banked-distribution";
  try {
    const fixture = JSON.parse(readFileSync(canonicalFixturePath, "utf8")) as { scenarios: TiboScenario[] };
    const scenario = fixture.scenarios.find((item) => item.id === scenarioId)!;
    const apiKey = "sentinel-api-key-not-to-save";
    const report = await runTiboScenarioEvaluation([
      "--live",
      "--fixture", "balanced-canonical",
      "--ids", scenarioId,
      "--request-budget", "1",
      "--output-dir", path.join(parent, "run"),
    ], {
      apiKey,
      model: "fake-gemini-model",
      classify: async (input) => {
        assert.equal(input.text, scenario.tweetText);
        const output = buildFixedGeminiOutput(scenario);
        return {
          ...output,
          signalType: "reset_executed",
          resetMeaning: {
            ...output.resetMeaning!,
            method: "unknown",
            scope: "unknown",
          },
          reasonJa: `fixture reason containing ${apiKey}`,
          evidenceQuote: `fixture evidence containing ${apiKey}`,
        };
      },
    });

    const row = report?.rows[0];
    assert.equal(row?.expectedSignalType, "irrelevant");
    assert.equal(row?.predictedSignalType, "reset_executed");
    assert.equal(row?.expectedHistoryRecordKind, "banked_distribution");
    assert.equal(row?.historyRecordKind, "banked_distribution");
    assert.equal(report?.metrics.historyRecordKindAccuracy, 1);
    assert.equal(report?.metrics.accuracy, 0);
    assert.equal(report?.metrics.resetMeaningMethodAccuracy, 0);
    assert.equal(report?.metrics.resetMeaningScopeAccuracy, 0);
    assert.equal(report?.modelResponseFieldAudit.mode, "none");
    assert.equal(row?.reasonJa, "fixture reason containing [redacted]");
    assert.equal(row?.evidenceQuote, "fixture evidence containing [redacted]");
    assert.equal(JSON.stringify(report).includes(apiKey), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("evaluation response audit captures only allowlisted fields from a successful provider response", async () => {
  const { withGeminiEvaluationResponseAudit } = await import("../scripts/geminiEvaluationResponseAudit");
  const modelText = JSON.stringify({
    signalType: "irrelevant",
    confidence: 0.91,
    temporalDirection: "completed_now",
    evidenceQuote: "BANKED reset buttons have been distributed.",
    noticeTimingStatus: null,
    teaserStrength: null,
    teaserStrengthConfidence: 0.62,
    teaserStrengthEvidenceQuote: null,
    resetMeaning: {
      method: "banked_distribution",
      scope: "affected_users",
      methodEvidence: { quote: "BANKED reset buttons" },
      scopeEvidence: { quote: "affected accounts" },
    },
    apiKey: "must-not-be-captured",
    requestUrl: "https://example.invalid/?key=must-not-be-captured",
    unapprovedModelField: "must-not-be-captured",
  });
  const providerBody = JSON.stringify({
    candidates: [{ content: { parts: [{ text: modelText }] } }],
    error: { message: "must-not-be-captured" },
  });
  const records: Array<Record<string, unknown>> = [];
  const fakeHttps = createFakeHttps(200, providerBody);
  const observed = await withGeminiEvaluationResponseAudit(
    fakeHttps,
    { scenarioId: "balanced-banked-distribution", attemptNumber: 1 },
    (record) => records.push(record as unknown as Record<string, unknown>),
    async () => makeFakeClassifierRequest(fakeHttps),
  );

  assert.equal(observed.result, "classifier received response");
  assert.equal(observed.recordCount, 1);
  assert.equal(observed.observerFailureCount, 0);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    schemaVersion: 1,
    scenarioId: "balanced-banked-distribution",
    attemptNumber: 1,
    observedAt: records[0]?.observedAt,
    httpStatus: 200,
    parseStatus: "parsed",
      invalidFields: [],
    fieldPresence: [
      "signalType",
      "temporalDirection",
      "noticeTimingStatus",
      "teaserStrength",
      "confidence",
      "teaserStrengthConfidence",
      "evidenceQuote",
      "teaserStrengthEvidenceQuote",
      "resetMeaning",
      "resetMeaning.method",
      "resetMeaning.scope",
      "resetMeaning.methodEvidence",
      "resetMeaning.methodEvidence.quote",
      "resetMeaning.scopeEvidence",
      "resetMeaning.scopeEvidence.quote",
    ],
    fields: {
      signalType: "irrelevant",
      temporalDirection: "completed_now",
      noticeTimingStatus: null,
      teaserStrength: null,
      confidence: 0.91,
      teaserStrengthConfidence: 0.62,
      evidenceQuote: "BANKED reset buttons have been distributed.",
      teaserStrengthEvidenceQuote: null,
      resetMeaning: {
        method: "banked_distribution",
        scope: "affected_users",
        methodEvidence: { quote: "BANKED reset buttons" },
        scopeEvidence: { quote: "affected accounts" },
      },
    },
  });
  const serializedRecord = JSON.stringify(records);
  assert.equal(serializedRecord.includes("must-not-be-captured"), false);
  assert.equal(serializedRecord.includes("requestUrl"), false);
  assert.equal(serializedRecord.includes("unapprovedModelField"), false);
  assert.equal(serializedRecord.includes("sentinel-key-not-to-save"), false);
});

test("evaluation response audit refuses to persist an allowlisted quote that echoes the API key", async () => {
  const { withGeminiEvaluationResponseAudit } = await import("../scripts/geminiEvaluationResponseAudit");
  const apiKey = "sentinel-evaluation-api-key";
  const providerBody = JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ evidenceQuote: `evidence ${apiKey}` }) }] } }],
  });
  const records: Array<Record<string, unknown>> = [];
  const fakeHttps = createFakeHttps(200, providerBody);
  const observed = await withGeminiEvaluationResponseAudit(
    fakeHttps,
    { scenarioId: "api-key-echo", attemptNumber: 1 },
    (record) => records.push(record as unknown as Record<string, unknown>),
    async () => makeFakeClassifierRequest(fakeHttps),
    [apiKey],
  );

  assert.equal(observed.recordCount, 1);
  assert.equal(records[0]?.parseStatus, "parsed");
  assert.deepEqual(records[0]?.invalidFields, ["evidenceQuote"]);
  assert.deepEqual(records[0]?.fields, {});
  assert.equal(JSON.stringify(records).includes(apiKey), false);
});

test("evaluation response audit ignores provider error bodies and does not change the classifier result", async () => {
  const { withGeminiEvaluationResponseAudit } = await import("../scripts/geminiEvaluationResponseAudit");
  const records: unknown[] = [];
  const fakeHttps = createFakeHttps(401, "credential and provider error details must not be captured");
  const observed = await withGeminiEvaluationResponseAudit(
    fakeHttps,
    { scenarioId: "auth-failure", attemptNumber: 1 },
    (record) => records.push(record),
    async () => makeFakeClassifierRequest(fakeHttps),
  );

  assert.equal(observed.result, "classifier received response");
  assert.equal(observed.recordCount, 0);
  assert.equal(observed.observerFailureCount, 0);
  assert.deepEqual(records, []);
});

test("evaluation response audit write failures stay isolated from the classifier result", async () => {
  const { withGeminiEvaluationResponseAudit } = await import("../scripts/geminiEvaluationResponseAudit");
  const fakeHttps = createFakeHttps(200, JSON.stringify({ candidates: [] }));
  const observed = await withGeminiEvaluationResponseAudit(
    fakeHttps,
    { scenarioId: "observer-write-failure", attemptNumber: 1 },
    () => { throw new Error("must-not-be-persisted-or-rethrown"); },
    async () => makeFakeClassifierRequest(fakeHttps),
  );

  assert.equal(observed.result, "classifier received response");
  assert.equal(observed.recordCount, 0);
  assert.equal(observed.observerFailureCount, 1);
});

function createFakeHttps(statusCode: number, body: string) {
  return {
    request: (_url: unknown, _options: unknown, callback?: (response: EventEmitter & { statusCode: number }) => void) => {
      const request = new EventEmitter() as EventEmitter & {
        write: (_chunk: string) => boolean;
        end: () => void;
        destroy: () => void;
      };
      request.write = () => true;
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number };
        response.statusCode = statusCode;
        queueMicrotask(() => {
          callback?.(response);
          response.emit("data", Buffer.from(body));
          response.emit("end");
        });
      };
      request.destroy = () => undefined;
      return request;
    },
  } as never;
}

function makeFakeClassifierRequest(fakeHttps: never): Promise<string> {
  const requestModule = fakeHttps as unknown as {
    request: (url: URL, options: { method: string }, callback: (response: EventEmitter) => void) => {
      write: (chunk: string) => boolean;
      end: () => void;
    };
  };
  return new Promise((resolve) => {
    const request = requestModule.request(
      new URL("https://example.invalid/generateContent?key=sentinel-key-not-to-save"),
      { method: "POST" },
      (response) => {
        response.on("data", () => undefined);
        response.on("end", () => resolve("classifier received response"));
      },
    );
    request.write("request body sentinel not to save");
    request.end();
  });
}
