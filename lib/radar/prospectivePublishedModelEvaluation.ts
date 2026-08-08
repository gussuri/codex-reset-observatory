import {
  RECENCY_H30_PROBABILITY_MODEL_VERSION,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  SHADOW_TARGET_DEFINITION,
} from "@/data/shadowProbabilityConfig";
import { getActualWithinHorizon } from "./prequentialCalibration";
import {
  selectDailyFirstForecasts,
  type ProspectiveForecastRow,
} from "./prospectiveProbabilityEvaluation";
import type { ShadowResetEvent } from "./shadowProbability";

const HOUR_MS = 60 * 60 * 1000;
const LOG_LOSS_EPSILON = 1e-12;

export const PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION = PUBLISHED_PROBABILITY_MODEL_VERSION;
export const PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION = RECENCY_H30_PROBABILITY_MODEL_VERSION;

export const PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS = {
  targetResetCount: 5,
  resolvedDaily24h: 20,
  resolvedDaily48h: 15,
  maxLogLossWorsening: 0.05,
} as const;

type StoredForecast = {
  modelVersion: string;
  generatedAt: string;
  probability24h: number;
  probability48h: number;
  [key: string]: unknown;
};

export type PublishedProspectiveMetric = {
  count: number;
  positiveCount: number;
  actualRate: number;
  averagePrediction: number;
  brier: number;
  logLoss: number;
  calibration: Array<{
    range: string;
    count: number;
    averagePrediction: number;
    actualRate: number;
  }>;
  periodStart: string | null;
  periodEnd: string | null;
  targetResetCount: number;
};

export type PublishedProspectiveModelEvaluation = {
  modelVersion: string;
  metrics24h: PublishedProspectiveMetric;
  metrics48h: PublishedProspectiveMetric;
};

export type PublishedProspectiveEvaluationReport = {
  schemaVersion: "prospective-published-model-evaluation-v1";
  status:
    | "insufficient_data"
    | "promising"
    | "no_meaningful_difference"
    | "worse"
    | "eligible_for_manual_review";
  generatedAt: string;
  asOf: string;
  evaluationMode: "prospective";
  backfilled: false;
  source: "prediction_history.debug_info.experimentalProbabilityForecasts";
  targetDefinition: string;
  activeModelVersion: typeof PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION;
  baselineModelVersion: typeof PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION;
  evaluationStartAt: string | null;
  forecastCounts: {
    active: number;
    baseline: number;
    comparable: number;
  };
  comparison: {
    resolved24h: number;
    resolved48h: number;
    positiveCount24h: number;
    positiveCount48h: number;
    targetResetCount: number;
    activeMinusBaseline: {
      brier24h: number | null;
      brier48h: number | null;
      logLoss24h: number | null;
      logLoss48h: number | null;
    };
  };
  models: {
    active: PublishedProspectiveModelEvaluation;
    baseline: PublishedProspectiveModelEvaluation;
  };
  gate: {
    autoPublish: false;
    manualReviewOnly: true;
    thresholds: typeof PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS;
    targetResetCount: number;
    resolvedDaily24h: number;
    resolvedDaily48h: number;
    brier24hNotWorse: boolean;
    brier48hNotWorse: boolean;
    logLossNotExtremelyWorse: boolean;
    eligibleForManualReview: boolean;
  };
  notes: string[];
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getJstDayKey(value: string) {
  const time = timestamp(value);
  if (time === null) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function clampProbability(value: number) {
  return Number.isFinite(value)
    ? Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, value))
    : 0.5;
}

function getCalibrationBuckets(values: Array<{ prediction: number; actual: number }>) {
  return [0, 0.2, 0.4, 0.6, 0.8].map((lower) => {
    const upper = lower + 0.2;
    const bucket = values.filter(({ prediction }) =>
      prediction >= lower && (prediction < upper || (upper === 1 && prediction <= upper)),
    );
    return {
      range: `${Math.round(lower * 100)}-${Math.round(upper * 100)}%`,
      count: bucket.length,
      averagePrediction: bucket.length === 0
        ? 0
        : bucket.reduce((sum, value) => sum + value.prediction, 0) / bucket.length,
      actualRate: bucket.length === 0
        ? 0
        : bucket.reduce((sum, value) => sum + value.actual, 0) / bucket.length,
    };
  });
}

function isStoredForecast(value: unknown): value is StoredForecast {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const forecast = value as Record<string, unknown>;
  return (
    typeof forecast.modelVersion === "string"
    && typeof forecast.generatedAt === "string"
    && timestamp(forecast.generatedAt) !== null
    && typeof forecast.probability24h === "number"
    && Number.isFinite(forecast.probability24h)
    && typeof forecast.probability48h === "number"
    && Number.isFinite(forecast.probability48h)
  );
}

function hasComparableForecasts(row: ProspectiveForecastRow) {
  return (
    isStoredForecast(row.forecasts[PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION])
    && isStoredForecast(row.forecasts[PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION])
  );
}

export function selectComparablePublishedForecasts(rows: Array<ProspectiveForecastRow>) {
  return rows.filter(hasComparableForecasts);
}

