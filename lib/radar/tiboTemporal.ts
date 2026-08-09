/**
 * Deterministic interpretation of temporal semantics extracted from a Tibo
 * post. Gemini may identify the words and their meaning, but it never supplies
 * a trusted timestamp. All timestamps below are derived from the tweet instant
 * and an IANA timezone in this module.
 */

export const TIBO_TEMPORAL_RESOLUTION_VERSION = "tibo-temporal-v1";
export const TIBO_SOURCE_TIME_ZONE = "America/Los_Angeles";
export const TIBO_NOTICE_GRACE_MS = 2 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const TIBO_DAYPARTS = {
  morning: [6, 12],
  afternoon: [12, 17],
  evening: [17, 21],
  tonight: [18, 24],
} as const;

const TEMPORAL_KINDS = [
  "none",
  "absolute",
  "weekday",
  "relative_day",
  "relative_duration",
  "daypart",
  "range",
  "vague",
] as const;
const TEMPORAL_PRECISIONS = ["exact_time", "day", "daypart", "range", "unknown"] as const;
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAYPART_NAMES = ["morning", "afternoon", "evening", "tonight"] as const;
const RANGE_KINDS = ["this_week", "this_weekend", "next_week"] as const;

export type TemporalKind = (typeof TEMPORAL_KINDS)[number];
export type TemporalPrecision = (typeof TEMPORAL_PRECISIONS)[number];
export type TemporalWeekday = (typeof WEEKDAYS)[number];
export type TemporalDaypart = (typeof DAYPART_NAMES)[number];
export type TemporalRangeKind = (typeof RANGE_KINDS)[number];
export type TemporalResolutionStatus = "resolved" | "unresolved" | "rejected";

export type TemporalDateParts = {
  year: number | null;
  month: number;
  day: number;
};

export type TemporalTimeParts = {
  hour: number;
  minute: number;
};

export type TiboTemporalSemantics = {
  temporalExpression: string | null;
  temporalKind: TemporalKind;
  temporalPrecision: TemporalPrecision;
  weekday: TemporalWeekday | null;
  relativeDayOffset: number | null;
  relativeAmount: number | null;
  relativeUnit: "minutes" | "hours" | "days" | null;
  explicitDateParts: TemporalDateParts | null;
  explicitTimeParts: TemporalTimeParts | null;
  daypart: TemporalDaypart | null;
  rangeKind: TemporalRangeKind | null;
  explicitTimezone: string | null;
  temporalConfidence: number;
};

export type TiboTemporalResolution = {
  status: TemporalResolutionStatus;
  version: string;
  temporalExpression: string | null;
  temporalKind: TemporalKind;
  temporalPrecision: TemporalPrecision;
  timezone: string | null;
  confidence: number | null;
  expectedStartAt: string | null;
  expectedEndAt: string | null;
};

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type ResolvedTimeZone = {
  name: string;
  offsetMinutes?: number;
};

function isEnumValue<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isValidDateParts(value: unknown): value is TemporalDateParts {
  if (!value || typeof value !== "object") return false;
  const parts = value as Partial<TemporalDateParts>;
  return (
    (parts.year === null || parts.year === undefined || isInteger(parts.year)) &&
    isInteger(parts.month) && parts.month >= 1 && parts.month <= 12 &&
    isInteger(parts.day) && parts.day >= 1 && parts.day <= 31
  );
}

function isValidTimeParts(value: unknown): value is TemporalTimeParts {
  if (!value || typeof value !== "object") return false;
  const parts = value as Partial<TemporalTimeParts>;
  return (
    isInteger(parts.hour) && parts.hour >= 0 && parts.hour <= 23 &&
    isInteger(parts.minute) && parts.minute >= 0 && parts.minute <= 59
  );
}

