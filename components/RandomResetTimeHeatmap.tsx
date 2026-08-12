"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/radar/types";
import {
  buildRandomResetIntervalDistribution,
  buildRandomResetTimeHeatmap,
  buildRandomResetWeekdayDistribution,
  filterHeatmapEventTimes,
  formatHeatmapBarLabel,
  formatHeatmapWeekdayBarLabel,
  formatHeatmapWeekdayLabel,
  formatRandomResetIntervalBarLabel,
  formatRandomResetIntervalBinLabel,
  formatRandomResetDuration,
  getHeatmapTimeAxisTicks,
  getRawBarHeightPercent,
  RANDOM_RESET_INTERVAL_BIN_COUNT,
} from "@/lib/radar/resetTimeHeatmap";
import type {
  RandomResetIntervalDistribution,
  RandomResetTimeHeatmapRange,
} from "@/lib/radar/resetTimeHeatmap";
import { getBrowserTimeZone, getTimeZoneLabel } from "./LocalizedDateTime";

const CONTENT = {
  ja: {
    heading: "過去のランダムリセット時刻",
    description: "過去のランダムリセット時刻を2時間ごとに集計しています。",
    timezone: "タイムゾーン",
    timeAxis: "時刻",
    period: "集計期間",
    allPeriod: "全期間",
    lastMonth: "直近1か月",
    weekdayHeading: "過去のランダムリセット曜日",
    weekdayDescription: "過去のランダムリセットが実施された曜日を集計しています。",
    intervalHeading: "過去のランダムリセット間隔",
    intervalDescription: "過去のランダムリセットどうしの間隔を集計しています。前回のランダムリセットから次のランダムリセットまでの経過時間です。",
    intervalCount: "間隔件数",
    median: "中央値",
    average: "平均",
    shortest: "最短",
    longest: "最長",
    intervalEmpty: "この期間では、ランダムリセット間隔を集計できる記録がありません。",
    count: "対象件数",
    empty: "対象となる記録はありません。",
    ariaBusy: "過去のランダムリセット時刻・曜日・間隔を読み込んでいます",
  },
  en: {
    heading: "Past random reset times",
    description: "Past random reset times are grouped into two-hour intervals.",
    timezone: "Time zone",
    timeAxis: "Time",
    period: "Time range",
    allPeriod: "All time",
    lastMonth: "Last month",
    weekdayHeading: "Past random reset weekdays",
    weekdayDescription: "Past random reset records are grouped by day of the week.",
    intervalHeading: "Past random reset intervals",
    intervalDescription: "Past intervals between consecutive random resets are grouped by elapsed time. Each interval runs from one random reset to the next.",
    intervalCount: "Intervals",
    median: "Median",
    average: "Average",
    shortest: "Shortest",
    longest: "Longest",
    intervalEmpty: "There are not enough matching records to calculate random reset intervals for this range.",
    count: "Recorded events",
    empty: "No matching records are available.",
    ariaBusy: "Loading past random reset times, weekdays, and intervals",
  },
  zh: {
    heading: "过去的随机重置时刻",
    description: "过去的随机重置时刻按每两小时汇总。",
    timezone: "时区",
    timeAxis: "时间",
    period: "统计期间",
    allPeriod: "全部期间",
    lastMonth: "最近1个月",
    weekdayHeading: "过去的随机重置星期几",
    weekdayDescription: "按星期几汇总过去的随机重置记录。",
    intervalHeading: "过去的随机重置间隔",
    intervalDescription: "按经过时间汇总连续两次随机重置之间的间隔。每个间隔从一次随机重置到下一次随机重置。",
    intervalCount: "间隔数",
    median: "中位数",
    average: "平均",
    shortest: "最短",
    longest: "最长",
    intervalEmpty: "此期间没有足够的匹配记录可用于统计随机重置间隔。",
    count: "记录数量",
    empty: "没有可用的匹配记录。",
    ariaBusy: "正在加载过去的随机重置时刻、星期和间隔",
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
  const [range, setRange] = useState<RandomResetTimeHeatmapRange>("lastMonth");
  const content = CONTENT[locale];

  useEffect(() => {
    setTimeZone(getBrowserTimeZone());
  }, []);

  const heatmap = useMemo(
    () => {
      if (!timeZone) return null;
      const now = Date.now();
      const visibleEventTimes = filterHeatmapEventTimes(eventTimes, range, now);
      return {
        time: buildRandomResetTimeHeatmap(visibleEventTimes, timeZone, now),
        weekday: buildRandomResetWeekdayDistribution(visibleEventTimes, timeZone, now),
        interval: buildRandomResetIntervalDistribution(eventTimes, range, now),
      };
    },
    [eventTimes, range, timeZone],
  );
  const timeHeatmap = heatmap?.time ?? null;
  const weekdayDistribution = heatmap?.weekday ?? null;
  const intervalDistribution = heatmap?.interval ?? null;
  const maxRawCount = timeHeatmap
    ? Math.max(...timeHeatmap.bins.map((item) => item.rawCount))
    : 0;
  const weekdayMaxRawCount = weekdayDistribution
    ? Math.max(...weekdayDistribution.bins.map((item) => item.rawCount))
    : 0;
  const timeBarScaleMax = maxRawCount > 0 ? maxRawCount + 1 : 0;
  const weekdayBarScaleMax = weekdayMaxRawCount > 0 ? weekdayMaxRawCount + 1 : 0;
  const intervalMaxRawCount = intervalDistribution
    ? Math.max(...intervalDistribution.bins.map((item) => item.rawCount))
    : 0;
  const intervalBarScaleMax = intervalMaxRawCount > 0 ? intervalMaxRawCount + 1 : 0;
  const timeAxisTicks = getHeatmapTimeAxisTicks();

  return (
    <section
      aria-busy={!heatmap}
      aria-label={content.heading}
      className="min-w-0 rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">
            {content.heading}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{content.description}</p>
        </div>
        <div className="flex max-w-full shrink-0 flex-col items-end gap-2 text-right text-xs leading-5 text-slate-500">
          <p>{content.count}: n={timeHeatmap?.totalCount ?? "…"}</p>
          {timeZone ? (
            <p>
              {content.timezone}: {timeZone} ({getTimeZoneLabel(new Date(), timeZone)})
            </p>
          ) : null}
          <div className="flex max-w-full flex-wrap justify-end gap-1" role="group" aria-label={content.period}>
            {([
              ["all", content.allPeriod],
              ["lastMonth", content.lastMonth],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={range === value}
                className={`rounded border px-2 py-1 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ${
                  range === value
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700"
                }`}
                key={value}
                onClick={() => setRange(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!heatmap ? (
        <div className="mt-5 space-y-5" role="status" aria-label={content.ariaBusy}>
          <div className="grid grid-cols-12 gap-1" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <span
                className="block aspect-[1.35] min-w-0 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none"
                key={index}
              />
            ))}
          </div>
          <div className="border-t border-slate-100 pt-5">
            <h2 className="text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">
              {content.weekdayHeading}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{content.weekdayDescription}</p>
            <div className="mt-4 grid grid-cols-7 gap-1" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => (
                <span
                  className="block aspect-[1.35] min-w-0 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none"
                  key={index}
                />
              ))}
            </div>
          </div>
          <div className="border-t border-slate-100 pt-5">
            <h2 className="text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">
              {content.intervalHeading}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{content.intervalDescription}</p>
            <div className="mt-4 grid grid-cols-8 gap-1" aria-hidden="true">
              {Array.from({ length: RANDOM_RESET_INTERVAL_BIN_COUNT }, (_, index) => (
                <span
                  className="block aspect-[1.35] min-w-0 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none"
                  key={index}
                />
              ))}
            </div>
          </div>
        </div>
      ) : timeHeatmap?.totalCount === 0 ? (
        <>
          <p className="mt-5 text-sm text-slate-600">{content.empty}</p>
          {intervalDistribution ? (
            <RandomResetIntervalSection
              barScaleMax={intervalBarScaleMax}
              content={content}
              distribution={intervalDistribution}
              locale={locale}
            />
          ) : null}
        </>
      ) : (
        <>
          <div className="mt-5 min-w-0">
            <div className="grid h-32 grid-cols-12 sm:h-28" role="list" aria-label={content.heading}>
              {(timeHeatmap?.bins ?? []).map((bin) => {
                const label = formatHeatmapBarLabel(bin, locale);
                const barHeight = getRawBarHeightPercent(bin.rawCount, timeBarScaleMax);

                return (
                  <div className="min-w-0 px-0.5 sm:px-1" key={bin.startHour} role="listitem">
                    <ResetCountBar
                      ariaLabel={label}
                      barHeight={barHeight}
                      rawCount={bin.rawCount}
                    />
                  </div>
                );
              })}
            </div>
            <div aria-hidden="true" className="relative h-7 border-t border-slate-200">
              {timeAxisTicks.map((hour, index) => {
                const isFirst = index === 0;
                const isLast = index === timeAxisTicks.length - 1;
                const position = isFirst
                  ? "left-0 items-start"
                  : isLast
                    ? "right-0 items-end"
                    : "-translate-x-1/2 items-center";

                return (
                  <span
                    className={`absolute top-0 flex flex-col gap-0.5 text-[0.7rem] font-medium leading-none tabular-nums text-slate-500 sm:text-[0.65rem] ${position}`}
                    key={hour}
                    style={
                      isFirst || isLast
                        ? undefined
                        : { left: `${(index / (timeAxisTicks.length - 1)) * 100}%` }
                    }
                  >
                    <span aria-hidden="true" className="h-1.5 border-l border-slate-300" />
                    <span>{hour}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <p aria-hidden="true" className="mt-1 text-center text-xs font-medium text-slate-500">{content.timeAxis}</p>
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h2 className="text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">
              {content.weekdayHeading}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{content.weekdayDescription}</p>
            <div className="mt-4 grid grid-cols-7 gap-1.5" role="list" aria-label={content.weekdayHeading}>
              {weekdayDistribution?.bins.map((bin) => {
                const label = formatHeatmapWeekdayBarLabel(bin, locale);
                const barHeight = getRawBarHeightPercent(bin.rawCount, weekdayBarScaleMax);

                return (
                  <div className="min-w-0 text-center" key={bin.weekday} role="listitem">
                    <ResetCountBar
                      ariaLabel={label}
                      barHeight={barHeight}
                      rawCount={bin.rawCount}
                    />
                    <div aria-hidden="true" className="mt-1 text-center text-[0.65rem] font-medium tabular-nums text-slate-500">
                      {formatHeatmapWeekdayLabel(bin.weekday, locale)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {intervalDistribution ? (
            <RandomResetIntervalSection
              barScaleMax={intervalBarScaleMax}
              content={content}
              distribution={intervalDistribution}
              locale={locale}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

type HeatmapContent = (typeof CONTENT)[Locale];

function RandomResetIntervalSection({
  barScaleMax,
  content,
  distribution,
  locale,
}: {
  barScaleMax: number;
  content: HeatmapContent;
  distribution: RandomResetIntervalDistribution;
  locale: Locale;
}) {
  const stats = [
    [content.intervalCount, `n=${distribution.totalCount}`],
    [content.median, formatRandomResetDuration(distribution.medianMs, locale)],
    [content.average, formatRandomResetDuration(distribution.averageMs, locale)],
    [content.shortest, formatRandomResetDuration(distribution.minMs, locale)],
    [content.longest, formatRandomResetDuration(distribution.maxMs, locale)],
  ] as const;

  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <h2 className="text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">
        {content.intervalHeading}
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">{content.intervalDescription}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div className="min-w-0" key={label}>
            <dt className="text-slate-500">{label}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
      {distribution.totalCount === 0 ? (
        <p className="mt-5 text-sm leading-6 text-slate-600">{content.intervalEmpty}</p>
      ) : (
        <>
          <div
            aria-label={content.intervalHeading}
            className="mt-5 grid h-32 grid-cols-8 gap-1 sm:h-28"
            role="list"
          >
            {distribution.bins.map((bin) => (
              <div className="min-w-0 px-0.5 sm:px-1" key={bin.key} role="listitem">
                <ResetCountBar
                  ariaLabel={formatRandomResetIntervalBarLabel(bin, locale)}
                  barHeight={getRawBarHeightPercent(bin.rawCount, barScaleMax)}
                  rawCount={bin.rawCount}
                />
              </div>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="mt-1 grid grid-cols-8 gap-1 text-center text-[0.55rem] font-medium leading-tight tabular-nums text-slate-500 sm:text-xs"
          >
            {distribution.bins.map((bin) => (
              <span className="min-w-0 break-words" key={bin.key}>
                {formatRandomResetIntervalBinLabel(bin, locale)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ResetCountBar({
  ariaLabel,
  barHeight,
  rawCount,
}: {
  ariaLabel: string;
  barHeight: number;
  rawCount: number;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="relative h-32 min-w-0 px-0.5 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 sm:h-28"
      role="img"
      tabIndex={0}
      title={ariaLabel}
    >
      {rawCount > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 text-center text-xs font-semibold tabular-nums text-slate-700 sm:text-[0.65rem]"
          style={{ bottom: `calc(${barHeight}% + 0.25rem)` }}
        >
          {rawCount}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className="absolute inset-x-0.5 bottom-0 rounded-t bg-teal-600 sm:inset-x-1"
        style={{ height: `${barHeight}%` }}
      />
    </div>
  );
}
