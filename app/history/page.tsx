import type { Metadata } from "next";
import { HistoryView } from "@/components/HistoryView";
import { fetchCurrentRadarData } from "@/lib/radarFetch";

export const metadata: Metadata = {
  title: "リセット履歴",
  description:
    "Codexの臨時リセット、補償リセット、ご祝儀リセット、公式予告、1週間サイクルの定期リセット、任意リセット配布履歴を日本語で確認できます。",
  alternates: {
    canonical: "/history",
    languages: {
      ja: "/history",
      en: "/en/history",
      zh: "/zh/history",
    },
  },
};

export const revalidate = 300;

export default async function HistoryPage() {
  const data = await fetchCurrentRadarData({ revalidate });

  return <HistoryView data={data} locale="ja" />;
}
