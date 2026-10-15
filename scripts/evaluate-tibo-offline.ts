import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TIBO_GEMINI_SYSTEM_PROMPT } from "../lib/radar/geminiClassification";
import scenariosJson from "../tests/fixtures/tibo-scenarios.json";
import realPostsJson from "../tests/fixtures/tibo-real-posts-v1.json";

export const SIGNAL_TYPES = ["reset_executed", "official_notice", "teaser", "irrelevant"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
export type DecisionLabel = SignalType | "abstain";
export type EvaluationSplit = "development" | "holdout_candidate" | "regression";
export type ResponseStatus =
  | "success"
  | "http_401"
  | "http_403"
  | "http_429"
  | "timeout"
  | "http_5xx"
  | "invalid_json"
  | "missing_fields"
  | "not_run";

export type OfflineEvaluationCase = {
  id: string;
  eventGroupId: string;
  split: EvaluationSplit;
  layer: string;
  inputCondition: string;
  gold: {
    decision: "classify" | "abstain" | "ambiguous";
    signalType: SignalType | null;
    acceptedSignalTypes?: Array<SignalType | "abstain">;
    rationale: string;
  };
};

export type OfflineLayerPrediction = {
  availability: "available" | "unavailable";
  signalType: DecisionLabel | null;
  confidence?: number | null;
  relatedEventGroupId?: string | null;
  duplicateCount?: number | null;
  temporal?: {
    startAt: string | null;
    endAt: string | null;
    precision: string | null;
    basePostId: string | null;
  } | null;
};

export type StoredOfflineOutcome = {
  id: string;
  responseStatus: ResponseStatus;
  rawAi: OfflineLayerPrediction;
  corrected: OfflineLayerPrediction;
  publicOutcome: OfflineLayerPrediction;
  latencyMs: number | null;
  tokenUsage: number | null;
};

export type OfflineRunIdentity = {
  fixtureHash: string;
  promptHash: string;
  schemaHash: string;
  optionsHash: string;
  commitSha: string;
  provider: string;
  model: string;
  modelVersion: string;
  inputCondition: string;
};

export type OfflineLayerMetrics = {
  availability: "available" | "unavailable";
  allRequestCorrect: number;
  allRequestAccuracy: number | null;
  successfulRequests: number;
  successfulCorrect: number;
  successOnlyAccuracy: number | null;
  correctAbstentions: number;
  abstentionMisses: number;
  ambiguousCases: number;
  byClass: Record<SignalType, { support: number; predicted: number; truePositive: number; precision: number | null; recall: number | null; f1: number | null }>;
  confusion: Record<SignalType | "abstain_expected" | "ambiguous_expected", Record<SignalType | "abstain" | "no_valid_prediction", number>>;
  byConfidenceThreshold: Record<string, { accepted: number; correct: number; accuracy: number | null; adoptionRate: number | null }>;
  eventAssociation: { evaluated: number; errors: number; duplicateEvents: number };
  temporal: { evaluated: number; exactWindowMatches: number; precisionMatches: number; basePostMatches: number };
};

export type OfflineEvaluationReport = {
  totalCases: number;
  successfulResponses: number;
  responseStatus: Record<ResponseStatus, number>;
  rawAi: OfflineLayerMetrics;
  corrected: OfflineLayerMetrics;
  publicOutcome: OfflineLayerMetrics;
  missingOutcomeIds: string[];
};

const VALID_SIGNAL_TYPES = new Set<string>(SIGNAL_TYPES);
const FAILURE_STATUSES = new Set<ResponseStatus>([
  "http_401", "http_403", "http_429", "timeout", "http_5xx", "invalid_json", "missing_fields", "not_run",
]);
const ALL_RESPONSE_STATUSES: ResponseStatus[] = [
  "success", "http_401", "http_403", "http_429", "timeout", "http_5xx", "invalid_json", "missing_fields", "not_run",
];
const SCHEMA_CONTRACT = {
  version: 1,
  responseStatus: ["success", "http_401", "http_403", "http_429", "timeout", "http_5xx", "invalid_json", "missing_fields", "not_run"],
  layers: ["rawAi", "corrected", "publicOutcome"],
  signalTypes: SIGNAL_TYPES,
  abstain: "separate decision, never encoded as irrelevant",
};
const REQUEST_OPTIONS_CONTRACT = {
  stage: "offline-only",
  responseMimeType: "application/json",
  providerSchema: "not supplied by current production wrapper",
  retryPolicy: "not-executed-in-stage-1",
};
const CONFIDENCE_THRESHOLDS = [0.5, 0.8, 0.9] as const;
const hashText = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const hashJson = (value: unknown) => hashText(stableStringify(value));

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function buildRunIdentityHash(identity: OfflineRunIdentity) {
  return hashJson(identity);
}

export function isCheckpointCompatible(
  identity: OfflineRunIdentity,
  checkpoint: { identityHash?: unknown; identity?: unknown } | null | undefined,
) {
  return checkpoint?.identityHash === buildRunIdentityHash(identity)
    && (checkpoint.identity === undefined || stableStringify(checkpoint.identity) === stableStringify(identity));
}

export function normalizeStoredOutcome(input: Record<string, unknown>): StoredOfflineOutcome {
  const id = typeof input.id === "string" ? input.id : "";
  const responseStatus = isResponseStatus(input.responseStatus) ? input.responseStatus : "missing_fields";
  const responseSuccess = responseStatus === "success";
  const makeLayer = (key: "rawAi" | "corrected" | "publicOutcome"): OfflineLayerPrediction => {
    const raw = input[key] && typeof input[key] === "object" ? input[key] as Record<string, unknown> : null;
    if (!responseSuccess || !raw || raw.availability !== "available" || !isDecisionLabel(raw.signalType)) {
      return { availability: "unavailable", signalType: null, confidence: null };
    }
    const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : null;
    return {
      availability: "available",
      signalType: raw.signalType,
      confidence,
      relatedEventGroupId: typeof raw.relatedEventGroupId === "string" ? raw.relatedEventGroupId : null,
      duplicateCount: typeof raw.duplicateCount === "number" && Number.isFinite(raw.duplicateCount)
        ? Math.max(0, Math.trunc(raw.duplicateCount))
        : null,
      temporal: raw.temporal && typeof raw.temporal === "object"
        ? raw.temporal as OfflineLayerPrediction["temporal"]
        : null,
    };
  };

  return {
    id,
    responseStatus,
    rawAi: makeLayer("rawAi"),
    corrected: makeLayer("corrected"),
    publicOutcome: makeLayer("publicOutcome"),
    latencyMs: typeof input.latencyMs === "number" && input.latencyMs >= 0 ? input.latencyMs : null,
    tokenUsage: typeof input.tokenUsage === "number" && input.tokenUsage >= 0 ? input.tokenUsage : null,
  };
}

function isResponseStatus(value: unknown): value is ResponseStatus {
  return typeof value === "string" && ALL_RESPONSE_STATUSES.includes(value as ResponseStatus);
}

function isDecisionLabel(value: unknown): value is DecisionLabel {
  return value === "abstain" || (typeof value === "string" && VALID_SIGNAL_TYPES.has(value));
}

function emptyConfusion(): OfflineLayerMetrics["confusion"] {
  const buckets = [...SIGNAL_TYPES, "abstain_expected", "ambiguous_expected"] as const;
  const predictions = [...SIGNAL_TYPES, "abstain", "no_valid_prediction"] as const;
  return Object.fromEntries(buckets.map((bucket) => [
    bucket,
    Object.fromEntries(predictions.map((prediction) => [prediction, 0])),
  ])) as OfflineLayerMetrics["confusion"];
}

function scoreLayer(
  cases: OfflineEvaluationCase[],
  outcomesById: Map<string, StoredOfflineOutcome>,
  layerName: "rawAi" | "corrected" | "publicOutcome",
): OfflineLayerMetrics {
  const confusion = emptyConfusion();
  const truePositive = Object.fromEntries(SIGNAL_TYPES.map((signal) => [signal, 0])) as Record<SignalType, number>;
  const predicted = Object.fromEntries(SIGNAL_TYPES.map((signal) => [signal, 0])) as Record<SignalType, number>;
  const support = Object.fromEntries(SIGNAL_TYPES.map((signal) => [signal, 0])) as Record<SignalType, number>;
  let successfulRequests = 0;
  let successfulCorrect = 0;
  let allRequestCorrect = 0;
  let correctAbstentions = 0;
  let abstentionMisses = 0;
  let ambiguousCases = 0;
  let availablePredictions = 0;
  let eventAssociationEvaluated = 0;
  let eventAssociationErrors = 0;
  let duplicateEvents = 0;
  let temporalEvaluated = 0;
  let exactWindowMatches = 0;
  let precisionMatches = 0;
  let basePostMatches = 0;
  const thresholdRows = new Map<number, { accepted: number; correct: number }>(
    CONFIDENCE_THRESHOLDS.map((threshold) => [threshold, { accepted: 0, correct: 0 }]),
  );

  for (const evaluationCase of cases) {
    const outcome = outcomesById.get(evaluationCase.id);
    const responseSuccess = outcome?.responseStatus === "success";
    const layer = outcome?.[layerName] ?? { availability: "unavailable" as const, signalType: null };
    const hasPrediction = responseSuccess && layer.availability === "available" && layer.signalType !== null;
    const prediction = hasPrediction ? layer.signalType! : null;
    const expectedBucket = evaluationCase.gold.decision === "classify"
      ? evaluationCase.gold.signalType!
      : evaluationCase.gold.decision === "abstain" ? "abstain_expected" : "ambiguous_expected";
    const confusionPrediction = prediction ?? "no_valid_prediction";
    confusion[expectedBucket][confusionPrediction] += 1;

    if (responseSuccess) successfulRequests += 1;
    if (hasPrediction) availablePredictions += 1;
    let isCorrect = false;
    if (hasPrediction) {
      if (evaluationCase.gold.decision === "classify") {
        isCorrect = prediction === evaluationCase.gold.signalType;
      } else if (evaluationCase.gold.decision === "abstain") {
        isCorrect = prediction === "abstain";
        if (isCorrect) correctAbstentions += 1;
        else if (prediction !== "abstain") abstentionMisses += 1;
      } else {
        ambiguousCases += 1;
        isCorrect = evaluationCase.gold.acceptedSignalTypes?.includes(prediction as DecisionLabel) ?? false;
      }
    } else if (evaluationCase.gold.decision === "ambiguous") {
      ambiguousCases += 1;
    }
    if (isCorrect) allRequestCorrect += 1;
    if (responseSuccess && isCorrect) successfulCorrect += 1;

    if (evaluationCase.gold.decision === "classify" && evaluationCase.gold.signalType) {
      const expected = evaluationCase.gold.signalType;
      support[expected] += 1;
      if (prediction && SIGNAL_TYPES.includes(prediction as SignalType)) predicted[prediction as SignalType] += 1;
      if (prediction === expected) truePositive[expected] += 1;
    } else if (evaluationCase.gold.decision === "abstain" && prediction && SIGNAL_TYPES.includes(prediction as SignalType)) {
      predicted[prediction as SignalType] += 1;
    }

  for (const [threshold, counts] of Array.from(thresholdRows.entries())) {
      if (!hasPrediction || typeof layer.confidence !== "number" || layer.confidence < threshold) continue;
      counts.accepted += 1;
      if (isCorrect) counts.correct += 1;
    }

    if (outcome?.[layerName].availability === "available" && evaluationCase.gold.decision === "classify") {
      eventAssociationEvaluated += 1;
      if (layer.relatedEventGroupId && layer.relatedEventGroupId !== evaluationCase.eventGroupId) eventAssociationErrors += 1;
      if (typeof layer.duplicateCount === "number" && layer.duplicateCount > 1) duplicateEvents += layer.duplicateCount - 1;
      const goldTemporal = (evaluationCase as OfflineEvaluationCase & { goldTemporal?: NonNullable<OfflineLayerPrediction["temporal"]> }).goldTemporal;
      if (goldTemporal && layer.temporal) {
        temporalEvaluated += 1;
        if (goldTemporal.startAt === layer.temporal.startAt && goldTemporal.endAt === layer.temporal.endAt) exactWindowMatches += 1;
        if (goldTemporal.precision === layer.temporal.precision) precisionMatches += 1;
        if (goldTemporal.basePostId === layer.temporal.basePostId) basePostMatches += 1;
      }
    }
  }

  const byClass = Object.fromEntries(SIGNAL_TYPES.map((signal) => {
    const precision = predicted[signal] === 0 ? null : truePositive[signal] / predicted[signal];
    const recall = support[signal] === 0 ? null : truePositive[signal] / support[signal];
    const f1 = precision === null || recall === null ? null : precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
    return [signal, { support: support[signal], predicted: predicted[signal], truePositive: truePositive[signal], precision, recall, f1 }];
  })) as OfflineLayerMetrics["byClass"];
  const byConfidenceThreshold = Object.fromEntries(Array.from(thresholdRows.entries()).map(([threshold, counts]) => [
    String(threshold), {
      accepted: counts.accepted,
      correct: counts.correct,
      accuracy: counts.accepted === 0 ? null : counts.correct / counts.accepted,
      adoptionRate: cases.length === 0 ? null : counts.accepted / cases.length,
    },
  ]));
  const layerHasAnyOutput = availablePredictions > 0;

  return {
    availability: layerHasAnyOutput ? "available" : "unavailable",
    allRequestCorrect,
    allRequestAccuracy: cases.length === 0 || !layerHasAnyOutput ? null : allRequestCorrect / cases.length,
    successfulRequests,
    successfulCorrect,
    successOnlyAccuracy: successfulRequests === 0 ? null : successfulCorrect / successfulRequests,
    correctAbstentions,
    abstentionMisses,
    ambiguousCases,
    byClass,
    confusion,
    byConfidenceThreshold,
    eventAssociation: { evaluated: eventAssociationEvaluated, errors: eventAssociationErrors, duplicateEvents },
    temporal: { evaluated: temporalEvaluated, exactWindowMatches, precisionMatches, basePostMatches },
  };
}

export function buildOfflineReport(
  cases: OfflineEvaluationCase[],
  outcomes: StoredOfflineOutcome[],
): OfflineEvaluationReport {
  const outcomesById = new Map<string, StoredOfflineOutcome>();
  for (const outcome of outcomes) {
    if (!outcome.id || outcomesById.has(outcome.id)) throw new Error(`Duplicate or empty outcome id: ${outcome.id}`);
    outcomesById.set(outcome.id, outcome);
  }
  const responseStatus = Object.fromEntries(
    ALL_RESPONSE_STATUSES.map((status) => [status, 0]),
  ) as Record<ResponseStatus, number>;
  let successfulResponses = 0;
  for (const evaluationCase of cases) {
    const outcome = outcomesById.get(evaluationCase.id);
    const status = outcome?.responseStatus ?? "not_run";
    responseStatus[status] += 1;
    if (status === "success") successfulResponses += 1;
  }
  return {
    totalCases: cases.length,
    successfulResponses,
    responseStatus,
    rawAi: scoreLayer(cases, outcomesById, "rawAi"),
    corrected: scoreLayer(cases, outcomesById, "corrected"),
    publicOutcome: scoreLayer(cases, outcomesById, "publicOutcome"),
    missingOutcomeIds: cases.filter((item) => !outcomesById.has(item.id)).map((item) => item.id),
  };
}

export function buildDryRunSummary(input: { fixtureCaseCount: number; selectedCaseCount: number }) {
  const text = [
    "Tibo classification evaluation dry-run",
    `- fixture cases: ${input.fixtureCaseCount}`,
    `- selected cases: ${input.selectedCaseCount}`,
    "- current API calls: 0",
    "- current network: none",
    "- current DB writes: 0",
    "- current provider/model: not run",
    "- future stage 2 diagnostic: 12 inputs × 4 conditions = 48 base calls",
    "- future stage 2 maximum HTTP attempts: 60 (not executed in stage 1)",
  ].join("\n");
  return {
    fixtureCaseCount: input.fixtureCaseCount,
    selectedCaseCount: input.selectedCaseCount,
    currentApiCalls: 0,
    currentNetworkRequests: 0,
    currentDbWrites: 0,
    nextStageBaseCalls: 48,
    nextStageMaxHttpAttempts: 60,
    text,
  };
}

export function validateRealPostFixture(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Real-post fixture must be an object");
  const fixture = value as { schemaVersion?: unknown; posts?: unknown };
  if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.posts)) throw new Error("Unsupported real-post fixture shape");
  const ids = new Set<string>();
  const splitByGroup = new Map<string, string>();
  for (const item of fixture.posts) {
    if (!item || typeof item !== "object") throw new Error("Invalid real-post record");
    const post = item as Record<string, unknown>;
    if (typeof post.tweetId !== "string" || !/^\d{1,30}$/.test(post.tweetId) || ids.has(post.tweetId)) {
      throw new Error(`Invalid or duplicate tweet ID: ${String(post.tweetId)}`);
    }
    ids.add(post.tweetId);
    const statusId = typeof post.url === "string" ? post.url.match(/\/status\/(\d+)(?:[/?#]|$)/)?.[1] : null;
    if (statusId !== post.tweetId) throw new Error(`Tweet URL does not match ID ${post.tweetId}`);
    if (typeof post.text !== "string" || !post.text.trim()) throw new Error(`Missing source text ${post.tweetId}`);
    if (typeof post.author !== "string" || !post.author.trim()) throw new Error(`Missing author ${post.tweetId}`);
    if (typeof post.tweetCreatedAt !== "string" || !Number.isFinite(Date.parse(post.tweetCreatedAt))) throw new Error(`Invalid timestamp ${post.tweetId}`);
    if (!Array.isArray(post.sourceCitations) || post.sourceCitations.length === 0) throw new Error(`Missing source citation ${post.tweetId}`);
    if (!post.gold || typeof post.gold !== "object") throw new Error(`Missing gold label ${post.tweetId}`);
    const gold = post.gold as Record<string, unknown>;
    if (!(gold.decision === "classify" || gold.decision === "abstain" || gold.decision === "ambiguous") || typeof gold.rationale !== "string" || !gold.rationale.trim()) {
      throw new Error(`Invalid gold decision or rationale ${post.tweetId}`);
    }
    if (typeof post.eventGroupId !== "string" || !post.eventGroupId) throw new Error(`Missing event group ${post.tweetId}`);
    if (!["development", "holdout_candidate", "regression"].includes(String(post.split))) throw new Error(`Invalid split ${post.tweetId}`);
    if (!post.gold || typeof post.gold !== "object" || typeof (post.gold as Record<string, unknown>).rationale !== "string") {
      throw new Error(`Missing gold rationale ${post.tweetId}`);
    }
    const priorSplit = splitByGroup.get(post.eventGroupId);
    if (priorSplit && priorSplit !== post.split) throw new Error(`Event group ${post.eventGroupId} crosses splits`);
    splitByGroup.set(post.eventGroupId, String(post.split));
  }
  return { postCount: ids.size, eventGroupCount: splitByGroup.size };
}

export function buildCurrentRunIdentity(commitSha: string, inputCondition: string): OfflineRunIdentity {
  return {
    fixtureHash: hashJson({ scenarios: scenariosJson, realPosts: realPostsJson }),
    promptHash: hashText(TIBO_GEMINI_SYSTEM_PROMPT),
    schemaHash: hashJson(SCHEMA_CONTRACT),
    optionsHash: hashJson(REQUEST_OPTIONS_CONTRACT),
    commitSha,
    provider: "google",
    model: "not-run",
    modelVersion: "not-run",
    inputCondition,
  };
}

export function validateScenarioEventSplits(cases: Array<OfflineEvaluationCase & { relatedEventGroupIds?: string[] }>) {
  const splitByGroup = new Map<string, EvaluationSplit>();
  for (const evaluationCase of cases) {
    for (const eventGroupId of [evaluationCase.eventGroupId, ...(evaluationCase.relatedEventGroupIds ?? [])]) {
      const previous = splitByGroup.get(eventGroupId);
      if (previous && previous !== evaluationCase.split) throw new Error(`Event group ${eventGroupId} crosses splits`);
      splitByGroup.set(eventGroupId, evaluationCase.split);
    }
  }
  return { eventGroupCount: splitByGroup.size };
}

function parseArgs(argv: string[]) {
  const result = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) result.set(key, inlineValue);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) result.set(key, argv[++i]);
    else result.set(key, "true");
  }
  return result;
}

function getCommitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = realPostsJson as unknown as { posts: Array<{ tweetId: string }> };
  const scenarios = scenariosJson as unknown as { scenarios: Array<{ id: string; eventGroupId?: string; split?: EvaluationSplit; category?: string; expected?: { signalType?: SignalType } }> };
  const fixtureCheck = validateRealPostFixture(realPostsJson);
  validateScenarioEventSplits(scenarios.scenarios.filter((item): item is typeof item & OfflineEvaluationCase => Boolean(item.eventGroupId && item.split)));
  if (args.has("help") || !args.has("results")) {
    const selectedCaseCount = args.has("limit") ? Math.min(scenarios.scenarios.length, Math.max(0, Number(args.get("limit")) || 0)) : scenarios.scenarios.length;
    const summary = buildDryRunSummary({ fixtureCaseCount: scenarios.scenarios.length, selectedCaseCount });
    console.log(summary.text);
    console.log(`- real source posts: ${fixture.posts.length} in ${fixtureCheck.eventGroupCount} groups`);
    console.log("- raw AI response: unavailable unless a saved result explicitly includes it");
    return;
  }

  const resultsPath = path.resolve(args.get("results")!);
  const input = JSON.parse(fs.readFileSync(resultsPath, "utf8")) as {
    identity?: OfflineRunIdentity;
    identityHash?: string;
    outcomes?: Array<Record<string, unknown>>;
  };
  if (!input.identity || !input.identityHash || input.identityHash !== buildRunIdentityHash(input.identity)) {
    throw new Error("Saved results have an invalid run identity");
  }
  const currentIdentity = buildCurrentRunIdentity(input.identity.commitSha, input.identity.inputCondition);
  if (!isCheckpointCompatible(currentIdentity, input)) {
    throw new Error("Saved results do not match current fixtures, prompt source, schema, options, or commit; refusing resume");
  }
  const wrappedCases = scenarios.scenarios as unknown as Array<{ evaluation?: OfflineEvaluationCase }>;
  const cases = wrappedCases.flatMap((item) => item.evaluation ? [item.evaluation] : [])
    .filter((item) => item.inputCondition === input.identity!.inputCondition);
  const outcomes = (input.outcomes ?? []).map(normalizeStoredOutcome);
  const report = buildOfflineReport(cases, outcomes);
  const reportPath = path.resolve(args.get("output") ?? "scratch/tibo-offline-evaluation-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ identity: input.identity, report }, null, 2)}\n`, "utf8");
  console.log(`Offline report written: ${path.relative(process.cwd(), reportPath)}`);
  console.log(JSON.stringify(report, null, 2));
}

if (isMainModule()) main();
