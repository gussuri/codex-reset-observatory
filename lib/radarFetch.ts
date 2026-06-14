import { getLocalRadarData } from "@/lib/radar";
import type { RadarData } from "@/lib/radar";

export const API_CACHE_CONTROL = "s-maxage=300, stale-while-revalidate=600";

export async function fetchCurrentRadarData(
  options: { cache?: RequestCache; revalidate?: number } = {},
): Promise<RadarData> {
  void options;
  return getLocalRadarData();
}
