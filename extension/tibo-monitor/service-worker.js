/**
 * Service Worker for Tibo Monitor Chrome Extension
 * Serialized Deduplication & Webhook Dispatcher
 */

importScripts("diagnostics.js");

const QUEUE_KEY = "tibo_processed_tweet_ids";
const FORMAL_ADOPTION_NOTIFIED_KEY = "tibo_formal_adoption_notified_ids";
const FORMAL_ADOPTION_NOTIFICATION_URLS_KEY = "tibo_formal_adoption_notification_urls";
const TEST_FORMAL_ADOPTION_NOTIFICATION_URLS_KEY = "tibo_formal_adoption_test_notification_urls";
const ALARM_NAME = "tibo_page_reload_alarm";
const RELOAD_INTERVAL_MINUTES = 10;
const HISTORY_PATH = "/history";
const TEST_HISTORY_URL = "https://codex-reset-observatory.vercel.app/history";
let notificationIconDiagnosticsPromise = null;
let notificationIconDiagnosticsUrl = null;

// Promise queue for strict serialization (Mutex) across all tabs
let processQueue = Promise.resolve();

function saveServiceDiagnostic(entry) {
  return TiboDiagnostics.appendDiagnosticLog(chrome.storage.local, {
    type: "service_worker",
    ...entry,
  }).catch(() => {});
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

setupReloadAlarm();

if (typeof chrome !== "undefined" && chrome.runtime) {
  if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => setupReloadAlarm());
  }
  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => setupReloadAlarm());
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

function isProfileTabUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    if (host !== "x.com" && host !== "twitter.com") return false;
    const pathname = url.pathname;
    return pathname === "/thsottiaux" || pathname === "/thsottiaux/";
  } catch {
    return false;
  }
}

async function handleReloadAlarm() {
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

    // Filter strictly for profile tabs (/thsottiaux or /thsottiaux/)
    const profileTabs = (candidateTabs || []).filter((tab) => isProfileTabUrl(tab.url));

    if (profileTabs.length === 0) {
      console.log("[Service Worker] Monitored profile tab missing. Preserving last_page_reload_at, saving status monitored_tab_missing.");
      // DO NOT overwrite tibo_last_page_reload_at on missing
      await chrome.storage.local.set({
        tibo_last_page_reload_status: "monitored_tab_missing",
        tibo_last_page_reload_error: null,
      });
      return { success: true, status: "monitored_tab_missing" };
    }

    // Select exactly 1 profile tab if multiple exist
    const targetTab = profileTabs[0];
    await chrome.tabs.reload(targetTab.id);

    console.log(`[Service Worker] Successfully reloaded profile tab ${targetTab.id} at ${now}.`);
    // Update last_page_reload_at ONLY on success
    await chrome.storage.local.set({
      tibo_last_page_reload_at: now,
      tibo_last_page_reload_status: "success",
      tibo_last_page_reload_error: null,
      tibo_reloaded_tab_id: targetTab.id,
    });

    return { success: true, status: "success", tabId: targetTab.id, reloadedAt: now };
  } catch (err) {
    const errorMsg = err.message || String(err);
    console.error("[Service Worker] Page reload error:", err);
    // DO NOT overwrite tibo_last_page_reload_at on error. Keep only a safe code in sync data.
    await chrome.storage.local.set({
      tibo_last_page_reload_status: "error",
      tibo_last_page_reload_error: "page_reload_error",
    });
    await saveServiceDiagnostic({
      reasonCode: "page_reload_error",
      messages: ["The monitored profile tab could not be reloaded."],
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "POST_TWEET") {
    // Enqueue POST_TWEET through serialized Promise queue
    enqueuePostTweet(request.payload)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
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
  const domain = data.observatory_domain || "https://codex-reset-observatory.vercel.app";
  return { secret, domain: domain.replace(/\/+$/, "") };
}

function enqueuePostTweet(payload) {
  const resultPromise = processQueue.then(() => executePostTweet(payload));
  processQueue = resultPromise.catch(() => {});
  return resultPromise;
}

async function executePostTweet(payload) {
  const { tweetId } = payload;
  if (!tweetId) {
    throw new Error("Missing tweetId in payload.");
  }

  // 1. Get processed IDs from chrome.storage.local
  const storageData = await chrome.storage.local.get([QUEUE_KEY]);
  const processedIds = storageData[QUEUE_KEY] || [];

  // 2. Skip if already processed in storage
  if (processedIds.includes(tweetId)) {
    console.log(`[Service Worker] Tweet ${tweetId} already processed. Skipping fetch.`);
    return { success: true, skipped: true };
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
    });
    throw new Error("Tweet webhook request failed.");
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
      messages: ["The tweet webhook returned a non-2xx response."],
    });
    throw new Error(`Tweet webhook returned HTTP ${response.status}.`);
  }

  const json = await response.json();

  // Formal-adoption notifications are best-effort and isolated from the
  // collection queue. A failed Chrome notification must not fail the post.
  try {
    await notifyFormalAdoption(json?.formalAdoption, domain);
  } catch {
    // Keep the webhook success result even when notification APIs are absent.
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
        url.hostname === "codex-reset-observatory.vercel.app")
    );
  } catch {
    return false;
  }
}

