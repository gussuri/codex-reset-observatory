import type { Metadata } from "next";
import { AboutView } from "@/components/AboutView";

export const metadata: Metadata = {
  title: "このサイトについて",
  description:
    "Codexリセット観測所は、Codexのリセット情報を観測・整理する非公式サイトです。",
  alternates: {
    canonical: "/about",
    languages: {
      ja: "/about",
      en: "/en/about",
      zh: "/zh/about",
    },
  },
};

export default function AboutPage() {
  return <AboutView locale="ja" />;
}
