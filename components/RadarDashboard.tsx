"use client";

import {
  AlertTriangle,
  Bell,
  Clock3,
  ExternalLink,
  Gauge,
  History,
  Radio,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CachedRadarData,
  getRadarViewModel,
  isSafeHttpUrl,
} from "@/lib/radar";
import {
  applyRefreshFailure,
  applyRefreshSuccess,
  getDashboardDataState,
  parseCachedRadarData,
  type RadarLoadState,
} from "@/lib/radar/clientState";
import type { HistorySourceKind, Locale, PublicRadarSnapshot } from "@/lib/radar/types";
import { translateUI, translateDynamic } from "@/lib/radar/i18n";
import {
  canStartRadarRefresh,
  getInitialRefreshPlan,
  getRefreshRetryDelayMs,
  RADAR_FETCH_TIMEOUT_MS,
  startAbortTimeout,
} from "@/lib/radar/refreshPolicy";
import { SITE_NAME, SITE_NAME_JA } from "@/lib/siteMetadata";
import { DeveloperLink } from "./DeveloperLink";
import { LocalizedDateTime } from "@/components/LocalizedDateTime";
import { ProbabilityMetrics } from "@/components/ProbabilityMetrics";
import { RandomResetTimeHeatmap } from "@/components/RandomResetTimeHeatmap";
import { ResetHistoryDetails } from "@/components/ResetHistoryDetails";
import { TiboActivityCard } from "@/components/TiboActivityCard";
import { formatElapsedResetDuration } from "@/lib/radar/helpers";

function hasPriorSignal(signalAt: string | null | undefined, resetAt: string | null | undefined) {
  if (!signalAt || !resetAt) return false;
  const signalTime = new Date(signalAt).getTime();
  const resetTime = new Date(resetAt).getTime();
  return Number.isFinite(signalTime) && Number.isFinite(resetTime) && signalTime < resetTime;
}

function getSourceLabel(sourceKind: HistorySourceKind | undefined, locale: Locale) {
  switch (sourceKind) {
    case "direct_post":
      return translateUI("sourceOriginalPost", locale);
    case "profile":
      return translateUI("sourceProfile", locale);
    case "official_status":
      return translateUI("sourceOfficialStatus", locale);
    default:
      return translateUI("sourceNotRecorded", locale);
  }
}

function getHistoryDisplayTitle(
  item: PublicRadarSnapshot["viewModel"]["recentHistory"][number],
  locale: Locale,
) {
  const title = translateDynamic(item.title, locale);
  if (item.recordKind !== "reference") {
    return title;
  }

  return locale === "en"
    ? `${title} (reference record)`
    : locale === "zh"
      ? `${title}（参考记录）`
      : `${title}（参考記録）`;
}

type IncidentStatus = "active" | "none" | "unknown";

function getIncidentStatusFromReason(
  reason: string | null | undefined,
  locale: Locale,
): IncidentStatus {
  if (!reason) return "unknown";

  const activePhrase = locale === "en"
    ? "A Codex-related incident is currently active"
    : locale === "zh"
      ? "当前有 Codex 相关故障正在发生"
      : "現在、Codex関連の障害が発生しており";

  // The display summary already uses the evaluated incident state. Reuse its
  // localized wording here instead of introducing a second incident query.
  return reason.includes(activePhrase) ? "active" : "none";
}

function getElapsedSinceLastReset(
  sourceResetAt: string | null | undefined,
  fetchedAt: string | null | undefined,
  locale: Locale,
) {
  const resetTime = sourceResetAt ? Date.parse(sourceResetAt) : Number.NaN;
  const observedTime = fetchedAt ? Date.parse(fetchedAt) : Number.NaN;
  if (!Number.isFinite(resetTime) || !Number.isFinite(observedTime) || observedTime < resetTime) {
    return translateUI("unknownProbability", locale);
  }

  return formatElapsedResetDuration(observedTime - resetTime, locale);
}

function getIncidentStatusLabel(status: IncidentStatus, locale: Locale) {
  if (status === "active") return translateUI("activeCodexIncident", locale);
  if (status === "none") return translateUI("noCodexIncident", locale);
  return translateUI("unknownProbability", locale);
}

