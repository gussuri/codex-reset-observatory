(function (global) {
  "use strict";

  function selectNewestParsedTweet(current, candidate) {
    if (!candidate || typeof candidate.tweetId !== "string" || candidate.tweetId.length === 0) {
      return current || null;
    }

    const timestamp = new Date(candidate.createdAt).getTime();
    if (!Number.isFinite(timestamp)) return current || null;
    if (current && timestamp <= current.timestamp) return current;

    return {
      tweetId: candidate.tweetId,
      createdAt: new Date(timestamp).toISOString(),
      timestamp,
    };
  }

  function getTimelineSource(urlString) {
    if (!urlString) return null;
    try {
      const url = new URL(urlString);
      const host = url.hostname.toLowerCase();
      if (host !== "x.com" && host !== "twitter.com") return null;
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      if (pathname === "/thsottiaux") return "profile";
      if (pathname === "/thsottiaux/with_replies") return "with_replies";
      return null;
    } catch {
      return null;
    }
  }

  function isTiboStatusUrl(urlString) {
    if (!urlString) return false;
    try {
      const url = new URL(urlString);
      const host = url.hostname.toLowerCase();
      if (host !== "x.com" && host !== "twitter.com") return false;
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      return /^\/thsottiaux\/status\/\d+$/i.test(pathname);
    } catch {
      return false;
    }
  }

  function shouldRestoreMonitoredTimeline(urlString, monitoredTimeline) {
    return (
      (monitoredTimeline === "profile" || monitoredTimeline === "with_replies")
      && isTiboStatusUrl(urlString)
      && getTimelineSource(urlString) === null
    );
  }

  function createTimelineRestoreGate(debounceMs = 3000, now = () => Date.now()) {
    let inFlight = false;
    let lastRequestedAt = Number.NEGATIVE_INFINITY;

    return {
      tryStart() {
        const currentTime = now();
        if (!Number.isFinite(currentTime)) return false;
        if (inFlight || currentTime - lastRequestedAt < debounceMs) return false;
        inFlight = true;
        lastRequestedAt = currentTime;
        return true;
      },
      finish() {
        inFlight = false;
      },
      reset() {
        inFlight = false;
        lastRequestedAt = Number.NEGATIVE_INFINITY;
      },
    };
  }

  function getReplyMarker(article) {
    if (!article || typeof article.querySelector !== "function") return null;
    const selectors = [
      '[data-testid="socialContext"]',
      '[data-testid="replyContext"]',
      '[aria-label*="Replying to"]',
      '[aria-label*="返信先"]',
      '[aria-label*="回复给"]',
    ];

    for (const selector of selectors) {
      const marker = article.querySelector(selector);
      if (!marker) continue;
      const markerText = `${marker.innerText || ""} ${marker.getAttribute?.("aria-label") || ""}`;
      if (/replying to|返信先|回复给/i.test(markerText)) return marker;
    }
    return null;
  }

  function extractHandleFromHref(href) {
    if (typeof href !== "string" || href.length === 0) return null;
    try {
      const url = new URL(href, "https://x.com");
      const pathname = url.pathname.replace(/^\/+|\/+$/g, "");
      if (!/^[A-Za-z0-9_]{1,15}$/.test(pathname)) return null;
      return `@${pathname}`;
    } catch {
      return null;
    }
  }

  function extractQuoteTweetUrl(href) {
    if (typeof href !== "string" || href.length === 0) return null;
    try {
      const url = new URL(href, "https://x.com");
      if (url.protocol !== "https:" || !/^(x|twitter)\.com$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/i);
      if (!match) return null;
      return {
        url: `https://${url.hostname.toLowerCase()}/${match[1]}/status/${match[2]}`,
        handle: `@${match[1]}`,
      };
    } catch {
      return null;
    }
  }

  function getQuoteMarker(article) {
    if (!article || typeof article.querySelector !== "function") return null;
    const selectors = [
      '[data-testid="quoteTweet"]',
      '[data-testid="quotedTweet"]',
      '[data-testid="quote"]',
      '[aria-label*="Quoted"]',
      '[aria-label*="引用"]',
    ];

    for (const selector of selectors) {
      const marker = article.querySelector(selector);
      if (marker) return marker;
    }
    return null;
  }

  function extractQuoteMetadata(article) {
    const marker = getQuoteMarker(article);
    if (!marker) {
      return {
        isQuote: false,
        quoteContextText: null,
        quoteTweetUrl: null,
        quoteAuthorHandle: null,
      };
    }

    const links = typeof marker.querySelectorAll === "function"
      ? Array.from(marker.querySelectorAll('a[href*="/status/"]'))
      : [];
    let quoteTweetUrl = null;
    let quoteAuthorHandle = null;
    for (const link of links) {
      const parsed = extractQuoteTweetUrl(link.getAttribute?.("href"));
      if (!parsed) continue;
      quoteTweetUrl = parsed.url;
      quoteAuthorHandle = parsed.handle;
      break;
    }

    const textElement = marker.querySelector?.('[data-testid="tweetText"]');
    const quoteContextText = String(textElement?.innerText || "").trim().slice(0, 1000) || null;

    return {
      isQuote: true,
      quoteContextText,
      quoteTweetUrl,
      quoteAuthorHandle,
    };
  }

  function emptyQuoteMetadata() {
    return {
      isQuote: false,
      quoteContextText: null,
      quoteTweetUrl: null,
      quoteAuthorHandle: null,
    };
  }

  function extractReplyMetadata(article) {
    let quoteMetadata;
    try {
      quoteMetadata = extractQuoteMetadata(article);
    } catch {
      // Quote cards are optional; a changing X DOM must not stop the scan.
      quoteMetadata = emptyQuoteMetadata();
    }
    const marker = getReplyMarker(article);
    if (!marker) {
      return {
        isReply: false,
        replyToHandles: [],
        replyContextText: null,
        ...quoteMetadata,
      };
    }

    const handles = [];
    const links = typeof marker.querySelectorAll === "function"
      ? Array.from(marker.querySelectorAll("a[href]"))
      : [];
    for (const link of links) {
      const handle = extractHandleFromHref(link.getAttribute?.("href"));
      if (handle && !handles.includes(handle)) handles.push(handle);
      if (handles.length >= 20) break;
    }

    if (handles.length === 0) {
      const textHandles = String(marker.innerText || "").match(/@[A-Za-z0-9_]{1,15}/g) || [];
      for (const handle of textHandles) {
        if (!handles.includes(handle)) handles.push(handle);
        if (handles.length >= 20) break;
      }
    }

    let replyContextText = null;
    const nestedArticles = typeof article.querySelectorAll === "function"
      ? Array.from(article.querySelectorAll('article[data-testid="tweet"]'))
      : [];
    for (const nestedArticle of nestedArticles) {
      const textElement = nestedArticle.querySelector?.('[data-testid="tweetText"]');
      const text = String(textElement?.innerText || "").trim();
      if (text) {
        replyContextText = text.slice(0, 1000);
        break;
      }
    }

    return {
      isReply: true,
      replyToHandles: handles,
      replyContextText,
      ...quoteMetadata,
    };
  }

  global.TiboMonitorScan = {
    selectNewestParsedTweet,
    getTimelineSource,
    isTiboStatusUrl,
    shouldRestoreMonitoredTimeline,
    createTimelineRestoreGate,
    extractReplyMetadata,
    extractQuoteMetadata,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
