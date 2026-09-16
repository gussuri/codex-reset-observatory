import {
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_TARGET_DEFINITION,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
} from "@/data/shadowProbabilityConfig";
import { PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS } from "./prospectivePublishedModelEvaluation";
import {
  getRandomClockOutcome,
} from "./prospectiveRandomClockModelEvaluation";
import {
  selectDailyFirstForecasts,
  type ProspectiveCalibrationBucket,
  type ProspectiveForecastRow,
} from "./prospectiveProbabilityEvaluation";
import {
  isContextAwareContextProvenance,
  type ContextAwareForecastAudit,
} from "./contextAwareContinuousProbability";
import type { RecoveryResetBoundary } from "./recoveryBoundary";

const HOUR_MS = 60 * 60 * 1000;
const LOG_LOSS_EPSILON = 1e-12;

type StoredForecast = {
  modelVersion: string;
  generatedAt: string;
  probability24h: number;
  probability48h: number;
  [key: string]: unknown;
};

type ComparableContextAwareRow = ProspectiveForecastRow & {
  forecasts: ProspectiveForecastRow["forecasts"] & {
    [CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION]: StoredForecast & {
      contextAware: ContextAwareForecastAudit;
    };
    [RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION]: StoredForecast;
  };
};

export type ContextAwareProspectiveMetric = {
  count: number;
  positiveCount: number;
  actualRate: number;
  averagePrediction: number;
  bias: number;
  brier: number;
  logLoss: number;
  calibration: ProspectiveCalibrationBucket[];
  periodStart: string | null;
  periodEnd: string | null;
  targetResetCount: number;
};

export type ContextAwareProspectiveModelEvaluation = {
  modelVersion: string;
  metrics24h: ContextAwareProspectiveMetric;
  metrics48h: ContextAwareProspectiveMetric;
};

export type ContextAwareContextSegment = {
  contextState: "none" | "weak" | "strong" | "unknown";
  metrics24h: ContextAwareProspectiveMetric;
  metrics48h: ContextAwareProspectiveMetric;
};

export type ContextAwareProspectiveEvaluationReport = {
  schemaVersion: "prospective-context-aware-continuous-model-evaluation-v1";
  status: "insufficient_data" | "promising" | "worse" | "eligible_for_manual_review";
  generatedAt: string;
  asOf: string;
  evaluationMode: "prospective";
  backfilled: false;
  source: "prediction_history.debug_info.experimentalProbabilityForecasts";
  targetDefinition: typeof CONTEXT_AWARE_CONTINUOUS_PROBABILITY_TARGET_DEFINITION;
  candidateModelVersion: typeof CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION;
  challengerModelVersion: typeof RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION;
  freezeAt: typeof CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT;
  evaluationStartAt: string | null;
  forecastCounts: {
    candidate: number;
    challenger: number;
    comparable: number;
  };
  comparison: {
    resolved24h: number;
    resolved48h: number;
    positiveCount24h: number;
    positiveCount48h: number;
    targetResetCount: number;
    candidateMinusAgeOnly: ContextAwareMetricDelta;
    candidateMinusChallenger: ContextAwareMetricDelta;
  };
  models: {
    candidate: ContextAwareProspectiveModelEvaluation;
    ageOnly: ContextAwareProspectiveModelEvaluation;
    challenger: ContextAwareProspectiveModelEvaluation;
  };
  contextSegments: Record<"none" | "weak" | "strong" | "unknown", ContextAwareContextSegment>;
  latestFit: {
    generatedAt: string | null;
    alpha24h: number | null;
    betaWeak24h: number | null;
    betaStrong24h: number | null;
    alpha48h: number | null;
    betaWeak48h: number | null;
    betaStrong48h: number | null;
    trainingSampleCount24h: number | null;
    trainingSampleCount48h: number | null;
    excludedTrainingRowCount24h: number | null;
    excludedTrainingRowCount48h: number | null;
    excludedTrainingReasons24h: Record<string, number>;
    excludedTrainingReasons48h: Record<string, number>;
    trainingReadStatus: "ok" | "error" | "unknown";
  };
  gate: {
    autoPublish: false;
    manualReviewOnly: true;
    thresholds: typeof PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS;
    targetResetCount: number;
    resolvedDaily24h: number;
    resolvedDaily48h: number;
    candidateBrier24hNotWorse: boolean;
    candidateBrier48hNotWorse: boolean;
    candidateLogLossNotExtremelyWorse: boolean;
    eligibleForManualReview: boolean;
  };
  notes: string[];
};

