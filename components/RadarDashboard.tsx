"use client";

import {
  Activity,
  AlertTriangle,
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
  SOURCE_SITE_URL,
  formatDateTime,
  getRadarViewModel,
  getRefreshIntervalMs,
  isSafeHttpUrl,
  probabilityToPercent,
} from "@/lib/radar";

const CACHE_KEY = "codex-reset-observatory:last-success";

type LoadState = {
  data: RadarData | null;
  fetchedAt: string | null;
  isFallback: boolean;
  error: string | null;
  loading: boolean;
};

export function RadarDashboard({
  initialData,
}: {
  initialData?: RadarData | null;
}) {
  const [state, setState] = useState<LoadState>({
    data: initialData ?? null,
    fetchedAt: initialData ? new Date().toISOString() : null,
    isFallback: false,
    error: null,
    loading: !initialData,
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
    setState((current) => ({ ...current, loading: true }));

    try {
      const response = await fetch("/api/current", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("データ取得に失敗しました");
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
        isFallback: false,
        error: null,
        loading: false,
      });
    } catch (error) {
      const cached = loadCachedData();
      const message =
        error instanceof Error ? error.message : "データ取得に失敗しました";

      setState({
        data: cached?.data ?? null,
        fetchedAt: cached?.fetchedAt ?? null,
        isFallback: Boolean(cached),
        error: message,
        loading: false,
      });
    }
  }, [loadCachedData]);

  useEffect(() => {
    void fetchRadar();
  }, [fetchRadar]);

  const viewModel = useMemo(() => getRadarViewModel(state.data), [state.data]);
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

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
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
                Codexランダムリセット予告・履歴・期待度
              </p>
              <h1 className="mt-1 whitespace-nowrap text-[1.35rem] font-semibold leading-tight tracking-normal text-slate-950 sm:text-4xl">
                Codexリセット観測所
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                臨時・補償・記念などのランダムリセットを観測しています。通常の週次リセットは主な対象外です。
              </p>
            </div>
          </div>
        </header>

        {state.error ? (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="text-base font-semibold">データ取得失敗</h2>
                <p className="mt-1 text-sm">
                  {state.isFallback
                    ? `前回取得日時：${formatDateTime(state.fetchedAt)}`
                    : "前回成功データがまだありません。"}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <section
          className={`rounded-lg border p-5 shadow-sm ${
            viewModel.activeWindow.active
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-slate-200 bg-white/90 text-slate-950"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <Bell
                className={`mt-0.5 h-6 w-6 shrink-0 ${
                  viewModel.activeWindow.active
                    ? "text-amber-700"
                    : "text-teal-700"
                }`}
              />
              <div>
                <p className="text-sm font-medium text-slate-500">
                  公式リセット予告
                </p>
                <h2 className="mt-1 text-2xl font-semibold leading-tight">
                  公式リセット予告：{viewModel.activeWindow.label}
                </h2>
                {viewModel.activeWindow.active ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">
                    {viewModel.activeWindow.summary}
                  </p>
                ) : null}
              </div>
            </div>
            <span
              className={`inline-flex w-fit shrink-0 rounded-md px-3 py-1 text-sm font-semibold ${
                viewModel.activeWindow.active
                  ? "bg-amber-200 text-amber-950"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {viewModel.activeWindow.active ? "要確認" : "通常監視"}
            </span>
          </div>

          {viewModel.activeWindow.active ? (
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <MiniInfo
                label="予告検知時刻"
                value={formatDateTime(viewModel.activeWindow.openedAt)}
              />
              <MiniInfo
                label="ソース"
                value={
                  isSafeHttpUrl(viewModel.activeWindow.source)
                    ? "リンクあり"
                    : "不明"
                }
                href={viewModel.activeWindow.source}
              />
            </dl>
          ) : null}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.12fr_0.88fr]">
          <article className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">現在の状況</p>
                <h2 className="ui-heading mt-1 text-2xl font-semibold text-slate-950">
                  ランダムリセット期待度：{viewModel.expectation}
                </h2>
              </div>
              <Gauge className="h-7 w-7 text-teal-700" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric
                label="24時間以内"
                probability={probability24h}
                value={probabilityToPercent(probability24h)}
              />
              <Metric
                label="48時間以内"
                probability={viewModel.probability48h}
                value={probabilityToPercent(viewModel.probability48h)}
              />
            </div>

            <dl className="mt-5 space-y-4">
              <InfoRow label="リセット状況" value={viewModel.status} />
              <RecommendationRow
                reason={viewModel.reasoningSummary}
              />
            </dl>
          </article>

          <article className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  最新のランダムリセット
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
              <InfoRow label="対象プラン" value={viewModel.latestWindow.scope} />
              <InfoRow
                label="リセット検知時刻"
                value={formatDateTime(viewModel.latestWindow.openedAt)}
              />
              <InfoRow
                label="リセット実施時刻"
                value={formatDateTime(viewModel.latestWindow.closedAt)}
              />
              <InfoRow
                label="予告から実施まで"
                value={viewModel.latestWindow.windowLength}
              />
            </dl>
          </article>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">
                ランダムリセット履歴
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                直近のランダムリセット履歴
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
                      <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                        {item.resetType}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      対象：{item.scope} / 予告から実施まで：{item.windowLength}
                    </p>
                  </div>
                  <div className="text-sm leading-6 text-slate-700 md:text-right">
                    <p>検知：{formatDateTime(item.signalAt)}</p>
                    <p>実施：{formatDateTime(item.resetAt)}</p>
                    {isSafeHttpUrl(item.source) ? (
                      <a
                        className="inline-flex items-center gap-1 font-semibold text-teal-700 underline-offset-4 hover:underline"
                        href={item.source ?? undefined}
                        rel="noreferrer"
                        target="_blank"
                      >
                        ソース
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-600">
                直近履歴は取得できていません。
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/88 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm text-slate-700">
              <Clock className="h-5 w-5 text-slate-500" />
              <span>最終更新時刻：{formatDateTime(viewModel.lastUpdated)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-700">
              <Activity className="h-5 w-5 text-slate-500" />
              <span>データ取得時刻：{formatDateTime(state.fetchedAt)}</span>
            </div>
          </div>
        </section>

        <footer className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm text-slate-300">出典:</p>
              <a
                className="mt-1 inline-flex items-center gap-2 text-base font-semibold underline-offset-4 hover:underline"
                href={SOURCE_SITE_URL}
                rel="noreferrer"
                target="_blank"
              >
                Codex Reset Radar
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <nav
              aria-label="サイト情報"
              className="flex flex-wrap gap-3 text-sm text-slate-300"
            >
              <Link className="underline-offset-4 hover:underline" href="/about">
                About
              </Link>
              <Link className="underline-offset-4 hover:underline" href="/faq">
                FAQ
              </Link>
              <Link className="underline-offset-4 hover:underline" href="/history">
                History
              </Link>
            </nav>
          </div>
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

function InfoRow({ label, value }: { label: string; value: string }) {
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
}: {
  reason: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:grid sm:grid-cols-[7rem_1fr] sm:items-start sm:gap-6">
      <dt className="whitespace-nowrap text-sm font-medium text-slate-500">
        理由
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
