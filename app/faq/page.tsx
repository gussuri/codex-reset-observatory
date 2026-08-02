import type { Metadata } from "next";
import { FaqView } from "@/components/FaqView";
import {
  SITE_NAME,
  SITE_OG_IMAGE_URL,
  siteUrl,
} from "@/lib/siteMetadata";

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  title: "FAQ",
  description:
    "Codexのリセットタイミング、トークン・使用量・制限・レートのリセット、期待度、公式予告とコミュニティ予測の違いを説明します。",
  alternates: {
    canonical: siteUrl("/faq"),
    languages: {
      ja: siteUrl("/faq"),
      en: siteUrl("/en/faq"),
      zh: siteUrl("/zh/faq"),
    },
  },
  openGraph: {
    title: "FAQ",
    description:
      "Codexのリセットタイミング、トークン・使用量・制限・レートのリセット、期待度、公式予告とコミュニティ予測の違いを説明します。",
    url: siteUrl("/faq"),
    siteName: SITE_NAME,
    type: "article",
    locale: "ja_JP",
    images: [{ url: SITE_OG_IMAGE_URL, width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ",
    description:
      "Codexのリセットタイミング、トークン・使用量・制限・レートのリセット、期待度、公式予告とコミュニティ予測の違いを説明します。",
    images: [SITE_OG_IMAGE_URL],
  },
};

export default function FaqPage() {
  return <FaqView locale="ja" />;
}