function hasClockExpression(value: string) {
  return /\b(?:at\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b|\b(?:noon|midnight)\b/i.test(value);
}

function hasNumericDuration(value: string) {
  return /\b\d+(?:\.\d+)?\s*(?:minute|minutes|min|hour|hours|hr|hrs|day|days)\b/i.test(value);
}

function hasTemporalText(value: string, text: string) {
  return Boolean(value) && text.includes(value);
}

/** Validate and sanitize only semantic fields returned by Gemini. */
export function parseTiboTemporalSemantics(value: unknown, sourceText: string): TiboTemporalSemantics | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Record<string, unknown>;
  const expression = typeof parsed.temporalExpression === "string"
    ? parsed.temporalExpression.trim()
    : null;
  const kind = parsed.temporalKind;
  const precision = parsed.temporalPrecision;
  const confidence = parsed.temporalConfidence;
  if (
    !isEnumValue(kind, TEMPORAL_KINDS) ||
    !isEnumValue(precision, TEMPORAL_PRECISIONS) ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 || confidence > 1
  ) {
    return null;
  }

  if (expression && (expression.length > 300 || !hasTemporalText(expression, sourceText))) {
    return null;
  }

  const weekday = parsed.weekday === null || parsed.weekday === undefined
    ? null
    : isEnumValue(parsed.weekday, WEEKDAYS) ? parsed.weekday : null;
  const daypart = parsed.daypart === null || parsed.daypart === undefined
    ? null
    : isEnumValue(parsed.daypart, DAYPART_NAMES) ? parsed.daypart : null;
  const rangeKind = parsed.rangeKind === null || parsed.rangeKind === undefined
    ? null
    : isEnumValue(parsed.rangeKind, RANGE_KINDS) ? parsed.rangeKind : null;
  const explicitTimezone = parsed.explicitTimezone === null || parsed.explicitTimezone === undefined
    ? null
    : typeof parsed.explicitTimezone === "string" && parsed.explicitTimezone.trim()
      ? parsed.explicitTimezone.trim()
      : null;
  if (explicitTimezone && !sourceText.toLowerCase().includes(explicitTimezone.toLowerCase())) {
    return null;
  }

  const explicitDateParts = parsed.explicitDateParts === null || parsed.explicitDateParts === undefined
    ? null
    : isValidDateParts(parsed.explicitDateParts) ? parsed.explicitDateParts : null;
  if (parsed.explicitDateParts !== null && parsed.explicitDateParts !== undefined && !explicitDateParts) {
    return null;
  }

  const explicitTimeParts = parsed.explicitTimeParts === null || parsed.explicitTimeParts === undefined
    ? null
    : isValidTimeParts(parsed.explicitTimeParts) ? parsed.explicitTimeParts : null;
  if (
    parsed.explicitTimeParts !== null &&
    parsed.explicitTimeParts !== undefined &&
    (!explicitTimeParts || !hasClockExpression(expression ?? ""))
  ) {
    return null;
  }

  const relativeDayOffset = parsed.relativeDayOffset === null || parsed.relativeDayOffset === undefined
    ? null
    : isInteger(parsed.relativeDayOffset) ? parsed.relativeDayOffset : null;
  if (parsed.relativeDayOffset !== null && parsed.relativeDayOffset !== undefined && relativeDayOffset === null) {
    return null;
  }
  const relativeAmount = parsed.relativeAmount === null || parsed.relativeAmount === undefined
    ? null
    : typeof parsed.relativeAmount === "number" && Number.isFinite(parsed.relativeAmount) && parsed.relativeAmount > 0
      ? parsed.relativeAmount
      : null;
  const relativeUnit = parsed.relativeUnit === null || parsed.relativeUnit === undefined
    ? null
    : isEnumValue(parsed.relativeUnit, ["minutes", "hours", "days"] as const)
      ? parsed.relativeUnit
      : null;
  if (
    parsed.relativeAmount !== null &&
    parsed.relativeAmount !== undefined &&
    (relativeAmount === null || !relativeUnit || !hasNumericDuration(expression ?? ""))
  ) {
    return null;
  }

  return {
    temporalExpression: expression,
    temporalKind: kind,
    temporalPrecision: precision,
    weekday,
    relativeDayOffset,
    relativeAmount,
    relativeUnit,
    explicitDateParts,
    explicitTimeParts,
    daypart,
    rangeKind,
    explicitTimezone,
    temporalConfidence: confidence,
  };
}

