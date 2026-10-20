export interface HeartbeatScanSummary {
  articleCount: number;
  timeElementCount: number;
  tweetTextCount: number;
  nonEmptyTweetTextCount: number;
  matchingTiboStatusCount: number;
  translatedTweetCount: number;
  tweetDatetimeCount: number;
  parseSuccessCount: number;
  currentUrl: string;
  selectorVersion: string;
  scanTimestamp: string;
  sessionStartedAt?: string | null;
  documentStartedAt?: string | null;
  scanSequence?: number;
  lastSuccessfulParseAt?: string | null;
  heartbeatObservedAt?: string;
  timelineDiagnostics?: HeartbeatTimelineDiagnostics;
}

export type TiboMonitorTimeline = "profile" | "with_replies";
export type TiboTimelineHealthStatus = "not_open" | "healthy" | "empty" | "stale";
export const HEARTBEAT_TIMELINE_DIAGNOSTICS_VERSION = 2 as const;

export interface HeartbeatTimelineDiagnostic {
  sourceTimeline: TiboMonitorTimeline;
  status: TiboTimelineHealthStatus;
  observedAt: string;
  scanTimestamp?: string | null;
  lastSuccessfulParseAt?: string | null;
  sessionStartedAt?: string | null;
  documentStartedAt?: string | null;
  scanSequence?: number;
  articleCount?: number;
  matchingTiboStatusCount?: number;
  parseSuccessCount?: number;
  selectorVersion?: string;
  recoveryStatus?: string;
  recoveryMoveCount?: number;
  recoveryMaxMoves?: number;
}

export interface HeartbeatTimelineDiagnostics {
  formatVersion: typeof HEARTBEAT_TIMELINE_DIAGNOSTICS_VERSION;
  profile: HeartbeatTimelineDiagnostic;
  with_replies: HeartbeatTimelineDiagnostic;
}

export interface HeartbeatStoredScanSummary extends Partial<Omit<HeartbeatScanSummary, "timelineDiagnostics">> {
  heartbeatObservedAt?: string;
  timelineDiagnostics?: HeartbeatTimelineDiagnostics;
}

export interface HeartbeatRequestBody {
  sessionId?: string | null;
  lastSuccessfulParseAt?: string | null;
  lastSeenTweetId?: string | null;
  newestSeenTweetCreatedAt?: string | null;
  newest_seen_tweet_created_at?: string | null;
  lastScanError?: string | null;
  lastScanSummary?: unknown | null;
  selectorVersion?: string | null;
  last_page_reload_at?: string | null;
  last_page_reload_status?: string | null;
  last_page_reload_error?: string | null;
  last_scan_summary?: unknown | null;
  timelineDiagnostics?: unknown | null;
  heartbeatObservedAt?: unknown | null;
  lastPageReloadAt?: string | null;
  lastPageReloadStatus?: string | null;
  lastPageReloadError?: string | null;
}

export interface ExistingHeartbeatRecord {
  id?: string | null;
  session_id?: string | null;
  session_started_at?: string | null;
  last_heartbeat_at?: string | null;
  heartbeat_count?: number | null;
  max_gap_seconds?: number | null;
  last_successful_parse_at?: string | null;
  last_scan_summary?: unknown | null;
  newest_seen_tweet_created_at?: string | null;
  updated_at?: string | null;
}

export interface HeartbeatRecord {
  id: string;
  session_id: string;
  session_started_at: string;
  last_heartbeat_at: string;
  last_successful_parse_at: string | null;
  last_seen_tweet_id: string | null;
  newest_seen_tweet_created_at?: string | null;
  last_scan_error: string | null;
  selector_version: string;
  last_page_reload_at: string | null;
  last_page_reload_status: string | null;
  last_page_reload_error: string | null;
  last_scan_summary: HeartbeatStoredScanSummary | null;
  heartbeat_count: number;
  max_gap_seconds: number;
  last_gap_seconds: number;
  updated_at: string;
}

const SAFE_SCAN_ERROR_CODES = new Set([
  "translated_text_detected",
  "scan_exception",
  "article_missing",
  "time_element_missing",
  "tweet_text_missing",
  "tweet_text_empty",
  "tibo_status_url_missing",
  "tweet_datetime_missing",
  "no_parse_success",
  "scan_error",
  "timeline_partial",
  "target_not_visible",
  "recovery_user_interrupted",
  "recovery_navigation_interrupted",
  "recovery_scroll_failed",
]);

