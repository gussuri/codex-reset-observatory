import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  LOCAL_MODEL_UPDATED_AT,
  LOCAL_RESET_HISTORY,
} from "../data/resetHistory";
import {
  RECENCY_SHADOW_MODEL_CONFIG,
  SHADOW_PROBABILITY_MODEL_VERSION,
  SHADOW_TARGET_DEFINITION,
} from "../data/shadowProbabilityConfig";
import { getLocalRadarData } from "../lib/radar";
import {
  calculateRecencyWeightedShadowProbability,
} from "../lib/radar/recencyWeightedProbability";
import {
  calculateShadowProbability,
  getShadowCompletedResetEvents,
  type ShadowResetEvent,
} from "../lib/radar/shadowProbability";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BLOCK_DAYS = 7;
const BOOTSTRAP_ITERATIONS = 2_000;
const BOOTSTRAP_SEED = 20260804;
const MIN_COMPLETED_INTERVALS = 5;
const LOG_LOSS_EPSILON = 1e-12;

export type EvaluationRow = {
  recordedAt: string;
  probability24h: number;
  probability48h: number;
  actual24h: boolean;
  actual48h: boolean;
};

export type CalibrationBucket = {
  range: string;
  lower: number;
  upper: number;
  count: number;
  averagePrediction: number;
  actualRate: number;
};

export type MetricSummary = {
  count: number;
  actualRate: number;
  averagePrediction: number;
  brier: number;
  logLoss: number;
  calibration: Array<CalibrationBucket>;
};

export type BootstrapSummary = {
  seed: number;
  blockDays: number;
  iterations: number;
  lower: number;
  median: number;
  upper: number;
};

export type ModelClassification =
  | "baseline"
  | "clearly_better"
  | "promising_but_inconclusive"
  | "no_meaningful_difference"
  | "worse";

export type ProbabilityModelDefinition = {
  modelVersion: string;
  halfLifeDays: number | null;
};

export type ProbabilityModelEvaluationReport = {
  schemaVersion: "probability-model-evaluation-v1";
  asOf: string;
  generatedAt: string;
  targetDefinition: string;
  eventCount: number;
  completedIntervalCount: number;
  observationPeriod: {
    start: string | null;
    end: string;
  };
  originCount: number;
  origins: string[];
  models: Array<{
    modelVersion: string;
    halfLifeDays: number | null;
    classification: ModelClassification;
    metrics24h: MetricSummary;
    metrics48h: MetricSummary;
    differenceVsCurrent: {
      brier24h: number;
      brier48h: number;
      logLoss24h: number;
      logLoss48h: number;
      bootstrap24h: BootstrapSummary;
      bootstrap48h: BootstrapSummary;
    } | null;
  }>;
  notes: string[];
};

export type EventPartition = {
  training: Array<ShadowResetEvent>;
  future: Array<ShadowResetEvent>;
};

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function sortEvents(events: Array<ShadowResetEvent>) {
  return events
    .map((event) => ({ event, time: timestamp(event.resetAt) }))
    .filter((item): item is { event: ShadowResetEvent; time: number } => item.time !== null)
    .sort((left, right) => left.time - right.time)
    .map((item) => item.event);
}

