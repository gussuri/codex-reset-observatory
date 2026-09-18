import {
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  SURVIVAL_CONDITIONED_FREEZE_AT,
  SURVIVAL_CONDITIONED_FREEZE_POLICY,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  SURVIVAL_CONTEXT_BURST_MODEL_VERSION,
  SURVIVAL_CONTEXT_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_OLD_REGIME_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_MODEL_VERSION,
  SURVIVAL_CONDITIONED_TARGET_DEFINITION,
} from "@/data/shadowProbabilityConfig";
import type { ProspectiveForecastRow, ProspectiveStoredForecast } from "./prospectiveProbabilityEvaluation";
import type { RecoveryResetBoundary } from "./recoveryBoundary";

const HOUR_MS = 60 * 60 * 1000;
const SIX_HOUR_MS = 6 * HOUR_MS;
const LOG_LOSS_EPSILON = 1e-12;
const BOOTSTRAP_RESAMPLES = 1_000;
const BOOTSTRAP_CONFIDENCE_LEVEL = "95%" as const;

export const SURVIVAL_PROSPECTIVE_EVALUATION_MODEL_VERSIONS = [
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_MODEL_VERSION,
  SURVIVAL_CONTEXT_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_BURST_MODEL_VERSION,
  SURVIVAL_CONTEXT_OLD_REGIME_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
] as const;

export const SURVIVAL_PROSPECTIVE_EVALUATION_HORIZONS = [12, 24, 48] as const;

export const SURVIVAL_PROSPECTIVE_AGE_BUCKETS = [
  "0-24h",
  "24-48h",
  "48-72h",
  "72-168h",
  ">=168h",
  "unknown",
] as const;

export type SurvivalProspectiveHorizon = typeof SURVIVAL_PROSPECTIVE_EVALUATION_HORIZONS[number];
export type SurvivalProspectiveAgeBucket = typeof SURVIVAL_PROSPECTIVE_AGE_BUCKETS[number];

type StoredForecast = ProspectiveStoredForecast & {
  probability12h?: number;
  survivalConditioned?: unknown;
};

type ScoredOrigin = {
  generatedAt: string;
  prediction: number;
  actual: number;
  targetIds: string[];
  ageHours: number | null;
  blockId: string;
};

export type SurvivalProspectiveScoreSummary = {
  count: number;
  positiveCount: number;
  actualRate: number;
  meanPrediction: number;
  bias: number;
  brier: number;
  logLoss: number;
  targetResetCount: number;
  periodStart: string | null;
  periodEnd: string | null;
};

export type SurvivalProspectiveBootstrap = {
  confidenceLevel: typeof BOOTSTRAP_CONFIDENCE_LEVEL;
  resamples: number;
  blockCount: number;
  brier: { lower: number; upper: number } | null;
  logLoss: { lower: number; upper: number } | null;
};

export type SurvivalProspectiveAgeBucketMetric = SurvivalProspectiveScoreSummary & {
  ageBucket: SurvivalProspectiveAgeBucket;
};

export type SurvivalProspectiveMetric = SurvivalProspectiveScoreSummary & {
  horizonHours: SurvivalProspectiveHorizon;
  ageBuckets: Record<SurvivalProspectiveAgeBucket, SurvivalProspectiveAgeBucketMetric>;
  nonOverlapping: SurvivalProspectiveScoreSummary;
  blockBootstrap: SurvivalProspectiveBootstrap;
};

export type SurvivalProspectiveModelEvaluation = {
  modelVersion: string;
  forecastCount: number;
  comparableOriginCount: number;
  metrics: Record<`${SurvivalProspectiveHorizon}h`, SurvivalProspectiveMetric>;
};

