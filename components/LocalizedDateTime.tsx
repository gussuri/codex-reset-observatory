"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/radar/types";

type LocalizedDateTimeProps = {
  value: string | null | undefined;
  locale?: Locale;
  className?: string;
};

export function LocalizedDateTime({ value, locale = "ja", className }: LocalizedDateTimeProps) {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const date = useMemo(() => parseDate(value), [value]);

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null);
  }, []);

  if (!value) {
    const unknownLabel = locale === "en" ? "Unknown" : locale === "zh" ? "未知" : "不明";
    return <span className={className}>{unknownLabel}</span>;
  }

  if (!date) {
    return <span className={className}>{value}</span>;
  }

  const formatLocale = locale === "en" ? "en-US" : locale === "zh" ? "zh-CN" : "ja-JP";
  const utc = formatDateTimeInZone(date, "UTC", formatLocale);
  const local = timeZone ? formatDateTimeInZone(date, timeZone, formatLocale) : null;

  const localLabel = locale === "en" ? "Local" : locale === "zh" ? "本地时间" : "現地時間";
  const detectingLabel = locale === "en" ? "Detecting time zone..." : locale === "zh" ? "正在检测时区..." : "タイムゾーンを検出中...";

  return (
    <span className={className}>
      <span className="block">UTC: {utc}</span>
      <span className="block">
        {localLabel}: {local ?? detectingLabel}
        {timeZone ? ` (${timeZone})` : ""}
      </span>
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
  return new Intl.DateTimeFormat(localeStr, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}
