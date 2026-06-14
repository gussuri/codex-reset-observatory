import type { Metadata } from "next";
import Link from "next/link";

const faqs = [
  {
    question: "What does this site track?",
    answer:
      "It tracks Codex reset notices, reset history, weekly-cycle reference dates, and random reset probability. It is an unofficial way to check the current situation and compare it with past reset patterns.",
  },
  {
    question: "Is this an official OpenAI site?",
    answer:
      "No. This is an unofficial reference site. Treat the information here as a guide and confirm important reset timing in Codex or official OpenAI channels.",
  },
  {
    question: "What is the difference between a random reset and a weekly reset?",
    answer:
      "A weekly reset is the regular usage-cycle refresh. A random reset is a temporary reset that may happen because of incidents, compensation, milestones, or other short-term reasons.",
  },
  {
    question: "What happens if I use a manual reset?",
    answer:
      "If you use a manual reset, your account's next weekly reset date will differ from the reference date shown on this site. The manual reset credit is a one-time credit and expires within one month.",
  },
  {
    question: "How are referral resets handled?",
    answer:
      "Referral resets are treated as account-specific personal resets. Distribution records may appear in history, but they are not counted as global resets or as random reset probability signals.",
  },
  {
    question: "How should I read the reset history?",
    answer:
      "The history is organized so you can look back at resets and official notices that were previously confirmed. Account-specific resets, such as manual reset credits and referral resets, are kept separate from global latest-reset signals and random reset probability.",
  },
];

export const metadata: Metadata = {
  applicationName: "Codex Reset Observatory",
  title: {
    absolute: "Codex Reset FAQ | Weekly resets and manual reset credits",
  },
  description:
    "FAQ for Codex reset history, weekly reset references, manual reset credits, referral resets, and random reset probability.",
  keywords: [
    "Codex reset FAQ",
    "Codex manual reset",
    "Codex weekly reset",
    "Codex referral reset",
    "Codex reset history",
  ],
  alternates: {
    canonical: "/en/faq",
    languages: {
      ja: "/faq",
      en: "/en/faq",
    },
  },
  openGraph: {
    title: "Codex Reset FAQ",
    description:
      "FAQ for Codex reset history, weekly reset references, manual reset credits, referral resets, and random reset probability.",
    url: "/en/faq",
    siteName: "Codex Reset Observatory",
    type: "article",
    locale: "en_US",
    alternateLocale: ["ja_JP"],
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Codex Reset FAQ",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Reset FAQ",
    description:
      "FAQ for Codex reset history, weekly reset references, manual reset credits, referral resets, and random reset probability.",
    images: ["/og-image.png"],
  },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

export default function EnglishFaqPage() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8" lang="en">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <p className="text-sm font-medium text-teal-700">
            Codex Reset FAQ
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
            Frequently Asked Questions
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            A short guide to Codex reset timing, history, and manual reset credits.
          </p>
        </header>

        <section className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          {faqs.map((faq) => (
            <article className="py-5 first:pt-0 last:pb-0" key={faq.question}>
              <h2 className="text-lg font-semibold leading-7 text-slate-950">
                {faq.question}
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-700">
                {faq.answer}
              </p>
            </article>
          ))}
        </section>

        <nav className="flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en">
            Back to English top
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en/about">
            About
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en/history">
            History
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/faq">
            Japanese FAQ
          </Link>
        </nav>
      </div>
    </main>
  );
}
