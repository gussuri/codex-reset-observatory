import type { ActiveTiboSignal, RadarData, WindowEventLike } from "./types";
import type { TeaserStrength } from "./teaserStrength";
import type { TemporalKind, TemporalPrecision, TemporalResolutionStatus } from "./tiboTemporal";
import type { CodexRecoveryObservation } from "../codexUsageRecovery";
import type { ResetExecutionEstimate } from "./resetExecution";
import {
  toRegularResetHistoryEvent,
  type RegularResetEventRow,
} from "./regularResetSchedule";
import { isBroadResetScope } from "./resetEligibility";
import { isTemporalNoticeConsumedAtReset } from "./tiboTemporal";

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
  expires_at?: string | null;
  ai_temporal_precision?: TemporalPrecision | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
  temporal_resolution_status?: TemporalResolutionStatus | null;
};

export const NOTICE_BACKED_RECOVERY_PRESENTATION = "notice_backed_recovery" as const;
export const NOTICE_BACKED_RECOVERY_TITLE_KEY = "noticeBackedRecoveryTitle";
export const NOTICE_BACKED_RECOVERY_BODY_KEY = "noticeBackedRecoveryBody";

const NOTICE_BACKED_RECOVERY_FALLBACK_SUMMARY = "Codexの利用枠がリセットされました。";
const NOTICE_BACKED_RECOVERY_SUMMARIES: Readonly<Record<string, string>> = {
  "tibo-reset-2087706104814023111":
    "Codexのアクティブユーザー数1500万人突破を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
};
const NOTICE_BACKED_RECOVERY_REASON_TYPES: Readonly<Record<string, string>> = {
  "tibo-reset-2087706104814023111": "ご祝儀リセット",
};

export function getNoticeBackedRecoveryHistorySummary(resetEventKey: string) {
  return NOTICE_BACKED_RECOVERY_SUMMARIES[resetEventKey] ?? NOTICE_BACKED_RECOVERY_FALLBACK_SUMMARY;
}