export type SurvivalProspectiveModelEvaluationReport = {
  schemaVersion: "prospective-survival-conditioned-model-evaluation-v1";
  status: "insufficient_data" | "available";
  generatedAt: string;
  asOf: string;
  evaluationMode: "prospective";
  backfilled: false;
  source: "prediction_history.debug_info.experimentalProbabilityForecasts";
  targetDefinition: typeof SURVIVAL_CONDITIONED_TARGET_DEFINITION;
  freezeAt: typeof SURVIVAL_CONDITIONED_FREEZE_AT;
  freezePolicy: typeof SURVIVAL_CONDITIONED_FREEZE_POLICY;
  randomEligibilityPolicyVersion: typeof BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION;
  originPolicy: "six-hour-first";
  forecastCounts: Record<string, number> & {
    commonComparable: number;
  };
  canonicalRandomBoundaryCount: number;
  evaluationStartAt: string | null;
  models: Record<string, SurvivalProspectiveModelEvaluation>;
  comparisonToBroadBankedV2: Record<string, Record<string, {
    brier: number | null;
    logLoss: number | null;
  }>>;
  notes: string[];
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function getForecast(row: ProspectiveForecastRow, modelVersion: string): StoredForecast | null {
  const forecast = asRecord(row.forecasts[modelVersion]);
  if (
    !forecast
    || forecast.modelVersion !== modelVersion
    || typeof forecast.generatedAt !== "string"
    || timestamp(forecast.generatedAt) === null
  ) {
    return null;
  }
  return forecast as StoredForecast;
}

function getHorizonProbability(forecast: StoredForecast, horizon: SurvivalProspectiveHorizon) {
  const value = forecast[`probability${horizon}h`];
  return isProbability(value) ? value : null;
}

function getSavedRandomAgeHours(forecast: StoredForecast) {
  const audit = asRecord(forecast.survivalConditioned);
  const age = audit?.randomElapsedHours;
  return typeof age === "number" && Number.isFinite(age) && age >= 0 ? age : null;
}

function getSixHourBucket(value: string) {
  const time = timestamp(value);
  return time === null ? null : Math.floor(time / SIX_HOUR_MS);
}

function isComparableRow(row: ProspectiveForecastRow, freezeTime: number, asOfTime: number) {
  const generatedTime = timestamp(row.generatedAt);
  if (generatedTime === null || generatedTime < freezeTime || generatedTime > asOfTime) return false;
  return SURVIVAL_PROSPECTIVE_EVALUATION_MODEL_VERSIONS.every((modelVersion) => {
    const forecast = getForecast(row, modelVersion);
    return forecast !== null && timestamp(forecast.generatedAt) === generatedTime;
  });
}

/**
 * Selects one saved row per fixed UTC six-hour origin bucket. No current data is
 * used to fill missing forecasts or feature metadata.
 */
export function selectComparableSurvivalOrigins(rows: ProspectiveForecastRow[], asOf: Date) {
  const freezeTime = timestamp(SURVIVAL_CONDITIONED_FREEZE_AT);
  const asOfTime = asOf.getTime();
  if (freezeTime === null || !Number.isFinite(asOfTime)) return [];

  const selected = new Map<number, ProspectiveForecastRow>();
  rows
    .filter((row) => isComparableRow(row, freezeTime, asOfTime))
    .slice()
    .sort((left, right) => timestamp(left.generatedAt)! - timestamp(right.generatedAt)!)
    .forEach((row) => {
      const bucket = getSixHourBucket(row.generatedAt);
      if (bucket !== null && !selected.has(bucket)) selected.set(bucket, row);
    });
  return Array.from(selected.values()).sort(
    (left, right) => timestamp(left.generatedAt)! - timestamp(right.generatedAt)!,
  );
}

function getTargetForHorizon(
  boundaries: RecoveryResetBoundary[],
  generatedAt: string,
  horizon: SurvivalProspectiveHorizon,
  asOfTime: number,
) {
  const originTime = timestamp(generatedAt);
  if (originTime === null || originTime + horizon * HOUR_MS > asOfTime) return null;
  const endTime = originTime + horizon * HOUR_MS;
  const targets = boundaries.filter((boundary) => {
    const boundaryTime = timestamp(boundary.resetAt);
    return boundary.isRandom
      && boundaryTime !== null
      && boundaryTime > originTime
      && boundaryTime <= endTime;
  });
  return {
    actual: targets.length > 0 ? 1 : 0,
    targetIds: targets.map((boundary) => boundary.id),
  };
}

function getBlockId(boundaries: RecoveryResetBoundary[], generatedAt: string) {
  const originTime = timestamp(generatedAt);
  if (originTime === null) return "invalid-origin";
  const previous = boundaries
    .filter((boundary) => boundary.isRandom)
    .filter((boundary) => {
      const boundaryTime = timestamp(boundary.resetAt);
      return boundaryTime !== null && boundaryTime <= originTime;
    })
    .at(-1);
  return previous?.id ?? "pre-history";
}

function scoreOrigins(
  origins: ProspectiveForecastRow[],
  modelVersion: string,
  horizon: SurvivalProspectiveHorizon,
  boundaries: RecoveryResetBoundary[],
  asOfTime: number,
) {
  return origins.flatMap((row): ScoredOrigin[] => {
    const forecast = getForecast(row, modelVersion);
    const prediction = forecast ? getHorizonProbability(forecast, horizon) : null;
    const target = getTargetForHorizon(boundaries, row.generatedAt, horizon, asOfTime);
    if (!forecast || prediction === null || target === null) return [];
    const baseForecast = getForecast(row, SURVIVAL_CONDITIONED_MODEL_VERSION);
    return [{
      generatedAt: row.generatedAt,
      prediction,
      actual: target.actual,
      targetIds: target.targetIds,
      ageHours: baseForecast ? getSavedRandomAgeHours(baseForecast) : null,
      blockId: getBlockId(boundaries, row.generatedAt),
    }];
  });
}

function emptySummary(): SurvivalProspectiveScoreSummary {
  return {
    count: 0,
    positiveCount: 0,
    actualRate: 0,
    meanPrediction: 0,
    bias: 0,
    brier: 0,
    logLoss: 0,
    targetResetCount: 0,
    periodStart: null,
    periodEnd: null,
  };
}

function clampProbability(value: number) {
  return Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, value));
}

