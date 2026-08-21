export const BANKED_NOTICE_MATCH_WINDOW_MS = 90 * 60 * 1000;
export const BANKED_CREDIT_ESTIMATOR_VERSION = "banked-credit-observation-v1";

export type BankedCreditState = {
  available: boolean;
  unlimited: boolean;
  balance: string;
};

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

function hasBroadScopeTerm(text: string) {
  return /\b(?:everyone|global)\b|\b(?:all|every)\s+(?:codex\s+and\s+)?chatgpt\s+work\s+users?\b|\b(?:all|every)\s+(?:users?|accounts?)\b|全(?:ての|て|有料)?(?:ユーザー|利用者|アカウント|プラン)/i.test(text);
}

/** Detects a distribution statement, not generic reset-button language. */
export function isBankedDistributionNotice(text: string | null | undefined) {
  if (typeof text !== "string") return false;
  const normalized = text.trim();
  return normalized.length > 0 && hasResetCreditTerm(normalized) && hasDistributionTerm(normalized);
}

/** Canonical history requires the post to explicitly cover a broad audience. */
export function isBroadBankedDistributionNotice(text: string | null | undefined) {
  return isBankedDistributionNotice(text) && hasBroadScopeTerm(text ?? "");
}

function parseFiniteTime(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBalance(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A local credit observation is only a grant candidate when availability or
 * the safe numeric balance increases. Consumption and unchanged state never
 * trigger a distribution POST.
 */
export function isBankedCreditGrant(
  previous: BankedCreditState | null | undefined,
  current: BankedCreditState | null | undefined,
) {
  if (!previous || !current || current.unlimited) return false;
  if (!previous.available && current.available) return true;

  const previousBalance = parseBalance(previous.balance);
  const currentBalance = parseBalance(current.balance);
  return previousBalance !== null && currentBalance !== null && currentBalance > previousBalance;
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
