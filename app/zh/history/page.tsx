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
  title: {
    absolute: "Codex 重置历史 | 确认最近的重置记录",
  },
  description:
    "在简体中文中确认最近的 Codex 重置历史、故障补偿重置、庆祝重置、每周循环重置以及手动重置额度发放记录。",
  alternates: {
    canonical: siteUrl("/zh/history"),
    languages: {
      ja: siteUrl("/history"),
      en: siteUrl("/en/history"),
      zh: siteUrl("/zh/history"),
    },
  },
  openGraph: {
    title: "Codex 重置历史",
    description:
      "确认最近的 Codex 重置历史、每周循环重置以及手动重置额度发放记录。",
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
      "确认最近的 Codex 重置历史、每周循环重置以及手动重置额度发放记录。",
    images: [SITE_OG_IMAGE_URL],
  },
};

export const revalidate = 300;

export default async function ChineseHistoryPage() {
  const data = await fetchCurrentRadarData({ revalidate });

  return <HistoryView data={data} locale="zh" />;
}
