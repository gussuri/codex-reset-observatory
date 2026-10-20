export const MONITOR_HEALTH_MAX_AGE_SECONDS = 900;
export const MONITOR_PARSE_ALERT_AGE_SECONDS = 1800;

export type MonitorHealthStatus = "healthy" | "warning" | "unhealthy";

export type MonitorHealthDetail =
  | "healthy"
  | "heartbeat_missing"
  | "heartbeat_invalid"
  | "heartbeat_future"
  | "heartbeat_stale"
  | "parse_missing"
  | "parse_invalid"
  | "parse_future"
  | "parse_stale"
  | "scan_error"
  | "page_reload_failed"
  | "timeline_scan_empty"
  | "timeline_scan_stale";

export type MonitorTimeline = "profile" | "with_replies";
export type MonitorTimelineStatus = "not_open" | "healthy" | "empty" | "stale";

export interface MonitorTimelineHealth {
  status: MonitorTimelineStatus;
  scanAgeSeconds?: number;
  lastSuccessfulParseAt?: string | null;
  lastSuccessfulParseAgeSeconds?: number;
  articleCount?: number;
  parseSuccessCount?: number;
  selectorVersion?: string;
  recoveryStatus?: string;
  recoveryMoveCount?: number;
  recoveryMaxMoves?: number;
}

export interface TiboHeartbeatSnapshot {
  session_started_at: string | null;
  last_heartbeat_at: string | null;
  last_successful_parse_at: string | null;
  last_scan_error: string | null;
  last_page_reload_status: string | null;
  last_page_reload_error: string | null;
  last_scan_summary?: {
    timelineDiagnostics?: {
      formatVersion?: number;
      profile?: Record<string, unknown>;
      with_replies?: Record<string, unknown>;
    } | null;
  } | null;
}

