import type { Metadata } from "next";
import { FaqView } from "@/components/FaqView";

export const metadata: Metadata = {
  applicationName: "Codex Reset Observatory",
  title: {
    absolute: "Codex Reset FAQ | Timing, usage limits, and manual resets",
  },
  description:
    "FAQ for Codex reset timing, token and usage limit resets, weekly reset references, manual reset credits, and random reset probability.",
  keywords: [
    "Codex reset FAQ",
    "Codex reset timing",
    "Codex token reset",
    "Codex usage reset",
    "Codex limit reset",
    "Codex rate reset",
    "Codex CLI reset",
    "Codex context reset",
    "Codex manual reset",
    "Codex weekly reset",
    "Codex referral reset",
    "Codex reset history",
  ],
  alternates: {
    canonical: "/en/faq",
    languages: {
      ja: "/faq",
      en: "/en/faq",
      zh: "/zh/faq",
    },
  },
  openGraph: {
    title: "Codex Reset FAQ",
    description:
      "FAQ for Codex reset timing, usage limit resets, weekly reset references, manual reset credits, and random reset probability.",
    url: "/en/faq",
    siteName: "Codex Reset Observatory",
    type: "article",
    locale: "en_US",
    alternateLocale: ["ja_JP"],
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Codex Reset FAQ",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Reset FAQ",
    description:
      "FAQ for Codex reset timing, usage limit resets, weekly reset references, manual reset credits, and random reset probability.",
    images: ["/og-image.png"],
  },
};

export default function EnglishFaqPage() {
  return <FaqView locale="en" />;
}
