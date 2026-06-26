import type { Metadata } from "next";
import { RadarDashboard } from "@/components/RadarDashboard";
import { fetchCurrentRadarData } from "@/lib/radarFetch";

export const revalidate = 300;

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: {
      ja: "/",
      en: "/en",
      zh: "/zh",
    },
  },
};

export default async function Home() {
  const initialData = await fetchCurrentRadarData({ revalidate });
  const initialFetchedAt = initialData ? new Date().toISOString() : null;

  return (
    <RadarDashboard
      initialData={initialData}
      initialFetchedAt={initialFetchedAt}
      locale="ja"
    />
  );
}
