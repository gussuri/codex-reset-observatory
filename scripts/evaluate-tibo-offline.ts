import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildGeminiPrompt, TIBO_GEMINI_SYSTEM_PROMPT } from "../lib/radar/geminiClassification";
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
  providerInput: {
    target: { tweetId: string; author: string; text: string; createdAt: string };
    contextPosts: Array<{ tweetId: string; author: string; text: string; createdAt: string; relation: "reply_parent" | "quoted_post"; verification: string }>;
  };
  relatedEventGroupIds?: string[];
  gold: {
    decision: "classify" | "abstain" | "ambiguous";
    signalType: SignalType | null;
    acceptedSignalTypes?: Array<SignalType | "abstain">;
    rationale: string;
    expectedEventGroupId?: string | null;
    temporal?: { startAt: string | null; endAt: string | null; precision: string; basePostId: string };
    publicOutcome?: { historyCreated?: boolean; activeNotice?: boolean; eventKind?: string | null; resetMethod?: string | null; eventIdentity?: string | null };
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
  publicOutcome?: { historyCreated?: boolean; activeNotice?: boolean; eventKind?: string | null; resetMethod?: string | null; eventIdentity?: string | null } | null;
  resultState?: "available" | "attempted_no_result" | "not_recorded" | "not_run";
};

export type StoredOfflineOutcome = {
  id: string;
  responseStatus: ResponseStatus;
  rawAi: OfflineLayerPrediction;
  corrected: OfflineLayerPrediction;
  publicOutcome: OfflineLayerPrediction;
  latencyMs: number | null;
  tokenUsage: number | null;
  rawCaptureState: "captured" | "attempt_logged" | "not_recorded" | "not_run";
};

export type OfflineRunIdentity = {
  fixtureHash: string;
  evaluatorHash: string;
  promptHash: string;
  schemaHash: string;
  optionsHash: string;
  commitSha: string;
  provider: string;
  model: string;
  modelVersion: string;
  inputCondition: string;
  conditions: string[];
  selectionHash: string;
};

export type OfflineLayerMetrics = {
  availability: "available" | "unavailable" | "not_recorded" | "not_run";
  attemptedCases: number;
  resultStateCounts: Record<"available" | "attempted_no_result" | "not_recorded" | "not_run", number>;
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
  temporal: { evaluated: number; missingPrediction: number; windowEvaluated: number; exactWindowMatches: number; precisionMatches: number; basePostMatches: number };
  publicContract: { evaluated: number; errors: number };
};

export type OfflineEvaluationReport = {
  totalCases: number;
  successfulResponses: number;
  responseStatus: Record<ResponseStatus, number>;
  rawAi: OfflineLayerMetrics;
  corrected: OfflineLayerMetrics;
  publicOutcome: OfflineLayerMetrics;
  missingOutcomeIds: string[];
  resources: { latencyRecorded: number; latencyMissing: number; averageLatencyMs: number | null; tokenUsageRecorded: number; tokenUsageMissing: number; totalTokenUsage: number | null };
};

const VALID_SIGNAL_TYPES = new Set<string>(SIGNAL_TYPES);
const ALL_RESPONSE_STATUSES: ResponseStatus[] = [
  "success", "http_401", "http_403", "http_429", "timeout", "http_5xx", "invalid_json", "missing_fields", "not_run",
];
const SCHEMA_CONTRACT = {
  version: 2,
  responseStatus: ALL_RESPONSE_STATUSES,
  layers: ["rawAi", "corrected", "publicOutcome"],
  outputFields: ["signalType", "confidence", "evidenceQuote", "reasonJa", "resetTypeJa", "noticeToExecution", "expectedAt", "expectedEndAt", "temporalPrecision", "temporalConfidence"],
  goldContracts: ["expectedEventGroupId", "temporal", "publicOutcome"],
  signalTypes: SIGNAL_TYPES,
  layerState: ["available", "attempted_no_result", "not_recorded", "not_run"],
  rawCaptureState: ["captured", "attempt_logged", "not_recorded", "not_run"],
  publicOutcome: ["historyCreated", "activeNotice", "eventKind", "resetMethod", "eventIdentity"],
  abstain: "separate decision, never encoded as irrelevant",
};
const REQUEST_OPTIONS_CONTRACT = {
  stage: "evaluation-comparison-v1",
  responseMimeType: "application/json",
  temperature: 0,
  timeoutMs: 7000,
  providerSchema: null,
  retries: "not represented; compare only saved attempts",
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
    && checkpoint.identity !== undefined
    && stableStringify(checkpoint.identity) === stableStringify(identity);
}

