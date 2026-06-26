import type { Metadata } from "next";
import { RadarDashboard } from "@/components/RadarDashboard";
import { fetchCurrentRadarData } from "@/lib/radarFetch";

export const revalidate = 300;

export const metadata: Metadata = {
  applicationName: "Codex 重置观测所",
  title: {
    absolute: "Codex 重置观测所 | Codex 重置历史与使用限制重置",
  },
  description:
    "在简体中文中确认 Codex 使用限制重置历史、官方重置预告、每周循环重置参考日、随机重置概率以及手动重置行为。",
  keywords: [
    "Codex 重置",
    "Codex 使用限制重置",
    "Codex 手动重置",
    "Codex 重置历史",
    "OpenAI Codex 重置",
  ],
  alternates: {
    canonical: "/zh",
    languages: {
      ja: "/",
      en: "/en",
      zh: "/zh",
    },
  },
  openGraph: {
    title: "Codex 重置观测所",
    description:
      "确认 Codex 使用限制重置历史、每周循环重置参考日、随机重置概率以及手动重置行为。",
    url: "/zh",
    siteName: "Codex 重置观测所",
    type: "website",
    locale: "zh_CN",
    alternateLocale: ["ja_JP", "en_US"],
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Codex 重置观测所",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex 重置观测所",
    description:
      "确认 Codex 使用限制重置历史、每周循环重置参考日、随机重置概率以及手动重置行为。",
    images: ["/og-image.png"],
  },
};

export default async function ChineseHome() {
  const initialData = await fetchCurrentRadarData({ revalidate });
  const initialFetchedAt = initialData ? new Date().toISOString() : null;

  return (
    <RadarDashboard
      initialData={initialData}
      initialFetchedAt={initialFetchedAt}
      locale="zh"
    />
  );
}