function getCompactOutlookReason(
  reason: string | null | undefined,
  locale: Locale,
) {
  if (!reason) return null;

  const redundantSentences = locale === "en"
    ? [
        /It has been .+? since the last reset\.\s*/,
        /There is currently no official notice or active Codex-related incident\.\s*/,
      ]
    : locale === "zh"
      ? [
          /距离上次重置已过去.+?。\s*/,
          /目前没有官方预告，也没有正在发生的 Codex 相关故障。\s*/,
        ]
      : [
          /直近のリセットから.+?経過しています。\s*/,
          /現在、公式予告や発生中のCodex関連障害はありません。\s*/,
        ];

  const compactReason = redundantSentences.reduce(
    (current, sentence) => current.replace(sentence, ""),
    reason,
  ).trim();

  return compactReason || translateUI("noObservedChange", locale);
}

function ObservationStatusItem({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-slate-50/80 px-3 py-2">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

export function RadarDashboard({
  initialData,
  initialFetchedAt,
  randomResetHeatmapEventTimes = [],
  locale = "ja",
}: {
  initialData?: PublicRadarSnapshot | null;
  initialFetchedAt?: string | null;
  randomResetHeatmapEventTimes?: string[];
  locale?: Locale;
}) {
  const resolvedInitialFetchedAt = initialFetchedAt ?? initialData?.checkedAt ?? null;
  const [state, setState] = useState<RadarLoadState>(() => ({
    data: initialData ?? null,
    fetchedAt: resolvedInitialFetchedAt,
    isStale: initialData?.dataHealth.stale ?? false,
    refreshError: null,
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const lifecycleIdRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const failureCountRef = useRef(0);
  const latestDataRef = useRef<PublicRadarSnapshot | null>(initialData ?? null);
  const latestFetchedAtRef = useRef<string | null>(resolvedInitialFetchedAt);
  const cacheKey = `codex-reset-observatory:last-success:${locale}`;

  const loadCachedData = useCallback((): CachedRadarData | null => {
    try {
      return parseCachedRadarData(window.localStorage.getItem(cacheKey), locale);
    } catch {
      return null;
    }
  }, [cacheKey, locale]);

  const fetchRadar = useCallback(async (lifecycleId: number) => {
    const isCurrentLifecycle = () => lifecycleIdRef.current === lifecycleId;
    const environment = {
      visibilityState: typeof document === "undefined" ? "visible" : document.visibilityState,
      onLine: typeof navigator === "undefined" || navigator.onLine !== false,
      inFlight: inFlightRef.current !== null,
    };

    if (!isCurrentLifecycle() || !canStartRadarRefresh(environment)) {
      return { kind: "skipped" as const };
    }

    const controller = new AbortController();
    inFlightRef.current = controller;
    const timeout = startAbortTimeout(
      controller,
      RADAR_FETCH_TIMEOUT_MS,
      window.setTimeout.bind(window),
      window.clearTimeout.bind(window),
    );

    try {
      const response = await fetch(`/api/current?locale=${locale}`, {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch current data");
      }

      const data = (await response.json()) as PublicRadarSnapshot;
      const fetchedAt = data.checkedAt;
      if (!isCurrentLifecycle()) {
        return { kind: "aborted" as const };
      }

      const nextState = applyRefreshSuccess(data, fetchedAt);
      stateRef.current = nextState;
      setState(nextState);
      latestDataRef.current = data;
      latestFetchedAtRef.current = fetchedAt;
      failureCountRef.current = 0;

      try {
        window.localStorage.setItem(
          cacheKey,
          JSON.stringify({
            schemaVersion: "public-v1",
            locale,
            data,
            fetchedAt,
          } satisfies CachedRadarData),
        );
      } catch {
        // Cache persistence is best-effort; the successful live response remains current.
      }
      return { kind: "success" as const, data, fetchedAt };
    } catch {
      if (!isCurrentLifecycle() || (controller.signal.aborted && !timeout.hasTimedOut())) {
        return { kind: "aborted" as const };
      }

      const cached = loadCachedData();
      const nextState = applyRefreshFailure(stateRef.current, cached);
      stateRef.current = nextState;
      setState(nextState);
      latestDataRef.current = nextState.data;
      latestFetchedAtRef.current = nextState.fetchedAt;
      failureCountRef.current += 1;

      return {
        kind: "failure" as const,
        retryDelayMs: getRefreshRetryDelayMs(failureCountRef.current),
      };
    } finally {
      timeout.cancel();
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
      }
    }
  }, [cacheKey, loadCachedData, locale]);

  useEffect(() => {
    const lifecycleId = lifecycleIdRef.current + 1;
    lifecycleIdRef.current = lifecycleId;
    failureCountRef.current = 0;

    const initialState: RadarLoadState = {
      data: initialData ?? null,
      fetchedAt: resolvedInitialFetchedAt,
      isStale: initialData?.dataHealth.stale ?? false,
      refreshError: null,
    };
    stateRef.current = initialState;
    setState(initialState);
    latestDataRef.current = initialData ?? null;
    latestFetchedAtRef.current = resolvedInitialFetchedAt;

    const clearRefreshTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const isCurrentLifecycle = () => lifecycleIdRef.current === lifecycleId;

    const scheduleNextRefresh = (delayMs: number) => {
      if (!isCurrentLifecycle()) return;

      const canSchedule = canStartRadarRefresh({
        visibilityState: document.visibilityState,
        onLine: navigator.onLine !== false,
        inFlight: false,
      });
      if (!canSchedule) return;

      clearRefreshTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void runRefresh();
      }, Math.max(0, delayMs));
    };

    const runRefresh = async () => {
      if (!isCurrentLifecycle()) return;

      const result = await fetchRadar(lifecycleId);
      if (!isCurrentLifecycle()) return;

      if (result.kind === "success") {
        const plan = getInitialRefreshPlan(result.data, result.fetchedAt, Date.now());
        scheduleNextRefresh(
          plan.action === "wait"
            ? plan.delayMs
            : getRefreshRetryDelayMs(Math.max(1, failureCountRef.current + 1)),
        );
      } else if (result.kind === "failure") {
        scheduleNextRefresh(result.retryDelayMs);
      }
    };

    const resumeRefreshLifecycle = () => {
      if (!isCurrentLifecycle()) return;

      const plan = getInitialRefreshPlan(
        latestDataRef.current,
        latestFetchedAtRef.current,
        Date.now(),
      );
      if (plan.action === "fetch") {
        void runRefresh();
      } else {
        scheduleNextRefresh(plan.delayMs);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearRefreshTimer();
        return;
      }

      resumeRefreshLifecycle();
    };

    const handleOnline = () => {
      resumeRefreshLifecycle();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    const initialPlan = getInitialRefreshPlan(
      initialData,
      resolvedInitialFetchedAt,
      Date.now(),
    );
    if (initialPlan.action === "fetch") {
      void runRefresh();
    } else {
      scheduleNextRefresh(initialPlan.delayMs);
    }

    return () => {
      lifecycleIdRef.current += 1;
      clearRefreshTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
  }, [fetchRadar, initialData, locale, resolvedInitialFetchedAt]);

  const viewModel = useMemo(
    () => state.data?.viewModel ?? getRadarViewModel(null, locale),
    [state.data, locale],
  );
  const dashboardDataState = getDashboardDataState(state);
  const isDataUnavailable = dashboardDataState === "unavailable";
  const shouldShowDataWarning =
    dashboardDataState === "degraded" || dashboardDataState === "unavailable";
  const probability24h = isDataUnavailable ? undefined : viewModel.probability24h;
  const probability48h = isDataUnavailable ? undefined : viewModel.probability48h;
  const hasOfficialNotice = viewModel.activeWindow.kind === "official";
  const officialNoticeValue = isDataUnavailable
    ? translateUI("unknownProbability", locale)
    : viewModel.activeWindow.active && hasOfficialNotice
      ? translateUI("activeNoticeLabel", locale)
      : translateUI("noOfficialNotice", locale);
  const incidentStatus = isDataUnavailable
    ? "unknown" as const
    : getIncidentStatusFromReason(viewModel.displayReasoningSummary, locale);
  const elapsedSinceLastReset = isDataUnavailable
    ? translateUI("unknownProbability", locale)
    : getElapsedSinceLastReset(
        viewModel.regularResetForecast.sourceResetAt,
        state.fetchedAt,
        locale,
      );
  const compactOutlookReason = isDataUnavailable
    ? null
    : getCompactOutlookReason(viewModel.displayReasoningSummary, locale);
  const visibleHistory = viewModel.recentHistory.filter(
    (item) => item.recordKind === "confirmed_global" ||
      item.recordKind === "banked_distribution" ||
      item.recordKind === "reference",
  );
  const resetNoticeTone = {
    card: "border-amber-300 bg-amber-50 text-amber-950",
    icon: "text-amber-700",
    badge: "bg-amber-200 text-amber-950",
  };

  return (
    <main className="min-h-screen px-3 py-4 sm:px-6 sm:py-5 lg:px-8" lang={locale}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-3 rounded-lg border border-slate-200/80 bg-white/82 p-3 shadow-sm backdrop-blur sm:gap-4 sm:p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="radar-grid relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-200 sm:h-16 sm:w-16">
              <div className="absolute inset-2 rounded-full border border-slate-300" />
              <div className="radar-sweep absolute inset-2 rounded-full" />
              <Radio className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-teal-700" />
            </div>
            <div>
              <p className="text-xs font-medium leading-5 text-teal-700 sm:text-sm sm:leading-6">
                {locale === "ja" || locale === "zh" ? SITE_NAME : translateUI("subTitle", locale)}
              </p>
              <h1 className="mt-0.5 whitespace-nowrap text-[1.15rem] font-semibold leading-tight tracking-normal text-slate-950 sm:mt-1 sm:text-4xl">
                {locale === "ja" ? SITE_NAME_JA : locale === "zh" ? "Codex 重置观测站" : SITE_NAME}
              </h1>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600 sm:mt-3 sm:text-sm sm:leading-6">
                {translateUI("description", locale)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 sm:justify-start">
            {locale !== "ja" && (
              <Link
                className="inline-flex min-h-8 w-fit items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline sm:border-slate-200 sm:bg-white sm:px-3 sm:py-1.5 sm:text-xs sm:font-semibold sm:text-slate-700"
                href="/"
              >
                日本語
              </Link>
            )}
            {locale !== "en" && (
              <Link
                className="inline-flex min-h-8 w-fit items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline sm:border-slate-200 sm:bg-white sm:px-3 sm:py-1.5 sm:text-xs sm:font-semibold sm:text-slate-700"
                href="/en"
              >
                English
              </Link>
            )}
            {locale !== "zh" && (
              <Link
                className="inline-flex min-h-8 w-fit items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline sm:border-slate-200 sm:bg-white sm:px-3 sm:py-1.5 sm:text-xs sm:font-semibold sm:text-slate-700"
                href="/zh"
              >
                简体中文
              </Link>
            )}
          </div>
        </header>

        {shouldShowDataWarning ? (
          <section
            role={dashboardDataState === "unavailable" ? "alert" : "status"}
            className={`rounded-lg border px-4 py-3 text-sm leading-6 ${
              dashboardDataState === "unavailable"
                ? "border-rose-200 bg-rose-50 text-rose-950"
                : "border-amber-200 bg-amber-50 text-amber-950"
            }`}
          >
            {translateUI(
              dashboardDataState === "degraded"
                ? "degradedDataWarning"
                : "dataUnavailable",
              locale,
            )}
          </section>
        ) : null}

        {hasOfficialNotice ? (
          <section className={`rounded-lg border p-5 shadow-sm ${resetNoticeTone.card}`}>
          <div className="sm:hidden">
            <div className="flex items-center gap-3">
              <Bell className={`h-6 w-6 shrink-0 ${resetNoticeTone.icon}`} />
              <p className="text-sm font-medium text-slate-500">
                {translateUI("officialNotice", locale)}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="whitespace-nowrap text-lg font-semibold leading-tight">
                {viewModel.activeWindow.active ? translateUI("activeNoticeLabel", locale) : translateUI("noNotice", locale)}
              </h2>
              {viewModel.activeWindow.active && viewModel.activeWindow.kind === "official" ? (
                <span
                  className={`inline-flex w-fit shrink-0 rounded-md px-3 py-1 text-sm font-semibold ${resetNoticeTone.badge}`}
                >
                  {translateUI("checkAction", locale)}
                </span>
              ) : null}
            </div>
            {viewModel.activeWindow.active && viewModel.activeWindow.summary ? (
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">
                {viewModel.activeWindow.summary}
              </p>
            ) : null}
          </div>

          <div className="hidden items-start gap-3 sm:flex sm:flex-row sm:justify-between">
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
              {viewModel.activeWindow.expectedAt ? (
                <div className="rounded-md bg-white/80 p-4 sm:col-span-2">
                  <dt className="text-xs font-semibold text-slate-500">
                    {translateUI("scheduledResetTime", locale)}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold leading-tight text-slate-950">
                    <div className="flex flex-wrap items-center gap-y-1">
                      <LocalizedDateTime value={viewModel.activeWindow.expectedAt} locale={locale} />
                      {viewModel.activeWindow.expectedEndAt ? (
                        <>
                          <span className="mx-1.5 text-slate-500 font-normal text-xl">
                            {translateUI("timeRangeSeparator", locale)}
                          </span>
                          <LocalizedDateTime value={viewModel.activeWindow.expectedEndAt} locale={locale} />
                        </>
                      ) : null}
                    </div>
                  </dd>
                </div>
              ) : (
                <div className="rounded-md bg-white/80 p-4 sm:col-span-2">
                  <dt className="text-xs font-semibold text-slate-500">
                    {translateUI("noticePostedAt", locale)}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold leading-tight text-slate-950">
                    <LocalizedDateTime value={viewModel.activeWindow.openedAt} locale={locale} />
                  </dd>
                </div>
              )}
              <MiniInfo
                label={translateUI("source", locale)}
                value={viewModel.activeWindow.sourceLabel ?? "Unknown"}
                href={viewModel.activeWindow.source}
              />
            </dl>
          ) : null}
          </section>
        ) : null}

        <section>
          <article className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">{translateUI("currentStatus", locale)}</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-950 leading-tight break-words text-balance">
                  <span className="block">{translateUI("randomReset", locale)}</span>
                  <span className="block mt-1 text-lg sm:mt-0 sm:inline">
                    {translateUI("expectationLabel", locale)}{locale === "en" ? ": " : "："}{isDataUnavailable ? translateUI("unknownProbability", locale) : viewModel.expectation}
                  </span>
                </h2>
              </div>
              <Gauge className="h-7 w-7 text-teal-700" />
            </div>

            <ProbabilityMetrics
              locale={locale}
              probability24h={probability24h}
              probability48h={probability48h}
            />

            <dl className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3">
              <ObservationStatusItem
                icon={Bell}
                label={translateUI("officialNoticeStatus", locale)}
                value={officialNoticeValue}
              />
              <ObservationStatusItem
                icon={AlertTriangle}
                label={translateUI("codexIncidentStatus", locale)}
                value={getIncidentStatusLabel(incidentStatus, locale)}
              />
              <ObservationStatusItem
                icon={Clock3}
                label={translateUI("elapsedSinceResetShort", locale)}
                value={elapsedSinceLastReset}
              />
            </dl>

            <dl className="mt-4 space-y-3">
              {!isDataUnavailable && compactOutlookReason ? (
                <RecommendationRow reason={compactOutlookReason} locale={locale} />
              ) : null}
            </dl>
          </article>

        </section>

        {!isDataUnavailable &&
        viewModel.regularResetForecast.isNoticeWindow &&
        viewModel.regularResetForecast.expectedAt ? (
          <section className="rounded-lg border border-slate-200 bg-white/80 p-4 text-slate-700 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  {translateUI("nextRegularResetReference", locale)}
                </p>
                <h2 className="mt-1 flex flex-wrap items-baseline text-lg font-semibold text-slate-950 sm:text-xl">
                  <LocalizedDateTime
                    value={viewModel.regularResetForecast.expectedAt}
                    locale={locale}
                  />
                </h2>
              </div>
              <p className="text-balance text-sm leading-6 text-slate-500 sm:max-w-lg sm:text-right">
                {translateUI("regularResetReferenceNote", locale)}
              </p>
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white/90 p-3 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">
                {translateUI("resetHistory", locale)}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950 sm:text-2xl">
                {translateUI("recentResetEvents", locale)}
              </h2>
            </div>
            <History className="h-6 w-6 text-slate-700 sm:h-7 sm:w-7" />
          </div>

          <div className="mt-4 space-y-3 sm:mt-5 sm:space-y-0 sm:divide-y sm:divide-slate-100">
            {visibleHistory.length > 0 ? (
              visibleHistory.map((item, index) => (
                <div
                  className={`${index >= 7 ? "hidden sm:grid" : "grid"} gap-3 rounded-md border border-l-4 border-slate-200/90 border-l-teal-500 bg-slate-50/60 p-3 shadow-sm sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0 sm:py-4 sm:shadow-none sm:first:pt-0 sm:last:pb-0 md:grid-cols-[1fr_auto]`}
                  key={item.key}
                >
                  <div>
                    <h3 className="ui-heading text-lg font-bold text-slate-950 sm:text-base sm:font-semibold">
                      {getHistoryDisplayTitle(item, locale)}
                    </h3>
                    <ResetHistoryDetails
                      item={item}
                      locale={locale}
                      compact
                      hideScopeOnMobile={item.scope === "全有料プラン"}
                      hideReasonOnMobile
                      hideNoticeType
                      hideNoticeToExecutionOnMobile
                      hideNoteOnMobile
                      showScope
                    />
                  </div>
                  <div className="border-t border-slate-200/80 pt-3 text-sm leading-6 text-slate-700 sm:border-t-0 sm:pt-0 md:text-right">
                    {item.signalLabel && hasPriorSignal(item.signalAt, item.resetAt) ? (
                      <p className="sm:block hidden">
                        {translateDynamic(item.signalLabel, locale)}{locale === "en" ? ": " : "："}<LocalizedDateTime value={item.signalAt} locale={locale} />
                      </p>
                    ) : null}
                    {item.resetAt || item.resetLabel ? (
                      <p className="font-normal sm:font-normal">
                        <span className="text-slate-600">
                          {translateDynamic(item.resetLabel, locale)}{locale === "en" ? ": " : "："}
                        </span>
                        <LocalizedDateTime
                          value={item.resetAt}
                          locale={locale}
                          className="font-bold text-slate-900 sm:font-normal sm:text-slate-700"
                        />
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

          {visibleHistory.length > 0 ? (
            <div className="mt-5 flex justify-center border-t border-slate-100 pt-4">
              <Link
                className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 underline-offset-4 hover:underline hover:text-teal-800 transition"
                href={locale === "ja" ? "/history" : `/${locale}/history`}
              >
                {translateUI("viewAllHistoryLink", locale)}
              </Link>
            </div>
          ) : null}
        </section>

        <RandomResetTimeHeatmap
          eventTimes={randomResetHeatmapEventTimes}
          locale={locale}
        />

        {state.data?.latestTiboActivity ? (
          <TiboActivityCard
            activity={state.data.latestTiboActivity}
            locale={locale}
          />
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white/80 p-4 text-slate-700 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <p className="font-medium text-slate-500">
              {translateUI("lastSuccessfulRefresh", locale)}{locale === "en" ? ": " : "："}
            </p>
            <LocalizedDateTime value={state.fetchedAt} locale={locale} className="font-medium text-slate-700" />
          </div>
        </section>

        <footer className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
          <nav
            aria-label={SITE_NAME}
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
          <div className="mt-4 border-t border-white/10 pt-3">
            <DeveloperLink
              locale={locale}
              className="text-xs text-slate-400 hover:text-white"
            />
          </div>
        </footer>
      </div>
    </main>
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
        {translateUI("forecastOutlook", locale)}
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
