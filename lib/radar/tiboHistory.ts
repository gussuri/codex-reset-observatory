import type { ActiveTiboSignal, RadarData, WindowEventLike } from "./types";
import type { TeaserStrength } from "./teaserStrength";
import type { TiboSecondarySignal } from "./tiboSecondarySignal";
import { expandTiboSignalVariants } from "./tiboSecondarySignal";
import type {
  TemporalKind,
  TemporalPrecision,
  TemporalResolutionSource,
  TemporalResolutionStatus,
} from "./tiboTemporal";
import type { CodexRecoveryObservation } from "../codexUsageRecovery";
import type { ResetExecutionEstimate } from "./resetExecution";
import {
  toRegularResetHistoryEvent,
  type RegularResetEventRow,
} from "./regularResetSchedule";
import { isBroadResetScope } from "./resetEligibility";
import { getEffectiveTemporalPrecision, isTemporalNoticeConsumedAtReset } from "./tiboTemporal";
import {
  inferResetCycleType,
  normalizeResetReasonType,
} from "./resetReason";
import { getTiboClassificationSafetyDecision } from "./classification";
import type { ResetReasonType } from "./types";
import {
  BANKED_DISTRIBUTION_ESTIMATOR_VERSION,
  isBankedDistributionCompletionSignal,
  isBroadBankedDistributionNotice,
} from "./bankedReset";

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
  | "manual"
  | string;

export type TiboNoticeSignal = {
  tweet_id: string;
  text: string;
  tweet_url: string;
  tweet_created_at: string;
  signal_type: "official_notice" | "teaser";
  confidence: number | null;
  verification_status: TiboVerificationStatus;
  expires_at?: string | null;
  ai_temporal_expression?: string | null;
  ai_temporal_kind?: TemporalKind | null;
  ai_temporal_precision?: TemporalPrecision | null;
  ai_temporal_timezone?: string | null;
  temporal_expression?: string | null;
  temporal_kind?: TemporalKind | null;
  temporal_precision?: TemporalPrecision | null;
  temporal_timezone?: string | null;
  temporal_confidence?: number | null;
  temporal_resolution_source?: TemporalResolutionSource | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
  temporal_resolution_status?: TemporalResolutionStatus | null;
};

export type BankedDistributionCompletionSignal = {
  tweet_id: string;
  text: string;
  tweet_url: string;
  tweet_created_at: string;
  signal_type: "irrelevant";
  confidence: number | null;
  verification_status: TiboVerificationStatus;
  is_reply?: boolean | null;
};

export type BankedDistributionSignal =
  | TiboNoticeSignal
  | BankedDistributionCompletionSignal;

export const NOTICE_BACKED_RECOVERY_PRESENTATION = "notice_backed_recovery" as const;
export const NOTICE_BACKED_RECOVERY_TITLE_KEY = "noticeBackedRecoveryTitle";
export const NOTICE_BACKED_RECOVERY_BODY_KEY = "noticeBackedRecoveryBody";

export const NOTICE_BACKED_RECOVERY_FALLBACK_SUMMARY = "Codexの利用枠がリセットされました。";
export const NOTICE_BACKED_RECOVERY_SUMMARIES: Readonly<Record<string, string>> = {
  "tibo-reset-2087706104814023111":
    "Codexのアクティブユーザー数1500万人突破を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
  "tibo-reset-2091412393368945027":
    "週末の過剰消費トラブルに伴い、Codex全体の利用枠がお詫びとしてリセットされました。",
};
export const NOTICE_BACKED_RECOVERY_TITLES: Readonly<Record<string, string>> = {
  "tibo-reset-2091412393368945027": "過剰消費のお詫びリセット",
};
export const NOTICE_BACKED_RECOVERY_REASON_TYPES: Readonly<Record<string, ResetReasonType>> = {
  "tibo-reset-2087706104814023111": "ご祝儀リセット",
  "tibo-reset-2091412393368945027": "詫びリセット",
};

export function getNoticeBackedRecoveryHistorySummary(resetEventKey: string) {
  return NOTICE_BACKED_RECOVERY_SUMMARIES[resetEventKey] ?? NOTICE_BACKED_RECOVERY_FALLBACK_SUMMARY;
}

function getNoticeBackedRecoveryReasonType(resetEventKey: string) {
  return NOTICE_BACKED_RECOVERY_REASON_TYPES[resetEventKey] ?? "ご祝儀リセット";
}

function getNoticeBackedRecoveryTitle(resetEventKey: string) {
  return NOTICE_BACKED_RECOVERY_TITLES[resetEventKey] ?? "全体リセット完了";
}

export type FormalTiboResetSignal = {
  tweet_id: string;
  text: string;
  tweet_url: string;
  tweet_created_at: string;
  detected_at?: string | null;
  signal_type: TiboSignalType;
  confidence: number | null;
  verification_status: TiboVerificationStatus;
  classification_reason?: string | null;
  classification_source?: TiboClassificationSource | null;
  rule_signal_type?: TiboSignalType | null;
  ai_signal_type?: TiboSignalType | null;
  ai_classification_status?: string | null;
  ai_reset_type_ja?: string | null;
  ai_notice_to_execution?: string | null;
  ai_teaser_strength?: TeaserStrength | null;
  secondary_signal?: TiboSecondarySignal | null;
  teaser_strength?: TeaserStrength | null;
  ai_teaser_strength_confidence?: number | null;
  ai_teaser_strength_evidence_quote?: string | null;
  ai_teaser_strength_reason_ja?: string | null;
  ai_temporal_expression?: string | null;
  ai_temporal_kind?: TemporalKind | null;
  ai_temporal_precision?: TemporalPrecision | null;
  ai_temporal_timezone?: string | null;
  ai_temporal_confidence?: number | null;
  temporal_expression?: string | null;
  temporal_kind?: TemporalKind | null;
  temporal_precision?: TemporalPrecision | null;
  temporal_timezone?: string | null;
  temporal_confidence?: number | null;
  temporal_resolution_source?: TemporalResolutionSource | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
  temporal_resolution_status?: TemporalResolutionStatus | null;
  temporal_resolution_version?: string | null;
  translated_text_ja?: string | null;
  translated_text_zh?: string | null;
  expires_at?: string | null;
  is_reply?: boolean | null;
  is_quote?: boolean | null;
  quote_context_text?: string | null;
  quote_tweet_url?: string | null;
  quote_author_handle?: string | null;
  reply_to_handles?: string[] | null;
  reply_context_text?: string | null;
  source_timeline?: "profile" | "with_replies" | null;
  related_notice?: TiboNoticeSignal | null;
  related_notices?: TiboNoticeSignal[];
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
const RULE_BACKED_CLASSIFICATION_SOURCES = new Set<TiboClassificationSource>([
  "rule",
  "shadow",
  "rule_fallback",
]);

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
  return /all\s+(?:paid\s+)?(?:users|accounts|plans)|all\s+paid\s+(?:chatgpt\s+work\s+and\s+codex|codex\s+and\s+chatgpt\s+work)\s+users|all\s+chatgpt\s+work\s+and\s+codex\s+users|全有料(?:プラン|ユーザー)|全ユーザー|全プラン/i.test(text);
}