function getNoticeBackedRecoveryReasonType(resetEventKey: string) {
  return NOTICE_BACKED_RECOVERY_REASON_TYPES[resetEventKey] ?? "ランダムリセット";
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
  classification_source?: TiboClassificationSource | null;
  rule_signal_type?: TiboSignalType | null;
  ai_signal_type?: TiboSignalType | null;
  ai_classification_status?: string | null;
  ai_reset_type_ja?: string | null;
  ai_notice_to_execution?: string | null;
  ai_teaser_strength?: TeaserStrength | null;
  ai_teaser_strength_confidence?: number | null;
  ai_teaser_strength_evidence_quote?: string | null;
  ai_teaser_strength_reason_ja?: string | null;
  ai_temporal_expression?: string | null;
  ai_temporal_kind?: TemporalKind | null;
  ai_temporal_precision?: TemporalPrecision | null;
  ai_temporal_timezone?: string | null;
  ai_temporal_confidence?: number | null;
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
  if (signal.is_reply === true) return false;
  if (signal.signal_type !== "reset_executed") return false;
  if ((signal.confidence ?? 0) < FORMAL_RESET_CONFIDENCE) return false;
  if (signal.verification_status === "rejected") return false;
  if (!getTimestamp(signal.tweet_created_at)) return false;

  return (
    signal.verification_status === "confirmed" ||
    signal.classification_source === "gemini" ||
    RULE_BACKED_CLASSIFICATION_SOURCES.has(signal.classification_source ?? "")
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
    const hasResolvedSchedule = signal.signal_type === "official_notice" &&
      signal.temporal_resolution_status === "resolved" &&
      getTimestamp(signal.expected_start_at) !== null;
    const matchesResolvedSchedule = hasResolvedSchedule
      ? isTemporalNoticeConsumedAtReset(
          {
            status: "resolved",
            temporalPrecision: signal.ai_temporal_precision ?? "unknown",
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
  completedAtOverride?: string,
): WindowEventLike {
  const completedAt = new Date(completedAtOverride ?? signal.tweet_created_at).toISOString();
  const noticeAt = relatedNotice
    ? new Date(relatedNotice.tweet_created_at).toISOString()
    : completedAt;
  const noticeMinutes = relatedNotice
    ? Math.max(0, Math.round((getTimestamp(signal.tweet_created_at)! - getTimestamp(relatedNotice.tweet_created_at)!) / 60000))
    : 0;
  const reasonType = getReasonType(signal);
  const cycleType = reasonType === "定期リセット" ? "定期リセット" : "ランダムリセット";
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
    ...(relatedNotice ? { officialNoticeTweetId: relatedNotice.tweet_id } : {}),
    sourceTweetIds: [signal.tweet_id],
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
    const relatedNotice = representative.related_notice ??
      cluster.find((signal) => signal.related_notice)?.related_notice ??
      null;
    const sourceTweetIds = cluster
      .slice()
      .sort((left, right) => {
        const timeDifference =
          (getTimestamp(left.tweet_created_at) ?? 0) - (getTimestamp(right.tweet_created_at) ?? 0);
        return timeDifference || left.tweet_id.localeCompare(right.tweet_id);
      })
      .map((signal) => signal.tweet_id);

    return {
      ...convertTiboResetSignalToHistoryEvent(
        representative,
        relatedNotice,
        earliest.tweet_created_at,
      ),
      sourceTweetIds,
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

  for (const signal of [...recentSignals, ...activeSignals]) {
    if (
      signal.signal_type !== "official_notice" ||
      signal.is_reply === true ||
      seen.has(signal.tweet_id)
    ) {
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
      ai_temporal_precision: signal.ai_temporal_precision ?? null,
      expected_start_at: signal.expected_start_at ?? null,
      expected_end_at: signal.expected_end_at ?? null,
      temporal_resolution_status: signal.temporal_resolution_status ?? null,
    });
  }

  return result;
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
    getTimestamp(estimate.officialNoticeAt) !== null
      ? new Date(estimate.officialNoticeAt!).toISOString()
      : getTimestamp(estimate.tiboAnnouncedAt) !== null
        ? new Date(estimate.tiboAnnouncedAt!).toISOString()
        : new Date(getTimestamp(estimate.executionWindowStartAt)!).toISOString();
  const completedAt = new Date(getTimestamp(estimate.displayExecutionAt)!).toISOString();
  const noticeMinutes = Math.max(
    0,
    Math.round((getTimestamp(completedAt)! - getTimestamp(openedAt)!) / 60000),
  );
  const sourceUrl = notice?.tweet_url || `https://x.com/thsottiaux/status/${officialNoticeTweetId}`;
  const sourceTweetIds = Array.from(new Set([
    ...estimate.tiboSourceTweetIds,
    officialNoticeTweetId,
  ]));

  return {
    id: estimate.resetEventKey,
    recordKind: "confirmed_global",
    presentation: NOTICE_BACKED_RECOVERY_PRESENTATION,
    title: "全体リセット完了",
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

export function combineResetHistory(
  staticHistory: Array<WindowEventLike>,
  formalTiboResets: Array<FormalTiboResetSignal>,
  rejectedTiboResets: Array<RejectedTiboResetSignal> = [],
  regularResetRows: Array<RegularResetEventRow> = [],
  noticeSignals: Array<TiboNoticeSignal | FormalTiboResetSignal> = [],
  recoveryObservations: Array<CodexRecoveryObservationInput> = [],
  estimates: Array<ResetExecutionEstimate> = [],
) {
  const formalSignals = formalTiboResets
    .filter((signal) => signal.is_reply !== true && isFormalTiboResetSignal(signal));
  const tiboItems = clusterFormalTiboResetSignals(formalSignals);
  const noticeBackedEvents = findNoticeBackedRecoveryEvents(
    noticeSignals,
    recoveryObservations,
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
