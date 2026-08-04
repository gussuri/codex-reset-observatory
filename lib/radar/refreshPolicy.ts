import { getRefreshIntervalMs } from "./helpers";
import type { PublicRadarSnapshot } from "./types";

export const RADAR_FETCH_TIMEOUT_MS = 15_000;

const REFRESH_RETRY_INTERVALS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
] as const;

export type RefreshPlan = {
  action: "fetch" | "wait";
  delayMs: number;
};

export type RefreshEnvironment = {
  visibilityState: string;
  onLine: boolean;
  inFlight: boolean;
};

function getValidTime(value: string | null | undefined) {
  if (!value) return null;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function getFreshDataRemainingMs(
  data: PublicRadarSnapshot | null | undefined,
  fetchedAt: string | null | undefined,
  nowMs: number,
) {
  if (!data || data.dataHealth.stale || data.dataHealth.overall === "degraded") {
    return null;
  }

  const fetchedTime = getValidTime(fetchedAt);
  if (fetchedTime === null || !Number.isFinite(nowMs)) return null;

  const elapsedMs = nowMs - fetchedTime;
  if (elapsedMs < 0) return null;

  const intervalMs = getRefreshIntervalMs(data.viewModel.probability24h);
  return Math.max(0, intervalMs - elapsedMs);
}

export function getInitialRefreshPlan(
  data: PublicRadarSnapshot | null | undefined,
  fetchedAt: string | null | undefined,
  nowMs = Date.now(),
): RefreshPlan {
  const remainingMs = getFreshDataRemainingMs(data, fetchedAt, nowMs);

  if (remainingMs === null || remainingMs === 0) {
    return { action: "fetch", delayMs: 0 };
  }

  return { action: "wait", delayMs: remainingMs };
}

export function getRefreshRetryDelayMs(failureCount: number) {
  const normalizedCount = Number.isFinite(failureCount)
    ? Math.max(1, Math.floor(failureCount))
    : 1;
  const index = Math.min(normalizedCount, REFRESH_RETRY_INTERVALS_MS.length) - 1;
  return REFRESH_RETRY_INTERVALS_MS[index];
}

export function canStartRadarRefresh(environment: RefreshEnvironment) {
  return (
    environment.visibilityState === "visible" &&
    environment.onLine &&
    !environment.inFlight
  );
}

export function startAbortTimeout<T>(
  controller: AbortController,
  timeoutMs: number,
  setTimeoutFn: (callback: () => void, delayMs: number) => T,
  clearTimeoutFn: (handle: T) => void,
) {
  let timedOut = false;
  const handle = setTimeoutFn(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    hasTimedOut: () => timedOut,
    cancel: () => clearTimeoutFn(handle),
  };
}
