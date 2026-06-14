import { fetchOpenAIStatusSignals } from "@/lib/openaiStatus";
import { getLocalRadarData } from "@/lib/radar";
import type { RadarData } from "@/lib/radar";

export const API_CACHE_CONTROL = "s-maxage=300, stale-while-revalidate=600";

export async function fetchCurrentRadarData(
  options: { cache?: RequestCache; revalidate?: number } = {},
): Promise<RadarData> {
  const openAIStatus = await fetchOpenAIStatusSignals(options);
  return getLocalRadarData({ openAIStatus });
}
