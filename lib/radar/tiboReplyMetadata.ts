export type TiboSourceTimeline = "profile" | "with_replies";

export type TiboReplyMetadata = {
  isReply?: boolean;
  replyToHandles?: string[];
  replyContextText?: string | null;
  replyParentTweetId?: string | null;
  replyParentTweetUrl?: string | null;
  sourceTimeline?: TiboSourceTimeline;
  isQuote?: boolean;
  quoteContextText?: string | null;
  quoteTweetUrl?: string | null;
  quoteAuthorHandle?: string | null;
};

export type TiboReplyMetadataParseResult =
  | { ok: true; value: TiboReplyMetadata }
  | { ok: false; errorCode: "invalid_reply_metadata" };

const HANDLE_PATTERN = /^@?[A-Za-z0-9_]{1,15}$/;
const QUOTE_TWEET_PATH_PATTERN = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/;
const MAX_HANDLES = 20;
const MAX_CONTEXT_CHARS = 1000;

function normalizeHandle(value: string) {
  const trimmed = value.trim();
  return `@${trimmed.replace(/^@/, "")}`;
}

function normalizeQuoteTweetUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(x|twitter)\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(QUOTE_TWEET_PATH_PATTERN);
    if (!match) return null;
    return `https://${url.hostname.toLowerCase()}/${match[1]}/status/${match[2]}`;
  } catch {
    return null;
  }
}

function normalizeReplyParentUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(x|twitter)\.com$/i.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(QUOTE_TWEET_PATH_PATTERN);
    return match ? { url: `https://${url.hostname.toLowerCase()}/${match[1]}/status/${match[2]}`, id: match[2], handle: `@${match[1]}` } : null;
  } catch { return null; }
}

export function parseTiboReplyMetadata(
  body: Record<string, unknown>,
): TiboReplyMetadataParseResult {
  const value: TiboReplyMetadata = {};

  if (Object.prototype.hasOwnProperty.call(body, "isReply")) {
    if (typeof body.isReply !== "boolean") {
      return { ok: false, errorCode: "invalid_reply_metadata" };
    }
    value.isReply = body.isReply;
  }

  if (Object.prototype.hasOwnProperty.call(body, "replyToHandles")) {
    if (!Array.isArray(body.replyToHandles) || body.replyToHandles.length > MAX_HANDLES) {
      return { ok: false, errorCode: "invalid_reply_metadata" };
    }

    const handles: string[] = [];
    for (const handle of body.replyToHandles) {
      if (typeof handle !== "string" || !HANDLE_PATTERN.test(handle.trim())) {
        return { ok: false, errorCode: "invalid_reply_metadata" };
      }
      const normalized = normalizeHandle(handle);
      if (!handles.includes(normalized)) handles.push(normalized);
    }
    value.replyToHandles = handles;
  }

  if (Object.prototype.hasOwnProperty.call(body, "replyContextText")) {
    if (body.replyContextText !== null && typeof body.replyContextText !== "string") {
      return { ok: false, errorCode: "invalid_reply_metadata" };
    }
    if (typeof body.replyContextText === "string") {
      const context = body.replyContextText.trim();
      if (context.length > MAX_CONTEXT_CHARS) {
        return { ok: false, errorCode: "invalid_reply_metadata" };
      }
      value.replyContextText = context || null;
    } else {
      value.replyContextText = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "sourceTimeline")) {
    if (body.sourceTimeline !== "profile" && body.sourceTimeline !== "with_replies") {
      return { ok: false, errorCode: "invalid_reply_metadata" };
    }
    value.sourceTimeline = body.sourceTimeline;
  }

  if (Object.prototype.hasOwnProperty.call(body, "isQuote")) {
    if (typeof body.isQuote !== "boolean") {
      return { ok: false, errorCode: "invalid_reply_metadata" };
    }
    value.isQuote = body.isQuote;
  }

  if (Object.prototype.hasOwnProperty.call(body, "quoteContextText")) {
    if (body.quoteContextText !== null && typeof body.quoteContextText !== "string") {
      return { ok: false, errorCode: "invalid_reply_metadata" };
    }
    if (typeof body.quoteContextText === "string") {
      const context = body.quoteContextText.trim();
      if (context.length > MAX_CONTEXT_CHARS) {
        return { ok: false, errorCode: "invalid_reply_metadata" };
      }
      value.quoteContextText = context || null;
      if (context) value.isQuote = true;
    } else {
      value.quoteContextText = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "quoteTweetUrl")) {
    if (body.quoteTweetUrl !== null && typeof body.quoteTweetUrl !== "string") {
      return { ok: false, errorCode: "invalid_reply_metadata" };
    }
    if (typeof body.quoteTweetUrl === "string") {
      const normalizedUrl = normalizeQuoteTweetUrl(body.quoteTweetUrl.trim());
      if (!normalizedUrl) {
        return { ok: false, errorCode: "invalid_reply_metadata" };
      }
      value.quoteTweetUrl = normalizedUrl;
      value.isQuote = true;
    } else {
      value.quoteTweetUrl = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "quoteAuthorHandle")) {
    if (body.quoteAuthorHandle !== null && typeof body.quoteAuthorHandle !== "string") {
      return { ok: false, errorCode: "invalid_reply_metadata" };
    }
    if (typeof body.quoteAuthorHandle === "string") {
      const handle = body.quoteAuthorHandle.trim();
      if (!HANDLE_PATTERN.test(handle)) {
        return { ok: false, errorCode: "invalid_reply_metadata" };
      }
      value.quoteAuthorHandle = normalizeHandle(handle);
      value.isQuote = true;
    } else {
      value.quoteAuthorHandle = null;
    }
  }

  // Parent provenance is a relationship among the fully parsed fields.
  const hasParentId = Object.prototype.hasOwnProperty.call(body, "replyParentTweetId");
  const hasParentUrl = Object.prototype.hasOwnProperty.call(body, "replyParentTweetUrl");
  const parentId = body.replyParentTweetId;
  const parentUrl = body.replyParentTweetUrl;
  if ((hasParentId !== hasParentUrl)
    || (hasParentId && ((parentId !== null && (typeof parentId !== "string" || !/^\d{1,30}$/.test(parentId)))
      || (parentUrl !== null && typeof parentUrl !== "string")))) {
    return { ok: false, errorCode: "invalid_reply_metadata" };
  }
  if (hasParentId && parentId !== null && parentUrl !== null) {
    const normalized = normalizeReplyParentUrl(parentUrl as string);
    if (!normalized || normalized.id !== parentId
      || (typeof body.tweetId === "string" && body.tweetId === parentId)
      || value.isReply !== true
      || !value.replyToHandles?.some((handle) => handle.toLowerCase() === normalized.handle.toLowerCase())) {
      return { ok: false, errorCode: "invalid_reply_metadata" };
    }
    value.replyParentTweetId = parentId as string;
    value.replyParentTweetUrl = normalized.url;
  } else if (hasParentId) {
    if (parentId !== null || parentUrl !== null) return { ok: false, errorCode: "invalid_reply_metadata" };
    value.replyParentTweetId = null;
    value.replyParentTweetUrl = null;
  }

  return { ok: true, value };
}
