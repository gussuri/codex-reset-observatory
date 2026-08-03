import { LOCAL_PROBABILITY_HISTORY, type ProbabilityHistoryItem } from "../data/probabilityHistory";
import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { getLocalProbabilityCalculation, getRecent7DayResetCount } from "../lib/radar/probability";
import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import {
  buildShadowHazard,
  calculateShadowProbability,
  getConstantProbabilityBaseline,
  getElapsedTimeOnlyBaseline,
  getShadowBaselineAgeHours,
  getShadowCompletedResetEvents,
  getShadowResultWithoutSignals,
  type ShadowResetEvent,
} from "../lib/radar/shadowProbability";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LABEL_END = new Date("2100-01-01T00:00:00.000Z");

type EvaluationRow = {
  recordedAt: string;
  probability24h: number;
  probability48h: number;
  actual24h: boolean;
  actual48h: boolean;
};

type MetricSummary = {
  count: number;
  brier: number;
  logLoss: number;
  mae: number;
  averagePrediction: number;
  actualRate: number;
  calibration: Array<{
    range: string;
    count: number;
    averagePrediction: number;
    actualRate: number;
  }>;
};

function getTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toJstDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function getActual(events: Array<ShadowResetEvent>, recordedAt: string, horizonHours: number) {
  const start = getTimestamp(recordedAt);
  if (start === null) return false;
  return events.some((event) => {
    const resetAt = getTimestamp(event.resetAt);
    return resetAt !== null && resetAt > start && resetAt <= start + horizonHours * HOUR_MS;
  });
}

function clampProbability(value: number) {
  return Math.min(1 - 1e-12, Math.max(1e-12, value));
}

function calculateMetric(rows: Array<EvaluationRow>, period: "24h" | "48h"): MetricSummary {
  if (rows.length === 0) {
    return {
      count: 0,
      brier: 0,
      logLoss: 0,
      mae: 0,
      averagePrediction: 0,
      actualRate: 0,
      calibration: [],
    };
  }

  const values = rows.map((row) => ({
    prediction: period === "24h" ? row.probability24h : row.probability48h,
    actual: period === "24h" ? Number(row.actual24h) : Number(row.actual48h),
  }));
  const calibration = [0, 0.2, 0.4, 0.6, 0.8].map((lower) => {
    const upper = lower + 0.2;
    const bucket = values.filter(({ prediction }) =>
      prediction >= lower && (prediction < upper || (upper === 1 && prediction <= upper)),
    );
    return {
      range: `${Math.round(lower * 100)}-${Math.round(upper * 100)}%`,
      count: bucket.length,
      averagePrediction: bucket.length === 0
        ? 0
        : bucket.reduce((sum, item) => sum + item.prediction, 0) / bucket.length,
      actualRate: bucket.length === 0
        ? 0
        : bucket.reduce((sum, item) => sum + item.actual, 0) / bucket.length,
    };
  }).filter((bucket) => bucket.count > 0);

  return {
    count: rows.length,
    brier: values.reduce((sum, item) => sum + (item.prediction - item.actual) ** 2, 0) / values.length,
    logLoss: values.reduce((sum, item) => {
      const prediction = clampProbability(item.prediction);
      return sum - (item.actual * Math.log(prediction) + (1 - item.actual) * Math.log(1 - prediction));
    }, 0) / values.length,
    mae: values.reduce((sum, item) => sum + Math.abs(item.prediction - item.actual), 0) / values.length,
    averagePrediction: values.reduce((sum, item) => sum + item.prediction, 0) / values.length,
    actualRate: values.reduce((sum, item) => sum + item.actual, 0) / values.length,
    calibration,
  };
}

function formatMetric(name: string, metric: MetricSummary) {
  if (metric.count === 0) return `${name}: unavailable (0 snapshots)`;
  return [
    `${name}: n=${metric.count}`,
    `Brier=${metric.brier.toFixed(4)}`,
    `logLoss=${metric.logLoss.toFixed(4)}`,
    `MAE=${metric.mae.toFixed(4)}`,
    `avg=${(metric.averagePrediction * 100).toFixed(2)}%`,
    `actual=${(metric.actualRate * 100).toFixed(2)}%`,
    `calibration=${JSON.stringify(metric.calibration)}`,
  ].join(" | ");
}

function getRowsForSnapshots(
  snapshots: Array<ProbabilityHistoryItem>,
  predictions: (snapshot: ProbabilityHistoryItem, data: ReturnType<typeof getLocalRadarData>) => {
    probability24h: number;
    probability48h: number;
  },
  allEvents: Array<ShadowResetEvent>,
) {
  return snapshots.map((snapshot): EvaluationRow => {
    const recordedAt = snapshot.recordedAt;
    const data = getLocalRadarData({ calculationNow: new Date(snapshot.recordedAt) });
    const prediction = predictions(snapshot, data);
    return {
      recordedAt,
      probability24h: prediction.probability24h,
      probability48h: prediction.probability48h,
      actual24h: getActual(allEvents, recordedAt, 24),
      actual48h: getActual(allEvents, recordedAt, 48),
    };
  });
}

