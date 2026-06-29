"use client";

import {
  Activity,
  Bell,
  Clock,
  ExternalLink,
  Gauge,
  History,
  Radio,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CachedRadarData,
  RadarData,
  getRadarViewModel,
  getRefreshIntervalMs,
  isSafeHttpUrl,
  probabilityToPercent,
} from "@/lib/radar";
import type { Locale } from "@/lib/radar/types";
import { translateUI } from "@/lib/radar/i18n";
import { LocalizedDateTime } from "@/components/LocalizedDateTime";

const CACHE_KEY = "codex-reset-observatory:last-success";

type LoadState = {
  data: RadarData | null;
  fetchedAt: string | null;
};

export function RadarDashboard({
  initialData,
  initialFetchedAt,
  locale = "ja",
}: {
  initialData?: RadarData | null;
  initialFetchedAt?: string | null;
  locale?: Locale;
}) {
  const [state, setState] = useState<LoadState>({
    data: initialData ?? null,
    fetchedAt: initialFetchedAt ?? null,
  });

  const loadCachedData = useCallback((): CachedRadarData | null => {
    try {
      const cached = window.localStorage.getItem(CACHE_KEY);
      return cached ? (JSON.parse(cached) as CachedRadarData) : null;
    } catch {
      return null;
    }
  }, []);

  const fetchRadar = useCallback(async () => {
    try {
      const response = await fetch("/api/current", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Failed to fetch current data");
      }

      const data = (await response.json()) as RadarData;
      const fetchedAt = new Date().toISOString();

      window.localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ data, fetchedAt } satisfies CachedRadarData),
      );

      setState({
        data,
        fetchedAt,
      });
    } catch {
      const cached = loadCachedData();
      setState((current) => ({
        data: cached?.data ?? current.data,
        fetchedAt: cached?.fetchedAt ?? current.fetchedAt,
      }));
    }
  }, [loadCachedData]);

  useEffect(() => {
    void fetchRadar();
  }, [fetchRadar]);

  const viewModel = useMemo(() => getRadarViewModel(state.data, locale), [state.data, locale]);
  const probability24h = viewModel.probability24h;
  const refreshMs = useMemo(
    () => getRefreshIntervalMs(probability24h),
    [probability24h],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchRadar();
    }, refreshMs);

    return () => window.clearInterval(timer);
  }, [fetchRadar, refreshMs]);

  const resetNoticeTone =
    viewModel.activeWindow.kind === "official"
      ? {
          card: "border-amber-300 bg-amber-50 text-amber-950",
          icon: "text-amber-700",
          badge: "bg-amber-200 text-amber-950",
        }
      : {
          card: "border-slate-200 bg-white/90 text-slate-950",
          icon: "text-teal-700",
          badge: "bg-slate-100 text-slate-600",
        };

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8" lang={locale}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-lg border border-slate-200/80 bg-white/82 p-5 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="radar-grid relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 sm:h-16 sm:w-16">
              <div className="absolute inset-2 rounded-full border border-slate-300" />
              <div className="radar-sweep absolute inset-2 rounded-full" />
              <Radio className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-teal-700" />
            </div>
            <div>
              <p className="text-sm font-medium leading-6 text-teal-700">
                {translateUI("subTitle", locale)}
              </p>
              <h1 className="mt-1 whitespace-nowrap text-[1.35rem] font-semibold leading-tight tracking-normal text-slate-950 sm:text-4xl">
                {translateUI("title", locale)}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                {translateUI("description", locale)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {locale !== "ja" && (
              <Link
                className="w-fit rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 underline-offset-4 hover:underline"
                href="/"
              >
                日本語
              </Link>
            )}
            {locale !== "en" && (
              <Link
                className="w-fit rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 underline-offset-4 hover:underline"
                href="/en"
              >
                English
              </Link>
            )}
            {locale !== "zh" && (
              <Link
                className="w-fit rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 underline-offset-4 hover:underline"
                href="/zh"
              >
                简体中文
              </Link>
            )}
          </div>
        </header>

        <section className={`rounded-lg border p-5 shadow-sm ${resetNoticeTone.card}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <Bell className={`mt-0.5 h-6 w-6 shrink-0 ${resetNoticeTone.icon}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-500">
                  {translateUI("officialNotice", locale)}
                </p>
                <h2 className="mt-1 text-2xl font-semibold leading-tight text-balance">
                  {viewModel.activeWindow.active ? translateUI("activeNoticeLabel", locale) : translateUI("noNotice", locale)}
                </h2>
                {viewModel.activeWindow.active && viewModel.activeWindow.summary ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">
                    {viewModel.activeWindow.summary}
                  </p>
                ) : null}
              </div>
            </div>
            {viewModel.activeWindow.active && viewModel.activeWindow.kind === "official" ? (
              <span
                className={`inline-flex w-fit shrink-0 rounded-md px-3 py-1 text-sm font-semibold ${resetNoticeTone.badge}`}
              >
                {translateUI("checkAction", locale)}
              </span>
            ) : null}
          </div>

          {viewModel.activeWindow.kind === "official" ? (
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-white/80 p-4 sm:col-span-2">
                <dt className="text-xs font-semibold text-slate-500">
                  {translateUI("scheduledResetTime", locale)}
                </dt>
                <dd className="mt-1 text-2xl font-semibold leading-tight text-slate-950">
                  <LocalizedDateTime value={viewModel.activeWindow.expectedAt} locale={locale} />
                </dd>
              </div>
              <MiniInfo
                label={translateUI("source", locale)}
                value={viewModel.activeWindow.sourceLabel ?? "Unknown"}
                href={viewModel.activeWindow.source}
              />
            </dl>
          ) : null}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.12fr_0.88fr]">
          <article className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">{translateUI("currentStatus", locale)}</p>
                <h2 className="ui-heading mt-1 text-2xl font-semibold text-slate-950">
                  <span className="block">{translateUI("randomReset", locale)}</span>
                  <span className="block mt-1 text-lg sm:mt-0 sm:inline">
                    {translateUI("expectationLabel", locale)}：{viewModel.expectation}
                  </span>
                </h2>
              </div>
              <Gauge className="h-7 w-7 text-teal-700" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric
                label={translateUI("within24h", locale)}
                probability={probability24h}
                value={probabilityToPercent(probability24h, locale)}
              />
              <Metric
                label={translateUI("within48h", locale)}
                probability={viewModel.probability48h}
                value={probabilityToPercent(viewModel.probability48h, locale)}
              />
            </div>

            <dl className="mt-5 space-y-4">
              {viewModel.reasoningSummary ? (
                <RecommendationRow reason={viewModel.reasoningSummary} locale={locale} />
              ) : null}
            </dl>
            <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
              {translateUI("disclaimer", locale)}
            </p>
          </article>

          <article className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  {translateUI("latestReset", locale)}
                </p>
                <h2 className="ui-heading mt-1 text-2xl font-semibold text-slate-950">
                  {viewModel.latestWindow.title}
                </h2>
              </div>
              <Sparkles className="h-7 w-7 text-amber-600" />
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-700">
              {viewModel.latestWindow.summary}
            </p>

            <dl className="mt-5 space-y-4">
              <InfoRow label={viewModel.latestWindow.scopeLabel ?? translateUI("scope", locale)} value={viewModel.latestWindow.scope} />
              {viewModel.latestWindow.kind === "observed" ? (
                <InfoRow
                  label={translateUI("detectionTime", locale)}
                  value={<LocalizedDateTime value={viewModel.latestWindow.openedAt} locale={locale} />}
                />
              ) : null}
              <InfoRow
                label={translateUI("resetTime", locale)}
                value={<LocalizedDateTime value={viewModel.latestWindow.closedAt} locale={locale} />}
              />
              <InfoRow
                label={viewModel.latestWindow.windowLabel ?? translateUI("windowLength", locale)}
                value={viewModel.latestWindow.windowLength}
              />
            </dl>
          </article>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/80 p-4 text-slate-700 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">
                {translateUI("weeklyResetRef", locale)}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {viewModel.regularResetForecast.date}
                {viewModel.regularResetForecast.time ? (
                  <span className="ml-2">
                    {viewModel.regularResetForecast.time}
                  </span>
                ) : null}
                <span className="ml-3 text-sm font-medium text-slate-500">
                  ({viewModel.regularResetForecast.remaining})
                </span>
              </h2>
            </div>
            <p className="text-sm leading-6 sm:max-w-md sm:text-right text-slate-500">
              {translateUI("weeklyResetNote", locale)}
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">
                {translateUI("resetHistory", locale)}
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                {translateUI("recentResetEvents", locale)}
              </h2>
            </div>
            <History className="h-7 w-7 text-slate-700" />
          </div>

          <div className="mt-5 divide-y divide-slate-100">
            {viewModel.recentHistory.length > 0 ? (
              viewModel.recentHistory.map((item) => (
                <div
                  className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto]"
                  key={item.key}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="ui-heading text-base font-semibold text-slate-950">
                        {item.title}
                      </h3>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {item.status}
                      </span>
                      {(item.resetTypes ?? [item.resetType]).map((resetType) => (
                        <span
                          className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700"
                          key={resetType}
                        >
                          {resetType}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {item.scopeLabel ?? translateUI("scope", locale)}：{item.scope}
                      <span className="mx-2 hidden sm:inline">/</span>
                      <span className="block sm:inline">
                        {item.windowLabel ?? translateUI("windowLength", locale)}：{item.windowLength}
                      </span>
                    </p>
                    {item.summary && (
                      <p className="mt-2 text-xs leading-5 text-slate-500 bg-slate-50 p-2.5 rounded border border-slate-100/60 max-w-2xl">
                        {item.summary}
                      </p>
                    )}
                  </div>
                  <div className="text-sm leading-6 text-slate-700 md:text-right">
                    {item.signalLabel ? (
                      <p>
                        {item.signalLabel}：<LocalizedDateTime value={item.signalAt} locale={locale} />
                      </p>
                    ) : null}
                    {item.resetAt || item.resetLabel ? (
                      <p>
                        {item.resetLabel}：<LocalizedDateTime value={item.resetAt} locale={locale} />
                      </p>
                    ) : null}
                    {isSafeHttpUrl(item.source) ? (
                      <a
                        className="inline-flex items-center gap-1 font-semibold text-teal-700 underline-offset-4 hover:underline"
                        href={item.source ?? undefined}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {translateUI("source", locale)}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-600">
                {translateUI("noHistory", locale)}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/88 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm text-slate-700">
              <Clock className="h-5 w-5 text-slate-500" />
              <span>{translateUI("lastUpdated", locale)}：<LocalizedDateTime value={viewModel.lastUpdated} locale={locale} /></span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-700">
              <Activity className="h-5 w-5 text-slate-500" />
              <span>{translateUI("dataFetched", locale)}：<LocalizedDateTime value={state.fetchedAt} locale={locale} /></span>
            </div>
          </div>
        </section>

        <footer className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
          <nav
            aria-label={translateUI("title", locale)}
            className="flex flex-wrap gap-3 text-sm text-slate-300"
          >
            <Link className="underline-offset-4 hover:underline" href={locale === "ja" ? "/about" : `/${locale}/about`}>
              {translateUI("about", locale)}
            </Link>
            <Link className="underline-offset-4 hover:underline" href={locale === "ja" ? "/faq" : `/${locale}/faq`}>
              {translateUI("faq", locale)}
            </Link>
            <Link className="underline-offset-4 hover:underline" href={locale === "ja" ? "/history" : `/${locale}/history`}>
              {translateUI("history", locale)}
            </Link>
            {locale === "ja" ? (
              <>
                <Link className="underline-offset-4 hover:underline" href="/en">
                  English
                </Link>
                <Link className="underline-offset-4 hover:underline" href="/zh">
                  简体中文
                </Link>
              </>
            ) : locale === "en" ? (
              <>
                <Link className="underline-offset-4 hover:underline" href="/">
                  日本語
                </Link>
                <Link className="underline-offset-4 hover:underline" href="/zh">
                  简体中文
                </Link>
              </>
            ) : (
              <>
                <Link className="underline-offset-4 hover:underline" href="/">
                  日本語
                </Link>
                <Link className="underline-offset-4 hover:underline" href="/en">
                  English
                </Link>
              </>
            )}
          </nav>
        </footer>
      </div>
    </main>
  );
}

function Metric({
  label,
  probability,
  value,
}: {
  label: string;
  probability: number | undefined;
  value: string;
}) {
  const tone = getProbabilityTone(probability);

  return (
    <div className={`rounded-lg border p-4 ${tone.card}`}>
      <dt className={`text-sm font-medium ${tone.label}`}>{label}</dt>
      <dd className={`mt-2 text-3xl font-semibold ${tone.value}`}>{value}</dd>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/75">
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: getProbabilityBarWidth(probability) }}
        />
      </div>
    </div>
  );
}

function getProbabilityTone(probability: number | undefined) {
  if (typeof probability !== "number" || Number.isNaN(probability)) {
    return {
      bar: "bg-slate-400",
      card: "border-slate-200 bg-slate-50",
      label: "text-slate-500",
      value: "text-slate-950",
    };
  }

  if (probability <= 0.33) {
    return {
      bar: "bg-sky-500",
      card: "border-sky-200 bg-sky-50",
      label: "text-sky-700",
      value: "text-sky-950",
    };
  }

  if (probability <= 0.66) {
    return {
      bar: "bg-orange-500",
      card: "border-orange-200 bg-orange-50",
      label: "text-orange-700",
      value: "text-orange-950",
    };
  }

  return {
    bar: "bg-rose-500",
    card: "border-rose-200 bg-rose-50",
    label: "text-rose-700",
    value: "text-rose-950",
  };
}

function getProbabilityBarWidth(probability: number | undefined) {
  if (typeof probability !== "number" || Number.isNaN(probability)) {
    return "0%";
  }

  return `${Math.min(100, Math.max(0, Math.round(probability * 100)))}%`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-slate-100 pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold leading-6 text-slate-900 sm:max-w-xl">
        {value}
      </dd>
    </div>
  );
}

function RecommendationRow({
  reason,
  locale = "ja",
}: {
  reason: string;
  locale?: Locale;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:grid sm:grid-cols-[7rem_1fr] sm:items-start sm:gap-6">
      <dt className="whitespace-nowrap text-sm font-medium text-slate-500">
        {translateUI("reason", locale)}
      </dt>
      <dd className="text-sm leading-6 text-slate-700">
        {reason}
      </dd>
    </div>
  );
}

function MiniInfo({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string | null;
}) {
  return (
    <div className="rounded-md bg-white/70 p-3">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">
        {isSafeHttpUrl(href) ? (
          <a
            className="inline-flex items-center gap-1 text-teal-700 underline-offset-4 hover:underline"
            href={href ?? undefined}
            rel="noreferrer"
            target="_blank"
          >
            {value}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