function getDateTimeParts(instant: Date, timeZone: string): LocalDateTime | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "iso8601",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const result = {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
    };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return null;
  }
}

function getWeekdayIndex(instant: Date, timeZone: string) {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
    }).format(instant).toLowerCase();
    const index = WEEKDAYS.indexOf(weekday as TemporalWeekday);
    return index === -1 ? null : index;
  } catch {
    return null;
  }
}

function getTimeZone(value: string | null): ResolvedTimeZone | null {
  if (!value) return { name: TIBO_SOURCE_TIME_ZONE };
  const normalized = value.trim();
  const aliases: Record<string, string> = {
    PT: "America/Los_Angeles",
    "PACIFIC TIME": "America/Los_Angeles",
    ET: "America/New_York",
    "EASTERN TIME": "America/New_York",
    UTC: "UTC",
    GMT: "UTC",
  };
  const alias = aliases[normalized.toUpperCase()];
  if (alias) return { name: alias };
  const fixedOffset = normalized.match(/^(PDT|PST|EDT|EST)$/i);
  if (fixedOffset) {
    const offsets: Record<string, number> = { PDT: -420, PST: -480, EDT: -240, EST: -300 };
    return { name: normalized.toUpperCase(), offsetMinutes: offsets[normalized.toUpperCase()] };
  }
  const explicitOffset = normalized.match(/^UTC([+-])(\d{2}):(\d{2})$/i);
  if (explicitOffset) {
    const minutes = Number(explicitOffset[2]) * 60 + Number(explicitOffset[3]);
    return { name: normalized.toUpperCase(), offsetMinutes: explicitOffset[1] === "+" ? minutes : -minutes };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
    return { name: normalized };
  } catch {
    return null;
  }
}

function sameLocalDateTime(left: LocalDateTime | null, right: LocalDateTime) {
  return Boolean(
    left &&
      left.year === right.year &&
      left.month === right.month &&
      left.day === right.day &&
      left.hour === right.hour &&
      left.minute === right.minute,
  );
}

/** Return one instant only; DST gaps and overlaps are intentionally unresolved. */
function localDateTimeToInstant(local: LocalDateTime, timeZone: ResolvedTimeZone) {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  if (timeZone.offsetMinutes !== undefined) {
    return new Date(naive - timeZone.offsetMinutes * MINUTE_MS);
  }

  const candidates: number[] = [];
  for (let offset = -36 * HOUR_MS; offset <= 36 * HOUR_MS; offset += MINUTE_MS) {
    const candidate = naive + offset;
    if (sameLocalDateTime(getDateTimeParts(new Date(candidate), timeZone.name), local)) {
      candidates.push(candidate);
      if (candidates.length > 1) return null;
    }
  }
  return candidates.length === 1 ? new Date(candidates[0]) : null;
}

function addLocalDays(local: LocalDateTime, days: number): LocalDateTime {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: local.hour,
    minute: local.minute,
  };
}

function atLocalTime(local: LocalDateTime, hour: number, minute = 0): LocalDateTime {
  return { ...local, hour, minute };
}

function resolveWeekdayDate(
  createdLocal: LocalDateTime,
  createdWeekday: number,
  targetWeekday: TemporalWeekday,
  expression: string,
  explicitTimeParts: TemporalTimeParts | null,
) {
  const target = WEEKDAYS.indexOf(targetWeekday);
  const lower = expression.toLowerCase();
  if (lower.includes("next ")) {
    const currentWeekMonday = addLocalDays(createdLocal, -createdWeekday);
    return addLocalDays(currentWeekMonday, 7 + target);
  }
  if (lower.includes("this ")) {
    const currentWeekMonday = addLocalDays(createdLocal, -createdWeekday);
    const result = addLocalDays(currentWeekMonday, target);
    return result;
  }
  const delta = (target - createdWeekday + 7) % 7;
  if (delta === 0) {
    if (!explicitTimeParts) return null;
    const createdMinutes = createdLocal.hour * 60 + createdLocal.minute;
    const targetMinutes = explicitTimeParts.hour * 60 + explicitTimeParts.minute;
    return targetMinutes > createdMinutes
      ? createdLocal
      : addLocalDays(createdLocal, 7);
  }
  return addLocalDays(createdLocal, delta);
}