export type ContextAwareMetricDelta = {
  brier24h: number | null;
  brier48h: number | null;
  logLoss24h: number | null;
  logLoss48h: number | null;
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isProbability(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

function isStoredForecast(value: unknown, modelVersion: string): value is StoredForecast {
  const forecast = asRecord(value);
  return forecast !== null
    && forecast.modelVersion === modelVersion
    && typeof forecast.generatedAt === "string"
    && timestamp(forecast.generatedAt) !== null
    && isProbability(forecast.probability24h)
    && isProbability(forecast.probability48h);
}

function isContextAwareAudit(value: unknown): value is ContextAwareForecastAudit {
  const audit = asRecord(value);
  return audit !== null
    && audit.contextSnapshotVersion === "v1"
    && (audit.contextState === "none"
      || audit.contextState === "weak"
      || audit.contextState === "strong"
      || audit.contextState === "unknown")
    && isContextAwareContextProvenance(audit.contextStateProvenance)
    && typeof audit.trainingEligible === "boolean"
    && isProbability(audit.baselineProbability24h)
    && isProbability(audit.baselineProbability48h)
    && isProbability(audit.contextAdjustedProbability24h)
    && isProbability(audit.contextAdjustedProbability48h)
    && typeof audit.trainingSampleCount24h === "number"
    && typeof audit.trainingSampleCount48h === "number";
}

function isComparableContextAwareRow(
  row: ProspectiveForecastRow,
  freezeTime: number,
): row is ComparableContextAwareRow {
  const origin = timestamp(row.generatedAt);
  const candidate = row.forecasts[CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION];
  const challenger = row.forecasts[RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION];
  const candidateRecord = asRecord(candidate);
  return origin !== null
    && origin >= freezeTime
    && isStoredForecast(candidate, CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION)
    && candidate.generatedAt === row.generatedAt
    && isContextAwareAudit(candidateRecord?.contextAware)
    && isStoredForecast(challenger, RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION)
    && challenger.generatedAt === row.generatedAt;
}

export function selectComparableContextAwareForecasts(rows: Array<ProspectiveForecastRow>) {
  const freezeTime = timestamp(CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT);
  if (freezeTime === null) return [] as Array<ComparableContextAwareRow>;
  return rows.filter((row): row is ComparableContextAwareRow =>
    isComparableContextAwareRow(row, freezeTime),
  );
}

function clampProbability(value: number) {
  return Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, value));
}

function calibrationBuckets(values: Array<{ prediction: number; actual: number }>) {
  return [0, 0.2, 0.4, 0.6, 0.8].map((lower) => {
    const upper = lower + 0.2;
    const selected = values.filter(({ prediction }) =>
      prediction >= lower && (prediction < upper || (upper === 1 && prediction <= upper)),
    );
    return {
      range: `${Math.round(lower * 100)}-${Math.round(upper * 100)}%`,
      count: selected.length,
      averagePrediction: selected.length === 0
        ? 0
        : selected.reduce((sum, value) => sum + value.prediction, 0) / selected.length,
      actualRate: selected.length === 0
        ? 0
        : selected.reduce((sum, value) => sum + value.actual, 0) / selected.length,
    };
  });
}

type ScoredRow = {
  generatedAt: string;
  prediction: number;
  actual: number;
  targetIds: string[];
  contextState: "none" | "weak" | "strong" | "unknown";
};

function getResolvedRows(
  rows: Array<ComparableContextAwareRow>,
  prediction: (row: ComparableContextAwareRow) => number,
  horizonHours: 24 | 48,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
): Array<ScoredRow> {
  const asOfTime = asOf.getTime();
  return rows.flatMap((row) => {
    const origin = timestamp(row.generatedAt);
    const value = prediction(row);
    if (
      origin === null
      || !Number.isFinite(asOfTime)
      || origin + horizonHours * HOUR_MS > asOfTime
      || !isProbability(value)
    ) return [];
    const actual = getRandomClockOutcome(boundaries, row.generatedAt, horizonHours);
    if (actual === null) return [];
    const end = origin + horizonHours * HOUR_MS;
    return [{
      generatedAt: row.generatedAt,
      prediction: value,
      actual: Number(actual),
      targetIds: boundaries
        .filter((boundary) => {
          const eventTime = timestamp(boundary.resetAt);
          return boundary.isRandom
            && eventTime !== null
            && eventTime > origin
            && eventTime <= end;
        })
        .map((boundary) => boundary.id),
      contextState: row.forecasts[CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION]
        .contextAware.contextState,
    }];
  });
}

