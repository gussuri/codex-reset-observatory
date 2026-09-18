import {
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_CONFIG,
  BROAD_BANKED_RANDOM_CLOCK_V2_OPTIONS,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS,
} from "@/data/shadowProbabilityConfig";
import {
  buildRandomContinuousHazard,
  getPostResetRegimeMultiplierAtAge,
  getRandomContinuousHazardDiagnosticsAtAge,
  integrateRandomContinuousHazard,
} from "./randomContinuousProbability";
import { calculateRegimeDiagnostics } from "./regimeElapsedProbability";
import type { RecoveryResetBoundary } from "./recoveryBoundary";

const HOUR_MS = 60 * 60 * 1000;

export const BROAD_BANKED_RANDOM_CLOCK_INTERVAL_BINS = [
  { label: "0–24h", minHours: 0, maxHours: 24 },
  { label: "24–48h", minHours: 24, maxHours: 48 },
  { label: "48–72h", minHours: 48, maxHours: 72 },
  { label: "3–4d", minHours: 72, maxHours: 96 },
  { label: "4–5d", minHours: 96, maxHours: 120 },
  { label: "5–6d", minHours: 120, maxHours: 144 },
  { label: "6–7d", minHours: 144, maxHours: 168 },
  { label: "7–8d", minHours: 168, maxHours: 192 },
  { label: "8–9d", minHours: 192, maxHours: 216 },
  { label: "9–10d", minHours: 216, maxHours: 240 },
  { label: "10d+", minHours: 240, maxHours: null },
] as const;

export const BROAD_BANKED_RANDOM_CLOCK_SENSITIVITY_AGES_HOURS = [
  144,
  168,
  192,
  216,
  240,
  264,
  288,
  312,
  336,
  360,
] as const;

type Interval = {
  startAt: string;
  endAt: string;
  hours: number;
};

export type RandomBoundaryIntervalSummary = {
  count: number;
  intervalHours: number[];
  binCounts: Record<typeof BROAD_BANKED_RANDOM_CLOCK_INTERVAL_BINS[number]["label"], number>;
  medianHours: number | null;
  meanHours: number | null;
  minHours: number | null;
  maxHours: number | null;
  atLeast144Hours: number;
  atLeast240Hours: number;
};

export type RandomBoundaryIntervalComparison = {
  legacy: RandomBoundaryIntervalSummary;
  v2: RandomBoundaryIntervalSummary;
  splitEvidence: Array<{
    legacyStartAt: string;
    legacyEndAt: string;
    legacyHours: number;
    v2PartsHours: number[];
    v2TotalHours: number;
  }>;
};

export type RandomClockSensitivityRow = {
  ageHours: number;
  instantaneousRawDailyProbability: number;
  regimeMultiplier: number;
  probability24h: number;
  probability48h: number;
  noRegimeProbability24h: number;
  noRegimeProbability48h: number;
};

