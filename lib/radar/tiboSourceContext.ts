import { createHash } from "node:crypto";

import { parseTiboReplyMetadata } from "./tiboReplyMetadata";

export const TIBO_SOURCE_CONTEXT_ENRICHMENT_KIND = "source_context_enrichment" as const;
export const MAX_TIBO_SOURCE_CONTEXT_REVISIONS = 3;

export type TiboSourceContextItem = {
  tweetId: string;
  tweetUrl: string;
  authorHandle: string;
  text: string;
};

export type TiboSourceContextSnapshot = {
  parent?: TiboSourceContextItem;
  quote?: TiboSourceContextItem;
};

export type TiboSourceContextEnrichment = {
  kind: typeof TIBO_SOURCE_CONTEXT_ENRICHMENT_KIND;
  tweetId: string;
  text: string;
  tweetUrl: string;
  tweetCreatedAt: string;
  snapshot: TiboSourceContextSnapshot;
  revisionHash: string;
};

export type TiboSourceContextParseResult =
  | { ok: true; value: TiboSourceContextEnrichment }
  | { ok: false; errorCode: "invalid_source_context_enrichment" };

const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/;
const SOURCE_CONTEXT_LIMIT = 1000;

function parseStatusUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(x|twitter)\.com$/i.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(STATUS_PATH);
    if (!match) return null;
    const authorHandle = match[1].toLowerCase();
    return {
      tweetId: match[2],
      authorHandle: `@${authorHandle}`,
      tweetUrl: `https://x.com/${authorHandle}/status/${match[2]}`,
    };
  } catch {
    return null;
  }
}

function normalizeContextText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= SOURCE_CONTEXT_LIMIT ? text : null;
}

function sha256(snapshot: TiboSourceContextSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}

export function parseTiboSourceContextEnrichment(
  body: Record<string, unknown>,
): TiboSourceContextParseResult {
  if (body.kind !== TIBO_SOURCE_CONTEXT_ENRICHMENT_KIND
    || typeof body.tweetId !== "string" || !/^\d{15,25}$/.test(body.tweetId)
    || typeof body.text !== "string" || !body.text.trim() || body.text.length > 25_000
    || typeof body.tweetCreatedAt !== "string" || !Number.isFinite(new Date(body.tweetCreatedAt).getTime())) {
    return { ok: false, errorCode: "invalid_source_context_enrichment" };
  }

  const root = parseStatusUrl(body.tweetUrl);
  if (!root || root.authorHandle.toLowerCase() !== "@thsottiaux"
    || root.tweetId !== body.tweetId) {
    return { ok: false, errorCode: "invalid_source_context_enrichment" };
  }

  const reply = parseTiboReplyMetadata(body);
  if (!reply.ok) return { ok: false, errorCode: "invalid_source_context_enrichment" };
  const snapshot: TiboSourceContextSnapshot = {};

  if (reply.value.replyParentTweetId && reply.value.replyParentTweetUrl
    && reply.value.isReply === true && reply.value.replyToHandles?.length) {
    const parent = parseStatusUrl(reply.value.replyParentTweetUrl);
    const text = normalizeContextText(reply.value.replyContextText);
    if (!parent || parent.tweetId !== reply.value.replyParentTweetId
      || !reply.value.replyToHandles.some((handle) => `@${handle.replace(/^@/, "")}`.toLowerCase() === parent.authorHandle)
      || !text) {
      return { ok: false, errorCode: "invalid_source_context_enrichment" };
    }
    snapshot.parent = {
      tweetId: parent.tweetId,
      tweetUrl: parent.tweetUrl,
      authorHandle: parent.authorHandle,
      text,
    };
  }

  if (reply.value.quoteTweetUrl && reply.value.quoteAuthorHandle) {
    const quote = parseStatusUrl(body.quoteTweetUrl);
    const text = normalizeContextText(reply.value.quoteContextText);
    if (!quote
      || quote.authorHandle.toLowerCase() !== (`@${reply.value.quoteAuthorHandle.replace(/^@/, "")}`).toLowerCase()
      || !text) {
      return { ok: false, errorCode: "invalid_source_context_enrichment" };
    }
    snapshot.quote = {
      tweetId: quote.tweetId,
      tweetUrl: quote.tweetUrl,
      authorHandle: quote.authorHandle,
      text,
    };
  }

  if (!snapshot.parent && !snapshot.quote) {
    return { ok: false, errorCode: "invalid_source_context_enrichment" };
  }

  return {
    ok: true,
    value: {
      kind: TIBO_SOURCE_CONTEXT_ENRICHMENT_KIND,
      tweetId: body.tweetId,
      text: body.text.trim(),
      tweetUrl: root.tweetUrl,
      tweetCreatedAt: new Date(body.tweetCreatedAt).toISOString(),
      snapshot,
      // Never read a caller supplied hash. The server owns the revision identity.
      revisionHash: sha256(snapshot),
    },
  };
}

export type TiboSourceContextStoreResult =
  | { status: "applied" | "duplicate" }
  | { status: "conflict" | "revision_limit" | "root_missing" | "root_mismatch" };

type SourceContextRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
};

export async function storeTiboSourceContextEnrichment(
  client: SourceContextRpcClient,
  enrichment: TiboSourceContextEnrichment,
): Promise<TiboSourceContextStoreResult> {
  const { data, error } = await client.rpc("merge_tibo_source_context_enrichment", {
    p_tweet_id: enrichment.tweetId,
    p_tweet_url: enrichment.tweetUrl,
    p_tweet_created_at: enrichment.tweetCreatedAt,
    p_text: enrichment.text,
    p_snapshot: enrichment.snapshot,
    p_revision_hash: enrichment.revisionHash,
  });
  if (error) throw new Error("source_context_store_unavailable");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("source_context_store_invalid_response");
  }
  const status = (data as Record<string, unknown>).status;
  if (status === "applied" || status === "duplicate" || status === "conflict"
    || status === "revision_limit" || status === "root_missing" || status === "root_mismatch") {
    return { status };
  }
  throw new Error("source_context_store_invalid_response");
}\n