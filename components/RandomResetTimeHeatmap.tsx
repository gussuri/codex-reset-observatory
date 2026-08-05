"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/radar/types";
import {
  buildRandomResetTimeHeatmap,
  formatHeatmapBarLabel,
  formatHeatmapAxisLabel,
  getRawBarHeightPercent,
} from "@/lib/radar/resetTimeHeatmap";
import { getBrowserTimeZone, getTimeZoneLabel } from "./LocalizedDateTime";

const CONTENT = {
  ja: {
    heading: "過去のランダムリセット時刻",
    description: "過去のランダムリセット時刻を2時間ごとに集計しています。",
    timezone: "閲覧者のタイムゾーン",
    count: "対象件数",
    empty: "対象となる記録はありません。",
    ariaBusy: "過去のランダムリセット時刻を読み込んでいます",
  },
  en: {
    heading: "Past random reset times",
    description: "Past random reset times are grouped into two-hour intervals.",
    timezone: "Viewer time zone",
    count: "Recorded events",
    empty: "No matching records are available.",
    ariaBusy: "Loading past random reset times",
  },
  zh: {
    heading: "过去的随机重置时刻",
    description: "过去的随机重置时刻按每两小时汇总。",
    timezone: "查看者时区",
    count: "记录数量",
    empty: "没有可用的匹配记录。",
    ariaBusy: "正在加载过去的随机重置时间",
  },
} satisfies Record<Locale, Record<string, string>>;

export function RandomResetTimeHeatmap({
  eventTimes,
  locale,
}: {
  eventTimes: string[];
  locale: Locale;
}) {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const content = CONTENT[locale];

  useEffect(() => {
    setTimeZone(getBrowserTimeZone());
  }, []);

  const heatmap = useMemo(
    () => (timeZone ? buildRandomResetTimeHeatmap(eventTimes, timeZone) : null),
    [eventTimes, timeZone],
  );
  const maxRawCount = heatmap
    ? Math.max(...heatmap.bins.map((item) => item.rawCount))
    : 0;
  const barScaleMax = maxRawCount > 0 ? maxRawCount + 1 : 0;

  return (
    <section
      aria-busy={!heatmap}
      aria-label={content.heading}
      className="rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">
            {content.heading}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{content.description}</p>
        </div>
        <div className="shrink-0 text-right text-xs leading-5 text-slate-500">
          <p>{content.count}: n={heatmap?.totalCount ?? "…"}</p>
          {timeZone ? (
            <p>
              {content.timezone}: {timeZone} ({getTimeZoneLabel(new Date(), timeZone)})
            </p>
          ) : null}
        </div>
      </div>

      {!heatmap ? (
        <div className="mt-5" role="status" aria-label={content.ariaBusy}>
          <div className="grid grid-cols-12 gap-1" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <span
                className="block aspect-[1.35] min-w-0 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none"
                key={index}
              />
            ))}
          </div>
        </div>
      ) : heatmap.totalCount === 0 ? (
        <p className="mt-5 text-sm text-slate-600">{content.empty}</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-12 gap-1.5" role="list" aria-label={content.heading}>
            {heatmap.bins.map((bin) => {
              const label = formatHeatmapBarLabel(bin, locale);
              const barHeight = getRawBarHeightPercent(bin.rawCount, barScaleMax);

              return (
                <div className="min-w-0 text-center" key={bin.startHour} role="listitem">
                  <div className="mb-1 h-4 text-[0.65rem] font-semibold tabular-nums text-slate-700">
                    {bin.rawCount}
                  </div>
                  <div
                    aria-label={label}
                    className="flex h-28 min-w-0 items-end justify-center px-0.5 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
                    role="img"
                    tabIndex={0}
                    title={label}
                  >
                    <span
                      aria-hidden="true"
                      className="w-3/4 rounded-t bg-teal-600 text-center text-[0.65rem] font-semibold tabular-nums text-white"
                      style={{ height: `${barHeight}%` }}
                    />
                  </div>
                  <div className="mt-1 text-center text-[0.65rem] font-medium tabular-nums text-slate-500">
                    {formatHeatmapAxisLabel(bin)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

    </section>
  );
}