function getScope(text: string) {
  return isAllPaidScope(text) ? "全有料プラン" : "Codex / ChatGPT Work";
}

function getReasonType(signal: FormalTiboResetSignal) {
  return normalizeResetReasonType({ text: signal.text });
}

function formatNoticeToExecution(minutes: number) {
  if (minutes <= 0) return "0分";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes}分`;
  if (remainingMinutes === 0) return `${hours}時間`;
  return `${hours}時間${remainingMinutes}分`;
}

function getNoticeScheduleWidthMs(notice: TiboNoticeSignal) {
  const start = getTimestamp(notice.expected_start_at);
  const end = getTimestamp(notice.expected_end_at);
  if (start === null || end === null || end < start) return null;
  return end - start;
}

function getNoticeSpecificityRank(notice: TiboNoticeSignal) {
  const text = notice.text ?? "";
  const clockMentions = text.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)\b/gi) ?? [];
  const hasRangeLanguage = /\b(?:between|from)\b[\s\S]{0,80}\b(?:and|to)\b/i.test(text);
  const widthMs = getNoticeScheduleWidthMs(notice);
  const widthHours = widthMs === null ? null : widthMs / (60 * 60 * 1000);
  let temporalRank = 0;

  // A narrow explicit range is more useful than a broad deadline window. The
  // text check keeps a resolver-provided "range" from hiding a concrete clock
  // expression such as "by 8pm".
  if (clockMentions.length >= 2 && hasRangeLanguage) {
    temporalRank = 480 - Math.min(widthHours ?? 24, 24);
  } else if (clockMentions.length > 0 || (notice.temporal_precision ?? notice.ai_temporal_precision) === "exact_time") {
    temporalRank = 450;
  } else if ((notice.temporal_precision ?? notice.ai_temporal_precision) === "range") {
    temporalRank = 400 - Math.min(widthHours ?? 24, 24);
  } else if ((notice.temporal_precision ?? notice.ai_temporal_precision) === "daypart") {
    temporalRank = 300;
  } else if ((notice.temporal_precision ?? notice.ai_temporal_precision) === "day") {
    temporalRank = 200;
  } else if (widthMs !== null) {
    temporalRank = 150;
  }

  return [
    notice.signal_type === "official_notice" ? 1 : 0,
    temporalRank,
    isAllPaidScope(text) ? 1 : 0,
    getTimestamp(notice.tweet_created_at) ?? 0,
  ] as const;
}

export function compareTiboNoticeSpecificity(
  left: TiboNoticeSignal,
  right: TiboNoticeSignal,
) {
  const leftRank = getNoticeSpecificityRank(left);
  const rightRank = getNoticeSpecificityRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) {
      return rightRank[index] - leftRank[index];
    }
  }
  return right.tweet_id.localeCompare(left.tweet_id);
}

export function selectRepresentativeTiboNotice(
  notices: ReadonlyArray<TiboNoticeSignal>,
) {
  return notices.slice().sort(compareTiboNoticeSpecificity)[0] ?? null;
}

function sortTiboNoticesChronologically(notices: ReadonlyArray<TiboNoticeSignal>) {
  return notices
    .slice()
    .sort((left, right) => {
      const timeDifference =
        (getTimestamp(left.tweet_created_at) ?? 0) - (getTimestamp(right.tweet_created_at) ?? 0);
      return timeDifference || left.tweet_id.localeCompare(right.tweet_id);
    });
}

function sortTweetIdsChronologically(
  tweetIds: ReadonlyArray<string>,
  notices: ReadonlyArray<Pick<TiboNoticeSignal, "tweet_id" | "tweet_created_at"> | BankedDistributionCompletionSignal>,
) {
  const timestampByTweetId = new Map(
    notices.map((notice) => [notice.tweet_id, getTimestamp(notice.tweet_created_at) ?? Number.MAX_SAFE_INTEGER]),
  );
  return Array.from(new Set(tweetIds)).sort((left, right) => {
    const timeDifference =
      (timestampByTweetId.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (timestampByTweetId.get(right) ?? Number.MAX_SAFE_INTEGER);
    return timeDifference || left.localeCompare(right);
  });
}

function areTiboNoticeSchedulesCompatible(
  left: TiboNoticeSignal,
  right: TiboNoticeSignal,
) {
  const leftStart = getTimestamp(left.expected_start_at);
  const leftEnd = getTimestamp(left.expected_end_at);
  const rightStart = getTimestamp(right.expected_start_at);
  const rightEnd = getTimestamp(right.expected_end_at);
  if (
    leftStart === null ||
    leftEnd === null ||
    rightStart === null ||
    rightEnd === null
  ) {
    return true;
  }

  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function getNoticeCluster(
  candidates: ReadonlyArray<TiboNoticeSignal>,
  representative: TiboNoticeSignal | null,
) {
  if (!representative) return [];
  return sortTiboNoticesChronologically(
    candidates.filter((candidate) =>
      candidate.tweet_id === representative.tweet_id ||
      areTiboNoticeSchedulesCompatible(candidate, representative),
    ),
  );
}

export function findRelatedTiboNoticeCluster(
  noticeSignals: ReadonlyArray<TiboNoticeSignal>,
  representativeTweetId: string,
  completedAt: string,
) {
  const completedTime = getTimestamp(completedAt);
  const representative = noticeSignals.find((notice) => notice.tweet_id === representativeTweetId) ?? null;
  if (!representative || completedTime === null) return [];

  const candidates = noticeSignals.filter((notice) => {
    const time = getTimestamp(notice.tweet_created_at);
    return Boolean(
      time !== null &&
        time < completedTime &&
        completedTime - time <= NOTICE_LOOKBACK_MS &&
        notice.signal_type === "official_notice" &&
        notice.verification_status !== "rejected" &&
        (notice.confidence ?? 0) >= OFFICIAL_NOTICE_CONFIDENCE,
    );
  });
  return getNoticeCluster(candidates, representative);
}

export function findRelatedBankedDistributionNotices(
  noticeSignals: ReadonlyArray<BankedDistributionSignal>,
  representativeTweetId: string,
  observedAt: string,
) {
  const officialCandidates = noticeSignals.filter((notice): notice is TiboNoticeSignal =>
    notice.signal_type === "official_notice" &&
    notice.verification_status !== "rejected" &&
    (notice.confidence ?? 0) >= OFFICIAL_NOTICE_CONFIDENCE &&
    isBroadBankedDistributionNotice(notice.text),
  );
  const observedTime = getTimestamp(observedAt);
  if (observedTime === null) return [];

  const representative = officialCandidates.find((notice) => notice.tweet_id === representativeTweetId) ?? null;
  const officialCluster = getNoticeCluster(
    officialCandidates.filter((notice) => {
      const time = getTimestamp(notice.tweet_created_at);
      return time !== null && observedTime !== null && time <= observedTime;
    }),
    representative,
  );
  if (officialCluster.length === 0) return [];

  const firstAnnouncementTime = getTimestamp(officialCluster[0].tweet_created_at);
  const completionSignals = noticeSignals.filter((signal): signal is BankedDistributionCompletionSignal => {
    if (
      signal.signal_type !== "irrelevant" ||
      signal.verification_status === "rejected" ||
      signal.is_reply === true ||
      !isBankedDistributionCompletionSignal(signal.text) ||
      firstAnnouncementTime === null
    ) {
      return false;
    }
    const completionTime = getTimestamp(signal.tweet_created_at);
    return completionTime !== null &&
      completionTime >= firstAnnouncementTime &&
      completionTime <= observedTime &&
      completionTime - firstAnnouncementTime <= NOTICE_LOOKBACK_MS;
  });

  return [...officialCluster, ...completionSignals].sort((left, right) => {
    const timeDifference =
      (getTimestamp(left.tweet_created_at) ?? 0) - (getTimestamp(right.tweet_created_at) ?? 0);
    return timeDifference || left.tweet_id.localeCompare(right.tweet_id);
  });
}

export function isFormalTiboResetSignal(signal: FormalTiboResetSignal) {
  if (signal.is_reply === true) return false;
  if (signal.signal_type !== "reset_executed") return false;
  if (getTiboClassificationSafetyDecision(signal.text, signal.signal_type).signalType !== "reset_executed") {
    return false;
  }
  if ((signal.confidence ?? 0) < FORMAL_RESET_CONFIDENCE) return false;
  if (signal.verification_status === "rejected") return false;
  if (!getTimestamp(signal.tweet_created_at)) return false;

  return (
    signal.verification_status === "confirmed" ||
    signal.classification_source === "gemini" ||
    RULE_BACKED_CLASSIFICATION_SOURCES.has(signal.classification_source ?? "")
  );
}

export function findRelatedTiboNotices(
  resetSignal: FormalTiboResetSignal,
  noticeSignals: Array<TiboNoticeSignal>,
  previousResetAt?: string | null,
) {
  const resetTime = getTimestamp(resetSignal.tweet_created_at);
  if (resetTime === null) return [];

  const previousResetTime = getTimestamp(previousResetAt);
  const candidates = noticeSignals.filter((signal) => {
    const signalTime = getTimestamp(signal.tweet_created_at);
    const confidenceThreshold = signal.signal_type === "official_notice"
      ? OFFICIAL_NOTICE_CONFIDENCE
      : TEASER_CONFIDENCE;
    const hasResolvedSchedule = signal.signal_type === "official_notice" &&
      signal.temporal_resolution_status === "resolved" &&
      getTimestamp(signal.expected_start_at) !== null;
    const matchesResolvedSchedule = hasResolvedSchedule
      ? isTemporalNoticeConsumedAtReset(
          {
            status: "resolved",
            temporalPrecision: getEffectiveTemporalPrecision({
              status: signal.temporal_resolution_status,
              temporalPrecision: signal.temporal_precision ?? signal.ai_temporal_precision,
              expectedStartAt: signal.expected_start_at,
              expectedEndAt: signal.expected_end_at,
            }) ?? "unknown",
            expectedStartAt: signal.expected_start_at ?? null,
            expectedEndAt: signal.expected_end_at ?? null,
          },
          resetSignal.tweet_created_at,
        )
      : false;
    const matchesLookback = signalTime !== null &&
      signalTime >= resetTime - NOTICE_LOOKBACK_MS;

    return Boolean(
      signalTime !== null &&
        signalTime < resetTime &&
        (matchesResolvedSchedule || (!hasResolvedSchedule && matchesLookback)) &&
        (previousResetTime === null || previousResetTime === undefined || signalTime > previousResetTime) &&
        signal.verification_status !== "rejected" &&
        (signal.confidence ?? 0) >= confidenceThreshold,
    );
  });

  return getNoticeCluster(candidates, selectRepresentativeTiboNotice(candidates));
}

export function findRelatedTiboNotice(
  resetSignal: FormalTiboResetSignal,
  noticeSignals: Array<TiboNoticeSignal>,
  previousResetAt?: string | null,
) {
  return selectRepresentativeTiboNotice(
    findRelatedTiboNotices(resetSignal, noticeSignals, previousResetAt),
  );
}

export function convertTiboResetSignalToHistoryEvent(
  signal: FormalTiboResetSignal,
  relatedNotice: TiboNoticeSignal | null = signal.related_notice ?? null,
  completedAtOverride?: string,
  relatedNotices: ReadonlyArray<TiboNoticeSignal> = signal.related_notices ?? [],
): WindowEventLike {
  const completedAt = new Date(completedAtOverride ?? signal.tweet_created_at).toISOString();
  const notices = sortTiboNoticesChronologically([
    ...relatedNotices,
    ...(signal.related_notices ?? []),
    ...(relatedNotice ? [relatedNotice] : []),
  ].filter((notice, index, all) =>
    all.findIndex((candidate) => candidate.tweet_id === notice.tweet_id) === index,
  ));
  const representative = relatedNotice ?? selectRepresentativeTiboNotice(notices);
  const firstAnnouncement = notices[0] ?? null;
  const noticeAt = firstAnnouncement
    ? new Date(firstAnnouncement.tweet_created_at).toISOString()
    : completedAt;
  const noticeMinutes = firstAnnouncement
    ? Math.max(0, Math.round((getTimestamp(completedAt)! - getTimestamp(firstAnnouncement.tweet_created_at)!) / 60000))
    : 0;
  const reasonType = getReasonType(signal);
  const cycleType = inferResetCycleType({ text: signal.text });
  const scope = getScope(signal.text);
  const summary = "Tibo氏がCodexの利用上限リセット完了を発表しました。";
  const title = "ランダムリセット";

  return {
    id: `tibo-reset-${signal.tweet_id}`,
    recordKind: "confirmed_global",
    title,
    kind: "reset_completed",
    status: "closed",
    opened_at: noticeAt,
    closed_at: completedAt,
    completed_at: completedAt,
    window_minutes: noticeMinutes,
    scope,
    summary,
    source_url: representative?.tweet_url ?? signal.tweet_url,
    details: {
      cycleType,
      reasonType,
      resetMethod: "強制リセット",
      scope,
      noticeToExecution: formatNoticeToExecution(noticeMinutes),
      noticeType: representative
        ? representative.signal_type === "official_notice"
          ? "公式予告あり"
          : "匂わせ投稿あり"
        : "なし",
      note: summary,
    },
    ...(representative ? { officialNoticeTweetId: representative.tweet_id } : {}),
    sourceTweetIds: sortTiboNoticesChronologically(notices)
      .map((notice) => notice.tweet_id)
      .concat(signal.tweet_id)
      .filter((tweetId, index, all) => all.indexOf(tweetId) === index),
  };
}

function getRepresentativeRank(signal: FormalTiboResetSignal) {
  const explicitBroadScope = isAllPaidScope(signal.text) ? 1 : 0;
  const bothClassifiersAgree =
    signal.rule_signal_type === "reset_executed" &&
    signal.ai_signal_type === "reset_executed"
    ? 1
    : 0;

  return [
    signal.verification_status === "confirmed" ? 1 : 0,
    explicitBroadScope,
    signal.confidence ?? 0,
    bothClassifiersAgree,
  ];
}

function compareRepresentativeSignals(
  left: FormalTiboResetSignal,
  right: FormalTiboResetSignal,
) {
  const leftRank = getRepresentativeRank(left);
  const rightRank = getRepresentativeRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) {
      return rightRank[index] - leftRank[index];
    }
  }

  const leftTime = getTimestamp(left.tweet_created_at) ?? 0;
  const rightTime = getTimestamp(right.tweet_created_at) ?? 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return right.tweet_id.localeCompare(left.tweet_id);
}

export function areFormalTiboResetSignalsSameCluster(
  left: FormalTiboResetSignal,
  right: FormalTiboResetSignal,
) {
  if (!isFormalTiboResetSignal(left) || !isFormalTiboResetSignal(right)) return false;
  const leftEvent = convertTiboResetSignalToHistoryEvent(left);
  const rightEvent = convertTiboResetSignalToHistoryEvent(right);
  return isBroadResetScope(leftEvent) && isBroadResetScope(rightEvent) && isSameReset(leftEvent, rightEvent);
}

function clusterFormalTiboResetSignals(signals: Array<FormalTiboResetSignal>) {
  const sorted = signals
    .slice()
    .sort((left, right) => {
      const timeDifference =
        (getTimestamp(left.tweet_created_at) ?? 0) - (getTimestamp(right.tweet_created_at) ?? 0);
      return timeDifference || left.tweet_id.localeCompare(right.tweet_id);
    });
  const clusters: Array<Array<FormalTiboResetSignal>> = [];

  for (const signal of sorted) {
    const current = clusters.at(-1);
    const anchor = current?.[0];
    if (anchor && areFormalTiboResetSignalsSameCluster(anchor, signal)) {
      current!.push(signal);
    } else {
      clusters.push([signal]);
    }
  }

  return clusters.map((cluster) => {
    const earliest = cluster[0];
    const representative = cluster.slice().sort(compareRepresentativeSignals)[0];
    const relatedNotices = sortTiboNoticesChronologically(
      cluster.flatMap((signal) => [
        ...(signal.related_notices ?? []),
        ...(signal.related_notice ? [signal.related_notice] : []),
      ]).filter((notice, index, all) =>
        all.findIndex((candidate) => candidate.tweet_id === notice.tweet_id) === index,
      ),
    );
    const relatedNotice = selectRepresentativeTiboNotice(relatedNotices);
    const event = convertTiboResetSignalToHistoryEvent(
      representative,
      relatedNotice,
      earliest.tweet_created_at,
      relatedNotices,
    );
    const resetIds = cluster
      .slice()
      .sort((left, right) => {
        const timeDifference =
          (getTimestamp(left.tweet_created_at) ?? 0) - (getTimestamp(right.tweet_created_at) ?? 0);
        return timeDifference || left.tweet_id.localeCompare(right.tweet_id);
      })
      .map((signal) => signal.tweet_id);

    return {
      ...event,
      sourceTweetIds: sortTiboNoticesChronologically(relatedNotices)
        .map((notice) => notice.tweet_id)
        .concat(resetIds)
        .filter((tweetId, index, all) => all.indexOf(tweetId) === index),
    };
  });
}

function isSameReset(left: WindowEventLike, right: WindowEventLike) {
  if (
    left.officialNoticeTweetId &&
    right.officialNoticeTweetId &&
    left.officialNoticeTweetId === right.officialNoticeTweetId
  ) {
    return true;
  }

  if (
    left.officialNoticeTweetId &&
    right.sourceTweetIds?.includes(left.officialNoticeTweetId)
  ) {
    return true;
  }

  if (
    right.officialNoticeTweetId &&
    left.sourceTweetIds?.includes(right.officialNoticeTweetId)
  ) {
    return true;
  }

  const leftTweetId = getTweetId(left.source_url);
  const rightTweetId = getTweetId(right.source_url);
  if (leftTweetId && rightTweetId && leftTweetId === rightTweetId) return true;

  const leftMethod = left.details?.resetMethod;
  const rightMethod = right.details?.resetMethod;
  const leftTime = getTimestamp(getCompletedAt(left));
  const rightTime = getTimestamp(getCompletedAt(right));
  const leftCycleType = left.details?.cycleType;
  const rightCycleType = right.details?.cycleType;

  // A time-only fuzzy match must not collapse distinct regular and random
  // reset events. Explicit identities above still prove that two records are
  // the same event even when their normalized cycle types differ.
  if (leftCycleType && rightCycleType && leftCycleType !== rightCycleType) {
    return false;
  }

  return Boolean(
    leftMethod === "強制リセット" &&
      rightMethod === "強制リセット" &&
      leftTime !== null &&
      rightTime !== null &&
      Math.abs(leftTime - rightTime) <= DUPLICATE_RESET_WINDOW_MS,
  );
}

function mergeDuplicateHistory(dynamicItem: WindowEventLike, staticItem: WindowEventLike): WindowEventLike {
  const dynamicDetails = dynamicItem.details;
  const staticDetails = staticItem.details;
  const dynamicScope = dynamicItem.scope ?? dynamicItem.details?.scope;
  const staticScope = staticItem.scope ?? staticItem.details?.scope;
  const scope = staticScope ?? dynamicScope;
  const note = staticDetails && Object.prototype.hasOwnProperty.call(staticDetails, "note")
    ? staticDetails.note ?? null
    : dynamicDetails?.note ?? null;
  const sourceTweetIds = Array.from(new Set([
    ...(dynamicItem.sourceTweetIds ?? []),
    ...(staticItem.sourceTweetIds ?? []),
  ]));

  return {
    ...dynamicItem,
    ...staticItem,
    id: dynamicItem.id ?? staticItem.id,
    title: staticItem.title ?? dynamicItem.title,
    summary: staticItem.summary ?? dynamicItem.summary,
    scope,
    source_url: staticItem.source_url ?? dynamicItem.source_url,
    ...(sourceTweetIds.length > 0 ? { sourceTweetIds } : {}),
    details: {
      cycleType: staticDetails?.cycleType ?? dynamicDetails?.cycleType ?? "",
      reasonType: staticDetails?.reasonType ?? dynamicDetails?.reasonType ?? "",
      resetMethod: staticDetails?.resetMethod ?? dynamicDetails?.resetMethod ?? "",
      scope: scope ?? "",
      noticeToExecution: staticDetails?.noticeToExecution ?? dynamicDetails?.noticeToExecution ?? "0分",
      noticeType: staticDetails?.noticeType ?? dynamicDetails?.noticeType,
      note,
    },
  };
}

function matchesRejected(item: WindowEventLike, rejectedSignals: Array<RejectedTiboResetSignal>) {
  return rejectedSignals.some((signal) => {
    const itemTweetId = getTweetId(item.source_url);
    const signalTweetId = getTweetId(signal.tweet_url);
    if (itemTweetId && signalTweetId && itemTweetId === signalTweetId) return true;
    if (item.source_url && item.source_url === signal.tweet_url) return true;

    // A rejected Tibo signal can only suppress a canonical regular row when
    // its identity explicitly matches. Time-only proximity belongs to Tibo
    // candidates and must not erase an independently observed regular reset.
    if (
      item.recordKind === "regular_completed" &&
      item.details?.cycleType === "定期リセット"
    ) {
      return false;
    }

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

function mergePersistedRegularEvents(
  staticHistory: Array<WindowEventLike>,
  regularRows: Array<RegularResetEventRow>,
) {
  const result = [...staticHistory];

  for (const row of regularRows) {
    const persisted = toRegularResetHistoryEvent(row);
    const persistedTime = getTimestamp(getCompletedAt(persisted));
    const duplicateIndex = result.findIndex((item) => {
      if (item.details?.cycleType !== "定期リセット") return false;
      const itemTime = getTimestamp(getCompletedAt(item));
      return itemTime !== null && persistedTime !== null && itemTime === persistedTime;
    });

    if (row.status === "voided") {
      if (duplicateIndex !== -1) result.splice(duplicateIndex, 1);
      continue;
    }

    if (duplicateIndex === -1) {
      result.push(persisted);
      continue;
    }

    const merged = mergeDuplicateHistory(persisted, result[duplicateIndex]);
    result[duplicateIndex] = {
      ...merged,
      ...persisted,
      id: persisted.id,
      recordKind: "regular_completed",
      title: result[duplicateIndex].title ?? persisted.title,
      summary: result[duplicateIndex].summary ?? persisted.summary,
      source_url: result[duplicateIndex].source_url ?? persisted.source_url,
      details: {
        ...merged.details!,
        note: result[duplicateIndex].details?.note ?? merged.details?.note,
      },
    };
  }

  return result;
}

export type CodexRecoveryObservationInput = Partial<
  Pick<
    CodexRecoveryObservation,
    | "id"
    | "observedAt"
    | "previousObservedAt"
    | "previousUsedPercent"
    | "currentUsedPercent"
    | "previousResetsAt"
    | "currentResetsAt"
    | "cycleHint"
    | "confidence"
    | "status"
    | "matchedTiboTweetId"
  >
>;

export type NoticeBackedHistoryData = Pick<
  RadarData,
  | "active_tibo_signals"
  | "recent_tibo_signals"
  | "codex_usage_recovery"
  | "codex_recovery_observations"
  | "reset_execution_estimates"
>;

export function collectOfficialTiboNoticeSignals(
  recentSignals: ReadonlyArray<ActiveTiboSignal | FormalTiboResetSignal> = [],
  activeSignals: ReadonlyArray<ActiveTiboSignal | FormalTiboResetSignal> = [],
): TiboNoticeSignal[] {
  const seen = new Set<string>();
  const result: TiboNoticeSignal[] = [];

  for (const signal of expandTiboSignalVariants([...recentSignals, ...activeSignals])) {
    if (
      signal.signal_type !== "official_notice" ||
      signal.is_reply === true
    ) {
      continue;
    }

    if (seen.has(signal.tweet_id)) {
      const existingIndex = result.findIndex((candidate) => candidate.tweet_id === signal.tweet_id);
      if (existingIndex !== -1 && result[existingIndex].confidence === null && signal.confidence != null) {
        result[existingIndex] = {
          ...result[existingIndex],
          confidence: signal.confidence,
        };
      }
      continue;
    }

    seen.add(signal.tweet_id);
    result.push({
      tweet_id: signal.tweet_id,
      text: signal.text ?? "",
      tweet_url: signal.tweet_url ?? "",
      tweet_created_at: signal.tweet_created_at,
      signal_type: "official_notice",
      confidence: signal.confidence ?? null,
      verification_status: signal.verification_status ?? "auto_unverified",
      expires_at: signal.expires_at ?? null,
      ai_temporal_expression: signal.ai_temporal_expression ?? null,
      ai_temporal_kind: signal.ai_temporal_kind ?? null,
      ai_temporal_precision: signal.ai_temporal_precision ?? null,
      ai_temporal_timezone: signal.ai_temporal_timezone ?? null,
      temporal_expression: signal.temporal_expression ?? null,
      temporal_kind: signal.temporal_kind ?? null,
      temporal_precision: signal.temporal_precision ?? null,
      temporal_timezone: signal.temporal_timezone ?? null,
      temporal_confidence: signal.temporal_confidence ?? null,
      temporal_resolution_source: signal.temporal_resolution_source ?? null,
      expected_start_at: signal.expected_start_at ?? null,
      expected_end_at: signal.expected_end_at ?? null,
      temporal_resolution_status: signal.temporal_resolution_status ?? null,
    });
  }

  return result;
}

export function collectBankedDistributionSignals(
  recentSignals: ReadonlyArray<ActiveTiboSignal | FormalTiboResetSignal> = [],
  activeSignals: ReadonlyArray<ActiveTiboSignal | FormalTiboResetSignal> = [],
): BankedDistributionSignal[] {
  const officialNotices = collectOfficialTiboNoticeSignals(recentSignals, activeSignals);
  const seen = new Set(officialNotices.map((signal) => signal.tweet_id));
  const completions: BankedDistributionCompletionSignal[] = [];

  for (const signal of [...recentSignals, ...activeSignals]) {
    if (
      seen.has(signal.tweet_id) ||
      signal.is_reply === true ||
      signal.verification_status === "rejected" ||
      !isBankedDistributionCompletionSignal(signal.text)
    ) {
      continue;
    }

    seen.add(signal.tweet_id);
    completions.push({
      tweet_id: signal.tweet_id,
      text: signal.text ?? "",
      tweet_url: signal.tweet_url ?? "",
      tweet_created_at: signal.tweet_created_at,
      signal_type: "irrelevant",
      confidence: signal.confidence ?? null,
      verification_status: signal.verification_status ?? "auto_unverified",
      is_reply: signal.is_reply ?? null,
    });
  }

  return [...officialNotices, ...completions].sort((left, right) => {
    const timeDifference =
      (getTimestamp(left.tweet_created_at) ?? 0) - (getTimestamp(right.tweet_created_at) ?? 0);
    return timeDifference || left.tweet_id.localeCompare(right.tweet_id);
  });
}

export function getNoticeBackedHistoryInputs(data: NoticeBackedHistoryData | null | undefined) {
  const recoveryObservations = [
    ...(data?.codex_recovery_observations ?? []),
    ...(data?.codex_usage_recovery ? [data.codex_usage_recovery] : []),
  ].filter((observation, index, all) => {
    const key = observation.id ?? `${observation.observedAt}:${observation.currentResetsAt}`;
    return all.findIndex((candidate) =>
      (candidate.id ?? `${candidate.observedAt}:${candidate.currentResetsAt}`) === key,
    ) === index;
  });

  return {
    noticeSignals: collectOfficialTiboNoticeSignals(
      data?.recent_tibo_signals ?? [],
      data?.active_tibo_signals ?? [],
    ),
    bankedSignals: collectBankedDistributionSignals(
      data?.recent_tibo_signals ?? [],
      data?.active_tibo_signals ?? [],
    ),
    recoveryObservations,
    estimates: data?.reset_execution_estimates ?? [],
  };
}

function isValidNoticeBackedEstimate(estimate: ResetExecutionEstimate) {
  const displayExecutionAt = getTimestamp(estimate.displayExecutionAt);
  const windowStartAt = getTimestamp(estimate.executionWindowStartAt);
  const windowEndAt = getTimestamp(estimate.executionWindowEndAt);
  const officialNoticeTweetId = estimate.officialNoticeTweetId?.trim();
  const recoveryObservationId = estimate.recoveryObservationId?.trim();

  return Boolean(
    estimate.executionTimeSource === "usage_observation" &&
      estimate.executionTimeConfidence === "high" &&
      estimate.executionTimePrecision === "approximate" &&
      recoveryObservationId &&
      officialNoticeTweetId &&
      displayExecutionAt !== null &&
      windowStartAt !== null &&
      windowEndAt !== null &&
      windowStartAt < windowEndAt &&
      displayExecutionAt === windowEndAt &&
    estimate.tiboSourceTweetIds.includes(officialNoticeTweetId),
  );
}

function isValidSupportingRecoveryObservation(
  observation: CodexRecoveryObservationInput | undefined,
) {
  if (!observation) return true;
  const observedAt = getTimestamp(observation.observedAt);
  const previousObservedAt = getTimestamp(observation.previousObservedAt);
  return Boolean(
    observation.confidence === "strong" &&
      observation.cycleHint !== "regular" &&
      observation.status !== "rejected" &&
      observedAt !== null &&
      previousObservedAt !== null &&
      previousObservedAt < observedAt,
  );
}

export function getNoticeBackedRecoveryObservationIds(
  estimates: ReadonlyArray<ResetExecutionEstimate> = [],
) {
  return new Set(
    estimates
      .filter(isValidNoticeBackedEstimate)
      .map((estimate) => estimate.recoveryObservationId!)
      .filter(Boolean),
  );
}

export function isNoticeBackedRecoveryEvent(item: WindowEventLike) {
  return item.presentation === NOTICE_BACKED_RECOVERY_PRESENTATION;
}

function buildNoticeBackedRecoveryEvent(
  estimate: ResetExecutionEstimate,
  noticeSignals: ReadonlyArray<TiboNoticeSignal | FormalTiboResetSignal>,
  recoveryObservations: ReadonlyArray<CodexRecoveryObservationInput>,
): WindowEventLike | null {
  if (!isValidNoticeBackedEstimate(estimate)) return null;

  const recoveryObservationId = estimate.recoveryObservationId;
  if (!recoveryObservationId) return null;

  const recoveryObservation = recoveryObservations.find(
    (observation) => observation.id === recoveryObservationId,
  );
  if (!isValidSupportingRecoveryObservation(recoveryObservation)) return null;

  const officialNoticeTweetId = estimate.officialNoticeTweetId;
  if (!officialNoticeTweetId) return null;
  const notice = noticeSignals.find(
    (signal) => signal.signal_type === "official_notice" && signal.tweet_id === officialNoticeTweetId,
  );
  const openedAt =
    getTimestamp(estimate.tiboAnnouncedAt) !== null
      ? new Date(estimate.tiboAnnouncedAt!).toISOString()
      : getTimestamp(estimate.officialNoticeAt) !== null
        ? new Date(estimate.officialNoticeAt!).toISOString()
        : new Date(getTimestamp(estimate.executionWindowStartAt)!).toISOString();
  const completedAt = new Date(getTimestamp(estimate.displayExecutionAt)!).toISOString();
  const noticeMinutes = Math.max(
    0,
    Math.round((getTimestamp(completedAt)! - getTimestamp(openedAt)!) / 60000),
  );
  const sourceUrl = notice?.tweet_url || `https://x.com/thsottiaux/status/${officialNoticeTweetId}`;
  const sourceTweetIds = sortTweetIdsChronologically([
    ...estimate.tiboSourceTweetIds,
    officialNoticeTweetId,
  ], noticeSignals.filter((signal): signal is TiboNoticeSignal =>
    signal.signal_type === "official_notice" &&
    estimate.tiboSourceTweetIds.includes(signal.tweet_id),
  ));

  return {
    id: estimate.resetEventKey,
    recordKind: "confirmed_global",
    presentation: NOTICE_BACKED_RECOVERY_PRESENTATION,
    title: getNoticeBackedRecoveryTitle(estimate.resetEventKey),
    kind: "reset_completed",
    status: "closed",
    opened_at: openedAt,
    closed_at: completedAt,
    completed_at: completedAt,
    window_minutes: noticeMinutes,
    scope: "全有料プラン",
    summary: getNoticeBackedRecoveryHistorySummary(estimate.resetEventKey),
    source_url: sourceUrl,
    sourceKind: "direct_post",
    sourceTweetIds,
    officialNoticeTweetId,
    recoveryObservationId,
    details: {
      cycleType: "ランダムリセット",
      reasonType: getNoticeBackedRecoveryReasonType(estimate.resetEventKey),
      resetMethod: "強制リセット",
      scope: "全有料プラン",
      noticeToExecution: formatNoticeToExecution(noticeMinutes),
      noticeType: "公式予告あり",
      note: getNoticeBackedRecoveryHistorySummary(estimate.resetEventKey),
    },
  };
}

