import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, History, Info } from "lucide-react";
import {
  getRadarViewModel,
  isSafeHttpUrl,
} from "@/lib/radar";
import { fetchCurrentRadarData } from "@/lib/radarFetch";
import {
  formatEnglishDateTime,
  translateHistoryText,
} from "@/components/EnglishRadarDashboard";

export const metadata: Metadata = {
  applicationName: "Codex Reset Observatory",
  title: {
    absolute: "Codex Reset History | Recent reset events",
  },
  description:
    "Review recent Codex reset history, compensation resets, celebration resets, weekly reset events, and manual reset credit distribution in English.",
  alternates: {
    canonical: "/en/history",
    languages: {
      ja: "/history",
      en: "/en/history",
    },
  },
  openGraph: {
    title: "Codex Reset History",
    description:
      "Recent Codex reset history, weekly reset events, and manual reset credit distribution in English.",
    url: "/en/history",
    siteName: "Codex Reset Observatory",
    type: "article",
    locale: "en_US",
    alternateLocale: ["ja_JP"],
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Codex Reset History",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Reset History",
    description:
      "Recent Codex reset history, weekly reset events, and manual reset credit distribution in English.",
    images: ["/og-image.png"],
  },
};

export const revalidate = 300;

export default async function EnglishHistoryPage() {
  const data = await fetchCurrentRadarData({ revalidate });
  const viewModel = getRadarViewModel(data);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8" lang="en">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-teal-700">
                Codex reset history
              </p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
                Recent Reset Events
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Confirmed reset history, weekly reset events, and manual reset
                credit distribution.
              </p>
            </div>
            <History className="mt-1 h-7 w-7 shrink-0 text-slate-700" />
          </div>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="divide-y divide-slate-100">
            {viewModel.recentHistory.length > 0 ? (
              viewModel.recentHistory.map((item) => (
                <article
                  className="grid gap-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto]"
                  key={item.key}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="ui-heading text-lg font-semibold text-slate-950">
                        {translateHistoryText(item.title)}
                      </h2>
                      {(item.resetTypes ?? [item.resetType]).map((resetType) => (
                        <span
                          className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700"
                          key={resetType}
                        >
                          {translateHistoryText(resetType)}
                        </span>
                      ))}
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {translateHistoryText(item.status)}
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
                    {item.resetAt || item.resetLabel ? (
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
                </article>
              ))
            ) : (
              <p className="text-sm leading-6 text-slate-600">
                No reset history is available yet.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-sky-200 bg-sky-50/90 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
            <div>
              <p className="text-sm font-medium text-sky-700">
                Manual and referral resets
              </p>
              <h2 className="mt-1 text-xl font-semibold leading-tight text-slate-950">
                Account-specific reset credits
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-700">
                Manual reset credits and referral resets are account-specific.
                They may appear in history as distribution records, but they are
                not counted as global reset events.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                A manual reset credit expires within one month. If you use one,
                your next weekly reset date will differ from the shared reference
                date shown on this site.
              </p>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-950 p-5 text-sm text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex flex-wrap gap-3 text-slate-300">
            <Link className="underline-offset-4 hover:underline" href="/en">
              English top
            </Link>
            <Link className="underline-offset-4 hover:underline" href="/en/about">
              About
            </Link>
            <Link className="underline-offset-4 hover:underline" href="/en/faq">
              FAQ
            </Link>
            <Link className="underline-offset-4 hover:underline" href="/history">
              Japanese history
            </Link>
          </nav>
          <p className="font-semibold text-slate-300">Showing reset history.</p>
        </footer>
      </div>
    </main>
  );
}
