import type { Metadata } from "next";
import { HistoryView } from "@/components/HistoryView";
import { fetchPublicRadarSnapshot } from "@/lib/radarFetch";
import {
  SITE_NAME,
  SITE_OG_IMAGE_URL,
  siteUrl,
} from "@/lib/siteMetadata";

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  title: "リセット履歴",
  description:
    "Codexの全体リセット、任意リセット配布、実施時刻、出典を新しい順に確認できます。",
  alternates: {
    canonical: siteUrl("/history"),
    languages: {
      ja: siteUrl("/history"),
      en: siteUrl("/en/history"),
      zh: siteUrl("/zh/history"),
      "x-default": siteUrl("/history"),
    },
  },
  openGraph: {
    title: "リセット履歴",
    description:
      "Codexの全体リセット、任意リセット配布、実施時刻、出典を新しい順に確認できます。",
    url: siteUrl("/history"),
    siteName: SITE_NAME,
    type: "article",
    locale: "ja_JP",
    images: [{ url: SITE_OG_IMAGE_URL, width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: "リセット履歴",
    description:
      "Codexの全体リセット、任意リセット配布、実施時刻、出典を新しい順に確認できます。",
    images: [SITE_OG_IMAGE_URL],
  },
};

export const revalidate = 900;

export default async function HistoryPage() {
  const data = await fetchPublicRadarSnapshot("ja", { limitHistory: false });

  return <HistoryView data={data} locale="ja" />;
}
