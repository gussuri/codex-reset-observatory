import type { CachedRadarData, RadarData } from "./types";

export type RadarLoadState = {
  data: RadarData | null;
  fetchedAt: string | null;
  isStale: boolean;
  refreshError: "request_failed" | null;
};

export type DashboardDataState = "ready" | "degraded" | "stale" | "unavailable";

export function applyRefreshSuccess(
  data: RadarData,
  fetchedAt: string,
): RadarLoadState {
  return {
    data,
    fetchedAt,
    isStale: false,
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

  if (state.data.data_health?.overall === "degraded") {
    return "degraded";
  }

  return "ready";
}