function getJstDayKey(value: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getJstMidnight(dayKey: string) {
  return new Date(`${dayKey}T00:00:00+09:00`).getTime();
}

function getJstMidnightAtOrAfter(value: number) {
  const midnight = getJstMidnight(getJstDayKey(value));
  return midnight >= value ? midnight : midnight + DAY_MS;
}

function getJstMidnightAtOrBefore(value: number) {
  return getJstMidnight(getJstDayKey(value));
}

export function partitionEventsAtOrigin(
  events: Array<ShadowResetEvent>,
  origin: string,
  asOf?: string,
): EventPartition {
  const originTime = timestamp(origin);
  const asOfTime = asOf === undefined ? Number.POSITIVE_INFINITY : timestamp(asOf);
  if (originTime === null || asOfTime === null || asOfTime < originTime) {
    throw new RangeError("origin and asOf must be valid, ordered timestamps");
  }

  const sorted = sortEvents(events);
  return {
    training: sorted.filter((event) => timestamp(event.resetAt)! <= originTime),
    future: sorted.filter((event) => {
      const eventTime = timestamp(event.resetAt)!;
      return eventTime > originTime && eventTime <= asOfTime;
    }),
  };
}

export function getActualWithinHorizon(
  events: Array<ShadowResetEvent>,
  origin: string,
  horizonHours: number,
) {
  const originTime = timestamp(origin);
  if (originTime === null || !Number.isFinite(horizonHours) || horizonHours <= 0) {
    return false;
  }
  const end = originTime + horizonHours * HOUR_MS;
  return events.some((event) => {
    const eventTime = timestamp(event.resetAt);
    return eventTime !== null && eventTime > originTime && eventTime <= end;
  });
}

export function createWalkForwardOrigins(
  events: Array<ShadowResetEvent>,
  asOf: string,
  minimumCompletedIntervals: number = MIN_COMPLETED_INTERVALS,
) {
  const asOfTime = timestamp(asOf);
  if (asOfTime === null || !Number.isInteger(minimumCompletedIntervals) || minimumCompletedIntervals < 1) {
    throw new RangeError("asOf and minimumCompletedIntervals must be valid");
  }

  const sorted = sortEvents(events);
  const firstEligibleEvent = sorted[minimumCompletedIntervals];
  if (!firstEligibleEvent) return [];
  const firstEventTime = timestamp(firstEligibleEvent.resetAt)!;
  const firstOrigin = getJstMidnightAtOrAfter(firstEventTime);
  const lastOrigin = getJstMidnightAtOrBefore(asOfTime - 48 * HOUR_MS);
  const origins: Array<string> = [];
  for (let current = firstOrigin; current <= lastOrigin; current += DAY_MS) {
    origins.push(new Date(current).toISOString());
  }
  return origins;
}

function clampProbability(value: number) {
  return Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, value));
}

function getPeriodValues(rows: Array<EvaluationRow>, period: "24h" | "48h") {
  return rows.map((row) => ({
    prediction: period === "24h" ? row.probability24h : row.probability48h,
    actual: period === "24h" ? Number(row.actual24h) : Number(row.actual48h),
  }));
}

export function calculateMetric(
  rows: Array<EvaluationRow>,
  period: "24h" | "48h",
): MetricSummary {
  const values = getPeriodValues(rows, period);
  const buckets = [0, 0.2, 0.4, 0.6, 0.8].map((lower) => {
    const upper = lower + 0.2;
    const valuesInBucket = values.filter(({ prediction }) =>
      prediction >= lower && (prediction < upper || (upper === 1 && prediction <= upper)),
    );
    return {
      range: `${Math.round(lower * 100)}-${Math.round(upper * 100)}%`,
      lower,
      upper,
      count: valuesInBucket.length,
      averagePrediction: valuesInBucket.length === 0
        ? 0
        : valuesInBucket.reduce((sum, value) => sum + value.prediction, 0) / valuesInBucket.length,
      actualRate: valuesInBucket.length === 0
        ? 0
        : valuesInBucket.reduce((sum, value) => sum + value.actual, 0) / valuesInBucket.length,
    } satisfies CalibrationBucket;
  });

  if (values.length === 0) {
    return {
      count: 0,
      actualRate: 0,
      averagePrediction: 0,
      brier: 0,
      logLoss: 0,
      calibration: buckets,
    };
  }

  return {
    count: values.length,
    actualRate: values.reduce((sum, value) => sum + value.actual, 0) / values.length,
    averagePrediction: values.reduce((sum, value) => sum + value.prediction, 0) / values.length,
    brier: values.reduce((sum, value) => (sum + (value.prediction - value.actual) ** 2), 0) / values.length,
    logLoss: values.reduce((sum, value) => {
      const prediction = clampProbability(value.prediction);
      return sum - (value.actual * Math.log(prediction) + (1 - value.actual) * Math.log(1 - prediction));
    }, 0) / values.length,
    calibration: buckets,
  };
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function calculateBrierDifference(
  candidateRows: Array<EvaluationRow>,
  currentRows: Array<EvaluationRow>,
  period: "24h" | "48h",
) {
  const candidateValues = getPeriodValues(candidateRows, period);
  const currentValues = getPeriodValues(currentRows, period);
  if (candidateValues.length !== currentValues.length || candidateValues.length === 0) return 0;
  return candidateValues.reduce(
    (sum, candidate, index) =>
      sum + (candidate.prediction - candidate.actual) ** 2 -
        (currentValues[index].prediction - currentValues[index].actual) ** 2,
    0,
  ) / candidateValues.length;
}

export function calculateBlockBootstrapDifference(
  candidateRows: Array<EvaluationRow>,
  currentRows: Array<EvaluationRow>,
  period: "24h" | "48h",
  seed: number,
  iterations: number = BOOTSTRAP_ITERATIONS,
): BootstrapSummary {
  if (candidateRows.length !== currentRows.length || candidateRows.length === 0) {
    return { seed, blockDays: BLOCK_DAYS, iterations: 0, lower: 0, median: 0, upper: 0 };
  }

  const sortedCandidate = candidateRows.slice().sort((left, right) => timestamp(left.recordedAt)! - timestamp(right.recordedAt)!);
  const sortedCurrent = currentRows.slice().sort((left, right) => timestamp(left.recordedAt)! - timestamp(right.recordedAt)!);
  const blocks: Array<{ candidate: Array<EvaluationRow>; current: Array<EvaluationRow> }> = [];
  for (let index = 0; index < sortedCandidate.length; index += BLOCK_DAYS) {
    blocks.push({
      candidate: sortedCandidate.slice(index, index + BLOCK_DAYS),
      current: sortedCurrent.slice(index, index + BLOCK_DAYS),
    });
  }

  const random = createSeededRandom(seed);
  const differences: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const candidateSample: Array<EvaluationRow> = [];
    const currentSample: Array<EvaluationRow> = [];
    while (candidateSample.length < sortedCandidate.length) {
      const block = blocks[Math.floor(random() * blocks.length)];
      candidateSample.push(...block.candidate);
      currentSample.push(...block.current);
    }
    differences.push(calculateBrierDifference(
      candidateSample.slice(0, sortedCandidate.length),
      currentSample.slice(0, sortedCurrent.length),
      period,
    ));
  }

  differences.sort((left, right) => left - right);
  const percentile = (value: number) => {
    const position = (differences.length - 1) * value;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return differences[lower];
    return differences[lower] + (differences[upper] - differences[lower]) * (position - lower);
  };
  return {
    seed,
    blockDays: BLOCK_DAYS,
    iterations,
    lower: percentile(0.025),
    median: percentile(0.5),
    upper: percentile(0.975),
  };
}