function emptyMetric(): ContextAwareProspectiveMetric {
  return {
    count: 0,
    positiveCount: 0,
    actualRate: 0,
    averagePrediction: 0,
    bias: 0,
    brier: 0,
    logLoss: 0,
    calibration: calibrationBuckets([]),
    periodStart: null,
    periodEnd: null,
    targetResetCount: 0,
  };
}

function calculateMetric(rows: Array<ScoredRow>): ContextAwareProspectiveMetric {
  if (rows.length === 0) return emptyMetric();
  const values = rows.map((row) => ({
    prediction: Math.min(1, Math.max(0, row.prediction)),
    actual: row.actual,
  }));
  const actualRate = values.reduce((sum, value) => sum + value.actual, 0) / values.length;
  const averagePrediction = values.reduce((sum, value) => sum + value.prediction, 0) / values.length;
  return {
    count: values.length,
    positiveCount: values.reduce((sum, value) => sum + value.actual, 0),
    actualRate,
    averagePrediction,
    bias: averagePrediction - actualRate,
    brier: values.reduce((sum, value) => sum + (value.prediction - value.actual) ** 2, 0) / values.length,
    logLoss: values.reduce((sum, value) => {
      const prediction = clampProbability(value.prediction);
      return sum - (value.actual * Math.log(prediction) + (1 - value.actual) * Math.log(1 - prediction));
    }, 0) / values.length,
    calibration: calibrationBuckets(values),
    periodStart: rows[0].generatedAt,
    periodEnd: rows.at(-1)?.generatedAt ?? null,
    targetResetCount: new Set(rows.flatMap((row) => row.targetIds)).size,
  };
}

function evaluateModel(
  rows: Array<ComparableContextAwareRow>,
  prediction: (row: ComparableContextAwareRow, horizon: 24 | 48) => number,
  modelVersion: string,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
): ContextAwareProspectiveModelEvaluation {
  return {
    modelVersion,
    metrics24h: calculateMetric(getResolvedRows(rows, (row) => prediction(row, 24), 24, boundaries, asOf)),
    metrics48h: calculateMetric(getResolvedRows(rows, (row) => prediction(row, 48), 48, boundaries, asOf)),
  };
}

function getDifference(left: number, right: number, leftCount: number, rightCount: number) {
  return leftCount > 0 && rightCount > 0 && Number.isFinite(left) && Number.isFinite(right)
    ? left - right
    : null;
}

function difference(
  left: ContextAwareProspectiveModelEvaluation,
  right: ContextAwareProspectiveModelEvaluation,
): ContextAwareMetricDelta {
  return {
    brier24h: getDifference(left.metrics24h.brier, right.metrics24h.brier, left.metrics24h.count, right.metrics24h.count),
    brier48h: getDifference(left.metrics48h.brier, right.metrics48h.brier, left.metrics48h.count, right.metrics48h.count),
    logLoss24h: getDifference(left.metrics24h.logLoss, right.metrics24h.logLoss, left.metrics24h.count, right.metrics24h.count),
    logLoss48h: getDifference(left.metrics48h.logLoss, right.metrics48h.logLoss, left.metrics48h.count, right.metrics48h.count),
  };
}

function segmentMetrics(
  rows: Array<ComparableContextAwareRow>,
  state: ContextAwareContextSegment["contextState"],
  prediction: (row: ComparableContextAwareRow, horizon: 24 | 48) => number,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
): ContextAwareContextSegment {
  const selected = rows.filter((row) =>
    row.forecasts[CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION].contextAware.contextState === state,
  );
  return {
    contextState: state,
    metrics24h: calculateMetric(getResolvedRows(selected, (row) => prediction(row, 24), 24, boundaries, asOf)),
    metrics48h: calculateMetric(getResolvedRows(selected, (row) => prediction(row, 48), 48, boundaries, asOf)),
  };
}

