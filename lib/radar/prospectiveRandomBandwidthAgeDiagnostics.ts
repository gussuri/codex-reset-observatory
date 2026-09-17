import {
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_POLICY,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_TARGET_DEFINITION,
} from "@/data/shadowProbabilityConfig";
import {
  getRandomClockOutcome,
} from "./prospectiveRandomClockModelEvaluation";
import {
  selectDailyFirstForecasts,
  type ProspectiveCalibrationBucket,
  type ProspectiveForecastRow,
  type ProspectiveMetric,
  type ProspectiveStoredForecast,
} from "./prospectiveProbabilityEvaluation";
import type { RecoveryResetBoundary } from "./recoveryBoundary";

const HOUR_MS = 60 * 60 * 1000;
const LOG_LOSS_EPSILON = 1e-12;

export const RANDOM_CONTINUOUS_BANDWIDTH_AGE_BUCKETS = [
  "<120h",
  "120-144h",
  "144-168h",
  "168-192h",
  "192-216h",
  ">=216h",
] as const;

export type RandomContinuousBandwidthAgeBucket =
  typeof RANDOM_CONTINUOUS_BANDWIDTH_AGE_BUCKETS[number];

const HISTORICAL_INTERVAL_BUCKETS = [
  "0-24h",
  "24-48h",
  "48-72h",
  "72-96h",
  "96-120h",
  "120-144h",
  "144-168h",
  "168-192h",
  "192-216h",
  "216-240h",
  "240h+",
] as const;

type HistoricalIntervalBucket = typeof HISTORICAL_INTERVAL_BUCKETS[number];

export type RandomBandwidthAgeHorizonMetrics = {
  baseline: ProspectiveMetric;
  final: ProspectiveMetric;
};

export type RandomBandwidthAgeBucketMetrics = {
  ageBucket: RandomContinuousBandwidthAgeBucket;
  metrics24h: RandomBandwidthAgeHorizonMetrics;
  metrics48h: RandomBandwidthAgeHorizonMetrics;
};

export type RandomBandwidthAgeModelEvaluation = {
  modelVersion: string;
  forecastCount: number;
  metrics24h: RandomBandwidthAgeHorizonMetrics;
  metrics48h: RandomBandwidthAgeHorizonMetrics;
  ageBuckets: Array<RandomBandwidthAgeBucketMetrics>;
  unknownAgeCount: number;
};

export type RandomContinuousBandwidthAgeDiagnosticsReport = {
  schemaVersion: "prospective-random-bandwidth-age-diagnostic-v1";
  status: "insufficient_data" | "available";
  generatedAt: string;
  asOf: string;
  evaluationMode: "prospective";
  backfilled: false;
  source: "prediction_history.debug_info.experimentalProbabilityForecasts";
  targetDefinition: typeof RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_TARGET_DEFINITION;
  freezeAt: typeof RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT;
  freezePolicy: typeof RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_POLICY;
  evaluationStartAt: string | null;
  canonicalRandomBoundaryCount: number;
  forecastCounts: Record<string, number>;
  models: RandomBandwidthAgeDiagnosticsModelMap;
  notes: string[];
};

type RandomBandwidthAgeDiagnosticsModelMap = Record<
  typeof RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS[number],
  RandomBandwidthAgeModelEvaluation
>;

type EvaluationPoint = {
  generatedAt: string;
  baselinePrediction: number | null;
  finalPrediction: number;
  actual: number;
  targetIds: string[];
  ageHours: number | null;
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function clampProbability(value: number) {
  return Number.isFinite(value)
    ? Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, value))
    : 0.5;
}

