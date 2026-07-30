/**
 * Content Script for Tibo Monitor Chrome Extension
 * Strictly handles DOM Inspection & Leader Lock. Contains ZERO secrets.
 */

(function () {
  'use strict';

  const SELECTOR_VERSION = "v1.2-extension";
  const QUEUE_KEY = "tibo_processed_tweet_ids";
  const SESSION_KEY = "tibo_session_id";
  const TAB_ID = "tab_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);

  // In-flight tracking to prevent concurrent requests for the same tweetId
  const inFlightTweetIds = new Set();

  // Persistent Session ID across page reloads in single tab
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  let lastSuccessfulParseAt = null;
  let lastSeenTweetId = null;
  let lastScanError = null;

  // Helper: Get recent 100 tweet IDs queue from chrome.storage.local
  async function getProcessedIds() {
    try {
      const data = await chrome.storage.local.get([QUEUE_KEY]);
      return data[QUEUE_KEY] || [];
    } catch {
      return [];
    }
  }

  // Helper: Add ID to 100-item sliding window AFTER HTTP 2xx success
  async function markIdProcessed(tweetId) {
    const list = await getProcessedIds();
    if (!list.includes(tweetId)) {
      list.push(tweetId);
      if (list.length > 100) {
        list.shift(); // Keep latest 100 items
      }
      await chrome.storage.local.set({ [QUEUE_KEY]: list });
    }
  }

  // Leader Lock Mechanism for Heartbeat
  async function tryAcquireLeaderLock() {
    const now = Date.now();
    const data = await chrome.storage.local.get(["tibo_leader_tab_id", "tibo_leader_timestamp"]);
    const leaderTab = data.tibo_leader_tab_id || "";
    const leaderTimestamp = data.tibo_leader_timestamp || 0;

    if (leaderTab === TAB_ID || !leaderTab || now - leaderTimestamp > 30 * 1000) {
      await chrome.storage.local.set({
        tibo_leader_tab_id: TAB_ID,
        tibo_leader_timestamp: now,
      });
      return true;
    }
    return false;
  }

  async function sendHeartbeat() {
    const isLeader = await tryAcquireLeaderLock();
    if (!isLeader) return;

    const payload = {
      sessionId,
      lastSuccessfulParseAt,
      lastSeenTweetId,
      lastScanError,
      selectorVersion: SELECTOR_VERSION,
    };

    chrome.runtime.sendMessage({ action: "POST_HEARTBEAT", payload }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Tibo Extension] Heartbeat error:", chrome.runtime.lastError.message);
      } else if (response && response.success) {
        console.log("[Tibo Extension] Heartbeat sent successfully by leader tab.");
      }
    });
  }

  // Send initial heartbeat and schedule 5-min timer
  sendHeartbeat();
  setInterval(sendHeartbeat, 5 * 60 * 1000);

  // Maintain leader lock timestamp every 10s
  setInterval(async () => {
    const data = await chrome.storage.local.get(["tibo_leader_tab_id"]);
    if (data.tibo_leader_tab_id === TAB_ID) {
      await chrome.storage.local.set({ tibo_leader_timestamp: Date.now() });
    }
  }, 10 * 1000);

  // Tweet DOM Inspector
  async function scanTweets() {
    try {
      const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
      const processedIds = await getProcessedIds();

      tweetArticles.forEach((article) => {
        const timeEl = article.querySelector("time");
        if (!timeEl) return;

        // Canonical permalink: Must be closest status link anchored to timeEl
        const linkEl = timeEl.closest('a[href*="/status/"]');
        const textEl = article.querySelector('div[data-testid="tweetText"]');

        if (!linkEl || !textEl) return;

        const datetime = timeEl.getAttribute("datetime");
        if (!datetime) return;

        const href = linkEl.getAttribute("href") || "";
        const match = href.match(/\/thsottiaux\/status\/(\d+)/i);

        // Strict URL check: Must belong to @thsottiaux
        if (!match) return;

        const tweetId = match[1];
        const tweetUrl = `https://x.com/thsottiaux/status/${tweetId}`;
        const text = textEl.innerText || "";
        const createdAt = new Date(datetime).toISOString();

        lastSuccessfulParseAt = new Date().toISOString();
        lastSeenTweetId = tweetId;
        lastScanError = null;

        // Skip if already processed or currently in-flight
        if (processedIds.includes(tweetId) || inFlightTweetIds.has(tweetId)) return;

        console.log(`[Tibo Extension] New Tweet Found (${tweetId}): ${text.substring(0, 50)}...`);

        // Add to inFlight Set and send message to background Service Worker
        inFlightTweetIds.add(tweetId);
        sendWebhook(tweetId, text, tweetUrl, createdAt);
      });
    } catch (err) {
      lastScanError = err.message || String(err);
      console.error("[Tibo Extension] Scan error:", err);
    }
  }

  function sendWebhook(tweetId, text, tweetUrl, tweetCreatedAt) {
    const payload = { tweetId, text, tweetUrl, tweetCreatedAt };

    chrome.runtime.sendMessage({ action: "POST_TWEET", payload }, async (response) => {
      inFlightTweetIds.delete(tweetId); // Always clear inFlight flag on response

      if (chrome.runtime.lastError) {
        console.warn(`[Tibo Extension] Webhook error for ${tweetId}:`, chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        console.log(`[Tibo Extension] Webhook Success for ${tweetId}.`);
        await markIdProcessed(tweetId);
      } else {
        console.warn(`[Tibo Extension] Webhook rejected:`, response?.error);
      }
    });
  }

  // Initial Scan & MutationObserver Integration
  scanTweets();

  const observer = new MutationObserver(() => {
    scanTweets();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // 60-second fallback polling interval
  setInterval(scanTweets, 60 * 1000);

  console.log("[Tibo Extension] Content script initialized with Leader Lock & Background Service Worker.");
})();