function summarize(rows: ScoredOrigin[]): SurvivalProspectiveScoreSummary {
  if (rows.length === 0) return emptySummary();
  const positiveCount = rows.reduce((sum, row) => sum + row.actual, 0);
  const meanPrediction = rows.reduce((sum, row) => sum + row.prediction, 0) / rows.length;
  const actualRate = positiveCount / rows.length;
  const brier = rows.reduce((sum, row) => sum + (row.prediction - row.actual) ** 2, 0) / rows.length;
  const logLoss = rows.reduce((sum, row) => {
    const prediction = clampProbability(row.prediction);
    return sum - (row.actual * Math.log(prediction) + (1 - row.actual) * Math.log(1 - prediction));
  }, 0) / rows.length;
  return {
    count: rows.length,
    positiveCount,
    actualRate,
    meanPrediction,
    bias: meanPrediction - actualRate,
    brier,
    logLoss,
    targetResetCount: new Set(rows.flatMap((row) => row.targetIds)).size,
    periodStart: rows[0]?.generatedAt ?? null,
    periodEnd: rows.at(-1)?.generatedAt ?? null,
  };
}

function ageBucket(ageHours: number | null): SurvivalProspectiveAgeBucket {
  if (ageHours === null) return "unknown";
  if (ageHours < 24) return "0-24h";
  if (ageHours < 48) return "24-48h";
  if (ageHours < 72) return "48-72h";
  if (ageHours < 168) return "72-168h";
  return ">=168h";
}

function calculateNonOverlapping(rows: ScoredOrigin[], horizon: SurvivalProspectiveHorizon) {
  const sorted = rows.slice().sort((left, right) => timestamp(left.generatedAt)! - timestamp(right.generatedAt)!);
  const selected: ScoredOrigin[] = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const row of sorted) {
    const origin = timestamp(row.generatedAt);
    if (origin === null || origin < lastEnd) continue;
    selected.push(row);
    lastEnd = origin + horizon * HOUR_MS;
  }
  return selected;
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandom(seed: { value: number }) {
  seed.value = (Math.imul(seed.value, 1664525) + 1013904223) >>> 0;
  return seed.value / 0x1_0000_0000;
}

