import type { Metadata } from "next";
import { RadarDashboard } from "@/components/RadarDashboard";
import { fetchCurrentRadarData } from "@/lib/radarFetch";

export const revalidate = 300;

export const metadata: Metadata = {
  applicationName: "Codex Reset Observatory",
  title: {
    absolute: "Codex Reset Observatory | Codex reset history and manual resets",
  },
  description:
    "Track Codex reset history, official reset notices, weekly reset references, random reset probability, and manual reset behavior in English.",
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
    },
  },
  openGraph: {
    title: "Codex Reset Observatory",
    description:
      "Track Codex reset history, weekly reset references, random reset probability, and manual reset behavior.",
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
    title: "Codex Reset Observatory",
    description:
      "Track Codex reset history, weekly reset references, random reset probability, and manual reset behavior.",
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
