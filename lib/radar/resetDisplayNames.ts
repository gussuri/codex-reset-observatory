import type { Locale, ResetDisplayNameRecord, WindowEventLike } from "./types";
import {
  RANDOM_RESET_NAME_MAX_LENGTH,
  RANDOM_RESET_NAME_PROMPT_VERSION,
  RANDOM_RESET_NAME_V2_PROMPT_VERSION,
  RANDOM_RESET_NAME_V1_MAX_LENGTH,
  RANDOM_RESET_NAME_V1_PROMPT_VERSION,
} from "./randomResetNameConfig";

export const GENERIC_RESET_DISPLAY_TITLES = new Set([
  "ランダムリセット",
  "強制リセット",
  "全体リセット",
  "リセット",
  "ご祝儀リセット",
  "臨時リセット",
  "定期リセット",
  "全体リセット完了",
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
  if (
    record?.ai_status !== "accepted" ||
    typeof record.ai_name_ja !== "string" ||
    record.ai_name_ja.trim().length === 0
  ) {
    return false;
  }

  if (record.ai_prompt_version === RANDOM_RESET_NAME_PROMPT_VERSION) {
    const hasLocalizedColumns = record.ai_name_en !== undefined || record.ai_name_zh !== undefined;
    return (
      record.ai_name_ja.trim().length <= RANDOM_RESET_NAME_MAX_LENGTH &&
      record.ai_name_ja.trim().endsWith("リセット") &&
      (!hasLocalizedColumns || (
        typeof record.ai_name_en === "string" &&
        record.ai_name_en.trim().length > 0 &&
        record.ai_name_en.trim().length <= RANDOM_RESET_NAME_MAX_LENGTH &&
        /reset$/i.test(record.ai_name_en.trim()) &&
        typeof record.ai_name_zh === "string" &&
        record.ai_name_zh.trim().length > 0 &&
        record.ai_name_zh.trim().length <= RANDOM_RESET_NAME_MAX_LENGTH &&
        record.ai_name_zh.trim().endsWith("重置")
      )) &&
      (!record.ai_flags || record.ai_flags.length === 0)
    );
  }

  if (record.ai_prompt_version === RANDOM_RESET_NAME_V2_PROMPT_VERSION) {
    return (
      record.ai_name_ja.trim().length <= RANDOM_RESET_NAME_MAX_LENGTH &&
      record.ai_name_ja.trim().endsWith("リセット") &&
      (!record.ai_flags || record.ai_flags.length === 0)
    );
  }

  return (
    (record.ai_prompt_version === RANDOM_RESET_NAME_V1_PROMPT_VERSION || record.ai_prompt_version === null) &&
    record.ai_name_ja.trim().length <= RANDOM_RESET_NAME_V1_MAX_LENGTH &&
    typeof record.ai_confidence === "number" &&
    record.ai_confidence >= 0.7 &&
    typeof record.ai_evidence === "string" &&
    record.ai_evidence.trim().length > 0 &&
    (!record.ai_flags || record.ai_flags.length === 0)
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

  if (isGenericResetDisplayTitle(item.title) && isSafeStoredAiResetName(record)) {
    return record!.ai_name_ja!.trim();
  }

  return currentTitle || "ランダムリセット";
}

export function resolveResetDisplayTitle(
  item: WindowEventLike,
  record: ResetDisplayNameRecord | null | undefined,
  locale: Locale,
) {
  if (locale === "ja") return resolveJapaneseResetDisplayName(item, record);
  if (isGenericResetDisplayTitle(item.title) && isSafeStoredAiResetName(record)) {
    const localizedName = locale === "en" ? record?.ai_name_en : record?.ai_name_zh;
    if (localizedName?.trim()) return localizedName.trim();
  }
  return item.title?.trim() || "ランダムリセット";
}

export function getResetDisplayNameSourceTweetId(item: WindowEventLike) {
  return getSourceTweetId(item);
}