export function classifyModelResult(input: {
  brier24h: number;
  brier48h: number;
  currentBrier24h: number;
  currentBrier48h: number;
  bootstrap24h: Pick<BootstrapSummary, "lower" | "upper">;
  bootstrap48h: Pick<BootstrapSummary, "lower" | "upper">;
}): Exclude<ModelClassification, "baseline"> {
  const nonWorse = input.brier24h <= input.currentBrier24h && input.brier48h <= input.currentBrier48h;
  const clearlySeparated = input.bootstrap24h.upper < 0 && input.bootstrap48h.upper < 0;
  if (nonWorse && clearlySeparated) return "clearly_better";

  const worseBoth = input.brier24h > input.currentBrier24h && input.brier48h > input.currentBrier48h;
  const clearlyWorse = input.bootstrap24h.lower > 0 && input.bootstrap48h.lower > 0;
  if (worseBoth && clearlyWorse) return "worse";

  const tinyDifference = Math.max(
    Math.abs(input.brier24h - input.currentBrier24h),
    Math.abs(input.brier48h - input.currentBrier48h),
  ) < 0.01;
  return tinyDifference ? "no_meaningful_difference" : "promising_but_inconclusive";
}

const MODEL_DEFINITIONS: Array<ProbabilityModelDefinition> = [
  { modelVersion: SHADOW_PROBABILITY_MODEL_VERSION, halfLifeDays: null },
  ...RECENCY_SHADOW_MODEL_CONFIG.map(({ modelVersion, halfLifeDays }) => ({
    modelVersion,
    halfLifeDays,
  })),
];

