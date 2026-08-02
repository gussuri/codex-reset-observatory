import type { Metadata } from "next";
import { HistoryView } from "@/components/HistoryView";
import { fetchCurrentRadarData } from "@/lib/radarFetch";
import {
  SITE_NAME,
  SITE_OG_IMAGE_URL,
  siteUrl,
} from "@/lib/siteMetadata";

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  title: "リセット履歴",
  description:
    "Codexの臨時リセット、補償リセット、ご祝儀リセット、公式予告、1週間サイクルの定期リセット、任意リセット配布履歴を日本語で確認できます。",
  alternates: {
    canonical: siteUrl("/history"),
    languages: {
      ja: siteUrl("/history"),
      en: siteUrl("/en/history"),
      zh: siteUrl("/zh/history"),
    },
  },
  openGraph: {
    title: "リセット履歴",
    description:
      "Codexの臨時リセット、補償リセット、ご祝儀リセット、公式予告、1週間サイクルの定期リセット、任意リセット配布履歴を日本語で確認できます。",
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
      "Codexの臨時リセット、補償リセット、ご祝儀リセット、公式予告、1週間サイクルの定期リセット、任意リセット配布履歴を日本語で確認できます。",
    images: [SITE_OG_IMAGE_URL],
  },
};

export const revalidate = 300;

export default async function HistoryPage() {
  const data = await fetchCurrentRadarData({ revalidate });

  return <HistoryView data={data} locale="ja" />;
}
