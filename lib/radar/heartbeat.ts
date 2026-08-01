export interface HeartbeatRequestBody {
  sessionId?: string | null;
  lastSuccessfulParseAt?: string | null;
  lastSeenTweetId?: string | null;
  lastScanError?: string | null;
  selectorVersion?: string | null;
  last_page_reload_at?: string | null;
  last_page_reload_status?: string | null;
  last_page_reload_error?: string | null;
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
}

export interface HeartbeatRecord {
  id: string;
  session_id: string;
  session_started_at: string;
  last_heartbeat_at: string;
  last_successful_parse_at: string | null;
  last_seen_tweet_id: string | null;
  last_scan_error: string | null;
  selector_version: string;
  last_page_reload_at: string | null;
  last_page_reload_status: string | null;
  last_page_reload_error: string | null;
  heartbeat_count: number;
  max_gap_seconds: number;
  last_gap_seconds: number;
  updated_at: string;
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

  return {
    id: "main",
    session_id: normalizedSessionId,
    session_started_at: sessionStartedAt,
    last_heartbeat_at: nowIso,
    last_successful_parse_at: body.lastSuccessfulParseAt || null,
    last_seen_tweet_id: body.lastSeenTweetId || null,
    last_scan_error: body.lastScanError || null,
    selector_version: body.selectorVersion || "v1",
    last_page_reload_at: body.last_page_reload_at ?? body.lastPageReloadAt ?? null,
    last_page_reload_status: body.last_page_reload_status ?? body.lastPageReloadStatus ?? null,
    last_page_reload_error: body.last_page_reload_error ?? body.lastPageReloadError ?? null,
    heartbeat_count: heartbeatCount,
    max_gap_seconds: maxGapSeconds,
    last_gap_seconds: lastGapSeconds,
    updated_at: nowIso,
  };
}
