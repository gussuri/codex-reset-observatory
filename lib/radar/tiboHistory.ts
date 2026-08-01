import type { WindowEventLike } from "./types";

export type TiboSignalType =
  | "official_notice"
  | "reset_executed"
  | "teaser"
  | "irrelevant";

export type TiboVerificationStatus = "auto_unverified" | "confirmed" | "rejected";

export type TiboClassificationSource =
  | "rule"
  | "shadow"
  | "gemini"
  | "rule_fallback"
  | string;

export type TiboNoticeSignal = {
  tweet_id: string;
  text: string;
  tweet_url: string;
  tweet_created_at: string;
  signal_type: "official_notice" | "teaser";
  confidence: number | null;
  verification_status: TiboVerificationStatus;
};

export type FormalTiboResetSignal = {
  tweet_id: string;
  text: string;
  tweet_url: string;
  tweet_created_at: string;
  detected_at?: string | null;
  signal_type: TiboSignalType;
  confidence: number | null;
  verification_status: TiboVerificationStatus;
  classification_source?: TiboClassificationSource | null;
  ai_classification_status?: string | null;
  ai_reset_type_ja?: string | null;
  ai_notice_to_execution?: string | null;
  expires_at?: string | null;
  related_notice?: TiboNoticeSignal | null;
};

export type RejectedTiboResetSignal = Pick<
  FormalTiboResetSignal,
  "tweet_id" | "tweet_url" | "tweet_created_at"
>;

const FORMAL_RESET_CONFIDENCE = 0.95;
const OFFICIAL_NOTICE_CONFIDENCE = 0.95;
const TEASER_CONFIDENCE = 0.8;
const NOTICE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const DUPLICATE_RESET_WINDOW_MS = 5 * 60 * 1000;

function getTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getCompletedAt(item: WindowEventLike) {
  return item.closed_at ?? item.completed_at ?? item.opened_at ?? item.date ?? null;
}

function getTweetId(url: string | null | undefined) {
  return url?.match(/\/status\/(\d+)/i)?.[1] ?? null;
}

function isAllPaidScope(text: string) {
  return /all\s+(?:paid\s+)?(?:users|accounts|plans)|all\s+chatgpt\s+work\s+and\s+codex\s+users|全有料(?:プラン|ユーザー)|全ユーザー|全プラン/i.test(text);
}

function getScope(text: string) {
  return isAllPaidScope(text) ? "全有料プラン" : "Codex / ChatGPT Work";
}

function getSummaryTarget(text: string) {
  const hasCodex = /codex/i.test(text) || text.includes("Codex");
  const hasChatGptWork = /chatgpt\s+work/i.test(text) || text.includes("ChatGPT Work");

  if (hasCodex && hasChatGptWork) return "CodexとChatGPT Work";
  if (hasCodex) return "Codex";
  if (hasChatGptWork) return "ChatGPT Work";
  return "CodexとChatGPT Work";
}

function getReasonType(signal: FormalTiboResetSignal) {
  const allowed = new Set(["ご祝儀リセット", "詫びリセット", "定期リセット", "ランダムリセット"]);
  return signal.ai_reset_type_ja && allowed.has(signal.ai_reset_type_ja)
    ? signal.ai_reset_type_ja
    : "ランダムリセット";
}

