import type { RadarData } from "@/lib/radar";

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
      redirect: "manual",
      next:
        typeof options.revalidate === "number"
          ? { revalidate: options.revalidate }
          : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      return null;
    }

    return (await response.json()) as RadarData;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
