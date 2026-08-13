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
  title: {
    absolute: "Codex 重置历史 | 确认最近的重置记录",
  },
  description:
    "按时间倒序查看 Codex 全局重置、手动重置发放记录、执行时间和来源。",
  alternates: {
    canonical: siteUrl("/zh/history"),
    languages: {
      ja: siteUrl("/history"),
      en: siteUrl("/en/history"),
      zh: siteUrl("/zh/history"),
      "x-default": siteUrl("/history"),
    },
  },
  openGraph: {
    title: "Codex 重置历史",
    description:
      "按时间倒序查看 Codex 全局重置、手动重置发放记录、执行时间和来源。",
    url: siteUrl("/zh/history"),
    siteName: SITE_NAME,
    type: "article",
    locale: "zh_CN",
    alternateLocale: ["ja_JP", "en_US"],
    images: [
      {
        url: SITE_OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: "Codex 重置历史",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex 重置历史",
    description:
      "按时间倒序查看 Codex 全局重置、手动重置发放记录、执行时间和来源。",
    images: [SITE_OG_IMAGE_URL],
  },
};

export const revalidate = 60;

export default async function ChineseHistoryPage() {
  const data = await fetchPublicRadarSnapshot("zh", { limitHistory: false });

  return <HistoryView data={data} locale="zh" />;
}
