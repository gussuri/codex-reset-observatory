import type { Metadata } from "next";
import { RadarDashboard } from "@/components/RadarDashboard";
import { fetchCurrentRadarData } from "@/lib/radarFetch";

export const revalidate = 300;

export const metadata: Metadata = {
  applicationName: "Codex Reset Observatory",
  title: {
    absolute: "Codex Usage Limits Reset Forecast & History",
  },
  description:
    "Track the likelihood of an OpenAI Codex usage-limit reset, recent signals, and past reset events. This site estimates whether another reset is likely within the next 24 or 48 hours.",
  keywords: [
    "Codex reset",
    "Codex usage limit reset",
    "Codex manual reset",
    "Codex reset history",
    "OpenAI Codex reset",
  ],
  alternates: {
    canonical: "/en",
    languages: {
      ja: "/",
      en: "/en",
      zh: "/zh",
    },
  },
  openGraph: {
    title: "Codex Usage Limits Reset Forecast & History",
    description:
      "Track the likelihood of an OpenAI Codex usage-limit reset, recent signals, and past reset events. This site estimates whether another reset is likely within the next 24 or 48 hours.",
    url: "/en",
    siteName: "Codex Reset Observatory",
    type: "website",
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
    title: "Codex Usage Limits Reset Forecast & History",
    description:
      "Track the likelihood of an OpenAI Codex usage-limit reset, recent signals, and past reset events. This site estimates whether another reset is likely within the next 24 or 48 hours.",
    images: ["/og-image.png"],
  },
};

export default async function EnglishHome() {
  const initialData = await fetchCurrentRadarData({ revalidate });
  const initialFetchedAt = initialData ? new Date().toISOString() : null;

  return (
    <RadarDashboard
      initialData={initialData}
      initialFetchedAt={initialFetchedAt}
      locale="en"
    />
  );
}
