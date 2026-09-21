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

  function getDocumentTypeDeclaration(documentRef) {
    const doctype = documentRef?.doctype;
    if (!doctype) return "";

    const name = String(doctype.name || "html");
    if (doctype.publicId) {
      const systemId = doctype.systemId ? ` "${doctype.systemId}"` : "";
      return `<!DOCTYPE ${name} PUBLIC "${doctype.publicId}"${systemId}>`;
    }
    if (doctype.systemId) {
      return `<!DOCTYPE ${name} SYSTEM "${doctype.systemId}">`;
    }
    return `<!DOCTYPE ${name}>`;
  }

  function captureRawDomToDownload(
    documentRef,
    urlApi,
    BlobConstructor,
    nowValue,
    scheduleRevoke,
  ) {
    const documentObject = documentRef || global.document;
    const objectUrlApi = urlApi || global.URL;
    const BlobClass = BlobConstructor || global.Blob;
    const documentElement = documentObject?.documentElement;

    if (!documentElement || typeof documentElement.outerHTML !== "string") {
      throw new Error("dom_unavailable");
    }
    if (
      !objectUrlApi
      || typeof objectUrlApi.createObjectURL !== "function"
      || typeof objectUrlApi.revokeObjectURL !== "function"
    ) {
      throw new Error("download_api_unavailable");
    }
    if (typeof BlobClass !== "function") {
      throw new Error("blob_api_unavailable");
    }

    const doctype = getDocumentTypeDeclaration(documentObject);
    const html = `${doctype ? `${doctype}\n` : ""}${documentElement.outerHTML}`;
    const date = nowValue == null ? new Date() : new Date(nowValue);
    if (Number.isNaN(date.getTime())) throw new Error("invalid_capture_time");

    const filename = `tibo-with-replies-dom-${date.toISOString().replace(/[:.]/g, "-")}.html`;
    const blob = new BlobClass([html], { type: "text/html;charset=utf-8" });
    const objectUrl = objectUrlApi.createObjectURL(blob);
    const link = documentObject.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";

    try {
      const parent = documentObject.body || documentElement;
      parent.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      objectUrlApi.revokeObjectURL(objectUrl);
      throw error;
    }

    const revoke = () => objectUrlApi.revokeObjectURL(objectUrl);
    if (typeof scheduleRevoke === "function") {
      scheduleRevoke(revoke, 1000);
    } else if (typeof global.setTimeout === "function") {
      global.setTimeout(revoke, 1000);
    }

    return {
      filename,
      characterCount: html.length,
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

  function getElementChildren(element) {
    return element?.children ? Array.from(element.children) : [];
  }

  function hasStableTweetContent(element) {
    if (!element || typeof element.querySelector !== "function") return false;
    return Boolean(
      element.querySelector('[data-testid="User-Name"]')
      || element.querySelector('[data-testid="tweetText"]')
      || element.querySelector("time")
      || element.querySelector('a[href*="/status/"]'),
    );
  }

  function isEmptyThreadStructure(element) {
    if (!element) return false;
    if (String(element.innerText || "").trim()) return false;
    if (typeof element.querySelector !== "function") return false;
    return !(
      element.querySelector('[data-testid="User-Name"]')
      || element.querySelector('[data-testid="tweetText"]')
      || element.querySelector('[data-testid="Tweet-User-Avatar"]')
      || element.querySelector("time")
      || element.querySelector("a")
      || element.querySelector("button")
      || element.querySelector("img")
      || element.querySelector("svg")
    );
  }

  // X has no stable connector test id; use the stable avatar/content rows around it instead.
  function findAvatarLayout(article) {
    if (!article || typeof article.querySelector !== "function") return null;
    const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
    if (!avatar) return null;

    let current = avatar;
    while (current && current.parentElement && current.parentElement !== article) {
      const parent = current.parentElement;
      const children = getElementChildren(parent);
      const avatarColumn = children.find((child) => (
        child === current
        || (typeof child.contains === "function" && child.contains(avatar))
      ));
      const contentColumn = children.find((child) => (
        child !== avatarColumn && hasStableTweetContent(child)
      ));

      if (avatarColumn && contentColumn) {
        return { bodyRow: parent, avatarColumn };
      }
      current = parent;
    }
    return null;
  }

  function hasIncomingThreadConnector(article) {
    const layout = findAvatarLayout(article);
    if (!layout) return false;
    const parent = layout.bodyRow?.parentElement;
    const rows = getElementChildren(parent);
    if (rows.length < 2 || rows.indexOf(layout.bodyRow) !== 1) return false;
    const precedingRow = rows[0];
    const candidates = [precedingRow, ...getElementChildren(precedingRow)];
    return candidates.some((candidate) => {
      const connectorChildren = getElementChildren(candidate);
      return connectorChildren.length >= 2 && connectorChildren.every(isEmptyThreadStructure);
    });
  }

  function hasOutgoingThreadConnector(article) {
    const layout = findAvatarLayout(article);
    if (!layout) return false;
    const avatarChildren = getElementChildren(layout.avatarColumn);
    return avatarChildren.length >= 2 && avatarChildren.slice(1).some(isEmptyThreadStructure);
  }

  const READ_MORE_LABEL_PATTERN = /^(?:show more|続きを読む|もっと見る|展开全文|显示更多)$/i;

  function getOwnedElements(article, selector) {
    if (!article || typeof article.querySelectorAll !== "function") return [];
    return Array.from(article.querySelectorAll(selector)).filter((element) => {
      const owner = element.closest?.('article[data-testid="tweet"]');
      return !owner || owner === article;
    });
  }

  function isTweetTextExpandControl(element) {
    if (!element) return false;

    const testId = String(element.getAttribute?.("data-testid") || "");
    if (/tweet.*text.*show.*more|show.*more.*tweet.*text/i.test(testId)) return true;

    const role = String(element.getAttribute?.("role") || "").toLowerCase();
    const tagName = String(element.tagName || "").toUpperCase();
    if (role !== "button" && tagName !== "BUTTON") return false;

    // Generic localized labels are ambiguous on X. Only treat them as text
    // expansion controls when they are inside the tweet text itself.
    if (!element.closest?.('[data-testid="tweetText"]')) return false;

    return [
      element.getAttribute?.("aria-label"),
      element.innerText,
      element.textContent,
    ].some((value) => READ_MORE_LABEL_PATTERN.test(String(value || "").trim().replace(/\s+/g, " ")));
  }

  function findTweetTextExpandControl(article) {
    const controls = getOwnedElements(
      article,
      '[data-testid="tweet-text-show-more"], [role="button"], button',
    );
    return controls.find(isTweetTextExpandControl) || null;
  }

  function getTweetTextState(article) {
    let textElement = getOwnedElements(article, '[data-testid="tweetText"]')[0] || null;
    if (!textElement && typeof article?.querySelector === "function") {
      const candidate = article.querySelector('[data-testid="tweetText"]');
      const owner = candidate?.closest?.('article[data-testid="tweet"]');
      if (!owner || owner === article) textElement = candidate;
    }
    const text = String(textElement?.innerText || "");
    const expandControl = findTweetTextExpandControl(article);

    return {
      text,
      needsExpansion: Boolean(expandControl),
      expandControl,
    };
  }

  function getTweetId(article) {
    if (!article || typeof article.querySelectorAll !== "function") return null;
    const links = Array.from(article.querySelectorAll('a[href*="/status/"]'));
    for (const link of links) {
      const owner = link.closest?.('article[data-testid="tweet"]');
      if (owner && owner !== article) continue;
      const href = String(link.getAttribute?.("href") || "");
      const match = href.match(/\/status\/(\d+)(?:[/?#]|$)/i);
      if (match) return match[1];
    }
    return null;
  }

  function getOwnTweetTextState(article) {
    const state = getTweetTextState(article);
    const text = state.text.trim();
    if (state.needsExpansion) {
      return {
        state: "needs_expansion",
        text: null,
        expandControl: state.expandControl,
      };
    }
    if (!text) {
      return {
        state: "incomplete",
        text: null,
        expandControl: null,
      };
    }
    return {
      state: "ready",
      text: text.slice(0, 1000),
      expandControl: null,
    };
  }

  function getOwnTweetText(article) {
    return getOwnTweetTextState(article).text;
  }

  function getReplyParentContext(parentArticle) {
    const parentText = getOwnTweetTextState(parentArticle);
    const parentTweetId = getTweetId(parentArticle);

    if (parentText.state === "ready") {
      return {
        ready: true,
        text: parentText.text,
      };
    }

    return {
      ready: false,
      needsRetry: true,
      needsExpansion: parentText.state === "needs_expansion",
      replyContextExpandControl: parentText.expandControl,
      replyContextExpansionKey: parentTweetId || "unknown",
      replyContextState: parentText.state,
    };
  }

  function getParentHandle(article) {
    if (!article || typeof article.querySelectorAll !== "function") return null;
    const statusLinks = Array.from(article.querySelectorAll('a[href*="/status/"]'));
    for (const link of statusLinks) {
      const owner = link.closest?.('article[data-testid="tweet"]');
      if (owner && owner !== article) continue;
      const parsed = extractQuoteTweetUrl(link.getAttribute?.("href"));
      if (parsed?.handle) return parsed.handle;
    }

    const userNames = article.querySelectorAll('[data-testid="User-Name"]');
    for (const userName of Array.from(userNames)) {
      const owner = userName.closest?.('article[data-testid="tweet"]');
      if (owner && owner !== article) continue;
      const profileLinks = userName.querySelectorAll?.("a[href]") || [];
      for (const link of Array.from(profileLinks)) {
        const handle = extractHandleFromHref(link.getAttribute?.("href"));
        if (handle) return handle;
      }
    }
    return null;
  }

  function resolveSiblingReplyMetadata(article) {
    if (!hasIncomingThreadConnector(article)) return null;

    const cell = article.closest?.('[data-testid="cellInnerDiv"]');
    const previousCell = cell?.previousElementSibling;
    if (!previousCell || previousCell.getAttribute?.("data-testid") !== "cellInnerDiv") {
      return { needsRetry: true };
    }

    const parentArticle = previousCell.querySelector?.('article[data-testid="tweet"]');
    if (!parentArticle) return { needsRetry: true };
    if (!hasOutgoingThreadConnector(parentArticle)) return { needsRetry: true };

    const parentContext = getReplyParentContext(parentArticle);
    if (!parentContext.ready) {
      return {
        isReply: true,
        replyToHandles: [getParentHandle(parentArticle)].filter(Boolean),
        replyContextText: null,
        needsRetry: parentContext.needsRetry,
        needsExpansion: parentContext.needsExpansion,
        replyContextExpandControl: parentContext.replyContextExpandControl,
        replyContextExpansionKey: parentContext.replyContextExpansionKey,
        replyContextState: parentContext.replyContextState,
      };
    }

    return {
      isReply: true,
      replyToHandles: [getParentHandle(parentArticle)].filter(Boolean),
      replyContextText: parentContext.text,
    };
  }

  function extractReplyMetadata(article, options = {}) {
    let quoteMetadata;
    try {
      quoteMetadata = extractQuoteMetadata(article);
    } catch {
      // Quote cards are optional; a changing X DOM must not stop the scan.
      quoteMetadata = emptyQuoteMetadata();
    }
    const marker = getReplyMarker(article);
    if (!marker) {
      const sourceTimeline = typeof options === "string" ? options : options?.sourceTimeline;
      if (sourceTimeline === "with_replies") {
        const siblingMetadata = resolveSiblingReplyMetadata(article);
        if (siblingMetadata?.needsRetry) {
          return {
            isReply: siblingMetadata.isReply === true,
            replyToHandles: Array.isArray(siblingMetadata.replyToHandles)
              ? siblingMetadata.replyToHandles
              : [],
            replyContextText: null,
            needsRetry: true,
            ...(siblingMetadata.isReply
              ? {
                  needsExpansion: siblingMetadata.needsExpansion === true,
                  replyContextExpandControl: siblingMetadata.replyContextExpandControl,
                  replyContextExpansionKey: siblingMetadata.replyContextExpansionKey,
                  replyContextState: siblingMetadata.replyContextState,
                }
              : {}),
            ...quoteMetadata,
          };
        }
        if (siblingMetadata?.isReply) {
          return {
            ...siblingMetadata,
            ...quoteMetadata,
          };
        }
      }
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
    let pendingParentContext = null;
    const nestedArticles = typeof article.querySelectorAll === "function"
      ? Array.from(article.querySelectorAll('article[data-testid="tweet"]'))
      : [];
    for (const nestedArticle of nestedArticles) {
      const parentContext = getReplyParentContext(nestedArticle);
      if (parentContext.ready) {
        replyContextText = parentContext.text;
        break;
      }
      if (parentContext.needsExpansion) pendingParentContext = parentContext;
      else if (!pendingParentContext && parentContext.needsRetry) pendingParentContext = parentContext;
    }

    if (replyContextText === null && pendingParentContext) {
      return {
        isReply: true,
        replyToHandles: handles,
        replyContextText: null,
        needsRetry: true,
        needsExpansion: pendingParentContext.needsExpansion,
        replyContextExpandControl: pendingParentContext.replyContextExpandControl,
        replyContextExpansionKey: pendingParentContext.replyContextExpansionKey,
        replyContextState: pendingParentContext.replyContextState,
        ...quoteMetadata,
      };
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
    getDocumentTypeDeclaration,
    captureRawDomToDownload,
    getTweetTextState,
    extractReplyMetadata,
    extractQuoteMetadata,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
