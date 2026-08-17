/**
 * Content Script for Tibo Monitor Chrome Extension
 * DOM Inspection & Leader Lock.
 * Deduplication responsibility is centralized in service-worker.js & content script session Set.
 */

(function () {
  'use strict';

  const SELECTOR_VERSION = "v1.8-thread-replies";
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
  let newestSeenTweetCreatedAt = null;
  let lastScanError = null;
  let lastScanSummary = null;
  let extensionContextInvalidated = false;
  const intervalIds = [];
  let mutationObserver = null;
  let monitoredTimeline = TiboMonitorScan.getTimelineSource(window.location.href);
  const timelineRestoreGate = TiboMonitorScan.createTimelineRestoreGate();

  function getSourceTimeline() {
    const detected = TiboMonitorScan.getTimelineSource(window.location.href);
    if (detected) return detected;
    return /\/notifications(?:\/|$)/i.test(window.location.pathname)
      ? "profile"
      : null;
  }

  async function restoreMonitoredTimelineIfNeeded() {
    const currentTimeline = TiboMonitorScan.getTimelineSource(window.location.href);
    if (currentTimeline) {
      monitoredTimeline = currentTimeline;
      timelineRestoreGate.reset();
      return false;
    }

    if (!TiboMonitorScan.shouldRestoreMonitoredTimeline(window.location.href, monitoredTimeline)) {
      return false;
    }

    if (!timelineRestoreGate.tryStart()) return true;

    try {
      await requestServiceWorker("RESTORE_MONITORED_TIMELINE", {
        timeline: monitoredTimeline,
      });
    } catch (error) {
      handleExtensionError(error, "timeline restore");
    } finally {
      timelineRestoreGate.finish();
    }
    return true;
  }

  function handleExtensionError(error, operation) {
    if (TiboExtensionRuntime.isExtensionContextInvalidated(error)) {
      if (!extensionContextInvalidated) {
        console.info(
          "[Tibo Extension] Extension context invalidated; stopping until the page is reloaded.",
        );
      }
      extensionContextInvalidated = true;
      intervalIds.forEach((intervalId) => clearInterval(intervalId));
      mutationObserver?.disconnect();
      return;
    }

    console.warn(`[Tibo Extension] ${operation} failed:`, error);
  }

  function runExtensionTask(task, operation) {
    if (extensionContextInvalidated) return Promise.resolve();
    return TiboExtensionRuntime.runSafely(task, (error) => {
      handleExtensionError(error, operation);
    });
  }

  function scheduleExtensionInterval(task, delay, operation) {
    const intervalId = setInterval(() => {
      runExtensionTask(task, operation);
    }, delay);
    intervalIds.push(intervalId);
    return intervalId;
  }

  function requestServiceWorker(action, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.success) {
          reject(new Error(response?.error || "Service worker request failed."));
          return;
        }
        resolve(response.data);
      });
    });
  }

  function isCurrentRepliesTimeline() {
    return TiboMonitorScan.getTimelineSource(window.location.href) === "with_replies";
  }

  if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request?.action !== "CAPTURE_WITH_REPLIES_DOM") return false;

      if (!isCurrentRepliesTimeline()) {
        sendResponse({ success: false, error: "not_replies_page" });
        return false;
      }

      try {
        const data = TiboMonitorScan.captureRawDomToDownload(
          document,
          URL,
          Blob,
        );
        sendResponse({ success: true, data });
      } catch {
        sendResponse({ success: false, error: "dom_capture_failed" });
      }
      return false;
    });
  }

  function getMonitorState(keys) {
    return requestServiceWorker("GET_CONTENT_MONITOR_STATE", { keys });
  }

  function setMonitorState(items) {
    return requestServiceWorker("SET_CONTENT_MONITOR_STATE", { items });
  }

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
    const data = await getMonitorState(["tibo_leader_tab_id", "tibo_leader_timestamp"]);
    const leaderTab = data.tibo_leader_tab_id || "";
    const leaderTimestamp = data.tibo_leader_timestamp || 0;

    if (leaderTab === TAB_ID || !leaderTab || now - leaderTimestamp > 30 * 1000) {
      await setMonitorState({
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

    const storageData = await getMonitorState([
      "tibo_last_page_reload_at",
      "tibo_last_page_reload_status",
      "tibo_last_page_reload_error",
    ]);

    const payload = {
      sessionId: sessionId || "session_default",
      lastSuccessfulParseAt,
      lastSeenTweetId,
      newestSeenTweetCreatedAt,
      lastScanError,
      lastScanSummary,
      selectorVersion: SELECTOR_VERSION,
      last_page_reload_at: storageData.tibo_last_page_reload_at || null,
      last_page_reload_status: storageData.tibo_last_page_reload_status || null,
      last_page_reload_error: storageData.tibo_last_page_reload_error || null,
    };

    chrome.runtime.sendMessage({ action: "POST_HEARTBEAT", payload }, (response) => {
      try {
        if (chrome.runtime.lastError) {
          handleExtensionError(
            new Error(chrome.runtime.lastError.message),
            "heartbeat message",
          );
        } else if (response && response.success) {
          console.log("[Tibo Extension] Heartbeat sent successfully by leader tab.");
        }
      } catch (error) {
        handleExtensionError(error, "heartbeat callback");
      }
    });
  }

  // Send initial heartbeat immediately and schedule 5-min timer
  runExtensionTask(sendHeartbeat, "initial heartbeat");
  scheduleExtensionInterval(sendHeartbeat, 5 * 60 * 1000, "heartbeat");

  // Maintain leader lock timestamp every 10s if we are the current leader
  async function refreshLeaderLock() {
    const data = await getMonitorState(["tibo_leader_tab_id"]);
    if (data.tibo_leader_tab_id === TAB_ID) {
      await setMonitorState({ tibo_leader_timestamp: Date.now() });
    }
  }

  scheduleExtensionInterval(refreshLeaderLock, 10 * 1000, "leader lock");

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
    const settingsData = await getMonitorState([
      "tibo_diagnostics_enabled",
      "tibo_diagnostics_mask_text",
    ]);
    const settings = {
      enabled: settingsData.tibo_diagnostics_enabled !== false,
      maskPostText: settingsData.tibo_diagnostics_mask_text !== false,
    };
    if (!settings.enabled) return;

    const snapshots = Array.from(articles)
      .slice(0, 3)
      .map((article) => buildArticleSnapshot(article, settings.maskPostText));

    await requestServiceWorker("SAVE_CONTENT_SCAN_DIAGNOSTIC", {
      entry: {
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
      },
    });
  }

  async function scanTweets() {
    if (await restoreMonitoredTimelineIfNeeded()) return;

    const scanTimestamp = new Date().toISOString();
    let tweetArticles = [];
    const records = [];
    const scanMessages = [];
    let scanError = null;
    let newestParsedTweet = null;
    const sourceTimeline = getSourceTimeline();

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
        const createdAt = new Date(datetime).toISOString();

        newestParsedTweet = TiboMonitorScan.selectNewestParsedTweet(newestParsedTweet, {
          tweetId,
          createdAt,
        });

        const replyMetadata = TiboMonitorScan.extractReplyMetadata(article, {
          sourceTimeline,
        });
        if (replyMetadata?.needsRetry === true) {
          continue;
        }

        // Silent skip if already processed or currently in-flight
        if (processedTweetIds.has(tweetId) || inFlightTweetIds.has(tweetId)) {
          continue;
        }

        const tweetUrl = `https://x.com/thsottiaux/status/${tweetId}`;
        const text = textEl.innerText || "";

        console.log(`[Tibo Extension] New Tweet Found (${tweetId}): ${text.substring(0, 50)}...`);

        // Add to inFlight Set and delegate deduplication to Service Worker
        inFlightTweetIds.add(tweetId);
        sendWebhook(
          tweetId,
          text,
          tweetUrl,
          createdAt,
          replyMetadata,
          sourceTimeline,
        );
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
      getSourceTimeline(),
    );
    lastScanSummary = summary;

    if (summary.parseSuccessCount > 0) {
      lastSuccessfulParseAt = new Date().toISOString();
      lastSeenTweetId = newestParsedTweet?.tweetId || lastSeenTweetId;
      newestSeenTweetCreatedAt = newestParsedTweet?.createdAt || newestSeenTweetCreatedAt;
      lastScanError = null;
      requestServiceWorker("MARK_CONTENT_SCAN_SUCCESS").catch((error) => {
        handleExtensionError(error, "diagnostic recovery marker");
      });
    }

    const reasonCode = TiboDiagnostics.getScanFailureReason(summary);
    if (reasonCode) {
      saveScanDiagnostic(summary, reasonCode, tweetArticles, scanMessages, scanError).catch((error) => {
        handleExtensionError(error, "diagnostic log");
      });
    }
  }

  function sendWebhook(
    tweetId,
    text,
    tweetUrl,
    tweetCreatedAt,
    replyMetadata,
    sourceTimeline,
  ) {
    const payload = {
      tweetId,
      text,
      tweetUrl,
      tweetCreatedAt,
      isReply: replyMetadata?.isReply === true,
      replyToHandles: Array.isArray(replyMetadata?.replyToHandles)
        ? replyMetadata.replyToHandles
        : [],
      replyContextText: replyMetadata?.replyContextText || null,
      sourceTimeline: sourceTimeline || null,
      isQuote: replyMetadata?.isQuote === true,
      quoteContextText: replyMetadata?.quoteContextText || null,
      quoteTweetUrl: replyMetadata?.quoteTweetUrl || null,
      quoteAuthorHandle: replyMetadata?.quoteAuthorHandle || null,
    };

    try {
      chrome.runtime.sendMessage({ action: "POST_TWEET", payload }, (response) => {
        inFlightTweetIds.delete(tweetId);

        try {
          if (chrome.runtime.lastError) {
            handleExtensionError(
              new Error(chrome.runtime.lastError.message),
              `Webhook for ${tweetId}`,
            );
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
        } catch (error) {
          handleExtensionError(error, `Webhook callback for ${tweetId}`);
        }
      });
    } catch (error) {
      inFlightTweetIds.delete(tweetId);
      handleExtensionError(error, `Webhook for ${tweetId}`);
    }
  }

  // Initial Scan & MutationObserver Integration
  runExtensionTask(scanTweets, "initial scan");

  mutationObserver = new MutationObserver(() => {
    runExtensionTask(scanTweets, "DOM scan");
  });

  mutationObserver.observe(document.body, { childList: true, subtree: true });

  // 60-second fallback polling interval
  scheduleExtensionInterval(scanTweets, 60 * 1000, "polling scan");

  console.log("[Tibo Extension] Content script initialized with Service Worker Deduplication Delegation.");
})();
