/**
 * Service Worker for Tibo Monitor Chrome Extension
 * Serialized Deduplication & Webhook Dispatcher
 */

importScripts("diagnostics.js", "scan-utils.js");

const QUEUE_KEY = "tibo_processed_tweet_ids";
const PENDING_QUEUE_KEY = "tibo_pending_tweet_payloads";
const SOURCE_CONTEXT_PENDING_QUEUE_KEY = "tibo_pending_source_context_enrichments";
const SOURCE_CONTEXT_LEDGER_KEY = "tibo_source_context_revision_ledger";
const TIMELINE_SCAN_SUMMARIES_KEY = TiboDiagnostics.TIMELINE_SCAN_SUMMARIES_KEY;
const TIMELINE_SCAN_STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_SOURCE_CONTEXT_LEDGER_ENTRIES = 100;
const MAX_SOURCE_CONTEXT_REVISIONS_PER_TWEET = 3;
const MAX_SOURCE_CONTEXT_PENDING_ENTRIES = 50;
const MAX_PENDING_TWEET_PAYLOADS = 50;
const PENDING_RETRY_DELAY_MS = 10 * 60 * 1000;
const MAX_PENDING_RETRY_ATTEMPTS = 3;
const RETRYABLE_AI_CLASSIFICATION_STATUSES = new Set([
  "timeout",
  "rate_limited",
  "api_error",
]);
const QUARANTINE_KEY = "tibo_quarantined_tweet_ids";
const MAX_QUARANTINE_ENTRIES = 100;
const AUTH_BLOCKED_REASON = "auth_blocked";
const MONITORED_TAB_PATTERNS = [
  "https://x.com/thsottiaux*",
  "https://x.com/notifications*",
  "https://twitter.com/thsottiaux*",
  "https://twitter.com/notifications*",
];
const FORMAL_ADOPTION_NOTIFIED_KEY = "tibo_formal_adoption_notified_ids";
const FORMAL_ADOPTION_NOTIFICATION_URLS_KEY = "tibo_formal_adoption_notification_urls";
const TEST_FORMAL_ADOPTION_NOTIFICATION_URLS_KEY = "tibo_formal_adoption_test_notification_urls";
const ALARM_NAME = "tibo_page_reload_alarm";
const RELOAD_INTERVAL_MINUTES = 10;
const RELOAD_DEDUPE_WINDOW_MS = 60 * 1000;
const HISTORY_PATH = "/history";
const DEFAULT_OBSERVATORY_DOMAIN = "https://codex.gussuriworks.com";
const LEGACY_OBSERVATORY_DOMAIN = "https://codex-reset-observatory.vercel.app";
const TEST_HISTORY_URL = `${DEFAULT_OBSERVATORY_DOMAIN}${HISTORY_PATH}`;
const TEST_NOTIFICATION_ID = "tibo-monitor-notification-test";
const TWEET_ID_PATTERN = /^\d{15,25}$/;
const CONTENT_MONITOR_STORAGE_KEYS = new Set([
  "tibo_leader_tab_id",
  "tibo_leader_timestamp",
  "tibo_last_page_reload_at",
  "tibo_last_page_reload_status",
  "tibo_last_page_reload_error",
  "tibo_diagnostics_enabled",
  "tibo_diagnostics_mask_text",
]);
let notificationIconDiagnosticsPromise = null;
let notificationIconDiagnosticsUrl = null;

// Promise queue for strict serialization (Mutex) across all tabs
let processQueue = Promise.resolve();
let pendingQueueStorage = Promise.resolve();
let timelineScanSummaryWriteQueue = Promise.resolve();
let monitoredTabReloadPromise = null;

function restrictLocalStorageToTrustedContexts() {
  if (typeof chrome === "undefined" || !chrome.storage?.local?.setAccessLevel) return;

  try {
    const result = chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch {
    // Keep startup resilient on older Chrome versions without this API.
  }
}

restrictLocalStorageToTrustedContexts();

function saveServiceDiagnostic(entry) {
  return TiboDiagnostics.appendDiagnosticLog(chrome.storage.local, {
    type: "service_worker",
    ...entry,
  }).catch(() => {});
}

function getExtensionVersion() {
  try {
    return chrome.runtime?.getManifest?.().version || "unknown";
  } catch {
    return "unknown";
  }
}

function getTweetPayloadMetadata(payload) {
  const text = payload?.text;
  const length = typeof text === "string" ? text.length : null;
  const trimmedLength = typeof text === "string" ? text.trim().length : null;
  const contextLength = (value) => (typeof value === "string" ? value.length : null);

  return {
    tweetId: typeof payload?.tweetId === "string" ? payload.tweetId.slice(0, 120) : null,
    textType: typeof text,
    textLength: length,
    trimmedTextLength: trimmedLength,
    sourceTimeline:
      payload?.sourceTimeline === "profile" || payload?.sourceTimeline === "with_replies"
        ? payload.sourceTimeline
        : null,
    isReply: payload?.isReply === true,
    replyContextLength: contextLength(payload?.replyContextText),
    quoteContextLength: contextLength(payload?.quoteContextText),
  };
}

async function quarantineTweet(tweetId, status, reasonCode) {
  const data = await chrome.storage.local.get([QUARANTINE_KEY]);
  const current = data[QUARANTINE_KEY];
  const entries = current && typeof current === "object" ? { ...current } : {};
  entries[tweetId] = {
    extensionVersion: getExtensionVersion(),
    httpStatus: Number.isInteger(status) ? status : null,
    reasonCode,
    quarantinedAt: new Date().toISOString(),
  };

  const keys = Object.keys(entries);
  while (keys.length > MAX_QUARANTINE_ENTRIES) {
    const oldestKey = keys.shift();
    if (oldestKey) delete entries[oldestKey];
  }
  await chrome.storage.local.set({ [QUARANTINE_KEY]: entries });
}

function isAuthBlockedQuarantineEntry(entry) {
  return Boolean(
    entry &&
      (entry.reasonCode === AUTH_BLOCKED_REASON ||
        entry.httpStatus === 401 ||
        entry.httpStatus === 403),
  );
}

async function broadcastAuthQuarantineCleared() {
  if (
    !chrome.tabs ||
    typeof chrome.tabs.query !== "function" ||
    typeof chrome.tabs.sendMessage !== "function"
  ) {
    return;
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: MONITORED_TAB_PATTERNS });
  } catch {
    return;
  }

  await Promise.all(
    (Array.isArray(tabs) ? tabs : [])
      .filter((tab) => Number.isInteger(tab?.id))
      .map(
        (tab) =>
          new Promise((resolve) => {
            try {
              chrome.tabs.sendMessage(
                tab.id,
                { action: "CLEAR_AUTH_QUARANTINE" },
                () => {
                  void chrome.runtime?.lastError;
                  resolve();
                },
              );
            } catch {
              resolve();
            }
          }),
      ),
  );
}

async function broadcastTweetRetry(tweetId) {
  if (
    !chrome.tabs ||
    typeof chrome.tabs.query !== "function" ||
    typeof chrome.tabs.sendMessage !== "function"
  ) {
    return 0;
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: MONITORED_TAB_PATTERNS });
  } catch {
    return 0;
  }

  const monitoredTabs = (Array.isArray(tabs) ? tabs : []).filter(
    (tab) => Number.isInteger(tab?.id),
  );
  await Promise.all(
    monitoredTabs.map(
      (tab) =>
        new Promise((resolve) => {
          try {
            chrome.tabs.sendMessage(
              tab.id,
              { action: "RETRY_TWEET", tweetId },
              () => {
                void chrome.runtime?.lastError;
                resolve();
              },
            );
          } catch {
            resolve();
          }
        }),
    ),
  );
  return monitoredTabs.length;
}

async function retryTweet(tweetId) {
  if (typeof tweetId !== "string" || !TWEET_ID_PATTERN.test(tweetId)) {
    return { success: false, error: "invalid_tweet_id" };
  }

  const data = await chrome.storage.local.get([QUEUE_KEY, QUARANTINE_KEY]);
  const processedIds = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : null;
  const quarantine = data[QUARANTINE_KEY];
  const quarantineEntries =
    quarantine && typeof quarantine === "object" && !Array.isArray(quarantine)
      ? { ...quarantine }
      : null;
  const clearedProcessed = Boolean(
    processedIds && processedIds.includes(tweetId),
  );
  const clearedQuarantine = Boolean(
    quarantineEntries && Object.hasOwn(quarantineEntries, tweetId),
  );

  const update = {};
  if (clearedProcessed) {
    update[QUEUE_KEY] = processedIds.filter((id) => id !== tweetId);
  }
  if (clearedQuarantine) {
    delete quarantineEntries[tweetId];
    update[QUARANTINE_KEY] = quarantineEntries;
  }
  if (Object.keys(update).length > 0) {
    await chrome.storage.local.set(update);
  }
  await removePendingTweet(tweetId);
  await resetSourceContextPendingRetries(tweetId);

  const notifiedTabs = await broadcastTweetRetry(tweetId);
  return {
    success: true,
    tweetId,
    clearedProcessed,
    clearedQuarantine,
    notifiedTabs,
  };
}

async function clearAuthBlockedQuarantine() {
  const data = await chrome.storage.local.get([QUARANTINE_KEY]);
  const current = data[QUARANTINE_KEY];
  const entries = current && typeof current === "object" ? { ...current } : {};
  let clearedCount = 0;

  for (const [tweetId, entry] of Object.entries(entries)) {
    if (!isAuthBlockedQuarantineEntry(entry)) continue;
    const sourceContextMatch = tweetId.match(/^source-context:(\d{15,25}):([a-f0-9]{64})$/);
    if (sourceContextMatch) {
      await clearSourceContextAuthRevision(sourceContextMatch[1], sourceContextMatch[2]);
    }
    delete entries[tweetId];
    clearedCount += 1;
  }

  if (clearedCount > 0) {
    await chrome.storage.local.set({ [QUARANTINE_KEY]: entries });
  }
  await broadcastAuthQuarantineCleared();
  return { clearedCount };
}

function isRetryableWebhookStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function getPendingTweetEntries(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.tweetId === "string" &&
        entry.payload &&
        typeof entry.payload === "object" &&
        !Array.isArray(entry.payload),
    )
    .map((entry) => ({
      tweetId: entry.tweetId,
      payload: entry.payload,
      attempts:
        Number.isInteger(entry.attempts) && entry.attempts >= 0
          ? entry.attempts
          : 0,
      nextAttemptAt: Number.isFinite(entry.nextAttemptAt)
        ? entry.nextAttemptAt
        : 0,
      retryExhausted: entry.retryExhausted === true,
    }));
}

function updatePendingTweetQueue(mutator) {
  const task = pendingQueueStorage.then(async () => {
    const data = await chrome.storage.local.get([PENDING_QUEUE_KEY]);
    const entries = getPendingTweetEntries(data[PENDING_QUEUE_KEY]);
    const mutatedEntries = mutator(entries);
    const nextEntries = Array.isArray(mutatedEntries) ? mutatedEntries : entries;
    await chrome.storage.local.set({ [PENDING_QUEUE_KEY]: nextEntries });
    return nextEntries;
  });

  pendingQueueStorage = task.catch(() => {});
  return task;
}

function persistPendingTweet(payload) {
  const tweetId = payload?.tweetId;
  if (typeof tweetId !== "string" || tweetId.length === 0) {
    return Promise.resolve(null);
  }

  return updatePendingTweetQueue((entries) => {
    const existingIndex = entries.findIndex((entry) => entry.tweetId === tweetId);
    const freshEntry = {
      tweetId,
      payload,
      attempts: 0,
      nextAttemptAt: 0,
      retryExhausted: false,
    };

    if (existingIndex >= 0) {
      const existing = entries[existingIndex];
      let samePayload = false;
      try {
        samePayload = JSON.stringify(existing.payload) === JSON.stringify(payload);
      } catch {
        samePayload = false;
      }
      entries[existingIndex] = samePayload
        ? { ...existing, payload }
        : freshEntry;
      return entries;
    }

    if (entries.length >= MAX_PENDING_TWEET_PAYLOADS) {
      return entries;
    }

    return [...entries, freshEntry];
  }).then((entries) => {
    const entry = entries.find((candidate) => candidate.tweetId === tweetId);
    return entry
      ? {
          stored: true,
          retryExhausted: entry.retryExhausted === true,
          attempts: entry.attempts,
          nextAttemptAt: entry.nextAttemptAt,
        }
      : { stored: false, retryExhausted: false, attempts: 0, nextAttemptAt: 0 };
  });
}

function removePendingTweet(tweetId) {
  if (typeof tweetId !== "string" || tweetId.length === 0) {
    return Promise.resolve([]);
  }

  return updatePendingTweetQueue((entries) =>
    entries.filter((entry) => entry.tweetId !== tweetId),
  );
}

function recordPendingFailure(payload) {
  const tweetId = payload?.tweetId;
  if (typeof tweetId !== "string" || tweetId.length === 0) {
    return Promise.resolve(false);
  }

  return updatePendingTweetQueue((entries) => {
    let entryIndex = entries.findIndex((entry) => entry.tweetId === tweetId);
    if (entryIndex < 0) {
      if (entries.length >= MAX_PENDING_TWEET_PAYLOADS) return entries;
      entries.push({
        tweetId,
        payload,
        attempts: 0,
        nextAttemptAt: 0,
        retryExhausted: false,
      });
      entryIndex = entries.length - 1;
    }

    const current = entries[entryIndex];
    const attempts = current.attempts + 1;
    const retryExhausted = attempts >= MAX_PENDING_RETRY_ATTEMPTS;
    const retryDelay = Math.min(
      PENDING_RETRY_DELAY_MS * 2 ** (attempts - 1),
      60 * 60 * 1000,
    );

    entries[entryIndex] = {
      tweetId,
      payload,
      attempts,
      nextAttemptAt: retryExhausted ? null : Date.now() + retryDelay,
      retryExhausted,
    };
    return entries;
  }).then((entries) => entries.some((entry) => entry.tweetId === tweetId));
}

async function getDuePendingTweet() {
  await pendingQueueStorage;
  const data = await chrome.storage.local.get([PENDING_QUEUE_KEY]);
  const now = Date.now();
  return getPendingTweetEntries(data[PENDING_QUEUE_KEY])
    .filter(
      (entry) =>
        !entry.retryExhausted &&
        Number.isFinite(entry.nextAttemptAt) &&
        entry.nextAttemptAt <= now,
    )
    .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt)[0] || null;
}

function normalizeSourceContextStatusUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(x|twitter)\.com$/i.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    if (!match) return null;
    const authorHandle = match[1].toLowerCase();
    return {
      tweetId: match[2],
      authorHandle: `@${authorHandle}`,
      tweetUrl: `https://x.com/${authorHandle}/status/${match[2]}`,
    };
  } catch {
    return null;
  }
}

function normalizeSourceContextPayload(payload) {
  if (!payload || payload.kind !== "source_context_enrichment"
    || typeof payload.tweetId !== "string" || !/^\d{15,25}$/.test(payload.tweetId)
    || typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 25000
    || typeof payload.tweetCreatedAt !== "string"
    || !Number.isFinite(new Date(payload.tweetCreatedAt).getTime())) return null;
  const root = normalizeSourceContextStatusUrl(payload.tweetUrl);
  if (!root || root.tweetId !== payload.tweetId || root.authorHandle.toLowerCase() !== "@thsottiaux") return null;

  const snapshot = {};
  if (payload.isReply === true && Array.isArray(payload.replyToHandles)
    && typeof payload.replyParentTweetId === "string"
    && typeof payload.replyParentTweetUrl === "string"
    && typeof payload.replyContextText === "string" && payload.replyContextText.trim()) {
    const parent = normalizeSourceContextStatusUrl(payload.replyParentTweetUrl);
    const matchingHandle = payload.replyToHandles.some((handle) => (
      typeof handle === "string" && /^@?[A-Za-z0-9_]{1,15}$/.test(handle.trim())
      && `@${handle.trim().replace(/^@/, "")}`.toLowerCase() === parent?.authorHandle.toLowerCase()
    ));
    if (!parent || parent.tweetId !== payload.replyParentTweetId || !matchingHandle
      || payload.replyContextText.trim().length > 1000) return null;
    snapshot.parent = {
      tweetId: parent.tweetId,
      tweetUrl: parent.tweetUrl,
      authorHandle: parent.authorHandle,
      text: payload.replyContextText.trim(),
    };
  }
  if (payload.isQuote === true && typeof payload.quoteTweetUrl === "string"
    && typeof payload.quoteAuthorHandle === "string"
    && typeof payload.quoteContextText === "string" && payload.quoteContextText.trim()) {
    const quote = normalizeSourceContextStatusUrl(payload.quoteTweetUrl);
    if (!quote || quote.authorHandle.toLowerCase() !== payload.quoteAuthorHandle.toLowerCase()
      || payload.quoteContextText.trim().length > 1000) return null;
    snapshot.quote = {
      tweetId: quote.tweetId,
      tweetUrl: quote.tweetUrl,
      authorHandle: quote.authorHandle,
      text: payload.quoteContextText.trim(),
    };
  }
  if (!snapshot.parent && !snapshot.quote) return null;
  return {
    payload: {
      kind: "source_context_enrichment",
      tweetId: payload.tweetId,
      text: payload.text.trim(),
      tweetUrl: root.tweetUrl,
      tweetCreatedAt: new Date(payload.tweetCreatedAt).toISOString(),
      ...(snapshot.parent ? {
        isReply: true,
        replyToHandles: [snapshot.parent.authorHandle],
        replyContextText: snapshot.parent.text,
        replyParentTweetId: snapshot.parent.tweetId,
        replyParentTweetUrl: snapshot.parent.tweetUrl,
      } : {}),
      ...(snapshot.quote ? {
        isQuote: true,
        quoteContextText: snapshot.quote.text,
        quoteTweetUrl: snapshot.quote.tweetUrl,
        quoteAuthorHandle: snapshot.quote.authorHandle,
      } : {}),
    },
    snapshot,
  };
}

async function getSourceContextRevisionHash(snapshot) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSourceContextLedger(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry.tweetId === "string" && Array.isArray(entry.revisions))
    .map((entry) => {
      const revisions = entry.revisions
        .filter((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))
        .slice(0, MAX_SOURCE_CONTEXT_REVISIONS_PER_TWEET);
      const terminalRevisions = entry.terminalRevisions && typeof entry.terminalRevisions === "object"
        ? Object.fromEntries(Object.entries(entry.terminalRevisions)
          .filter(([hash, status]) => /^[a-f0-9]{64}$/.test(hash)
            && ["terminal", "auth_blocked"].includes(status))
          .slice(0, MAX_SOURCE_CONTEXT_REVISIONS_PER_TWEET - revisions.length))
        : {};
      return { tweetId: entry.tweetId, revisions, terminalRevisions };
    })
    .filter((entry) => entry.revisions.length > 0 || Object.keys(entry.terminalRevisions).length > 0)
    .slice(-MAX_SOURCE_CONTEXT_LEDGER_ENTRIES);
}

