(function (global) {
  "use strict";

  const LOG_KEY = "tibo_diagnostic_logs";
  const ENABLED_KEY = "tibo_diagnostics_enabled";
  const MASK_TEXT_KEY = "tibo_diagnostics_mask_text";
  const LAST_SUCCESS_KEY = "tibo_diagnostics_last_success_at";
  const TIMELINE_SCAN_SUMMARIES_KEY = "tibo_timeline_scan_summaries";
  const TIMELINE_DIAGNOSTICS_FORMAT_VERSION = 2;
  const MAX_ENTRIES = 20;
  const MAX_TOTAL_CHARS = 1_000_000;
  const MAX_MESSAGE_CHARS = 2_000;
  const MAX_SNAPSHOT_CHARS = 20_000;
  const DEDUP_WINDOW_MS = 30 * 1000;
  const MAX_REPLY_RECOVERY_MOVES = 4;
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
    "monitored_tab_missing",
    "timeline_stalled",
    "scan_error",
    "reply_parent_retry",
    "timeline_partial",
    "target_not_visible",
    "recovery_user_interrupted",
    "recovery_navigation_interrupted",
    "recovery_scroll_failed",
  ]);

  let writeQueue = Promise.resolve();

  const SUMMARY_FINGERPRINT_FIELDS = [
    "articleCount",
    "timeElementCount",
    "tweetTextCount",
    "nonEmptyTweetTextCount",
    "matchingTiboStatusCount",
    "translatedTweetCount",
    "replyParentFoundCount",
    "replyParentMissingCount",
    "replyParentExpansionRequestedCount",
    "replyParentContextReadyCount",
    "replyParentRetryCount",
    "recoveryMoveCount",
    "recoveryMaxMoves",
  ];

  function truncate(value, maxChars) {
    const text = String(value == null ? "" : value);
    if (text.length <= maxChars) return text;
    return text.slice(0, Math.max(0, maxChars - 16)) + "...[truncated]";
  }

  function sanitizeDiagnosticText(value, maxChars) {
    let text = truncate(value, maxChars || MAX_MESSAGE_CHARS);

    text = text
      .replace(
        /(authorization|proxy-authorization|cookie)\s*[:=]\s*[^\r\n<]+/gi,
        "$1: [REDACTED]",
      )
      .replace(/\bBearer\s+[^\s"'<]+/gi, "Bearer [REDACTED]")
      .replace(
        /\b(webhook[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password)\s*[:=]\s*[^\s,;&<]+/gi,
        "$1=[REDACTED]",
      )
      .replace(/\b(?:data|blob):[^\s"'<]+/gi, "[REDACTED_URL]");

    return truncate(text, maxChars || MAX_MESSAGE_CHARS);
  }

  function sanitizeCurrentUrl(value) {
    try {
      const url = new URL(String(value || ""));
      const host = url.hostname.toLowerCase();
      if (host !== "x.com" && host !== "twitter.com") {
        return "non_x_url";
      }
      return truncate(`${url.origin}${url.pathname}`, 500);
    } catch {
      return "invalid_url";
    }
  }

  function sanitizeReasonCode(value) {
    if (value === null || typeof value === "undefined" || value === "") return null;
    const code = String(value);
    return SAFE_SCAN_ERROR_CODES.has(code) ? code : "scan_error";
  }

  function sanitizeRecoveryStatus(value) {
    return SAFE_RECOVERY_STATES.has(String(value || "")) ? String(value) : "not_attempted";
  }

  function sanitizeTimestamp(value) {
    if (typeof value !== "string" || value.length === 0) return null;
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
  }

  function sanitizeOpaqueId(value) {
    if (typeof value !== "string") return null;
    const sanitized = value.slice(0, 120);
    return /^[A-Za-z0-9_.-]+$/.test(sanitized) ? sanitized : null;
  }

  function sanitizeSelectorVersion(value) {
    const sanitized = String(value || "v1").slice(0, 100);
    return /^[-A-Za-z0-9_.]+$/.test(sanitized) ? sanitized : "v1";
  }

  function sanitizeSourceTimeline(value) {
    return value === "profile" || value === "with_replies" ? value : null;
  }

  function sanitizePageReloadStatus(value) {
    return value === "success" || value === "monitored_tab_missing" || value === "error"
      ? value
      : null;
  }

  function normalizeCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(10_000, Math.floor(number))) : 0;
  }

  function getTimestamp(value) {
    const timestamp = value == null ? new Date() : new Date(value);
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
  }

  function getTimestampMilliseconds(value) {
    if (typeof value !== "string" || value.length === 0) return null;
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.getTime();
  }

  function getDiagnosticFingerprint(entry) {
    const source = entry && typeof entry === "object" ? entry : {};
    const summary = source.summary && typeof source.summary === "object" ? source.summary : {};
    const currentUrl = sanitizeCurrentUrl(summary.currentUrl || source.currentUrl);
    const selectorVersion = sanitizeSelectorVersion(
      summary.selectorVersion || source.selectorVersion,
    );

    return JSON.stringify({
      reasonCode: sanitizeReasonCode(source.reasonCode),
      counts: SUMMARY_FINGERPRINT_FIELDS.map((field) => normalizeCount(summary[field])),
      recoveryStatus: sanitizeRecoveryStatus(summary.recoveryStatus),
      currentUrl,
      selectorVersion,
      sourceTimeline: sanitizeSourceTimeline(summary.sourceTimeline),
    });
  }

  function sanitizeScanSummary(value) {
    if (!value || typeof value !== "object") return null;
    const source = value;
    const currentUrl = sanitizeCurrentUrl(source.currentUrl);
    const scanTimestamp = sanitizeTimestamp(source.scanTimestamp);
    if (currentUrl === "invalid_url" || currentUrl === "non_x_url" || !scanTimestamp) {
      return null;
    }

    const count = (key) => {
      return normalizeCount(source[key]);
    };
    const sessionStartedAt = sanitizeTimestamp(source.sessionStartedAt);
    const documentStartedAt = sanitizeTimestamp(source.documentStartedAt);
    const scanSequence = Math.min(1_000_000_000, count("scanSequence"));
    let lastSuccessfulParseAt = sanitizeTimestamp(source.lastSuccessfulParseAt);
    if (lastSuccessfulParseAt && sessionStartedAt && lastSuccessfulParseAt < sessionStartedAt) {
      lastSuccessfulParseAt = null;
    }
    if (count("parseSuccessCount") > 0) {
      lastSuccessfulParseAt = !sessionStartedAt || scanTimestamp >= sessionStartedAt
        ? scanTimestamp
        : null;
    }

    return {
      articleCount: count("articleCount"),
      timeElementCount: count("timeElementCount"),
      tweetTextCount: count("tweetTextCount"),
      nonEmptyTweetTextCount:
        Object.prototype.hasOwnProperty.call(source, "nonEmptyTweetTextCount")
          ? count("nonEmptyTweetTextCount")
          : count("tweetTextCount"),
      matchingTiboStatusCount: count("matchingTiboStatusCount"),
      translatedTweetCount: count("translatedTweetCount"),
      replyParentFoundCount: count("replyParentFoundCount"),
      replyParentMissingCount: count("replyParentMissingCount"),
      replyParentExpansionRequestedCount: count("replyParentExpansionRequestedCount"),
      replyParentContextReadyCount: count("replyParentContextReadyCount"),
      replyParentRetryCount: count("replyParentRetryCount"),
      replyParentContextLengthMax: count("replyParentContextLengthMax"),
      tweetDatetimeCount: count("tweetDatetimeCount"),
      parseSuccessCount: count("parseSuccessCount"),
      recoveryStatus: sanitizeRecoveryStatus(source.recoveryStatus),
      recoveryMoveCount: Math.min(MAX_REPLY_RECOVERY_MOVES, count("recoveryMoveCount")),
      recoveryMaxMoves: Math.min(MAX_REPLY_RECOVERY_MOVES, count("recoveryMaxMoves")),
      currentUrl,
      selectorVersion: sanitizeSelectorVersion(source.selectorVersion),
      scanTimestamp,
      sourceTimeline: sanitizeSourceTimeline(source.sourceTimeline),
      sessionStartedAt,
      documentStartedAt,
      scanSequence,
      lastSuccessfulParseAt,
    };
  }

  function compareTimestamp(left, right) {
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;
    return new Date(left).getTime() - new Date(right).getTime();
  }

  function laterTimestamp(left, right) {
    return compareTimestamp(left, right) >= 0 ? left : right;
  }

  function mergeTimelineScanSummary(currentValue, incomingValue) {
    const current = sanitizeScanSummary(currentValue);
    const incoming = sanitizeScanSummary(incomingValue);
    if (!incoming) return current;
    if (!current || current.sourceTimeline !== incoming.sourceTimeline) return incoming;

    const sessionOrder = compareTimestamp(incoming.sessionStartedAt, current.sessionStartedAt);
    if (sessionOrder < 0) return current;
    if (sessionOrder > 0) return incoming;

    const documentOrder = compareTimestamp(incoming.documentStartedAt, current.documentStartedAt);
    if (documentOrder < 0) return current;
    const sameSession = incoming.sessionStartedAt === current.sessionStartedAt;
    if (sameSession && documentOrder > 0) {
      return {
        ...incoming,
        lastSuccessfulParseAt: laterTimestamp(
          current.lastSuccessfulParseAt,
          incoming.lastSuccessfulParseAt,
        ),
      };
    }

    if (incoming.scanSequence < current.scanSequence) return current;
    if (incoming.scanSequence === current.scanSequence
      && compareTimestamp(incoming.scanTimestamp, current.scanTimestamp) < 0) return current;

    return {
      ...incoming,
      lastSuccessfulParseAt: laterTimestamp(
        current.lastSuccessfulParseAt,
        incoming.lastSuccessfulParseAt,
      ),
    };
  }

  function sanitizeTimelineScanSummaries(value) {
    const source = value && typeof value === "object" ? value : {};
    const result = { profile: null, with_replies: null };
    for (const timeline of ["profile", "with_replies"]) {
      const summary = sanitizeScanSummary(source[timeline]);
      if (summary && summary.sourceTimeline === timeline) result[timeline] = summary;
    }
    return result;
  }

  function buildScanSummary(records, currentUrl, selectorVersion, scanTimestamp, sourceTimeline, recoveryState, timelineContext) {
    const list = Array.isArray(records) ? records : [];
    const safeScanTimestamp = truncate(scanTimestamp || new Date().toISOString(), 40);
    const context = timelineContext && typeof timelineContext === "object" ? timelineContext : {};
    const sessionStartedAt = sanitizeTimestamp(context.sessionStartedAt);
    const lastSuccessfulParseAt = list.some((record) => record && record.isParseSuccess)
      ? safeScanTimestamp
      : sanitizeTimestamp(context.lastSuccessfulParseAt);
    return {
      articleCount: list.length,
      timeElementCount: list.filter((record) => record && record.hasTime).length,
      tweetTextCount: list.filter((record) => record && record.hasTweetText).length,
      nonEmptyTweetTextCount: list.filter(
        (record) =>
          record &&
          record.hasTweetText &&
          record.hasNonEmptyTweetText !== false,
      ).length,
      matchingTiboStatusCount: list.filter(
        (record) => record && record.hasMatchingTiboStatus,
      ).length,
      translatedTweetCount: list.filter((record) => record && record.isTranslated).length,
      replyParentFoundCount: list.filter((record) => record && record.replyParentFound).length,
      replyParentMissingCount: list.filter((record) => record && record.replyParentMissing).length,
      replyParentExpansionRequestedCount: list.filter(
        (record) => record && record.replyParentExpansionRequested,
      ).length,
      replyParentContextReadyCount: list.filter(
        (record) => record && record.replyParentContextReady,
      ).length,
      replyParentRetryCount: list.filter((record) => record && record.replyParentRetry).length,
      replyParentContextLengthMax: list.reduce(
        (maximum, record) => Math.max(maximum, normalizeCount(record?.replyParentContextLength)),
        0,
      ),
      tweetDatetimeCount: list.filter((record) => record && record.hasValidDatetime).length,
      parseSuccessCount: list.filter((record) => record && record.isParseSuccess).length,
      recoveryStatus: sanitizeRecoveryStatus(recoveryState?.status),
      recoveryMoveCount: Math.min(MAX_REPLY_RECOVERY_MOVES, normalizeCount(recoveryState?.moveCount)),
      recoveryMaxMoves: Math.min(MAX_REPLY_RECOVERY_MOVES, normalizeCount(recoveryState?.maxMoves)),
      currentUrl: sanitizeCurrentUrl(currentUrl),
      selectorVersion: truncate(selectorVersion || "unknown", 100),
      scanTimestamp: safeScanTimestamp,
      sourceTimeline: sanitizeSourceTimeline(sourceTimeline),
      sessionStartedAt,
      documentStartedAt: sanitizeTimestamp(context.documentStartedAt),
      scanSequence: Math.min(1_000_000_000, normalizeCount(context.scanSequence)),
      lastSuccessfulParseAt:
        lastSuccessfulParseAt && sessionStartedAt && lastSuccessfulParseAt < sessionStartedAt
          ? null
          : lastSuccessfulParseAt,
    };
  }

  function getScanFailureReason(summary) {
    if (!summary || summary.parseSuccessCount > 0) return null;
    const recoveryStatus = sanitizeRecoveryStatus(summary.recoveryStatus);
    if (recoveryStatus === "target_not_visible") return "target_not_visible";
    if (recoveryStatus === "attempting" || recoveryStatus === "in_progress") return "timeline_partial";
    if (recoveryStatus === "user_interrupted") return "recovery_user_interrupted";
    if (recoveryStatus === "navigation_interrupted") return "recovery_navigation_interrupted";
    if (recoveryStatus === "scroll_failed") return "recovery_scroll_failed";
    if (summary.articleCount === 0) return "article_missing";
    if (summary.timeElementCount === 0) return "time_element_missing";
    if (summary.tweetTextCount === 0) return "tweet_text_missing";
    if (summary.nonEmptyTweetTextCount === 0) return "tweet_text_empty";
    if (summary.matchingTiboStatusCount === 0) return "tibo_status_url_missing";
    if (summary.translatedTweetCount > 0) return "translated_text_detected";
    if (summary.tweetDatetimeCount === 0) return "tweet_datetime_missing";
    if (summary.replyParentRetryCount > 0) return "reply_parent_retry";
    return "no_parse_success";
  }

  function sanitizeSnapshotHtml(html, options) {
    const settings = options || {};
    let sanitized = String(html || "")
      .replace(
        /<(script|style|svg|img|video|source|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        "",
      )
      .replace(/<(script|style|svg|img|video|source|iframe)\b[^>]*\/?>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");

    sanitized = sanitized.replace(
      /(\s)(authorization|proxy-authorization|cookie|webhook[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|value)\s*=\s*(["'])([\s\S]*?)\3/gi,
      "$1$2=\"[REDACTED]\"",
    );
    sanitized = sanitized.replace(
      /(\s)(href|src|action|formaction|poster)\s*=\s*(["'])(?:data:|blob:)[\s\S]*?\3/gi,
      "$1$2=\"[REDACTED_URL]\"",
    );

    if (settings.maskPostText !== false) {
      sanitized = sanitized.replace(
        /(<[^>]*data-testid\s*=\s*["']tweetText["'][^>]*>)[\s\S]*?(<\/[^>]+>)/gi,
        "$1[POST_TEXT_MASKED]$2",
      );
      sanitized = sanitized.replace(
        /(<[^>]*data-testid\s*=\s*["'](?:User-Name|UserName|User-Names)["'][^>]*>)[\s\S]*?(<\/[^>]+>)/gi,
        "$1[DISPLAY_NAME_MASKED]$2",
      );
    }

    return truncate(sanitizeDiagnosticText(sanitized, MAX_SNAPSHOT_CHARS), settings.maxChars || MAX_SNAPSHOT_CHARS);
  }

  function byteLength(value) {
    const serialized = JSON.stringify(value);
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(serialized).length;
    }
    return serialized.length;
  }

  function trimDiagnosticLogs(logs) {
    const trimmed = Array.isArray(logs) ? logs.slice(-MAX_ENTRIES) : [];
    while (trimmed.length > 0 && byteLength(trimmed) > MAX_TOTAL_CHARS) {
      trimmed.shift();
    }
    return trimmed;
  }

  function sanitizeEntry(entry) {
    const source = entry && typeof entry === "object" ? entry : {};
    const result = { ...source };

    if (Array.isArray(source.messages)) {
      result.messages = source.messages.map((message) =>
        sanitizeDiagnosticText(message, MAX_MESSAGE_CHARS),
      );
    }
    if (typeof source.message !== "undefined") {
      result.message = sanitizeDiagnosticText(source.message, MAX_MESSAGE_CHARS);
    }
    if (typeof source.error !== "undefined") {
      result.error = sanitizeDiagnosticText(source.error, MAX_MESSAGE_CHARS);
    }
    if (typeof source.responseBody !== "undefined") {
      result.responseBody = sanitizeDiagnosticText(source.responseBody, MAX_MESSAGE_CHARS);
    }
    if (Array.isArray(source.snapshots)) {
      result.snapshots = source.snapshots
        .slice(0, 3)
        .map((snapshot) => sanitizeSnapshotHtml(snapshot, { maskPostText: false }));
    }
    if (source.summary && typeof source.summary === "object") {
      result.summary = { ...source.summary };
      result.summary.currentUrl = sanitizeCurrentUrl(source.summary.currentUrl);
      for (const key of [
        "articleCount",
        "timeElementCount",
        "tweetTextCount",
        "nonEmptyTweetTextCount",
        "matchingTiboStatusCount",
        "translatedTweetCount",
        "replyParentFoundCount",
        "replyParentMissingCount",
        "replyParentExpansionRequestedCount",
        "replyParentContextReadyCount",
        "replyParentRetryCount",
        "replyParentContextLengthMax",
        "tweetDatetimeCount",
        "parseSuccessCount",
        "recoveryMoveCount",
        "recoveryMaxMoves",
      ]) {
        const number = Number(source.summary[key]);
        const cap = key === "recoveryMoveCount" || key === "recoveryMaxMoves"
          ? MAX_REPLY_RECOVERY_MOVES
          : 10_000;
        result.summary[key] = Number.isFinite(number)
          ? Math.max(0, Math.min(cap, Math.floor(number)))
          : 0;
      }
      result.summary.recoveryStatus = sanitizeRecoveryStatus(source.summary.recoveryStatus);
      result.summary.selectorVersion = truncate(source.summary.selectorVersion || "unknown", 100);
      result.summary.scanTimestamp = truncate(source.summary.scanTimestamp || "", 40);
      result.summary.sourceTimeline = sanitizeSourceTimeline(source.summary.sourceTimeline);
    }
    if (typeof source.currentUrl !== "undefined") {
      result.currentUrl = sanitizeCurrentUrl(source.currentUrl);
    }
    if (typeof source.sourceTimeline !== "undefined") {
      result.sourceTimeline = sanitizeSourceTimeline(source.sourceTimeline);
    }
    if (typeof source.reasonCode !== "undefined") {
      result.reasonCode = truncate(source.reasonCode, 100).replace(/[^a-z0-9_.-]/gi, "_");
    }
    if (typeof source.occurrenceCount !== "undefined") {
      result.occurrenceCount = normalizeCount(source.occurrenceCount);
    }
    if (typeof source.lastOccurredAt !== "undefined") {
      result.lastOccurredAt = sanitizeTimestamp(source.lastOccurredAt);
    }

    return result;
  }

  function appendDiagnosticLog(storage, entry, nowValue) {
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        const now = getTimestamp(nowValue);
        const nowMilliseconds = getTimestampMilliseconds(now);
        const data = await storage.get([LOG_KEY, LAST_SUCCESS_KEY]);
        const logs = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
        const sanitizedEntry = sanitizeEntry(entry);
        const fingerprint = getDiagnosticFingerprint(sanitizedEntry);
        const lastSuccessfulScanAt = getTimestampMilliseconds(data[LAST_SUCCESS_KEY]);
        let matchingIndex = -1;

        for (let index = logs.length - 1; index >= 0; index -= 1) {
          const existing = logs[index];
          if (getDiagnosticFingerprint(existing) !== fingerprint) continue;

          const lastOccurredAt = getTimestampMilliseconds(
            existing.lastOccurredAt || existing.savedAt,
          );
          const occurredAfterSuccessfulScan =
            lastSuccessfulScanAt !== null &&
            lastOccurredAt !== null &&
            lastSuccessfulScanAt > lastOccurredAt;
          const withinDeduplicationWindow =
            nowMilliseconds !== null &&
            lastOccurredAt !== null &&
            nowMilliseconds >= lastOccurredAt &&
            nowMilliseconds - lastOccurredAt < DEDUP_WINDOW_MS;

          if (withinDeduplicationWindow && !occurredAfterSuccessfulScan) {
            matchingIndex = index;
          }
          break;
        }

        if (matchingIndex >= 0) {
          const existing = logs[matchingIndex];
          existing.occurrenceCount = normalizeCount(existing.occurrenceCount || 1) + 1;
          existing.lastOccurredAt = now;
        } else {
          logs.push({
            ...sanitizedEntry,
            savedAt: now,
            occurrenceCount: 1,
            lastOccurredAt: now,
          });
        }

        await storage.set({ [LOG_KEY]: trimDiagnosticLogs(logs) });
      });
    return writeQueue;
  }

  function markSuccessfulScan(storage, nowValue) {
    const timestamp = getTimestamp(nowValue);
    writeQueue = writeQueue
      .catch(() => {})
      .then(() => storage.set({ [LAST_SUCCESS_KEY]: timestamp }));
    return writeQueue;
  }

  async function getDiagnosticLogs(storage) {
    const data = await storage.get([LOG_KEY]);
    return Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
  }

  async function clearDiagnosticLogs(storage) {
    await storage.set({ [LOG_KEY]: [], [LAST_SUCCESS_KEY]: null });
  }

  function serializeDiagnosticLogs(logs) {
    return JSON.stringify(Array.isArray(logs) ? logs : [], null, 2);
  }

  async function getDiagnosticSettings(storage) {
    const data = await storage.get([ENABLED_KEY, MASK_TEXT_KEY]);
    return {
      enabled: data[ENABLED_KEY] !== false,
      maskPostText: data[MASK_TEXT_KEY] !== false,
    };
  }

  global.TiboDiagnostics = {
    LOG_KEY,
    ENABLED_KEY,
    MASK_TEXT_KEY,
    LAST_SUCCESS_KEY,
    TIMELINE_SCAN_SUMMARIES_KEY,
    TIMELINE_DIAGNOSTICS_FORMAT_VERSION,
    MAX_ENTRIES,
    MAX_TOTAL_CHARS,
    MAX_MESSAGE_CHARS,
    MAX_SNAPSHOT_CHARS,
    DEDUP_WINDOW_MS,
    buildScanSummary,
    getScanFailureReason,
    sanitizeDiagnosticText,
    sanitizeCurrentUrl,
    sanitizeReasonCode,
    sanitizeTimestamp,
    sanitizeOpaqueId,
    sanitizeSelectorVersion,
    sanitizeSourceTimeline,
    sanitizeRecoveryStatus,
    sanitizeTimelineScanSummaries,
    mergeTimelineScanSummary,
    sanitizePageReloadStatus,
    sanitizeScanSummary,
    getDiagnosticFingerprint,
    sanitizeSnapshotHtml,
    trimDiagnosticLogs,
    appendDiagnosticLog,
    markSuccessfulScan,
    getDiagnosticLogs,
    clearDiagnosticLogs,
    serializeDiagnosticLogs,
    getDiagnosticSettings,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