function resolveDay(
  semantics: TiboTemporalSemantics,
  createdLocal: LocalDateTime,
  createdWeekday: number,
) {
  const expression = semantics.temporalExpression ?? "";
  const lower = expression.toLowerCase();
  if (lower.includes("tomorrow")) return addLocalDays(createdLocal, 1);
  if (lower.includes("today")) return createdLocal;
  if (semantics.weekday) {
    return resolveWeekdayDate(
      createdLocal,
      createdWeekday,
      semantics.weekday,
      expression,
      semantics.explicitTimeParts,
    );
  }
  if (semantics.relativeDayOffset !== null) return addLocalDays(createdLocal, semantics.relativeDayOffset);
  return null;
}

function startOfIsoWeek(local: LocalDateTime) {
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  return addLocalDays(local, -mondayOffset);
}

function buildWindow(
  start: LocalDateTime,
  end: LocalDateTime,
  timeZone: ResolvedTimeZone,
) {
  const expectedStart = localDateTimeToInstant(start, timeZone);
  const expectedEnd = localDateTimeToInstant(end, timeZone);
  if (!expectedStart || !expectedEnd || expectedEnd.getTime() <= expectedStart.getTime()) return null;
  return { expectedStart, expectedEnd };
}

function rejected(semantics: TiboTemporalSemantics): TiboTemporalResolution {
  return {
    status: "rejected",
    version: TIBO_TEMPORAL_RESOLUTION_VERSION,
    temporalExpression: semantics.temporalExpression,
    temporalKind: semantics.temporalKind,
    temporalPrecision: semantics.temporalPrecision,
    timezone: null,
    confidence: semantics.temporalConfidence,
    expectedStartAt: null,
    expectedEndAt: null,
  };
}

export function unresolvedTemporal(
  semantics: Partial<TiboTemporalSemantics> | null = null,
): TiboTemporalResolution {
  return {
    status: "unresolved",
    version: TIBO_TEMPORAL_RESOLUTION_VERSION,
    temporalExpression: typeof semantics?.temporalExpression === "string" ? semantics.temporalExpression : null,
    temporalKind: isEnumValue(semantics?.temporalKind, TEMPORAL_KINDS) ? semantics.temporalKind : "none",
    temporalPrecision: isEnumValue(semantics?.temporalPrecision, TEMPORAL_PRECISIONS) ? semantics.temporalPrecision : "unknown",
    timezone: null,
    confidence: typeof semantics?.temporalConfidence === "number" ? semantics.temporalConfidence : null,
    expectedStartAt: null,
    expectedEndAt: null,
  };
}