function hasSourceContextRevision(entry, revisionHash) {
  return Boolean(entry && (entry.revisions.includes(revisionHash)
    || Object.hasOwn(entry.terminalRevisions, revisionHash)));
}

async function addSourceContextRevisionToLedger(tweetId, revisionHash) {
  const data = await chrome.storage.local.get([SOURCE_CONTEXT_LEDGER_KEY]);
  const entries = normalizeSourceContextLedger(data[SOURCE_CONTEXT_LEDGER_KEY]);
  const index = entries.findIndex((entry) => entry.tweetId === tweetId);
  const entry = index >= 0 ? entries[index] : { tweetId, revisions: [], terminalRevisions: {} };
  if (hasSourceContextRevision(entry, revisionHash)) return { revisionLimit: false };
  if (entry.revisions.length + Object.keys(entry.terminalRevisions).length >= MAX_SOURCE_CONTEXT_REVISIONS_PER_TWEET) return { revisionLimit: true };
  entry.revisions.push(revisionHash);
  if (index >= 0) entries.splice(index, 1);
  entries.push(entry);
  await chrome.storage.local.set({ [SOURCE_CONTEXT_LEDGER_KEY]: entries.slice(-MAX_SOURCE_CONTEXT_LEDGER_ENTRIES) });
  return { revisionLimit: false };
}

async function addSourceContextTerminalRevision(tweetId, revisionHash, status) {
  const data = await chrome.storage.local.get([SOURCE_CONTEXT_LEDGER_KEY]);
  const entries = normalizeSourceContextLedger(data[SOURCE_CONTEXT_LEDGER_KEY]);
  const index = entries.findIndex((entry) => entry.tweetId === tweetId);
  const entry = index >= 0 ? entries[index] : { tweetId, revisions: [], terminalRevisions: {} };
  if (hasSourceContextRevision(entry, revisionHash)) return { revisionLimit: false };
  if (entry.revisions.length + Object.keys(entry.terminalRevisions).length >= MAX_SOURCE_CONTEXT_REVISIONS_PER_TWEET) return { revisionLimit: true };
  entry.terminalRevisions[revisionHash] = status;
  if (index >= 0) entries.splice(index, 1);
  entries.push(entry);
  await chrome.storage.local.set({ [SOURCE_CONTEXT_LEDGER_KEY]: entries.slice(-MAX_SOURCE_CONTEXT_LEDGER_ENTRIES) });
  return { revisionLimit: false };
}

async function clearSourceContextAuthRevision(tweetId, revisionHash) {
  const data = await chrome.storage.local.get([SOURCE_CONTEXT_LEDGER_KEY]);
  const entries = normalizeSourceContextLedger(data[SOURCE_CONTEXT_LEDGER_KEY]);
  const entry = entries.find((candidate) => candidate.tweetId === tweetId);
  if (!entry || entry.terminalRevisions[revisionHash] !== "auth_blocked") return;
  delete entry.terminalRevisions[revisionHash];
  await chrome.storage.local.set({ [SOURCE_CONTEXT_LEDGER_KEY]: entries.filter((candidate) => (
    candidate.revisions.length > 0 || Object.keys(candidate.terminalRevisions).length > 0
  )) });
}

async function getSourceContextPendingEntries() {
  await pendingQueueStorage;
  const data = await chrome.storage.local.get([SOURCE_CONTEXT_PENDING_QUEUE_KEY]);
  if (!Array.isArray(data[SOURCE_CONTEXT_PENDING_QUEUE_KEY])) return [];
  return data[SOURCE_CONTEXT_PENDING_QUEUE_KEY]
    .filter((entry) => entry && typeof entry.tweetId === "string"
      && typeof entry.revisionHash === "string" && /^[a-f0-9]{64}$/.test(entry.revisionHash)
      && entry.payload && typeof entry.payload === "object")
    .slice(0, MAX_SOURCE_CONTEXT_PENDING_ENTRIES);
}

function updateSourceContextPendingQueue(mutator) {
  const task = pendingQueueStorage.then(async () => {
    const data = await chrome.storage.local.get([SOURCE_CONTEXT_PENDING_QUEUE_KEY]);
    const entries = Array.isArray(data[SOURCE_CONTEXT_PENDING_QUEUE_KEY])
      ? data[SOURCE_CONTEXT_PENDING_QUEUE_KEY]
      : [];
    const nextEntries = mutator(entries);
    await chrome.storage.local.set({ [SOURCE_CONTEXT_PENDING_QUEUE_KEY]: nextEntries });
    return nextEntries;
  });
  pendingQueueStorage = task.catch(() => {});
  return task;
}

function persistSourceContextPending(payload, revisionHash) {
  return updateSourceContextPendingQueue((entries) => {
    if (entries.some((entry) => entry.tweetId === payload.tweetId && entry.revisionHash === revisionHash)) return entries;
    if (entries.length >= MAX_SOURCE_CONTEXT_PENDING_ENTRIES) return entries;
    return [...entries, {
      tweetId: payload.tweetId,
      revisionHash,
      payload,
      attempts: 0,
      nextAttemptAt: Date.now(),
      retryExhausted: false,
    }];
  }).then((entries) => entries.some((entry) => entry.tweetId === payload.tweetId && entry.revisionHash === revisionHash));
}

function removeSourceContextPending(tweetId, revisionHash) {
  return updateSourceContextPendingQueue((entries) => entries.filter((entry) => (
    entry.tweetId !== tweetId || entry.revisionHash !== revisionHash
  )));
}

function resetSourceContextPendingRetries(tweetId) {
  return updateSourceContextPendingQueue((entries) => entries.map((entry) => (
    entry.tweetId === tweetId
      ? { ...entry, attempts: 0, nextAttemptAt: Date.now(), retryExhausted: false }
      : entry
  )));
}

function recordSourceContextPendingFailure(tweetId, revisionHash) {
  return updateSourceContextPendingQueue((entries) => {
    const index = entries.findIndex((entry) => entry.tweetId === tweetId && entry.revisionHash === revisionHash);
    if (index < 0) return entries;
    const current = entries[index];
    const attempts = current.attempts + 1;
    const retryExhausted = attempts >= MAX_PENDING_RETRY_ATTEMPTS;
    const retryDelay = Math.min(PENDING_RETRY_DELAY_MS * 2 ** (attempts - 1), 60 * 60 * 1000);
    entries[index] = {
      ...current,
      attempts,
      nextAttemptAt: retryExhausted ? null : Date.now() + retryDelay,
      retryExhausted,
    };
    return entries;
  });
}

async function getDueSourceContextPending() {
  const entries = await getSourceContextPendingEntries();
  return entries.filter((entry) => !entry.retryExhausted
    && Number.isFinite(entry.nextAttemptAt) && entry.nextAttemptAt <= Date.now())
    .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt)[0] || null;
}

function saveSourceContextTerminalDiagnostic(tweetId, reasonCode, status = null) {
  return saveServiceDiagnostic({
    reasonCode,
    messages: ["Source context enrichment was not accepted."],
    error: Number.isInteger(status) ? `HTTP ${status}` : undefined,
    payloadMetadata: { tweetId, kind: "source_context_enrichment" },
  });
}

async function executeSourceContextEnrichment(payload, revisionHash) {
  const { secret, domain } = await getConfig();
  if (!secret) {
    await recordSourceContextPendingFailure(payload.tweetId, revisionHash);
    return { success: false, retryable: true, error: "Webhook secret is not configured." };
  }
  let response;
  try {
    response = await fetch(`${domain}/api/webhook/tibo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` },
      body: JSON.stringify(payload),
    });
  } catch {
    await recordSourceContextPendingFailure(payload.tweetId, revisionHash);
    return { success: false, retryable: true, error: "Source context request failed." };
  }
  if (!response.ok) {
    if (isRetryableWebhookStatus(response.status)) {
      await recordSourceContextPendingFailure(payload.tweetId, revisionHash);
      return { success: false, retryable: true, httpStatus: response.status };
    }
    const authBlocked = response.status === 401 || response.status === 403;
    await addSourceContextTerminalRevision(payload.tweetId, revisionHash, authBlocked ? "auth_blocked" : "terminal");
    if (authBlocked) {
      await quarantineTweet(`source-context:${payload.tweetId}:${revisionHash}`, response.status, AUTH_BLOCKED_REASON);
    }
    await saveSourceContextTerminalDiagnostic(
      payload.tweetId,
      authBlocked ? "source_context_auth_blocked" : "source_context_terminal_rejection",
      response.status,
    );
    await removeSourceContextPending(payload.tweetId, revisionHash);
    return {
      success: false,
      terminal: !authBlocked,
      quarantined: authBlocked,
      httpStatus: response.status,
    };
  }
  let result;
  try {
    result = await response.json();
  } catch {
    await recordSourceContextPendingFailure(payload.tweetId, revisionHash);
    return { success: false, retryable: true, error: "Invalid source context response." };
  }
  if (result?.success !== true || !["applied", "duplicate"].includes(result.status)) {
    await recordSourceContextPendingFailure(payload.tweetId, revisionHash);
    return { success: false, retryable: true, error: "Source context was not acknowledged." };
  }
  const ledgerResult = await addSourceContextRevisionToLedger(payload.tweetId, revisionHash);
  if (ledgerResult.revisionLimit) {
    await removeSourceContextPending(payload.tweetId, revisionHash);
    return { success: false, terminal: true, error: "revision_limit" };
  }
  await removeSourceContextPending(payload.tweetId, revisionHash);
  return { success: true, status: result.status, revisionHash };
}

