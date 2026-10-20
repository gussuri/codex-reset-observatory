import type { TiboEvidenceLookup, TiboEvidencePost } from "./tiboEvidenceContext";

export const TIBO_EVIDENCE_LOOKUP_TIMEOUT_MS = 1_500;

export const TIBO_EVIDENCE_SELECT_COLUMNS = [
  "tweet_id",
  "text",
  "tweet_url",
  "tweet_created_at",
  "verification_status",
  "is_reply",
  "reply_context_text",
  "is_quote",
  "quote_context_text",
  "quote_tweet_url",
  "quote_author_handle",
  "source_context_snapshot",
  "source_context_revision_hashes",
  "source_context_classified_revision_hashes",
].join(",");

export type TiboEvidenceStoreClient = {
  from(table: "tibo_signals"): any;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toEvidencePost(value: unknown): TiboEvidencePost {
  if (!isObject(value)) return value as TiboEvidencePost;
  const revisionHashes = Array.isArray(value.source_context_revision_hashes)
    ? value.source_context_revision_hashes.filter((item): item is string => typeof item === "string")
    : [];
  const classifiedRevisionHashes = Array.isArray(value.source_context_classified_revision_hashes)
    ? value.source_context_classified_revision_hashes.filter((item): item is string => typeof item === "string")
    : [];
  return {
    tweetId: value.tweet_id as string,
    tweetUrl: value.tweet_url as string,
    text: value.text as string,
    createdAt: value.tweet_created_at as string,
    verificationStatus: value.verification_status,
    isReply: value.is_reply,
    replyContextText: value.reply_context_text,
    isQuote: value.is_quote,
    quoteContextText: value.quote_context_text,
    quoteTweetUrl: value.quote_tweet_url,
    quoteAuthorHandle: value.quote_author_handle,
    sourceContextSnapshot: value.source_context_snapshot,
    sourceContextRevisionHashes: revisionHashes,
    sourceContextClassifiedRevisionHashes: classifiedRevisionHashes,
  };
}

export function createTiboEvidenceLookup(client: TiboEvidenceStoreClient): TiboEvidenceLookup {
  return async (tweetId) => {
    try {
      const result = await client
        .from("tibo_signals")
        .select(TIBO_EVIDENCE_SELECT_COLUMNS)
        .eq("tweet_id", tweetId)
        .limit(2)
        .retry(false)
        .abortSignal(AbortSignal.timeout(TIBO_EVIDENCE_LOOKUP_TIMEOUT_MS));

      if (result?.error || !Array.isArray(result?.data)) {
        throw new Error("lookup failed");
      }
      return result.data.map(toEvidencePost);
    } catch {
      throw new Error("Tibo evidence lookup failed");
    }
  };
}