export function resolveTiboTemporalSchedule(
  semantics: TiboTemporalSemantics | null,
  tweetCreatedAt: string,
  sourceTimeZone = TIBO_SOURCE_TIME_ZONE,
): TiboTemporalResolution {
  if (!semantics || semantics.temporalKind === "none" || semantics.temporalKind === "vague") {
    return unresolvedTemporal(semantics);
  }
  if (semantics.temporalConfidence < 0.85 || !semantics.temporalExpression) {
    return unresolvedTemporal(semantics);
  }

  const created = new Date(tweetCreatedAt);
  if (!Number.isFinite(created.getTime())) return rejected(semantics);
  const timeZone = getTimeZone(semantics.explicitTimezone ?? sourceTimeZone);
  if (!timeZone) return unresolvedTemporal(semantics);
  const createdLocal = timeZone.offsetMinutes === undefined
    ? getDateTimeParts(created, timeZone.name)
    : getDateTimeParts(
        new Date(created.getTime() + timeZone.offsetMinutes * MINUTE_MS),
        "UTC",
      );
  const createdWeekday = getWeekdayIndex(created, timeZone.offsetMinutes === undefined ? timeZone.name : "UTC");
  if (!createdLocal || createdWeekday === null) return rejected(semantics);

  let expectedStart: Date | null = null;
  let expectedEnd: Date | null = null;
  let precision = semantics.temporalPrecision;
  let unresolvedInterpretation = false;

  if (semantics.temporalKind === "relative_duration" && semantics.relativeAmount && semantics.relativeUnit) {
    if (semantics.relativeUnit === "days") {
      const localDay = addLocalDays(createdLocal, Math.round(semantics.relativeAmount));
      const window = buildWindow(atLocalTime(localDay, 0), atLocalTime(addLocalDays(localDay, 1), 0), timeZone);
      expectedStart = window?.expectedStart ?? null;
      expectedEnd = window?.expectedEnd ?? null;
      precision = "day";
    } else {
      const duration = semantics.relativeAmount * (semantics.relativeUnit === "hours" ? HOUR_MS : MINUTE_MS);
      expectedStart = new Date(created.getTime() + duration);
      expectedEnd = expectedStart;
      precision = "exact_time";
    }
  } else if (semantics.temporalKind === "absolute" && semantics.explicitDateParts) {
    const year = semantics.explicitDateParts.year ?? createdLocal.year;
    let date = { ...createdLocal, year, month: semantics.explicitDateParts.month, day: semantics.explicitDateParts.day };
    if (date.year === createdLocal.year && Date.UTC(date.year, date.month - 1, date.day) < Date.UTC(createdLocal.year, createdLocal.month - 1, createdLocal.day)) {
      date = { ...date, year: date.year + 1 };
    }
    if (semantics.explicitTimeParts) {
      expectedStart = localDateTimeToInstant({ ...date, ...semantics.explicitTimeParts }, timeZone);
      expectedEnd = expectedStart;
      precision = "exact_time";
    } else {
      const window = buildWindow(atLocalTime(date, 0), atLocalTime(addLocalDays(date, 1), 0), timeZone);
      expectedStart = window?.expectedStart ?? null;
      expectedEnd = window?.expectedEnd ?? null;
      precision = "day";
    }
  } else if (semantics.temporalKind === "range" && semantics.rangeKind) {
    const weekStart = startOfIsoWeek(createdLocal);
    const start = semantics.rangeKind === "this_weekend"
      ? addLocalDays(weekStart, 5)
      : semantics.rangeKind === "next_week"
        ? addLocalDays(weekStart, 7)
        : weekStart;
    const end = semantics.rangeKind === "this_weekend"
      ? addLocalDays(weekStart, 7)
      : addLocalDays(start, 7);
    const window = buildWindow(atLocalTime(start, 0), atLocalTime(end, 0), timeZone);
    expectedStart = window?.expectedStart ?? null;
    expectedEnd = window?.expectedEnd ?? null;
    precision = "range";
  } else {
    const day = resolveDay(semantics, createdLocal, createdWeekday);
    if (day && semantics.temporalKind === "daypart" && semantics.daypart) {
      const [startHour, endHour] = TIBO_DAYPARTS[semantics.daypart];
      const endDay = endHour === 24 ? addLocalDays(day, 1) : day;
      const window = buildWindow(atLocalTime(day, startHour), atLocalTime(endDay, endHour === 24 ? 0 : endHour), timeZone);
      expectedStart = window?.expectedStart ?? null;
      expectedEnd = window?.expectedEnd ?? null;
      precision = "daypart";
    } else if (day && semantics.temporalKind === "weekday") {
      if (semantics.explicitTimeParts) {
        expectedStart = localDateTimeToInstant({ ...day, ...semantics.explicitTimeParts }, timeZone);
        expectedEnd = expectedStart;
        precision = "exact_time";
      } else {
        const window = buildWindow(atLocalTime(day, 0), atLocalTime(addLocalDays(day, 1), 0), timeZone);
        expectedStart = window?.expectedStart ?? null;
        expectedEnd = window?.expectedEnd ?? null;
        precision = "day";
      }
    } else if (day && semantics.temporalKind === "relative_day") {
      if (semantics.explicitTimeParts) {
        expectedStart = localDateTimeToInstant({ ...day, ...semantics.explicitTimeParts }, timeZone);
        expectedEnd = expectedStart;
        precision = "exact_time";
      } else {
        const window = buildWindow(atLocalTime(day, 0), atLocalTime(addLocalDays(day, 1), 0), timeZone);
        expectedStart = window?.expectedStart ?? null;
        expectedEnd = window?.expectedEnd ?? null;
        precision = "day";
      }
    } else {
      unresolvedInterpretation = true;
    }
  }

  if (!expectedStart || !expectedEnd) {
    return unresolvedInterpretation ? unresolvedTemporal(semantics) : rejected(semantics);
  }
  return {
    status: "resolved",
    version: TIBO_TEMPORAL_RESOLUTION_VERSION,
    temporalExpression: semantics.temporalExpression,
    temporalKind: semantics.temporalKind,
    temporalPrecision: precision,
    timezone: timeZone.name,
    confidence: semantics.temporalConfidence,
    expectedStartAt: expectedStart.toISOString(),
    expectedEndAt: expectedEnd.toISOString(),
  };
}