export interface MonitorHealthResult {
  status: MonitorHealthStatus;
  detail: MonitorHealthDetail;
  heartbeatAgeSeconds?: number;
  parseAgeSeconds?: number;
  timelines?: Partial<Record<MonitorTimeline, MonitorTimelineHealth>>;
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

function getOperationalFailureDetail(
  snapshot: TiboHeartbeatSnapshot,
): "scan_error" | "page_reload_failed" | null {
  if (snapshot.last_scan_error !== null && snapshot.last_scan_error !== undefined) {
    return "scan_error";
  }

  if (
    snapshot.last_page_reload_status !== "success" &&
    snapshot.last_page_reload_status !== null
  ) {
    return "page_reload_failed";
  }

  return null;
}

function isWithinParseAlertAge(
  sessionStartedAt: string | null,
  now: Date,
): boolean {
  const sessionTimestamp = getTimestamp(sessionStartedAt);
  if (sessionTimestamp === null || sessionTimestamp > now.getTime()) {
    return false;
  }

  return (
    getAgeSeconds(sessionTimestamp, now) <= MONITOR_PARSE_ALERT_AGE_SECONDS
  );
}

function evaluateBaseTiboHeartbeat(
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

  if (heartbeatTimestamp > now.getTime()) {
    return { status: "unhealthy", detail: "heartbeat_future" };
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

    if (parseTimestamp > now.getTime()) {
      return {
        status: "unhealthy",
        detail: "parse_future",
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
    const operationalFailure = getOperationalFailureDetail(snapshot);
    if (operationalFailure) {
      return {
        status: "unhealthy",
        detail: operationalFailure,
        heartbeatAgeSeconds,
      };
    }

    return {
      status: isWithinParseAlertAge(snapshot.session_started_at, now)
        ? "warning"
        : "unhealthy",
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

  if (parseTimestamp > now.getTime()) {
    return {
      status: "unhealthy",
      detail: "parse_future",
      heartbeatAgeSeconds,
    };
  }

  const parseAgeSeconds = getAgeSeconds(parseTimestamp, now);
  if (parseAgeSeconds > MONITOR_HEALTH_MAX_AGE_SECONDS) {
    const operationalFailure = getOperationalFailureDetail(snapshot);
    if (operationalFailure) {
      return {
        status: "unhealthy",
        detail: operationalFailure,
        heartbeatAgeSeconds,
        parseAgeSeconds,
      };
    }

    return {
      status:
        parseAgeSeconds <= MONITOR_PARSE_ALERT_AGE_SECONDS
          ? "warning"
          : "unhealthy",
      detail: "parse_stale",
      heartbeatAgeSeconds,
      parseAgeSeconds,
    };
  }

  const operationalFailure = getOperationalFailureDetail(snapshot);
  if (operationalFailure) {
    return {
      status: "unhealthy",
      detail: operationalFailure,
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

function getTimelineHealth(
  snapshot: TiboHeartbeatSnapshot,
  now: Date,
): Partial<Record<MonitorTimeline, MonitorTimelineHealth>> | null {
  const diagnostics = snapshot.last_scan_summary?.timelineDiagnostics;
  if (!diagnostics || typeof diagnostics !== "object" || diagnostics.formatVersion !== 2) return null;
  const rawSlots: Record<MonitorTimeline, Record<string, unknown> | undefined> = {
    profile: diagnostics.profile,
    with_replies: diagnostics.with_replies,
  };
  for (const timeline of ["profile", "with_replies"] as const) {
    const raw = rawSlots[timeline];
    if (!raw || raw.sourceTimeline !== timeline) return null;
    if (!(["not_open", "healthy", "empty", "stale"] as unknown[]).includes(raw.status)) return null;
    if (getTimestamp(raw.observedAt) === null) return null;
  }

  const result: Partial<Record<MonitorTimeline, MonitorTimelineHealth>> = {};

  for (const timeline of ["profile", "with_replies"] as const) {
    const diagnostic = rawSlots[timeline]!;
    const observedAtTimestamp = getTimestamp(diagnostic.observedAt)!;
    const sessionTimestamp = getTimestamp(diagnostic.sessionStartedAt);
    const rawSessionStart = diagnostic.sessionStartedAt;
    const invalidSessionStart = rawSessionStart != null && sessionTimestamp === null;
    const lastSuccessfulTimestamp = getTimestamp(diagnostic.lastSuccessfulParseAt);
    const safeLastSuccessfulTimestamp =
      lastSuccessfulTimestamp !== null &&
      lastSuccessfulTimestamp <= now.getTime() &&
      (sessionTimestamp === null || lastSuccessfulTimestamp >= sessionTimestamp)
        ? lastSuccessfulTimestamp
        : null;
    const lastSuccessfulParseAt = safeLastSuccessfulTimestamp === null
      ? null
      : new Date(safeLastSuccessfulTimestamp).toISOString();
    const lastSuccessfulParseAgeSeconds = safeLastSuccessfulTimestamp === null
      ? undefined
      : getAgeSeconds(safeLastSuccessfulTimestamp, now);

    if (diagnostic.status === "not_open") {
      result[timeline] = {
        status: "not_open",
        lastSuccessfulParseAt,
        ...(lastSuccessfulParseAgeSeconds === undefined ? {} : { lastSuccessfulParseAgeSeconds }),
      };
      continue;
    }

    const scanTimestamp = getTimestamp(diagnostic.scanTimestamp);
    const scanAgeSeconds = scanTimestamp === null
      ? undefined
      : getAgeSeconds(scanTimestamp, now);
    const stale =
      scanTimestamp === null ||
      scanTimestamp > now.getTime() ||
      observedAtTimestamp > now.getTime() ||
      invalidSessionStart ||
      (sessionTimestamp !== null && scanTimestamp < sessionTimestamp) ||
      scanAgeSeconds === undefined ||
      scanAgeSeconds > MONITOR_HEALTH_MAX_AGE_SECONDS;
    const parseSuccessCount = Math.max(0, Math.min(10_000, Math.floor(Number(diagnostic.parseSuccessCount) || 0)));
    let currentLastSuccessfulParseAt = lastSuccessfulParseAt;
    let currentLastSuccessfulParseAgeSeconds = lastSuccessfulParseAgeSeconds;
    if (
      parseSuccessCount > 0 &&
      scanTimestamp !== null &&
      scanTimestamp <= now.getTime() &&
      (sessionTimestamp === null || scanTimestamp >= sessionTimestamp)
    ) {
      currentLastSuccessfulParseAt = new Date(scanTimestamp).toISOString();
      currentLastSuccessfulParseAgeSeconds = getAgeSeconds(scanTimestamp, now);
    }
    const status: MonitorTimelineStatus = stale
      ? "stale"
      : parseSuccessCount > 0
        ? "healthy"
        : "empty";
    const selectorVersion = /^[\w.-]{1,100}$/.test(String(diagnostic.selectorVersion || ""))
      ? String(diagnostic.selectorVersion)
      : "unknown";
    const recoveryStatus = /^[\w.-]{1,64}$/.test(String(diagnostic.recoveryStatus || ""))
      ? String(diagnostic.recoveryStatus)
      : "not_attempted";

    result[timeline] = {
      status,
      ...(scanAgeSeconds === undefined ? {} : { scanAgeSeconds }),
      lastSuccessfulParseAt: currentLastSuccessfulParseAt,
      ...(currentLastSuccessfulParseAgeSeconds === undefined ? {} : { lastSuccessfulParseAgeSeconds: currentLastSuccessfulParseAgeSeconds }),
      articleCount: Math.max(0, Math.min(10_000, Math.floor(Number(diagnostic.articleCount) || 0))),
      parseSuccessCount,
      selectorVersion,
      recoveryStatus,
      recoveryMoveCount: Math.max(0, Math.min(4, Math.floor(Number(diagnostic.recoveryMoveCount) || 0))),
      recoveryMaxMoves: Math.max(0, Math.min(4, Math.floor(Number(diagnostic.recoveryMaxMoves) || 0))),
    };
  }

  return Object.keys(result).length > 0 ? result : null;
}

export function evaluateTiboHeartbeat(
  snapshot: TiboHeartbeatSnapshot | null | undefined,
  now: Date,
): MonitorHealthResult {
  const base = evaluateBaseTiboHeartbeat(snapshot, now);
  if (!snapshot) return base;
  const timelines = getTimelineHealth(snapshot, now);
  if (!timelines) return base;

  const hasOpenTimeline = Object.values(timelines).some((timeline) => timeline?.status !== "not_open");
  if (!hasOpenTimeline) return base;

  const hardFailure =
    base.detail.startsWith("heartbeat_") ||
    base.detail === "scan_error" ||
    base.detail === "page_reload_failed";
  if (hardFailure) return { ...base, timelines };

  const timelineStale = Object.values(timelines).some((timeline) => timeline?.status === "stale");
  const timelineEmpty = Object.values(timelines).some((timeline) => timeline?.status === "empty");
  const timelineParseAges = Object.values(timelines)
    .filter((timeline) => timeline && timeline.status !== "not_open")
    .map((timeline) => timeline!.lastSuccessfulParseAgeSeconds)
    .filter((age): age is number => age !== undefined);
  const parseAgeSeconds = timelineParseAges.length > 0 ? Math.min(...timelineParseAges) : undefined;
  const heartbeatAgeSeconds = base.heartbeatAgeSeconds;
  if (timelineStale) {
    return {
      status: "unhealthy",
      detail: "timeline_scan_stale",
      ...(heartbeatAgeSeconds === undefined ? {} : { heartbeatAgeSeconds }),
      ...(parseAgeSeconds === undefined ? {} : { parseAgeSeconds }),
      timelines,
    };
  }
  if (timelineEmpty) {
    return {
      status: "warning",
      detail: "timeline_scan_empty",
      ...(heartbeatAgeSeconds === undefined ? {} : { heartbeatAgeSeconds }),
      ...(parseAgeSeconds === undefined ? {} : { parseAgeSeconds }),
      timelines,
    };
  }
  return {
    status: "healthy",
    detail: "healthy",
    ...(heartbeatAgeSeconds === undefined ? {} : { heartbeatAgeSeconds }),
    ...(parseAgeSeconds === undefined ? {} : { parseAgeSeconds }),
    timelines,
  };
}
