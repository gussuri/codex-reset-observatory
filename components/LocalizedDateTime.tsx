"use client";

import { useEffect, useMemo, useState } from "react";

type LocalizedDateTimeProps = {
  value: string | null | undefined;
  className?: string;
};

export function LocalizedDateTime({ value, className }: LocalizedDateTimeProps) {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const date = useMemo(() => parseDate(value), [value]);

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null);
  }, []);

  if (!value) {
    return <span className={className}>Unknown</span>;
  }

  if (!date) {
    return <span className={className}>{value}</span>;
  }

  const utc = formatDateTimeInZone(date, "UTC");
  const local = timeZone ? formatDateTimeInZone(date, timeZone) : null;

  return (
    <span className={className}>
      <span className="block">UTC: {utc}</span>
      <span className="block">
        Local: {local ?? "Detecting time zone..."}
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

function formatDateTimeInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}
