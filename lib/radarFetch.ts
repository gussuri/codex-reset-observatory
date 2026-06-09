import type { RadarData } from "@/lib/radar";
import { translateRadarReasoningSummary } from "@/lib/radar";

export const CURRENT_JSON_URL =
  "https://codexradar.com/current.json";

export const API_CACHE_CONTROL = "s-maxage=300, stale-while-revalidate=600";

const FETCH_TIMEOUT_MS = 8000;

export async function fetchCurrentRadarData(
  options: { cache?: RequestCache; revalidate?: number } = {},
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CURRENT_JSON_URL, {
      headers: {
        accept: "application/json",
      },
      cache: options.cache,
      next:
        typeof options.revalidate === "number"
          ? { revalidate: options.revalidate }
          : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as RadarData;

    return (await translateRadarReasoningSummary(data)) ?? data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
