import { EXPECTATION_THRESHOLDS, REFRESH_INTERVAL_MS } from "@/data/predictionWeights";
import type { Locale } from "./types";
import { translateUI, translateDynamic, translateExpectation } from "./i18n";

export const DISPLAY_TIME_ZONE = "Asia/Tokyo";
export const DAY_MS = 24 * 60 * 60 * 1000;

export function probabilityToPercent(value: number | undefined, locale: Locale = "ja") {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return locale === "en" ? "Unknown" : locale === "zh" ? "未知" : "不明";
  }

  const normalized = normalizeProbability(value);
  return `${Math.round(normalized * 100)}%`;
}

export function normalizeProbability(value: number) {
  if (value > 1) {
    return value / 100;
  }
  return value;
}

export function getExpectationLabel(
  value: number | string | null | undefined,
  locale: Locale = "ja",
) {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    let label = value;

    switch (normalized) {
      case "low":
        label = "低";
        break;
      case "medium":
        label = "中";
        break;
      case "high":
        label = "高";
        break;
      case "very_high":
      case "very-high":
      case "critical":
        label = "超高";
        break;
      default:
        break;
    }

    return translateExpectation(label, locale);
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    return translateExpectation("不明", locale);
  }

  const normalized = normalizeProbability(value);

  if (normalized < EXPECTATION_THRESHOLDS.medium) {
    return translateExpectation("低", locale);
  }

  if (normalized < EXPECTATION_THRESHOLDS.high) {
    return translateExpectation("中", locale);
  }

  if (normalized < EXPECTATION_THRESHOLDS.veryHigh) {
    return translateExpectation("高", locale);
  }

  return translateExpectation("超高", locale);
}

export function getRefreshIntervalMs(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return REFRESH_INTERVAL_MS.unknown;
  }

  const normalized = normalizeProbability(value);

  if (normalized < EXPECTATION_THRESHOLDS.medium) {
    return REFRESH_INTERVAL_MS.low;
  }

  if (normalized < EXPECTATION_THRESHOLDS.high) {
    return REFRESH_INTERVAL_MS.medium;
  }

  if (normalized < EXPECTATION_THRESHOLDS.veryHigh) {
    return REFRESH_INTERVAL_MS.high;
  }

  return REFRESH_INTERVAL_MS.veryHigh;
}

export function getRefreshIntervalLabel(value: number | undefined, locale: Locale = "ja") {
  const intervalMs = getRefreshIntervalMs(value);

  if (intervalMs === REFRESH_INTERVAL_MS.veryHigh) {
    return locale === "en" ? "30 min" : locale === "zh" ? "30分钟" : "30分";
  }

  const hours = Math.round(intervalMs / 60 / 60 / 1000);
  return locale === "en" ? `${hours} hours` : locale === "zh" ? `${hours}小时` : `${hours}時間`;
}

export function formatDateTime(value: string | null | undefined, locale: Locale = "ja") {
  if (!value) {
    return locale === "en" ? "Unknown" : locale === "zh" ? "未知" : "不明";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const bcp47 = locale === "en" ? "en-US" : locale === "zh" ? "zh-CN" : "ja-JP";

  return new Intl.DateTimeFormat(bcp47, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: "short",
  }).format(date);
}

export function formatDateTimeCompact(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(value);
}

export function formatTime(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(value);
}

export function translateStatus(
  status: string | undefined,
  isWindowOpen: boolean | undefined,
  locale: Locale = "ja",
) {
  if (isWindowOpen || status === "open") {
    return translateUI("activeNoticeLabel", locale);
  }

  switch (status) {
    case "none":
      return locale === "en"
        ? "No resets are currently in progress."
        : locale === "zh"
          ? "当前未执行重置。"
          : "現在リセットは実施されていません";
    case "closed":
      return locale === "en"
        ? "The latest reset has been completed."
        : locale === "zh"
          ? "最近的重置已结束。"
          : "直近のリセットは終了しています";
    default:
      return status ? translateDynamic(status, locale) : translateUI("noNoticeLabel", locale);
  }
}

export function translateAction(action: string | undefined, locale: Locale = "ja") {
  switch (action) {
    case "wait":
      return locale === "en" ? "Wait and watch" : locale === "zh" ? "观察状况" : "様子を見る";
    case "use_quota":
      return locale === "en" ? "Use remaining quota if needed" : locale === "zh" ? "如有需要，使用剩余额度" : "必要なら残り枠を使う";
    case "watch":
      return locale === "en" ? "Check for updates" : locale === "zh" ? "确认后续信息" : "続報を確認する";
    default:
      return action ? translateDynamic(action, locale) : (locale === "en" ? "Unknown" : locale === "zh" ? "未知" : "不明");
  }
}

export function isSafeHttpUrl(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(value);
}

export function getCalendarDayDelta(target: Date, current: Date) {
  const targetDay = getTimeZoneDay(target);
  const currentDay = getTimeZoneDay(current);

  return Math.round((targetDay - currentDay) / DAY_MS);
}

export function getTimeZoneDay(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
  );
}

export function formatWindowLength(value: number | undefined, locale: Locale = "ja") {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return locale === "en" ? "Unknown" : locale === "zh" ? "未知" : "不明";
  }

  if (value <= 0) {
    return locale === "en" ? "Immediate reset" : locale === "zh" ? "即时重置" : "即時リセット";
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours > 0 && minutes > 0) {
    return locale === "en"
      ? `${hours}h ${minutes}m`
      : locale === "zh"
        ? `${hours}小时${minutes}分钟`
        : `${hours}時間${minutes}分`;
  }

  if (hours > 0) {
    return locale === "en"
      ? `${hours} hours`
      : locale === "zh"
        ? `${hours}小时`
        : `${hours}時間`;
  }

  return locale === "en"
    ? `${minutes} minutes`
    : locale === "zh"
      ? `${minutes}分钟`
      : `${minutes}分`;
}

export function getLatestIsoDate(values: Array<string | null | undefined>) {
  const latest = values
    .map((value) => (value ? new Date(value) : null))
    .filter((value): value is Date => Boolean(value && !Number.isNaN(value.getTime())))
    .sort((a, b) => b.getTime() - a.getTime())
    .at(0);

  return latest?.toISOString() ?? null;
}

export function getDateTime(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function isWithinHours(
  value: string,
  hours: number,
  now: Date | number = Date.now(),
) {
  const time = getDateTime(value);
  if (!time) {
    return false;
  }

  const nowTime = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(nowTime)) {
    return false;
  }

  const elapsed = nowTime - time;
  return elapsed >= 0 && elapsed <= hours * 60 * 60 * 1000;
}

export function getHoursUntil(value: string | null | undefined) {
  const time = getDateTime(value);
  if (!time) {
    return null;
  }

  return (time - Date.now()) / (60 * 60 * 1000);
}

export function isUpcomingWithinHours(hoursUntil: number | null, hours: number) {
  return hoursUntil !== null && hoursUntil >= 0 && hoursUntil <= hours;
}
