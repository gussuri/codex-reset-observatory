(function (global) {
  "use strict";

  const LOG_KEY = "tibo_diagnostic_logs";
  const ENABLED_KEY = "tibo_diagnostics_enabled";
  const MASK_TEXT_KEY = "tibo_diagnostics_mask_text";
  const MAX_ENTRIES = 20;
  const MAX_TOTAL_CHARS = 1_000_000;
  const MAX_MESSAGE_CHARS = 2_000;
  const MAX_SNAPSHOT_CHARS = 20_000;
  const SAFE_SCAN_ERROR_CODES = new Set([
    "translated_text_detected",
    "scan_exception",
    "article_missing",
    "time_element_missing",
    "tweet_text_missing",
    "tibo_status_url_missing",
    "tweet_datetime_missing",
    "no_parse_success",
    "scan_error",
  ]);

  let writeQueue = Promise.resolve();

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

  function sanitizePageReloadStatus(value) {
    return value === "success" || value === "monitored_tab_missing" || value === "error"
      ? value
      : null;
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
      const number = Number(source[key]);
      return Number.isFinite(number) ? Math.max(0, Math.min(10_000, Math.floor(number))) : 0;
    };

    return {
      articleCount: count("articleCount"),
      timeElementCount: count("timeElementCount"),
      tweetTextCount: count("tweetTextCount"),
      matchingTiboStatusCount: count("matchingTiboStatusCount"),
      translatedTweetCount: count("translatedTweetCount"),
      tweetDatetimeCount: count("tweetDatetimeCount"),
      parseSuccessCount: count("parseSuccessCount"),
      currentUrl,
      selectorVersion: sanitizeSelectorVersion(source.selectorVersion),
      scanTimestamp,
    };
  }

  function buildScanSummary(records, currentUrl, selectorVersion, scanTimestamp) {
    const list = Array.isArray(records) ? records : [];
    return {
      articleCount: list.length,
      timeElementCount: list.filter((record) => record && record.hasTime).length,
      tweetTextCount: list.filter((record) => record && record.hasTweetText).length,
      matchingTiboStatusCount: list.filter(
        (record) => record && record.hasMatchingTiboStatus,
      ).length,
      translatedTweetCount: list.filter((record) => record && record.isTranslated).length,
      tweetDatetimeCount: list.filter((record) => record && record.hasValidDatetime).length,
      parseSuccessCount: list.filter((record) => record && record.isParseSuccess).length,
      currentUrl: sanitizeCurrentUrl(currentUrl),
      selectorVersion: truncate(selectorVersion || "unknown", 100),
      scanTimestamp: truncate(scanTimestamp || new Date().toISOString(), 40),
    };
  }

  function getScanFailureReason(summary) {
    if (!summary || summary.parseSuccessCount > 0) return null;
    if (summary.articleCount === 0) return "article_missing";
    if (summary.timeElementCount === 0) return "time_element_missing";
    if (summary.tweetTextCount === 0) return "tweet_text_missing";
    if (summary.matchingTiboStatusCount === 0) return "tibo_status_url_missing";
    if (summary.translatedTweetCount > 0) return "translated_text_detected";
    if (summary.tweetDatetimeCount === 0) return "tweet_datetime_missing";
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
        "matchingTiboStatusCount",
        "translatedTweetCount",
        "tweetDatetimeCount",
        "parseSuccessCount",
      ]) {
        const number = Number(source.summary[key]);
        result.summary[key] = Number.isFinite(number)
          ? Math.max(0, Math.min(10_000, Math.floor(number)))
          : 0;
      }
      result.summary.selectorVersion = truncate(source.summary.selectorVersion || "unknown", 100);
      result.summary.scanTimestamp = truncate(source.summary.scanTimestamp || "", 40);
    }
    if (typeof source.currentUrl !== "undefined") {
      result.currentUrl = sanitizeCurrentUrl(source.currentUrl);
    }
    if (typeof source.reasonCode !== "undefined") {
      result.reasonCode = truncate(source.reasonCode, 100).replace(/[^a-z0-9_.-]/gi, "_");
    }

    return result;
  }

  function appendDiagnosticLog(storage, entry) {
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        const data = await storage.get([LOG_KEY]);
        const logs = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
        logs.push({ ...sanitizeEntry(entry), savedAt: new Date().toISOString() });
        await storage.set({ [LOG_KEY]: trimDiagnosticLogs(logs) });
      });
    return writeQueue;
  }

  async function getDiagnosticLogs(storage) {
    const data = await storage.get([LOG_KEY]);
    return Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
  }

  async function clearDiagnosticLogs(storage) {
    await storage.set({ [LOG_KEY]: [] });
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
    MAX_ENTRIES,
    MAX_TOTAL_CHARS,
    MAX_MESSAGE_CHARS,
    MAX_SNAPSHOT_CHARS,
    buildScanSummary,
    getScanFailureReason,
    sanitizeDiagnosticText,
    sanitizeCurrentUrl,
    sanitizeReasonCode,
    sanitizeTimestamp,
    sanitizeOpaqueId,
    sanitizeSelectorVersion,
    sanitizePageReloadStatus,
    sanitizeScanSummary,
    sanitizeSnapshotHtml,
    trimDiagnosticLogs,
    appendDiagnosticLog,
    getDiagnosticLogs,
    clearDiagnosticLogs,
    serializeDiagnosticLogs,
    getDiagnosticSettings,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