function getCalibrationBuckets(values: Array<{ prediction: number; actual: number }>) {
  return [0, 0.2, 0.4, 0.6, 0.8].map((lower): ProspectiveCalibrationBucket => {
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

function calculateMetric(
  points: Array<EvaluationPoint>,
  predictionKey: "baselinePrediction" | "finalPrediction",
): ProspectiveMetric {
  const values = points.flatMap((point) => {
    const prediction = point[predictionKey];
    return typeof prediction === "number" && Number.isFinite(prediction)
      ? [{
          prediction: Math.min(1, Math.max(0, prediction)),
          actual: point.actual,
        }]
      : [];
  });
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
    periodStart: points[0].generatedAt,
    periodEnd: points.at(-1)?.generatedAt ?? null,
    targetResetCount: new Set(points.flatMap((point) => point.targetIds)).size,
  };
}

export function getRandomContinuousBandwidthAgeBucket(
  ageHours: number,
): RandomContinuousBandwidthAgeBucket | null {
  if (!Number.isFinite(ageHours) || ageHours < 0) return null;
  if (ageHours < 120) return "<120h";
  if (ageHours < 144) return "120-144h";
  if (ageHours < 168) return "144-168h";
  if (ageHours < 192) return "168-192h";
  if (ageHours < 216) return "192-216h";
  return ">=216h";
}

function getHistoricalIntervalBucket(intervalHours: number): HistoricalIntervalBucket | null {
  if (!Number.isFinite(intervalHours) || intervalHours < 0) return null;
  if (intervalHours < 24) return "0-24h";
  if (intervalHours < 48) return "24-48h";
  if (intervalHours < 72) return "48-72h";
  if (intervalHours < 96) return "72-96h";
  if (intervalHours < 120) return "96-120h";
  if (intervalHours < 144) return "120-144h";
  if (intervalHours < 168) return "144-168h";
  if (intervalHours < 192) return "168-192h";
  if (intervalHours < 216) return "192-216h";
  if (intervalHours < 240) return "216-240h";
  return "240h+";
}

function addExposure(
  bucketExposure: Map<HistoricalIntervalBucket, number>,
  startHours: number,
  durationHours: number,
) {
  if (!Number.isFinite(startHours) || !Number.isFinite(durationHours) || durationHours <= 0) return;
  const endHours = startHours + durationHours;
  let cursor = Math.max(0, startHours);
  while (cursor < endHours) {
    const bucket = getHistoricalIntervalBucket(cursor);
    if (!bucket) break;
    const boundary = bucket === "0-24h" ? 24
      : bucket === "24-48h" ? 48
        : bucket === "48-72h" ? 72
          : bucket === "72-96h" ? 96
            : bucket === "96-120h" ? 120
              : bucket === "120-144h" ? 144
                : bucket === "144-168h" ? 168
                  : bucket === "168-192h" ? 192
                    : bucket === "192-216h" ? 216
                      : bucket === "216-240h" ? 240
                        : Number.POSITIVE_INFINITY;
    const segmentEnd = Math.min(endHours, boundary);
    bucketExposure.set(bucket, (bucketExposure.get(bucket) ?? 0) + Math.max(0, segmentEnd - cursor));
    if (!Number.isFinite(segmentEnd) || segmentEnd <= cursor) break;
    cursor = segmentEnd;
  }
}

export function summarizeRandomResetIntervals(
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
) {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError("asOf must be a valid date");
  const asOfTime = asOf.getTime();
  const randomBoundaries = boundaries
    .filter((boundary) => boundary.isRandom)
    .map((boundary) => ({ boundary, time: timestamp(boundary.resetAt) }))
    .filter((item): item is { boundary: RecoveryResetBoundary; time: number } =>
      item.time !== null && item.time <= asOfTime,
    )
    .sort((left, right) => left.time - right.time);
  const eventCounts = new Map<HistoricalIntervalBucket, number>();
  const exposures = new Map<HistoricalIntervalBucket, number>();

  for (let index = 1; index < randomBoundaries.length; index += 1) {
    const intervalHours = (randomBoundaries[index].time - randomBoundaries[index - 1].time) / HOUR_MS;
    if (!Number.isFinite(intervalHours) || intervalHours <= 0) continue;
    addExposure(exposures, 0, intervalHours);
    const bucket = getHistoricalIntervalBucket(intervalHours);
    if (bucket) eventCounts.set(bucket, (eventCounts.get(bucket) ?? 0) + 1);
  }

  const latest = randomBoundaries.at(-1)?.time;
  if (latest !== undefined) {
    addExposure(exposures, 0, Math.max(0, (asOfTime - latest) / HOUR_MS));
  }

  return HISTORICAL_INTERVAL_BUCKETS.map((ageBucket) => {
    const atRiskExposureHours = exposures.get(ageBucket) ?? 0;
    const eventCount = eventCounts.get(ageBucket) ?? 0;
    const crudeRatePerHour = atRiskExposureHours > 0 ? eventCount / atRiskExposureHours : 0;
    return {
      ageBucket,
      eventCount,
      atRiskExposureHours,
      crudeRatePerHour,
      crudeRatePerDay: crudeRatePerHour * 24,
    };
  });
}

function isStoredForecast(value: unknown): value is ProspectiveStoredForecast {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const forecast = value as Record<string, unknown>;
  return typeof forecast.modelVersion === "string"
    && typeof forecast.generatedAt === "string"
    && timestamp(forecast.generatedAt) !== null
    && typeof forecast.probability24h === "number"
    && Number.isFinite(forecast.probability24h)
    && typeof forecast.probability48h === "number"
    && Number.isFinite(forecast.probability48h);
}

function getTargetIds(
  boundaries: Array<RecoveryResetBoundary>,
  originTime: number,
  horizonHours: 24 | 48,
) {
  const endTime = originTime + horizonHours * HOUR_MS;
  return boundaries
    .filter((boundary) => {
      const boundaryTime = timestamp(boundary.resetAt);
      return boundary.isRandom
        && boundaryTime !== null
        && boundaryTime > originTime
        && boundaryTime <= endTime;
    })
    .map((boundary) => boundary.id);
}

function getEligibleDailyRows(
  rows: Array<ProspectiveForecastRow>,
  modelVersion: string,
  asOf: Date,
  freezeAt: string,
) {
  const freezeTime = timestamp(freezeAt);
  const asOfTime = asOf.getTime();
  if (freezeTime === null || !Number.isFinite(asOfTime)) return [];
  return selectDailyFirstForecasts(rows.filter((row) => {
    const rowTime = timestamp(row.generatedAt);
    const forecast = row.forecasts[modelVersion];
    return rowTime !== null
      && rowTime >= freezeTime
      && rowTime <= asOfTime
      && isStoredForecast(forecast)
      && forecast.modelVersion === modelVersion
      && timestamp(forecast.generatedAt) === rowTime;
  }));
}

function getResolvedPoints(
  rows: Array<ProspectiveForecastRow>,
  modelVersion: string,
  horizonHours: 24 | 48,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
  freezeAt: string,
) {
  return getEligibleDailyRows(rows, modelVersion, asOf, freezeAt).flatMap((row) => {
    const forecast = row.forecasts[modelVersion];
    const generatedTime = timestamp(row.generatedAt);
    if (!isStoredForecast(forecast) || generatedTime === null) return [];
    if (generatedTime + horizonHours * HOUR_MS > asOf.getTime()) return [];
    const actual = getRandomClockOutcome(boundaries, row.generatedAt, horizonHours);
    if (actual === null) return [];
    const ageValue = forecast.randomElapsedHours;
    const ageHours = typeof ageValue === "number" && Number.isFinite(ageValue) && ageValue >= 0
      ? ageValue
      : null;
    return [{
      generatedAt: row.generatedAt,
      baselinePrediction: horizonHours === 24
        ? typeof forecast.baseline24h === "number" && Number.isFinite(forecast.baseline24h)
          ? forecast.baseline24h
          : null
        : typeof forecast.baseline48h === "number" && Number.isFinite(forecast.baseline48h)
          ? forecast.baseline48h
          : null,
      finalPrediction: horizonHours === 24 ? forecast.probability24h : forecast.probability48h,
      actual: Number(actual),
      targetIds: getTargetIds(boundaries, generatedTime, horizonHours),
      ageHours,
    }];
  });
}

function buildAgeBuckets(
  points24h: Array<EvaluationPoint>,
  points48h: Array<EvaluationPoint>,
) {
  return RANDOM_CONTINUOUS_BANDWIDTH_AGE_BUCKETS.map((ageBucket) => ({
    ageBucket,
    metrics24h: {
      baseline: calculateMetric(points24h.filter((point) =>
        getRandomContinuousBandwidthAgeBucket(point.ageHours ?? Number.NaN) === ageBucket,
      ), "baselinePrediction"),
      final: calculateMetric(points24h.filter((point) =>
        getRandomContinuousBandwidthAgeBucket(point.ageHours ?? Number.NaN) === ageBucket,
      ), "finalPrediction"),
    },
    metrics48h: {
      baseline: calculateMetric(points48h.filter((point) =>
        getRandomContinuousBandwidthAgeBucket(point.ageHours ?? Number.NaN) === ageBucket,
      ), "baselinePrediction"),
      final: calculateMetric(points48h.filter((point) =>
        getRandomContinuousBandwidthAgeBucket(point.ageHours ?? Number.NaN) === ageBucket,
      ), "finalPrediction"),
    },
  }));
}

export function evaluateRandomContinuousBandwidthAgeDiagnostics(
  rows: Array<ProspectiveForecastRow>,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
): RandomContinuousBandwidthAgeDiagnosticsReport {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError("asOf must be a valid date");
  const freezeAt = RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT;
  if (timestamp(freezeAt) === null) throw new RangeError("freezeAt must be a valid date");

  const models = {} as RandomBandwidthAgeDiagnosticsModelMap;
  const forecastCounts: Record<string, number> = {};
  let evaluationStartAt: string | null = null;
  let hasResolvedSample = false;

  for (const modelVersion of RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS) {
    const eligibleRows = getEligibleDailyRows(rows, modelVersion, asOf, freezeAt);
    const points24h = getResolvedPoints(rows, modelVersion, 24, boundaries, asOf, freezeAt);
    const points48h = getResolvedPoints(rows, modelVersion, 48, boundaries, asOf, freezeAt);
    const allPoints = [...points24h, ...points48h];
    const unknownAgeOrigins = new Set(
      allPoints
        .filter((point) => point.ageHours === null)
        .map((point) => point.generatedAt),
    );
    const firstRow = eligibleRows[0]?.generatedAt ?? null;
    if (firstRow && (!evaluationStartAt || timestamp(firstRow)! < timestamp(evaluationStartAt)!)) {
      evaluationStartAt = firstRow;
    }
    const metrics24h = {
      baseline: calculateMetric(points24h, "baselinePrediction"),
      final: calculateMetric(points24h, "finalPrediction"),
    };
    const metrics48h = {
      baseline: calculateMetric(points48h, "baselinePrediction"),
      final: calculateMetric(points48h, "finalPrediction"),
    };
    hasResolvedSample ||= metrics24h.final.count > 0 || metrics48h.final.count > 0;
    forecastCounts[modelVersion] = eligibleRows.length;
    models[modelVersion] = {
      modelVersion,
      forecastCount: eligibleRows.length,
      metrics24h,
      metrics48h,
      ageBuckets: buildAgeBuckets(points24h, points48h),
      unknownAgeCount: unknownAgeOrigins.size,
    };
  }

  const knownBoundaryCount = boundaries.filter((boundary) => {
    const boundaryTime = timestamp(boundary.resetAt);
    return boundary.isRandom && boundaryTime !== null && boundaryTime <= asOf.getTime();
  }).length;

  return {
    schemaVersion: "prospective-random-bandwidth-age-diagnostic-v1",
    status: hasResolvedSample ? "available" : "insufficient_data",
    generatedAt: asOf.toISOString(),
    asOf: asOf.toISOString(),
    evaluationMode: "prospective",
    backfilled: false,
    source: "prediction_history.debug_info.experimentalProbabilityForecasts",
    targetDefinition: RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_TARGET_DEFINITION,
    freezeAt,
    freezePolicy: RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_POLICY,
    evaluationStartAt,
    canonicalRandomBoundaryCount: knownBoundaryCount,
    forecastCounts,
    models,
    notes: [
      "This is a prospective diagnostic for Gaussian bandwidth shape with truncation fixed at 54h.",
      "The five bandwidths use the same saved origin data, random-reset target, regime policy, and signal policy; only bandwidth varies.",
      "Daily-first selection uses the first saved forecast in each Asia/Tokyo calendar day for each model version.",
      "Saved randomElapsedHours is the only age source; missing age remains unknown and is not reconstructed from current data.",
      "Rows without a completed random-only outcome are excluded from resolved metrics; no future outcome is used before asOf.",
      `Rows before ${freezeAt} are excluded; no forecast is backfilled or relabeled.`,
      "Baseline and final probabilities are reported separately where saved; this report never retunes, selects a winner, or auto-publishes a model.",
    ],
  };
}
