import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  classifyWithGemini,
  buildGeminiPrompt,
  getTiboGeminiSystemPrompt,
  type GeminiFailureDiagnostic,
  type GeminiClassificationOutput,
  type GeminiClassificationStatus,
  type TiboGeminiPromptProfile,
} from "../lib/radar/geminiClassification";
import {
  parseTiboTemporalSemantics,
  resolveTiboTemporalSchedule,
  TIBO_SOURCE_TIME_ZONE,
  type TemporalResolutionStatus,
} from "../lib/radar/tiboTemporal";
import {
  buildGeminiScenarioInput,
  runTiboScenarioPipeline,
  type TiboScenario,
  type TiboScenarioFixture,
} from "../tests/tiboScenarioSupport";
import fixtureJson from "../tests/fixtures/tibo-scenarios.json";
import balancedV1FixtureJson from "../tests/fixtures/tibo-classification-balanced-v1.json";
import canonicalBalancedFixtureJson from "../tests/fixtures/tibo-classification-canonical-v2.json";
import {
  withGeminiEvaluationResponseAudit,
  type GeminiResponseAuditContext,
} from "./geminiEvaluationResponseAudit";

const SIGNAL_TYPES = ["reset_executed", "official_notice", "teaser", "irrelevant"] as const;
type SignalType = (typeof SIGNAL_TYPES)[number];
type ResetMeaningMethod = NonNullable<GeminiClassificationOutput["resetMeaning"]>["method"];
type ResetMeaningScope = NonNullable<GeminiClassificationOutput["resetMeaning"]>["scope"];
const RESET_RELATED = new Set<SignalType>(["reset_executed", "official_notice", "teaser"]);
const AUTO_RETRY_STATUSES = new Set<GeminiClassificationStatus>(["timeout", "api_error"]);
export const MAX_EVALUATION_REQUEST_BUDGET = 16;
export const MAX_ATTEMPTS_PER_SCENARIO = 2;

export type ScenarioEvaluationRow = {
  id: string;
  category: string;
  ambiguous: boolean;
  expectedSignalType: SignalType;
  expectedTemporalDirection?: TiboScenario["expected"]["temporalDirection"];
  expectedTeaserStrength?: TiboScenario["expected"]["teaserStrength"];
  expectedTemporalResolutionStatus?: TemporalResolutionStatus;
  expectedTemporalPrecision?: TiboScenario["expected"]["temporalPrecision"];
  expectedNoticeTimingStatus?: TiboScenario["expected"]["noticeTimingStatus"];
  expectedResetMeaningMethod?: ResetMeaningMethod;
  expectedResetMeaningScope?: ResetMeaningScope;
  expectedHistoryRecordKind?: TiboScenario["expected"]["historyRecordKind"];
  predictedSignalType: SignalType | null;
  rawSignalType: SignalType | null;
  rawTemporalDirection: GeminiClassificationOutput["temporalDirection"];
  confidence: number | null;
  temporalDirection: GeminiClassificationOutput["temporalDirection"];
  teaserStrength: GeminiClassificationOutput["teaserStrength"];
  classifierReturnedTeaserStrength: GeminiClassificationOutput["teaserStrength"];
  modelOutputNoticeTimingStatus: GeminiClassificationOutput["noticeTimingStatus"];
  modelOutputResetMeaningMethod: ResetMeaningMethod | null;
  modelOutputResetMeaningScope: ResetMeaningScope | null;
  selectedSignalType: SignalType | null;
  selectedSource: string | null;
  contextSafetyApplied: boolean;
  contextSafetySignalType: SignalType | null;
  effectiveSignalType: SignalType | null;
  effectiveTeaserStrength: GeminiClassificationOutput["teaserStrength"];
  formalResetAccepted: boolean;
  historyRecordKind: string | null;
  failureStage: string;
  temporalResolutionStatus: TemporalResolutionStatus;
  temporalPrecision: GeminiClassificationOutput["temporalPrecision"] | null;
  reasonJa: string | null;
  evidenceQuote: string | null;
  status: GeminiClassificationStatus;
  attempts: number;
  successfulClassifierInvocations: number;
  rateLimitResponses: number;
  retrySuppressed: boolean;
  failureDiagnostics?: GeminiFailureDiagnostic[];
  latencyMs: number;
  text: string;
  promptSize: PromptSizeMeasurement;
};

export type PromptSizeMeasurement = {
  systemPromptChars: number;
  userPromptCharsWithGraph: number;
  userPromptCharsWithoutGraph: number;
  combinedPromptCharsWithGraph: number;
  combinedPromptCharsWithoutGraph: number;
  graphInputIncluded: boolean;
};

export type ScenarioMetrics = {
  total: number;
  evaluated: number;
  validPredictions: number;
  invalidPredictions: number;
  ambiguousExcluded: number;
  correct: number;
  accuracy: number | null;
  macroF1: number | null;
  byClass: Record<SignalType, { support: number; precision: number; recall: number; f1: number }>;
  confusion: Record<SignalType, Record<SignalType | "no_valid_prediction", number>>;
  binaryResetRelated: { support: number; precision: number; recall: number; f1: number };
  temporalDirectionAccuracy: number | null;
  teaserStrengthAccuracy: number | null;
  temporalResolutionAccuracy: number | null;
  temporalPrecisionAccuracy: number | null;
  noticeTimingStatusAccuracy: number | null;
  resetMeaningMethodAccuracy: number | null;
  resetMeaningScopeAccuracy: number | null;
  historyRecordKindAccuracy: number | null;
  falsePositives: Array<{ id: string; category: string; text: string; predicted: SignalType | null }>;
  falseNegatives: Array<{ id: string; category: string; text: string; predicted: SignalType | null }>;
  byCategory: Record<string, { total: number; evaluated: number; correct: number; accuracy: number | null }>;
};

type Checkpoint = {
  schemaVersion: 3;
  model: string;
  fixtureName: string;
  fixtureScenarioCount: number;
  selectedScenarioIds: string[];
  rows: ScenarioEvaluationRow[];
  stoppedAfterRateLimit: boolean;
  stoppedAfterProviderFailure?: boolean;
  requestBudget: number;
  requestCount: number;
  inFlightRequest?: { scenarioId: string; attemptNumber: number; startedAt: string } | null;
  updatedAt: string;
  commitSha?: string | null;
  fixtureHash?: string | null;
  evaluationFingerprint: TiboEvaluationFingerprint;
  startedAt?: string;
  resumeCount?: number;
  rateLimitCount?: number;
  responseAuditRecordCount?: number;
  responseAuditObserverFailureCount?: number;
};

export type TiboEvaluationFingerprint = {
  schemaVersion: 2;
  fixtureName: string;
  fixtureHash: string;
  selectedScenarioIds: string[];
  commitSha: string | null;
  model: string;
  promptProfile: TiboGeminiPromptProfile;
  systemPromptSha256: string;
  userPromptSha256ByScenario: Record<string, string>;
  responseObservationMode: "none" | "allowlist-v1";
  generationSettings: {
    mode: "primary";
    responseMimeType: "application/json";
    temperature: 0;
    timeoutMs: 7000;
  };
  processingSourceHashes: Record<string, string>;
  value: string;
};

