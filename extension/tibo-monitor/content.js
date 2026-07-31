/**
 * Content Script for Tibo Monitor Chrome Extension
 * DOM Inspection & Leader Lock.
 * Deduplication responsibility is centralized in service-worker.js & content script session Set.
 */

(function () {
  'use strict';

  const SELECTOR_VERSION = "v1.4-extension";
  const SESSION_KEY = "tibo_session_id";
  const TAB_ID = "tab_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);

  // In-flight tracking within this tab for immediate UI-level throttling
  const inFlightTweetIds = new Set();
  // Session-level Set of processed tweet IDs for this tab so scans skip silently
  const processedTweetIds = new Set();

  // Persistent Session ID across page reloads in single tab
  let sessionId = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
  if (!sessionId && typeof sessionStorage !== "undefined") {
    sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  let lastSuccessfulParseAt = null;
  let lastSeenTweetId = null;
  let lastScanError = null;

  // Check if tweet article is currently showing machine-translated text
  function isTranslatedTweet(article) {
    const translationContainer = article.querySelector(
      '[data-testid="translation-container"], [data-testid="translation"], [aria-label*="Translated"], [aria-label*="翻訳"]'
    );
    if (translationContainer) return true;

    const fullText = article.innerText || "";
    if (
      fullText.includes("Translated from English") ||
      fullText.includes("Google による翻訳") ||
      fullText.includes("DeepL による翻訳") ||
      fullText.includes("原文を表示") ||
      fullText.includes("Show original")
    ) {
      return true;
    }

    return false;
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

    const storageData = await chrome.storage.local.get(["tibo_last_page_reload_at"]);

    const payload = {
      sessionId: sessionId || "session_default",
      lastSuccessfulParseAt,
      lastSeenTweetId,
      lastScanError,
      selectorVersion: SELECTOR_VERSION,
      last_page_reload_at: storageData.tibo_last_page_reload_at || null,
    };

    chrome.runtime.sendMessage({ action: "POST_HEARTBEAT", payload }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Tibo Extension] Heartbeat error:", chrome.runtime.lastError.message);
      } else if (response && response.success) {
        console.log("[Tibo Extension] Heartbeat sent successfully by leader tab.");
      }
    });
  }

  // Send initial heartbeat immediately and schedule 5-min timer
  sendHeartbeat();
  setInterval(sendHeartbeat, 5 * 60 * 1000);

  // Maintain leader lock timestamp every 10s if we are the current leader
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

      for (const article of tweetArticles) {
        const timeEl = article.querySelector("time");
        if (!timeEl) continue;

        // Canonical permalink: Must be closest status link anchored to timeEl
        const linkEl = timeEl.closest('a[href*="/status/"]');
        const textEl = article.querySelector('div[data-testid="tweetText"]');

        if (!linkEl || !textEl) continue;

        const datetime = timeEl.getAttribute("datetime");
        if (!datetime) continue;

        const href = linkEl.getAttribute("href") || "";
        const match = href.match(/\/thsottiaux\/status\/(\d+)/i);

        // Strict URL check: Must belong to @thsottiaux
        if (!match) continue;

        const tweetId = match[1];

        // Silent skip if already processed or currently in-flight
        if (processedTweetIds.has(tweetId) || inFlightTweetIds.has(tweetId)) {
          continue;
        }

        // 1. Skip if translated text is detected
        if (isTranslatedTweet(article)) {
          lastScanError = "translated_text_detected";
          console.warn(`[Tibo Extension] Translated text detected for ${tweetId}. Skipping.`);
          continue;
        }

        const tweetUrl = `https://x.com/thsottiaux/status/${tweetId}`;
        const text = textEl.innerText || "";
        const createdAt = new Date(datetime).toISOString();

        lastSuccessfulParseAt = new Date().toISOString();
        lastSeenTweetId = tweetId;
        lastScanError = null;

        console.log(`[Tibo Extension] New Tweet Found (${tweetId}): ${text.substring(0, 50)}...`);

        // Add to inFlight Set and delegate deduplication to Service Worker
        inFlightTweetIds.add(tweetId);
        sendWebhook(tweetId, text, tweetUrl, createdAt);
      }
    } catch (err) {
      lastScanError = err.message || String(err);
      console.error("[Tibo Extension] Scan error:", err);
    }
  }

  function sendWebhook(tweetId, text, tweetUrl, tweetCreatedAt) {
    const payload = { tweetId, text, tweetUrl, tweetCreatedAt };

    chrome.runtime.sendMessage({ action: "POST_TWEET", payload }, (response) => {
      inFlightTweetIds.delete(tweetId);

      if (chrome.runtime.lastError) {
        console.warn(`[Tibo Extension] Webhook error for ${tweetId}:`, chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        processedTweetIds.add(tweetId);
        if (response.skipped) {
          console.log(`[Tibo Extension] Tweet ${tweetId} was skipped by Service Worker (already in storage).`);
        } else {
          console.log(`[Tibo Extension] Webhook Success for ${tweetId}.`);
        }
      } else {
        console.warn(`[Tibo Extension] Webhook rejected for ${tweetId}:`, response?.error);
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

  console.log("[Tibo Extension] Content script initialized with Service Worker Deduplication Delegation.");
})();
