"use client";

import {
  Activity,
  AlertTriangle,
  Clock,
  ExternalLink,
  Gauge,
  Radio,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CachedRadarData,
  RadarData,
  SOURCE_SITE_URL,
  formatDateTime,
  getRadarViewModel,
  getRefreshIntervalLabel,
  getRefreshIntervalMs,
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

export function RadarDashboard() {
  const [state, setState] = useState<LoadState>({
    data: null,
    fetchedAt: null,
    isFallback: false,
    error: null,
    loading: true,
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
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 radar-grid">
              <div className="absolute inset-2 rounded-full border border-slate-300" />
              <div className="radar-sweep absolute inset-2 rounded-full" />
              <Radio className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-teal-700" />
            </div>
            <div>
              <p className="text-sm font-medium text-teal-700">
                Codex Reset Radar 日本語ビュー
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">
                Codexリセット観測所
              </h1>
            </div>
          </div>

          <button
            aria-label="最新データを取得"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
            disabled={state.loading}
            onClick={() => void fetchRadar()}
            type="button"
          >
            <RotateCw
              className={`h-4 w-4 ${state.loading ? "animate-spin" : ""}`}
            />
            更新
          </button>
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

        <section className="grid gap-5 lg:grid-cols-[1.12fr_0.88fr]">
          <article className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">現在の状況</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                  現在のリセット期待度：{viewModel.expectation}
                </h2>
              </div>
              <Gauge className="h-7 w-7 text-teal-700" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric label="24時間以内" value={probabilityToPercent(probability24h)} />
              <Metric
                label="48時間以内"
                value={probabilityToPercent(viewModel.probability48h)}
              />
            </div>

            <dl className="mt-5 space-y-4">
              <InfoRow label="現在の状態" value={viewModel.status} />
              <InfoRow
                label="推奨アクション"
                value={viewModel.action}
              />
              <InfoRow
                label="取得間隔"
                value={getRefreshIntervalLabel(probability24h)}
              />
            </dl>
          </article>

          <article className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  最新リセット
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                  {viewModel.latestWindow.title}
                </h2>
              </div>
              <Sparkles className="h-7 w-7 text-amber-600" />
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-700">
              {viewModel.latestWindow.summary}
            </p>

            <dl className="mt-5 space-y-4">
              <InfoRow
                label="対象プラン"
                value={viewModel.latestWindow.scope}
              />
              <InfoRow
                label="シグナル発生時刻"
                value={formatDateTime(viewModel.latestWindow.openedAt)}
              />
              <InfoRow
                label="リセット時刻"
                value={formatDateTime(viewModel.latestWindow.closedAt)}
              />
            </dl>
          </article>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/88 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm text-slate-700">
              <Clock className="h-5 w-5 text-slate-500" />
              <span>
                最終更新時刻：{formatDateTime(viewModel.lastUpdated)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-700">
              <Activity className="h-5 w-5 text-slate-500" />
              <span>
                取得成功時刻：{formatDateTime(state.fetchedAt)}
              </span>
            </div>
          </div>
        </section>

        <footer className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
          <p className="text-sm text-slate-300">Source:</p>
          <a
            className="mt-1 inline-flex items-center gap-2 text-base font-semibold underline-offset-4 hover:underline"
            href={SOURCE_SITE_URL}
            rel="noreferrer"
            target="_blank"
          >
            Codex Reset Radar
            <ExternalLink className="h-4 w-4" />
          </a>
        </footer>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="mt-2 text-3xl font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-slate-100 pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold leading-6 text-slate-900 sm:text-right">
        {value}
      </dd>
    </div>
  );
}
