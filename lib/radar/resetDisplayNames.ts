import type { Locale, ResetDisplayNameRecord, WindowEventLike } from "./types";

export const GENERIC_RESET_DISPLAY_TITLES = new Set([
  "ランダムリセット",
  "強制リセット",
  "全体リセット",
  "リセット",
  "ご祝儀リセット",
  "臨時リセット",
  "定期リセット",
]);

function getSourceUrl(item: WindowEventLike) {
  return item.source_url?.trim() || item.source?.trim() || item.link?.trim() || null;
}

function getSourceTweetId(item: WindowEventLike) {
  const sourceUrl = getSourceUrl(item);
  if (!sourceUrl) return null;
  const match = sourceUrl.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/thsottiaux\/status\/(\d+)/i);
  return match?.[1] ?? null;
}

export function getResetDisplayNameEventKey(item: WindowEventLike) {
  const stableId = item.id?.trim() || item.guid?.trim();
  if (stableId) return stableId;
  const sourceTweetId = getSourceTweetId(item);
  return sourceTweetId ? `tibo-reset-${sourceTweetId}` : null;
}

export function isGenericResetDisplayTitle(title: string | null | undefined) {
  return title ? GENERIC_RESET_DISPLAY_TITLES.has(title.trim()) : true;
}

export function isSafeStoredAiResetName(record: ResetDisplayNameRecord | null | undefined) {
  return Boolean(
    record?.ai_status === "accepted" &&
      typeof record.ai_name_ja === "string" &&
      record.ai_name_ja.trim().length > 0 &&
      record.ai_name_ja.trim().length <= 32 &&
      typeof record.ai_confidence === "number" &&
      record.ai_confidence >= 0.7 &&
      typeof record.ai_evidence === "string" &&
      record.ai_evidence.trim().length > 0 &&
      (!record.ai_flags || record.ai_flags.length === 0),
  );
}

export function resolveJapaneseResetDisplayName(
  item: WindowEventLike,
  record: ResetDisplayNameRecord | null | undefined,
) {
  const manualName = record?.manual_name_ja?.trim();
  if (manualName) return manualName;

  const currentTitle = item.title?.trim();
  if (currentTitle && !isGenericResetDisplayTitle(currentTitle)) {
    return currentTitle;
  }

  if (isSafeStoredAiResetName(record)) {
    return record!.ai_name_ja!.trim();
  }

  return currentTitle || "ランダムリセット";
}

export function resolveResetDisplayTitle(
  item: WindowEventLike,
  record: ResetDisplayNameRecord | null | undefined,
  locale: Locale,
) {
  return locale === "ja"
    ? resolveJapaneseResetDisplayName(item, record)
    : item.title?.trim() || "ランダムリセット";
}

export function getResetDisplayNameSourceTweetId(item: WindowEventLike) {
  return getSourceTweetId(item);
}