export type TiboScenarioEvaluationReport = {
  schemaVersion: 3;
  status: "complete" | "incomplete";
  complete: boolean;
  model: string;
  promptProfile: TiboGeminiPromptProfile;
  commitSha: string | null;
  fixtureName: string;
  fixtureHash: string;
  evaluationFingerprint: TiboEvaluationFingerprint;
  startedAt: string;
  completedAt: string | null;
  resumeCount: number;
  rateLimitCount: number;
  requestBudget: number;
  classifierInvocations: number;
  directHttpRequestAttempts: number | null;
  freshApiSuccessesThisRun: number;
  reusedCheckpointSuccesses: number;
  apiSuccessDefinition: string;
  productionSafetyGuardEnabled: true;
  fixtureScenarioCount: number;
  selectedScenarioCount: number;
  evaluatedScenarioCount: number;
  existingHistoricalEvaluation23Unchanged: true;
  mockScenarioLab145Unchanged: true;
  productionWrites: false;
  stoppedAfterRateLimit: boolean;
  stoppedAfterProviderFailure: boolean;
  stoppedAtRequestBudget: boolean;
  modelResponseFieldAudit: {
    mode: "none" | "allowlist-v1";
    fileName: string | null;
    recordCount: number;
    observerFailureCount: number;
  };
  metrics: ScenarioMetrics;
  rows: ScenarioEvaluationRow[];
  resumeCommand: string;
};

export type TiboScenarioEvaluationDependencies = {
  apiKey?: string;
  model?: string;
  classify?: typeof classifyWithGemini;
  cwd?: string;
  projectRoot?: string;
};

const EVALUATION_PROCESSING_FILES = [
  "scripts/evaluate-tibo-scenarios.ts",
  "scripts/geminiEvaluationResponseAudit.ts",
  "tests/tiboScenarioSupport.ts",
  "lib/radar/geminiClassification.ts",
  "lib/radar/classification.ts",
  "lib/radar/tiboClassificationMode.ts",
  "lib/radar/tiboContextSafety.ts",
  "lib/radar/tiboFormalReplyAdmission.ts",
  "lib/radar/tiboHistory.ts",
  "lib/radar/tiboResetEventIdentity.ts",
  "lib/radar/tiboLogicalProjection.ts",
  "lib/radar/tiboLogicalPost.ts",
  "lib/radar/tiboTemporal.ts",
  "lib/radar/tiboEvidenceContext.ts",
  "lib/radar/tiboEvidencePrompt.ts",
  "lib/radar/teaserStrength.ts",
  "lib/radar/bankedReset.ts",
] as const;

