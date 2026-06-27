import type { Metadata } from "next";
import { HistoryView } from "@/components/HistoryView";
import { fetchCurrentRadarData } from "@/lib/radarFetch";

export const metadata: Metadata = {
  applicationName: "Codex 重置观测所",
  title: {
    absolute: "Codex 重置历史 | 确认最近的重置记录",
  },
  description:
    "在简体中文中确认最近的 Codex 重置历史、故障补偿重置、庆祝重置、每周循环重置以及手动重置额度发放记录。",
  alternates: {
    canonical: "/zh/history",
    languages: {
      ja: "/history",
      en: "/en/history",
      zh: "/zh/history",
    },
  },
  openGraph: {
    title: "Codex 重置历史",
    description:
      "确认最近的 Codex 重置历史、每周循环重置以及手动重置额度发放记录。",
    url: "/zh/history",
    siteName: "Codex 重置观测所",
    type: "article",
    locale: "zh_CN",
    alternateLocale: ["ja_JP", "en_US"],
    images: [
      {
        url: "/og-image.png",
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
    images: ["/og-image.png"],
  },
};

export const revalidate = 300;

export default async function ChineseHistoryPage() {
  const data = await fetchCurrentRadarData({ revalidate });

  return <HistoryView data={data} locale="zh" />;
}
