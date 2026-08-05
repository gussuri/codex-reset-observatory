"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/radar/types";
import {
  buildRandomResetTimeHeatmap,
  formatHeatmapTimeRange,
} from "@/lib/radar/resetTimeHeatmap";
import { getBrowserTimeZone, getTimeZoneLabel } from "./LocalizedDateTime";

const CONTENT = {
  ja: {
    heading: "過去のランダムリセット実施時刻",
    description: "記録されたランダムリセットの実施・発表時刻を、現在のタイムゾーンで集計した参考分布です。最近の記録ほど重く反映しています。",
    note: "実際のシステム実行時刻ではなく、完了が確認・発表された時刻を含む場合があります。",
    timezone: "閲覧者のタイムゾーン",
    count: "対象件数",
    low: "少ない",
    high: "多い",
    rawCount: "生の件数",
    weightedShare: "重み付き構成比",
    empty: "対象となる記録はありません。",
    ariaBusy: "過去のランダムリセット時刻を読み込んでいます",
  },
  en: {
    heading: "Past random reset times",
    description: "A reference distribution of recorded random reset completion and announcement times in your current time zone. Recent records receive more weight.",
    note: "Some records may reflect when completion was confirmed or announced rather than the exact backend execution time.",
    timezone: "Viewer time zone",
    count: "Recorded events",
    low: "Less",
    high: "More",
    rawCount: "Raw count",
    weightedShare: "Weighted share",
    empty: "No matching records are available.",
    ariaBusy: "Loading past random reset times",
  },
  zh: {
    heading: "过去的随机重置执行时间",
    description: "按您当前时区汇总已记录的随机重置完成或公布时间，作为参考分布。较新的记录权重更高。",
    note: "部分记录反映的是确认完成或公布的时间，可能不是后端实际执行的精确时间。",
    timezone: "查看者时区",
    count: "记录数量",
    low: "少",
    high: "多",
    rawCount: "原始数量",
    weightedShare: "加权构成比",
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
  const maxWeighted = heatmap
    ? Math.max(...heatmap.bins.map((item) => item.weightedCount))
    : 0;

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
              const intensity = maxWeighted > 0 ? bin.weightedCount / maxWeighted : 0;
              const share = `${(bin.weightedShare * 100).toFixed(1)}%`;
              const range = formatHeatmapTimeRange(bin, locale);
              const label = locale === "en"
                ? `${range}, raw count ${bin.rawCount}, weighted share ${share}`
                : locale === "zh"
                  ? `${range}，原始数量${bin.rawCount}，加权构成比${share}`
                  : `${range}、${content.rawCount}${bin.rawCount}件、${content.weightedShare}${share}`;

              return (
                <div className="min-w-0" key={bin.startHour} role="listitem">
                  <div className="mb-1 text-center text-[0.65rem] font-medium tabular-nums text-slate-500">
                    {String(bin.startHour).padStart(2, "0")}
                  </div>
                  <div
                    aria-label={label}
                    className={`flex aspect-[1.35] min-w-0 items-center justify-center rounded border border-teal-900/10 px-0.5 text-[0.65rem] font-semibold tabular-nums outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ${intensity >= 0.55 ? "text-white" : "text-teal-950"}`}
                    role="img"
                    style={{ backgroundColor: `rgba(13, 148, 136, ${0.12 + intensity * 0.78})` }}
                    tabIndex={0}
                    title={label}
                  >
                    {bin.rawCount}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-teal-100" />
              {content.low}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {content.high}
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-teal-700" />
            </span>
          </div>
        </>
      )}

      <p className="mt-4 text-xs leading-5 text-slate-500">{content.note}</p>
    </section>
  );
}
