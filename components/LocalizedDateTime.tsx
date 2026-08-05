"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/radar/types";
import { DISPLAY_TIME_ZONE } from "@/lib/radar/helpers";

type LocalizedDateTimeProps = {
  value: string | null | undefined;
  locale?: Locale;
  className?: string;
};

export function LocalizedDateTime({ value, locale = "ja", className }: LocalizedDateTimeProps) {
  // JST is deterministic during SSR and the first hydration render. The
  // browser timezone is applied only after hydration to avoid a mismatch.
  const [timeZone, setTimeZone] = useState(DISPLAY_TIME_ZONE);
  const date = useMemo(() => parseDate(value), [value]);

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || DISPLAY_TIME_ZONE);
  }, []);

  if (!value) {
    const unknownLabel = locale === "en" ? "Unknown" : locale === "zh" ? "未知" : "不明";
    return <span className={className}>{unknownLabel}</span>;
  }

  if (!date) {
    return <span className={className}>{value}</span>;
  }

  const formatLocale = locale === "en" ? "en-US" : locale === "zh" ? "zh-CN" : "ja-JP";
  const local = formatDateTimeInZone(date, timeZone, formatLocale);
  const classes = ["inline-flex", "flex-col", className]
    .filter((item): item is string => Boolean(item))
    .join(" ");

  return (
    <span className={classes}>
      <time
        dateTime={date.toISOString()}
        className="block font-bold leading-tight text-slate-900"
      >
        {local}
      </time>
    </span>
  );
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTimeInZone(date: Date, timeZone: string, localeStr: string) {
  const safeTimeZone = getSafeTimeZone(timeZone);
  const formatted = new Intl.DateTimeFormat(localeStr, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: localeStr === "en-US",
    timeZone: safeTimeZone,
  }).format(date);

  return `${formatted} ${getTimeZoneLabel(date, safeTimeZone)}`;
}

export function getTimeZoneLabel(date: Date, timeZone: string) {
  const safeTimeZone = getSafeTimeZone(timeZone);

  if (safeTimeZone === DISPLAY_TIME_ZONE) {
    return "JST";
  }

  if (safeTimeZone === "Asia/Seoul") {
    return "KST";
  }

  if (safeTimeZone === "UTC" || safeTimeZone === "Etc/UTC") {
    return "UTC";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? safeTimeZone;
}

function getSafeTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return DISPLAY_TIME_ZONE;
  }
}