function loadLocalEnvironment(cwd = process.cwd()) {
  const envPath = path.join(cwd, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args.set(key, argv[index + 1]);
      index += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

export function requestBudgetForBatch(requested: number | undefined, maximum = MAX_EVALUATION_REQUEST_BUDGET) {
  const budget = requested ?? maximum;
  if (!Number.isInteger(budget) || budget < 1 || budget > maximum) {
    throw new Error(`Request budget must be an integer from 1 through the maximum of ${maximum}.`);
  }
  return budget;
}

export function parseTiboGeminiPromptProfile(value: string | undefined): TiboGeminiPromptProfile {
  const profile = value?.trim() || "production";
  if (profile === "production" || profile === "compact-v1") return profile;
  throw new Error("--prompt-profile must be 'production' or 'compact-v1'.");
}

export function canStartEvaluationRequest(requestCount: number, requestBudget: number) {
  return Number.isInteger(requestCount) && requestCount >= 0 && requestCount < requestBudget;
}

export function isScenarioResumeEligible(row: {
  status?: string;
  attempts?: number;
  retrySuppressed?: boolean;
  failureDiagnostics?: GeminiFailureDiagnostic[];
} | null | undefined) {
  if (!row) return true;
  if (row.retrySuppressed) return false;
  const attempts = row.attempts ?? 0;
  if (attempts <= 0 || attempts >= MAX_ATTEMPTS_PER_SCENARIO) return false;
  if (row.status === "timeout") return true;
  return row.status === "api_error" && isSafeToRetryEvaluationFailure(row);
}

function isSafeToRetryEvaluationFailure(row: {
  status?: string;
  failureDiagnostics?: GeminiFailureDiagnostic[];
}) {
  if (row.status !== "api_error" || !row.failureDiagnostics?.length) return false;
  return row.failureDiagnostics.every((diagnostic) =>
    diagnostic.category === "transport" || diagnostic.category === "provider_server",
  );
}

function shouldStopForProviderFailure(row: {
  status?: string;
  failureDiagnostics?: GeminiFailureDiagnostic[];
}) {
  if (row.status === "rate_limited") return true;
  if (row.status !== "api_error") return false;
  if (!row.failureDiagnostics?.length) return true;
  return row.failureDiagnostics.some((diagnostic) =>
    diagnostic.category === "auth" ||
    diagnostic.category === "rate_limit" ||
    (diagnostic.httpStatus !== null && diagnostic.httpStatus >= 400 && diagnostic.httpStatus < 500),
  ) || !isSafeToRetryEvaluationFailure(row);
}

export function getClassificationFailureStage(status: GeminiClassificationStatus) {
  switch (status) {
    case "success": return "none";
    case "api_error": return "provider_api";
    case "timeout": return "timeout";
    case "rate_limited": return "rate_limit";
    case "invalid_json": return "json_parse";
    case "invalid_schema": return "schema_validation";
    case "invalid_evidence": return "evidence_validation";
    case "skipped":
    case "model_not_configured": return "configuration";
  }
}

export function measureScenarioPromptSize(
  scenario: TiboScenario,
  promptProfile: TiboGeminiPromptProfile = "production",
): PromptSizeMeasurement {
  const withGraph = buildGeminiScenarioInput(scenario);
  const withoutGraph = { ...withGraph, tiboEvidenceInput: null };
  const userPromptCharsWithGraph = buildGeminiPrompt(withGraph).length;
  const userPromptCharsWithoutGraph = buildGeminiPrompt(withoutGraph).length;
  const systemPromptChars = getTiboGeminiSystemPrompt(promptProfile).length;
  return {
    systemPromptChars,
    userPromptCharsWithGraph,
    userPromptCharsWithoutGraph,
    combinedPromptCharsWithGraph: systemPromptChars + userPromptCharsWithGraph,
    combinedPromptCharsWithoutGraph: systemPromptChars + userPromptCharsWithoutGraph,
    graphInputIncluded: Boolean(withGraph.tiboEvidenceInput),
  };
}

function getFixture(args: Map<string, string>) {
  const fixtureName = args.get("fixture") ?? "legacy";
  if (fixtureName === "legacy") return { fixtureName, fixture: fixtureJson as TiboScenarioFixture };
  if (fixtureName === "balanced-v1") return { fixtureName, fixture: balancedV1FixtureJson as TiboScenarioFixture };
  if (fixtureName === "balanced" || fixtureName === "balanced-canonical") {
    return { fixtureName, fixture: canonicalBalancedFixtureJson as TiboScenarioFixture };
  }
  throw new Error(`Unknown fixture '${fixtureName}'. Use 'legacy', 'balanced-v1', or 'balanced-canonical'.`);
}

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

function getCommitSha(projectRoot = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function getFixtureHash(fixtureName: string, projectRoot = process.cwd()) {
  const filename = fixtureName === "balanced-v1"
    ? "tibo-classification-balanced-v1.json"
    : fixtureName === "balanced" || fixtureName === "balanced-canonical"
      ? "tibo-classification-canonical-v2.json"
      : "tibo-scenarios.json";
  return createHash("sha256")
    .update(fs.readFileSync(path.join(projectRoot, "tests", "fixtures", filename)))
    .digest("hex");
}

export function buildTiboEvaluationFingerprint(
  fixtureName: string,
  fixtureHash: string,
  scenarios: TiboScenario[],
  commitSha: string | null,
  model: string,
  projectRoot: string,
  responseObservationMode: "none" | "allowlist-v1" = "none",
  promptProfile: TiboGeminiPromptProfile = "production",
): TiboEvaluationFingerprint {
  const userPromptSha256ByScenario = Object.fromEntries(scenarios.map((scenario) => [
    scenario.id,
    createHash("sha256").update(buildGeminiPrompt(buildGeminiScenarioInput(scenario))).digest("hex"),
  ]));
  const processingSourceHashes = Object.fromEntries(EVALUATION_PROCESSING_FILES.map((filename) => [
    filename,
    createHash("sha256").update(fs.readFileSync(path.join(projectRoot, filename))).digest("hex"),
  ]));
  const fingerprintPayload = {
    schemaVersion: 2 as const,
    fixtureName,
    fixtureHash,
    selectedScenarioIds: scenarios.map((scenario) => scenario.id),
    commitSha,
    model,
    promptProfile,
    systemPromptSha256: createHash("sha256").update(getTiboGeminiSystemPrompt(promptProfile)).digest("hex"),
    userPromptSha256ByScenario,
    responseObservationMode,
    generationSettings: {
      mode: "primary" as const,
      responseMimeType: "application/json" as const,
      temperature: 0 as const,
      timeoutMs: 7000 as const,
    },
    processingSourceHashes,
  };
  return {
    ...fingerprintPayload,
    value: createHash("sha256").update(JSON.stringify(fingerprintPayload)).digest("hex"),
  };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function f1(precision: number, recall: number) {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function calculateClassMetrics(rows: ScenarioEvaluationRow[], signalType: SignalType): { support: number; precision: number; recall: number; f1: number } {
  const valid = rows.filter((row) => !row.ambiguous && row.status === "success" && row.predictedSignalType);
  const support = valid.filter((row) => row.expectedSignalType === signalType).length;
  const predicted = valid.filter((row) => row.predictedSignalType === signalType).length;
  const truePositive = valid.filter(
    (row) => row.expectedSignalType === signalType && row.predictedSignalType === signalType,
  ).length;
  const precision = predicted === 0 ? 0 : truePositive / predicted;
  const recall = support === 0 ? 0 : truePositive / support;
  return { support, precision, recall, f1: f1(precision, recall) };
}

function calculateBinaryMetrics(rows: ScenarioEvaluationRow[]) {
  const valid = rows.filter((row) => !row.ambiguous && row.status === "success" && row.predictedSignalType);
  const actualPositive = valid.filter((row) => RESET_RELATED.has(row.expectedSignalType)).length;
  const predictedPositive = valid.filter((row) => RESET_RELATED.has(row.predictedSignalType as SignalType)).length;
  const truePositive = valid.filter(
    (row) => RESET_RELATED.has(row.expectedSignalType) && RESET_RELATED.has(row.predictedSignalType as SignalType),
  ).length;
  const precision = predictedPositive === 0 ? 0 : truePositive / predictedPositive;
  const recall = actualPositive === 0 ? 0 : truePositive / actualPositive;
  return { support: actualPositive, precision, recall, f1: f1(precision, recall) };
}

export function calculateScenarioMetrics(rows: ScenarioEvaluationRow[]): ScenarioMetrics {
  const valid = rows.filter((row) => !row.ambiguous && row.status === "success" && row.predictedSignalType);
  const evaluated = rows.filter((row) => !row.ambiguous);
  const byClass = Object.fromEntries(
    SIGNAL_TYPES.map((signalType) => [signalType, calculateClassMetrics(rows, signalType)]),
  ) as Record<SignalType, { support: number; precision: number; recall: number; f1: number }>;
  const classF1 = SIGNAL_TYPES.map((signalType) => byClass[signalType].f1);
  const confusion = Object.fromEntries(
    SIGNAL_TYPES.map((expected) => [
      expected,
      Object.fromEntries([
        ...SIGNAL_TYPES.map((predicted) => [predicted, 0]),
        ["no_valid_prediction", 0],
      ]) as Record<SignalType | "no_valid_prediction", number>,
    ]),
  ) as Record<SignalType, Record<SignalType | "no_valid_prediction", number>>;

  for (const row of evaluated) {
    const prediction = row.status === "success" && row.predictedSignalType
      ? row.predictedSignalType
      : "no_valid_prediction";
    confusion[row.expectedSignalType][prediction] += 1;
  }

  const correct = valid.filter((row) => row.expectedSignalType === row.predictedSignalType).length;
  const temporalRows = valid.filter((row) => row.expectedTemporalDirection);
  const teaserRows = valid.filter((row) => row.expectedTeaserStrength);
  const resolutionRows = valid.filter((row) => row.expectedTemporalResolutionStatus);
  const precisionRows = valid.filter((row) => row.expectedTemporalPrecision);
  const timingStatusRows = valid.filter((row) => row.expectedNoticeTimingStatus);
  const resetMethodRows = valid.filter((row) => row.expectedResetMeaningMethod);
  const resetScopeRows = valid.filter((row) => row.expectedResetMeaningScope);
  const historyRecordKindRows = valid.filter((row) => row.expectedHistoryRecordKind);
  const accuracy = (count: number, total: number) => total === 0 ? null : count / total;
  const byCategory: ScenarioMetrics["byCategory"] = {};

  for (const row of rows) {
    const item = byCategory[row.category] ?? { total: 0, evaluated: 0, correct: 0, accuracy: null };
    item.total += 1;
    if (!row.ambiguous) {
      item.evaluated += 1;
      if (row.status === "success" && row.predictedSignalType === row.expectedSignalType) item.correct += 1;
    }
    item.accuracy = accuracy(item.correct, item.evaluated);
    byCategory[row.category] = item;
  }

  return {
    total: rows.length,
    evaluated: evaluated.length,
    validPredictions: valid.length,
    invalidPredictions: evaluated.length - valid.length,
    ambiguousExcluded: rows.length - evaluated.length,
    correct,
    accuracy: accuracy(correct, evaluated.length),
    macroF1: classF1.reduce((sum, value) => sum + value, 0) / classF1.length,
    byClass,
    confusion,
    binaryResetRelated: calculateBinaryMetrics(rows),
    temporalDirectionAccuracy: accuracy(
      temporalRows.filter((row) => row.temporalDirection === row.expectedTemporalDirection).length,
      temporalRows.length,
    ),
    teaserStrengthAccuracy: accuracy(
      teaserRows.filter((row) => row.teaserStrength === row.expectedTeaserStrength).length,
      teaserRows.length,
    ),
    temporalResolutionAccuracy: accuracy(
      resolutionRows.filter((row) => row.temporalResolutionStatus === row.expectedTemporalResolutionStatus).length,
      resolutionRows.length,
    ),
    temporalPrecisionAccuracy: accuracy(
      precisionRows.filter((row) => row.temporalPrecision === row.expectedTemporalPrecision).length,
      precisionRows.length,
    ),
    noticeTimingStatusAccuracy: accuracy(
      timingStatusRows.filter((row) => row.modelOutputNoticeTimingStatus === row.expectedNoticeTimingStatus).length,
      timingStatusRows.length,
    ),
    resetMeaningMethodAccuracy: accuracy(
      resetMethodRows.filter((row) => row.modelOutputResetMeaningMethod === row.expectedResetMeaningMethod).length,
      resetMethodRows.length,
    ),
    resetMeaningScopeAccuracy: accuracy(
      resetScopeRows.filter((row) => row.modelOutputResetMeaningScope === row.expectedResetMeaningScope).length,
      resetScopeRows.length,
    ),
    historyRecordKindAccuracy: accuracy(
      historyRecordKindRows.filter((row) => row.historyRecordKind === row.expectedHistoryRecordKind).length,
      historyRecordKindRows.length,
    ),
    falsePositives: rows
      .filter((row) => !row.ambiguous && row.expectedSignalType === "irrelevant" && RESET_RELATED.has(row.predictedSignalType as SignalType))
      .map((row) => ({ id: row.id, category: row.category, text: row.text, predicted: row.predictedSignalType })),
    falseNegatives: rows
      .filter((row) => !row.ambiguous && RESET_RELATED.has(row.expectedSignalType) && row.predictedSignalType === "irrelevant")
      .map((row) => ({ id: row.id, category: row.category, text: row.text, predicted: row.predictedSignalType })),
    byCategory,
  };
}

function resolutionFor(scenario: TiboScenario, prediction: GeminiClassificationOutput) {
  const semantics = parseTiboTemporalSemantics(prediction, scenario.tweetText);
  return resolveTiboTemporalSchedule(semantics, scenario.tweetCreatedAt, TIBO_SOURCE_TIME_ZONE);
}

function redactApiKey(value: string | null, apiKey: string) {
  return value && apiKey.length >= 8 && value.includes(apiKey)
    ? value.replaceAll(apiKey, "[redacted]")
    : value;
}

type EvaluationResponseAuditRunner = (
  context: GeminiResponseAuditContext,
  action: () => Promise<GeminiClassificationOutput>,
) => Promise<{
  result: GeminiClassificationOutput;
  recordCount: number;
  observerFailureCount: number;
}>;

async function evaluateScenario(
  scenario: TiboScenario,
  model: string,
  apiKey: string,
  classifier: typeof classifyWithGemini,
  previousAttempts = 0,
  previousSuccesses = 0,
  previousRateLimits = 0,
  beforeRequest?: (attemptNumber: number) => void,
  responseAudit?: EvaluationResponseAuditRunner,
  promptProfile: TiboGeminiPromptProfile = "production",
): Promise<ScenarioEvaluationRow> {
  const attemptNumber = previousAttempts + 1;
  beforeRequest?.(attemptNumber);
  let last: GeminiClassificationOutput | null = null;
  const started = performance.now();
  const classify = () => classifier(buildGeminiScenarioInput(scenario), {
    apiKey,
    model,
    mode: "primary",
    timeoutMs: 7000,
    promptProfile,
  });
  last = responseAudit
    ? (await responseAudit({ scenarioId: scenario.id, attemptNumber }, classify)).result
    : await classify();

  const prediction = last ?? {
    signalType: null,
    confidence: null,
    temporalDirection: null,
    evidenceQuote: null,
    reasonJa: null,
    resetTypeJa: null,
    noticeToExecution: null,
    teaserStrength: null,
    teaserStrengthConfidence: null,
    teaserStrengthEvidenceQuote: null,
    teaserStrengthReasonJa: null,
    temporalExpression: null,
    temporalKind: null,
    temporalPrecision: null,
    weekday: null,
    relativeDayOffset: null,
    relativeAmount: null,
    relativeUnit: null,
    explicitDateParts: null,
    explicitTimeParts: null,
    daypart: null,
    rangeKind: null,
    explicitTimezone: null,
    temporalConfidence: null,
    model,
    status: "api_error" as const,
    classifiedAt: null,
  };
  const resolution = resolutionFor(scenario, prediction);
  const pipeline = runTiboScenarioPipeline(scenario, prediction, "primary");
  const rawSignalType = (prediction.rawAudit?.signalType ?? prediction.signalType) as SignalType | null;
  const rawTemporalDirection = prediction.rawAudit?.temporalDirection ?? prediction.temporalDirection;

  return {
    id: scenario.id,
    category: scenario.category,
    ambiguous: scenario.ambiguous === true,
    expectedSignalType: scenario.expected.signalType ?? "irrelevant",
    expectedTemporalDirection: scenario.expected.temporalDirection,
    expectedTeaserStrength: scenario.expected.teaserStrength,
    expectedTemporalResolutionStatus: scenario.expected.temporalResolutionStatus,
    expectedTemporalPrecision: scenario.expected.temporalPrecision,
    expectedNoticeTimingStatus: scenario.expected.noticeTimingStatus,
    expectedResetMeaningMethod: scenario.expected.resetMeaningMethod,
    expectedResetMeaningScope: scenario.expected.resetMeaningScope,
    expectedHistoryRecordKind: scenario.expected.historyRecordKind,
    predictedSignalType: prediction.signalType,
    rawSignalType,
    rawTemporalDirection,
    confidence: prediction.confidence,
    temporalDirection: prediction.temporalDirection,
    teaserStrength: prediction.teaserStrength ?? null,
    classifierReturnedTeaserStrength: prediction.teaserStrength ?? null,
    modelOutputNoticeTimingStatus: prediction.noticeTimingStatus ?? null,
    modelOutputResetMeaningMethod: prediction.resetMeaning?.method ?? null,
    modelOutputResetMeaningScope: prediction.resetMeaning?.scope ?? null,
    selectedSignalType: pipeline.selected.signalType,
    selectedSource: pipeline.selected.classificationSource,
    contextSafetyApplied: pipeline.contextSafetyDecision !== null,
    contextSafetySignalType: pipeline.contextSafetyDecision?.signalType ?? null,
    effectiveSignalType: pipeline.effectiveSignalType,
    effectiveTeaserStrength: pipeline.effectiveTeaserStrength,
    formalResetAccepted: pipeline.formalAccepted,
    historyRecordKind: pipeline.bankedHistoryEvent?.recordKind ?? pipeline.historyEvent?.recordKind ?? null,
    failureStage: getClassificationFailureStage(prediction.status),
    temporalResolutionStatus: resolution.status,
    temporalPrecision: resolution.status === "resolved" ? resolution.temporalPrecision : prediction.temporalPrecision,
    reasonJa: redactApiKey(prediction.reasonJa, apiKey),
    evidenceQuote: redactApiKey(prediction.evidenceQuote, apiKey),
    status: prediction.status,
    attempts: attemptNumber,
    successfulClassifierInvocations: previousSuccesses + (prediction.status === "success" ? 1 : 0),
    rateLimitResponses: previousRateLimits + (prediction.status === "rate_limited" ? 1 : 0),
    retrySuppressed: shouldStopForProviderFailure({
      status: prediction.status,
      failureDiagnostics: prediction.failureDiagnostics,
    }),
    failureDiagnostics: prediction.failureDiagnostics ?? [],
    latencyMs: Math.round(performance.now() - started),
    text: scenario.tweetText,
    promptSize: measureScenarioPromptSize(scenario, promptProfile),
  };
}

function checkpointPath(outputDir: string) {
  return path.join(outputDir, "checkpoint.json");
}

function writeCheckpoint(outputDir: string, checkpoint: Checkpoint) {
  fs.writeFileSync(checkpointPath(outputDir), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

function buildInterruptedRow(
  scenario: TiboScenario,
  previous: ScenarioEvaluationRow | undefined,
  attemptNumber: number,
  promptProfile: TiboGeminiPromptProfile = "production",
): ScenarioEvaluationRow {
  return {
    id: scenario.id,
    category: scenario.category,
    ambiguous: scenario.ambiguous === true,
    expectedSignalType: scenario.expected.signalType ?? "irrelevant",
    expectedTemporalDirection: scenario.expected.temporalDirection,
    expectedTeaserStrength: scenario.expected.teaserStrength,
    expectedTemporalResolutionStatus: scenario.expected.temporalResolutionStatus,
    expectedTemporalPrecision: scenario.expected.temporalPrecision,
    expectedNoticeTimingStatus: scenario.expected.noticeTimingStatus,
    expectedResetMeaningMethod: scenario.expected.resetMeaningMethod,
    expectedResetMeaningScope: scenario.expected.resetMeaningScope,
    expectedHistoryRecordKind: scenario.expected.historyRecordKind,
    predictedSignalType: null,
    rawSignalType: null,
    rawTemporalDirection: null,
    confidence: null,
    temporalDirection: null,
    teaserStrength: null,
    classifierReturnedTeaserStrength: null,
    modelOutputNoticeTimingStatus: null,
    modelOutputResetMeaningMethod: null,
    modelOutputResetMeaningScope: null,
    selectedSignalType: null,
    selectedSource: null,
    contextSafetyApplied: false,
    contextSafetySignalType: null,
    effectiveSignalType: null,
    effectiveTeaserStrength: null,
    formalResetAccepted: false,
    historyRecordKind: null,
    failureStage: "interrupted_unknown",
    temporalResolutionStatus: "unresolved",
    temporalPrecision: null,
    reasonJa: null,
    evidenceQuote: null,
    status: "api_error",
    attempts: attemptNumber,
    successfulClassifierInvocations: previous?.successfulClassifierInvocations ?? 0,
    rateLimitResponses: previous?.rateLimitResponses ?? 0,
    retrySuppressed: true,
    failureDiagnostics: [],
    latencyMs: previous?.latencyMs ?? 0,
    text: scenario.tweetText,
    promptSize: measureScenarioPromptSize(scenario, promptProfile),
  };
}

function readCheckpoint(outputDir: string): Checkpoint | null {
  const filePath = checkpointPath(outputDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Checkpoint;
    if (parsed.schemaVersion !== 3 || !parsed.evaluationFingerprint ||
      typeof parsed.evaluationFingerprint.value !== "string" ||
      !Array.isArray(parsed.rows) ||
      !Array.isArray(parsed.selectedScenarioIds) || !Number.isInteger(parsed.requestCount) ||
      !Number.isInteger(parsed.requestBudget) || parsed.requestBudget < 1 ||
      parsed.requestBudget > MAX_EVALUATION_REQUEST_BUDGET || parsed.requestCount < 0 ||
      parsed.requestCount > parsed.requestBudget ||
      (parsed.inFlightRequest !== undefined && parsed.inFlightRequest !== null &&
        (typeof parsed.inFlightRequest.scenarioId !== "string" ||
          !Number.isInteger(parsed.inFlightRequest.attemptNumber) || parsed.inFlightRequest.attemptNumber < 1))) {
      throw new Error("Checkpoint schema is unsupported; use a new output directory for this evaluation.");
    }
    const completedAttempts = parsed.rows.reduce((sum, row) => sum + (Number.isInteger(row.attempts) ? row.attempts : 0), 0);
    if (completedAttempts + (parsed.inFlightRequest ? 1 : 0) > parsed.requestCount) {
      throw new Error("Checkpoint request count does not cover its recorded attempts; use a new output directory.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Checkpoint schema")) throw error;
    throw new Error("Checkpoint is unreadable; preserve it and use a new output directory to restart.");
  }
}

function countPersistedResponseAuditRecords(filePath: string) {
  if (!fs.existsSync(filePath)) return 0;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line) as unknown;
    } catch {
      throw new Error("Response audit output is unreadable; preserve it and use a new output directory.");
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Response audit output has an unsupported record; preserve it and use a new output directory.");
    }
    const candidate = record as Record<string, unknown>;
    if (
      candidate.schemaVersion !== 1 ||
      candidate.httpStatus !== 200 ||
      typeof candidate.scenarioId !== "string" ||
      !Number.isInteger(candidate.attemptNumber) ||
      !Array.isArray(candidate.fieldPresence) ||
      !Array.isArray(candidate.invalidFields) ||
      (candidate.fields !== null && (!candidate.fields || typeof candidate.fields !== "object" || Array.isArray(candidate.fields)))
    ) {
      throw new Error("Response audit output has an unsupported record; preserve it and use a new output directory.");
    }
  }
  return lines.length;
}

function percent(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function renderReport(
  model: string,
  rows: ScenarioEvaluationRow[],
  metrics: ScenarioMetrics,
  complete: boolean,
  stoppedAfterRateLimit: boolean,
  metadata: {
    commitSha: string | null;
    fixtureHash: string;
    fixtureName: string;
    promptProfile: TiboGeminiPromptProfile;
    evaluationFingerprint: TiboEvaluationFingerprint;
    startedAt: string;
    completedAt: string | null;
    resumeCount: number;
    rateLimitCount: number;
    requestBudget: number;
    requestCount: number;
    directHttpRequestAttempts: number | null;
    freshApiSuccessesThisRun: number;
    stoppedAfterProviderFailure: boolean;
    responseObservationMode: "none" | "allowlist-v1";
    responseAuditFileName: string | null;
    responseAuditRecordCount: number;
    responseAuditObserverFailureCount: number;
  },
) {
  const status = complete ? "complete" : "incomplete";
  const lines = [
    "# Tibo Scenario Evaluation",
    "",
    `- status: **${status}**`,
    `- model: \`${model}\``,
    `- commit SHA: \`${metadata.commitSha ?? "unknown"}\``,
    `- fixture: \`${metadata.fixtureName}\``,
    `- prompt profile: \`${metadata.promptProfile}\``,
    `- system prompt SHA-256: \`${metadata.evaluationFingerprint.systemPromptSha256}\``,
    `- fixture SHA-256: \`${metadata.fixtureHash}\``,
    `- evaluation processing fingerprint: \`${metadata.evaluationFingerprint.value}\``,
    `- scenario count: ${rows.length}`,
    `- classifier invocations / budget: ${metadata.requestCount} / ${metadata.requestBudget}`,
    `- direct HTTP request attempts: ${metadata.directHttpRequestAttempts ?? "not observable for injected classifier"}`,
    `- direct API successes in this run: ${metadata.freshApiSuccessesThisRun}`,
    `- successful-response field audit: ${metadata.responseObservationMode}; records: ${metadata.responseAuditRecordCount}; observer failures: ${metadata.responseAuditObserverFailureCount}`,
    `- allowlist audit file: ${metadata.responseAuditFileName ?? "disabled"}`,
    `- started at: ${metadata.startedAt}`,
    `- completed at: ${metadata.completedAt ?? "—"}`,
    `- resume count: ${metadata.resumeCount}`,
    `- 429 count: ${metadata.rateLimitCount}`,
    "- production safety guard enabled: yes",
    `- valid predictions: ${metrics.validPredictions}`,
    `- API failures / invalid predictions: ${metrics.invalidPredictions}`,
    `- failure stages: ${JSON.stringify(rows.reduce<Record<string, number>>((counts, row) => {
      if (row.failureStage !== "none") counts[row.failureStage] = (counts[row.failureStage] ?? 0) + 1;
      return counts;
    }, {}))}`,
    `- rate limited stop: ${stoppedAfterRateLimit ? "yes" : "no"}`,
    `- provider failure stop: ${metadata.stoppedAfterProviderFailure ? "yes" : "no"}`,
    "- raw audit fields, returned teaser strength, selection, context-safety decision, effective class, and formal-history admission are reported separately",
    "- optional allowlist-v1 audit records parsed model fields before classifier schema/evidence/safety guards; it never stores raw provider bodies, non-200 bodies, keys, or URLs",
    "- the allowlist audit records field presence separately from explicit null and excludes unapproved model fields",
    "- mocked fixture outputs are used only by offline tests and never counted as API successes",
    "- existing 23-post evaluation: unchanged and separate",
    "- production DB/webhook writes: none",
    "",
    "## Overall",
    "",
    `- accuracy: ${percent(metrics.accuracy)}`,
    `- macro F1: ${percent(metrics.macroF1)}`,
    `- reset-related precision / recall / F1: ${percent(metrics.binaryResetRelated.precision)} / ${percent(metrics.binaryResetRelated.recall)} / ${percent(metrics.binaryResetRelated.f1)}`,
    `- temporal direction accuracy: ${percent(metrics.temporalDirectionAccuracy)}`,
    `- teaser strength accuracy: ${percent(metrics.teaserStrengthAccuracy)}`,
    `- temporal resolution accuracy: ${percent(metrics.temporalResolutionAccuracy)}`,
    `- temporal precision accuracy: ${percent(metrics.temporalPrecisionAccuracy)}`,
    `- notice timing status accuracy: ${percent(metrics.noticeTimingStatusAccuracy)}`,
    `- reset method accuracy: ${percent(metrics.resetMeaningMethodAccuracy)}`,
    `- reset scope accuracy: ${percent(metrics.resetMeaningScopeAccuracy)}`,
    `- history record kind accuracy: ${percent(metrics.historyRecordKindAccuracy)}`,
    "",
    "## Per class",
    "",
    "| Class | Support | Precision | Recall | F1 |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...SIGNAL_TYPES.map((signalType) => {
      const item = metrics.byClass[signalType];
      return `| ${signalType} | ${item.support} | ${percent(item.precision)} | ${percent(item.recall)} | ${percent(item.f1)} |`;
    }),
    "",
    "## Category",
    "",
    "| Category | Total | Evaluated | Correct | Accuracy |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...Object.entries(metrics.byCategory).sort(([left], [right]) => left.localeCompare(right)).map(([category, item]) =>
      `| ${category} | ${item.total} | ${item.evaluated} | ${item.correct} | ${percent(item.accuracy)} |`,
    ),
    "",
    "## Confusion matrix",
    "",
    "```json",
    JSON.stringify(metrics.confusion, null, 2),
    "```",
    "",
    "## False positives",
    "",
    ...(metrics.falsePositives.length
      ? metrics.falsePositives.map((item) => `- **${item.id}** (${item.category}) → ${item.predicted}: ${item.text}`)
      : ["- none"]),
    "",
    "## False negatives",
    "",
    ...(metrics.falseNegatives.length
      ? metrics.falseNegatives.map((item) => `- **${item.id}** (${item.category}) → irrelevant: ${item.text}`)
      : ["- none"]),
    "",
    "## Case results",
    "",
    "| ID | Expected | Raw AI | Time | Timing status | Teaser | Method | Scope | Selected | Source | Effective | Formal reset | History kind expected → actual | Status | Fail stage |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.id} | ${row.expectedSignalType} | ${row.rawSignalType ?? "—"} | ${row.rawTemporalDirection ?? "—"} | ${row.modelOutputNoticeTimingStatus ?? "—"} | ${row.classifierReturnedTeaserStrength ?? "—"} | ${row.modelOutputResetMeaningMethod ?? "—"} | ${row.modelOutputResetMeaningScope ?? "—"} | ${row.selectedSignalType ?? "—"} | ${row.selectedSource ?? "—"} | ${row.effectiveSignalType ?? "—"} | ${row.formalResetAccepted ? row.historyRecordKind ?? "yes" : "no"} | ${row.expectedHistoryRecordKind ?? "—"} → ${row.historyRecordKind ?? "—"} | ${row.status} | ${row.failureStage} |`),
    "",
    "This is a manual classifier evaluation only. It never writes synthetic data to Production and does not change the existing 23-post historical evaluation.",
    "",
  ];
  return lines.join("\n");
}

function writePromptInputLengthReport(args: Map<string, string>, cwd = process.cwd()) {
  const { fixtureName, fixture } = getFixture(args);
  const promptProfile = parseTiboGeminiPromptProfile(args.get("prompt-profile"));
  const systemPromptSha256 = createHash("sha256").update(getTiboGeminiSystemPrompt(promptProfile)).digest("hex");
  const measuredAt = new Date().toISOString();
  const rows = fixture.scenarios.map((scenario) => ({
    id: scenario.id,
    category: scenario.category,
    ...measureScenarioPromptSize(scenario, promptProfile),
  }));
  const outputDir = path.resolve(cwd, args.get("output-dir") ?? `scratch/${fixtureName}-prompt-input-lengths`);
  fs.mkdirSync(outputDir, { recursive: true });
  const report = {
    schemaVersion: 1,
    fixtureName,
    promptProfile,
    systemPromptSha256,
    fixtureScenarioCount: fixture.scenarios.length,
    measuredAt,
    modelCalls: 0,
    rows,
  };
  const lines = [
    "# Tibo Prompt Input Lengths",
    "",
    `- fixture: \`${fixtureName}\``,
    `- prompt profile: \`${promptProfile}\``,
    `- system prompt SHA-256: \`${systemPromptSha256}\``,
    `- cases measured: ${rows.length}`,
    `- measured at: ${measuredAt}`,
    "- model calls: 0",
    "- character counts use the selected fixed system prompt and the unchanged user prompt builder",
    "- no-graph measurement removes only the validated evidence graph input",
    "",
    "| ID | Graph input | System chars | User chars with graph | User chars without graph | Difference | Combined chars with graph | Combined chars without graph |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.id} | ${row.graphInputIncluded ? "yes" : "no"} | ${row.systemPromptChars} | ${row.userPromptCharsWithGraph} | ${row.userPromptCharsWithoutGraph} | ${row.userPromptCharsWithGraph - row.userPromptCharsWithoutGraph} | ${row.combinedPromptCharsWithGraph} | ${row.combinedPromptCharsWithoutGraph} |`),
    "",
  ];
  fs.writeFileSync(path.join(outputDir, "prompt-input-lengths.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputDir, "prompt-input-lengths.md"), lines.join("\n"), "utf8");
  console.log(`Measured ${rows.length} prompt inputs with no model calls.`);
  console.log(`Wrote ${path.join(outputDir, "prompt-input-lengths.md")}`);
}

export async function runTiboScenarioEvaluation(
  argv: string[],
  dependencies: TiboScenarioEvaluationDependencies = {},
): Promise<TiboScenarioEvaluationReport | undefined> {
  const args = parseArgs(argv);
  const cwd = dependencies.cwd ?? process.cwd();
  const projectRoot = dependencies.projectRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (args.has("help")) {
    console.log("Usage: corepack pnpm run eval:tibo-scenarios -- [--live] [--fixture legacy|balanced-v1|balanced|balanced-canonical] [--prompt-profile production|compact-v1] [--request-budget 1..16] [--resume] [--limit N] [--ids id1,id2] [--capture-provider-fields] [--output-dir DIR]");
    console.log("Offline prompt sizing: corepack pnpm run eval:tibo-scenarios -- --measure-input-lengths --fixture balanced-canonical [--prompt-profile production|compact-v1] [--output-dir DIR]");
    console.log("Live mode requires --live. The direct evaluator also requires the production model and GEMINI_EVALUATION_FREE_TIER_CONFIRMED=true. Offline prompt sizing performs no API calls.");
    return;
  }
  const promptProfile = parseTiboGeminiPromptProfile(args.get("prompt-profile"));
  if (args.has("capture-provider-fields") &&
    (!args.has("live") || args.has("measure-input-lengths") || dependencies.classify !== undefined)) {
    throw new Error("--capture-provider-fields requires live mode with the direct Gemini classifier.");
  }
  if (args.has("measure-input-lengths")) {
    writePromptInputLengthReport(args, cwd);
    return;
  }
  if (!args.has("live")) {
    console.log("No API calls made. Use --measure-input-lengths for offline prompt sizing or --live for model evaluation.");
    return;
  }

  const { fixtureName, fixture } = getFixture(args);
  const outputDir = path.resolve(cwd, args.get("output-dir") ?? "scratch/tibo-scenario-evaluation");
  fs.mkdirSync(outputDir, { recursive: true });
  const captureProviderFields = args.has("capture-provider-fields");
  const responseAuditFileName = "model-response-fields.jsonl";
  const responseAuditPath = path.join(outputDir, responseAuditFileName);
  const checkpointExists = fs.existsSync(checkpointPath(outputDir));
  if (checkpointExists && !args.has("resume")) {
    throw new Error("Checkpoint already exists; use --resume or choose a new output directory.");
  }
  if (args.has("resume") && !checkpointExists) {
    throw new Error("Cannot resume without a checkpoint; choose a new output directory for a new evaluation.");
  }
  if (!args.has("resume") && ["report.json", "report.md"].some((fileName) => fs.existsSync(path.join(outputDir, fileName)))) {
    throw new Error("Evaluation report already exists; choose a new output directory.");
  }
  if (fs.existsSync(responseAuditPath) && !args.has("resume")) {
    throw new Error("Response audit output already exists; resume its matching checkpoint or choose a new output directory.");
  }
  const checkpoint = args.has("resume") ? readCheckpoint(outputDir) : null;

  if (dependencies.apiKey === undefined || dependencies.model === undefined) loadLocalEnvironment(cwd);
  const apiKey = (dependencies.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
  const model = (dependencies.model ?? process.env.GEMINI_MODEL)?.trim();
  if (!apiKey || !model) {
    console.log("SKIPPED: GEMINI_API_KEY or GEMINI_MODEL is not configured; no API call was made.");
    return;
  }
  if (dependencies.classify === undefined) {
    if (model !== "gemini-3.5-flash-lite") {
      throw new Error("Live evaluation is restricted to the current production model gemini-3.5-flash-lite.");
    }
    if (process.env.GEMINI_EVALUATION_FREE_TIER_CONFIRMED !== "true") {
      throw new Error("Live evaluation is blocked until GEMINI_EVALUATION_FREE_TIER_CONFIRMED=true is set after verifying evaluation-only free quota.");
    }
  }
  if (checkpoint && checkpoint.model !== model) {
    throw new Error("Checkpoint model differs from GEMINI_MODEL; use a new output directory.");
  }
  if (checkpoint && checkpoint.fixtureName !== fixtureName) {
    throw new Error("Checkpoint fixture differs from the requested fixture; use a new output directory.");
  }

  const requestedBudget = args.has("request-budget") ? Number(args.get("request-budget")) : undefined;
  if (checkpoint && requestedBudget !== undefined && requestedBudget > checkpoint.requestBudget) {
    throw new Error("A resumed evaluation cannot increase its original request budget.");
  }
  if (checkpoint && requestedBudget !== undefined && requestedBudget < checkpoint.requestCount) {
    throw new Error("A resumed request budget cannot be lower than classifier invocations already made.");
  }
  const requestBudget = requestBudgetForBatch(requestedBudget ?? checkpoint?.requestBudget);
  const fixtureHash = getFixtureHash(fixtureName, projectRoot);
  if (checkpoint && checkpoint.fixtureHash !== fixtureHash) {
    throw new Error("Fixture content differs from the checkpoint; use a new output directory.");
  }

  const requestedIds = args.get("ids")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean) ?? (checkpoint ? checkpoint.selectedScenarioIds : undefined);
  if (requestedIds && new Set(requestedIds).size !== requestedIds.length) {
    throw new Error("Scenario IDs must be unique.");
  }
  const parsedLimit = args.has("limit") ? Number(args.get("limit")) : undefined;
  if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  const selectedScenarios = requestedIds
    ? fixture.scenarios.filter((scenario) => requestedIds.includes(scenario.id))
    : fixture.scenarios.slice(0, Math.min(fixture.scenarios.length, parsedLimit ?? requestBudget));
  if (requestedIds && selectedScenarios.length !== requestedIds.length) {
    const selectedIds = new Set(selectedScenarios.map((scenario) => scenario.id));
    const missingIds = requestedIds.filter((id) => !selectedIds.has(id));
    throw new Error(`Unknown scenario id(s): ${missingIds.join(", ")}`);
  }
  const selectedScenarioIds = selectedScenarios.map((scenario) => scenario.id);
  if (checkpoint && JSON.stringify(checkpoint.selectedScenarioIds) !== JSON.stringify(selectedScenarioIds)) {
    throw new Error("Selected scenario set differs from the checkpoint; resume with the original IDs or use a new output directory.");
  }
  const currentCommitSha = getCommitSha(projectRoot);
  const evaluationFingerprint = buildTiboEvaluationFingerprint(
    fixtureName,
    fixtureHash,
    selectedScenarios,
    currentCommitSha,
    model,
    projectRoot,
    captureProviderFields ? "allowlist-v1" : "none",
    promptProfile,
  );
  if (checkpoint && checkpoint.evaluationFingerprint.value !== evaluationFingerprint.value) {
    throw new Error("Checkpoint evaluation processing fingerprint differs from the selected prompt profile/hash, generation settings, or processing code; use a new output directory.");
  }
  if (captureProviderFields && checkpoint && (checkpoint.responseAuditObserverFailureCount ?? 0) > 0 && !fs.existsSync(responseAuditPath)) {
    throw new Error("Checkpoint records response observer failures but its audit output is missing; preserve the checkpoint and choose a new output directory.");
  }
  const persistedResponseAuditRecordCount = captureProviderFields
    ? countPersistedResponseAuditRecords(responseAuditPath)
    : 0;
  if (captureProviderFields && checkpoint && (checkpoint.responseAuditRecordCount ?? 0) > persistedResponseAuditRecordCount) {
    throw new Error("Checkpoint records more successful responses than its audit output; preserve it and choose a new output directory.");
  }
  const commitSha = checkpoint?.commitSha ?? currentCommitSha;
  const classifier = dependencies.classify ?? classifyWithGemini;
  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();
  const resumeCount = (checkpoint?.resumeCount ?? 0) + (checkpoint ? 1 : 0);
  let rateLimitCount = checkpoint?.rateLimitCount ?? 0;
  let requestCount = checkpoint?.requestCount ?? 0;
  let responseAuditRecordCount = persistedResponseAuditRecordCount;
  let responseAuditObserverFailureCount = checkpoint?.responseAuditObserverFailureCount ?? 0;
  let freshApiSuccessesThisRun = 0;
  let reusedCheckpointSuccesses = 0;
  let stoppedAfterRateLimit = checkpoint?.stoppedAfterRateLimit ?? false;
  let stoppedAfterProviderFailure = checkpoint?.stoppedAfterProviderFailure ??
    (checkpoint?.rows.some((row) => shouldStopForProviderFailure(row)) ?? false);
  let stoppedAtRequestBudget = false;
  const rowsById = new Map<string, ScenarioEvaluationRow>(
    (checkpoint?.rows ?? []).map((row) => [row.id, row]),
  );
  let inFlightRequest = checkpoint?.inFlightRequest ?? null;
  const responseAudit = captureProviderFields
    ? async (context: GeminiResponseAuditContext, action: () => Promise<GeminiClassificationOutput>) => {
        const result = await withGeminiEvaluationResponseAudit(
          https,
          context,
          (record) => fs.appendFileSync(responseAuditPath, `${JSON.stringify(record)}\n`, "utf8"),
          action,
          [apiKey],
        );
        responseAuditRecordCount += result.recordCount;
        responseAuditObserverFailureCount += result.observerFailureCount;
        return result;
      }
    : undefined;

  if (inFlightRequest) {
    const scenario = selectedScenarios.find((item) => item.id === inFlightRequest!.scenarioId);
    if (!scenario) throw new Error("Checkpoint has an in-flight scenario outside the selected set.");
    const previous = rowsById.get(scenario.id);
    if (inFlightRequest.attemptNumber !== (previous?.attempts ?? 0) + 1) {
      throw new Error("Checkpoint in-flight attempt does not follow the recorded scenario attempts.");
    }
    rowsById.set(scenario.id, buildInterruptedRow(scenario, previous, inFlightRequest.attemptNumber, promptProfile));
    inFlightRequest = null;
    stoppedAfterProviderFailure = true;
    writeCheckpoint(outputDir, {
      schemaVersion: 3,
      model,
      fixtureName,
      fixtureScenarioCount: fixture.scenarios.length,
      selectedScenarioIds,
      rows: Array.from(rowsById.values()),
      stoppedAfterRateLimit,
      stoppedAfterProviderFailure,
      requestBudget,
      requestCount,
      inFlightRequest,
      updatedAt: new Date().toISOString(),
      commitSha,
      fixtureHash,
      evaluationFingerprint,
      startedAt,
      resumeCount,
      rateLimitCount,
      responseAuditRecordCount,
      responseAuditObserverFailureCount,
    });
    console.log(`${scenario.id}: previous invocation outcome unknown; resume suppressed to avoid duplication`);
  }

  let stopEvaluationAfterRateLimit = stoppedAfterRateLimit;

  for (const scenario of selectedScenarios) {
    if (stopEvaluationAfterRateLimit || stoppedAfterProviderFailure) break;
    let row = rowsById.get(scenario.id);
    if (row && !isScenarioResumeEligible(row)) {
      if (row.status === "success") reusedCheckpointSuccesses += 1;
      continue;
    }

    while (isScenarioResumeEligible(row)) {
      if (!canStartEvaluationRequest(requestCount, requestBudget)) {
        stoppedAtRequestBudget = true;
        break;
      }
      const previousAttempts = row?.attempts ?? 0;
      if (previousAttempts >= MAX_ATTEMPTS_PER_SCENARIO) break;
      const previousSuccesses = row?.successfulClassifierInvocations ?? 0;
      const previousRateLimits = row?.rateLimitResponses ?? 0;
      const evaluated = await evaluateScenario(
        scenario,
        model,
        apiKey,
        classifier,
        previousAttempts,
        previousSuccesses,
        previousRateLimits,
        (attemptNumber) => {
          requestCount += 1;
          inFlightRequest = { scenarioId: scenario.id, attemptNumber, startedAt: new Date().toISOString() };
          writeCheckpoint(outputDir, {
            schemaVersion: 3,
            model,
            fixtureName,
            fixtureScenarioCount: fixture.scenarios.length,
            selectedScenarioIds,
            rows: Array.from(rowsById.values()),
            stoppedAfterRateLimit,
            stoppedAfterProviderFailure,
            requestBudget,
            requestCount,
            inFlightRequest,
            updatedAt: new Date().toISOString(),
            commitSha,
            fixtureHash,
            evaluationFingerprint,
            startedAt,
            resumeCount,
            rateLimitCount,
            responseAuditRecordCount,
            responseAuditObserverFailureCount,
          });
        },
        responseAudit,
        promptProfile,
      );
      freshApiSuccessesThisRun += evaluated.successfulClassifierInvocations - previousSuccesses;
      rateLimitCount += evaluated.rateLimitResponses - previousRateLimits;
      row = evaluated;
      rowsById.set(scenario.id, row);
      inFlightRequest = null;
      stoppedAfterRateLimit = row.status === "rate_limited" || stoppedAfterRateLimit;
      if (shouldStopForProviderFailure(row)) stoppedAfterProviderFailure = true;
      writeCheckpoint(outputDir, {
        schemaVersion: 3,
        model,
        fixtureName,
        fixtureScenarioCount: fixture.scenarios.length,
        selectedScenarioIds,
        rows: Array.from(rowsById.values()),
        stoppedAfterRateLimit,
        stoppedAfterProviderFailure,
        requestBudget,
        requestCount,
        inFlightRequest,
        updatedAt: new Date().toISOString(),
        commitSha,
        fixtureHash,
        evaluationFingerprint,
        startedAt,
        resumeCount,
        rateLimitCount,
        responseAuditRecordCount,
        responseAuditObserverFailureCount,
      });
      console.log(`${row.id}: ${row.status}${row.predictedSignalType ? ` → ${row.predictedSignalType}` : ""}`);
      if (row.status === "rate_limited") {
        stopEvaluationAfterRateLimit = true;
        break;
      }
      if (stoppedAfterProviderFailure) break;
      if (!AUTO_RETRY_STATUSES.has(row.status) || !isScenarioResumeEligible(row)) break;
      await sleep(1500);
    }
    if (stopEvaluationAfterRateLimit || stoppedAfterProviderFailure) break;
  }

  const rows = selectedScenarios
    .map((scenario) => rowsById.get(scenario.id))
    .filter((row): row is ScenarioEvaluationRow => Boolean(row));
  const complete = rows.length === selectedScenarios.length && rows.every((row) => row.status === "success");
  const metrics = calculateScenarioMetrics(rows);
  const completedAt = complete ? new Date().toISOString() : null;
  const resumeCommand = [
    "corepack pnpm run eval:tibo-scenarios -- --live --resume",
    `--fixture ${fixtureName}`,
    `--prompt-profile ${promptProfile}`,
    `--request-budget ${requestBudget}`,
    args.has("ids") ? `--ids ${selectedScenarioIds.join(",")}` : "",
    `--output-dir ${outputDir}`,
  ].filter(Boolean).join(" ");
  const report: TiboScenarioEvaluationReport = {
    schemaVersion: 3,
    status: complete ? "complete" : "incomplete",
    complete,
    model,
    promptProfile,
    commitSha,
    fixtureName,
    fixtureHash,
    evaluationFingerprint,
    startedAt,
    completedAt,
    resumeCount,
    rateLimitCount,
    requestBudget,
    classifierInvocations: requestCount,
    directHttpRequestAttempts: classifier === classifyWithGemini ? requestCount : null,
    freshApiSuccessesThisRun,
    reusedCheckpointSuccesses,
    apiSuccessDefinition: "Direct classifyWithGemini invocations returning status=success in this run; checkpoint-reused rows and fixed-output tests are excluded.",
    productionSafetyGuardEnabled: true,
    fixtureScenarioCount: fixture.scenarios.length,
    selectedScenarioCount: selectedScenarios.length,
    evaluatedScenarioCount: rows.length,
    existingHistoricalEvaluation23Unchanged: true,
    mockScenarioLab145Unchanged: true,
    productionWrites: false,
    stoppedAfterRateLimit,
    stoppedAfterProviderFailure,
    stoppedAtRequestBudget,
    modelResponseFieldAudit: {
      mode: captureProviderFields ? "allowlist-v1" : "none",
      fileName: captureProviderFields ? responseAuditFileName : null,
      recordCount: responseAuditRecordCount,
      observerFailureCount: responseAuditObserverFailureCount,
    },
    metrics,
    rows,
    resumeCommand,
  };
  fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(outputDir, "report.md"),
    `${renderReport(model, rows, metrics, complete, stoppedAfterRateLimit, {
      commitSha,
      fixtureHash,
      fixtureName,
      promptProfile,
      evaluationFingerprint,
      startedAt,
      completedAt,
      resumeCount,
      rateLimitCount,
      requestBudget,
      requestCount,
      directHttpRequestAttempts: classifier === classifyWithGemini ? requestCount : null,
      freshApiSuccessesThisRun,
      stoppedAfterProviderFailure,
      responseObservationMode: captureProviderFields ? "allowlist-v1" : "none",
      responseAuditFileName: captureProviderFields ? responseAuditFileName : null,
      responseAuditRecordCount,
      responseAuditObserverFailureCount,
    })}\n`,
    "utf8",
  );
  console.log(`Wrote ${path.join(outputDir, "report.json")}`);
  console.log(`Status: ${report.status}; prompt profile: ${promptProfile}; fresh API successes this run: ${freshApiSuccessesThisRun}; classifier invocations: ${requestCount}/${requestBudget}`);
  return report;
}

if (isMainModule()) {
  runTiboScenarioEvaluation(process.argv.slice(2)).catch((error) => {
    console.error(`Scenario evaluation failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