function enqueueSourceContextEnrichment(rawPayload) {
  const resultPromise = processQueue.then(async () => {
    const normalized = normalizeSourceContextPayload(rawPayload);
    if (!normalized) return { success: false, error: "invalid_source_context_enrichment" };
    const revisionHash = await getSourceContextRevisionHash(normalized.snapshot);
    const ledgerData = await chrome.storage.local.get([SOURCE_CONTEXT_LEDGER_KEY]);
    const ledger = normalizeSourceContextLedger(ledgerData[SOURCE_CONTEXT_LEDGER_KEY]);
    const existing = ledger.find((entry) => entry.tweetId === normalized.payload.tweetId);
    if (hasSourceContextRevision(existing, revisionHash)) {
      const terminalStatus = existing.terminalRevisions[revisionHash];
      return terminalStatus === "auth_blocked"
        ? { success: false, skipped: true, quarantined: true }
        : terminalStatus === "terminal"
          ? { success: false, skipped: true, terminal: true }
          : { success: true, skipped: true, status: "duplicate" };
    }
    const pending = await getSourceContextPendingEntries();
    if (pending.some((entry) => entry.tweetId === normalized.payload.tweetId && entry.revisionHash === revisionHash)) {
      return { success: false, retryable: true, revisionHash };
    }
    const pendingForTweet = new Set(pending.filter((entry) => entry.tweetId === normalized.payload.tweetId).map((entry) => entry.revisionHash));
    if ((existing?.revisions.length || 0) + Object.keys(existing?.terminalRevisions || {}).length + pendingForTweet.size >= MAX_SOURCE_CONTEXT_REVISIONS_PER_TWEET) {
      await saveSourceContextTerminalDiagnostic(normalized.payload.tweetId, "source_context_revision_limit");
      return { success: false, terminal: true, error: "revision_limit" };
    }
    const persisted = await persistSourceContextPending(normalized.payload, revisionHash);
    if (!persisted) return { success: false, retryable: true, error: "pending_queue_full" };
    return executeSourceContextEnrichment(normalized.payload, revisionHash);
  });
  processQueue = resultPromise.catch(() => {});
  return resultPromise;
}

// Setup alarms on Service Worker initialization
function setupReloadAlarm() {
  if (typeof chrome !== "undefined" && chrome.alarms) {
    chrome.alarms.get(ALARM_NAME, (existingAlarm) => {
      if (!existingAlarm) {
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: RELOAD_INTERVAL_MINUTES });
        console.log(`[Service Worker] Scheduled page reload alarm every ${RELOAD_INTERVAL_MINUTES} minutes.`);
      }
    });
  }
}

function migrateObservatoryDomain() {
  return chrome.storage.local.get(["observatory_domain"]).then((data) => {
    const current =
      typeof data.observatory_domain === "string"
        ? data.observatory_domain.replace(/\/+$/, "")
        : "";

    if (current === "" || current === LEGACY_OBSERVATORY_DOMAIN) {
      return chrome.storage.local.set({
        observatory_domain: DEFAULT_OBSERVATORY_DOMAIN,
      });
    }

    return undefined;
  });
}

function scheduleObservatoryDomainMigration() {
  migrateObservatoryDomain().catch(() => {
    // A settings migration failure must not affect monitoring startup.
  });
}

scheduleObservatoryDomainMigration();
setupReloadAlarm();

if (typeof chrome !== "undefined" && chrome.runtime) {
  if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      setupReloadAlarm();
      restrictLocalStorageToTrustedContexts();
      scheduleObservatoryDomainMigration();
    });
  }
  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      setupReloadAlarm();
      restrictLocalStorageToTrustedContexts();
      scheduleObservatoryDomainMigration();
      return handleReloadAlarm({ retryPendingTweets: false });
    });
  }
}

if (typeof chrome !== "undefined" && chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === ALARM_NAME) {
      return handleReloadAlarm();
    }
  });
}

if (
  typeof chrome !== "undefined" &&
  chrome.notifications &&
  chrome.notifications.onClicked
) {
  chrome.notifications.onClicked.addListener(async (notificationId) => {
    try {
      const data = await chrome.storage.local.get([
        FORMAL_ADOPTION_NOTIFICATION_URLS_KEY,
        TEST_FORMAL_ADOPTION_NOTIFICATION_URLS_KEY,
      ]);
      const urls = data[FORMAL_ADOPTION_NOTIFICATION_URLS_KEY] || {};
      const testUrls = data[TEST_FORMAL_ADOPTION_NOTIFICATION_URLS_KEY] || {};
      const url = urls[notificationId] || testUrls[notificationId] || null;
      const fallbackDomain = (await getConfig()).domain;
      const fallbackUrl = getSafeHistoryUrl(fallbackDomain);
      const targetUrl = isSafeNotificationUrl(url)
        ? url
        : fallbackUrl;

      if (chrome.tabs && typeof chrome.tabs.create === "function") {
        await chrome.tabs.create({ url: targetUrl });
      }

      delete urls[notificationId];
      delete testUrls[notificationId];
      await chrome.storage.local.set({
        [FORMAL_ADOPTION_NOTIFICATION_URLS_KEY]: urls,
        [TEST_FORMAL_ADOPTION_NOTIFICATION_URLS_KEY]: testUrls,
      });
      if (typeof chrome.notifications.clear === "function") {
        await chrome.notifications.clear(notificationId);
      }
    } catch {
      // Notification failures must never affect monitoring or webhook work.
    }
  });
}

function getMonitoredTimeline(urlStr) {
  return TiboMonitorScan.getTimelineSource(urlStr);
}

function isProfileTabUrl(urlStr) {
  return getMonitoredTimeline(urlStr) === "profile";
}

function getTimelineReloadKey(timeline) {
  return timeline === "with_replies"
    ? "tibo_last_with_replies_reload"
    : "tibo_last_profile_reload";
}

function getCanonicalTimelineUrl(timeline) {
  return timeline === "with_replies"
    ? "https://x.com/thsottiaux/with_replies"
    : "https://x.com/thsottiaux";
}

function isValidRestoreTimeline(timeline) {
  return timeline === "profile" || timeline === "with_replies";
}

async function restoreStoredDriftedTimeline(timeline, candidateTabs, now) {
  const canonicalTabs = (candidateTabs || []).filter(
    (tab) => getMonitoredTimeline(tab.url) === timeline,
  );
  if (canonicalTabs.length > 0) return null;

  const key = getTimelineReloadKey(timeline);
  const state = await chrome.storage.local.get([`${key}_tab_id`]);
  const storedTabId = state[`${key}_tab_id`];
  const tab = (candidateTabs || []).find(
    (candidate) => candidate.id === storedTabId
      && TiboMonitorScan.isTiboStatusUrl(candidate.url),
  );
  if (!tab) return null;

  try {
    await chrome.tabs.update(tab.id, { url: getCanonicalTimelineUrl(timeline) });
    await chrome.storage.local.set({
      [`${key}_at`]: now,
      [`${key}_status`]: "success",
      [`${key}_error`]: null,
      [`${key}_tab_id`]: tab.id,
    });
    console.log(`[Service Worker] Restored ${timeline} tab ${tab.id} from a status-page SPA drift.`);
    return { timeline, status: "restored", success: true, tabId: tab.id };
  } catch (error) {
    await chrome.storage.local.set({
      [`${key}_status`]: "error",
      [`${key}_error`]: "page_reload_error",
    });
    await saveServiceDiagnostic({
      reasonCode: "page_reload_error",
      sourceTimeline: timeline,
      messages: [`The ${timeline} monitoring tab could not be restored from a status page.`],
      error: error?.message || String(error),
    });
    return { timeline, status: "error", success: false, tabId: tab.id };
  }
}

async function wasRecentlyReloaded(timeline, tabId, now) {
  const key = getTimelineReloadKey(timeline);
  try {
    const state = await chrome.storage.local.get([
      `${key}_at`,
      `${key}_status`,
      `${key}_tab_id`,
    ]);
    const lastReloadAt = Date.parse(state[`${key}_at`]);
    const age = new Date(now).getTime() - lastReloadAt;
    return (
      state[`${key}_status`] === "success" &&
      state[`${key}_tab_id`] === tabId &&
      Number.isFinite(lastReloadAt) &&
      age >= 0 &&
      age < RELOAD_DEDUPE_WINDOW_MS
    );
  } catch {
    return false;
  }
}

async function reloadTimeline(timeline, tabs, now) {
  const key = getTimelineReloadKey(timeline);
  const tab = tabs[0];

  if (!tab) {
    await chrome.storage.local.set({
      [`${key}_status`]: "monitored_tab_missing",
      [`${key}_error`]: null,
    });
    await saveServiceDiagnostic({
      reasonCode: "monitored_tab_missing",
      sourceTimeline: timeline,
      messages: [`The ${timeline} monitoring tab is not open.`],
    });
    return { timeline, status: "monitored_tab_missing", success: false, tabId: null };
  }

  if (await wasRecentlyReloaded(timeline, tab.id, now)) {
    return {
      timeline,
      status: "recently_reloaded",
      success: true,
      skipped: true,
      tabId: tab.id,
    };
  }

  try {
    await chrome.tabs.reload(tab.id);
    await chrome.storage.local.set({
      [`${key}_at`]: now,
      [`${key}_status`]: "success",
      [`${key}_error`]: null,
      [`${key}_tab_id`]: tab.id,
    });
    console.log(`[Service Worker] Successfully reloaded ${timeline} tab ${tab.id} at ${now}.`);
    return { timeline, status: "success", success: true, tabId: tab.id };
  } catch (error) {
    await chrome.storage.local.set({
      [`${key}_status`]: "error",
      [`${key}_error`]: "page_reload_error",
    });
    await saveServiceDiagnostic({
      reasonCode: "page_reload_error",
      sourceTimeline: timeline,
      messages: [`The ${timeline} monitoring tab could not be reloaded.`],
      error: error?.message || String(error),
    });
    return { timeline, status: "error", success: false, tabId: tab.id };
  }
}

