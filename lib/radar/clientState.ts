import type { CachedRadarData, PublicRadarSnapshot } from "./types";

export type RadarLoadState = {
  data: PublicRadarSnapshot | null;
  fetchedAt: string | null;
  isStale: boolean;
  refreshError: "request_failed" | null;
};

export type DashboardDataState = "ready" | "degraded" | "stale" | "unavailable";

export function applyRefreshSuccess(
  data: PublicRadarSnapshot,
  fetchedAt: string,
): RadarLoadState {
  return {
    data,
    fetchedAt,
    isStale: data.dataHealth.stale,
    refreshError: null,
  };
}

export function applyRefreshFailure(
  current: RadarLoadState,
  cached: CachedRadarData | null,
): RadarLoadState {
  if (current.data) {
    return {
      data: current.data,
      fetchedAt: current.fetchedAt,
      isStale: true,
      refreshError: "request_failed",
    };
  }

  return {
    data: cached?.data ?? null,
    fetchedAt: cached?.fetchedAt ?? null,
    isStale: true,
    refreshError: "request_failed",
  };
}

export function getDashboardDataState(
  state: RadarLoadState,
): DashboardDataState {
  if (!state.data) {
    return "unavailable";
  }

  if (state.isStale) {
    return "stale";
  }

  if (state.data.dataHealth.overall === "degraded") {
    return "degraded";
  }

  return "ready";
}