export function getTemporalNoticeExpiry(resolution: TiboTemporalResolution, fallbackCreatedAt: string) {
  if (resolution.status !== "resolved") {
    const created = new Date(fallbackCreatedAt);
    return Number.isFinite(created.getTime())
      ? new Date(created.getTime() + 24 * HOUR_MS).toISOString()
      : null;
  }
  const end = resolution.expectedEndAt
    ? new Date(resolution.expectedEndAt)
    : resolution.expectedStartAt
      ? new Date(resolution.expectedStartAt)
      : null;
  return end && Number.isFinite(end.getTime())
    ? new Date(end.getTime() + TIBO_NOTICE_GRACE_MS).toISOString()
    : null;
}

export function getTemporalNoticeCoverage(
  resolution: Pick<TiboTemporalResolution, "status" | "temporalPrecision" | "confidence" | "expectedStartAt" | "expectedEndAt"> | null | undefined,
  now: Date,
  horizonHours: number,
) {
  if (!resolution || resolution.status !== "resolved" || !Number.isFinite(horizonHours) || horizonHours <= 0) return null;
  const nowTime = now.getTime();
  const start = resolution.expectedStartAt ? Date.parse(resolution.expectedStartAt) : Number.NaN;
  const end = resolution.expectedEndAt ? Date.parse(resolution.expectedEndAt) : start;
  if (!Number.isFinite(nowTime) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  if (resolution.temporalPrecision === "exact_time") {
    const distance = start - nowTime;
    return distance >= 0 && distance <= horizonHours * HOUR_MS ? 1 : 0;
  }
  const remainingStart = Math.max(nowTime, start);
  const remainingDuration = end - remainingStart;
  if (remainingDuration <= 0) return 0;
  const intersection = Math.max(0, Math.min(nowTime + horizonHours * HOUR_MS, end) - remainingStart);
  const confidence = typeof resolution.confidence === "number" && Number.isFinite(resolution.confidence)
    ? Math.min(1, Math.max(0, resolution.confidence))
    : 0;
  return Math.min(1, Math.max(0, (intersection / remainingDuration) * confidence));
}

export function isTemporalNoticeConsumedAtReset(
  resolution: Pick<TiboTemporalResolution, "status" | "temporalPrecision" | "expectedStartAt" | "expectedEndAt"> | null | undefined,
  resetAt: string | Date | null | undefined,
) {
  if (!resetAt) return false;
  const resetTime = resetAt instanceof Date ? resetAt.getTime() : Date.parse(resetAt);
  if (!Number.isFinite(resetTime)) return false;
  if (
    !resolution ||
    resolution.status !== "resolved" ||
    !resolution.expectedStartAt ||
    !Number.isFinite(Date.parse(resolution.expectedStartAt))
  ) {
    return true;
  }

  const expectedStart = Date.parse(resolution.expectedStartAt);
  const expectedEnd = resolution.expectedEndAt ? Date.parse(resolution.expectedEndAt) : expectedStart;
  if (!Number.isFinite(expectedEnd) || resetTime < expectedStart) return false;
  if (resolution.temporalPrecision === "exact_time") {
    return Math.abs(resetTime - expectedStart) <= TIBO_NOTICE_GRACE_MS;
  }
  return resetTime <= expectedEnd;
}
