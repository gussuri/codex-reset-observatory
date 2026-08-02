/**
 * Content Script for Tibo Monitor Chrome Extension
 * DOM Inspection & Leader Lock.
 * Deduplication responsibility is centralized in service-worker.js & content script session Set.
 */

(function () {
  'use strict';

  const SELECTOR_VERSION = "v1.5-diagnostics";
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
  let lastScanSummary = null;

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

    const storageData = await chrome.storage.local.get([
      "tibo_last_page_reload_at",
      "tibo_last_page_reload_status",
      "tibo_last_page_reload_error",
    ]);

    const payload = {
      sessionId: sessionId || "session_default",
      lastSuccessfulParseAt,
      lastSeenTweetId,
      lastScanError,
      lastScanSummary,
      selectorVersion: SELECTOR_VERSION,
      last_page_reload_at: storageData.tibo_last_page_reload_at || null,
      last_page_reload_status: storageData.tibo_last_page_reload_status || null,
      last_page_reload_error: storageData.tibo_last_page_reload_error || null,
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
  function buildArticleSnapshot(article, maskPostText) {
    const clone = article.cloneNode(true);
    clone
      .querySelectorAll("script, style, svg, img, video, source, iframe")
      .forEach((element) => element.remove());

    clone.querySelectorAll("input, textarea, select").forEach((element) => {
      element.textContent = "[REDACTED]";
      element.setAttribute("value", "[REDACTED]");
    });

    [clone, ...clone.querySelectorAll("*")].forEach((element) => {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        if (
          /authorization|proxy-authorization|cookie|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|password/.test(
            name,
          )
        ) {
          element.setAttribute(attribute.name, "[REDACTED]");
        } else if (/^(data|blob):/i.test(value)) {
          element.setAttribute(attribute.name, "[REDACTED_URL]");
        }
      }
    });

    if (maskPostText) {
      clone.querySelectorAll('[data-testid="tweetText"]').forEach((element) => {
        element.textContent = "[POST_TEXT_MASKED]";
      });
      clone
        .querySelectorAll('[data-testid="User-Name"], [data-testid="UserName"], [data-testid="User-Names"]')
        .forEach((element) => {
          element.textContent = "[DISPLAY_NAME_MASKED]";
        });
    }

    return TiboDiagnostics.sanitizeSnapshotHtml(clone.outerHTML, {
      maskPostText,
      maxChars: TiboDiagnostics.MAX_SNAPSHOT_CHARS,
    });
  }

  async function saveScanDiagnostic(summary, reasonCode, articles, messages, error) {
    const settings = await TiboDiagnostics.getDiagnosticSettings(chrome.storage.local);
    if (!settings.enabled) return;

    const snapshots = Array.from(articles)
      .slice(0, 3)
      .map((article) => buildArticleSnapshot(article, settings.maskPostText));

    await TiboDiagnostics.appendDiagnosticLog(chrome.storage.local, {
      type: "scan",
      reasonCode,
      currentUrl: summary.currentUrl,
      selectorVersion: SELECTOR_VERSION,
      scanTimestamp: summary.scanTimestamp,
      summary,
      snapshots,
      messages: [
        "No new Tibo post was parsed during this scan.",
        `reason=${reasonCode}`,
        `articles=${summary.articleCount}, time=${summary.timeElementCount}, text=${summary.tweetTextCount}, matchingStatus=${summary.matchingTiboStatusCount}, translated=${summary.translatedTweetCount}`,
        ...(messages || []),
        ...(error ? [TiboDiagnostics.sanitizeDiagnosticText(error.message || error)] : []),
      ],
    });
  }

  async function scanTweets() {
    const scanTimestamp = new Date().toISOString();
    let tweetArticles = [];
    const records = [];
    const scanMessages = [];
    let scanError = null;

    try {
      tweetArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));

      for (const article of tweetArticles) {
        const timeEl = article.querySelector("time");
        const textEl = article.querySelector('div[data-testid="tweetText"]');
        const translated = isTranslatedTweet(article);
        const linkEl = timeEl?.closest('a[href*="/status/"]');
        const href = linkEl?.getAttribute("href") || "";
        const match = href.match(/\/thsottiaux\/status\/(\d+)/i);
        const datetime = timeEl?.getAttribute("datetime") || "";
        const hasValidDatetime = Boolean(datetime && !Number.isNaN(new Date(datetime).getTime()));

        const record = {
          hasTime: Boolean(timeEl),
          hasTweetText: Boolean(textEl),
          hasMatchingTiboStatus: Boolean(match),
          isTranslated: translated,
          hasValidDatetime,
          isParseSuccess: false,
        };
        records.push(record);

        if (!timeEl) continue;

        // Canonical permalink: Must be closest status link anchored to timeEl
        if (!linkEl || !textEl) continue;
        if (!datetime) continue;

        // Strict URL check: Must belong to @thsottiaux
        if (!match) continue;

        if (!hasValidDatetime) continue;

        // Translation is checked after the safe DOM counters are collected.
        if (translated) {
          lastScanError = "translated_text_detected";
          console.warn(`[Tibo Extension] Translated text detected for ${match[1]}. Skipping.`);
          continue;
        }

        // A valid DOM parse is useful even when the webhook deduplicator skips the tweet.
        record.isParseSuccess = true;

        const tweetId = match[1];

        // Silent skip if already processed or currently in-flight
        if (processedTweetIds.has(tweetId) || inFlightTweetIds.has(tweetId)) {
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
      lastScanError = "scan_exception";
      scanError = err;
      scanMessages.push("The DOM scan raised an exception.");
      console.error("[Tibo Extension] Scan error:", err);
    }

    const summary = TiboDiagnostics.buildScanSummary(
      records,
      window.location.href,
      SELECTOR_VERSION,
      scanTimestamp,
    );
    lastScanSummary = summary;

    const reasonCode = TiboDiagnostics.getScanFailureReason(summary);
    if (reasonCode) {
      saveScanDiagnostic(summary, reasonCode, tweetArticles, scanMessages, scanError).catch((error) => {
        console.warn("[Tibo Extension] Diagnostic log save failed:", error);
      });
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