export function normalizeStoredOutcome(input: Record<string, unknown>): StoredOfflineOutcome {
  const id = typeof input.id === "string" ? input.id : "";
  if (!id) throw new Error("Saved outcome requires an id");
  const statusValue = input.providerStatus ?? input.responseStatus;
  if (!isResponseStatus(statusValue)) throw new Error(`Invalid provider status for ${id}`);
  const responseStatus = statusValue;
  const makeLayer = (key: "rawAi" | "corrected" | "publicOutcome"): OfflineLayerPrediction => {
    const raw = input[key] && typeof input[key] === "object" ? input[key] as Record<string, unknown> : null;
    if (!raw) {
      const resultState = key === "rawAi"
        ? responseStatus === "not_run" || input.rawCaptureState === "not_run" ? "not_run" : responseStatus !== "success" || input.rawCaptureState === "attempt_logged" || input.rawCaptureState === "captured" ? "attempted_no_result" : "not_recorded"
        : "not_recorded";
      return { availability: "unavailable", signalType: null, resultState };
    }
    if (raw.resultState === undefined && raw.availability === "unavailable" && !(key === "rawAi" && (input.rawCaptureState === "attempt_logged" || input.rawCaptureState === "captured"))) throw new Error(`Unavailable ${key} result requires an explicit resultState for ${id}`);
    const state = raw.resultState ?? (raw.availability === "available" ? "available" : "attempted_no_result");
    if (!(state === "available" || state === "attempted_no_result" || state === "not_recorded" || state === "not_run")) {
      throw new Error(`Invalid ${key} resultState for ${id}`);
    }
    if (raw.availability !== undefined && raw.availability !== "available" && raw.availability !== "unavailable") throw new Error(`Invalid ${key} availability for ${id}`);
    if (raw.availability !== undefined && (state === "available") !== (raw.availability === "available")) throw new Error(`Inconsistent ${key} availability/resultState for ${id}`);
    if (state !== "available") {
      if (raw.signalType !== undefined && raw.signalType !== null) throw new Error(`Unavailable ${key} contains a prediction for ${id}`);
      return { availability: "unavailable", signalType: null, confidence: null, resultState: state };
    }
    if (!isDecisionLabel(raw.signalType)) throw new Error(`Invalid ${key} signalType for ${id}`);
    let temporal: OfflineLayerPrediction["temporal"] = null;
    if (raw.temporal != null) {
      if (typeof raw.temporal !== "object" || Array.isArray(raw.temporal)) throw new Error(`Invalid ${key} temporal value for ${id}`);
      const value = raw.temporal as Record<string, unknown>;
      for (const field of ["startAt", "endAt", "precision", "basePostId"] as const) {
        if (value[field] !== null && typeof value[field] !== "string") throw new Error(`Invalid ${key} temporal ${field} for ${id}`);
      }
      for (const field of ["startAt", "endAt"] as const) {
        if (typeof value[field] === "string" && !Number.isFinite(Date.parse(value[field]))) throw new Error(`Invalid ${key} temporal ${field} for ${id}`);
      }
      temporal = value as NonNullable<OfflineLayerPrediction["temporal"]>;
    }
    if (raw.confidence !== undefined && raw.confidence !== null && (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)) throw new Error(`Invalid confidence for ${id}`);
    const confidence = typeof raw.confidence === "number" ? raw.confidence : null;
    if (raw.duplicateCount !== undefined && raw.duplicateCount !== null && (typeof raw.duplicateCount !== "number" || !Number.isFinite(raw.duplicateCount) || raw.duplicateCount < 0)) throw new Error(`Invalid duplicate count for ${id}`);
    if (raw.relatedEventGroupId !== undefined && raw.relatedEventGroupId !== null && typeof raw.relatedEventGroupId !== "string") throw new Error(`Invalid related event group for ${id}`);
    return {
      availability: "available",
      resultState: "available",
      signalType: raw.signalType,
      confidence,
      relatedEventGroupId: typeof raw.relatedEventGroupId === "string" ? raw.relatedEventGroupId : null,
      duplicateCount: typeof raw.duplicateCount === "number" ? Math.trunc(raw.duplicateCount) : null,
      temporal,
      publicOutcome: normalizePublicOutcome(raw.publicOutcome, id, key),
    };
  };

  const rawAi = makeLayer("rawAi");
  const inferredRawCaptureState = rawAi.resultState === "available" ? "captured"
    : rawAi.resultState === "not_run" || responseStatus === "not_run" ? "not_run"
      : rawAi.resultState === "attempted_no_result" ? "attempt_logged" : "not_recorded";
  const rawCaptureState = normalizeRawCaptureState(input.rawCaptureState, inferredRawCaptureState, id);
  if (rawAi.resultState === "available" && rawCaptureState !== "captured") throw new Error(`Raw output exists but rawCaptureState is not captured for ${id}`);
  if (rawCaptureState === "captured" && rawAi.resultState !== "available") throw new Error(`Raw capture state conflicts with rawAi state for ${id}`);
  if (rawCaptureState === "attempt_logged" && rawAi.resultState !== "attempted_no_result") throw new Error(`Raw attempt state conflicts with rawAi state for ${id}`);
  if (rawCaptureState === "not_run" && rawAi.resultState !== "not_run") throw new Error(`Raw not-run state conflicts with rawAi state for ${id}`);
  return {
    id,
    responseStatus,
    rawAi,
    corrected: makeLayer("corrected"),
    publicOutcome: makeLayer("publicOutcome"),
    latencyMs: normalizeOptionalNonnegative(input.latencyMs, id, "latencyMs"),
    tokenUsage: normalizeOptionalNonnegative(input.tokenUsage, id, "tokenUsage"),
    rawCaptureState,
  };
}