function formatNoticeToExecution(minutes: number) {
  if (minutes <= 0) return "0分";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes}分`;
  if (remainingMinutes === 0) return `${hours}時間`;
  return `${hours}時間${remainingMinutes}分`;
}

export function isFormalTiboResetSignal(signal: FormalTiboResetSignal) {
  if (signal.signal_type !== "reset_executed") return false;
  if ((signal.confidence ?? 0) < FORMAL_RESET_CONFIDENCE) return false;
  if (signal.verification_status === "rejected") return false;
  if (!getTimestamp(signal.tweet_created_at)) return false;

  return (
    signal.verification_status === "confirmed" ||
    signal.classification_source === "gemini" ||
    signal.classification_source === "rule_fallback"
  );
}

export function findRelatedTiboNotice(
  resetSignal: FormalTiboResetSignal,
  noticeSignals: Array<TiboNoticeSignal>,
  previousResetAt?: string | null,
) {
  const resetTime = getTimestamp(resetSignal.tweet_created_at);
  if (resetTime === null) return null;

  const previousResetTime = getTimestamp(previousResetAt);
  const candidates = noticeSignals.filter((signal) => {
    const signalTime = getTimestamp(signal.tweet_created_at);
    const confidenceThreshold = signal.signal_type === "official_notice"
      ? OFFICIAL_NOTICE_CONFIDENCE
      : TEASER_CONFIDENCE;

    return Boolean(
      signalTime !== null &&
        signalTime < resetTime &&
        signalTime >= resetTime - NOTICE_LOOKBACK_MS &&
        (previousResetTime === null || previousResetTime === undefined || signalTime > previousResetTime) &&
        signal.verification_status !== "rejected" &&
        (signal.confidence ?? 0) >= confidenceThreshold,
    );
  });

  return candidates.sort((left, right) => {
    if (left.signal_type !== right.signal_type) {
      return left.signal_type === "official_notice" ? -1 : 1;
    }
    return (getTimestamp(right.tweet_created_at) ?? 0) - (getTimestamp(left.tweet_created_at) ?? 0);
  })[0] ?? null;
}

export function convertTiboResetSignalToHistoryEvent(
  signal: FormalTiboResetSignal,
  relatedNotice: TiboNoticeSignal | null = signal.related_notice ?? null,
): WindowEventLike {
  const completedAt = new Date(signal.tweet_created_at).toISOString();
  const noticeAt = relatedNotice
    ? new Date(relatedNotice.tweet_created_at).toISOString()
    : completedAt;
  const noticeMinutes = relatedNotice
    ? Math.max(0, Math.round((getTimestamp(signal.tweet_created_at)! - getTimestamp(relatedNotice.tweet_created_at)!) / 60000))
    : 0;
  const reasonType = getReasonType(signal);
  const cycleType = reasonType === "定期リセット" ? "定期リセット" : "ランダムリセット";
  const scope = getScope(signal.text);
  const summary = `Tibo氏が${getSummaryTarget(signal.text)}の利用上限リセット完了を発表しました。`;
  const title = reasonType === "ご祝儀リセット"
    ? "Tibo氏によるご祝儀リセット"
    : reasonType === "詫びリセット"
      ? "Tibo氏による詫びリセット"
      : reasonType === "定期リセット"
        ? "Tibo氏による定期リセット"
        : "Tibo氏による利用上限リセット";

  return {
    id: `tibo-reset-${signal.tweet_id}`,
    title,
    kind: "reset_completed",
    status: "closed",
    opened_at: noticeAt,
    closed_at: completedAt,
    completed_at: completedAt,
    window_minutes: noticeMinutes,
    scope,
    summary,
    source_url: signal.tweet_url,
    details: {
      cycleType,
      reasonType,
      resetMethod: "強制リセット",
      scope,
      noticeToExecution: formatNoticeToExecution(noticeMinutes),
      noticeType: relatedNotice
        ? relatedNotice.signal_type === "official_notice"
          ? "公式予告あり"
          : "匂わせ投稿あり"
        : "なし",
      note: summary,
    },
  };
}

function isSameReset(left: WindowEventLike, right: WindowEventLike) {
  const leftTweetId = getTweetId(left.source_url);
  const rightTweetId = getTweetId(right.source_url);
  if (leftTweetId && rightTweetId && leftTweetId === rightTweetId) return true;
  if (left.source_url && right.source_url && left.source_url === right.source_url) return true;

  const leftMethod = left.details?.resetMethod;
  const rightMethod = right.details?.resetMethod;
  const leftTime = getTimestamp(getCompletedAt(left));
  const rightTime = getTimestamp(getCompletedAt(right));

  return Boolean(
    leftMethod === "強制リセット" &&
      rightMethod === "強制リセット" &&
      leftTime !== null &&
      rightTime !== null &&
      Math.abs(leftTime - rightTime) <= DUPLICATE_RESET_WINDOW_MS,
  );
}

function chooseDetailedValue(
  dynamicValue: string | null | undefined,
  staticValue: string | null | undefined,
): string | undefined {
  if (!dynamicValue) return staticValue ?? undefined;
  if (!staticValue) return dynamicValue;
  return staticValue.length > dynamicValue.length ? staticValue : dynamicValue;
}

function mergeDuplicateHistory(dynamicItem: WindowEventLike, staticItem: WindowEventLike): WindowEventLike {
  const dynamicScope = dynamicItem.scope ?? dynamicItem.details?.scope;
  const staticScope = staticItem.scope ?? staticItem.details?.scope;
  const scope = dynamicScope === "Codex / ChatGPT Work" ? staticScope ?? dynamicScope : dynamicScope;

  return {
    ...staticItem,
    ...dynamicItem,
    id: dynamicItem.id ?? staticItem.id,
    title: chooseDetailedValue(dynamicItem.title, staticItem.title),
    summary: chooseDetailedValue(dynamicItem.summary, staticItem.summary),
    scope,
    source_url: dynamicItem.source_url ?? staticItem.source_url,
    details: {
      cycleType: dynamicItem.details?.cycleType ?? staticItem.details?.cycleType ?? "",
      reasonType: dynamicItem.details?.reasonType ?? staticItem.details?.reasonType ?? "",
      resetMethod: dynamicItem.details?.resetMethod ?? staticItem.details?.resetMethod ?? "",
      scope: scope ?? "",
      noticeToExecution:
        dynamicItem.details?.noticeToExecution ??
        staticItem.details?.noticeToExecution ??
        "0分",
      noticeType: dynamicItem.details?.noticeType ?? staticItem.details?.noticeType,
      note: chooseDetailedValue(dynamicItem.details?.note, staticItem.details?.note),
    },
  };
}

function matchesRejected(item: WindowEventLike, rejectedSignals: Array<RejectedTiboResetSignal>) {
  return rejectedSignals.some((signal) => {
    const itemTweetId = getTweetId(item.source_url);
    const signalTweetId = getTweetId(signal.tweet_url);
    if (itemTweetId && signalTweetId && itemTweetId === signalTweetId) return true;
    if (item.source_url && item.source_url === signal.tweet_url) return true;

    const itemTime = getTimestamp(getCompletedAt(item));
    const signalTime = getTimestamp(signal.tweet_created_at);
    return Boolean(
      item.details?.resetMethod === "強制リセット" &&
        itemTime !== null &&
        signalTime !== null &&
        Math.abs(itemTime - signalTime) <= DUPLICATE_RESET_WINDOW_MS,
    );
  });
}

export function combineResetHistory(
  staticHistory: Array<WindowEventLike>,
  formalTiboResets: Array<FormalTiboResetSignal>,
  rejectedTiboResets: Array<RejectedTiboResetSignal> = [],
) {
  const dynamicItems = formalTiboResets
    .filter(isFormalTiboResetSignal)
    .map((signal) => convertTiboResetSignalToHistoryEvent(signal));
  const filteredStaticHistory = staticHistory.filter((item) => !matchesRejected(item, rejectedTiboResets));
  const combined: Array<WindowEventLike> = [...dynamicItems];

  for (const item of filteredStaticHistory) {
    const duplicateIndex = combined.findIndex((dynamicItem) => isSameReset(dynamicItem, item));
    if (duplicateIndex === -1) {
      combined.push(item);
    } else {
      combined[duplicateIndex] = mergeDuplicateHistory(combined[duplicateIndex], item);
    }
  }

  return combined;
}