function getSafeHistoryUrl(domain) {
  const configured = `${domain}${HISTORY_PATH}`;
  return isSafeNotificationUrl(configured)
    ? configured
    : `https://codex-reset-observatory.vercel.app${HISTORY_PATH}`;
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

function callChromeApi(method, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const callback = (...values) => {
      const lastError = getRuntimeLastErrorMessage();
      if (lastError) {
        finish(reject, new Error(lastError));
        return;
      }
      finish(resolve, values.length <= 1 ? values[0] : values);
    };

    try {
      const result = method(...args, callback);
      if (result && typeof result.then === "function") {
        result.then(
          (value) => finish(resolve, value),
          (error) => finish(reject, error),
        );
      } else if (result !== undefined) {
        finish(resolve, result);
      } else if (method.length <= args.length) {
        setTimeout(() => finish(resolve, undefined), 0);
      }
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function getNotificationPermissionLevel() {
  if (
    !chrome.notifications ||
    typeof chrome.notifications.getPermissionLevel !== "function"
  ) {
    return { level: "unavailable", error: null };
  }

  try {
    const level = await callChromeApi(
      chrome.notifications.getPermissionLevel.bind(chrome.notifications),
      [],
    );
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
    const notifications = await callChromeApi(
      chrome.notifications.getAll.bind(chrome.notifications),
      [],
    );
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

async function createNotificationWithDiagnostics(notificationId, options) {
  const details = {
    notificationId,
    iconUrl: options?.iconUrl || null,
    apiAvailable: Boolean(
      chrome.notifications && typeof chrome.notifications.create === "function",
    ),
    permissionLevel: "unavailable",
    iconLoadStatus: "not_checked",
  };

  if (!details.apiAvailable) {
    return {
      ok: false,
      error: "notifications API is unavailable",
      details,
    };
  }

  const permission = await getNotificationPermissionLevel();
  details.permissionLevel = permission.level;
  if (permission.level === "denied") {
    return {
      ok: false,
      error: "Chrome extension notification permission is denied.",
      details: {
        ...details,
        ...(permission.error || {}),
      },
    };
  }

  const icon = await inspectNotificationIcon(options?.iconUrl);
  details.iconLoadStatus = icon.status;
  if (icon.status !== "ok") {
    return {
      ok: false,
      error: icon.errorMessage || "Notification icon could not be loaded.",
      details: {
        ...details,
        ...icon,
      },
    };
  }

  try {
    const createdId = await callChromeApi(
      chrome.notifications.create.bind(chrome.notifications),
      [notificationId, options],
    );
    if (!createdId) {
      return {
        ok: false,
        error: "notifications.create returned no id",
        details,
      };
    }

    const verification = await verifyNotificationCreated(createdId);
    return {
      ok: true,
      notificationId: createdId,
      details: {
        ...details,
        notificationPresence: verification.status,
        ...(verification.errorName ? { errorName: verification.errorName } : {}),
        ...(verification.errorMessage ? { errorMessage: verification.errorMessage } : {}),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: sanitizeNotificationError(error, "notifications.create failed"),
      details: {
        ...details,
        errorName: error?.name || "Error",
        errorMessage: sanitizeNotificationError(error, "notifications.create failed"),
      },
    };
  }
}

function createTestNotificationId() {
  return `tibo-formal-adoption-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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
  let domain = "https://codex-reset-observatory.vercel.app";
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
    lastScanError: TiboDiagnostics.sanitizeReasonCode(payload.lastScanError),
    lastScanSummary: TiboDiagnostics.sanitizeScanSummary(payload.lastScanSummary),
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

  return await response.json();
}