function latestFit(rows: Array<ComparableContextAwareRow>): ContextAwareProspectiveEvaluationReport["latestFit"] {
  const latest = rows.at(-1)?.forecasts[CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION];
  const audit = latest?.contextAware;
  if (!audit) {
    return {
      generatedAt: null,
      alpha24h: null,
      betaWeak24h: null,
      betaStrong24h: null,
      alpha48h: null,
      betaWeak48h: null,
      betaStrong48h: null,
      trainingSampleCount24h: null,
      trainingSampleCount48h: null,
      excludedTrainingRowCount24h: null,
      excludedTrainingRowCount48h: null,
      excludedTrainingReasons24h: {},
      excludedTrainingReasons48h: {},
      trainingReadStatus: "unknown",
    };
  }
  return {
    generatedAt: latest?.generatedAt ?? null,
    alpha24h: audit.alpha24h,
    betaWeak24h: audit.betaWeak24h,
    betaStrong24h: audit.betaStrong24h,
    alpha48h: audit.alpha48h,
    betaWeak48h: audit.betaWeak48h,
    betaStrong48h: audit.betaStrong48h,
    trainingSampleCount24h: audit.trainingSampleCount24h,
    trainingSampleCount48h: audit.trainingSampleCount48h,
    excludedTrainingRowCount24h: audit.excludedTrainingRowCount24h,
    excludedTrainingRowCount48h: audit.excludedTrainingRowCount48h,
    excludedTrainingReasons24h: audit.excludedTrainingReasons24h,
    excludedTrainingReasons48h: audit.excludedTrainingReasons48h,
    trainingReadStatus: audit.trainingReadStatus,
  };
}

function getTargetResetCount(
  boundaries: Array<RecoveryResetBoundary>,
  evaluationStartAt: string | null,
  asOf: Date,
) {
  const start = timestamp(evaluationStartAt);
  if (start === null) return 0;
  return new Set(
    boundaries
      .filter((boundary) => {
        const eventTime = timestamp(boundary.resetAt);
        return boundary.isRandom
          && eventTime !== null
          && eventTime > start
          && eventTime <= asOf.getTime();
      })
      .map((boundary) => boundary.id),
  ).size;
}

function getPrediction(
  row: ComparableContextAwareRow,
  model: "candidate" | "ageOnly" | "challenger",
  horizonHours: 24 | 48,
) {
  if (model === "candidate") {
    const forecast = row.forecasts[CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION];
    return horizonHours === 24 ? forecast.probability24h : forecast.probability48h;
  }
  if (model === "challenger") {
    const forecast = row.forecasts[RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION];
    return horizonHours === 24 ? forecast.probability24h : forecast.probability48h;
  }
  const baseline = row.forecasts[CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION].contextAware;
  return horizonHours === 24 ? baseline.baselineProbability24h : baseline.baselineProbability48h;
}

