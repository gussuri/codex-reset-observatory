import {
  PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION,
  PUBLISHED_PROBABILITY_ADOPTION_AT,
  PUBLISHED_PROBABILITY_ADOPTION_GATE_STATUS,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  PUBLISHED_STABLE_FALLBACK_MODEL_VERSION,
  SHADOW_TARGET_DEFINITION,
  NEXT_GENERATION_B_RAW_MODEL_VERSION,
  NEXT_GENERATION_V3_MODEL_VERSION,
} from "@/data/shadowProbabilityConfig";
import { getActualWithinHorizon } from "./prequentialCalibration";
import {
  selectDailyFirstForecasts,
  type ProspectiveForecastRow,
  type ProspectiveStoredForecast,
} from "./prospectiveProbabilityEvaluation";
import type { ShadowResetEvent } from "./shadowProbability";

const HOUR_MS = 60 * 60 * 1000;
const LOG_LOSS_EPSILON = 1e-12;

export const PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION = PUBLISHED_PROBABILITY_MODEL_VERSION;
export const PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION = PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION;
export const PROSPECTIVE_PUBLISHED_V3_MODEL_VERSION = NEXT_GENERATION_V3_MODEL_VERSION;
export const PROSPECTIVE_PUBLISHED_FINAL_DISPLAY_MODEL_VERSION = "published-final-displayed";
export const PROSPECTIVE_PUBLISHED_RAW_CONTINUOUS_MODEL_VERSION = NEXT_GENERATION_B_RAW_MODEL_VERSION;

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

export type PublishedUnifiedModelSeries = PublishedProspectiveModelEvaluation & {
  source: string;
};

export type PublishedUnifiedModelSeriesSet = {
  finalDisplayed: PublishedUnifiedModelSeries;
  v3: PublishedUnifiedModelSeries;
  currentV2: PublishedUnifiedModelSeries;
  rawContinuous: PublishedUnifiedModelSeries;
  v1: PublishedUnifiedModelSeries;
};

export type PublishedUnifiedSubset = {
  originCount: number;
  origins: string[];
  series: PublishedUnifiedModelSeriesSet;
};

export type PublishedUnifiedComparison = {
  originCount: number;
  origins: string[];
  series: PublishedUnifiedModelSeriesSet;
  subsets: {
    noOfficialNotice: PublishedUnifiedSubset;
    noFinalDisplaySpecialOverlay: PublishedUnifiedSubset;
    noticeOverrideActive: PublishedUnifiedSubset;
    latestRandomReset0To24h: PublishedUnifiedSubset;
  };
  deltaVsCurrentV2: {
    finalDisplayed: {
      brier24h: number | null;
      brier48h: number | null;
      logLoss24h: number | null;
      logLoss48h: number | null;
    };
    v3: {
      brier24h: number | null;
      brier48h: number | null;
      logLoss24h: number | null;
      logLoss48h: number | null;
    };
    rawContinuous: {
      brier24h: number | null;
      brier48h: number | null;
      logLoss24h: number | null;
      logLoss48h: number | null;
    };
    v1: {
      brier24h: number | null;
      brier48h: number | null;
      logLoss24h: number | null;
      logLoss48h: number | null;
    };
  };
  retrospectiveV3: true;
};

export type PublishedPostResetDiagnosticMetric = {
  sampleCount: number;
  positiveCount: number;
  activeMeanPrediction: number | null;
  baselineMeanPrediction: number | null;
  activeBrier: number | null;
  baselineBrier: number | null;
  brierDelta: number | null;
  activeLogLoss: number | null;
  baselineLogLoss: number | null;
  logLossDelta: number | null;
  meanProbabilityDelta: number | null;
};

export type PublishedPostResetDiagnostic = {
  allEligibleOriginCount: number;
  representativeOriginCount: number;
  representativeOrigins: Array<{
    resetId: string;
    resetAt: string;
    generatedAt: string;
  }>;
  metrics24h: PublishedPostResetDiagnosticMetric;
  metrics48h: PublishedPostResetDiagnosticMetric;
};