export function findNoticeBackedRecoveryEvents(
  noticeSignals: Array<TiboNoticeSignal | FormalTiboResetSignal>,
  recoveryObservations: Array<CodexRecoveryObservationInput>,
  estimates: Array<ResetExecutionEstimate> = [],
): Array<WindowEventLike> {
  const seen = new Set<string>();
  return estimates.flatMap((estimate) => {
    if (seen.has(estimate.resetEventKey)) return [];
    seen.add(estimate.resetEventKey);
    const event = buildNoticeBackedRecoveryEvent(
      estimate,
      noticeSignals,
      recoveryObservations,
    );
    return event ? [event] : [];
  });
}

function buildBankedDistributionEvent(
  estimate: ResetExecutionEstimate,
  notice: TiboNoticeSignal,
  relatedNotices: ReadonlyArray<BankedDistributionSignal> = [],
): WindowEventLike | null {
  const displayTime = getTimestamp(estimate.displayExecutionAt);
  const noticeTime = getTimestamp(notice.tweet_created_at);
  const firstAnnouncementTime = getTimestamp(estimate.tiboAnnouncedAt) ?? noticeTime;
  const isUsageObservationEstimate =
    estimate.executionTimeSource === "usage_observation" &&
    estimate.executionTimePrecision === "approximate" &&
    estimate.executionTimeConfidence === "high";
  const isManualOverrideEstimate =
    estimate.executionTimeSource === "manual_override" &&
    (estimate.executionTimePrecision === "approximate" || estimate.executionTimePrecision === "exact") &&
    estimate.executionTimeConfidence === "high" &&
    estimate.manualExecutionAt &&
    getTimestamp(estimate.manualOverrideAt) !== null &&
    estimate.manualOverrideReason?.trim() &&
    estimate.manualExecutionPrecision &&
    (estimate.manualExecutionPrecision === "approximate" || estimate.manualExecutionPrecision === "exact") &&
    getTimestamp(estimate.manualExecutionAt) === displayTime;
  if (
    estimate.estimatorVersion !== BANKED_DISTRIBUTION_ESTIMATOR_VERSION ||
    (!isUsageObservationEstimate && !isManualOverrideEstimate) ||
    estimate.recoveryObservationId ||
    !estimate.officialNoticeTweetId ||
    estimate.officialNoticeTweetId !== notice.tweet_id ||
    !estimate.tiboSourceTweetIds.includes(notice.tweet_id) ||
    notice.signal_type !== "official_notice" ||
    notice.verification_status === "rejected" ||
    (notice.confidence ?? 0) < FORMAL_RESET_CONFIDENCE ||
    !isBroadBankedDistributionNotice(notice.text) ||
    displayTime === null ||
    noticeTime === null ||
    firstAnnouncementTime === null ||
    displayTime < firstAnnouncementTime
  ) {
    return null;
  }

  const openedAt = new Date(firstAnnouncementTime).toISOString();
  const completedAt = new Date(displayTime).toISOString();
  const noticeMinutes = Math.max(0, Math.round((displayTime - firstAnnouncementTime) / 60000));
  const summary = "任意リセット権の配布が確認されました。";

  return {
    id: estimate.resetEventKey,
    recordKind: "banked_distribution",
    title: "ランダムリセット",
    kind: "reset_completed",
    status: "closed",
    opened_at: openedAt,
    closed_at: completedAt,
    completed_at: completedAt,
    window_minutes: noticeMinutes,
    scope: "全有料プラン",
    summary,
    source_url: notice.tweet_url,
    sourceKind: "direct_post",
    sourceTweetIds: sortTweetIdsChronologically([
      ...estimate.tiboSourceTweetIds,
      notice.tweet_id,
    ], relatedNotices),
    officialNoticeTweetId: notice.tweet_id,
    details: {
      cycleType: "ランダムリセット",
      reasonType: "ご祝儀リセット",
      resetMethod: "任意リセット権配布",
      scope: "全有料プラン",
      noticeToExecution: formatNoticeToExecution(noticeMinutes),
      noticeType: "公式予告あり",
      note: summary,
    },
  };
}

