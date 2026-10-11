import {
  findRelatedTiboNotices,
  isFormalTiboResetSignal,
  type FormalTiboResetSignal,
  type TiboNoticeSignal,
} from "./tiboHistory";
import { getEffectiveTiboSignalExpiryMs } from "./tiboTemporal";

function identityIds(signal: FormalTiboResetSignal) {
  return [signal.tweet_id, ...(signal.edit_history_tweet_ids ?? [])];
}

function isSameLogicalEvent(
  left: FormalTiboResetSignal,
  right: FormalTiboResetSignal,
) {
  const leftIds = new Set(identityIds(left));
  if (identityIds(right).some((id) => leftIds.has(id))) return true;
  return left.edit_metadata_source === "x_api" &&
    right.edit_metadata_source === "x_api" &&
    Boolean(left.logical_post_id && left.logical_post_id === right.logical_post_id);
}

export function resolveTiboResetDisplayNameSourceIds(input: {
  candidate: FormalTiboResetSignal;
  canonicalSourceTweetIds: readonly string[];
  acceptedResets: readonly FormalTiboResetSignal[];
  notices: readonly TiboNoticeSignal[];
}) {
  const completedAt = Date.parse(input.candidate.tweet_created_at);
  if (!Number.isFinite(completedAt) || !isFormalTiboResetSignal(input.candidate)) {
    return null;
  }

  const previousReset = input.acceptedResets
    .filter(isFormalTiboResetSignal)
    .filter((reset) => !isSameLogicalEvent(input.candidate, reset))
    .filter((reset) => Date.parse(reset.tweet_created_at) < completedAt)
    .sort((left, right) => Date.parse(right.tweet_created_at) - Date.parse(left.tweet_created_at))[0];

  const relatedNotices = findRelatedTiboNotices(
    input.candidate,
    input.notices.filter((notice) => {
      const expiry = getEffectiveTiboSignalExpiryMs(notice);
      return !Number.isFinite(expiry) || expiry > completedAt;
    }),
    previousReset?.tweet_created_at ?? null,
  );
  return Array.from(new Set([
    input.candidate.tweet_id,
    ...input.canonicalSourceTweetIds,
    ...relatedNotices.map((notice) => notice.tweet_id),
  ].filter((id): id is string => typeof id === "string" && id.trim().length > 0)));
}
