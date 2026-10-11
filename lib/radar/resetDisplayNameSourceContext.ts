import {
  isBankedDistributionCompletionSignal,
  isBankedDistributionNotice,
} from "./bankedReset";

export type ResetDisplayNameSourceRow = {
  tweet_id: string;
  text: string;
  tweet_created_at?: string | null;
  expires_at?: string | null;
  signal_type?: string | null;
  is_reply?: boolean | null;
  verification_status?: string | null;
};

export type ResetDisplayNameSourceContextInput = {
  effectiveFormalCandidate: ResetDisplayNameSourceRow;
  sourceTweetIds: readonly string[];
  sourceRows?: readonly ResetDisplayNameSourceRow[];
  eventKind?: "forced_reset" | "banked_distribution" | "unknown";
};

export const MAX_RESET_DISPLAY_NAME_SOURCE_CONTEXT_LENGTH = 25_000;

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareRows(left: ResetDisplayNameSourceRow, right: ResetDisplayNameSourceRow) {
  const leftTimestamp = parseTimestamp(left.tweet_created_at);
  const rightTimestamp = parseTimestamp(right.tweet_created_at);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  if (leftTimestamp !== null && rightTimestamp === null) return -1;
  if (leftTimestamp === null && rightTimestamp !== null) return 1;
  return left.tweet_id.localeCompare(right.tweet_id);
}

function isUsableSourceRow(row: ResetDisplayNameSourceRow) {
  return row.is_reply !== true &&
    row.verification_status !== "rejected" &&
    row.tweet_id.trim().length > 0 &&
    row.text.trim().length > 0;
}

function matchesEventKind(row: ResetDisplayNameSourceRow, eventKind: ResetDisplayNameSourceContextInput["eventKind"]) {
  const isBankedNotice = isBankedDistributionNotice(row.text);
  const isBankedCompletion = isBankedDistributionCompletionSignal(row.text);
  if (eventKind === "forced_reset") {
    return !isBankedNotice && !isBankedCompletion;
  }
  if (eventKind === "banked_distribution") {
    if (row.signal_type === "official_notice") return isBankedNotice;
    if (row.signal_type === "reset_executed") return isBankedCompletion;
    return true;
  }
  return true;
}

function roleForRow(row: ResetDisplayNameSourceRow, effectiveCandidateId: string) {
  if (row.signal_type === "official_notice") return "official_notice";
  if (row.signal_type === "reset_executed" || row.tweet_id === effectiveCandidateId) return "completion";
  return "canonical_event_post";
}

/**
 * Builds the naming source from explicit event provenance only. Nearby posts
 * are deliberately invisible to this helper unless their IDs were persisted
 * as part of the canonical event evidence.
 */
export function buildResetDisplayNameSourceContext({
  effectiveFormalCandidate,
  sourceTweetIds,
  sourceRows = [],
  eventKind = "unknown",
}: ResetDisplayNameSourceContextInput) {
  const canonicalIds = new Set(
    sourceTweetIds
      .map((tweetId) => tweetId.trim())
      .filter(Boolean),
  );
  if (canonicalIds.size === 0) return null;

  const rowsByTweetId = new Map<string, ResetDisplayNameSourceRow>();
  for (const row of sourceRows) {
    const tweetId = row.tweet_id.trim();
    if (!canonicalIds.has(tweetId) || !isUsableSourceRow(row) || !matchesEventKind(row, eventKind)) continue;
    if (!rowsByTweetId.has(tweetId)) rowsByTweetId.set(tweetId, { ...row, tweet_id: tweetId });
  }

  const candidateId = effectiveFormalCandidate.tweet_id.trim();
  if (
    canonicalIds.has(candidateId) &&
    isUsableSourceRow(effectiveFormalCandidate) &&
    matchesEventKind(effectiveFormalCandidate, eventKind)
  ) {
    rowsByTweetId.set(candidateId, { ...effectiveFormalCandidate, tweet_id: candidateId });
  }

  const rows = Array.from(rowsByTweetId.values()).sort(compareRows);
  if (rows.length === 0) return null;

  const context = rows
    .map((row, index) => [
      `[Tibo post ${index + 1} | role=${roleForRow(row, candidateId)} | tweet_created_at=${row.tweet_created_at?.trim() || "unavailable"} | tweet_id=${row.tweet_id}]`,
      `AUTHOR TEXT: ${JSON.stringify(row.text.trim())}`,
      `[End Tibo post ${index + 1}]`,
    ].join("\n"))
    .join("\n\n");

  return context.length <= MAX_RESET_DISPLAY_NAME_SOURCE_CONTEXT_LENGTH
    ? context
    : null;
}