const SAFE_RECOVERY_STATES = new Set([
  "not_attempted",
  "attempting",
  "in_progress",
  "target_found",
  "target_not_visible",
  "cooldown",
  "user_interrupted",
  "navigation_interrupted",
  "scroll_failed",
]);

const MAX_REPLY_RECOVERY_MOVES = 4;

function normalizeScanError(value: unknown): string | null {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }
  const code = String(value);
  return SAFE_SCAN_ERROR_CODES.has(code) ? code : "scan_error";
}

function normalizeCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10_000, Math.floor(number))) : 0;
}

function normalizeRecoveryStatus(value: unknown): string {
  const status = String(value || "");
  return SAFE_RECOVERY_STATES.has(status) ? status : "not_attempted";
}

function normalizeSafeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function normalizeTimelineDiagnostics(value: unknown): HeartbeatTimelineDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const result = {} as Record<TiboMonitorTimeline, HeartbeatTimelineDiagnostic>;
  if (source.formatVersion !== HEARTBEAT_TIMELINE_DIAGNOSTICS_VERSION) return null;

  for (const timeline of ["profile", "with_replies"] as const) {
    const raw = source[timeline];
    if (!raw || typeof raw !== "object") continue;
    const diagnostic = raw as Record<string, unknown>;
    if (diagnostic.sourceTimeline !== timeline) continue;
    const status = diagnostic.status;
    if (status !== "not_open" && status !== "healthy" && status !== "empty" && status !== "stale") {
      continue;
    }
    const observedAt = normalizeSafeTimestamp(diagnostic.observedAt);
    if (!observedAt) continue;
    const scanTimestamp = normalizeSafeTimestamp(diagnostic.scanTimestamp);
    if (status !== "not_open" && status !== "stale" && !scanTimestamp) continue;
    const sessionStartedAt = normalizeSafeTimestamp(diagnostic.sessionStartedAt);
    const documentStartedAt = normalizeSafeTimestamp(diagnostic.documentStartedAt);
    const parseSuccessCount = normalizeCount(diagnostic.parseSuccessCount);
    let lastSuccessfulParseAt = normalizeSafeTimestamp(diagnostic.lastSuccessfulParseAt);
    if (lastSuccessfulParseAt && sessionStartedAt && lastSuccessfulParseAt < sessionStartedAt) {
      lastSuccessfulParseAt = null;
    }
    if (parseSuccessCount > 0 && scanTimestamp) {
      lastSuccessfulParseAt = !sessionStartedAt || scanTimestamp >= sessionStartedAt
        ? scanTimestamp
        : null;
    }
    const selectorVersionValue = String(diagnostic.selectorVersion || "unknown").slice(0, 100);
    result[timeline] = {
      sourceTimeline: timeline,
      status,
      observedAt,
      scanTimestamp,
      lastSuccessfulParseAt,
      sessionStartedAt,
      documentStartedAt,
      scanSequence: Math.min(1_000_000_000, normalizeCount(diagnostic.scanSequence)),
      articleCount: normalizeCount(diagnostic.articleCount),
      matchingTiboStatusCount: normalizeCount(diagnostic.matchingTiboStatusCount),
      parseSuccessCount,
      selectorVersion: /^[-A-Za-z0-9_.]+$/.test(selectorVersionValue)
        ? selectorVersionValue
        : "unknown",
      recoveryStatus: normalizeRecoveryStatus(diagnostic.recoveryStatus),
      recoveryMoveCount: Math.min(MAX_REPLY_RECOVERY_MOVES, normalizeCount(diagnostic.recoveryMoveCount)),
      recoveryMaxMoves: Math.min(MAX_REPLY_RECOVERY_MOVES, normalizeCount(diagnostic.recoveryMaxMoves)),
    };
  }

  return Object.keys(result).length === 2
    ? { formatVersion: HEARTBEAT_TIMELINE_DIAGNOSTICS_VERSION, ...result }
    : null;
}