export type RandomClockSensitivityComparison = {
  legacyAnchorAt: string | null;
  v2AnchorAt: string | null;
  legacy: RandomClockSensitivityRow[];
  v2: RandomClockSensitivityRow[];
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function eligibleBoundaryTimes(boundaries: Array<RecoveryResetBoundary>, asOf?: Date) {
  const asOfTime = asOf?.getTime();
  return boundaries
    .flatMap((boundary) => {
      const time = timestamp(boundary.resetAt);
      if (!boundary.isRandom || time === null || Number.isFinite(asOfTime) && time > asOfTime!) return [];
      return [{ boundary, time }];
    })
    .sort((left, right) => left.time - right.time);
}

function getIntervals(boundaries: Array<RecoveryResetBoundary>, asOf?: Date): Interval[] {
  const points = eligibleBoundaryTimes(boundaries, asOf);
  return points.flatMap((point, index) => {
    const previous = points[index - 1];
    if (!previous || point.time <= previous.time) return [];
    return [{
      startAt: new Date(previous.time).toISOString(),
      endAt: new Date(point.time).toISOString(),
      hours: (point.time - previous.time) / HOUR_MS,
    }];
  });
}

function getBinLabel(hours: number) {
  return BROAD_BANKED_RANDOM_CLOCK_INTERVAL_BINS.find((bin) =>
    hours >= bin.minHours && (bin.maxHours === null || hours < bin.maxHours),
  )?.label ?? null;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function summarizeRandomBoundaryIntervals(
  boundaries: Array<RecoveryResetBoundary>,
  asOf?: Date,
): RandomBoundaryIntervalSummary {
  const intervalHours = getIntervals(boundaries, asOf).map((interval) => interval.hours);
  const binCounts = Object.fromEntries(
    BROAD_BANKED_RANDOM_CLOCK_INTERVAL_BINS.map((bin) => [bin.label, 0]),
  ) as RandomBoundaryIntervalSummary["binCounts"];
  for (const hours of intervalHours) {
    const label = getBinLabel(hours);
    if (label) binCounts[label] += 1;
  }
  return {
    count: intervalHours.length,
    intervalHours,
    binCounts,
    medianHours: median(intervalHours),
    meanHours: intervalHours.length === 0
      ? null
      : intervalHours.reduce((sum, hours) => sum + hours, 0) / intervalHours.length,
    minHours: intervalHours.length === 0 ? null : Math.min(...intervalHours),
    maxHours: intervalHours.length === 0 ? null : Math.max(...intervalHours),
    atLeast144Hours: intervalHours.filter((hours) => hours >= RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_THRESHOLD_HOURS).length,
    atLeast240Hours: intervalHours.filter((hours) => hours >= 240).length,
  };
}

export function compareRandomBoundaryIntervals(
  legacyBoundaries: Array<RecoveryResetBoundary>,
  v2Boundaries: Array<RecoveryResetBoundary>,
  asOf?: Date,
): RandomBoundaryIntervalComparison {
  const legacyIntervals = getIntervals(legacyBoundaries, asOf);
  const v2Points = eligibleBoundaryTimes(v2Boundaries, asOf);
  const splitEvidence = legacyIntervals.flatMap((interval) => {
    const start = timestamp(interval.startAt)!;
    const end = timestamp(interval.endAt)!;
    const splitPoints = v2Points
      .map((point) => point.time)
      .filter((time) => time > start && time < end);
    if (splitPoints.length === 0) return [];
    const points = [start, ...splitPoints, end];
    const v2PartsHours = points.slice(1).map((time, index) => (time - points[index]) / HOUR_MS);
    const v2TotalHours = v2PartsHours.reduce((sum, hours) => sum + hours, 0);
    return Math.abs(v2TotalHours - interval.hours) < 1e-9
      ? [{
          legacyStartAt: interval.startAt,
          legacyEndAt: interval.endAt,
          legacyHours: interval.hours,
          v2PartsHours,
          v2TotalHours,
        }]
      : [];
  });
  return {
    legacy: summarizeRandomBoundaryIntervals(legacyBoundaries, asOf),
    v2: summarizeRandomBoundaryIntervals(v2Boundaries, asOf),
    splitEvidence,
  };
}

function calculateSensitivityForBoundaries(
  boundaries: Array<RecoveryResetBoundary>,
  agesHours: readonly number[],
): { anchorAt: string | null; rows: RandomClockSensitivityRow[] } {
  const points = eligibleBoundaryTimes(boundaries);
  const anchor = points.at(-1);
  if (!anchor) return { anchorAt: null, rows: [] };
  const historicalBoundaries = boundaries.filter((boundary) => {
    const time = timestamp(boundary.resetAt);
    return time !== null && time <= anchor.time;
  });
  const randomBoundaries = historicalBoundaries.filter((boundary) => boundary.isRandom);
  return {
    anchorAt: new Date(anchor.time).toISOString(),
    rows: agesHours.map((ageHours) => {
      const asOf = new Date(anchor.time + ageHours * HOUR_MS);
      const hazard = buildRandomContinuousHazard(
        randomBoundaries,
        asOf,
        BROAD_BANKED_RANDOM_CLOCK_V2_OPTIONS,
      );
      const instantaneous = getRandomContinuousHazardDiagnosticsAtAge(hazard, ageHours);
      const regime = calculateRegimeDiagnostics(
        historicalBoundaries,
        asOf,
        BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_CONFIG,
      ).regimeMultiplier;
      return {
        ageHours,
        instantaneousRawDailyProbability: instantaneous.dailyProbability,
        regimeMultiplier: regime,
        probability24h: integrateRandomContinuousHazard(
          hazard,
          ageHours,
          24,
          regime,
          getPostResetRegimeMultiplierAtAge,
        ),
        probability48h: integrateRandomContinuousHazard(
          hazard,
          ageHours,
          48,
          regime,
          getPostResetRegimeMultiplierAtAge,
        ),
        noRegimeProbability24h: integrateRandomContinuousHazard(hazard, ageHours, 24, 1),
        noRegimeProbability48h: integrateRandomContinuousHazard(hazard, ageHours, 48, 1),
      };
    }),
  };
}

export function calculateRandomClockSensitivityComparison(
  legacyBoundaries: Array<RecoveryResetBoundary>,
  v2Boundaries: Array<RecoveryResetBoundary>,
  agesHours: readonly number[] = BROAD_BANKED_RANDOM_CLOCK_SENSITIVITY_AGES_HOURS,
): RandomClockSensitivityComparison {
  const legacy = calculateSensitivityForBoundaries(legacyBoundaries, agesHours);
  const v2 = calculateSensitivityForBoundaries(v2Boundaries, agesHours);
  return {
    legacyAnchorAt: legacy.anchorAt,
    v2AnchorAt: v2.anchorAt,
    legacy: legacy.rows,
    v2: v2.rows,
  };
}