function quantile(values: number[], probability: number) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function blockBootstrap(rows: ScoredOrigin[], modelVersion: string, horizon: SurvivalProspectiveHorizon) {
  const blocks = Array.from(
    rows.reduce((map, row) => {
      const block = map.get(row.blockId) ?? [];
      block.push(row);
      map.set(row.blockId, block);
      return map;
    }, new Map<string, ScoredOrigin[]>()),
  ).map(([, block]) => block);
  if (blocks.length < 2 || rows.length === 0) {
    return {
      confidenceLevel: BOOTSTRAP_CONFIDENCE_LEVEL,
      resamples: BOOTSTRAP_RESAMPLES,
      blockCount: blocks.length,
      brier: null,
      logLoss: null,
    } satisfies SurvivalProspectiveBootstrap;
  }

  const seed = { value: hashSeed(`${modelVersion}:${horizon}`) };
  const brierValues: number[] = [];
  const logLossValues: number[] = [];
  for (let iteration = 0; iteration < BOOTSTRAP_RESAMPLES; iteration += 1) {
    const sample: ScoredOrigin[] = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const selected = blocks[Math.floor(nextRandom(seed) * blocks.length)] ?? [];
      sample.push(...selected);
    }
    const summary = summarize(sample);
    brierValues.push(summary.brier);
    logLossValues.push(summary.logLoss);
  }
  return {
    confidenceLevel: BOOTSTRAP_CONFIDENCE_LEVEL,
    resamples: BOOTSTRAP_RESAMPLES,
    blockCount: blocks.length,
    brier: {
      lower: quantile(brierValues, 0.025)!,
      upper: quantile(brierValues, 0.975)!,
    },
    logLoss: {
      lower: quantile(logLossValues, 0.025)!,
      upper: quantile(logLossValues, 0.975)!,
    },
  } satisfies SurvivalProspectiveBootstrap;
}

function metric(
  rows: ScoredOrigin[],
  modelVersion: string,
  horizon: SurvivalProspectiveHorizon,
): SurvivalProspectiveMetric {
  const ageBuckets = Object.fromEntries(
    SURVIVAL_PROSPECTIVE_AGE_BUCKETS.map((bucket) => [
      bucket,
      {
        ageBucket: bucket,
        ...summarize(rows.filter((row) => ageBucket(row.ageHours) === bucket)),
      },
    ]),
  ) as Record<SurvivalProspectiveAgeBucket, SurvivalProspectiveAgeBucketMetric>;
  return {
    ...summarize(rows),
    horizonHours: horizon,
    ageBuckets,
    nonOverlapping: summarize(calculateNonOverlapping(rows, horizon)),
    blockBootstrap: blockBootstrap(rows, modelVersion, horizon),
  };
}

function emptyModelEvaluation(modelVersion: string): SurvivalProspectiveModelEvaluation {
  return {
    modelVersion,
    forecastCount: 0,
    comparableOriginCount: 0,
    metrics: {
      "12h": metric([], modelVersion, 12),
      "24h": metric([], modelVersion, 24),
      "48h": metric([], modelVersion, 48),
    },
  };
}