function normalizeOptionalNonnegative(value: unknown, id: string, name: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name} for ${id}`);
  return value;
}

function normalizeRawCaptureState(value: unknown, inferred: StoredOfflineOutcome["rawCaptureState"], id: string): StoredOfflineOutcome["rawCaptureState"] {
  if (value === undefined) return inferred;
  if (value === "not_recorded") return value;
  if (value === "captured" || value === "attempt_logged" || value === "not_run") return value;
  throw new Error(`Invalid rawCaptureState for ${id}`);
}

function normalizePublicOutcome(value: unknown, id: string, key: string): OfflineLayerPrediction["publicOutcome"] {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${key} publicOutcome for ${id}`);
  const record = value as Record<string, unknown>;
  for (const field of ["historyCreated", "activeNotice"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "boolean") throw new Error(`Invalid public ${field} for ${id}`);
  }
  for (const field of ["eventKind", "resetMethod", "eventIdentity"] as const) {
    if (record[field] !== undefined && record[field] !== null && typeof record[field] !== "string") throw new Error(`Invalid public ${field} for ${id}`);
  }
  return record as NonNullable<OfflineLayerPrediction["publicOutcome"]>;
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
  const attemptedSupport = Object.fromEntries(SIGNAL_TYPES.map((signal) => [signal, 0])) as Record<SignalType, number>;
  let successfulRequests = 0;
  let successfulCorrect = 0;
  let allRequestCorrect = 0;
  let correctAbstentions = 0;
  let abstentionMisses = 0;
  let ambiguousCases = 0;
  let attemptedCases = 0;
  let availablePredictions = 0;
  let eventAssociationEvaluated = 0;
  let eventAssociationErrors = 0;
  let duplicateEvents = 0;
  let temporalEvaluated = 0;
  let temporalMissingPrediction = 0;
  let temporalWindowEvaluated = 0;
  let exactWindowMatches = 0;
  let precisionMatches = 0;
  let basePostMatches = 0;
  let publicContractEvaluated = 0;
  let publicContractErrors = 0;
  const thresholdRows = new Map<number, { accepted: number; correct: number }>(
    CONFIDENCE_THRESHOLDS.map((threshold) => [threshold, { accepted: 0, correct: 0 }]),
  );
  const resultStateCounts: OfflineLayerMetrics["resultStateCounts"] = { available: 0, attempted_no_result: 0, not_recorded: 0, not_run: 0 };

  for (const evaluationCase of cases) {
    const outcome = outcomesById.get(evaluationCase.id);
    const layer = outcome?.[layerName] ?? { availability: "unavailable" as const, signalType: null };
    resultStateCounts[layer.resultState ?? "not_run"] += 1;
    const isAttempted = layer.resultState === "available" || layer.resultState === "attempted_no_result";
    const hasPrediction = layer.resultState === "available" && layer.availability === "available" && layer.signalType !== null;
    if (isAttempted) attemptedCases += 1;
    const prediction = hasPrediction ? layer.signalType! : null;
    const expectedBucket = evaluationCase.gold.decision === "classify"
      ? evaluationCase.gold.signalType!
      : evaluationCase.gold.decision === "abstain" ? "abstain_expected" : "ambiguous_expected";
    const confusionPrediction = prediction ?? "no_valid_prediction";
    if (isAttempted) confusion[expectedBucket][confusionPrediction] += 1;

    if (isAttempted && outcome?.responseStatus === "success") successfulRequests += 1;
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
    if (isAttempted && isCorrect) allRequestCorrect += 1;
    if (isAttempted && outcome?.responseStatus === "success" && isCorrect) successfulCorrect += 1;

    if (evaluationCase.gold.decision === "classify" && evaluationCase.gold.signalType) {
      const expected = evaluationCase.gold.signalType;
      support[expected] += 1;
      if (isAttempted) attemptedSupport[expected] += 1;
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

    if (isAttempted && evaluationCase.gold.expectedEventGroupId !== undefined) {
      eventAssociationEvaluated += 1;
      if (layer.relatedEventGroupId !== evaluationCase.gold.expectedEventGroupId) eventAssociationErrors += 1;
    }
    if (isAttempted && layerName === "publicOutcome" && evaluationCase.gold.publicOutcome) {
      publicContractEvaluated += 1;
      const actual = layer.publicOutcome;
      for (const key of Object.keys(evaluationCase.gold.publicOutcome) as Array<keyof NonNullable<OfflineEvaluationCase["gold"]["publicOutcome"]>>) {
        if (!actual || actual[key] !== evaluationCase.gold.publicOutcome[key]) {
          publicContractErrors += 1;
          break;
        }
      }
    }
    if (isAttempted && evaluationCase.gold.decision === "classify") {
      if (typeof layer.duplicateCount === "number" && layer.duplicateCount > 1) duplicateEvents += layer.duplicateCount - 1;
      const goldTemporal = evaluationCase.gold.temporal;
      if (goldTemporal) {
        temporalEvaluated += 1;
        if (!hasPrediction || !layer.temporal) temporalMissingPrediction += 1;
        else {
          if (goldTemporal.startAt !== null || goldTemporal.endAt !== null) {
            temporalWindowEvaluated += 1;
            if (goldTemporal.startAt === layer.temporal.startAt && goldTemporal.endAt === layer.temporal.endAt) exactWindowMatches += 1;
          }
          if (goldTemporal.precision === layer.temporal.precision) precisionMatches += 1;
          if (goldTemporal.basePostId === layer.temporal.basePostId) basePostMatches += 1;
        }
      }
    }
  }

  const byClass = Object.fromEntries(SIGNAL_TYPES.map((signal) => {
    const precision = predicted[signal] === 0 ? null : truePositive[signal] / predicted[signal];
    const recall = support[signal] === 0 || attemptedSupport[signal] === 0 ? null : truePositive[signal] / attemptedSupport[signal];
    const f1 = support[signal] === 0 || attemptedSupport[signal] === 0 ? null : predicted[signal] === 0 ? 0 : precision === null || recall === null ? null : precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
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
  const observedStates = cases.flatMap((item) => {
    const state = outcomesById.get(item.id)?.[layerName].resultState;
    return state ? [state] : [];
  });
  const wasNotRecorded = observedStates.length > 0 && observedStates.every((state) => state === "not_recorded");
  const hasRun = attemptedCases > 0;

  return {
    availability: availablePredictions > 0 ? "available" : wasNotRecorded ? "not_recorded" : hasRun ? "unavailable" : "not_run",
    attemptedCases,
    resultStateCounts,
    allRequestCorrect,
    allRequestAccuracy: attemptedCases === 0 ? null : allRequestCorrect / attemptedCases,
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
    temporal: { evaluated: temporalEvaluated, missingPrediction: temporalMissingPrediction, windowEvaluated: temporalWindowEvaluated, exactWindowMatches, precisionMatches, basePostMatches },
    publicContract: { evaluated: publicContractEvaluated, errors: publicContractErrors },
  };
}

export function buildOfflineReport(
  cases: OfflineEvaluationCase[],
  outcomes: StoredOfflineOutcome[],
): OfflineEvaluationReport {
  assertUniqueCaseIds(cases);
  const outcomesById = new Map<string, StoredOfflineOutcome>();
  const caseIds = new Set(cases.map((item) => item.id));
  for (const outcome of outcomes) {
    if (!outcome.id || outcomesById.has(outcome.id)) throw new Error(`Duplicate or empty outcome id: ${outcome.id}`);
    if (!caseIds.has(outcome.id)) throw new Error(`Outcome id is not in selected case set: ${outcome.id}`);
    outcomesById.set(outcome.id, outcome);
  }
  const responseStatus = Object.fromEntries(
    ALL_RESPONSE_STATUSES.map((status) => [status, 0]),
  ) as Record<ResponseStatus, number>;
  let successfulResponses = 0;
  const selectedOutcomes: Array<StoredOfflineOutcome | undefined> = [];
  for (const evaluationCase of cases) {
    const outcome = outcomesById.get(evaluationCase.id);
    selectedOutcomes.push(outcome);
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
    resources: {
      latencyRecorded: selectedOutcomes.filter((item) => item?.latencyMs !== null && item?.latencyMs !== undefined).length,
      latencyMissing: selectedOutcomes.filter((item) => item?.latencyMs === null || item === undefined).length,
      averageLatencyMs: selectedOutcomes.some((item) => item?.latencyMs !== null && item?.latencyMs !== undefined) ? selectedOutcomes.reduce((sum, item) => sum + (item?.latencyMs ?? 0), 0) / selectedOutcomes.filter((item) => item?.latencyMs !== null && item?.latencyMs !== undefined).length : null,
      tokenUsageRecorded: selectedOutcomes.filter((item) => item?.tokenUsage !== null && item?.tokenUsage !== undefined).length,
      tokenUsageMissing: selectedOutcomes.filter((item) => item?.tokenUsage === null || item === undefined).length,
      totalTokenUsage: selectedOutcomes.some((item) => item?.tokenUsage !== null && item?.tokenUsage !== undefined) ? selectedOutcomes.reduce((sum, item) => sum + (item?.tokenUsage ?? 0), 0) : null,
    },
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
  const records: Record<string, unknown>[] = [];
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
    if (typeof post.sourceTextStatus !== "string" || !post.sourceTextStatus.trim()) throw new Error(`Missing source text status ${post.tweetId}`);
    if (!Array.isArray(post.sourceCitations) || post.sourceCitations.length === 0) throw new Error(`Missing source citation ${post.tweetId}`);
    if (!post.gold || typeof post.gold !== "object") throw new Error(`Missing gold label ${post.tweetId}`);
    const gold = post.gold as Record<string, unknown>;
    if (!(gold.decision === "classify" || gold.decision === "abstain" || gold.decision === "ambiguous") || typeof gold.rationale !== "string" || !gold.rationale.trim()) {
      throw new Error(`Invalid gold decision or rationale ${post.tweetId}`);
    }
    if (gold.decision === "classify" ? !isSignalType(gold.signalType) : gold.decision === "abstain" ? gold.signalType !== null : (gold.signalType !== null && !isSignalType(gold.signalType))) {
      throw new Error(`Gold decision/signalType mismatch ${post.tweetId}`);
    }
    if (!Array.isArray(gold.inputConditions ?? [])) throw new Error(`Invalid gold inputConditions ${post.tweetId}`);
    for (const condition of (gold.inputConditions ?? []) as unknown[]) {
      if (!condition || typeof condition !== "object") throw new Error(`Invalid gold input condition ${post.tweetId}`);
      const record = condition as Record<string, unknown>;
      if (typeof record.id !== "string" || !(record.decision === "classify" || record.decision === "abstain" || record.decision === "ambiguous")) throw new Error(`Invalid gold input condition ${post.tweetId}`);
      if (record.decision === "classify" ? !isSignalType(record.signalType) : record.decision === "abstain" ? record.signalType !== undefined && record.signalType !== null : record.signalType !== undefined && record.signalType !== null && !isSignalType(record.signalType)) throw new Error(`Invalid input-condition signal type ${post.tweetId}`);
    }
    if (typeof post.eventGroupId !== "string" || !post.eventGroupId) throw new Error(`Missing event group ${post.tweetId}`);
    if (!["development", "holdout_candidate", "regression"].includes(String(post.split))) throw new Error(`Invalid split ${post.tweetId}`);
    if (post.split === "holdout_candidate" && post.splitReviewStatus !== "pending_leakage_review") throw new Error(`Unreviewed holdout status missing ${post.tweetId}`);
    if (post.splitReviewStatus === "known_leakage_regression") {
      const leakage = post.leakageReview as Record<string, unknown> | undefined;
      if (post.split !== "regression" || leakage?.status !== "known_regression" || !Array.isArray(leakage.matches) || leakage.matches.length === 0) throw new Error(`Known leakage review is incomplete ${post.tweetId}`);
    }
    const priorSplit = splitByGroup.get(post.eventGroupId);
    if (priorSplit && priorSplit !== post.split) throw new Error(`Event group ${post.eventGroupId} crosses splits`);
    splitByGroup.set(post.eventGroupId, String(post.split));
    if (!Array.isArray(post.sourceCitations) || post.sourceCitations.some((citation) => typeof citation !== "string" || !citation.trim())) throw new Error(`Invalid source citation ${post.tweetId}`);
    if (!Array.isArray(post.relatedPostIds) || !["missing", "not_applicable", "verified_by_sol_x_dom", "documented_event_mapping"].includes(String(post.relationVerification))) throw new Error(`Invalid relation metadata ${post.tweetId}`);
    if ((post.relationVerification === "verified_by_sol_x_dom" || post.relationVerification === "documented_event_mapping") && post.relatedPostIds.length === 0) throw new Error(`Verified relation has no IDs ${post.tweetId}`);
    if (post.originalTextVerified !== undefined && typeof post.originalTextVerified !== "boolean") throw new Error(`Invalid original-text verification ${post.tweetId}`);
    if (post.originalTextVerified === false && !String(post.sourceTextStatus).includes("unverified")) throw new Error(`Unverified source text must be marked ${post.tweetId}`);
    if (gold.temporalExpected !== undefined && gold.temporalExpected !== null) {
      if (!gold.temporalExpected || typeof gold.temporalExpected !== "object") throw new Error(`Invalid temporal gold ${post.tweetId}`);
      const temporal = gold.temporalExpected as Record<string, unknown>;
      if (temporal.expectedStartAt !== undefined && temporal.expectedStartAt !== null && (typeof temporal.expectedStartAt !== "string" || !Number.isFinite(Date.parse(temporal.expectedStartAt)))) throw new Error(`Invalid temporal start gold ${post.tweetId}`);
      if (temporal.expectedEndAt !== undefined && temporal.expectedEndAt !== null && (typeof temporal.expectedEndAt !== "string" || !Number.isFinite(Date.parse(temporal.expectedEndAt)))) throw new Error(`Invalid temporal end gold ${post.tweetId}`);
      if (temporal.precision !== undefined && typeof temporal.precision !== "string") throw new Error(`Invalid temporal precision gold ${post.tweetId}`);
    }
    records.push(post);
  }
  const recordsById = new Map(records.map((post) => [post.tweetId as string, post]));
  for (const post of records) {
    for (const relationId of [post.replyParentTweetId, post.quoteTweetId, ...(post.relatedPostIds as string[])]) {
      if (relationId !== null && relationId !== undefined && (typeof relationId !== "string" || !recordsById.has(relationId))) throw new Error(`Unknown relation ID ${String(relationId)} for ${String(post.tweetId)}`);
    }
    if (post.relationVerification === "verified_by_sol_x_dom" || post.relationVerification === "documented_event_mapping") {
      for (const relationId of [post.replyParentTweetId, post.quoteTweetId, ...(post.relatedPostIds as string[])].filter((id): id is string => typeof id === "string")) {
        const related = recordsById.get(relationId);
        if (related && related.split !== post.split) throw new Error(`Verified relation crosses split ${String(post.tweetId)} and ${relationId}`);
      }
    }
  }
  return { postCount: ids.size, eventGroupCount: splitByGroup.size };
}

function isSignalType(value: unknown): value is SignalType {
  return typeof value === "string" && VALID_SIGNAL_TYPES.has(value);
}

export function formatEvaluationInput(evaluationCase: OfflineEvaluationCase) {
  const parent = evaluationCase.providerInput.contextPosts.find((post) => post.relation === "reply_parent");
  const quote = evaluationCase.providerInput.contextPosts.find((post) => post.relation === "quoted_post");
  return buildGeminiPrompt({
    text: evaluationCase.providerInput.target.text,
    tweetCreatedAt: evaluationCase.providerInput.target.createdAt,
    isReply: Boolean(parent),
    replyToHandles: parent ? [parent.author] : [],
    replyContextText: parent?.text,
    isQuote: Boolean(quote),
    quoteContextText: quote?.text,
    quoteAuthorHandle: quote?.author,
    quoteTweetUrl: quote ? `https://x.com/${quote.author.replace(/^@/, "")}/status/${quote.tweetId}` : null,
  });
}

export function buildEvaluationCases(): OfflineEvaluationCase[] {
  validateRealPostFixture(realPostsJson);
  const scenarios = (scenariosJson as unknown as { scenarios: Array<Record<string, unknown>> }).scenarios;
  const cases: OfflineEvaluationCase[] = [];
  for (const scenario of scenarios) {
    const expected = scenario.expected as Record<string, unknown> | undefined;
    const evaluation = scenario.evaluation as Record<string, unknown> | undefined;
    const id = typeof scenario.id === "string" ? scenario.id : "";
    const text = typeof scenario.tweetText === "string" ? scenario.tweetText : "";
    const createdAt = typeof scenario.tweetCreatedAt === "string" ? scenario.tweetCreatedAt : "";
    const url = typeof scenario.tweetUrl === "string" ? scenario.tweetUrl : "";
    const postId = url.match(/\/status\/(\d+)/)?.[1] ?? `synthetic-${id}`;
    const gold = evaluation?.gold && typeof evaluation.gold === "object" ? evaluation.gold as OfflineEvaluationCase["gold"] : {
      decision: isSignalType(expected?.signalType) ? "classify" as const : "ambiguous" as const,
      signalType: isSignalType(expected?.signalType) ? expected!.signalType as SignalType : null,
      rationale: typeof scenario.description === "string" ? scenario.description : "Legacy virtual scenario expectation.",
    };
    const eventGroupId = typeof evaluation?.eventGroupId === "string" ? evaluation.eventGroupId : String(scenario.regressionGroup ?? `legacy-${id}`);
    const split = evaluation?.split === "development" || evaluation?.split === "holdout_candidate" || evaluation?.split === "regression" ? evaluation.split : "regression";
    const inputCondition = typeof evaluation?.inputCondition === "string" ? evaluation.inputCondition : "text_only";
    const providerInput = evaluation?.providerInput as OfflineEvaluationCase["providerInput"] | undefined;
    cases.push({
      id,
      eventGroupId,
      split,
      layer: typeof evaluation?.layer === "string" ? evaluation.layer : "classification",
      inputCondition,
      providerInput: providerInput ?? { target: { tweetId: postId, author: "@thsottiaux", text, createdAt }, contextPosts: [] },
      relatedEventGroupIds: Array.isArray(evaluation?.relatedEventGroupIds) ? evaluation.relatedEventGroupIds as string[] : (providerInput?.contextPosts ?? []).map(() => eventGroupId),
      gold,
    });
  }

  const posts = (realPostsJson as unknown as { posts: Array<Record<string, unknown>> }).posts;
  const postsById = new Map(posts.map((post) => [post.tweetId as string, post]));
  for (const post of posts) {
    const gold = post.gold as Record<string, unknown>;
    const conditions = Array.isArray(gold.inputConditions) ? gold.inputConditions as Array<Record<string, unknown>> : [];
    const variants = [{ id: "text_only", decision: gold.decision, signalType: gold.signalType, rationale: gold.rationale }, ...conditions];
    const unique = new Map(variants.map((variant) => [variant.id, variant]));
    for (const variant of Array.from(unique.values())) {
      if (typeof variant.id !== "string") continue;
      const contextPosts: OfflineEvaluationCase["providerInput"]["contextPosts"] = [];
      if (variant.id === "verified-parent" && typeof post.replyParentTweetId === "string") {
        const parent = postsById.get(post.replyParentTweetId);
        if (parent) contextPosts.push({ tweetId: parent.tweetId as string, author: parent.author as string, text: parent.text as string, createdAt: parent.tweetCreatedAt as string, relation: "reply_parent", verification: String(post.relationVerification) });
      }
      if (variant.id === "verified-quote-reply-parent-chain" && typeof post.quoteTweetId === "string") {
        const quoted = postsById.get(post.quoteTweetId);
        if (quoted) {
          contextPosts.push({ tweetId: quoted.tweetId as string, author: quoted.author as string, text: quoted.text as string, createdAt: quoted.tweetCreatedAt as string, relation: "quoted_post", verification: String(post.relationVerification) });
          if (typeof quoted.replyParentTweetId === "string") {
            const parent = postsById.get(quoted.replyParentTweetId);
            if (parent) contextPosts.push({ tweetId: parent.tweetId as string, author: parent.author as string, text: parent.text as string, createdAt: parent.tweetCreatedAt as string, relation: "reply_parent", verification: String(quoted.relationVerification) });
          }
        }
      }
      const decision = variant.decision === "classify" || variant.decision === "abstain" || variant.decision === "ambiguous" ? variant.decision : "ambiguous";
      const signalType = isSignalType(variant.signalType) ? variant.signalType : null;
      const temporalRaw = gold.temporalExpected && typeof gold.temporalExpected === "object" ? gold.temporalExpected as Record<string, unknown> : null;
      const temporalExpected = variant.expectedStartAt || variant.expectedEndAt
        ? { startAt: typeof variant.expectedStartAt === "string" ? variant.expectedStartAt : null, endAt: typeof variant.expectedEndAt === "string" ? variant.expectedEndAt : null, precision: typeof variant.precision === "string" ? variant.precision : "range", basePostId: typeof variant.basePostId === "string" ? variant.basePostId : String(post.tweetId) }
        : temporalRaw
          ? { startAt: typeof temporalRaw.expectedStartAt === "string" ? temporalRaw.expectedStartAt : null, endAt: typeof temporalRaw.expectedEndAt === "string" ? temporalRaw.expectedEndAt : null, precision: String(temporalRaw.precision ?? temporalRaw.kind ?? "unknown"), basePostId: String(temporalRaw.basePostId ?? post.tweetId) }
          : undefined;
      const normalizedCondition = ({ "text-only": "text_only", "verified-parent": "verified_parent", "verified-quote-reply-parent-chain": "verified_quote_reply_parent_chain" } as Record<string, string>)[variant.id] ?? variant.id;
      let publicOutcome = {
        historyCreated: decision === "classify" && signalType === "reset_executed",
        activeNotice: decision === "classify" && signalType === "official_notice",
        eventKind: typeof gold.deliveryMethod === "string" ? gold.deliveryMethod : signalType === "reset_executed" ? "global_reset" : null,
        resetMethod: typeof gold.deliveryMethod === "string" ? gold.deliveryMethod : signalType === "reset_executed" ? "forced_reset" : null,
        eventIdentity: String(post.eventGroupId),
      };
      if (post.tweetId === "2110595554036400151") publicOutcome = { historyCreated: false, activeNotice: true, eventKind: "official_notice", resetMethod: null, eventIdentity: String(post.eventGroupId) };
      if (post.tweetId === "2110618732666257557") {
        const completedWithVerifiedChain = variant.id === "verified-quote-reply-parent-chain";
        publicOutcome = { historyCreated: completedWithVerifiedChain, activeNotice: !completedWithVerifiedChain, eventKind: completedWithVerifiedChain ? "global_reset" : "official_notice", resetMethod: completedWithVerifiedChain ? "forced_reset" : null, eventIdentity: String(post.eventGroupId) };
      }
      cases.push({
        id: `${String(post.tweetId)}::${variant.id}`,
        eventGroupId: String(post.eventGroupId),
        split: post.split as EvaluationSplit,
        layer: "classification",
        inputCondition: normalizedCondition,
        providerInput: { target: { tweetId: String(post.tweetId), author: String(post.author), text: String(post.text), createdAt: String(post.tweetCreatedAt) }, contextPosts },
        relatedEventGroupIds: [
          ...((post.relationVerification === "verified_by_sol_x_dom" || post.relationVerification === "documented_event_mapping") ? (post.relatedPostIds as string[]).map((relationId) => String(postsById.get(relationId)?.eventGroupId ?? "")) : []),
          ...contextPosts.map((contextPost) => String(postsById.get(contextPost.tweetId)?.eventGroupId ?? String(post.eventGroupId))),
        ],
      gold: { decision, signalType, rationale: String(variant.rationale ?? gold.rationale), ...((post.relationVerification === "documented_event_mapping" || post.relationVerification === "verified_by_sol_x_dom") ? { expectedEventGroupId: post.relationVerification === "documented_event_mapping" || contextPosts.length > 0 ? String(post.eventGroupId) : null } : {}), ...(temporalExpected ? { temporal: temporalExpected } : {}), publicOutcome },
      });
    }
  }
  assertUniqueCaseIds(cases);
  validateEvaluationCases(cases);
  validateScenarioEventSplits(cases);
  return cases;
}

function validateEvaluationCases(cases: OfflineEvaluationCase[]) {
  for (const evaluationCase of cases) {
    if (!evaluationCase.eventGroupId || !["development", "regression", "holdout_candidate"].includes(evaluationCase.split)) throw new Error(`Invalid event/split for ${evaluationCase.id}`);
    if (!evaluationCase.inputCondition || !evaluationCase.layer) throw new Error(`Missing case condition/layer for ${evaluationCase.id}`);
    const target = evaluationCase.providerInput?.target;
    if (!target || !target.tweetId || !target.author || !target.text?.trim() || !Number.isFinite(Date.parse(target.createdAt))) throw new Error(`Invalid provider input target for ${evaluationCase.id}`);
    if (!Array.isArray(evaluationCase.providerInput.contextPosts)) throw new Error(`Invalid context posts for ${evaluationCase.id}`);
    for (const post of evaluationCase.providerInput.contextPosts) {
      if (!post.tweetId || !post.author || !post.text.trim() || !Number.isFinite(Date.parse(post.createdAt)) || !["reply_parent", "quoted_post"].includes(post.relation) || !post.verification) throw new Error(`Invalid context post for ${evaluationCase.id}`);
    }
    if (!evaluationCase.gold || !["classify", "abstain", "ambiguous"].includes(evaluationCase.gold.decision) || typeof evaluationCase.gold.rationale !== "string" || !evaluationCase.gold.rationale.trim()) throw new Error(`Invalid case gold for ${evaluationCase.id}`);
    if (evaluationCase.gold.decision === "classify" ? !isSignalType(evaluationCase.gold.signalType) : evaluationCase.gold.decision === "abstain" ? evaluationCase.gold.signalType !== null : evaluationCase.gold.signalType !== null && !isSignalType(evaluationCase.gold.signalType)) throw new Error(`Invalid case gold signal for ${evaluationCase.id}`);
    if (evaluationCase.gold.expectedEventGroupId !== undefined && evaluationCase.gold.expectedEventGroupId !== null && typeof evaluationCase.gold.expectedEventGroupId !== "string") throw new Error(`Invalid expected event group for ${evaluationCase.id}`);
    if (evaluationCase.gold.publicOutcome !== undefined) {
      const expectedPublic = evaluationCase.gold.publicOutcome as Record<string, unknown>;
      for (const key of ["historyCreated", "activeNotice"] as const) if (expectedPublic[key] !== undefined && typeof expectedPublic[key] !== "boolean") throw new Error(`Invalid gold public ${key} for ${evaluationCase.id}`);
      for (const key of ["eventKind", "resetMethod", "eventIdentity"] as const) if (expectedPublic[key] !== undefined && expectedPublic[key] !== null && typeof expectedPublic[key] !== "string") throw new Error(`Invalid gold public ${key} for ${evaluationCase.id}`);
    }
    if (evaluationCase.gold.temporal) {
      const temporal = evaluationCase.gold.temporal;
      if ((temporal.startAt !== null && !Number.isFinite(Date.parse(temporal.startAt))) || (temporal.endAt !== null && !Number.isFinite(Date.parse(temporal.endAt))) || !temporal.precision || !temporal.basePostId) throw new Error(`Invalid case temporal gold for ${evaluationCase.id}`);
      if (temporal.basePostId !== target.tweetId && !evaluationCase.providerInput.contextPosts.some((post) => post.tweetId === temporal.basePostId)) throw new Error(`Temporal gold base post is absent from provider input for ${evaluationCase.id}`);
    }
  }
}

function assertUniqueCaseIds(cases: OfflineEvaluationCase[]) {
  const seen = new Set<string>();
  for (const item of cases) {
    if (!item.id || seen.has(item.id)) throw new Error(`Duplicate or empty evaluation case id: ${item.id}`);
    seen.add(item.id);
  }
}

export function selectEvaluationCases(cases: OfflineEvaluationCase[], options: { condition?: string; split?: string; limit?: number; ids?: string[] }) {
  assertUniqueCaseIds(cases);
  const condition = options.condition ?? "all";
  const split = options.split ?? "all";
  const availableConditions = new Set(cases.map((item) => item.inputCondition));
  if (condition !== "all" && !availableConditions.has(condition)) throw new Error(`Unknown input condition: ${condition}`);
  if (split !== "all" && !["development", "holdout_candidate", "regression"].includes(split)) throw new Error(`Unknown split: ${split}`);
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error("Limit must be a positive integer");
  if (options.ids && (options.ids.length === 0 || new Set(options.ids).size !== options.ids.length)) throw new Error("Explicit case IDs must be non-empty and unique");
  const casesById = new Map(cases.map((item) => [item.id, item]));
  if (options.ids?.some((id) => !casesById.has(id))) throw new Error("Explicit selection contains an unknown case ID");
  let selected = options.ids
    ? options.ids.map((id) => casesById.get(id)!).filter((item) => (condition === "all" || item.inputCondition === condition) && (split === "all" || item.split === split))
    : cases.filter((item) => (condition === "all" || item.inputCondition === condition) && (split === "all" || item.split === split));
  if (options.limit !== undefined) selected = selected.slice(0, options.limit);
  if (selected.length === 0) throw new Error("Selection contains no evaluation cases");
  return selected;
}

export function buildCurrentRunIdentity(input: { inputCondition: string; selectedCaseIds: string[]; provider: string; model: string; modelVersion: string }): OfflineRunIdentity {
  if (!input.provider.trim() || !input.model.trim() || !input.modelVersion.trim() || input.provider === "not-run" || input.model === "not-run" || input.modelVersion === "not-run") throw new Error("Provider, model, and model version are required for saved-result scoring");
  if (input.selectedCaseIds.length === 0 || new Set(input.selectedCaseIds).size !== input.selectedCaseIds.length) throw new Error("Run identity requires a non-empty unique case selection");
  return {
    fixtureHash: hashJson({ cases: buildEvaluationCases(), scenarios: scenariosJson, realPosts: realPostsJson }),
    evaluatorHash: hashText(fs.readFileSync(fileURLToPath(import.meta.url), "utf8")),
    promptHash: hashText(`${TIBO_GEMINI_SYSTEM_PROMPT}\n${buildGeminiPrompt.toString()}\n${formatEvaluationInput.toString()}`),
    schemaHash: hashJson(SCHEMA_CONTRACT),
    optionsHash: hashJson(REQUEST_OPTIONS_CONTRACT),
    commitSha: getCommitSha(),
    provider: input.provider,
    model: input.model,
    modelVersion: input.modelVersion,
    inputCondition: input.inputCondition,
    conditions: [input.inputCondition],
    selectionHash: hashJson(input.selectedCaseIds),
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
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = buildEvaluationCases();
  const fixtureCheck = validateRealPostFixture(realPostsJson);
  const limit = args.has("limit") ? Number(args.get("limit")) : undefined;
  const ids = args.get("ids")?.split(",").map((item) => item.trim());
  const selected = selectEvaluationCases(cases, { condition: args.get("condition"), split: args.get("split"), limit, ids });
  if (args.has("help") || !args.has("results")) {
    const summary = buildDryRunSummary({ fixtureCaseCount: cases.length, selectedCaseCount: selected.length });
    console.log(summary.text);
    console.log(`- selection: condition=${args.get("condition") ?? "all"}, split=${args.get("split") ?? "all"}, limit=${limit ?? "none"}`);
    console.log(`- real source posts: ${fixtureCheck.postCount} in ${fixtureCheck.eventGroupCount} groups`);
    return;
  }

  const provider = args.get("provider");
  const model = args.get("model");
  const modelVersion = args.get("model-version");
  const condition = args.get("condition");
  if (!provider || !model || !modelVersion || !condition || condition === "all") {
    throw new Error("Saved-result scoring requires explicit --provider, --model, --model-version, and a single --condition");
  }
  if (selected.some((item) => item.inputCondition !== condition)) throw new Error("Saved-result selection must contain only its identified input condition");
  const resultsPath = path.resolve(args.get("results")!);
  const input = JSON.parse(fs.readFileSync(resultsPath, "utf8")) as {
    identity?: OfflineRunIdentity;
    identityHash?: string;
    outcomes?: Array<Record<string, unknown>>;
  };
  if (!input.identity || !input.identityHash || !Array.isArray(input.outcomes) || input.identityHash !== buildRunIdentityHash(input.identity)) {
    throw new Error("Saved results have an invalid run identity");
  }
  const currentIdentity = buildCurrentRunIdentity({ inputCondition: condition, selectedCaseIds: selected.map((item) => item.id), provider, model, modelVersion });
  if (!isCheckpointCompatible(currentIdentity, input)) {
    throw new Error("Saved results do not match the current fixture, prompt formatter, schema, request options, commit, provider, model, version, or condition");
  }
  const outcomes = input.outcomes.map(normalizeStoredOutcome);
  const selectedIds = new Set(selected.map((item) => item.id));
  const extraIds = outcomes.map((item) => item.id).filter((id) => !selectedIds.has(id));
  if (extraIds.length > 0) throw new Error(`Saved results contain IDs outside the selected cases: ${extraIds.join(", ")}`);
  const report = buildOfflineReport(selected, outcomes);
  const reportPath = path.resolve(args.get("output") ?? "scratch/tibo-offline-evaluation-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ identity: currentIdentity, selection: { condition, split: args.get("split") ?? "all", limit: limit ?? null, ids: ids ?? null }, caseIds: selected.map((item) => item.id), report }, null, 2)}\n`, "utf8");
  console.log(`Offline report written: ${path.relative(process.cwd(), reportPath)}`);
  console.log(JSON.stringify(report, null, 2));
}

if (isMainModule()) main();
