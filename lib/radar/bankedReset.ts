export const BANKED_NOTICE_MATCH_WINDOW_MS = 90 * 60 * 1000;
export const BANKED_CREDIT_ESTIMATOR_VERSION = "banked-credit-observation-v1";

export type BankedNoticeTiming = {
  observedAt: string;
  expectedAt?: string | null;
  expectedEndAt?: string | null;
};

function hasResetCreditTerm(text: string) {
  return /\bbanked\s+reset\b|\breset\s+credit\b|任意リセット権|リセット権/i.test(text);
}

function hasDistributionTerm(text: string) {
  return /\b(?:credit|grant|give|gift|distribut|provide)\w*\b|配布|付与|配る|プレゼント/i.test(text);
}

function hasFutureAvailabilityTerm(text: string) {
  return /\b(?:banked\s+reset|reset\s+credit)\s+will\s+be\s+(?:there|available|ready)\b/i.test(text);
}

const BANKED_COMPLETION_PATTERN = /\b(?:banked\s+(?:reset|credit)|reset\s+credit)\b[\s\S]{0,100}\b(?:(?:has|have)\s+(?:been\s+)?(?:landed|arrived|distributed|credited|granted|issued|delivered|added)|(?:was|were)\s+(?:distributed|credited|granted|issued|delivered|added)|is\s+(?:now\s+)?available)\b/i;
const BANKED_FUTURE_CUE_PATTERN = /\b(?:will|going\s+to|tomorrow|tonight|later|soon|next\s+(?:day|week|month)|by\s+\d)\b/i;

function hasBroadScopeTerm(text: string) {
  return /\b(?:everyone|global)\b|\b(?:all|every)\s+(?:codex\s+and\s+)?chatgpt\s+work\s+users?\b|\b(?:all|every)\s+paid\s+users?\s+of\s+(?:chatgpt\s+work\s+and\s+codex|codex\s+and\s+chatgpt\s+work)\b|\b(?:all|every)\s+(?:users?|accounts?)\b|全(?:ての|て|有料)?(?:ユーザー|利用者|アカウント|プラン)/i.test(text);
}

/** Detects a distribution statement, not generic reset-button language. */
export function isBankedDistributionNotice(text: string | null | undefined) {
  if (typeof text !== "string") return false;
  const normalized = text.trim();
  return normalized.length > 0 && hasResetCreditTerm(normalized) && (
    hasDistributionTerm(normalized) || hasFutureAvailabilityTerm(normalized)
  );
}

/** Canonical history requires the post to explicitly cover a broad audience. */
export function isBroadBankedDistributionNotice(text: string | null | undefined) {
  return isBankedDistributionNotice(text) && hasBroadScopeTerm(text ?? "");
}

/**
 * A completed BANKED delivery is not evidence that the global usage limits
 * were reset. Keep it out of the generic Tibo reset adoption path; a real
 * BANKED history row still requires the Usage Monitor credit transition.
 */
export function isBankedDistributionCompletionSignal(text: string | null | undefined) {
  if (typeof text !== "string") return false;
  const normalized = text.trim();
  return normalized.length > 0 &&
    BANKED_COMPLETION_PATTERN.test(normalized) &&
    !BANKED_FUTURE_CUE_PATTERN.test(normalized);
}

export type BankedNoticeSupersessionInput = {
  text?: string | null;
  tweet_created_at?: string | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
  temporal_resolution_status?: string | null;
};

function isConcreteResolvedBankedNotice(notice: BankedNoticeSupersessionInput) {
  const start = notice.expected_start_at ? Date.parse(notice.expected_start_at) : Number.NaN;
  const end = notice.expected_end_at ? Date.parse(notice.expected_end_at) : Number.NaN;
  return (
    isBroadBankedDistributionNotice(notice.text) &&
    notice.temporal_resolution_status === "resolved" &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start
  );
}

/** Older broad BANKED notices are superseded once a newer concrete window exists. */
export function isSupersededBankedNotice<T extends BankedNoticeSupersessionInput>(
  notice: T,
  notices: readonly T[],
) {
  if (!isBroadBankedDistributionNotice(notice.text)) return false;
  const noticeTime = notice.tweet_created_at ? Date.parse(notice.tweet_created_at) : Number.NaN;
  if (!Number.isFinite(noticeTime)) return false;
  return notices.some((candidate) => {
    const candidateTime = candidate.tweet_created_at ? Date.parse(candidate.tweet_created_at) : Number.NaN;
    return candidate !== notice &&
      Number.isFinite(candidateTime) &&
      candidateTime > noticeTime &&
      isConcreteResolvedBankedNotice(candidate);
  });
}

function parseFiniteTime(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Match a local observation to the notice window without treating it as proof by itself. */
export function isBankedObservationWithinNoticeWindow(
  notice: BankedNoticeTiming,
  observedAt: string,
  matchWindowMs = BANKED_NOTICE_MATCH_WINDOW_MS,
) {
  const observedTime = parseFiniteTime(observedAt);
  const announcedTime = parseFiniteTime(notice.observedAt);
  if (observedTime === null || announcedTime === null || matchWindowMs < 0) return false;

  const expectedStart = parseFiniteTime(notice.expectedAt);
  const expectedEnd = parseFiniteTime(notice.expectedEndAt);
  if (expectedStart !== null && expectedEnd !== null && expectedEnd >= expectedStart) {
    return observedTime >= expectedStart - matchWindowMs && observedTime <= expectedEnd + matchWindowMs;
  }
  if (expectedStart !== null) {
    return Math.abs(observedTime - expectedStart) <= matchWindowMs;
  }
  return Math.abs(observedTime - announcedTime) <= matchWindowMs;
}
