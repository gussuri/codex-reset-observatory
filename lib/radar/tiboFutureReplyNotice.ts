import { hasDeadlineSemantics, TIBO_TEMPORAL_DEADLINE_ESTIMATE_VERSION } from "./tiboTemporal";
import { isTiboHandle } from "./tiboHandle";

const MAX_SOURCE_CONTEXT_SNAPSHOT_BYTES = 8 * 1024;
const MAX_SOURCE_CONTEXT_REVISIONS = 3;
const DEADLINE_WINDOW_MS = 3 * 60 * 60 * 1000;
const TWEET_ID_PATTERN = /^\d{15,30}$/;
const REVISION_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RESET_TOPIC_PATTERN = /\b(?:reset|usage\s+limits?|rate\s+limits?|quota)\b/i;

export type TiboFutureReplyNoticeLike = {
  tweet_id?: string | null;
  tweet_url?: string | null;
  tweet_created_at?: string | null;
  text?: string | null;
  signal_type?: string | null;
  confidence?: number | null;
  verification_status?: string | null;
  classification_source?: string | null;
  ai_confidence?: number | null;
  ai_signal_type?: string | null;
  ai_classification_status?: string | null;
  ai_temporal_direction?: string | null;
  ai_notice_timing_status?: string | null;
  ai_evidence_quote?: string | null;
  ai_temporal_expression?: string | null;
  ai_contextual_reset_assessment?: string | null;
  ai_contextual_reset_tweet_id?: string | null;
  is_reply?: boolean | null;
  is_quote?: boolean | null;
  quote_context_text?: string | null;
  quote_tweet_url?: string | null;
  quote_author_handle?: string | null;
  reply_to_handles?: string[] | null;
  reply_context_text?: string | null;
  source_context_snapshot?: unknown;
  source_context_revision_hashes?: string[] | null;
  source_context_classified_revision_hashes?: string[] | null;
  source_context_generation?: number | null;
  temporal_expression?: string | null;
  temporal_precision?: string | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
  temporal_resolution_status?: string | null;
  temporal_resolution_version?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getCanonicalTiboStatus(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase()) ||
        url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/thsottiaux\/status\/(\d+)\/?$/i);
    if (!match || !TWEET_ID_PATTERN.test(match[1]!)) return null;
    return { tweetId: match[1]!, handle: "@thsottiaux" };
  } catch {
    return null;
  }
}

function isCurrentRevisionSet(signal: TiboFutureReplyNoticeLike) {
  const revisions = signal.source_context_revision_hashes;
  const classified = signal.source_context_classified_revision_hashes;
  return Array.isArray(revisions) && revisions.length > 0 && revisions.length <= MAX_SOURCE_CONTEXT_REVISIONS &&
    revisions.every((hash) => typeof hash === "string" && REVISION_HASH_PATTERN.test(hash)) &&
    new Set(revisions).size === revisions.length &&
    Array.isArray(classified) && classified.length === revisions.length &&
    classified.every((hash, index) => hash === revisions[index]);
}

/**
 * Validates only the future self-reply notice path. This is display/history
 * admission, not proof that a reply completed a reset or may enter reset history.
 */
