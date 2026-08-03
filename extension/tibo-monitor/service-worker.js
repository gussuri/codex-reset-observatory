/**
 * Service Worker for Tibo Monitor Chrome Extension
 * Serialized Deduplication & Webhook Dispatcher
 */

importScripts("diagnostics.js");

const QUEUE_KEY = "tibo_processed_tweet_ids";
const FORMAL_ADOPTION_NOTIFIED_KEY = "tibo_formal_adoption_notified_ids";
const FORMAL_ADOPTION_NOTIFICATION_URLS_KEY = "tibo_formal_adoption_notification_urls";
const ALARM_NAME = "tibo_page_reload_alarm";
const RELOAD_INTERVAL_MINUTES = 10;
const HISTORY_PATH = "/history";

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
      ]);
      const urls = data[FORMAL_ADOPTION_NOTIFICATION_URLS_KEY] || {};
      const url = urls[notificationId] || null;
      const fallbackDomain = (await getConfig()).domain;
      const fallbackUrl = getSafeHistoryUrl(fallbackDomain);
      const targetUrl = isSafeNotificationUrl(url)
        ? url
        : fallbackUrl;

      if (chrome.tabs && typeof chrome.tabs.create === "function") {
        await chrome.tabs.create({ url: targetUrl });
      }

      delete urls[notificationId];
      await chrome.storage.local.set({
        [FORMAL_ADOPTION_NOTIFICATION_URLS_KEY]: urls,
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

function createNotification(notificationId, options) {
  return new Promise((resolve) => {
    if (!chrome.notifications || typeof chrome.notifications.create !== "function") {
      resolve(false);
      return;
    }

    try {
      chrome.notifications.create(notificationId, options, (createdId) => {
        resolve(!chrome.runtime?.lastError && Boolean(createdId));
      });
    } catch {
      resolve(false);
    }
  });
}

async function notifyFormalAdoption(adoption, domain) {
  if (!adoption || adoption.newlyAdopted !== true || !adoption.tweetId) {
    return;
  }

  const tweetId = String(adoption.tweetId);
  const stored = await chrome.storage.local.get([
    FORMAL_ADOPTION_NOTIFIED_KEY,
    FORMAL_ADOPTION_NOTIFICATION_URLS_KEY,
  ]);
  const notifiedIds = Array.isArray(stored[FORMAL_ADOPTION_NOTIFIED_KEY])
    ? stored[FORMAL_ADOPTION_NOTIFIED_KEY]
    : [];

  if (notifiedIds.includes(tweetId)) return;

  const notificationId = `tibo-formal-adoption-${tweetId}`;
  const confidence =
    typeof adoption.confidence === "number"
      ? ` (${Math.round(adoption.confidence * 100)}%)`
      : "";
  const title =
    typeof adoption.title === "string" && adoption.title.trim()
      ? adoption.title.trim()
      : "ランダムリセット";
  const created = await createNotification(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon.svg"),
    title: "Codexリセットを正式採用",
    message: `${title}${confidence}`,
    priority: 2,
  });

  if (!created) return;

  const nextIds = [...notifiedIds, tweetId].slice(-200);
  const urls =
    stored[FORMAL_ADOPTION_NOTIFICATION_URLS_KEY] &&
    typeof stored[FORMAL_ADOPTION_NOTIFICATION_URLS_KEY] === "object"
      ? { ...stored[FORMAL_ADOPTION_NOTIFICATION_URLS_KEY] }
      : {};
  urls[notificationId] = isSafeNotificationUrl(adoption.sourceUrl)
    ? adoption.sourceUrl
    : getSafeHistoryUrl(domain);

  await chrome.storage.local.set({
    [FORMAL_ADOPTION_NOTIFIED_KEY]: nextIds,
    [FORMAL_ADOPTION_NOTIFICATION_URLS_KEY]: urls,
  });
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