function getModelPrediction(
  model: ProbabilityModelDefinition,
  data: ReturnType<typeof getLocalRadarData>,
  origin: Date,
) {
  const options = {
    now: origin,
    staticHistory: LOCAL_RESET_HISTORY,
    regularResetExpectedAt: null,
    activeOfficialNotice: undefined,
  } as const;
  if (model.halfLifeDays === null) {
    return calculateShadowProbability(data, options).predictions;
  }
  return calculateRecencyWeightedShadowProbability(data, model.halfLifeDays, options).predictions;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatMetric(metric: MetricSummary) {
  return `n=${metric.count}, actual=${formatPercent(metric.actualRate)}, mean=${formatPercent(metric.averagePrediction)}, Brier=${metric.brier.toFixed(4)}, logLoss=${metric.logLoss.toFixed(4)}`;
}

function formatCalibration(metric: MetricSummary) {
  return metric.calibration
    .map((bucket) => `${bucket.range}: n=${bucket.count}, mean=${formatPercent(bucket.averagePrediction)}, actual=${formatPercent(bucket.actualRate)}`)
    .join("; ");
}

function writeMarkdown(report: ProbabilityModelEvaluationReport) {
  const lines = [
    "# Probability Model Evaluation",
    "",
    `- asOf: ${report.asOf}`,
    `- Target events: ${report.eventCount}`,
    `- Completed intervals: ${report.completedIntervalCount}`,
    `- Origins: ${report.originCount}`,
    `- Observation period: ${report.observationPeriod.start ?? "unavailable"} to ${report.observationPeriod.end}`,
    "",
    "## Models",
    "",
    "| Model | Half-life | Classification | 24h Brier | 48h Brier |",
    "| --- | ---: | --- | ---: | ---: |",
  ];
  for (const model of report.models) {
    lines.push(`| ${model.modelVersion} | ${model.halfLifeDays ?? "none"} | ${model.classification} | ${model.metrics24h.brier.toFixed(4)} | ${model.metrics48h.brier.toFixed(4)} |`);
  }

  lines.push("", "## Metrics", "");
  for (const model of report.models) {
    lines.push(`### ${model.modelVersion}`, "", `- 24h: ${formatMetric(model.metrics24h)}`, `- 48h: ${formatMetric(model.metrics48h)}`);
    lines.push(`- 24h calibration: ${formatCalibration(model.metrics24h)}`);
    lines.push(`- 48h calibration: ${formatCalibration(model.metrics48h)}`);
    if (model.differenceVsCurrent) {
      const difference = model.differenceVsCurrent;
      lines.push(
        `- Difference vs current Brier: 24h ${(difference.brier24h >= 0 ? "+" : "") + difference.brier24h.toFixed(4)}, 48h ${(difference.brier48h >= 0 ? "+" : "") + difference.brier48h.toFixed(4)}`,
        `- 24h block bootstrap 95% CI: [${difference.bootstrap24h.lower.toFixed(4)}, ${difference.bootstrap24h.upper.toFixed(4)}]`,
        `- 48h block bootstrap 95% CI: [${difference.bootstrap48h.lower.toFixed(4)}, ${difference.bootstrap48h.upper.toFixed(4)}]`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Notes",
    "",
    `- ${report.notes.join("\n- ")}`,
    "- Daily evaluation origins overlap, so metric differences are not independent.",
    "- The public model remains hazard-odds-v2-random-only; these recency models are Shadow-only experiments.",
    "- No automatic winner is selected. The sample is small and should not be treated as a production adoption decision.",
  );
  return `${lines.join("\n")}\n`;
}

export function evaluateProbabilityModels(asOf: Date = new Date(LOCAL_MODEL_UPDATED_AT)) {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError("asOf must be a valid date");
  const asOfIso = asOf.toISOString();
  const allEvents = getShadowCompletedResetEvents(null, asOf, LOCAL_RESET_HISTORY);
  const origins = createWalkForwardOrigins(allEvents, asOfIso);
  const rowsByModel = new Map<string, Array<EvaluationRow>>(
    MODEL_DEFINITIONS.map((model) => [model.modelVersion, []]),
  );

  for (const recordedAt of origins) {
    const origin = new Date(recordedAt);
    const data = getLocalRadarData({ calculationNow: origin });
    const actual24h = getActualWithinHorizon(allEvents, recordedAt, 24);
    const actual48h = getActualWithinHorizon(allEvents, recordedAt, 48);
    for (const model of MODEL_DEFINITIONS) {
      const prediction = getModelPrediction(model, data, origin);
      rowsByModel.get(model.modelVersion)!.push({
        recordedAt,
        probability24h: prediction.probability24h,
        probability48h: prediction.probability48h,
        actual24h,
        actual48h,
      });
    }
  }

  const currentRows = rowsByModel.get(SHADOW_PROBABILITY_MODEL_VERSION) ?? [];
  const current24h = calculateMetric(currentRows, "24h");
  const current48h = calculateMetric(currentRows, "48h");
  const models = MODEL_DEFINITIONS.map((model) => {
    const rows = rowsByModel.get(model.modelVersion) ?? [];
    const metrics24h = calculateMetric(rows, "24h");
    const metrics48h = calculateMetric(rows, "48h");
    if (model.modelVersion === SHADOW_PROBABILITY_MODEL_VERSION) {
      return {
        modelVersion: model.modelVersion,
        halfLifeDays: model.halfLifeDays,
        classification: "baseline" as const,
        metrics24h,
        metrics48h,
        differenceVsCurrent: null,
      };
    }
    const bootstrap24h = calculateBlockBootstrapDifference(rows, currentRows, "24h", BOOTSTRAP_SEED);
    const bootstrap48h = calculateBlockBootstrapDifference(rows, currentRows, "48h", BOOTSTRAP_SEED);
    return {
      modelVersion: model.modelVersion,
      halfLifeDays: model.halfLifeDays,
      classification: classifyModelResult({
        brier24h: metrics24h.brier,
        brier48h: metrics48h.brier,
        currentBrier24h: current24h.brier,
        currentBrier48h: current48h.brier,
        bootstrap24h,
        bootstrap48h,
      }),
      metrics24h,
      metrics48h,
      differenceVsCurrent: {
        brier24h: metrics24h.brier - current24h.brier,
        brier48h: metrics48h.brier - current48h.brier,
        logLoss24h: metrics24h.logLoss - current24h.logLoss,
        logLoss48h: metrics48h.logLoss - current48h.logLoss,
        bootstrap24h,
        bootstrap48h,
      },
    };
  });

  const report: ProbabilityModelEvaluationReport = {
    schemaVersion: "probability-model-evaluation-v1",
    asOf: asOfIso,
    generatedAt: asOfIso,
    targetDefinition: SHADOW_TARGET_DEFINITION,
    eventCount: allEvents.length,
    completedIntervalCount: Math.max(0, allEvents.length - 1),
    observationPeriod: {
      start: allEvents[0]?.resetAt ?? null,
      end: asOfIso,
    },
    originCount: origins.length,
    origins,
    models,
    notes: [
      `Models use the same target event definition and signal multiplier path as the current Shadow model.`,
      `Completed interval event and exposure weights use exp(-ln(2) * ageDays / halfLifeDays); censored exposure uses weight 1.`,
      `The fixed bootstrap seed is ${BOOTSTRAP_SEED} with ${BLOCK_DAYS}-day blocks and ${BOOTSTRAP_ITERATIONS} iterations.`,
      `There are ${allEvents.length} target events and ${Math.max(0, allEvents.length - 1)} completed intervals available as of ${asOfIso}.`,
    ],
  };
  return report;
}

export function writeProbabilityModelEvaluationReports(
  report: ProbabilityModelEvaluationReport,
  reportsDirectory = join(process.cwd(), "reports"),
) {
  mkdirSync(reportsDirectory, { recursive: true });
  writeFileSync(
    join(reportsDirectory, "probability-model-evaluation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(reportsDirectory, "probability-model-evaluation.md"),
    writeMarkdown(report),
    "utf8",
  );
}

function parseAsOf(args: Array<string>) {
  const index = args.indexOf("--as-of");
  const value = index >= 0 ? args[index + 1] : LOCAL_MODEL_UPDATED_AT;
  if (!value) throw new Error("--as-of requires an ISO timestamp");
  const asOf = new Date(value);
  if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid --as-of timestamp: ${value}`);
  return asOf;
}

function main() {
  const report = evaluateProbabilityModels(parseAsOf(process.argv.slice(2)));
  writeProbabilityModelEvaluationReports(report);
  console.log(JSON.stringify({
    asOf: report.asOf,
    eventCount: report.eventCount,
    completedIntervalCount: report.completedIntervalCount,
    originCount: report.originCount,
    models: report.models.map((model) => ({
      modelVersion: model.modelVersion,
      classification: model.classification,
      brier24h: model.metrics24h.brier,
      brier48h: model.metrics48h.brier,
      differenceVsCurrent: model.differenceVsCurrent,
    })),
  }, null, 2));
}

if (basename(process.argv[1] ?? "") === "evaluateProbabilityModels.ts") {
  main();
}