export function isVerifiedTiboFutureReplyNotice(signal: TiboFutureReplyNoticeLike) {
  if (
    signal.signal_type !== "official_notice" ||
    signal.verification_status !== "auto_unverified" ||
    signal.classification_source !== "gemini" ||
    signal.ai_signal_type !== "official_notice" ||
    signal.ai_classification_status !== "success" ||
    signal.ai_temporal_direction !== "future" ||
    signal.ai_notice_timing_status !== "known" ||
    signal.ai_contextual_reset_assessment !== "same_global_reset" ||
    signal.is_reply !== true ||
    signal.is_quote !== false ||
    typeof signal.tweet_id !== "string" || !TWEET_ID_PATTERN.test(signal.tweet_id) ||
    typeof signal.text !== "string" || !signal.text.trim() ||
    typeof signal.tweet_created_at !== "string" || !Number.isFinite(Date.parse(signal.tweet_created_at)) ||
    typeof signal.confidence !== "number" || !Number.isFinite(signal.confidence) || signal.confidence < 0.95 ||
    typeof signal.ai_confidence !== "number" || !Number.isFinite(signal.ai_confidence) || signal.ai_confidence < 0.95 ||
    typeof signal.ai_evidence_quote !== "string" || !signal.ai_evidence_quote.trim() ||
    !signal.text.includes(signal.ai_evidence_quote) ||
    typeof signal.ai_contextual_reset_tweet_id !== "string" ||
    !TWEET_ID_PATTERN.test(signal.ai_contextual_reset_tweet_id) ||
    !Array.isArray(signal.reply_to_handles) || !signal.reply_to_handles.some(isTiboHandle) ||
    typeof signal.reply_context_text !== "string" || !signal.reply_context_text.trim() ||
    signal.reply_context_text.length > 1_000 ||
    (signal.quote_context_text?.trim() ?? "") ||
    (signal.quote_tweet_url?.trim() ?? "") ||
    (signal.quote_author_handle?.trim() ?? "") ||
    !isCurrentRevisionSet(signal) ||
    !Number.isSafeInteger(signal.source_context_generation) ||
    (signal.source_context_generation ?? 0) <= 0 ||
    signal.temporal_resolution_status !== "resolved" ||
    signal.temporal_resolution_version !== TIBO_TEMPORAL_DEADLINE_ESTIMATE_VERSION ||
    typeof signal.temporal_expression !== "string" ||
    typeof signal.expected_start_at !== "string" ||
    typeof signal.expected_end_at !== "string"
  ) {
    return false;
  }

  const target = getCanonicalTiboStatus(signal.tweet_url);
  if (!target || target.tweetId !== signal.tweet_id) return false;

  const snapshot = signal.source_context_snapshot;
  if (!isRecord(snapshot)) return false;
  let serializedSnapshot: string;
  try {
    serializedSnapshot = JSON.stringify(snapshot);
  } catch {
    return false;
  }
  if (serializedSnapshot === undefined) return false;
  if (new TextEncoder().encode(serializedSnapshot).length > MAX_SOURCE_CONTEXT_SNAPSHOT_BYTES) return false;
  if (Object.keys(snapshot).length !== 1 || !Object.prototype.hasOwnProperty.call(snapshot, "parent")) return false;

  const parent = snapshot.parent;
  if (!isRecord(parent) || Object.keys(parent).length !== 4 ||
      !["tweetId", "tweetUrl", "authorHandle", "text"].every((key) => Object.prototype.hasOwnProperty.call(parent, key))) {
    return false;
  }
  const parentStatus = getCanonicalTiboStatus(parent.tweetUrl);
  if (
    typeof parent.tweetId !== "string" || !TWEET_ID_PATTERN.test(parent.tweetId) ||
    parentStatus?.tweetId !== parent.tweetId ||
    !parentStatus || typeof parent.authorHandle !== "string" || !isTiboHandle(parent.authorHandle) ||
    typeof parent.text !== "string" || !parent.text.trim() || parent.text.length > 1_000 ||
    parent.text !== signal.reply_context_text ||
    !RESET_TOPIC_PATTERN.test(parent.text) ||
    parent.tweetId === signal.tweet_id ||
    signal.ai_contextual_reset_tweet_id !== parent.tweetId
  ) {
    return false;
  }

  const createdAt = Date.parse(signal.tweet_created_at);
  const startAt = Date.parse(signal.expected_start_at);
  const endAt = Date.parse(signal.expected_end_at);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) ||
      startAt < createdAt || endAt <= createdAt || endAt - startAt !== DEADLINE_WINDOW_MS ||
      !hasDeadlineSemantics({
        temporalExpression: signal.temporal_expression || signal.ai_temporal_expression,
        expectedStartAt: signal.expected_start_at,
        expectedEndAt: signal.expected_end_at,
      }, signal.text)) {
    return false;
  }

  return true;
}
