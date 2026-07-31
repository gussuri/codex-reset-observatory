/**
 * Service Worker for Tibo Monitor Chrome Extension
 * Serialized Deduplication & Webhook Dispatcher
 */

const QUEUE_KEY = "tibo_processed_tweet_ids";
const ALARM_NAME = "tibo_page_reload_alarm";
const RELOAD_INTERVAL_MINUTES = 10;

// Promise queue for strict serialization (Mutex) across all tabs
let processQueue = Promise.resolve();

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
    // DO NOT overwrite tibo_last_page_reload_at on error
    await chrome.storage.local.set({
      tibo_last_page_reload_status: "error",
      tibo_last_page_reload_error: errorMsg,
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

  const response = await fetch(`${domain}/api/webhook/tibo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const json = await response.json();

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

async function handlePostHeartbeat(payload) {
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

  const lastPageReloadAt =
    payload.last_page_reload_at ||
    payload.lastPageReloadAt ||
    storageData.tibo_last_page_reload_at ||
    null;

  const lastPageReloadStatus =
    payload.last_page_reload_status ||
    payload.lastPageReloadStatus ||
    storageData.tibo_last_page_reload_status ||
    null;

  const lastPageReloadError =
    payload.last_page_reload_error ||
    payload.lastPageReloadError ||
    storageData.tibo_last_page_reload_error ||
    null;

  const enrichedPayload = {
    ...payload,
    last_page_reload_at: lastPageReloadAt,
    last_page_reload_status: lastPageReloadStatus,
    last_page_reload_error: lastPageReloadError,
  };

  const response = await fetch(`${domain}/api/webhook/tibo/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${secret}`,
    },
    body: JSON.stringify(enrichedPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
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

  const response = await fetch(`${domain}/api/webhook/tibo/heartbeat`, {
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
      last_page_reload_error: storageData.tibo_last_page_reload_error || null,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}
