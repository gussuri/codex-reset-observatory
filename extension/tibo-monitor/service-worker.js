/**
 * Service Worker for Tibo Monitor Chrome Extension
 * Serialized Deduplication & Webhook Dispatcher
 */

const QUEUE_KEY = "tibo_processed_tweet_ids";

// Promise queue for strict serialization (Mutex) across all tabs
let processQueue = Promise.resolve();

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

  // 4. Save to chrome.storage.local on 2xx success
  const updatedIds = [...processedIds];
  if (!updatedIds.includes(tweetId)) {
    updatedIds.push(tweetId);
    if (updatedIds.length > 100) {
      updatedIds.shift();
    }
    await chrome.storage.local.set({ [QUEUE_KEY]: updatedIds });
  }

  return { success: true, data: json };
}

async function handlePostHeartbeat(payload) {
  const { secret, domain } = await getConfig();
  if (!secret) {
    throw new Error("Webhook secret is not configured in extension options.");
  }

  const response = await fetch(`${domain}/api/webhook/tibo/heartbeat`, {
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

  return await response.json();
}

async function handleTestConnection() {
  const { secret, domain } = await getConfig();
  if (!secret) {
    throw new Error("Webhook Secret is empty. Please save a valid secret first.");
  }

  const testPayload = {
    sessionId: "connection_test_" + Date.now(),
    lastSuccessfulParseAt: new Date().toISOString(),
    lastSeenTweetId: "0000000000000000000",
    lastScanError: null,
    selectorVersion: "v1.3-extension-test",
  };

  const response = await fetch(`${domain}/api/webhook/tibo/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${secret}`,
    },
    body: JSON.stringify(testPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Connection Test Failed (HTTP ${response.status}): ${errorText}`);
  }

  return await response.json();
}
