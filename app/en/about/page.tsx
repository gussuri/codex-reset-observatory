import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  applicationName: "Codex Reset Observatory",
  title: {
    absolute: "About Codex Reset Observatory",
  },
  description:
    "Learn what Codex Reset Observatory tracks, how reset history is handled, and why weekly reset references may differ after manual resets.",
  alternates: {
    canonical: "/en/about",
    languages: {
      ja: "/about",
      en: "/en/about",
    },
  },
  openGraph: {
    title: "About Codex Reset Observatory",
    description:
      "A short explanation of the reset history, weekly reset reference, manual reset, and random reset probability shown on this unofficial Codex reset site.",
    url: "/en/about",
    siteName: "Codex Reset Observatory",
    type: "article",
    locale: "en_US",
    alternateLocale: ["ja_JP"],
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Codex Reset Observatory",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "About Codex Reset Observatory",
    description:
      "What this unofficial Codex reset site tracks and how to read its reset references.",
    images: ["/og-image.png"],
  },
};

export default function EnglishAboutPage() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8" lang="en">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <p className="text-sm font-medium text-teal-700">
            Codex reset reference
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
            About Codex Reset Observatory
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            An unofficial reference site for Codex reset history, weekly reset
            references, manual reset credits, and random reset signals.
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="space-y-4 text-sm leading-7 text-slate-700">
            <p>
              Codex Reset Observatory collects reset-related information in one
              place so users can quickly check recent reset history and the
              current reset situation.
            </p>
            <p>
              It brings together official reset notices, past reset history, and
              a weekly-cycle reference date so you can compare what is happening
              now with earlier reset patterns.
            </p>
            <p>
              The weekly reset date is a shared reference, not a guarantee that
              every account will refresh on exactly the same date.
            </p>
            <p>
              The random reset probability is a reference estimate based on
              public signals, usage-limit anomalies, community activity, and
              official updates. It is not an official OpenAI notice.
            </p>
            <p>
              Manual reset credits are account-specific. If you use one, your
              next weekly reset date will differ from the shared reference date
              shown here.
            </p>
          </div>
        </section>

        <nav className="flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en">
            English top
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en/faq">
            FAQ
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en/history">
            History
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/about">
            Japanese about
          </Link>
        </nav>
      </div>
    </main>
  );
}
