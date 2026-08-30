import type {
  CanonicalHistoryCycleType,
  CanonicalHistoryNoticeType,
  CanonicalHistoryReasonType,
  CanonicalHistoryResetMethod,
  CanonicalHistorySignalKind,
  CanonicalResetHistoryDetails,
  WindowLike,
} from "./types";
import { getResetDisplayNameEventKey } from "./resetDisplayNames";
import {
  inferResetCycleType,
  normalizeResetReasonType,
  type ResetReasonContext,
} from "./resetReason";

const ANNOUNCEMENT_NOTICE_TYPES = new Set([
  "公式予告あり",
  "公式告知あり",
  "告知投稿あり",
  "予告あり",
]);

const TEASER_NOTICE_TYPES = new Set(["匂わせ投稿あり"]);

const TARGET_COMPENSATION_EVENT_KEY =
  "usage-reset-41c8ec4e-f752-4e5b-b685-4af67a1e6925";

function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function getResetTime(item: WindowLike) {
  return parseTime(item.closed_at ?? item.completed_at ?? item.date ?? item.opened_at);
}

function getSourceUrl(item: WindowLike) {
  return item.source_url?.trim() || item.source?.trim() || item.link?.trim() || null;
}

function hasDirectPostSource(item: WindowLike) {
  const source = getSourceUrl(item);
  if (!source) return false;

  try {
    const url = new URL(source);
    return (
      ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
        url.hostname.toLowerCase(),
      ) && /\/status\/\d+/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function toCanonicalCycleType(item: WindowLike & { kind?: string }): CanonicalHistoryCycleType {
  const explicit = item.details?.cycleType;
  if (explicit === "定期リセット" || item.recordKind === "regular_completed") {
    return "regular";
  }
  if (explicit === "個人別リセット") return "account_specific";
  if (explicit === "ランダムリセット") return "random";

  const inferred = inferResetCycleType({
    recordKind: item.recordKind,
    cycleType: explicit,
    title: item.title,
    summary: item.summary,
    windowHuman: item.window_human,
    scope: item.scope ?? item.details?.scope,
    details: item.details,
  });
  return inferred === "定期リセット"
    ? "regular"
    : inferred === "個人別リセット"
      ? "account_specific"
      : "random";
}

function toCanonicalReasonType(item: WindowLike & { kind?: string }): CanonicalHistoryReasonType {
  const eventKey = getResetDisplayNameEventKey(item);
  if (eventKey === TARGET_COMPENSATION_EVENT_KEY) return "compensation";

  const explicit = item.details?.reasonType;
  if (explicit === "定期更新" || toCanonicalCycleType(item) === "regular") {
    return "regular_update";
  }
  if (explicit === "詫びリセット") return "compensation";
  if (explicit === "ご祝儀リセット") return "celebration";

  const context: ResetReasonContext = {
    recordKind: item.recordKind,
    cycleType: item.details?.cycleType,
    reasonType: explicit,
    title: item.title,
    summary: item.summary,
    windowHuman: item.window_human,
    scope: item.scope ?? item.details?.scope,
    details: item.details,
  };
  const inferred = normalizeResetReasonType(context);
  return inferred === "定期更新"
    ? "regular_update"
    : inferred === "詫びリセット"
      ? "compensation"
      : "celebration";
}

function toCanonicalResetMethod(item: WindowLike): CanonicalHistoryResetMethod {
  if (
    item.details?.resetMethod === "任意リセット権配布" ||
    item.details?.resetMethod === "リセット実施" && item.recordKind === "banked_distribution"
  ) {
    return "banked_reset_distribution";
  }
  return "hard_reset";
}

function getLegacySignalKind(item: WindowLike): CanonicalHistorySignalKind {
  const noticeType = item.details?.noticeType?.trim();
  if (noticeType && TEASER_NOTICE_TYPES.has(noticeType)) return "teaser";
  if (noticeType && ANNOUNCEMENT_NOTICE_TYPES.has(noticeType)) return "announcement";
  return "none";
}

function parseLegacyDuration(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  const match = normalized.match(/^(?:(\d+)日)?(?:(\d+)時間)?(?:(\d+)分)?(?:（定期）)?$/);
  if (!match || !match[0].replace(/（定期）/g, "").trim()) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return Number.isFinite(days + hours + minutes)
    ? days * 24 * 60 + hours * 60 + minutes
    : null;
}

function getLegacyNoticeMinutes(item: WindowLike) {
  const signalTime = parseTime(item.opened_at);
  const resetTime = getResetTime(item);
  if (signalTime !== null && resetTime !== null && signalTime <= resetTime) {
    return Math.max(0, Math.round((resetTime - signalTime) / 60000));
  }
  return parseLegacyDuration(item.details?.noticeToExecution);
}

function normalizeExplicitDetails(
  details: CanonicalResetHistoryDetails,
): CanonicalResetHistoryDetails {
  return {
    cycleType: details.cycleType,
    reasonType: details.reasonType,
    resetMethod: details.resetMethod,
    scope: details.scope,
    noticeType: details.noticeType,
    noticeToExecutionMinutes: details.noticeType === "present"
      ? details.noticeToExecutionMinutes
      : null,
    signalKind: details.signalKind ?? (details.noticeType === "present" ? "announcement" : "none"),
  };
}

/**
 * Converts legacy Japanese history fields into the locale-neutral contract.
 * Raw signal and probability code continues to use WindowLike.details; this is
 * the only adapter used by the public history presentation.
 */
export function getCanonicalHistoryDetails(
  item: WindowLike & { kind?: string },
): CanonicalResetHistoryDetails {
  if (item.canonicalDetails) return normalizeExplicitDetails(item.canonicalDetails);

  const cycleType = toCanonicalCycleType(item);
  const reasonType = toCanonicalReasonType(item);
  const resetMethod = toCanonicalResetMethod(item);
  const scope = item.scope ?? item.details?.scope ?? "";
  const signalKind = getLegacySignalKind(item);
  const resetTime = getResetTime(item);
  const signalTime = parseTime(item.opened_at);
  const hasAnnouncementSource = hasDirectPostSource(item) || Boolean(item.officialNoticeTweetId);
  const hasAnnouncement =
    signalKind === "announcement" &&
    hasAnnouncementSource &&
    signalTime !== null &&
    resetTime !== null &&
    signalTime <= resetTime;

  return {
    cycleType,
    reasonType,
    resetMethod,
    scope,
    noticeType: hasAnnouncement ? "present" : "none",
    noticeToExecutionMinutes: hasAnnouncement ? getLegacyNoticeMinutes(item) : null,
    signalKind: hasAnnouncement ? "announcement" : signalKind === "teaser" ? "teaser" : "none",
  };
}

export function hasCanonicalHistoryAnnouncement(item: WindowLike & { kind?: string }) {
  return getCanonicalHistoryDetails(item).noticeType === "present";
}

export function getCanonicalHistorySignalKind(item: WindowLike & { kind?: string }) {
  return getCanonicalHistoryDetails(item).signalKind ?? "none";
}

export function getCanonicalHistoryNoticeType(item: WindowLike & { kind?: string }): CanonicalHistoryNoticeType {
  return getCanonicalHistoryDetails(item).noticeType;
}