export function findBankedDistributionEvents(
  noticeSignals: ReadonlyArray<BankedDistributionSignal>,
  estimates: Array<ResetExecutionEstimate> = [],
): Array<WindowEventLike> {
  const seen = new Set<string>();
  return estimates.flatMap((estimate) => {
    if (seen.has(estimate.resetEventKey)) return [];
    seen.add(estimate.resetEventKey);
    const notice = noticeSignals.find((signal): signal is TiboNoticeSignal =>
      signal.signal_type === "official_notice" &&
      signal.tweet_id === estimate.officialNoticeTweetId,
    );
    const relatedNotices = noticeSignals.filter((signal) =>
      estimate.tiboSourceTweetIds.includes(signal.tweet_id),
    );
    const event = notice ? buildBankedDistributionEvent(estimate, notice, relatedNotices) : null;
    return event ? [event] : [];
  });
}

export function combineResetHistory(
  staticHistory: Array<WindowEventLike>,
  formalTiboResets: Array<FormalTiboResetSignal>,
  rejectedTiboResets: Array<RejectedTiboResetSignal> = [],
  regularResetRows: Array<RegularResetEventRow> = [],
  noticeSignals: Array<TiboNoticeSignal | FormalTiboResetSignal> = [],
  recoveryObservations: Array<CodexRecoveryObservationInput> = [],
  estimates: Array<ResetExecutionEstimate> = [],
  bankedSignals: ReadonlyArray<BankedDistributionSignal> = [],
) {
  const formalSignals = formalTiboResets
    .filter((signal) => signal.is_reply !== true && isFormalTiboResetSignal(signal));
  const tiboItems = clusterFormalTiboResetSignals(formalSignals);
  const noticeBackedEvents = findNoticeBackedRecoveryEvents(
    noticeSignals,
    recoveryObservations,
    estimates,
  );
  const fallbackBankedSignals = noticeSignals.filter(
    (signal): signal is TiboNoticeSignal => signal.signal_type === "official_notice",
  );
  const bankedDistributionEvents = findBankedDistributionEvents(
    bankedSignals.length > 0 ? bankedSignals : fallbackBankedSignals,
    estimates,
  );

  const dynamicItems: Array<WindowEventLike> = [];
  for (const noticeEvent of noticeBackedEvents) {
    const matchingTiboIndex = tiboItems.findIndex((tiboEvent) => isSameReset(noticeEvent, tiboEvent));
    if (matchingTiboIndex !== -1) {
      const merged = mergeDuplicateHistory(tiboItems[matchingTiboIndex], noticeEvent);
      // Preserve notice-backed recovery canonical execution time (observedAt) & title/summary
      dynamicItems.push({
        ...merged,
        closed_at: noticeEvent.closed_at,
        completed_at: noticeEvent.completed_at,
        title: noticeEvent.title ?? merged.title,
        summary: noticeEvent.summary ?? merged.summary,
      });
      tiboItems.splice(matchingTiboIndex, 1);
    } else {
      dynamicItems.push(noticeEvent);
    }
  }
  dynamicItems.push(...bankedDistributionEvents);
  dynamicItems.push(...tiboItems);

  const regularMergedHistory = mergePersistedRegularEvents(staticHistory, regularResetRows);
  const filteredStaticHistory = regularMergedHistory.filter((item) => !matchesRejected(item, rejectedTiboResets));
  const combined: Array<WindowEventLike> = [...dynamicItems];
  const matchedDynamicIndexes = new Set<number>();

  // Keep legacy static records intact. Only a dynamic Tibo record may merge with one static record.
  for (const item of filteredStaticHistory) {
    const duplicateIndex = dynamicItems.findIndex(
      (dynamicItem, index) =>
        !matchedDynamicIndexes.has(index) && isSameReset(dynamicItem, item),
    );
    if (duplicateIndex === -1) {
      combined.push(item);
    } else {
      combined[duplicateIndex] = mergeDuplicateHistory(combined[duplicateIndex], item);
      matchedDynamicIndexes.add(duplicateIndex);
    }
  }

  return combined;
}
