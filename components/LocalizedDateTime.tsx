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

function formatDateTimeInZone(date: Date, timeZone: string, localeStr: string) {
  const formatted = new Intl.DateTimeFormat(localeStr, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  }).format(date);

  if (timeZone === DISPLAY_TIME_ZONE && !/\bJST\b/.test(formatted)) {
    return `${formatted} JST`;
  }

  return formatted;
}
