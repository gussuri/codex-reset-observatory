import { DISPLAY_TIME_ZONE } from "./helpers";

export const RANDOM_RESET_TIME_HEATMAP_BIN_COUNT = 12;
export const RANDOM_RESET_TIME_HEATMAP_LAST_MONTH_DAYS = 30;
export const RANDOM_RESET_WEEKDAY_BIN_COUNT = 7;

export type RandomResetTimeHeatmapRange = "all" | "lastMonth";

export type RandomResetTimeHeatmapBin = {
  startHour: number;
  endHour: number;
  rawCount: number;
};

export type RandomResetTimeHeatmap = {
  bins: RandomResetTimeHeatmapBin[];
  totalCount: number;
};

export type RandomResetWeekdayBin = {
  weekday: number;
  rawCount: number;
};

export type RandomResetWeekdayDistribution = {
  bins: RandomResetWeekdayBin[];
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

export function getHeatmapWeekday(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimeZone(timeZone),
    weekday: "short",
  }).format(date);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);

  return weekdayIndex >= 0 ? weekdayIndex : null;
}

export function buildRandomResetWeekdayDistribution(
  eventTimes: string[],
  timeZone: string,
  now: Date | number = Date.now(),
): RandomResetWeekdayDistribution {
  const nowTime = typeof now === "number" ? now : now.getTime();
  const bins = Array.from({ length: RANDOM_RESET_WEEKDAY_BIN_COUNT }, (_, weekday) => ({
    weekday,
    rawCount: 0,
  }));

  if (!Number.isFinite(nowTime)) {
    return { bins, totalCount: 0 };
  }

  let totalCount = 0;

  for (const eventTime of eventTimes) {
    const eventTimestamp = new Date(eventTime).getTime();
    if (!Number.isFinite(eventTimestamp) || eventTimestamp > nowTime) continue;

    const weekday = getHeatmapWeekday(eventTime, timeZone);
    if (weekday === null) continue;

    bins[weekday].rawCount += 1;
    totalCount += 1;
  }

  return { bins, totalCount };
}

export function filterHeatmapEventTimes(
  eventTimes: string[],
  range: RandomResetTimeHeatmapRange,
  now: Date | number = Date.now(),
) {
  const nowTime = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(nowTime)) return [];

  const startTime =
    range === "lastMonth"
      ? nowTime - RANDOM_RESET_TIME_HEATMAP_LAST_MONTH_DAYS * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

  return eventTimes.filter((eventTime) => {
    const timestamp = new Date(eventTime).getTime();
    return Number.isFinite(timestamp) && timestamp >= startTime && timestamp <= nowTime;
  });
}

export function getRawBarHeightPercent(rawCount: number, maxRawCount: number) {
  if (!Number.isFinite(rawCount) || !Number.isFinite(maxRawCount) || rawCount <= 0 || maxRawCount <= 0) {
    return 0;
  }

  return Math.min(100, (rawCount / maxRawCount) * 100);
}

export function getHeatmapTimeAxisTicks() {
  return Array.from(
    { length: RANDOM_RESET_TIME_HEATMAP_BIN_COUNT + 1 },
    (_, index) => index * 2,
  );
}

export function formatHeatmapWeekdayLabel(weekday: number, locale: "ja" | "en" | "zh") {
  const labels = {
    ja: ["日", "月", "火", "水", "木", "金", "土"],
    en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  } as const;

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return "?";
  return labels[locale][weekday];
}

export function formatHeatmapWeekdayBarLabel(
  bin: Pick<RandomResetWeekdayBin, "weekday" | "rawCount">,
  locale: "ja" | "en" | "zh",
) {
  const label = formatHeatmapWeekdayLabel(bin.weekday, locale);
  if (locale === "en") return `${label}, ${bin.rawCount} records`;
  if (locale === "zh") return `${label}，${bin.rawCount}条记录`;
  return `${label}曜日・${bin.rawCount}件`;
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