export function evaluateProspectiveSurvivalConditionedModel(
  rows: ProspectiveForecastRow[],
  boundaries: RecoveryResetBoundary[],
  asOf: Date,
): SurvivalProspectiveModelEvaluationReport {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError("asOf must be a valid date");
  const asOfTime = asOf.getTime();
  const commonOrigins = selectComparableSurvivalOrigins(rows, asOf);
  const forecastCounts = Object.fromEntries(
    SURVIVAL_PROSPECTIVE_EVALUATION_MODEL_VERSIONS.map((modelVersion) => [
      modelVersion,
      rows.filter((row) => {
        const generatedTime = timestamp(row.generatedAt);
        return generatedTime !== null
          && generatedTime >= timestamp(SURVIVAL_CONDITIONED_FREEZE_AT)!
          && generatedTime <= asOfTime
          && getForecast(row, modelVersion) !== null;
      }).length,
    ]),
  ) as Record<string, number> & { commonComparable: number };
  forecastCounts.commonComparable = commonOrigins.length;

  const models = Object.fromEntries(
    SURVIVAL_PROSPECTIVE_EVALUATION_MODEL_VERSIONS.map((modelVersion) => {
      const evaluation = emptyModelEvaluation(modelVersion);
      evaluation.forecastCount = forecastCounts[modelVersion] ?? 0;
      evaluation.comparableOriginCount = commonOrigins.length;
      for (const horizon of SURVIVAL_PROSPECTIVE_EVALUATION_HORIZONS) {
        const scored = scoreOrigins(commonOrigins, modelVersion, horizon, boundaries, asOfTime);
        evaluation.metrics[`${horizon}h`] = metric(scored, modelVersion, horizon);
      }
      return [modelVersion, evaluation];
    }),
  ) as Record<string, SurvivalProspectiveModelEvaluation>;

  const broad = models[BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION];
  const comparisonToBroadBankedV2 = Object.fromEntries(
    SURVIVAL_PROSPECTIVE_EVALUATION_MODEL_VERSIONS
      .filter((modelVersion) => modelVersion !== BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION)
      .map((modelVersion) => [
        modelVersion,
        Object.fromEntries(SURVIVAL_PROSPECTIVE_EVALUATION_HORIZONS.map((horizon) => {
          const candidate = models[modelVersion].metrics[`${horizon}h`];
          const baseline = broad.metrics[`${horizon}h`];
          return [
            `${horizon}h`,
            {
              brier: candidate.count > 0 && baseline.count > 0 ? candidate.brier - baseline.brier : null,
              logLoss: candidate.count > 0 && baseline.count > 0 ? candidate.logLoss - baseline.logLoss : null,
            },
          ];
        })),
      ]),
  ) as Record<string, Record<string, { brier: number | null; logLoss: number | null }>>;

  const freezeTime = timestamp(SURVIVAL_CONDITIONED_FREEZE_AT)!;
  const evaluationStartAt = commonOrigins[0]?.generatedAt ?? null;
  const knownRandomBoundaries = boundaries.filter((boundary) => {
    const time = timestamp(boundary.resetAt);
    return boundary.isRandom && time !== null && time <= asOfTime;
  });
  return {
    schemaVersion: "prospective-survival-conditioned-model-evaluation-v1",
    status: commonOrigins.length === 0 ? "insufficient_data" : "available",
    generatedAt: asOf.toISOString(),
    asOf: asOf.toISOString(),
    evaluationMode: "prospective",
    backfilled: false,
    source: "prediction_history.debug_info.experimentalProbabilityForecasts",
    targetDefinition: SURVIVAL_CONDITIONED_TARGET_DEFINITION,
    freezeAt: SURVIVAL_CONDITIONED_FREEZE_AT,
    freezePolicy: SURVIVAL_CONDITIONED_FREEZE_POLICY,
    randomEligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    originPolicy: "six-hour-first",
    forecastCounts,
    canonicalRandomBoundaryCount: knownRandomBoundaries.length,
    evaluationStartAt,
    models,
    comparisonToBroadBankedV2,
    notes: [
      `Only saved forecasts at or after ${SURVIVAL_CONDITIONED_FREEZE_AT} are eligible; no historical forecast is reconstructed, backfilled, or relabeled.`,
      "All model metrics use the same six-hour-first comparable origin set; model availability is never mixed across separate origin sets.",
      "The survival age segment uses only the saved survivalConditioned.randomElapsedHours audit value; missing metadata is reported as unknown.",
      "Training is represented by the saved forecast artifact. The evaluator never refits, adds future features, or fills missing feature metadata from current read-side data.",
      "Actual outcomes use canonical random boundaries only; regular-only boundaries do not become positive target events.",
      "Non-overlapping metrics are a reference subset. Overlapping six-hour origins are not treated as IID; confidence intervals resample reset-interval blocks.",
      "Because canonical history is read at evaluation time, this is not a strict replay of every historical feature snapshot; saved forecast artifacts remain authoritative for predictions and PIT metadata.",
      "This report is diagnostic-only. It never changes the public selector, model parameters, calibration, adoption boundary, or stored history.",
      `Survival freeze time is ${new Date(freezeTime).toISOString()}; rows before it and unresolved future horizons are excluded.`,
    ],
  };
}