export type PublishedProspectiveEvaluationReport = {
  schemaVersion: "prospective-published-model-evaluation-v2";
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
  canonicalRandomResetEvents: Array<ShadowResetEvent>;
  postResetDiagnostic: PublishedPostResetDiagnostic;
  unifiedComparison: PublishedUnifiedComparison;
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

export type PublishedProspectiveEvaluationOptions = {
  adoptionAt?: string | null;
  v3Forecasts?: Record<string, ProspectiveStoredForecast>;
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

type UnifiedPublishedOrigin = {
  row: ProspectiveForecastRow;
  finalDisplayed: ProspectiveStoredForecast;
  v3: ProspectiveStoredForecast;
  currentV2: StoredForecast;
  rawContinuous: StoredForecast;
  v1: StoredForecast;
};

function isSameOrigin(left: StoredForecast, right: StoredForecast) {
  const leftTime = timestamp(left.generatedAt);
  const rightTime = timestamp(right.generatedAt);
  return leftTime !== null && leftTime === rightTime;
}

function getUnifiedPublishedOrigins(
  rows: Array<ProspectiveForecastRow>,
  v3Forecasts: Record<string, ProspectiveStoredForecast> | undefined,
) {
  return rows.flatMap((row): Array<UnifiedPublishedOrigin> => {
    const finalDisplayed = row.finalDisplayed;
    const currentV2 = row.forecasts[PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION];
    const v1 = row.forecasts[PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION];
    const v3 = v3Forecasts?.[row.generatedAt];
    if (
      !finalDisplayed
      || !isStoredForecast(finalDisplayed)
      || !isStoredForecast(currentV2)
      || !isStoredForecast(v1)
      || !v3
      || !isStoredForecast(v3)
      || !isSameOrigin(finalDisplayed, currentV2)
      || !isSameOrigin(v3, currentV2)
      || !isSameOrigin(v1, currentV2)
      || typeof currentV2.rawProbability24h !== "number"
      || !Number.isFinite(currentV2.rawProbability24h)
      || typeof currentV2.rawProbability48h !== "number"
      || !Number.isFinite(currentV2.rawProbability48h)
    ) {
      return [];
    }
    return [{
      row,
      finalDisplayed,
      v3,
      currentV2,
      rawContinuous: {
        modelVersion: PROSPECTIVE_PUBLISHED_RAW_CONTINUOUS_MODEL_VERSION,
        generatedAt: currentV2.generatedAt,
        probability24h: currentV2.rawProbability24h,
        probability48h: currentV2.rawProbability48h,
      },
      v1,
    }];
  });
}

function toSeriesRows(
  origins: Array<UnifiedPublishedOrigin>,
  modelKey: string,
  getForecast: (origin: UnifiedPublishedOrigin) => StoredForecast | ProspectiveStoredForecast,
) {
  return origins.map((origin) => ({
    generatedAt: origin.row.generatedAt,
    loggedHour: origin.row.loggedHour,
    forecasts: { [modelKey]: getForecast(origin) },
  }));
}

function createUnifiedSeries(
  origins: Array<UnifiedPublishedOrigin>,
  modelKey: string,
  modelVersion: string,
  source: string,
  getForecast: (origin: UnifiedPublishedOrigin) => StoredForecast | ProspectiveStoredForecast,
  events: Array<ShadowResetEvent>,
  asOf: Date,
): PublishedUnifiedModelSeries {
  const rows = toSeriesRows(origins, modelKey, getForecast);
  return {
    modelVersion,
    source,
    metrics24h: calculateMetric(getResolvedRows(rows, modelKey, 24, events, asOf), events, 24),
    metrics48h: calculateMetric(getResolvedRows(rows, modelKey, 48, events, asOf), events, 48),
  };
}

function createUnifiedSeriesSet(
  origins: Array<UnifiedPublishedOrigin>,
  events: Array<ShadowResetEvent>,
  asOf: Date,
): PublishedUnifiedModelSeriesSet {
  return {
    finalDisplayed: createUnifiedSeries(
      origins,
      PROSPECTIVE_PUBLISHED_FINAL_DISPLAY_MODEL_VERSION,
      PROSPECTIVE_PUBLISHED_FINAL_DISPLAY_MODEL_VERSION,
      "prediction_history.probability_24h/probability_48h",
      (origin) => origin.finalDisplayed,
      events,
      asOf,
    ),
    v3: createUnifiedSeries(
      origins,
      PROSPECTIVE_PUBLISHED_V3_MODEL_VERSION,
      PROSPECTIVE_PUBLISHED_V3_MODEL_VERSION,
      "retrospective point-in-time calculateNextGenerationV3Probability",
      (origin) => origin.v3,
      events,
      asOf,
    ),
    currentV2: createUnifiedSeries(
      origins,
      PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
      PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION,
      "prediction_history.debug_info.experimentalProbabilityForecasts",
      (origin) => origin.currentV2,
      events,
      asOf,
    ),
    rawContinuous: createUnifiedSeries(
      origins,
      PROSPECTIVE_PUBLISHED_RAW_CONTINUOUS_MODEL_VERSION,
      PROSPECTIVE_PUBLISHED_RAW_CONTINUOUS_MODEL_VERSION,
      "saved v2 rawProbability24h/rawProbability48h",
      (origin) => origin.rawContinuous,
      events,
      asOf,
    ),
    v1: createUnifiedSeries(
      origins,
      PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION,
      PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION,
      "prediction_history.debug_info.experimentalProbabilityForecasts",
      (origin) => origin.v1,
      events,
      asOf,
    ),
  };
}

function createUnifiedSubset(
  origins: Array<UnifiedPublishedOrigin>,
  events: Array<ShadowResetEvent>,
  asOf: Date,
): PublishedUnifiedSubset {
  return {
    originCount: origins.length,
    origins: origins.map((origin) => origin.row.generatedAt),
    series: createUnifiedSeriesSet(origins, events, asOf),
  };
}

function compareUnifiedSeries(
  candidate: PublishedUnifiedModelSeries,
  current: PublishedUnifiedModelSeries,
) {
  return {
    brier24h: difference(candidate.metrics24h.brier, current.metrics24h.brier, candidate.metrics24h.count),
    brier48h: difference(candidate.metrics48h.brier, current.metrics48h.brier, candidate.metrics48h.count),
    logLoss24h: difference(candidate.metrics24h.logLoss, current.metrics24h.logLoss, candidate.metrics24h.count),
    logLoss48h: difference(candidate.metrics48h.logLoss, current.metrics48h.logLoss, candidate.metrics48h.count),
  };
}

function buildUnifiedComparison(
  dailyRows: Array<ProspectiveForecastRow>,
  events: Array<ShadowResetEvent>,
  asOf: Date,
  v3Forecasts: Record<string, ProspectiveStoredForecast> | undefined,
): PublishedUnifiedComparison {
  const origins = getUnifiedPublishedOrigins(dailyRows, v3Forecasts);
  const series = createUnifiedSeriesSet(origins, events, asOf);
  const activeOrigins = origins.filter((origin) => origin.currentV2.officialNoticeOverride !== true);
  const noFinalDisplayOverlay = origins.filter((origin) =>
    origin.finalDisplayed.finalDisplaySpecialOverlay !== true,
  );
  const noticeOverrideOrigins = origins.filter((origin) => origin.currentV2.officialNoticeOverride === true);
  const postResetOrigins = origins.filter((origin) => {
    const metadata = getSavedPostResetMetadata(origin.currentV2);
    return metadata !== null && metadata.elapsedHours > 0 && metadata.elapsedHours <= 24;
  });
  return {
    originCount: origins.length,
    origins: origins.map((origin) => origin.row.generatedAt),
    series,
    subsets: {
      noOfficialNotice: createUnifiedSubset(activeOrigins, events, asOf),
      noFinalDisplaySpecialOverlay: createUnifiedSubset(noFinalDisplayOverlay, events, asOf),
      noticeOverrideActive: createUnifiedSubset(noticeOverrideOrigins, events, asOf),
      latestRandomReset0To24h: createUnifiedSubset(postResetOrigins, events, asOf),
    },
    deltaVsCurrentV2: {
      finalDisplayed: compareUnifiedSeries(series.finalDisplayed, series.currentV2),
      v3: compareUnifiedSeries(series.v3, series.currentV2),
      rawContinuous: compareUnifiedSeries(series.rawContinuous, series.currentV2),
      v1: compareUnifiedSeries(series.v1, series.currentV2),
    },
    retrospectiveV3: true,
  };
}

type PostResetDiagnosticOrigin = {
  reset: ShadowResetEvent;
  generatedAt: string;
  active: StoredForecast;
  baseline: StoredForecast;
};

function getSavedPostResetMetadata(forecast: StoredForecast) {
  const resetAt = typeof forecast.latestRandomResetAt === "string"
    ? timestamp(forecast.latestRandomResetAt)
    : null;
  const elapsedHours = typeof forecast.elapsedHoursSinceRandom === "number"
    ? forecast.elapsedHoursSinceRandom
    : typeof forecast.randomElapsedHours === "number"
      ? forecast.randomElapsedHours
      : null;
  if (
    resetAt === null
    || elapsedHours === null
    || !Number.isFinite(elapsedHours)
  ) {
    return null;
  }
  return { resetAt, elapsedHours };
}

function getPostResetDiagnosticOrigins(
  rows: Array<ProspectiveForecastRow>,
  events: Array<ShadowResetEvent>,
) {
  const sortedRows = rows
    .map((row) => ({ row, time: timestamp(row.generatedAt) }))
    .filter((item): item is { row: ProspectiveForecastRow; time: number } => item.time !== null)
    .sort((left, right) => {
      const timeDifference = left.time - right.time;
      return timeDifference || (timestamp(left.row.loggedHour) ?? 0) - (timestamp(right.row.loggedHour) ?? 0);
    });
  const canonicalEventsByTime = new Map<number, ShadowResetEvent>();
  for (const event of events) {
    const resetTime = timestamp(event.resetAt);
    if (resetTime !== null && !canonicalEventsByTime.has(resetTime)) {
      canonicalEventsByTime.set(resetTime, event);
    }
  }

  const eligibleOrigins: Array<PostResetDiagnosticOrigin> = [];
  for (const { row } of sortedRows) {
    const active = row.forecasts[PROSPECTIVE_PUBLISHED_ACTIVE_MODEL_VERSION];
    const baseline = row.forecasts[PROSPECTIVE_PUBLISHED_BASELINE_MODEL_VERSION];
    if (!isStoredForecast(active) || !isStoredForecast(baseline)) continue;
    const activeMetadata = getSavedPostResetMetadata(active);
    const baselineMetadata = getSavedPostResetMetadata(baseline);
    if (
      !activeMetadata
      || !baselineMetadata
      || activeMetadata.resetAt !== baselineMetadata.resetAt
      || activeMetadata.elapsedHours <= 0
      || activeMetadata.elapsedHours > 24
    ) {
      continue;
    }
    const reset = canonicalEventsByTime.get(activeMetadata.resetAt);
    if (!reset) continue;
    eligibleOrigins.push({ reset, generatedAt: row.generatedAt, active, baseline });
  }

  const representativeByReset = new Map<string, PostResetDiagnosticOrigin>();
  for (const origin of eligibleOrigins) {
    const key = origin.reset.id;
    if (!representativeByReset.has(key)) representativeByReset.set(key, origin);
  }
  const representativeOrigins = Array.from(representativeByReset.values())
    .sort((left, right) => timestamp(left.generatedAt)! - timestamp(right.generatedAt)!);

  return {
    allEligibleOriginCount: eligibleOrigins.length,
    representativeOrigins,
  };
}

function emptyPostResetDiagnosticMetric(): PublishedPostResetDiagnosticMetric {
  return {
    sampleCount: 0,
    positiveCount: 0,
    activeMeanPrediction: null,
    baselineMeanPrediction: null,
    activeBrier: null,
    baselineBrier: null,
    brierDelta: null,
    activeLogLoss: null,
    baselineLogLoss: null,
    logLossDelta: null,
    meanProbabilityDelta: null,
  };
}

function calculatePostResetDiagnosticMetric(
  origins: Array<PostResetDiagnosticOrigin>,
  horizonHours: 24 | 48,
  events: Array<ShadowResetEvent>,
  asOf: Date,
): PublishedPostResetDiagnosticMetric {
  const asOfTime = asOf.getTime();
  const values = origins.flatMap((origin) => {
    const generatedTime = timestamp(origin.generatedAt);
    if (
      generatedTime === null
      || !Number.isFinite(asOfTime)
      || generatedTime + horizonHours * HOUR_MS > asOfTime
    ) {
      return [];
    }
    const activePrediction = horizonHours === 24
      ? origin.active.probability24h
      : origin.active.probability48h;
    const baselinePrediction = horizonHours === 24
      ? origin.baseline.probability24h
      : origin.baseline.probability48h;
    const actual = Number(getActualWithinHorizon(events, origin.generatedAt, horizonHours));
    return [{ activePrediction, baselinePrediction, actual }];
  });
  if (values.length === 0) return emptyPostResetDiagnosticMetric();

  const activePredictions = values.map((value) => Math.min(1, Math.max(0, value.activePrediction)));
  const baselinePredictions = values.map((value) => Math.min(1, Math.max(0, value.baselinePrediction)));
  const positiveCount = values.reduce((sum, value) => sum + value.actual, 0);
  const activeBrier = activePredictions.reduce((sum, prediction, index) =>
    sum + (prediction - values[index].actual) ** 2, 0) / values.length;
  const baselineBrier = baselinePredictions.reduce((sum, prediction, index) =>
    sum + (prediction - values[index].actual) ** 2, 0) / values.length;
  const activeLogLoss = activePredictions.reduce((sum, prediction, index) => {
    const probability = clampProbability(prediction);
    const actual = values[index].actual;
    return sum - (actual * Math.log(probability) + (1 - actual) * Math.log(1 - probability));
  }, 0) / values.length;
  const baselineLogLoss = baselinePredictions.reduce((sum, prediction, index) => {
    const probability = clampProbability(prediction);
    const actual = values[index].actual;
    return sum - (actual * Math.log(probability) + (1 - actual) * Math.log(1 - probability));
  }, 0) / values.length;

  return {
    sampleCount: values.length,
    positiveCount,
    activeMeanPrediction: activePredictions.reduce((sum, prediction) => sum + prediction, 0) / values.length,
    baselineMeanPrediction: baselinePredictions.reduce((sum, prediction) => sum + prediction, 0) / values.length,
    activeBrier,
    baselineBrier,
    brierDelta: activeBrier - baselineBrier,
    activeLogLoss,
    baselineLogLoss,
    logLossDelta: activeLogLoss - baselineLogLoss,
    meanProbabilityDelta: activePredictions.reduce((sum, prediction, index) =>
      sum + prediction - baselinePredictions[index], 0) / values.length,
  };
}

function calculatePostResetDiagnostic(
  rows: Array<ProspectiveForecastRow>,
  events: Array<ShadowResetEvent>,
  asOf: Date,
): PublishedPostResetDiagnostic {
  const { allEligibleOriginCount, representativeOrigins } = getPostResetDiagnosticOrigins(rows, events);
  return {
    allEligibleOriginCount,
    representativeOriginCount: representativeOrigins.length,
    representativeOrigins: representativeOrigins.map((origin) => ({
      resetId: origin.reset.id,
      resetAt: origin.reset.resetAt,
      generatedAt: origin.generatedAt,
    })),
    metrics24h: calculatePostResetDiagnosticMetric(representativeOrigins, 24, events, asOf),
    metrics48h: calculatePostResetDiagnosticMetric(representativeOrigins, 48, events, asOf),
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
  options: PublishedProspectiveEvaluationOptions = {},
): PublishedProspectiveEvaluationReport {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError("asOf must be a valid date");

  const usesConfiguredBoundary = options.adoptionAt === undefined;
  const configuredAdoptionValue = usesConfiguredBoundary
    ? PUBLISHED_PROBABILITY_ADOPTION_AT
    : options.adoptionAt;
  const adoptionAt = timestamp(configuredAdoptionValue);
  // An explicit null remains a useful test/audit override meaning "evaluate
  // without a boundary". The committed production default is different:
  // null means v2 has not been cut over and must not score any rows yet.
  const adoptionBoundaryPending = usesConfiguredBoundary && adoptionAt === null;
  const isAfterAdoption = (generatedAt: string) => {
    const generatedTime = timestamp(generatedAt);
    return generatedTime !== null
      && !adoptionBoundaryPending
      && (adoptionAt === null || generatedTime >= adoptionAt);
  };

  const comparableRows = selectComparablePublishedForecasts(rows).filter((row) => {
    const generatedAt = timestamp(row.generatedAt);
    return generatedAt !== null && generatedAt <= asOf.getTime() && isAfterAdoption(row.generatedAt);
  });
  const eligibleRows = rows.filter((row) => {
    const generatedAt = timestamp(row.generatedAt);
    return generatedAt !== null && generatedAt <= asOf.getTime() && isAfterAdoption(row.generatedAt);
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

  const adoptionBoundaryNote = adoptionBoundaryPending
    ? `The ${PUBLISHED_PROBABILITY_MODEL_VERSION} production adoption boundary is not configured; no forecast rows are evaluated as v2 and no history is relabeled.`
    : `Only forecasts generated at or after the manual adoption boundary ${new Date(adoptionAt!).toISOString()} are evaluated as the adopted public model ${PUBLISHED_PROBABILITY_MODEL_VERSION}; earlier rows remain historical data and are not relabeled.`;
  const adoptionStatusNote = adoptionBoundaryPending
    ? `The ${PUBLISHED_PROBABILITY_MODEL_VERSION} promotion has no explicit Production adoption boundary; ${PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION} remains the comparison baseline and current runtime, and the prospective gate remains ${PUBLISHED_PROBABILITY_ADOPTION_GATE_STATUS}.`
    : `The ${PUBLISHED_PROBABILITY_MODEL_VERSION} public model is manually governed at the explicit adoption boundary; ${PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION} remains the comparison baseline, and the prospective gate remains ${PUBLISHED_PROBABILITY_ADOPTION_GATE_STATUS}.`;
  const canonicalRandomResetEvents = adoptionBoundaryPending
    ? []
    : events
      .filter((event) => {
        const resetTime = timestamp(event.resetAt);
        return resetTime !== null && (adoptionAt === null || resetTime >= adoptionAt!);
      })
      .map((event) => ({ id: event.id, resetAt: event.resetAt }));

  return {
    schemaVersion: "prospective-published-model-evaluation-v2",
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
    canonicalRandomResetEvents,
    postResetDiagnostic: calculatePostResetDiagnostic(comparableRows, events, asOf),
    unifiedComparison: buildUnifiedComparison(
      dailyRows,
      events,
      asOf,
      options.v3Forecasts,
    ),
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
      "The post-reset 0-24h section is a separate descriptive diagnostic using the first saved comparable origin per canonical random reset; it never affects the primary gate or manual-review status.",
      "The unified model comparison uses the same daily-first origins and canonical truth for final displayed, v3 retrospective, current v2, raw continuous, and v1 series; v3 is point-in-time retrospective only and never affects the primary gate or status.",
      adoptionBoundaryNote,
      "Prospective results alone never auto-publish or retune a model; manual review is required.",
      `The stable ${PUBLISHED_STABLE_FALLBACK_MODEL_VERSION} fallback and hazard-regime-elapsed-v1 shadow parameters remain fixed throughout the evaluation period.`,
      adoptionStatusNote,
    ],
  };
}

export function formatPublishedProspectiveMetric(metric: PublishedProspectiveMetric) {
  return `n=${metric.count}, positive=${metric.positiveCount}, actual=${(metric.actualRate * 100).toFixed(2)}%, mean=${(metric.averagePrediction * 100).toFixed(2)}%, Brier=${metric.brier.toFixed(4)}, logLoss=${metric.logLoss.toFixed(4)}, targetResets=${metric.targetResetCount}`;
}

export function getJstDayKeyForProspective(value: string) {
  return getJstDayKey(value);
}
