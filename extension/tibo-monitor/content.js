/**
 * Content Script for Tibo Monitor Chrome Extension
 * Executes on https://x.com/thsottiaux* and https://x.com/notifications*
 */

(() => {
  // Short-term in-flight set for current tab throttling
  const inFlightTweetIds = new Set();
  // Persistent in-memory set of processed tweet IDs for the active tab session
  const processedTweetIds = new Set();

  let lastSuccessfulParseAt = null;
  let lastSeenTweetId = null;
  let lastScanError = null;

  let currentTabId = null;
  let isLeaderTab = false;

  // Assign a unique session tab ID
  currentTabId = Date.now() + Math.floor(Math.random() * 1000);

  function isTranslatedTweet(articleElement) {
    const text = articleElement.innerText || "";

    // 1. Check for standard X machine translation UI indicators
    if (text.includes("Translated from English") || text.includes("Google による翻訳") || text.includes("DeepL による翻訳")) {
      return true;
    }

    // 2. Check for "Show original" button present when translated
    const buttons = articleElement.querySelectorAll("button, span, div[role='button']");
    for (const btn of buttons) {
      const btnText = (btn.innerText || "").trim();
      if (btnText === "原文を表示" || btnText === "Show original") {
        return true;
      }
    }

    return false;
  }

  function scanTweets() {
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

        // REQUIREMENT 4: Skip without logging "New Tweet Found" if already processed or in-flight
        if (processedTweetIds.has(tweetId) || inFlightTweetIds.has(tweetId)) {
          continue;
        }

        // Skip if translated text is detected
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

        // Add to in-flight set and delegate deduplication to Service Worker
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
        // REQUIREMENT 3: Mark as processed in session Set so it will never be scanned/re-sent again
        processedTweetIds.add(tweetId);
        if (response.skipped) {
          console.log(`[Tibo Extension] Webhook skipped (already processed in Service Worker): ${tweetId}`);
        } else {
          console.log(`[Tibo Extension] Webhook sent successfully: ${tweetId}`);
        }
      } else {
        console.warn(`[Tibo Extension] Webhook failed for ${tweetId}:`, response?.error);
      }
    });
  }

  // --- Leader Lock for Heartbeat ---
  async function acquireLeaderLock() {
    const lockKey = "tibo_leader_tab_id";
    const now = Date.now();
    const result = await chrome.storage.local.get([lockKey, "tibo_leader_last_heartbeat"]);

    const currentLeader = result[lockKey];
    const lastHeartbeat = result.tibo_leader_last_heartbeat || 0;

    // Claim lock if unowned or leader is dead (> 30s)
    if (!currentLeader || now - lastHeartbeat > 30000 || currentLeader === currentTabId) {
      await chrome.storage.local.set({
        [lockKey]: currentTabId,
        tibo_leader_last_heartbeat: now,
      });
      isLeaderTab = true;
    } else {
      isLeaderTab = false;
    }
  }

  function sendHeartbeat() {
    if (!isLeaderTab) return;

    const payload = {
      leaderTabId: currentTabId,
      isLeader: true,
      lastSuccessfulParseAt,
      lastSeenTweetId,
      lastScanError,
    };

    chrome.runtime.sendMessage({ action: "POST_HEARTBEAT", payload }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Tibo Extension] Heartbeat error:", chrome.runtime.lastError.message);
      }
    });
  }

  // --- Initialization & Observers ---

  // 1. Initial scan & MutationObserver
  scanTweets();

  const observer = new MutationObserver(() => {
    scanTweets();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // 2. 60-second fallback scan interval
  setInterval(() => {
    scanTweets();
  }, 60000);

  // 3. Heartbeat & leader lock check every 5 minutes
  acquireLeaderLock();
  setInterval(() => {
    acquireLeaderLock().then(() => {
      if (isLeaderTab) sendHeartbeat();
    });
  }, 300000);
})();
