import { PUBLISHED_RECENCY_HALF_LIFE_DAYS } from "@/data/shadowProbabilityConfig";
import { DISPLAY_TIME_ZONE } from "./helpers";
import { getRecencyDecayWeight } from "./recencyWeightedProbability";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RANDOM_RESET_TIME_HEATMAP_BIN_COUNT = 12;

export type RandomResetTimeHeatmapBin = {
  startHour: number;
  endHour: number;
  rawCount: number;
  weightedCount: number;
  weightedShare: number;
};

export type RandomResetTimeHeatmap = {
  bins: RandomResetTimeHeatmapBin[];
  totalCount: number;
  totalWeightedCount: number;
};

export function getHeatmapHour(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const safeTimeZone = getSafeTimeZone(timeZone);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: safeTimeZone,
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .find((part) => part.type === "hour")?.value,
  );

  return Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : null;
}

export function buildRandomResetTimeHeatmap(
  eventTimes: string[],
  timeZone: string,
  now: Date | number = Date.now(),
): RandomResetTimeHeatmap {
  const nowTime = typeof now === "number" ? now : now.getTime();
  const bins = Array.from({ length: RANDOM_RESET_TIME_HEATMAP_BIN_COUNT }, (_, index) => ({
    startHour: index * 2,
    endHour: (index + 1) * 2,
    rawCount: 0,
    weightedCount: 0,
    weightedShare: 0,
  }));

  if (!Number.isFinite(nowTime)) {
    return { bins, totalCount: 0, totalWeightedCount: 0 };
  }

  let totalCount = 0;
  let totalWeightedCount = 0;

  for (const eventTime of eventTimes) {
    const eventTimestamp = new Date(eventTime).getTime();
    if (!Number.isFinite(eventTimestamp) || eventTimestamp > nowTime) continue;

    const hour = getHeatmapHour(eventTime, timeZone);
    if (hour === null) continue;

    const weight = getRecencyDecayWeight(
      (nowTime - eventTimestamp) / DAY_MS,
      PUBLISHED_RECENCY_HALF_LIFE_DAYS,
    );
    const bin = bins[Math.floor(hour / 2)];
    bin.rawCount += 1;
    bin.weightedCount += weight;
    totalCount += 1;
    totalWeightedCount += weight;
  }

  for (const bin of bins) {
    bin.weightedShare = totalWeightedCount > 0
      ? bin.weightedCount / totalWeightedCount
      : 0;
  }

  return { bins, totalCount, totalWeightedCount };
}

export function formatHeatmapTimeRange(
  bin: Pick<RandomResetTimeHeatmapBin, "startHour" | "endHour">,
  locale: "ja" | "en" | "zh",
) {
  const start = String(bin.startHour).padStart(2, "0");
  const end = String(bin.endHour).padStart(2, "0");
  if (locale === "en") return `${start}:00–${end}:00`;
  return `${start}:00〜${end}:00`;
}

function getSafeTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return DISPLAY_TIME_ZONE;
  }
}