function normalizeScanSummary(value: unknown): HeartbeatScanSummary | null {
  if (!value || typeof value !== "object") return null;
  const summary = value as Record<string, unknown>;
  let currentUrl = "";
  try {
    const url = new URL(String(summary.currentUrl || ""));
    const host = url.hostname.toLowerCase();
    if (host !== "x.com" && host !== "twitter.com") return null;
    currentUrl = `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return null;
  }

  const selectorVersion = String(summary.selectorVersion || "unknown").slice(0, 100);
  const scanTimestamp = String(summary.scanTimestamp || "").slice(0, 40);
  if (!/^[-A-Za-z0-9_.]+$/.test(selectorVersion) || !scanTimestamp) return null;

  const timelineDiagnostics = normalizeTimelineDiagnostics(summary.timelineDiagnostics);
  const sessionStartedAt = normalizeSafeTimestamp(summary.sessionStartedAt);
  const documentStartedAt = normalizeSafeTimestamp(summary.documentStartedAt);
  const lastSuccessfulParseAt = normalizeSafeTimestamp(summary.lastSuccessfulParseAt);
  const heartbeatObservedAt = normalizeSafeTimestamp(summary.heartbeatObservedAt);
  return {
    articleCount: normalizeCount(summary.articleCount),
    timeElementCount: normalizeCount(summary.timeElementCount),
    tweetTextCount: normalizeCount(summary.tweetTextCount),
    nonEmptyTweetTextCount: normalizeCount(
      Object.prototype.hasOwnProperty.call(summary, "nonEmptyTweetTextCount")
        ? summary.nonEmptyTweetTextCount
        : summary.tweetTextCount,
    ),
    matchingTiboStatusCount: normalizeCount(summary.matchingTiboStatusCount),
    translatedTweetCount: normalizeCount(summary.translatedTweetCount),
    tweetDatetimeCount: normalizeCount(summary.tweetDatetimeCount),
    parseSuccessCount: normalizeCount(summary.parseSuccessCount),
    currentUrl,
    selectorVersion,
    scanTimestamp,
    sessionStartedAt,
    documentStartedAt,
    scanSequence: Math.min(1_000_000_000, normalizeCount(summary.scanSequence)),
    lastSuccessfulParseAt:
      lastSuccessfulParseAt && (!sessionStartedAt || lastSuccessfulParseAt >= sessionStartedAt)
        ? lastSuccessfulParseAt
        : null,
    ...(heartbeatObservedAt ? { heartbeatObservedAt } : {}),
    ...(timelineDiagnostics ? { timelineDiagnostics } : {}),
  };
}

function getStoredHeartbeatObservedAt(summary: unknown): string | null {
  if (!summary || typeof summary !== "object") return null;
  return normalizeSafeTimestamp((summary as Record<string, unknown>).heartbeatObservedAt);
}

export function isStaleHeartbeatPayload(
  body: HeartbeatRequestBody,
  existing: ExistingHeartbeatRecord | null,
): boolean {
  const existingObservedAt =
    getStoredHeartbeatObservedAt(existing?.last_scan_summary) ??
    normalizeSafeTimestamp(existing?.last_heartbeat_at);
  if (!existingObservedAt) return false;
  const incomingObservedAt = normalizeSafeTimestamp(body.heartbeatObservedAt);
  return !incomingObservedAt || incomingObservedAt <= existingObservedAt;
}

function compareSafeTimestamps(left: string | null | undefined, right: string | null | undefined): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function laterSafeTimestamp(left: string | null | undefined, right: string | null | undefined): string | null {
  if (!left) return right || null;
  if (!right) return left;
  return left >= right ? left : right;
}

function mergeTimelineSlot(
  current: HeartbeatTimelineDiagnostic | undefined,
  incoming: HeartbeatTimelineDiagnostic | undefined,
): HeartbeatTimelineDiagnostic | undefined {
  if (!incoming) return current;
  if (!current) return incoming;

  if (incoming.status === "not_open") {
    if (incoming.observedAt < current.observedAt) return current;
    return {
      ...incoming,
      lastSuccessfulParseAt: current.sessionStartedAt === incoming.sessionStartedAt
        ? laterSafeTimestamp(current.lastSuccessfulParseAt, incoming.lastSuccessfulParseAt)
        : incoming.lastSuccessfulParseAt || null,
    };
  }
  if (current.status === "not_open") {
    if (incoming.observedAt < current.observedAt) return current;
    return incoming;
  }

  const sessionOrder = compareSafeTimestamps(
    incoming.sessionStartedAt || null,
    current.sessionStartedAt || null,
  );
  if (sessionOrder < 0) return current;
  if (sessionOrder > 0) {
    return { ...incoming, lastSuccessfulParseAt: incoming.lastSuccessfulParseAt || null };
  }

  const currentDocument = current.documentStartedAt || null;
  const incomingDocument = incoming.documentStartedAt || null;
  const documentOrder = compareSafeTimestamps(incomingDocument, currentDocument);
  if (documentOrder < 0) return current;
  if (documentOrder > 0) {
    return {
      ...incoming,
      lastSuccessfulParseAt: laterSafeTimestamp(
        current.lastSuccessfulParseAt,
        incoming.lastSuccessfulParseAt,
      ),
    };
  }

  const sequenceOrder = (incoming.scanSequence || 0) - (current.scanSequence || 0);
  const scanOrder = compareSafeTimestamps(incoming.scanTimestamp, current.scanTimestamp);
  if (sequenceOrder < 0 || (sequenceOrder === 0 && scanOrder < 0)) return current;

  const sameScan = sequenceOrder === 0 && scanOrder === 0;
  if (sameScan && incoming.observedAt < current.observedAt) return current;
  const lastSuccessfulParseAt = laterSafeTimestamp(
    current.lastSuccessfulParseAt,
    incoming.lastSuccessfulParseAt,
  );
  return {
    ...incoming,
    observedAt: incoming.observedAt >= current.observedAt ? incoming.observedAt : current.observedAt,
    lastSuccessfulParseAt,
  };
}

function mergeTimelineDiagnostics(
  current: HeartbeatTimelineDiagnostics | null,
  incoming: HeartbeatTimelineDiagnostics | null,
): HeartbeatTimelineDiagnostics | null {
  if (!current) return incoming;
  if (!incoming) return current;
  return {
    formatVersion: HEARTBEAT_TIMELINE_DIAGNOSTICS_VERSION,
    profile: mergeTimelineSlot(current.profile, incoming.profile)!,
    with_replies: mergeTimelineSlot(current.with_replies, incoming.with_replies)!,
  };
}

function normalizeNewestSeenTweetCreatedAt(value: unknown, now: Date): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 5 * 60 * 1000) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

export function withoutHeartbeatDiagnosticColumns(payload: HeartbeatRecord) {
  const {
    last_scan_summary: _ignoredSummary,
    newest_seen_tweet_created_at: _ignoredNewestTweetTime,
    ...legacyPayload
  } = payload;
  return legacyPayload;
}

export function isMissingHeartbeatDiagnosticColumn(
  error: { code?: string; message?: string } | null,
) {
  const message = error?.message?.toLowerCase() || "";
  return Boolean(
    error &&
      (error.code === "PGRST204" ||
        message.includes("last_scan_summary") ||
        message.includes("newest_seen_tweet_created_at")),
  );
}

export function buildHeartbeatRecord(
  body: HeartbeatRequestBody,
  existing: ExistingHeartbeatRecord | null,
  now: Date,
): HeartbeatRecord {
  const nowIso = now.toISOString();
  const normalizedSessionId = body.sessionId || "default_session";

  let sessionStartedAt = existing?.session_started_at || nowIso;
  let heartbeatCount = (existing?.heartbeat_count || 0) + 1;
  let maxGapSeconds = existing?.max_gap_seconds || 0;
  let lastGapSeconds = 0;
  const requestedPageReloadStatus =
    body.last_page_reload_status ?? body.lastPageReloadStatus ?? null;
  const pageReloadStatus =
    requestedPageReloadStatus === null ||
    requestedPageReloadStatus === "success" ||
    requestedPageReloadStatus === "monitored_tab_missing" ||
    requestedPageReloadStatus === "error"
      ? requestedPageReloadStatus
      : "error";
  const requestedScanSummary = body.last_scan_summary ?? body.lastScanSummary;
  const requestedNewestSeenTweetCreatedAt =
    body.newest_seen_tweet_created_at ?? body.newestSeenTweetCreatedAt;
  const newestSeenTweetCreatedAt = laterSafeTimestamp(
    normalizeNewestSeenTweetCreatedAt(requestedNewestSeenTweetCreatedAt, now),
    normalizeNewestSeenTweetCreatedAt(existing?.newest_seen_tweet_created_at, now),
  );

  const isNewSession = existing?.session_id !== normalizedSessionId;
  if (isNewSession) {
    sessionStartedAt = nowIso;
    heartbeatCount = 1;
    maxGapSeconds = 0;
    lastGapSeconds = 0;
  } else if (existing?.last_heartbeat_at) {
    const previousTime = new Date(existing.last_heartbeat_at).getTime();
    lastGapSeconds = Math.max(0, Math.floor((now.getTime() - previousTime) / 1000));
    if (lastGapSeconds > maxGapSeconds) {
      maxGapSeconds = lastGapSeconds;
    }
  }

  const requestedSummary = normalizeScanSummary(requestedScanSummary);
  const existingSummary = normalizeScanSummary(existing?.last_scan_summary);
  const existingSummarySource = existing?.last_scan_summary && typeof existing.last_scan_summary === "object"
    ? existing.last_scan_summary as Record<string, unknown>
    : null;
  const incomingTimelineDiagnostics =
    normalizeTimelineDiagnostics(body.timelineDiagnostics) ??
    normalizeTimelineDiagnostics(requestedSummary?.timelineDiagnostics);
  const timelineDiagnostics = mergeTimelineDiagnostics(
    normalizeTimelineDiagnostics(existingSummarySource?.timelineDiagnostics),
    incomingTimelineDiagnostics,
  );
  const summaryToPersist: HeartbeatStoredScanSummary | null = requestedSummary || existingSummary
    ? { ...(requestedSummary || existingSummary)! }
    : null;
  const heartbeatObservedAt =
    normalizeSafeTimestamp(body.heartbeatObservedAt) ??
    getStoredHeartbeatObservedAt(existing?.last_scan_summary);
  const storedSummary: HeartbeatStoredScanSummary | null = summaryToPersist || timelineDiagnostics || heartbeatObservedAt
    ? {
        ...(summaryToPersist || {}),
        ...(timelineDiagnostics ? { timelineDiagnostics } : {}),
        ...(heartbeatObservedAt ? { heartbeatObservedAt } : {}),
      }
    : null;
  const requestedLastSuccessfulParseAt = normalizeNewestSeenTweetCreatedAt(
    body.lastSuccessfulParseAt,
    now,
  );
  const existingLastSuccessfulParseAt = normalizeNewestSeenTweetCreatedAt(
    existing?.last_successful_parse_at,
    now,
  );
  const lastSuccessfulParseAt = isNewSession
    ? requestedLastSuccessfulParseAt
    : [requestedLastSuccessfulParseAt, existingLastSuccessfulParseAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;

  const record: HeartbeatRecord = {
    id: "main",
    session_id: normalizedSessionId,
    session_started_at: sessionStartedAt,
    last_heartbeat_at: laterSafeTimestamp(
      nowIso,
      normalizeSafeTimestamp(existing?.last_heartbeat_at),
    ) || nowIso,
    last_successful_parse_at: lastSuccessfulParseAt,
    last_seen_tweet_id: body.lastSeenTweetId || null,
    last_scan_error: normalizeScanError(body.lastScanError),
    selector_version: body.selectorVersion || "v1",
    last_page_reload_at: body.last_page_reload_at ?? body.lastPageReloadAt ?? null,
    last_page_reload_status: pageReloadStatus,
    last_page_reload_error: pageReloadStatus === "error" ? "page_reload_error" : null,
    last_scan_summary: storedSummary,
    heartbeat_count: heartbeatCount,
    max_gap_seconds: maxGapSeconds,
    last_gap_seconds: lastGapSeconds,
    updated_at: nowIso,
  };

  if (newestSeenTweetCreatedAt) {
    record.newest_seen_tweet_created_at = newestSeenTweetCreatedAt;
  }

  return record;
}
