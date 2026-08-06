export type TiboSourceTimeline = "profile" | "with_replies";

export type TiboReplyMetadata = {
  isReply?: boolean;
  replyToHandles?: string[];
  replyContextText?: string | null;
  sourceTimeline?: TiboSourceTimeline;
};

export type TiboReplyMetadataParseResult =
  | { ok: true; value: TiboReplyMetadata }
  | { ok: false; errorCode: "invalid_reply_metadata" };

const HANDLE_PATTERN = /^@?[A-Za-z0-9_]{1,15}$/;
const MAX_HANDLES = 20;
const MAX_CONTEXT_CHARS = 1000;

function normalizeHandle(value: string) {
  const trimmed = value.trim();
  return `@${trimmed.replace(/^@/, "")}`;
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

  return { ok: true, value };
}
