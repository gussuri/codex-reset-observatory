import type { Metadata } from "next";
import { AboutView } from "@/components/AboutView";

export const metadata: Metadata = {
  applicationName: "Codex 重置观测所",
  title: {
    absolute: "关于 Codex 重置观测所",
  },
  description:
    "了解 Codex 重置观测所观测的内容、如何处理重置历史，以及为什么每周重置参考日期在手动重置后可能有所不同。",
  alternates: {
    canonical: "/zh/about",
    languages: {
      ja: "/about",
      en: "/en/about",
      zh: "/zh/about",
    },
  },
  openGraph: {
    title: "关于 Codex 重置观测所",
    description:
      "在本站简要了解 Codex 重置历史、每周循环重置参考日、手动重置以及随机重置期望度。",
    url: "/zh/about",
    siteName: "Codex 重置观测所",
    type: "article",
    locale: "zh_CN",
    alternateLocale: ["ja_JP", "en_US"],
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "关于 Codex 重置观测所",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "关于 Codex 重置观测所",
    description:
      "本站简要了解 Codex 重置历史、每周循环重置参考日、手动重置以及随机重置期望度。",
    images: ["/og-image.png"],
  },
};

export default function ChineseAboutPage() {
  return <AboutView locale="zh" />;
}
