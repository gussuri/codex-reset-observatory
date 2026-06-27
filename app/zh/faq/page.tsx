import type { Metadata } from "next";
import { FaqView } from "@/components/FaqView";

export const metadata: Metadata = {
  applicationName: "Codex 重置观测所",
  title: {
    absolute: "Codex 重置 FAQ | 重置时机、使用限制与手动重置额度",
  },
  description:
    "关于 Codex 重置具体时机、Token 和使用额度重置、每周循环重置参考日、手动重置额度以及随机重置期望度的常见问题解答。",
  keywords: [
    "Codex 重置 FAQ",
    "Codex 重置时机",
    "Codex token 重置",
    "Codex 使用额度重置",
    "Codex 限制重置",
    "Codex 速率重置",
    "Codex CLI 重置",
    "Codex 上下文重置",
    "Codex 手动重置",
    "Codex 每周重置",
    "Codex 推荐奖励重置",
    "Codex 重置历史",
  ],
  alternates: {
    canonical: "/zh/faq",
    languages: {
      ja: "/faq",
      en: "/en/faq",
      zh: "/zh/faq",
    },
  },
  openGraph: {
    title: "Codex 重置 FAQ",
    description:
      "关于 Codex 重置具体时机、使用额度重置、每周循环重置参考日、手动重置以及随机重置期望度的常见问题解答。",
    url: "/zh/faq",
    siteName: "Codex 重置观测所",
    type: "article",
    locale: "zh_CN",
    alternateLocale: ["ja_JP", "en_US"],
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Codex 重置 FAQ",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex 重置 FAQ",
    description:
      "关于 Codex 重置具体时机、使用额度重置、每周循环重置参考日、手动重置以及随机重置期望度的常见问题解答。",
    images: ["/og-image.png"],
  },
};

export default function ChineseFaqPage() {
  return <FaqView locale="zh" />;
}