function handleReloadAlarm(options = {}) {
  if (options.retryPendingTweets !== false) {
    return retryPendingTweet()
      .catch(async (error) => {
        await saveServiceDiagnostic({
          reasonCode: "pending_retry_error",
          messages: ["The pending tweet retry could not be completed."],
          error: error?.message || String(error),
        });
      })
      .then(() => handleMonitoredTabReload());
  }
  return handleMonitoredTabReload();
}

function handleMonitoredTabReload() {
  if (monitoredTabReloadPromise) return monitoredTabReloadPromise;

  const currentReload = runMonitoredTabReload();
  const sharedReload = currentReload.finally(() => {
    if (monitoredTabReloadPromise === sharedReload) {
      monitoredTabReloadPromise = null;
    }
  });
  monitoredTabReloadPromise = sharedReload;
  return sharedReload;
}

async function runMonitoredTabReload() {
  const now = new Date().toISOString();
  try {
    if (typeof chrome === "undefined" || !chrome.tabs) {
      return { success: false, error: "chrome.tabs is unavailable" };
    }

    // Query for tabs on X / Twitter
    const candidateTabs = await chrome.tabs.query({
      url: [
        "https://x.com/*",
        "https://twitter.com/*",
      ],
    });

    const profileTabs = (candidateTabs || []).filter(
      (tab) => getMonitoredTimeline(tab.url) === "profile",
    );
    const repliesTabs = (candidateTabs || []).filter(
      (tab) => getMonitoredTimeline(tab.url) === "with_replies",
    );

    const results = [
      (profileTabs.length === 0
        ? await restoreStoredDriftedTimeline("profile", candidateTabs, now)
        : null) || await reloadTimeline("profile", profileTabs, now),
      (repliesTabs.length === 0
        ? await restoreStoredDriftedTimeline("with_replies", candidateTabs, now)
        : null) || await reloadTimeline("with_replies", repliesTabs, now),
    ];
    const successful = results.find((result) => result.success && !result.skipped);
    const hasError = results.some((result) => result.status === "error");
    const alreadyReloaded = results.some((result) => result.skipped);

    if (!successful && alreadyReloaded && !hasError) {
      return { success: true, status: "recently_reloaded", results };
    }

    if (!successful && !hasError) {
      console.log("[Service Worker] Monitored profile and replies tabs are missing. Preserving last_page_reload_at.");
      await chrome.storage.local.set({
        tibo_last_page_reload_status: "monitored_tab_missing",
        tibo_last_page_reload_error: null,
      });
      return { success: true, status: "monitored_tab_missing", results };
    }

    if (!successful) {
      await chrome.storage.local.set({
        tibo_last_page_reload_status: "error",
        tibo_last_page_reload_error: "page_reload_error",
      });
      return { success: false, status: "error", results };
    }

    await chrome.storage.local.set({
      tibo_last_page_reload_at: now,
      tibo_last_page_reload_status: "success",
      tibo_last_page_reload_error: null,
      tibo_reloaded_tab_id: successful.tabId,
    });

    return {
      success: true,
      status: "success",
      tabId: successful.tabId,
      reloadedAt: now,
      results,
    };
  } catch (err) {
    console.error("[Service Worker] Page reload error:", err);
    await chrome.storage.local.set({
      tibo_last_page_reload_status: "error",
      tibo_last_page_reload_error: "page_reload_error",
    });
    await saveServiceDiagnostic({
      reasonCode: "page_reload_error",
      messages: ["The monitored timeline tabs could not be reloaded."],
      error: err?.message || String(err),
    });
    return { success: false, error: "page_reload_error" };
  }
}

function getContentMonitorState(keys) {
  const requestedKeys = Array.isArray(keys)
    ? keys.filter((key) => typeof key === "string" && CONTENT_MONITOR_STORAGE_KEYS.has(key))
    : [];
  return chrome.storage.local.get(requestedKeys).then((data) => {
    const safeData = {};
    for (const key of requestedKeys) {
      if (Object.prototype.hasOwnProperty.call(data, key)) safeData[key] = data[key];
    }
    return safeData;
  });
}

function setContentMonitorState(items) {
  const safeItems = {};
  if (items && typeof items === "object") {
    for (const [key, value] of Object.entries(items)) {
      if (CONTENT_MONITOR_STORAGE_KEYS.has(key)) safeItems[key] = value;
    }
  }
  return chrome.storage.local.set(safeItems);
}

function saveContentScanDiagnostic(entry) {
  return TiboDiagnostics.appendDiagnosticLog(chrome.storage.local, entry);
}

function markContentScanSuccessful() {
  return TiboDiagnostics.markSuccessfulScan(chrome.storage.local);
}

function saveTimelineScanSummary(summary, sender) {
  const safeSummary = TiboDiagnostics.sanitizeScanSummary(summary);
  const senderTimeline = getMonitoredTimeline(sender?.tab?.url);
  if (
    !safeSummary
    || !Number.isInteger(sender?.tab?.id)
    || (Number.isInteger(sender?.frameId) && sender.frameId !== 0)
    || !isValidRestoreTimeline(senderTimeline)
    || safeSummary.sourceTimeline !== senderTimeline
  ) {
    return Promise.reject(new Error("invalid_timeline_scan_summary"));
  }

  const update = async () => {
    const stored = await chrome.storage.local.get([TIMELINE_SCAN_SUMMARIES_KEY]);
    const summaries = TiboDiagnostics.sanitizeTimelineScanSummaries(
      stored[TIMELINE_SCAN_SUMMARIES_KEY],
    );
    summaries[safeSummary.sourceTimeline] = TiboDiagnostics.mergeTimelineScanSummary(
      summaries[safeSummary.sourceTimeline],
      safeSummary,
    );
    await chrome.storage.local.set({ [TIMELINE_SCAN_SUMMARIES_KEY]: summaries });
    return summaries;
  };

  const operation = timelineScanSummaryWriteQueue.catch(() => {}).then(update);
  timelineScanSummaryWriteQueue = operation.catch(() => {});
  return operation;
}

