import {
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_POLICY,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_TARGET_DEFINITION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS,
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
} from "@/data/shadowProbabilityConfig";
import { getRandomClockOutcome } from "./prospectiveRandomClockModelEvaluation";
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

export const BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_AGE_BUCKETS = [
  "<120h",
  "120-144h",
  "144-168h",
  "168-192h",
  "192-216h",
  ">=216h",
] as const;

export type BroadBankedLateAgeRegimeDiagnosticAgeBucket =
  typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_AGE_BUCKETS[number];

export type BroadBankedLateAgeRegimeModelEvaluation = {
  modelVersion: string;
  forecastCount: number;
  comparableOriginCount: number;
  dailyFirstOriginCount: number;
  metrics24h: ProspectiveMetric;
  metrics48h: ProspectiveMetric;
  ageBuckets: Record<
    BroadBankedLateAgeRegimeDiagnosticAgeBucket,
    {
      ageBucket: BroadBankedLateAgeRegimeDiagnosticAgeBucket;
      metrics24h: ProspectiveMetric;
      metrics48h: ProspectiveMetric;
    }
  >;
  unknownAgeCount: number;
};

export type BroadBankedLateAgeRegimePrimaryComparison = {
  controlModelVersion: typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION;
  primaryModelVersion: typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION;
  resolved24h: number;
  resolved48h: number;
  lateAgeResolved24h: number;
  lateAgeResolved48h: number;
  overallBrierDifference24h: number | null;
  overallBrierDifference48h: number | null;
  overallLogLossDifference24h: number | null;
  overallLogLossDifference48h: number | null;
  lateAgeBrierDifference24h: number | null;
  lateAgeBrierDifference48h: number | null;
  lateAgeLogLossDifference24h: number | null;
  lateAgeLogLossDifference48h: number | null;
};

export type BroadBankedLateAgeRegimeComparison = {
  primary: BroadBankedLateAgeRegimePrimaryComparison;
  secondary: Array<{
    modelVersion: string;
    brierDifference24h: number | null;
    brierDifference48h: number | null;
    logLossDifference24h: number | null;
    logLossDifference48h: number | null;
  }>;
};

export type ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport = {
  schemaVersion: "prospective-broad-banked-late-age-regime-diagnostics-v2";
  status: "insufficient_data" | "available";
  generatedAt: string;
  asOf: string;
  evaluationMode: "prospective";
  backfilled: false;
  source: "prediction_history.debug_info.experimentalProbabilityForecasts";
  targetDefinition: typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_TARGET_DEFINITION;
  freezeAt: typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT;
  freezePolicy: typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_POLICY;
  randomEligibilityPolicyVersion: typeof BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION;
  lateAgeStartHours: typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS;
  evaluationStartAt: string | null;
  canonicalRandomBoundaryCount: number;
  forecastCounts: Record<string, number>;
  models: Record<
    typeof BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS[number],
    BroadBankedLateAgeRegimeModelEvaluation
  >;
  comparison: BroadBankedLateAgeRegimeComparison;
  notes: string[];
};

