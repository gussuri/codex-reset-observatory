import { RadarDashboard } from "@/components/RadarDashboard";
import { fetchCurrentRadarData } from "@/lib/radarFetch";

export const revalidate = 300;

export default async function Home() {
  const initialData = await fetchCurrentRadarData({ revalidate });
  const initialFetchedAt = initialData ? new Date().toISOString() : null;

  return (
    <RadarDashboard
      initialData={initialData}
      initialFetchedAt={initialFetchedAt}
    />
  );
}