export function selectDailyFirstPublishedForecasts(rows: Array<ProspectiveForecastRow>) {
  return selectDailyFirstForecasts(selectComparablePublishedForecasts(rows));
}

function getFirstComparableForecastAt(rows: Array<ProspectiveForecastRow>) {
  return rows
    .map((row) => ({ row, time: timestamp(row.generatedAt) }))
    .filter((item): item is { row: ProspectiveForecastRow; time: number } => item.time !== null)
    .sort((left, right) => left.time - right.time)
    .at(0)?.row.generatedAt ?? null;
}

function getResolvedRows(
  rows: Array<ProspectiveForecastRow>,
  modelVersion: string,
  horizonHours: 24 | 48,
  events: Array<ShadowResetEvent>,
  asOf: Date,
) {
  const asOfTime = asOf.getTime();
  return rows.flatMap((row) => {
    const forecast = row.forecasts[modelVersion];
    const generatedTime = timestamp(row.generatedAt);
    if (
      !isStoredForecast(forecast)
      || generatedTime === null
      || !Number.isFinite(asOfTime)
      || generatedTime + horizonHours * HOUR_MS > asOfTime
    ) {
      return [];
    }
    return [{
      generatedAt: row.generatedAt,
      prediction: horizonHours === 24 ? forecast.probability24h : forecast.probability48h,
      actual: Number(getActualWithinHorizon(events, row.generatedAt, horizonHours)),
    }];
  });
}

function calculateMetric(
  rows: Array<{ generatedAt: string; prediction: number; actual: number }>,
  events: Array<ShadowResetEvent>,
  horizonHours: 24 | 48,
): PublishedProspectiveMetric {
  const values = rows.map((row) => ({
    prediction: Math.min(1, Math.max(0, row.prediction)),
    actual: row.actual,
  }));
  const targetResetIds = new Set(
    rows.flatMap((row) => {
      const originTime = timestamp(row.generatedAt);
      if (originTime === null) return [];
      const end = originTime + horizonHours * HOUR_MS;
      return events
        .filter((event) => {
          const eventTime = timestamp(event.resetAt);
          return eventTime !== null && eventTime > originTime && eventTime <= end;
        })
        .map((event) => event.id);
    }),
  );
  if (values.length === 0) {
    return {
      count: 0,
      positiveCount: 0,
      actualRate: 0,
      averagePrediction: 0,
      brier: 0,
      logLoss: 0,
      calibration: getCalibrationBuckets([]),
      periodStart: null,
      periodEnd: null,
      targetResetCount: 0,
    };
  }
  return {
    count: values.length,
    positiveCount: values.reduce((sum, value) => sum + value.actual, 0),
    actualRate: values.reduce((sum, value) => sum + value.actual, 0) / values.length,
    averagePrediction: values.reduce((sum, value) => sum + value.prediction, 0) / values.length,
    brier: values.reduce((sum, value) => sum + (value.prediction - value.actual) ** 2, 0) / values.length,
    logLoss: values.reduce((sum, value) => {
      const prediction = clampProbability(value.prediction);
      return sum - (value.actual * Math.log(prediction) + (1 - value.actual) * Math.log(1 - prediction));
    }, 0) / values.length,
    calibration: getCalibrationBuckets(values),
    periodStart: rows[0].generatedAt,
    periodEnd: rows.at(-1)?.generatedAt ?? null,
    targetResetCount: targetResetIds.size,
  };
}

function createModelEvaluation(
  rows: Array<ProspectiveForecastRow>,
  modelVersion: string,
  events: Array<ShadowResetEvent>,
  asOf: Date,
): PublishedProspectiveModelEvaluation {
  return {
    modelVersion,
    metrics24h: calculateMetric(getResolvedRows(rows, modelVersion, 24, events, asOf), events, 24),
    metrics48h: calculateMetric(getResolvedRows(rows, modelVersion, 48, events, asOf), events, 48),
  };
}

function difference(active: number, baseline: number, sampleCount: number) {
  return sampleCount > 0 && Number.isFinite(active) && Number.isFinite(baseline)
    ? active - baseline
    : null;
}

function getTargetResetCount(
  events: Array<ShadowResetEvent>,
  evaluationStartAt: string | null,
  asOf: Date,
) {
  const start = timestamp(evaluationStartAt);
  if (start === null) return 0;
  return new Set(
    events
      .filter((event) => {
        const eventTime = timestamp(event.resetAt);
        return eventTime !== null && eventTime > start && eventTime <= asOf.getTime();
      })
      .map((event) => event.id),
  ).size;
}

