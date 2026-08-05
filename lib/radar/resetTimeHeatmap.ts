import { DISPLAY_TIME_ZONE } from "./helpers";

export const RANDOM_RESET_TIME_HEATMAP_BIN_COUNT = 12;

export type RandomResetTimeHeatmapBin = {
  startHour: number;
  endHour: number;
  rawCount: number;
};

export type RandomResetTimeHeatmap = {
  bins: RandomResetTimeHeatmapBin[];
  totalCount: number;
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
  }));

  if (!Number.isFinite(nowTime)) {
    return { bins, totalCount: 0 };
  }

  let totalCount = 0;

  for (const eventTime of eventTimes) {
    const eventTimestamp = new Date(eventTime).getTime();
    if (!Number.isFinite(eventTimestamp) || eventTimestamp > nowTime) continue;

    const hour = getHeatmapHour(eventTime, timeZone);
    if (hour === null) continue;

    const bin = bins[Math.floor(hour / 2)];
    bin.rawCount += 1;
    totalCount += 1;
  }

  return { bins, totalCount };
}

export function getRawBarHeightPercent(rawCount: number, maxRawCount: number) {
  if (!Number.isFinite(rawCount) || !Number.isFinite(maxRawCount) || rawCount <= 0 || maxRawCount <= 0) {
    return 0;
  }

  return Math.min(100, (rawCount / maxRawCount) * 100);
}

export function formatHeatmapBarLabel(
  bin: Pick<RandomResetTimeHeatmapBin, "startHour" | "endHour" | "rawCount">,
  locale: "ja" | "en" | "zh",
) {
  const range = formatHeatmapTimeRange(bin, locale);
  if (locale === "en") return `${range}, ${bin.rawCount} records`;
  if (locale === "zh") return `${range}，${bin.rawCount}条记录`;
  return `${range}・${bin.rawCount}件`;
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
