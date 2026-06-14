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
import {
  RadarData,
  getRadarViewModel,
  isSafeHttpUrl,
  probabilityToPercent,
} from "@/lib/radar";

export function EnglishRadarDashboard({
  data,
  fetchedAt,
}: {
  data: RadarData | null;
  fetchedAt: string | null;
}) {
  const viewModel = getRadarViewModel(data);
  const activeTone = viewModel.activeWindow.active
    ? "border-amber-300 bg-amber-50 text-amber-950"
    : "border-slate-200 bg-white/90 text-slate-950";

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8" lang="en">
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
                Codex reset notices, history, and probability
              </p>
              <h1 className="mt-1 text-[1.7rem] font-semibold leading-tight tracking-normal text-slate-950 sm:text-4xl">
                Codex Reset Observatory
              </h1>
            </div>
          </div>
          <Link
            className="w-fit rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 underline-offset-4 hover:underline"
            href="/"
          >
            日本語
          </Link>
        </header>

        <section className={`rounded-lg border p-5 shadow-sm ${activeTone}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <Bell className="mt-0.5 h-6 w-6 shrink-0 text-teal-700" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-500">
                  Official reset notice
                </p>
                <h2 className="mt-1 text-2xl font-semibold leading-tight text-balance">
                  {viewModel.activeWindow.active ? "Notice detected" : "No notice"}
                </h2>
                {viewModel.activeWindow.active ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">
                    An external signal close to an official reset notice is
                    active. Check the source before acting on it.
                  </p>
                ) : null}
              </div>
            </div>
            {viewModel.activeWindow.active ? (
              <span className="inline-flex w-fit shrink-0 rounded-md bg-amber-200 px-3 py-1 text-sm font-semibold text-amber-950">
                Check source
              </span>
            ) : null}
          </div>

          {viewModel.activeWindow.active ? (
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <MiniInfo
                label="Detected"
                value={formatEnglishDateTime(viewModel.activeWindow.openedAt)}
              />
              <MiniInfo
                label="Source"
                value={
                  isSafeHttpUrl(viewModel.activeWindow.source)
                    ? "Available"
                    : "Unknown"
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
                <p className="text-sm font-medium text-slate-500">
                  Current signal
                </p>
                <h2 className="ui-heading mt-1 text-2xl font-semibold text-slate-950">
                  Random reset probability: {translateExpectation(viewModel.expectation)}
                </h2>
              </div>
              <Gauge className="h-7 w-7 text-teal-700" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric
                label="Within 24h"
                probability={viewModel.probability24h}
                value={probabilityToPercent(viewModel.probability24h)}
              />
              <Metric
                label="Within 48h"
                probability={viewModel.probability48h}
                value={probabilityToPercent(viewModel.probability48h)}
              />
            </div>
            <p className="mt-5 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-700">
              This is a reference estimate based on public signals, usage-limit
              anomalies, community activity, and official updates. It is not an
              official OpenAI notice.
            </p>
          </article>

          <article className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  Latest reset
                </p>
                <h2 className="ui-heading mt-1 text-2xl font-semibold text-slate-950">
                  {translateHistoryText(viewModel.latestWindow.title)}
                </h2>
              </div>
              <Sparkles className="h-7 w-7 text-amber-600" />
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-700">
              {translateHistoryText(viewModel.latestWindow.summary)}
            </p>

            <dl className="mt-5 space-y-4">
              <InfoRow
                label="Scope"
                value={translateHistoryText(viewModel.latestWindow.scope)}
              />
              <InfoRow
                label="Reset time"
                value={formatEnglishDateTime(viewModel.latestWindow.closedAt)}
              />
              <InfoRow
                label="Window length"
                value={translateHistoryText(viewModel.latestWindow.windowLength)}
              />
            </dl>
          </article>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">Reset history</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                Recent reset events
              </h2>
            </div>
            <History className="h-7 w-7 text-slate-700" />
          </div>

          <div className="mt-5 divide-y divide-slate-100">
            {viewModel.recentHistory.map((item) => (
              <div
                className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto]"
                key={item.key}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="ui-heading text-base font-semibold text-slate-950">
                      {translateHistoryText(item.title)}
                    </h3>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {translateHistoryText(item.status)}
                    </span>
                    <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                      {translateHistoryText(item.resetType)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {translateHistoryText(item.scopeLabel ?? "Scope")}:{" "}
                    {translateHistoryText(item.scope)}
                    <span className="mx-2 hidden sm:inline">/</span>
                    <span className="block sm:inline">
                      {translateHistoryText(item.windowLabel ?? "Window")}:{" "}
                      {translateHistoryText(item.windowLength)}
                    </span>
                  </p>
                </div>
                <div className="text-sm leading-6 text-slate-700 md:text-right">
                  {item.signalLabel ? (
                    <p>
                      {translateHistoryText(item.signalLabel)}:{" "}
                      {formatEnglishDateTime(item.signalAt)}
                    </p>
                  ) : null}
                  {item.resetLabel ? (
                    <p>
                      {translateHistoryText(item.resetLabel)}:{" "}
                      {formatEnglishDateTime(item.resetAt)}
                    </p>
                  ) : null}
                  {isSafeHttpUrl(item.source) ? (
                    <a
                      className="inline-flex items-center gap-1 font-semibold text-teal-700 underline-offset-4 hover:underline"
                      href={item.source ?? undefined}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Source
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/80 p-4 text-slate-700 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">
                Weekly reset reference
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {viewModel.regularResetForecast.date}
                {viewModel.regularResetForecast.time ? (
                  <span className="ml-2">
                    {viewModel.regularResetForecast.time}
                  </span>
                ) : null}
              </h2>
            </div>
            <p className="text-sm leading-6 sm:max-w-md sm:text-right">
              If you used a manual reset, your next weekly reset date will differ
              from the reference date shown here.
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/88 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm text-slate-700">
              <Clock className="h-5 w-5 text-slate-500" />
              <span>Last updated: {formatEnglishDateTime(viewModel.lastUpdated)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-700">
              <Activity className="h-5 w-5 text-slate-500" />
              <span>Fetched: {formatEnglishDateTime(fetchedAt)}</span>
            </div>
          </div>
        </section>

        <footer className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm text-slate-300">Observation inputs:</p>
              <p className="mt-1 text-base font-semibold">
                Stored history, official information, and public community signals
              </p>
            </div>
            <nav
              aria-label="Site information"
              className="flex flex-wrap gap-3 text-sm text-slate-300"
            >
              <Link className="underline-offset-4 hover:underline" href="/en/faq">
                FAQ
              </Link>
              <Link className="underline-offset-4 hover:underline" href="/en/about">
                About
              </Link>
              <Link className="underline-offset-4 hover:underline" href="/en/history">
                History
              </Link>
              <Link className="underline-offset-4 hover:underline" href="/">
                Japanese
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

export function formatEnglishDateTime(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
    timeZoneName: "short",
  }).format(date);
}

function translateExpectation(value: string) {
  const dictionary: Record<string, string> = {
    低: "Low",
    中: "Medium",
    高: "High",
    超高: "Very high",
    不明: "Unknown",
  };

  return dictionary[value] ?? value;
}

export function translateHistoryText(value: string | undefined) {
  if (!value) {
    return "Unknown";
  }

  const dictionary: Record<string, string> = {
    "500万人達成記念リセット": "5M user milestone reset",
    "Codex障害対応の利用上限リセット": "Codex reliability compensation reset",
    "Codex利用上限リセット": "Codex usage-limit reset",
    "GPT-5.5性能低下への補償リセット": "GPT-5.5 degradation compensation reset",
    "長時間セッション圧縮の消費異常に対する補償リセット":
      "Long-session compression usage anomaly compensation reset",
    "Sam氏の投稿をきっかけにしたレート制限リセット":
      "Rate-limit reset triggered by Sam's post",
    "全有料プラン": "All paid plans",
    "全プラン": "All plans",
    "Codexユーザー": "Codex users",
    "対象": "Scope",
    "対象アカウント": "Eligible accounts",
    "内容": "Details",
    "1回分・期限1か月以内": "1 credit; expires within 1 month",
    "任意リセット配布": "Manual reset credit distributed",
    "個人別リセット": "Personal reset",
    "配布": "Distributed",
    "検知": "Detected",
    "実施": "Reset",
    "終了": "Closed",
    "リセット実施": "Reset completed",
    "予告検知": "Notice detected",
    "予告中": "Notice active",
    "定期リセット": "Weekly reset",
    "定期実施": "Weekly cycle",
    "即時リセット": "Immediate reset",
    "詫びリセット": "Compensation reset",
    "ご祝儀リセット": "Celebration reset",
    "予告付き臨時リセット": "Announced temporary reset",
    "コミュニティ予測": "Community signal",
    "その他": "Other",
    "none": "Unknown",
    "不明": "Unknown",
    "8分": "8 minutes",
    "9時間25分": "9 hours 25 minutes",
    "17時間20分": "17 hours 20 minutes",
    "19時間53分": "19 hours 53 minutes",
    "概要は取得できていません。": "No summary is available.",
    "1週間サイクルの定期リセットが実施されました。":
      "A weekly-cycle reset was completed.",
  };

  return dictionary[value] ?? value;
}
