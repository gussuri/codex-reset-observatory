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

async function handleReloadAlarm() {
  const now = new Date().toISOString();
  try {
    if (typeof chrome === "undefined" || !chrome.tabs) {
      return { success: false, error: "chrome.tabs is unavailable" };
    }

    // Query for tabs monitoring Tibo's profile on X / Twitter
    const tabs = await chrome.tabs.query({
      url: [
        "https://x.com/thsottiaux*",
        "https://twitter.com/thsottiaux*",
      ],
    });

    if (!tabs || tabs.length === 0) {
      console.log("[Service Worker] Monitored tab missing for page reload. Saving status monitored_tab_missing.");
      await chrome.storage.local.set({
        tibo_last_page_reload_at: now,
        tibo_last_page_reload_status: "monitored_tab_missing",
      });
      return { success: true, status: "monitored_tab_missing" };
    }

    // Select exactly 1 tab if multiple exist
    const targetTab = tabs[0];
    await chrome.tabs.reload(targetTab.id);

    console.log(`[Service Worker] Reloaded monitored tab ${targetTab.id} at ${now}.`);
    await chrome.storage.local.set({
      tibo_last_page_reload_at: now,
      tibo_last_page_reload_status: "success",
      tibo_reloaded_tab_id: targetTab.id,
    });

    return { success: true, status: "success", tabId: targetTab.id, reloadedAt: now };
  } catch (err) {
    console.error("[Service Worker] Page reload error:", err);
    await chrome.storage.local.set({
      tibo_last_page_reload_at: now,
      tibo_last_page_reload_status: "error",
      tibo_last_page_reload_error: err.message || String(err),
    });
    return { success: false, error: err.message || String(err) };
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

  // Retrieve last_page_reload_at from chrome.storage.local if not supplied directly
  const storageData = await chrome.storage.local.get(["tibo_last_page_reload_at"]);
  const lastPageReloadAt =
    payload.last_page_reload_at ||
    payload.lastPageReloadAt ||
    storageData.tibo_last_page_reload_at ||
    null;

  const enrichedPayload = {
    ...payload,
    last_page_reload_at: lastPageReloadAt,
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

  const storageData = await chrome.storage.local.get(["tibo_last_page_reload_at"]);

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
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}
