export const MONITOR_HEALTH_MAX_AGE_SECONDS = 900;

export type MonitorHealthStatus = "healthy" | "unhealthy";

export type MonitorHealthDetail =
  | "healthy"
  | "heartbeat_missing"
  | "heartbeat_invalid"
  | "heartbeat_stale"
  | "parse_missing"
  | "parse_invalid"
  | "parse_stale"
  | "scan_error"
  | "page_reload_failed";

export interface TiboHeartbeatSnapshot {
  last_heartbeat_at: string | null;
  last_successful_parse_at: string | null;
  last_scan_error: string | null;
  last_page_reload_status: string | null;
  last_page_reload_error: string | null;
}

export interface MonitorHealthResult {
  status: MonitorHealthStatus;
  detail: MonitorHealthDetail;
  heartbeatAgeSeconds?: number;
  parseAgeSeconds?: number;
}

function getTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getAgeSeconds(timestamp: number, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 1000));
}

export function evaluateTiboHeartbeat(
  snapshot: TiboHeartbeatSnapshot | null | undefined,
  now: Date,
): MonitorHealthResult {
  if (!snapshot || snapshot.last_heartbeat_at === null) {
    return { status: "unhealthy", detail: "heartbeat_missing" };
  }

  const heartbeatTimestamp = getTimestamp(snapshot.last_heartbeat_at);
  if (heartbeatTimestamp === null) {
    return { status: "unhealthy", detail: "heartbeat_invalid" };
  }

  const heartbeatAgeSeconds = getAgeSeconds(heartbeatTimestamp, now);
  if (heartbeatAgeSeconds > MONITOR_HEALTH_MAX_AGE_SECONDS) {
    const parseTimestamp = getTimestamp(snapshot.last_successful_parse_at);
    if (parseTimestamp === null) {
      return {
        status: "unhealthy",
        detail: "heartbeat_stale",
        heartbeatAgeSeconds,
      };
    }

    return {
      status: "unhealthy",
      detail: "heartbeat_stale",
      heartbeatAgeSeconds,
      parseAgeSeconds: getAgeSeconds(parseTimestamp, now),
    };
  }

  if (snapshot.last_successful_parse_at === null) {
    return {
      status: "unhealthy",
      detail: "parse_missing",
      heartbeatAgeSeconds,
    };
  }

  const parseTimestamp = getTimestamp(snapshot.last_successful_parse_at);
  if (parseTimestamp === null) {
    return {
      status: "unhealthy",
      detail: "parse_invalid",
      heartbeatAgeSeconds,
    };
  }

  const parseAgeSeconds = getAgeSeconds(parseTimestamp, now);
  if (parseAgeSeconds > MONITOR_HEALTH_MAX_AGE_SECONDS) {
    return {
      status: "unhealthy",
      detail: "parse_stale",
      heartbeatAgeSeconds,
      parseAgeSeconds,
    };
  }

  if (snapshot.last_scan_error !== null) {
    return {
      status: "unhealthy",
      detail: "scan_error",
      heartbeatAgeSeconds,
      parseAgeSeconds,
    };
  }

  if (
    snapshot.last_page_reload_status !== "success" &&
    snapshot.last_page_reload_status !== null
  ) {
    return {
      status: "unhealthy",
      detail: "page_reload_failed",
      heartbeatAgeSeconds,
      parseAgeSeconds,
    };
  }

  return {
    status: "healthy",
    detail: "healthy",
    heartbeatAgeSeconds,
    parseAgeSeconds,
  };
}
