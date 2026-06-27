import type { Metadata } from "next";
import { HistoryView } from "@/components/HistoryView";
import { fetchCurrentRadarData } from "@/lib/radarFetch";

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
      zh: "/zh/history",
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

  return <HistoryView data={data} locale="en" />;
}
