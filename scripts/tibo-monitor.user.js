// ==UserScript==
// @name         Codex Reset Observatory - Tibo Real-Time Monitor
// @namespace    https://codex-reset-observatory.vercel.app/
// @version      1.0.0
// @description  Monitors Tibo (@thsottiaux) tweets on X in real-time and posts signals to Codex Reset Observatory Webhook.
// @author       Antigravity AI / Codex Reset Observatory
// @match        https://x.com/thsottiaux*
// @match        https://x.com/notifications*
// @match        https://twitter.com/thsottiaux*
// @match        https://twitter.com/notifications*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      codex-reset-observatory.vercel.app
// @connect      localhost
// ==UserScript==

(function () {
  'use strict';

  const SELECTOR_VERSION = "v1";

  // 1. Local Configuration (Secrets & Endpoints)
  const OBSERVATORY_DOMAIN = GM_getValue("observatory_domain", "https://codex-reset-observatory.vercel.app");
  const WEBHOOK_SECRET = GM_getValue("webhook_secret", "");
  const QUEUE_KEY = "tibo_processed_tweet_ids";
  const SESSION_KEY = "tibo_session_id";

  if (!WEBHOOK_SECRET) {
    console.warn("[Tibo Monitor] WARNING: 'webhook_secret' is not configured! Set it via GM_setValue('webhook_secret', 'your_secret')");
  }

  // Generate or retrieve persistent Session ID (resets only when browser restarts or script starts)
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  let lastSuccessfulParseAt = null;
  let lastSeenTweetId = null;
  let lastScanError = null;

  // Helper: Get recent 100 tweet IDs queue
  function getProcessedIds() {
    try {
      return JSON.parse(GM_getValue(QUEUE_KEY, "[]"));
    } catch {
      return [];
    }
  }

  // Helper: Add ID to 100-item sliding window AFTER HTTP 2xx success
  function markIdProcessed(tweetId) {
    const list = getProcessedIds();
    if (!list.includes(tweetId)) {
      list.push(tweetId);
      if (list.length > 100) {
        list.shift(); // Keep latest 100 items
      }
      GM_setValue(QUEUE_KEY, JSON.stringify(list));
    }
  }

  // 2. Heartbeat Sender (Every 5 minutes)
  function sendHeartbeat() {
    if (!WEBHOOK_SECRET) return;

    const payload = {
      sessionId,
      lastSuccessfulParseAt,
      lastSeenTweetId,
      lastScanError,
      selectorVersion: SELECTOR_VERSION,
    };

    GM_xmlhttpRequest({
      method: "POST",
      url: `${OBSERVATORY_DOMAIN}/api/webhook/tibo/heartbeat`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WEBHOOK_SECRET}`,
      },
      data: JSON.stringify(payload),
      onload: function (response) {
        if (response.status >= 200 && response.status < 300) {
          console.log("[Tibo Monitor] Heartbeat sent successfully.");
        }
      },
      onerror: function (err) {
        console.error("[Tibo Monitor] Heartbeat failed:", err);
      },
    });
  }

  // Send initial heartbeat and schedule 5-min timer
  sendHeartbeat();
  setInterval(sendHeartbeat, 5 * 60 * 1000);

  // 3. Tweet DOM Inspector
  function scanTweets() {
    try {
      const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
      const processedIds = getProcessedIds();

      tweetArticles.forEach((article) => {
        const timeEl = article.querySelector("time");
        const linkEl = article.querySelector('a[href*="/status/"]');
        const textEl = article.querySelector('div[data-testid="tweetText"]');

        if (!linkEl || !textEl) return;

        const href = linkEl.getAttribute("href") || "";
        const match = href.match(/\/thsottiaux\/status\/(\d+)/i);

        // Strict URL check: Must belong to @thsottiaux
        if (!match) return;

        const tweetId = match[1];
        const tweetUrl = `https://x.com/thsottiaux/status/${tweetId}`;
        const text = textEl.innerText || "";
        const createdAt = timeEl ? timeEl.getAttribute("datetime") : new Date().toISOString();

        lastSuccessfulParseAt = new Date().toISOString();
        lastSeenTweetId = tweetId;
        lastScanError = null;

        // Skip if already processed in 100-item sliding window
        if (processedIds.includes(tweetId)) return;

        console.log(`[Tibo Monitor] New Tweet Found (${tweetId}): ${text.substring(0, 50)}...`);

        // Post to Webhook API
        sendWebhook(tweetId, text, tweetUrl, createdAt);
      });
    } catch (err) {
      lastScanError = err.message || String(err);
      console.error("[Tibo Monitor] Scan error:", err);
    }
  }

  function sendWebhook(tweetId, text, tweetUrl, tweetCreatedAt) {
    if (!WEBHOOK_SECRET) {
      console.warn("[Tibo Monitor] Cannot send Webhook: Missing secret.");
      return;
    }

    const payload = { tweetId, text, tweetUrl, tweetCreatedAt };

    GM_xmlhttpRequest({
      method: "POST",
      url: `${OBSERVATORY_DOMAIN}/api/webhook/tibo`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WEBHOOK_SECRET}`,
      },
      data: JSON.stringify(payload),
      onload: function (response) {
        if (response.status >= 200 && response.status < 300) {
          console.log(`[Tibo Monitor] Webhook Success for ${tweetId}. Saving to processed queue.`);
          // Save to GM_setValue queue ONLY on 2xx success
          markIdProcessed(tweetId);
        } else {
          console.warn(`[Tibo Monitor] Webhook rejected with HTTP ${response.status}. Will retry on next scan.`);
        }
      },
      onerror: function (err) {
        console.error("[Tibo Monitor] Webhook request error:", err);
      },
    });
  }

  // 4. Initial Scan & MutationObserver Integration
  scanTweets();

  // Run DOM scan on DOM changes
  const observer = new MutationObserver(() => {
    scanTweets();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // 60-second fallback polling interval
  setInterval(scanTweets, 60 * 1000);

  console.log("[Tibo Monitor] Script initialized. Listening on MutationObserver & 60s fallback.");
})();
