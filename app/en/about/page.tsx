import type { Metadata } from "next";
import { AboutView } from "@/components/AboutView";

export const metadata: Metadata = {
  applicationName: "Codex Reset Observatory",
  title: {
    absolute: "About Codex Reset Observatory",
  },
  description:
    "Learn what Codex Reset Observatory tracks, how reset history is handled, and why weekly reset references may differ after Banked Resets (Banked Resets).",
  alternates: {
    canonical: "/en/about",
    languages: {
      ja: "/about",
      en: "/en/about",
      zh: "/zh/about",
    },
  },
  openGraph: {
    title: "About Codex Reset Observatory",
    description:
      "A short explanation of the reset history, weekly reset reference, Banked Reset, and unscheduled reset probability shown on this unofficial Codex reset site.",
    url: "/en/about",
    siteName: "Codex Reset Observatory",
    type: "article",
    locale: "en_US",
    alternateLocale: ["ja_JP"],
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "About Codex Reset Observatory",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "About Codex Reset Observatory",
    description:
      "What this unofficial Codex reset site tracks and how to read its reset references.",
    images: ["/og-image.png"],
  },
};

export default function EnglishAboutPage() {
  return <AboutView locale="en" />;
}