export function evaluateContextAwareContinuousModelProspectively(
  rows: Array<ProspectiveForecastRow>,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
): ContextAwareProspectiveEvaluationReport {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError("asOf must be a valid date");
  const freezeTime = timestamp(CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT);
  if (freezeTime === null) throw new RangeError("CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT must be valid");
  const eligibleRows = rows.filter((row) => {
    const origin = timestamp(row.generatedAt);
    return origin !== null && origin >= freezeTime && origin <= asOf.getTime();
  });
  const candidateRows = eligibleRows.filter((row) =>
    isStoredForecast(row.forecasts[CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION], CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION),
  );
  const challengerRows = eligibleRows.filter((row) =>
    isStoredForecast(row.forecasts[RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION], RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION),
  );
  const comparableRows = selectComparableContextAwareForecasts(eligibleRows)
    .filter((row) => timestamp(row.generatedAt)! <= asOf.getTime());
  const dailyRows = selectDailyFirstForecasts(comparableRows) as Array<ComparableContextAwareRow>;
  const candidate = evaluateModel(
    dailyRows,
    (row, horizon) => getPrediction(row, "candidate", horizon),
    CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
    boundaries,
    asOf,
  );
  const ageOnly = evaluateModel(
    dailyRows,
    (row, horizon) => getPrediction(row, "ageOnly", horizon),
    "18/54-age-only-baseline",
    boundaries,
    asOf,
  );
  const challenger = evaluateModel(
    dailyRows,
    (row, horizon) => getPrediction(row, "challenger", horizon),
    RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    boundaries,
    asOf,
  );
  const candidateMinusAgeOnly = difference(candidate, ageOnly);
  const candidateMinusChallenger = difference(candidate, challenger);
  const evaluationStartAt = dailyRows[0]?.generatedAt ?? null;
  const targetResetCount = getTargetResetCount(boundaries, evaluationStartAt, asOf);
  const enoughData = targetResetCount >= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.targetResetCount
    && candidate.metrics24h.count >= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.resolvedDaily24h
    && candidate.metrics48h.count >= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.resolvedDaily48h;
  const candidateBrier24hNotWorse = candidateMinusChallenger.brier24h !== null
    && candidateMinusChallenger.brier24h <= 0;
  const candidateBrier48hNotWorse = candidateMinusChallenger.brier48h !== null
    && candidateMinusChallenger.brier48h <= 0;
  const candidateLogLossNotExtremelyWorse = (candidateMinusChallenger.logLoss24h ?? 0)
    <= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.maxLogLossWorsening
    && (candidateMinusChallenger.logLoss48h ?? 0)
      <= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.maxLogLossWorsening;
  const eligibleForManualReview = enoughData
    && candidateBrier24hNotWorse
    && candidateBrier48hNotWorse
    && candidateLogLossNotExtremelyWorse;
  const bothWorse = (candidateMinusChallenger.brier24h ?? 0) > 0
    && (candidateMinusChallenger.brier48h ?? 0) > 0;
  const status: ContextAwareProspectiveEvaluationReport["status"] = !enoughData
    ? "insufficient_data"
    : eligibleForManualReview
      ? "eligible_for_manual_review"
      : bothWorse
        ? "worse"
        : "promising";
  const segmentPrediction = (row: ComparableContextAwareRow, horizon: 24 | 48) =>
    getPrediction(row, "candidate", horizon);
  return {
    schemaVersion: "prospective-context-aware-continuous-model-evaluation-v1",
    status,
    generatedAt: asOf.toISOString(),
    asOf: asOf.toISOString(),
    evaluationMode: "prospective",
    backfilled: false,
    source: "prediction_history.debug_info.experimentalProbabilityForecasts",
    targetDefinition: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_TARGET_DEFINITION,
    candidateModelVersion: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
    challengerModelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    freezeAt: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT,
    evaluationStartAt,
    forecastCounts: {
      candidate: candidateRows.length,
      challenger: challengerRows.length,
      comparable: comparableRows.length,
    },
    comparison: {
      resolved24h: candidate.metrics24h.count,
      resolved48h: candidate.metrics48h.count,
      positiveCount24h: candidate.metrics24h.positiveCount,
      positiveCount48h: candidate.metrics48h.positiveCount,
      targetResetCount,
      candidateMinusAgeOnly,
      candidateMinusChallenger,
    },
    models: {
      candidate,
      ageOnly,
      challenger,
    },
    contextSegments: {
      none: segmentMetrics(dailyRows, "none", segmentPrediction, boundaries, asOf),
      weak: segmentMetrics(dailyRows, "weak", segmentPrediction, boundaries, asOf),
      strong: segmentMetrics(dailyRows, "strong", segmentPrediction, boundaries, asOf),
      unknown: segmentMetrics(dailyRows, "unknown", segmentPrediction, boundaries, asOf),
    },
    latestFit: latestFit(dailyRows),
    gate: {
      autoPublish: false,
      manualReviewOnly: true,
      thresholds: PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS,
      targetResetCount,
      resolvedDaily24h: candidate.metrics24h.count,
      resolvedDaily48h: candidate.metrics48h.count,
      candidateBrier24hNotWorse,
      candidateBrier48hNotWorse,
      candidateLogLossNotExtremelyWorse,
      eligibleForManualReview,
    },
    notes: [
      `Only rows at or after ${CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT} with the candidate, the fixed 18/54 challenger, and the candidate's saved age-only baseline are compared.`,
      "The candidate's context state is read from its saved v1 PIT audit; unknown context is retained for diagnosis and is never coerced to none for training.",
      "Resolved outcomes use the existing random-clock semantics, including regular-boundary censoring; no historical forecast is backfilled or relabeled.",
      "This report is advisory and never publishes, retunes, or changes the public model automatically.",
    ],
  };
}