async function getTimelineHeartbeatDiagnostics() {
  try {
    const [stored, tabs] = await Promise.all([
      chrome.storage.local.get([TIMELINE_SCAN_SUMMARIES_KEY]),
      chrome.tabs.query({
        url: ["https://x.com/thsottiaux*", "https://twitter.com/thsottiaux*"],
      }),
    ]);
    const summaries = TiboDiagnostics.sanitizeTimelineScanSummaries(
      stored[TIMELINE_SCAN_SUMMARIES_KEY],
    );
    const openTimelines = new Set(
      (tabs || []).map((tab) => getMonitoredTimeline(tab.url)).filter(Boolean),
    );
    const now = Date.now();
    const slots = { formatVersion: TiboDiagnostics.TIMELINE_DIAGNOSTICS_FORMAT_VERSION };
    const observedAt = new Date(now).toISOString();

    for (const timeline of ["profile", "with_replies"]) {
      const summary = summaries[timeline];
      if (!openTimelines.has(timeline)) {
        slots[timeline] = {
          sourceTimeline: timeline,
          status: "not_open",
          observedAt,
          scanTimestamp: summary?.scanTimestamp || null,
          lastSuccessfulParseAt: summary?.lastSuccessfulParseAt || null,
          sessionStartedAt: summary?.sessionStartedAt || null,
          documentStartedAt: summary?.documentStartedAt || null,
          scanSequence: summary?.scanSequence || 0,
          articleCount: summary?.articleCount || 0,
          matchingTiboStatusCount: summary?.matchingTiboStatusCount || 0,
          parseSuccessCount: summary?.parseSuccessCount || 0,
          selectorVersion: summary?.selectorVersion || "unknown",
          recoveryStatus: summary?.recoveryStatus || "not_attempted",
          recoveryMoveCount: summary?.recoveryMoveCount || 0,
          recoveryMaxMoves: summary?.recoveryMaxMoves || 0,
        };
        continue;
      }

      const scanTime = summary ? new Date(summary.scanTimestamp).getTime() : NaN;
      const age = Number.isFinite(scanTime) ? now - scanTime : Infinity;
      const status = age < 0 || age > TIMELINE_SCAN_STALE_AFTER_MS
        ? "stale"
        : summary.parseSuccessCount > 0
          ? "healthy"
          : "empty";
      slots[timeline] = {
        sourceTimeline: timeline,
        status,
        observedAt,
        scanTimestamp: summary?.scanTimestamp || null,
        lastSuccessfulParseAt: summary?.lastSuccessfulParseAt || null,
        sessionStartedAt: summary?.sessionStartedAt || null,
        documentStartedAt: summary?.documentStartedAt || null,
        scanSequence: summary?.scanSequence || 0,
        articleCount: summary?.articleCount || 0,
        matchingTiboStatusCount: summary?.matchingTiboStatusCount || 0,
        parseSuccessCount: summary?.parseSuccessCount || 0,
        selectorVersion: summary?.selectorVersion || "unknown",
        recoveryStatus: summary?.recoveryStatus || "not_attempted",
        recoveryMoveCount: summary?.recoveryMoveCount || 0,
        recoveryMaxMoves: summary?.recoveryMaxMoves || 0,
      };
    }

    return slots;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "RESTORE_MONITORED_TIMELINE") {
    const timeline = request.timeline;
    const tab = sender?.tab;
    const tabId = tab?.id;
    if (
      !Number.isInteger(tabId)
      || !isValidRestoreTimeline(timeline)
      || !TiboMonitorScan.isTiboStatusUrl(tab?.url)
    ) {
      sendResponse({ success: false, error: "invalid_timeline_restore_request" });
      return false;
    }

    chrome.tabs.update(tabId, { url: getCanonicalTimelineUrl(timeline) })
      .then(() => sendResponse({ success: true, data: { timeline } }))
      .catch(() => sendResponse({ success: false, error: "timeline_restore_failed" }));
    return true;
  }

  if (request.action === "GET_CONTENT_MONITOR_STATE") {
    getContentMonitorState(request.keys)
      .then((data) => sendResponse({ success: true, data }))
      .catch(() => sendResponse({ success: false, error: "storage_read_failed" }));
    return true;
  }

  if (request.action === "SET_CONTENT_MONITOR_STATE") {
    setContentMonitorState(request.items)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false, error: "storage_write_failed" }));
    return true;
  }

  if (request.action === "CLEAR_AUTH_QUARANTINE") {
    clearAuthBlockedQuarantine()
      .then((data) => sendResponse({ success: true, data }))
      .catch(() => sendResponse({ success: false, error: "quarantine_clear_failed" }));
    return true;
  }

  if (request.action === "RETRY_TWEET") {
    retryTweet(request.tweetId)
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ success: false, error: "retry_tweet_failed" }));
    return true;
  }

  if (request.action === "SAVE_CONTENT_SCAN_DIAGNOSTIC") {
    saveContentScanDiagnostic(request.entry)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false, error: "diagnostic_write_failed" }));
    return true;
  }

  if (request.action === "REPORT_TIMELINE_SCAN") {
    const requestedSummary = TiboDiagnostics.sanitizeScanSummary(request.summary);
    saveTimelineScanSummary(requestedSummary, sender)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false, error: "timeline_scan_report_failed" }));
    return true;
  }

  if (request.action === "MARK_CONTENT_SCAN_SUCCESS") {
    markContentScanSuccessful()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false, error: "diagnostic_write_failed" }));
    return true;
  }

  if (request.action === "POST_TWEET") {
    // Enqueue POST_TWEET through serialized Promise queue
    enqueuePostTweet(request.payload)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === "POST_TWEET_CONTEXT_ENRICHMENT") {
    enqueueSourceContextEnrichment(request.payload)
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ success: false, retryable: true, error: "source_context_failed" }));
    return true;
  }

  if (request.action === "POST_HEARTBEAT") {
    handlePostHeartbeat(request.payload)
      .then((res) => sendResponse({ success: true, data: res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "TEST_CONNECTION") {
    handleTestConnection()
      .then((res) => sendResponse({ success: true, data: res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (
    request.action === "TEST_FORMAL_ADOPTION_NOTIFICATION" ||
    request.type === "TEST_FORMAL_ADOPTION_NOTIFICATION"
  ) {
    handleTestFormalAdoptionNotification()
      .then((res) => sendResponse(res))
      .catch(() =>
        sendResponse({
          ok: false,
          error: "notification test failed",
        }),
      );
    return true;
  }

  if (request.action === "TRIGGER_RELOAD_ALARM") {
    handleReloadAlarm()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function getConfig() {
  const data = await chrome.storage.local.get(["webhook_secret", "observatory_domain"]);
  const secret = data.webhook_secret || "";
  const domain = data.observatory_domain || DEFAULT_OBSERVATORY_DOMAIN;
  return { secret, domain: domain.replace(/\/+$/, "") };
}

function enqueuePostTweet(payload) {
  const resultPromise = processQueue
    .then(async () => {
      let pendingState;
      try {
        pendingState = await persistPendingTweet(payload);
      } catch (error) {
        void saveServiceDiagnostic({
          reasonCode: "pending_queue_persist_error",
          messages: ["The pending tweet queue could not be persisted."],
          error: error?.message || String(error),
          payloadMetadata: getTweetPayloadMetadata(payload),
        });
      }

      if (!pendingState?.stored) {
        return {
          success: false,
          retryable: true,
          error: "Tweet retry queue is unavailable; webhook request was not sent.",
        };
      }

      if (pendingState?.retryExhausted) {
        return {
          success: false,
          retryable: true,
          error: "Tweet webhook retry limit reached; use explicit retry to try again.",
        };
      }

      if (
        pendingState?.attempts > 0 &&
        Number.isFinite(pendingState.nextAttemptAt) &&
        pendingState.nextAttemptAt > Date.now()
      ) {
        return {
          success: false,
          retryable: true,
          error: "Tweet webhook retry is waiting for its scheduled attempt.",
        };
      }

      return executePostTweetWithRecovery(payload);
    });
  processQueue = resultPromise.catch(() => {});
  return resultPromise;
}

function retryPendingTweet() {
  const resultPromise = processQueue.then(async () => {
    const pendingEntry = await getDuePendingTweet();
    if (pendingEntry) return executePostTweetWithRecovery(pendingEntry.payload);
    const pendingContext = await getDueSourceContextPending();
    if (!pendingContext) return { success: true, skipped: true };
    const normalized = normalizeSourceContextPayload(pendingContext.payload);
    if (!normalized) {
      await removeSourceContextPending(pendingContext.tweetId, pendingContext.revisionHash);
      return { success: true, skipped: true, terminal: true };
    }
    const revisionHash = await getSourceContextRevisionHash(normalized.snapshot);
    if (revisionHash !== pendingContext.revisionHash) {
      await removeSourceContextPending(pendingContext.tweetId, pendingContext.revisionHash);
      return { success: true, skipped: true, terminal: true };
    }
    return executeSourceContextEnrichment(normalized.payload, revisionHash);
  });
  processQueue = resultPromise.catch(() => {});
  return resultPromise;
}

async function executePostTweetWithRecovery(payload) {
  try {
    return await executePostTweet(payload);
  } catch (error) {
    try {
      await recordPendingFailure(payload);
    } catch {
      // Keep the existing direct send failure behavior if local storage is unavailable.
    }
    await saveServiceDiagnostic({
      reasonCode: "webhook_processing_error",
      messages: ["The tweet webhook processing failed unexpectedly."],
      error: error?.message || String(error),
      payloadMetadata: getTweetPayloadMetadata(payload),
    });
    return {
      success: false,
      retryable: true,
      error: "Tweet webhook processing failed.",
    };
  }
}

async function executePostTweet(payload) {
  const { tweetId } = payload;
  if (!tweetId) {
    throw new Error("Missing tweetId in payload.");
  }

  // 1. Get processed IDs from chrome.storage.local
  const storageData = await chrome.storage.local.get([QUEUE_KEY, QUARANTINE_KEY]);
  const processedIds = storageData[QUEUE_KEY] || [];

  // 2. Skip if already processed in storage
  if (processedIds.includes(tweetId)) {
    console.log(`[Service Worker] Tweet ${tweetId} already processed. Skipping fetch.`);
    await removePendingTweet(tweetId);
    return { success: true, skipped: true };
  }

  // Payload rejections are terminal for this extension version. They remain
  // retryable after an extension update, which lets a collector fix be tested
  // without a mutation observer resend storm.
  const quarantine = storageData[QUARANTINE_KEY];
  const quarantineEntry =
    quarantine && typeof quarantine === "object" ? quarantine[tweetId] : null;
  if (quarantineEntry?.extensionVersion === getExtensionVersion()) {
    const quarantineReason = isAuthBlockedQuarantineEntry(quarantineEntry)
      ? AUTH_BLOCKED_REASON
      : quarantineEntry.reasonCode || "payload_rejected";
    await removePendingTweet(tweetId);
    return {
      success: false,
      quarantined: true,
      quarantineReason,
      httpStatus: quarantineEntry.httpStatus || null,
      error:
        quarantineReason === AUTH_BLOCKED_REASON
          ? "Tweet is quarantined until webhook authentication is recovered."
          : "Tweet payload is quarantined until the extension is updated.",
    };
  }

  // 3. Fetch Webhook
  const { secret, domain } = await getConfig();
  if (!secret) {
    throw new Error("Webhook secret is not configured in extension options.");
  }

  let response;
  try {
    response = await fetch(`${domain}/api/webhook/tibo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    await saveServiceDiagnostic({
      reasonCode: "webhook_network_error",
      messages: ["The tweet webhook request failed before receiving a response."],
      error: err?.message || String(err),
      payloadMetadata: getTweetPayloadMetadata(payload),
    });
    await recordPendingFailure(payload);
    return {
      success: false,
      retryable: true,
      error: "Tweet webhook request failed.",
    };
  }

  if (!response.ok) {
    let errorText = "";
    try {
      errorText = await response.text();
    } catch {
      errorText = "Response body could not be read.";
    }
    await saveServiceDiagnostic({
      reasonCode: "webhook_http_error",
      httpStatus: response.status,
      responseBody: errorText,
      failureClass: isRetryableWebhookStatus(response.status) ? "retryable" : "quarantined",
      payloadMetadata: getTweetPayloadMetadata(payload),
      messages: ["The tweet webhook returned a non-2xx response."],
    });
    const error = `Tweet webhook returned HTTP ${response.status}.`;
    if (isRetryableWebhookStatus(response.status)) {
      await recordPendingFailure(payload);
      return { success: false, retryable: true, httpStatus: response.status, error };
    }

    await quarantineTweet(
      tweetId,
      response.status,
      response.status === 401 || response.status === 403
        ? AUTH_BLOCKED_REASON
        : response.status === 400
          ? "payload_rejected"
          : "webhook_rejected",
    );
    await removePendingTweet(tweetId);
    return {
      success: false,
      quarantined: true,
      quarantineReason:
        response.status === 401 || response.status === 403
          ? AUTH_BLOCKED_REASON
          : "payload_rejected",
      httpStatus: response.status,
      error,
    };
  }

  const json = await response.json();

  // Formal-adoption notifications are best-effort and isolated from the
  // collection queue. A failed Chrome notification must not fail the post.
  try {
    await notifyFormalAdoption(json?.formalAdoption, domain);
  } catch {
    // Keep the webhook success result even when notification APIs are absent.
  }

  // The webhook persists a rule fallback and returns 2xx for these failures.
  // Keep the tweet pending so the bounded queue can replay classification.
  if (RETRYABLE_AI_CLASSIFICATION_STATUSES.has(json?.aiStatus)) {
    await saveServiceDiagnostic({
      reasonCode: "ai_classification_retry",
      messages: ["The tweet was saved with a rule fallback after a transient AI classification failure."],
      payloadMetadata: getTweetPayloadMetadata(payload),
    });
    await recordPendingFailure(payload);
    return {
      success: false,
      retryable: true,
      error: "Tweet saved with fallback; AI classification will be retried.",
    };
  }

  // 4. Save to chrome.storage.local on 2xx success and verify write persistence
  const updatedIds = [...processedIds];
  if (!updatedIds.includes(tweetId)) {
    updatedIds.push(tweetId);
    if (updatedIds.length > 100) {
      updatedIds.shift();
    }
    await chrome.storage.local.set({ [QUEUE_KEY]: updatedIds });

    // Verify storage write persistence
    const reVerifiedData = await chrome.storage.local.get([QUEUE_KEY]);
    const reVerifiedIds = reVerifiedData[QUEUE_KEY] || [];

    if (!reVerifiedIds.includes(tweetId)) {
      throw new Error(`Storage write verification failed for tweetId ${tweetId}. Value was not persisted.`);
    }
  }

  await removePendingTweet(tweetId);

  return { success: true, data: json };
}

function isSafeNotificationUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" &&
        (url.hostname === "x.com" || url.hostname === "twitter.com")) ||
      (url.protocol === "https:" &&
        (url.hostname === "codex.gussuriworks.com" ||
          url.hostname === "codex-reset-observatory.vercel.app"))
    );
  } catch {
    return false;
  }
}

function getSafeHistoryUrl(domain) {
  const configured = `${domain}${HISTORY_PATH}`;
  return isSafeNotificationUrl(configured)
    ? configured
    : `${DEFAULT_OBSERVATORY_DOMAIN}${HISTORY_PATH}`;
}

function getRuntimeLastErrorMessage() {
  try {
    return chrome.runtime?.lastError?.message || null;
  } catch {
    return "extension context invalidated";
  }
}

function sanitizeNotificationError(error, fallback) {
  const raw =
    getRuntimeLastErrorMessage() ||
    (error && typeof error.message === "string" ? error.message : String(error || ""));
  const redacted = raw
    .replace(/(authorization|bearer|api[_ -]?key|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return (redacted || fallback).slice(0, 500);
}

async function getNotificationPermissionLevel() {
  if (
    !chrome.notifications ||
    typeof chrome.notifications.getPermissionLevel !== "function"
  ) {
    return { level: "unavailable", error: null };
  }

  try {
    const level = await chrome.notifications.getPermissionLevel();
    return { level: level || "unavailable", error: null };
  } catch (error) {
    return {
      level: "unavailable",
      error: {
        errorName: error?.name || "Error",
        errorMessage: sanitizeNotificationError(error, "permission lookup failed"),
      },
    };
  }
}

async function inspectNotificationIcon(iconUrl) {
  if (notificationIconDiagnosticsUrl === iconUrl && notificationIconDiagnosticsPromise) {
    return notificationIconDiagnosticsPromise;
  }

  notificationIconDiagnosticsUrl = iconUrl;
  notificationIconDiagnosticsPromise = (async () => {
    if (!iconUrl) {
      return {
        status: "missing",
        errorName: "Error",
        errorMessage: "Notification icon URL is missing.",
      };
    }
    if (typeof fetch !== "function") {
      return {
        status: "unavailable",
        errorName: "Error",
        errorMessage: "Notification icon could not be checked in this context.",
      };
    }

    try {
      const response = await fetch(iconUrl, { cache: "force-cache" });
      if (!response.ok) {
        return {
          status: "http_error",
          errorName: "Error",
          errorMessage: `Notification icon could not be loaded: HTTP ${response.status}`,
        };
      }

      const contentType = response.headers?.get?.("content-type") || null;
      if (
        contentType &&
        !contentType.toLowerCase().startsWith("image/") &&
        !contentType.toLowerCase().includes("octet-stream")
      ) {
        return {
          status: "invalid_content_type",
          contentType,
          errorName: "Error",
          errorMessage: `Notification icon returned ${contentType}, not an image.`,
        };
      }

      if (typeof response.arrayBuffer === "function") {
        const bytes = await response.arrayBuffer();
        if (!bytes || bytes.byteLength === 0) {
          return {
            status: "empty",
            contentType,
            errorName: "Error",
            errorMessage: "Notification icon is empty.",
          };
        }
      }

      return { status: "ok", contentType };
    } catch (error) {
      return {
        status: "load_error",
        errorName: error?.name || "Error",
        errorMessage: sanitizeNotificationError(
          error,
          "Notification icon could not be loaded.",
        ),
      };
    }
  })();

  return notificationIconDiagnosticsPromise;
}

async function verifyNotificationCreated(notificationId) {
  if (!chrome.notifications || typeof chrome.notifications.getAll !== "function") {
    return { status: "unavailable", present: null };
  }

  try {
    const notifications = await chrome.notifications.getAll();
    const present = Boolean(notifications && notifications[notificationId]);
    return { status: present ? "present" : "missing", present };
  } catch (error) {
    return {
      status: "error",
      present: null,
      errorName: error?.name || "Error",
      errorMessage: sanitizeNotificationError(error, "notification verification failed"),
    };
  }
}

function buildNotificationFailure(notificationId, details, error) {
  return {
    ok: false,
    notificationId,
    requestedNotificationId: notificationId,
    returnedNotificationId: null,
    actualNotificationId: notificationId,
    permissionLevel: details.permissionLevel,
    iconLoadStatus: details.iconLoadStatus,
    getAllContainsRequestedId: null,
    warning: null,
    error,
    details: {
      ...details,
      requestedNotificationId: notificationId,
      returnedNotificationId: null,
      actualNotificationId: notificationId,
      error,
    },
  };
}

async function createNotificationWithDiagnostics(notificationId, options) {
  const details = {
    notificationId,
    requestedNotificationId: notificationId,
    returnedNotificationId: null,
    actualNotificationId: notificationId,
    iconUrl: options?.iconUrl || null,
    apiAvailable: Boolean(
      chrome.notifications && typeof chrome.notifications.create === "function",
    ),
    permissionLevel: "unavailable",
    iconLoadStatus: "not_checked",
  };

  if (!details.apiAvailable) {
    return buildNotificationFailure(
      notificationId,
      details,
      "notifications API is unavailable",
    );
  }

  const permission = await getNotificationPermissionLevel();
  details.permissionLevel = permission.level;
  if (permission.level === "denied") {
    return buildNotificationFailure(
      notificationId,
      { ...details, ...(permission.error || {}) },
      "Chrome extension notification permission is denied.",
    );
  }

  const icon = await inspectNotificationIcon(options?.iconUrl);
  details.iconLoadStatus = icon.status;
  if (icon.status !== "ok") {
    return buildNotificationFailure(
      notificationId,
      { ...details, ...icon },
      icon.errorMessage || "Notification icon could not be loaded.",
    );
  }

  try {
    const returnedValue = await chrome.notifications.create(notificationId, options);
    const returnedNotificationId =
      typeof returnedValue === "string" && returnedValue.length > 0
        ? returnedValue
        : null;
    const actualNotificationId = returnedNotificationId || notificationId;
    const returnedIdWarning = returnedNotificationId
      ? null
      : "notifications.create returned no id; requested id was used";
    const verification = await verifyNotificationCreated(notificationId);
    const warning = [
      returnedIdWarning,
      verification.status === "missing"
        ? "getAll did not contain the requested notification id"
        : null,
      verification.status === "error"
        ? "getAll verification failed"
        : null,
    ]
      .filter(Boolean)
      .join("; ") || null;
    return {
      ok: true,
      notificationId: actualNotificationId,
      requestedNotificationId: notificationId,
      returnedNotificationId,
      actualNotificationId,
      permissionLevel: details.permissionLevel,
      iconLoadStatus: details.iconLoadStatus,
      getAllContainsRequestedId: verification.present,
      warning,
      error: null,
      details: {
        ...details,
        requestedNotificationId: notificationId,
        returnedNotificationId,
        actualNotificationId,
        warning,
        getAllContainsRequestedId: verification.present,
        notificationPresence: verification.status,
        ...(verification.errorName ? { errorName: verification.errorName } : {}),
        ...(verification.errorMessage ? { errorMessage: verification.errorMessage } : {}),
      },
    };
  } catch (error) {
    const errorMessage = sanitizeNotificationError(error, "notifications.create failed");
    return {
      ok: false,
      notificationId,
      requestedNotificationId: notificationId,
      returnedNotificationId: null,
      actualNotificationId: notificationId,
      permissionLevel: details.permissionLevel,
      iconLoadStatus: details.iconLoadStatus,
      getAllContainsRequestedId: null,
      warning: null,
      error: errorMessage,
      details: {
        ...details,
        requestedNotificationId: notificationId,
        returnedNotificationId: null,
        actualNotificationId: notificationId,
        errorName: error?.name || "Error",
        errorMessage,
      },
    };
  }
}

function createTestNotificationId() {
  return TEST_NOTIFICATION_ID;
}

async function showFormalAdoptionNotification(adoption, domain) {
  const isTest = adoption?.isTest === true;
  if (!adoption || (!isTest && (adoption.newlyAdopted !== true || !adoption.tweetId))) {
    return { ok: true, skipped: true };
  }

  try {
    const tweetId = String(adoption.tweetId || "notification-test");
    const stored = await chrome.storage.local.get(
      isTest
        ? [TEST_FORMAL_ADOPTION_NOTIFICATION_URLS_KEY]
        : [FORMAL_ADOPTION_NOTIFIED_KEY, FORMAL_ADOPTION_NOTIFICATION_URLS_KEY],
    );
    const notifiedIds = Array.isArray(stored[FORMAL_ADOPTION_NOTIFIED_KEY])
      ? stored[FORMAL_ADOPTION_NOTIFIED_KEY]
      : [];

    if (!isTest && notifiedIds.includes(tweetId)) {
      return { ok: true, skipped: true };
    }

    const notificationId = isTest
      ? createTestNotificationId()
      : `tibo-formal-adoption-${tweetId}`;
    const confidence =
      typeof adoption.confidence === "number"
        ? ` (${Math.round(adoption.confidence * 100)}%)`
        : "";
    const title =
      typeof adoption.title === "string" && adoption.title.trim()
        ? adoption.title.trim()
        : "ランダムリセット";
    const notification = isTest
      ? {
          title: "Codexリセット通知のテスト",
          message: "通知機能は正常に動作しています。",
        }
      : {
          title: "Codexリセットを正式採用",
          message: `${title}${confidence}`,
        };

    let iconUrl;
    try {
      iconUrl = chrome.runtime.getURL("icons/icon-128.png");
    } catch {
      return { ok: false, error: "extension context invalidated" };
    }

    const created = await createNotificationWithDiagnostics(notificationId, {
      type: "basic",
      iconUrl,
      title: notification.title,
      message: notification.message,
      priority: isTest ? 0 : 2,
    });

    if (!created.ok) {
      if (isTest) {
        await saveServiceDiagnostic({
          reasonCode: "notification_test_failed",
          event: "notification_test_failed",
          ...created.details,
          error: created.error,
        });
      }
      return created;
    }

    const urlKey = isTest
      ? TEST_FORMAL_ADOPTION_NOTIFICATION_URLS_KEY
      : FORMAL_ADOPTION_NOTIFICATION_URLS_KEY;
    const storedUrls = stored[urlKey];
    const urls = storedUrls && typeof storedUrls === "object" ? { ...storedUrls } : {};
    urls[notificationId] = isTest
      ? TEST_HISTORY_URL
      : isSafeNotificationUrl(adoption.sourceUrl)
        ? adoption.sourceUrl
        : getSafeHistoryUrl(domain);

    const actualNotificationId =
      created.actualNotificationId || created.notificationId || notificationId;
    urls[actualNotificationId] = urls[notificationId] || (isTest
      ? TEST_HISTORY_URL
      : isSafeNotificationUrl(adoption.sourceUrl)
        ? adoption.sourceUrl
        : getSafeHistoryUrl(domain));
    if (actualNotificationId !== notificationId) {
      delete urls[notificationId];
    }

    const nextUrls = Object.fromEntries(Object.entries(urls).slice(-50));
    const update = { [urlKey]: nextUrls };
    if (!isTest) {
      update[FORMAL_ADOPTION_NOTIFIED_KEY] = [...notifiedIds, tweetId].slice(-200);
    }

    await chrome.storage.local.set(update);
    if (isTest) {
      await saveServiceDiagnostic({
        reasonCode: "notification_test_succeeded",
        event: "notification_test_succeeded",
        ...created.details,
      });
    }
    return created;
  } catch {
    const result = { ok: false, error: "notification state could not be saved" };
    if (isTest) {
      await saveServiceDiagnostic({
        reasonCode: "notification_test_failed",
        event: "notification_test_failed",
        notificationId: String(adoption?.tweetId || "notification-test"),
        error: result.error,
      });
    }
    return result;
  }
}

async function notifyFormalAdoption(adoption, domain) {
  return showFormalAdoptionNotification(adoption, domain);
}

async function handleTestFormalAdoptionNotification() {
  let domain = DEFAULT_OBSERVATORY_DOMAIN;
  try {
    domain = (await getConfig()).domain;
  } catch {
    // The test does not need the webhook secret or a network request.
  }

  return showFormalAdoptionNotification(
    {
      tweetId: "notification-test",
      title: "通知機能は正常に動作しています",
      confidence: null,
      sourceUrl: TEST_HISTORY_URL,
      isTest: true,
    },
    domain,
  );
}

async function handlePostHeartbeat(payload) {
  payload = payload && typeof payload === "object" ? payload : {};
  const { secret, domain } = await getConfig();
  if (!secret) {
    throw new Error("Webhook secret is not configured in extension options.");
  }

  // Retrieve last_page_reload_* fields from chrome.storage.local if not supplied in payload
  const storageData = await chrome.storage.local.get([
    "tibo_last_page_reload_at",
    "tibo_last_page_reload_status",
    "tibo_last_page_reload_error",
  ]);
  const timelineDiagnostics = await getTimelineHeartbeatDiagnostics();
  const heartbeatObservedAt = new Date().toISOString();

  const rawLastPageReloadAt =
    payload.last_page_reload_at ||
    payload.lastPageReloadAt ||
    storageData.tibo_last_page_reload_at ||
    null;

  const rawLastPageReloadStatus =
    payload.last_page_reload_status ||
    payload.lastPageReloadStatus ||
    storageData.tibo_last_page_reload_status ||
    null;

  const rawLastPageReloadError =
    payload.last_page_reload_error ||
    payload.lastPageReloadError ||
    storageData.tibo_last_page_reload_error ||
    null;

  const lastPageReloadStatus = TiboDiagnostics.sanitizePageReloadStatus(rawLastPageReloadStatus);
  const lastPageReloadError =
    lastPageReloadStatus === "error" && rawLastPageReloadError
      ? "page_reload_error"
      : null;

  const enrichedPayload = {
    sessionId: TiboDiagnostics.sanitizeOpaqueId(payload.sessionId) || "session_default",
    lastSuccessfulParseAt: TiboDiagnostics.sanitizeTimestamp(payload.lastSuccessfulParseAt),
    lastSeenTweetId: TiboDiagnostics.sanitizeOpaqueId(payload.lastSeenTweetId),
    newestSeenTweetCreatedAt: TiboDiagnostics.sanitizeTimestamp(payload.newestSeenTweetCreatedAt),
    lastScanError: TiboDiagnostics.sanitizeReasonCode(payload.lastScanError),
    lastScanSummary: TiboDiagnostics.sanitizeScanSummary(payload.lastScanSummary),
    timelineDiagnostics,
    heartbeatObservedAt,
    selectorVersion: TiboDiagnostics.sanitizeSelectorVersion(payload.selectorVersion),
    last_page_reload_at: TiboDiagnostics.sanitizeTimestamp(rawLastPageReloadAt),
    last_page_reload_status: lastPageReloadStatus,
    last_page_reload_error: lastPageReloadError,
  };

  let response;
  try {
    response = await fetch(`${domain}/api/webhook/tibo/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: JSON.stringify(enrichedPayload),
    });
  } catch (err) {
    await saveServiceDiagnostic({
      reasonCode: "heartbeat_network_error",
      messages: ["The heartbeat request failed before receiving a response."],
      error: err?.message || String(err),
    });
    throw new Error("Heartbeat request failed.");
  }

  if (!response.ok) {
    let errorText = "";
    try {
      errorText = await response.text();
    } catch {
      errorText = "Response body could not be read.";
    }
    await saveServiceDiagnostic({
      reasonCode: "heartbeat_http_error",
      httpStatus: response.status,
      responseBody: errorText,
      messages: ["The heartbeat webhook returned a non-2xx response."],
    });
    throw new Error(`Heartbeat webhook returned HTTP ${response.status}.`);
  }

  return await response.json();
}

async function handleTestConnection() {
  const { secret, domain } = await getConfig();
  if (!secret) {
    throw new Error("Webhook secret is not configured.");
  }

  const storageData = await chrome.storage.local.get([
    "tibo_last_page_reload_at",
    "tibo_last_page_reload_status",
    "tibo_last_page_reload_error",
  ]);

  let response;
  try {
    response = await fetch(`${domain}/api/webhook/tibo/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: JSON.stringify({
        leaderTabId: 9999,
        isLeader: true,
        lastSuccessfulParseAt: new Date().toISOString(),
        heartbeatObservedAt: new Date().toISOString(),
        lastSeenTweetId: "test-connection",
        lastScanError: null,
        last_page_reload_at: storageData.tibo_last_page_reload_at || null,
        last_page_reload_status: storageData.tibo_last_page_reload_status || null,
        last_page_reload_error:
          storageData.tibo_last_page_reload_status === "error"
            ? "page_reload_error"
            : null,
      }),
    });
  } catch (err) {
    await saveServiceDiagnostic({
      reasonCode: "heartbeat_network_error",
      messages: ["The connection test failed before receiving a response."],
      error: err?.message || String(err),
    });
    throw new Error("Connection test request failed.");
  }

  if (!response.ok) {
    let errorText = "";
    try {
      errorText = await response.text();
    } catch {
      errorText = "Response body could not be read.";
    }
    await saveServiceDiagnostic({
      reasonCode: "heartbeat_http_error",
      httpStatus: response.status,
      responseBody: errorText,
      messages: ["The connection test returned a non-2xx response."],
    });
    throw new Error(`Connection test returned HTTP ${response.status}.`);
  }

  const result = await response.json();
  try {
    await clearAuthBlockedQuarantine();
  } catch {
    // A successful connection test remains successful if local cleanup fails.
  }
  return result;
}