function chooseDailySnapshots(snapshots: Array<ProbabilityHistoryItem>) {
  const seen = new Set<string>();
  return snapshots
    .slice()
    .sort((left, right) => getTimestamp(left.recordedAt)! - getTimestamp(right.recordedAt)!)
    .filter((snapshot) => {
      const day = toJstDay(snapshot.recordedAt);
      if (seen.has(day)) return false;
      seen.add(day);
      return true;
    });
}

function printEvaluation(label: string, snapshots: Array<ProbabilityHistoryItem>, allEvents: Array<ShadowResetEvent>) {
  const primaryRows = getRowsForSnapshots(
    snapshots,
    (snapshot) => ({
      probability24h: snapshot.probability24h,
      probability48h: snapshot.probability48h,
    }),
    allEvents,
  );
  const hazardRows = getRowsForSnapshots(
    snapshots,
    (_, data) => {
      const now = new Date(data.checked_at ?? new Date().toISOString());
      return {
        probability24h: getShadowResultWithoutSignals(data, { now }).probability24h,
        probability48h: getShadowResultWithoutSignals(data, { now }).probability48h,
      };
    },
    allEvents,
  );
  const constantRows = getRowsForSnapshots(
    snapshots,
    (_, data) => {
      const now = new Date(data.checked_at ?? new Date().toISOString());
      const events = getShadowCompletedResetEvents(data, now, LOCAL_RESET_HISTORY);
      const hazard = buildShadowHazard(events, now);
      const ageHours = getShadowBaselineAgeHours(data, now, events);
      return {
        probability24h: getConstantProbabilityBaseline(hazard, ageHours, 24),
        probability48h: getConstantProbabilityBaseline(hazard, ageHours, 48),
      };
    },
    allEvents,
  );
  const elapsedRows = getRowsForSnapshots(
    snapshots,
    (_, data) => {
      const now = new Date(data.checked_at ?? new Date().toISOString());
      const events = getShadowCompletedResetEvents(data, now, LOCAL_RESET_HISTORY);
      const hazard = buildShadowHazard(events, now);
      const ageHours = getShadowBaselineAgeHours(data, now, events);
      return {
        probability24h: getElapsedTimeOnlyBaseline(hazard, ageHours, 24),
        probability48h: getElapsedTimeOnlyBaseline(hazard, ageHours, 48),
      };
    },
    allEvents,
  );

  console.log(`\n## ${label}`);
  for (const [name, rows] of [
    ["primary", primaryRows],
    ["shadow hazard-only", hazardRows],
    ["constant-probability baseline", constantRows],
    ["elapsed-time-only baseline", elapsedRows],
  ] as const) {
    console.log(formatMetric(name, calculateMetric(rows, "24h")));
    console.log(formatMetric(`${name} 48h`, calculateMetric(rows, "48h")));
  }
  console.log("shadow full signal model: unavailable for historical metrics because point-in-time signal snapshots are not stored");
}

function main() {
  const snapshots = LOCAL_PROBABILITY_HISTORY.filter((snapshot) =>
    getTimestamp(snapshot.recordedAt) !== null,
  );
  const allEvents = getShadowCompletedResetEvents(
    getLocalRadarData({ calculationNow: LABEL_END }),
    LABEL_END,
    LOCAL_RESET_HISTORY,
  );
  const dailySnapshots = chooseDailySnapshots(snapshots);

  console.log("Shadow probability evaluation (read-only; no Supabase, webhook, Gemini, or network calls)");
  console.log(`snapshots=${snapshots.length}, dailyJstSnapshots=${dailySnapshots.length}, completedEventsForLabels=${allEvents.length}`);
  printEvaluation("All snapshots", snapshots, allEvents);
  printEvaluation("One snapshot per JST day", dailySnapshots, allEvents);

  const now = new Date();
  const data = getLocalRadarData({ calculationNow: now });
  const currentViewModel = getRadarViewModel(data, "ja", false, undefined, now);
  const regularResetExpectedAt = currentViewModel.regularResetForecast.expectedAt;
  const primary = getLocalProbabilityCalculation(data, { now, regularResetExpectedAt });
  const shadow = calculateShadowProbability(data, { now, regularResetExpectedAt });
  console.log("\n## Current preview (not used for historical scores)");
  console.log(JSON.stringify({
    primary: {
      probability24h: primary.probability24h,
      probability48h: primary.probability48h,
      modelVersion: primary.modelVersion,
    },
    shadow: {
      probability24h: shadow.predictions.probability24h,
      probability48h: shadow.predictions.probability48h,
      baseline24h: shadow.baseline.probability24h,
      baseline48h: shadow.baseline.probability48h,
      confidence: shadow.confidence,
      combinedMultiplier: shadow.multipliers.combinedAfterCap,
      recentResetCount7d: getRecent7DayResetCount(data, now),
    },
  }, null, 2));
}

main();