export function evaluatePublishedModelProspectively(
  rows: Array<ProspectiveForecastRow>,
  events: Array<ShadowResetEvent>,
  asOf: Date,
): PublishedProspectiveEvaluationReport {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError("asOf must be a valid date");

  const comparableRows = selectComparablePublishedForecasts(rows).filter((row) => {
    const generatedAt = timestamp(row.generatedAt);
    return generatedAt !== null && generatedAt <= asOf.getTime();
  });
  const eligibleRows = rows.filter((row) => {
    const generatedAt = timestamp(row.generatedAt);
    return generatedAt !== null && generatedAt <= asOf.getTime();
  });
  const dailyRows = selectDailyFirstPublishedForecasts(comparableRows);
  const active = createModelEvaluation(
    dailyRows,
    PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
    events,
    asOf,
  );
  const baseline = createModelEvaluation(
    dailyRows,
    PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION,
    events,
    asOf,
  );
  const evaluationStartAt = getFirstComparableForecastAt(comparableRows);
  const targetResetCount = getTargetResetCount(events, evaluationStartAt, asOf);
  const brier24h = difference(active.metrics24h.brier, baseline.metrics24h.brier, active.metrics24h.count);
  const brier48h = difference(active.metrics48h.brier, baseline.metrics48h.brier, active.metrics48h.count);
  const logLoss24h = difference(active.metrics24h.logLoss, baseline.metrics24h.logLoss, active.metrics24h.count);
  const logLoss48h = difference(active.metrics48h.logLoss, baseline.metrics48h.logLoss, active.metrics48h.count);
  const resolvedDaily24h = active.metrics24h.count;
  const resolvedDaily48h = active.metrics48h.count;
  const enoughData = targetResetCount >= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.targetResetCount
    && resolvedDaily24h >= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.resolvedDaily24h
    && resolvedDaily48h >= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.resolvedDaily48h;
  const brier24hNotWorse = brier24h !== null && brier24h <= 0;
  const brier48hNotWorse = brier48h !== null && brier48h <= 0;
  const logLossNotExtremelyWorse = (logLoss24h ?? 0) <= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.maxLogLossWorsening
    && (logLoss48h ?? 0) <= PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS.maxLogLossWorsening;
  const eligibleForManualReview = enoughData
    && brier24hNotWorse
    && brier48hNotWorse
    && logLossNotExtremelyWorse;
  const bothWorse = (brier24h ?? 0) > 0 && (brier48h ?? 0) > 0;
  const smallDifference = Math.max(Math.abs(brier24h ?? 0), Math.abs(brier48h ?? 0)) < 0.01;
  const status = !enoughData
    ? "insufficient_data"
    : eligibleForManualReview
      ? "eligible_for_manual_review"
      : bothWorse
        ? "worse"
        : smallDifference
          ? "no_meaningful_difference"
          : "promising";

  return {
    schemaVersion: "prospective-published-model-evaluation-v1",
    status,
    generatedAt: asOf.toISOString(),
    asOf: asOf.toISOString(),
    evaluationMode: "prospective",
    backfilled: false,
    source: "prediction_history.debug_info.experimentalProbabilityForecasts",
    targetDefinition: SHADOW_TARGET_DEFINITION,
    activeModelVersion: PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
    baselineModelVersion: PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION,
    evaluationStartAt,
    forecastCounts: {
      active: eligibleRows.filter((row) => isStoredForecast(row.forecasts[PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION])).length,
      baseline: eligibleRows.filter((row) => isStoredForecast(row.forecasts[PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION])).length,
      comparable: comparableRows.length,
    },
    comparison: {
      resolved24h: active.metrics24h.count,
      resolved48h: active.metrics48h.count,
      positiveCount24h: active.metrics24h.positiveCount,
      positiveCount48h: active.metrics48h.positiveCount,
      targetResetCount,
      activeMinusBaseline: {
        brier24h,
        brier48h,
        logLoss24h,
        logLoss48h,
      },
    },
    models: { active, baseline },
    gate: {
      autoPublish: false,
      manualReviewOnly: true,
      thresholds: PROSPECTIVE_PUBLISHED_GATE_THRESHOLDS,
      targetResetCount,
      resolvedDaily24h,
      resolvedDaily48h,
      brier24hNotWorse,
      brier48hNotWorse,
      logLossNotExtremelyWorse,
      eligibleForManualReview,
    },
    notes: [
      "Only prediction_history rows containing both the active and baseline forecasts are compared.",
      "Rows before the first comparable forecast are not backfilled and are not relabeled.",
      "The daily representative is the first saved forecast in each Asia/Tokyo calendar day; unresolved 24h/48h horizons are excluded.",
      "Target positives are completed broad-scope random reset events only; regular reset boundaries are not random target positives.",
      "Prospective results alone never auto-publish or retune a model; manual review is required.",
      "hazard-regime-elapsed-v1 parameters remain fixed throughout the evaluation period.",
    ],
  };
}

export function formatPublishedProspectiveMetric(metric: PublishedProspectiveMetric) {
  return `n=${metric.count}, positive=${metric.positiveCount}, actual=${(metric.actualRate * 100).toFixed(2)}%, mean=${(metric.averagePrediction * 100).toFixed(2)}%, Brier=${metric.brier.toFixed(4)}, logLoss=${metric.logLoss.toFixed(4)}, targetResets=${metric.targetResetCount}`;
}

export function getJstDayKeyForProspective(value: string) {
  return getJstDayKey(value);
}