type EvaluationPoint = {
  generatedAt: string;
  prediction: number;
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

function emptyMetric(): ProspectiveMetric {
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

function calculateMetric(points: EvaluationPoint[]): ProspectiveMetric {
  if (points.length === 0) return emptyMetric();
  const values = points.map((point) => ({
    prediction: Math.min(1, Math.max(0, point.prediction)),
    actual: point.actual,
  }));
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

function isStoredLateAgeForecast(
  value: unknown,
  modelVersion: string,
): value is ProspectiveStoredForecast {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const forecast = value as Record<string, unknown>;
  return forecast.modelVersion === modelVersion
    && typeof forecast.generatedAt === "string"
    && timestamp(forecast.generatedAt) !== null
    && typeof forecast.probability24h === "number"
    && Number.isFinite(forecast.probability24h)
    && typeof forecast.probability48h === "number"
    && Number.isFinite(forecast.probability48h)
    && forecast.backfilled !== true
    && forecast.randomEligibilityPolicyVersion === BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION;
}

function hasSameOriginGeneratedAt(row: ProspectiveForecastRow, modelVersion: string) {
  const forecast = row.forecasts[modelVersion];
  return isStoredLateAgeForecast(forecast, modelVersion)
    && timestamp(forecast.generatedAt) === timestamp(row.generatedAt);
}

export function selectComparableBroadBankedLateAgeRegimeForecasts(
  rows: Array<ProspectiveForecastRow>,
) {
  return rows.filter((row) =>
    timestamp(row.generatedAt) !== null
    && BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.every((modelVersion) =>
      hasSameOriginGeneratedAt(row, modelVersion),
    ),
  );
}

export function getBroadBankedLateAgeRegimeAgeBucket(
  ageHours: number,
): BroadBankedLateAgeRegimeDiagnosticAgeBucket | null {
  if (!Number.isFinite(ageHours) || ageHours < 0) return null;
  if (ageHours < 120) return "<120h";
  if (ageHours < BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS) return "120-144h";
  if (ageHours < 168) return "144-168h";
  if (ageHours < 192) return "168-192h";
  if (ageHours < 216) return "192-216h";
  return ">=216h";
}

function getTargetIds(
  boundaries: Array<RecoveryResetBoundary>,
  origin: string,
  horizonHours: 24 | 48,
) {
  const originTime = timestamp(origin);
  if (originTime === null) return [];
  const end = originTime + horizonHours * HOUR_MS;
  return boundaries
    .filter((boundary) => {
      const boundaryTime = timestamp(boundary.resetAt);
      return boundaryTime !== null && boundaryTime > originTime && boundaryTime <= end && boundary.isRandom;
    })
    .map((boundary) => boundary.id);
}

function getResolvedPoints(
  rows: Array<ProspectiveForecastRow>,
  modelVersion: string,
  horizonHours: 24 | 48,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
) {
  const asOfTime = asOf.getTime();
  return rows.flatMap((row) => {
    const forecast = row.forecasts[modelVersion];
    const generatedTime = timestamp(row.generatedAt);
    if (
      !isStoredLateAgeForecast(forecast, modelVersion)
      || generatedTime === null
      || !Number.isFinite(asOfTime)
      || generatedTime + horizonHours * HOUR_MS > asOfTime
    ) {
      return [];
    }
    const actual = getRandomClockOutcome(boundaries, row.generatedAt, horizonHours);
    if (actual === null) return [];
    const ageHours = typeof forecast.randomElapsedHours === "number"
      && Number.isFinite(forecast.randomElapsedHours)
      ? forecast.randomElapsedHours
      : null;
    return [{
      generatedAt: row.generatedAt,
      prediction: horizonHours === 24 ? forecast.probability24h : forecast.probability48h,
      actual: actual ? 1 : 0,
      targetIds: actual ? getTargetIds(boundaries, row.generatedAt, horizonHours) : [],
      ageHours,
    } satisfies EvaluationPoint];
  });
}

function getEmptyAgeBuckets(): Record<
  BroadBankedLateAgeRegimeDiagnosticAgeBucket,
  { ageBucket: BroadBankedLateAgeRegimeDiagnosticAgeBucket; metrics24h: ProspectiveMetric; metrics48h: ProspectiveMetric }
> {
  return Object.fromEntries(
    BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_AGE_BUCKETS.map((ageBucket) => [ageBucket, {
      ageBucket,
      metrics24h: emptyMetric(),
      metrics48h: emptyMetric(),
    }]),
  ) as Record<
    BroadBankedLateAgeRegimeDiagnosticAgeBucket,
    { ageBucket: BroadBankedLateAgeRegimeDiagnosticAgeBucket; metrics24h: ProspectiveMetric; metrics48h: ProspectiveMetric }
  >;
}

function createModelEvaluation(
  comparableRows: Array<ProspectiveForecastRow>,
  dailyRows: Array<ProspectiveForecastRow>,
  modelVersion: string,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
): BroadBankedLateAgeRegimeModelEvaluation {
  const points24h = getResolvedPoints(dailyRows, modelVersion, 24, boundaries, asOf);
  const points48h = getResolvedPoints(dailyRows, modelVersion, 48, boundaries, asOf);
  const ageBuckets = getEmptyAgeBuckets();
  const bucketPoints24h = new Map<BroadBankedLateAgeRegimeDiagnosticAgeBucket, Array<EvaluationPoint>>();
  const bucketPoints48h = new Map<BroadBankedLateAgeRegimeDiagnosticAgeBucket, Array<EvaluationPoint>>();
  let unknownAgeCount = 0;
  for (const row of dailyRows) {
    const forecast = row.forecasts[modelVersion];
    const ageHours = forecast?.randomElapsedHours;
    const bucket = typeof ageHours === "number"
      ? getBroadBankedLateAgeRegimeAgeBucket(ageHours)
      : null;
    if (!bucket) {
      unknownAgeCount += 1;
      continue;
    }
    bucketPoints24h.set(bucket, [
      ...(bucketPoints24h.get(bucket) ?? []),
      ...getResolvedPoints([row], modelVersion, 24, boundaries, asOf),
    ]);
    bucketPoints48h.set(bucket, [
      ...(bucketPoints48h.get(bucket) ?? []),
      ...getResolvedPoints([row], modelVersion, 48, boundaries, asOf),
    ]);
  }
  for (const ageBucket of BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_AGE_BUCKETS) {
    ageBuckets[ageBucket].metrics24h = calculateMetric(bucketPoints24h.get(ageBucket) ?? []);
    ageBuckets[ageBucket].metrics48h = calculateMetric(bucketPoints48h.get(ageBucket) ?? []);
  }
  return {
    modelVersion,
    forecastCount: comparableRows.length,
    comparableOriginCount: comparableRows.length,
    dailyFirstOriginCount: dailyRows.length,
    metrics24h: calculateMetric(points24h),
    metrics48h: calculateMetric(points48h),
    ageBuckets,
    unknownAgeCount,
  };
}

function difference(candidate: number, control: number) {
  return Number.isFinite(candidate) && Number.isFinite(control)
    ? candidate - control
    : null;
}

function getSavedRandomElapsedHours(row: ProspectiveForecastRow, modelVersion: string) {
  const forecast = row.forecasts[modelVersion];
  return typeof forecast?.randomElapsedHours === "number"
    && Number.isFinite(forecast.randomElapsedHours)
    ? forecast.randomElapsedHours
    : null;
}

function selectLateAgeRows(rows: Array<ProspectiveForecastRow>) {
  return rows.filter((row) => {
    const controlAge = getSavedRandomElapsedHours(
      row,
      BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    );
    const primaryAge = getSavedRandomElapsedHours(
      row,
      BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
    );
    return controlAge !== null
      && controlAge >= BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS
      && primaryAge !== null
      && primaryAge >= BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS;
  });
}

function buildComparison(
  models: ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport["models"],
  dailyRows: Array<ProspectiveForecastRow>,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
): BroadBankedLateAgeRegimeComparison {
  const control = models[BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION];
  const primary = models[BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION];
  const control24 = getResolvedPoints(dailyRows, control.modelVersion, 24, boundaries, asOf);
  const control48 = getResolvedPoints(dailyRows, control.modelVersion, 48, boundaries, asOf);
  const primary24 = getResolvedPoints(dailyRows, primary.modelVersion, 24, boundaries, asOf);
  const primary48 = getResolvedPoints(dailyRows, primary.modelVersion, 48, boundaries, asOf);
  const lateAgeRows = selectLateAgeRows(dailyRows);
  const controlLate24 = getResolvedPoints(lateAgeRows, control.modelVersion, 24, boundaries, asOf);
  const controlLate48 = getResolvedPoints(lateAgeRows, control.modelVersion, 48, boundaries, asOf);
  const primaryLate24 = getResolvedPoints(lateAgeRows, primary.modelVersion, 24, boundaries, asOf);
  const primaryLate48 = getResolvedPoints(lateAgeRows, primary.modelVersion, 48, boundaries, asOf);
  const control24Metric = calculateMetric(control24);
  const control48Metric = calculateMetric(control48);
  const primary24Metric = calculateMetric(primary24);
  const primary48Metric = calculateMetric(primary48);
  const controlLate24Metric = calculateMetric(controlLate24);
  const controlLate48Metric = calculateMetric(controlLate48);
  const primaryLate24Metric = calculateMetric(primaryLate24);
  const primaryLate48Metric = calculateMetric(primaryLate48);
  const secondary = [
    BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
    BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
  ].map((modelVersion) => {
    const model24 = calculateMetric(getResolvedPoints(dailyRows, modelVersion, 24, boundaries, asOf));
    const model48 = calculateMetric(getResolvedPoints(dailyRows, modelVersion, 48, boundaries, asOf));
    return {
      modelVersion,
      brierDifference24h: model24.count > 0 && control24Metric.count > 0
        ? difference(model24.brier, control24Metric.brier)
        : null,
      brierDifference48h: model48.count > 0 && control48Metric.count > 0
        ? difference(model48.brier, control48Metric.brier)
        : null,
      logLossDifference24h: model24.count > 0 && control24Metric.count > 0
        ? difference(model24.logLoss, control24Metric.logLoss)
        : null,
      logLossDifference48h: model48.count > 0 && control48Metric.count > 0
        ? difference(model48.logLoss, control48Metric.logLoss)
        : null,
    };
  });
  return {
    primary: {
      controlModelVersion: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
      primaryModelVersion: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
      resolved24h: Math.min(control24Metric.count, primary24Metric.count),
      resolved48h: Math.min(control48Metric.count, primary48Metric.count),
      lateAgeResolved24h: Math.min(controlLate24.length, primaryLate24.length),
      lateAgeResolved48h: Math.min(controlLate48.length, primaryLate48.length),
      overallBrierDifference24h: control24Metric.count > 0 && primary24Metric.count > 0
        ? difference(primary24Metric.brier, control24Metric.brier)
        : null,
      overallBrierDifference48h: control48Metric.count > 0 && primary48Metric.count > 0
        ? difference(primary48Metric.brier, control48Metric.brier)
        : null,
      overallLogLossDifference24h: control24Metric.count > 0 && primary24Metric.count > 0
        ? difference(primary24Metric.logLoss, control24Metric.logLoss)
        : null,
      overallLogLossDifference48h: control48Metric.count > 0 && primary48Metric.count > 0
        ? difference(primary48Metric.logLoss, control48Metric.logLoss)
        : null,
      lateAgeBrierDifference24h: controlLate24Metric.count > 0 && primaryLate24Metric.count > 0
        ? difference(primaryLate24Metric.brier, controlLate24Metric.brier)
        : null,
      lateAgeBrierDifference48h: controlLate48Metric.count > 0 && primaryLate48Metric.count > 0
        ? difference(primaryLate48Metric.brier, controlLate48Metric.brier)
        : null,
      lateAgeLogLossDifference24h: controlLate24Metric.count > 0 && primaryLate24Metric.count > 0
        ? difference(primaryLate24Metric.logLoss, controlLate24Metric.logLoss)
        : null,
      lateAgeLogLossDifference48h: controlLate48Metric.count > 0 && primaryLate48Metric.count > 0
        ? difference(primaryLate48Metric.logLoss, controlLate48Metric.logLoss)
        : null,
    },
    secondary,
  };
}

export function evaluateBroadBankedLateAgeRegimeDiagnostics(
  rows: Array<ProspectiveForecastRow>,
  boundaries: Array<RecoveryResetBoundary>,
  asOf: Date,
): ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError("asOf must be a valid date");
  const freezeTime = timestamp(BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT)!;
  const asOfTime = asOf.getTime();
  const prospectiveRows = rows.filter((row) => {
    const generatedTime = timestamp(row.generatedAt);
    return generatedTime !== null
      && generatedTime >= freezeTime
      && generatedTime <= asOfTime
      && row.forecasts[BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION]?.backfilled !== true;
  });
  const comparableRows = selectComparableBroadBankedLateAgeRegimeForecasts(prospectiveRows);
  const dailyRows = selectDailyFirstForecasts(comparableRows);
  const models = Object.fromEntries(
    BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.map((modelVersion) => [
      modelVersion,
      createModelEvaluation(comparableRows, dailyRows, modelVersion, boundaries, asOf),
    ]),
  ) as ProspectiveBroadBankedLateAgeRegimeDiagnosticsReport["models"];
  const comparison = buildComparison(models, dailyRows, boundaries, asOf);
  const evaluationStartAt = dailyRows[0]?.generatedAt ?? null;
  const hasResolvedSample = comparison.primary.resolved24h > 0 || comparison.primary.resolved48h > 0;
  return {
    schemaVersion: "prospective-broad-banked-late-age-regime-diagnostics-v2",
    status: hasResolvedSample ? "available" : "insufficient_data",
    generatedAt: asOf.toISOString(),
    asOf: asOf.toISOString(),
    evaluationMode: "prospective",
    backfilled: false,
    source: "prediction_history.debug_info.experimentalProbabilityForecasts",
    targetDefinition: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_TARGET_DEFINITION,
    freezeAt: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
    freezePolicy: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_POLICY,
    randomEligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    lateAgeStartHours: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS,
    evaluationStartAt,
    canonicalRandomBoundaryCount: boundaries.filter((boundary) => {
      const boundaryTime = timestamp(boundary.resetAt);
      return boundary.isRandom && boundaryTime !== null && boundaryTime <= asOfTime;
    }).length,
    forecastCounts: Object.fromEntries(
      BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.map((modelVersion) => [
        modelVersion,
        models[modelVersion].forecastCount,
      ]),
    ),
    models,
    comparison,
    notes: [
      "Only saved v2 experimentalProbabilityForecasts after the fixed v2 freezeAt are evaluated; historical rows are not recomputed, backfilled, or relabeled.",
      "All v2 arms require the same saved broad-banked policy version and the same daily-first comparable origins.",
      "The overallBrierDifference* and overallLogLossDifference* fields are all-origin descriptive comparisons and are not the late-age primary score.",
      "The lateAge*Difference* fields are the primary late-age score: late-no-downward-v2 minus control-v2 on the same daily-first comparable origins with saved randomElapsedHours >= 144h.",
      "Broad banked distributions are random boundaries only for this v2 family; the legacy random-cycle policy and v1 late-age family remain unchanged.",
      "This report is diagnostic only and does not select a winner, retune parameters, publish a model, or change a gate.",
    ],
  };
}
