import type { Metadata } from "next";
import { FaqView } from "@/components/FaqView";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Codexのリセットタイミング、トークン・使用量・制限・レートのリセット、期待度、公式予告とコミュニティ予測の違いを説明します。",
  keywords: [
    "Codex リセット",
    "Codex リセット タイミング",
    "Codex トークン リセット",
    "Codex 使用量 リセット",
    "Codex 制限 リセット",
    "Codex レート リセット",
    "Codex CLI リセット",
    "Codex コンテキスト リセット",
  ],
  alternates: {
    canonical: "/faq",
    languages: {
      ja: "/faq",
      en: "/en/faq",
      zh: "/zh/faq",
    },
  },
};

export default function FaqPage() {
  return <FaqView locale="ja" />;
}
