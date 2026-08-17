import { MONITOR_HEALTH_MAX_AGE_SECONDS } from "./radar/monitorHealth";

export const USAGE_MONITOR_FRESH_MAX_AGE_SECONDS = MONITOR_HEALTH_MAX_AGE_SECONDS;

export type UsageMonitorState = {
  sourceKey: string;
  observedAt: string;
  receivedAt: string;
  limitId: string;
  planType: string;
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
};

export type UsageMonitorCoverage =
  | {
      state: "fresh";
      observedAt: Date;
      receivedAt: Date;
      usedPercent: number;
      resetsAt: number;
    }
  | { state: "stale" }
  | { state: "unavailable" };

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp : null;
}

function isValidState(value: UsageMonitorState | null | undefined): value is UsageMonitorState {
  return Boolean(
    value &&
      value.sourceKey === "local-codex-app-server" &&
      value.limitId === "codex" &&
      value.windowDurationMins === 10080 &&
      typeof value.planType === "string" &&
      value.planType.length > 0 &&
      Number.isFinite(value.usedPercent) &&
      value.usedPercent >= 0 &&
      value.usedPercent <= 100 &&
      Number.isInteger(value.resetsAt) &&
      value.resetsAt > 0,
  );
}

export function getUsageMonitorCoverage(
  state: UsageMonitorState | null | undefined,
  now: Date = new Date(),
): UsageMonitorCoverage {
  if (!isValidState(state)) return { state: "unavailable" };

  const nowTime = now.getTime();
  const observedAt = parseDate(state.observedAt);
  const receivedAt = parseDate(state.receivedAt);
  if (!Number.isFinite(nowTime) || !observedAt || !receivedAt) {
    return { state: "unavailable" };
  }

  const observedTime = observedAt.getTime();
  const receivedTime = receivedAt.getTime();
  if (observedTime > nowTime || receivedTime > nowTime || receivedTime < observedTime) {
    return { state: "unavailable" };
  }

  const maxAgeMs = USAGE_MONITOR_FRESH_MAX_AGE_SECONDS * 1000;
  if (nowTime - observedTime > maxAgeMs || nowTime - receivedTime > maxAgeMs) {
    return { state: "stale" };
  }

  return {
    state: "fresh",
    observedAt,
    receivedAt,
    usedPercent: state.usedPercent,
    resetsAt: state.resetsAt,
  };
}
