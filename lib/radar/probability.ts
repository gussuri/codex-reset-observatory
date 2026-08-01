import { LOCAL_OBSERVATION_SIGNALS, type LocalObservationSignal } from "@/data/observationSignals";
import {
  AUTOMATED_TIBO_SIGNAL_WEIGHTS,
  LOCAL_PROBABILITY_WEIGHTS,
  TIBO_TEASER_DECAY_HOURS,
} from "@/data/predictionWeights";
import { LOCAL_RESET_HISTORY } from "@/data/resetHistory";
import type { OpenAIStatusSignals } from "@/lib/openaiStatus";
import type { Locale, RadarData, WindowEventLike } from "./types";
import { translateDynamic } from "./i18n";
import {
  deriveComplaintPressure,
  evaluateStatusIncidents,
  formatStatusIncidentReason,
  type StatusIncidentEvaluation,
} from "./signalEvaluation";
import {
  getCalendarDayDelta,
  getLatestIsoDate,
  isWithinHours,
  getDateTime,
  probabilityToPercent,
  getExpectationLabel,
} from "./helpers";
import {
  combineResetHistory,
  convertTiboResetSignalToHistoryEvent,
  isFormalTiboResetSignal,
} from "./tiboHistory";

export type LocalSignalEvaluation = {
  environment: NonNullable<RadarData["codex_environment"]>;
  statusIncidents: StatusIncidentEvaluation;
  complaintPressure: ReturnType<typeof deriveComplaintPressure>;
  latestResetAt: Date | null;
};

export type ActiveOfficialNotice = {
  origin: "dynamic" | "local";
  id: string;
  title: string | null;
  summary: string | null;
  observedAt: string;
  expectedAt: string | null;
  expectedEndAt: string | null;
  expiresAt: string | null;
  source: string | null;
  sourceLabel: string;
};

export function getLocalResetProbability(
  data: RadarData | null,
  period: "24h" | "48h",
  signalEvaluation?: LocalSignalEvaluation,
  activeOfficialNotice?: ActiveOfficialNotice | null,
  now: Date = new Date(),
  regularResetExpectedAt?: string | null,
): number {
  const resolvedSignalEvaluation = signalEvaluation ?? getLocalSignalEvaluation(data, now);
  const resolvedOfficialNotice = activeOfficialNotice === undefined
    ? getActiveOfficialNotice(data, resolvedSignalEvaluation.latestResetAt, now)
    : activeOfficialNotice;
  const probability = calculateLocalResetProbability(
    data,
    period,
    resolvedSignalEvaluation,
    resolvedOfficialNotice,
    now,
    regularResetExpectedAt,
  );

  if (period === "48h") {
    const probability24h = calculateLocalResetProbability(
      data,
      "24h",
      resolvedSignalEvaluation,
      resolvedOfficialNotice,
      now,
      regularResetExpectedAt,
    );
    return Math.max(probability24h, probability);
  }

  return probability;
}

function calculateLocalResetProbability(
  data: RadarData | null,
  period: "24h" | "48h",
  signalEvaluation: LocalSignalEvaluation,
  activeOfficialNotice: ActiveOfficialNotice | null,
  now: Date,
  regularResetExpectedAt?: string | null,
): number {
  const weightKey = period === "24h" ? "within24h" : "within48h";
  const tiboSignals = [
    ...(data?.active_tibo_signals ?? []),
    ...(data?.formal_tibo_resets ?? []),
  ];

  // 1. Sort active Tibo signals by tweet_created_at ascending for time-ordered evaluation
  const sortedSignals = (tiboSignals ?? [])
    .slice()
    .sort((a, b) => new Date(a.tweet_created_at).getTime() - new Date(b.tweet_created_at).getTime());

  // 2. Find latest valid reset_executed signal (confidence >= 0.95)
  const latestExecutionAt = getLatestAcceptedTiboExecutionAt(data);
  const executionTime = latestExecutionAt?.getTime() ?? 0;

  const validTeaser = sortedSignals.find(
    (s) =>
      s.signal_type === "teaser" &&
      (s.confidence ?? 0) >= 0.80 &&
      new Date(s.tweet_created_at).getTime() > executionTime
  );

  // A normalized active official notice drives Notice Mode (24h: 90%, 48h: 96%).
  if (activeOfficialNotice) {
    return LOCAL_PROBABILITY_WEIGHTS.officialNotice[weightKey];
  }

  const environment = signalEvaluation.environment;
  const statusIncidents = signalEvaluation.statusIncidents.weightedStatusScore;
  const officialIncidentHints = clampCount(
    environment?.official_incident_hints_24h,
    0,
    LOCAL_PROBABILITY_WEIGHTS.countLimits.officialIncidentHints,
  );
  const officialUpdates = clampCount(
    environment?.official_updates_24h,
    0,
    LOCAL_PROBABILITY_WEIGHTS.countLimits.officialUpdates,
  );
  const communityMentions = clampCount(
    environment?.community_mentions_24h,
    0,
    LOCAL_PROBABILITY_WEIGHTS.countLimits.communityMentions,
  );
  const issueAnomalies = clampCount(
    environment?.issue_or_limit_anomalies_24h,
    0,
    LOCAL_PROBABILITY_WEIGHTS.countLimits.issueAnomalies,
  );
  const complaintPressure = signalEvaluation.complaintPressure.level;
  const pressureBoost =
    complaintPressure === "high"
      ? LOCAL_PROBABILITY_WEIGHTS.pressureBoost.high
      : complaintPressure === "medium"
        ? LOCAL_PROBABILITY_WEIGHTS.pressureBoost.medium
        : LOCAL_PROBABILITY_WEIGHTS.pressureBoost.low;

  const base = LOCAL_PROBABILITY_WEIGHTS.base[weightKey];

  // 期間限定のイベントブースト（確率底上げ）を収集して加算
  const activeBoostSignals = LOCAL_OBSERVATION_SIGNALS.filter(
    (signal) =>
      (signal.type === "probability_boost" ||
        typeof signal.boostValue24h === "number" ||
        typeof signal.boostValue48h === "number" ||
        typeof signal.boostValue === "number") &&
      isCurrentLocalSignal(signal, now)
  );

  let eventBoost = activeBoostSignals.reduce((sum, sig) => {
    const boost = period === "24h"
      ? (sig.boostValue24h ?? sig.boostValue ?? 0)
      : (sig.boostValue48h ?? sig.boostValue ?? 0);

    const decayFactor = typeof sig.boostDecayHours === "number"
      ? getTeaserDecayFactor(sig.observedAt, now, sig.boostDecayHours)
      : 1;

    return sum + boost * decayFactor;
  }, 0);

  // If valid time-ordered teaser exists (confidence >= 0.80) and no local teaser boost signal is already applied, add automated teaser boost
  if (validTeaser && activeBoostSignals.length === 0) {
    eventBoost += getTeaserBoost(period, validTeaser.tweet_created_at, now);
  }

  const hasActiveTeaserOrEventBoost = activeBoostSignals.length > 0 || Boolean(validTeaser);

  const score =
    base +
    getMomentumBoost(period, data) +
    (hasActiveTeaserOrEventBoost ? getLocalHistoryPressure(period, data) : 0) +
    getElapsedDayBoost(data) +
    getHistoricalResetPressure(period, data, now) +
    getRegularResetProximityBoost(period, regularResetExpectedAt, now) +
    statusIncidents *
      LOCAL_PROBABILITY_WEIGHTS.signalWeights.statusIncident[weightKey] +
    officialIncidentHints *
      LOCAL_PROBABILITY_WEIGHTS.signalWeights.officialIncidentHint[weightKey] +
    officialUpdates *
      LOCAL_PROBABILITY_WEIGHTS.signalWeights.officialUpdate[weightKey] +
    communityMentions *
      LOCAL_PROBABILITY_WEIGHTS.signalWeights.communityMention[weightKey] +
    issueAnomalies *
      LOCAL_PROBABILITY_WEIGHTS.signalWeights.issueAnomaly[weightKey] +
    pressureBoost +
    eventBoost;

  const minLimit =
    typeof LOCAL_PROBABILITY_WEIGHTS.min === "object"
      ? LOCAL_PROBABILITY_WEIGHTS.min[weightKey]
      : LOCAL_PROBABILITY_WEIGHTS.min;

  return Math.min(
    LOCAL_PROBABILITY_WEIGHTS.max[weightKey],
    Math.max(minLimit, score),
  );
}

export function getTeaserDecayFactor(
  observedAt: string,
  now: Date = new Date(),
  decayHours: number = TIBO_TEASER_DECAY_HOURS,
) {
  const observedTime = getDateTime(observedAt);
  if (observedTime <= 0 || !Number.isFinite(decayHours) || decayHours <= 0) {
    return 1;
  }

  const ageHours = (now.getTime() - observedTime) / (60 * 60 * 1000);
  if (ageHours <= 0) {
    return 1;
  }

  return Math.max(0, 1 - ageHours / decayHours);
}

export function getTeaserBoost(
  period: "24h" | "48h",
  observedAt: string,
  now: Date = new Date(),
) {
  const weightKey = period === "24h" ? "within24h" : "within48h";
  const baseBoost = AUTOMATED_TIBO_SIGNAL_WEIGHTS.teaser[weightKey];
  return baseBoost * getTeaserDecayFactor(observedAt, now);
}

export function getRegularResetProximityBoost(
  period: "24h" | "48h",
  expectedAt: string | null | undefined,
  now: Date = new Date(),
) {
  const expectedTime = getDateTime(expectedAt);
  if (!expectedTime || !Number.isFinite(now.getTime())) {
    return 0;
  }

  const hoursUntil = (expectedTime - now.getTime()) / (60 * 60 * 1000);
  if (hoursUntil < 0) {
    return 0;
  }

  const weight = LOCAL_PROBABILITY_WEIGHTS.regularResetProximity[
    period === "24h" ? "forecast24h" : "forecast48h"
  ];
  if (hoursUntil > weight.leadInHours) {
    return 0;
  }

  const progress = 1 - hoursUntil / weight.leadInHours;
  return weight.entry + (weight.max - weight.entry) * progress;
}

export function getHistoricalResetPressure(
  period: "24h" | "48h",
  data: RadarData | null,
  now: Date = new Date(),
) {
  const daysSinceLastReset = getDaysSinceLastGlobalReset(data, now);
  if (daysSinceLastReset === null) {
    return 0;
  }

  const intervals = getRandomResetIntervals(data, now);
  if (intervals.length === 0) {
    return 0;
  }

  const horizonDays = period === "24h" ? 1 : 2;
  const atRiskIntervals = intervals.filter((days) => days > daysSinceLastReset);
  if (atRiskIntervals.length === 0) {
    return 0;
  }

  const successfulIntervals = atRiskIntervals.filter(
    (days) => days <= daysSinceLastReset + horizonDays,
  ).length;
  const weight = LOCAL_PROBABILITY_WEIGHTS.historicalResetPressure[
    period === "24h" ? "forecast24h" : "forecast48h"
  ];
  const smoothedRate = (
    successfulIntervals + weight.priorRate * LOCAL_PROBABILITY_WEIGHTS.historicalResetPressure.priorWeight
  ) / (atRiskIntervals.length + LOCAL_PROBABILITY_WEIGHTS.historicalResetPressure.priorWeight);
  const excessRate = Math.max(0, smoothedRate - weight.priorRate);
  const normalizedExcess = excessRate / (1 - weight.priorRate);

  return Math.min(weight.maxBoost, normalizedExcess * weight.maxBoost);
}

function getRandomResetIntervals(data: RadarData | null, now: Date) {
  const dynamicHistory = (data?.formal_tibo_resets ?? [])
    .filter(isFormalTiboResetSignal)
    .map((signal) => convertTiboResetSignalToHistoryEvent(signal));
  const staticHistory = LOCAL_RESET_HISTORY.filter(
    (item) =>
      !data?.rejected_tibo_resets?.some((signal) => isRejectedHistoricalReset(item, signal)) &&
      !dynamicHistory.some((itemFromDynamicHistory) =>
        isDuplicateHistoricalReset(item, itemFromDynamicHistory),
      ),
  );
  const historicalItems = [...staticHistory, ...dynamicHistory];
  const resetTimes = historicalItems
    .filter((item) => {
      if (item.details?.cycleType !== "ランダムリセット") {
        return false;
      }
      if (item.details?.resetMethod === "任意リセット権1回配布") {
        return false;
      }

      const date = item.closed_at ?? item.completed_at ?? item.opened_at ?? item.date ?? null;
      const time = getDateTime(date);
      return time > 0 && time <= now.getTime();
    })
    .map((item) => getDateTime(item.closed_at ?? item.completed_at ?? item.opened_at ?? item.date ?? null))
    .sort((left, right) => left - right);

  return resetTimes.slice(1).map((time, index) =>
    (time - resetTimes[index]) / (24 * 60 * 60 * 1000),
  );
}

function getHistoricalResetTime(item: WindowEventLike) {
  return getDateTime(item.closed_at ?? item.completed_at ?? item.opened_at ?? item.date ?? null);
}

function getTweetId(sourceUrl: string | null | undefined) {
  return sourceUrl?.match(/\/status\/(\d+)/i)?.[1] ?? null;
}

function isDuplicateHistoricalReset(left: WindowEventLike, right: WindowEventLike) {
  const leftTweetId = getTweetId(left.source_url);
  const rightTweetId = getTweetId(right.source_url);
  if (leftTweetId && rightTweetId && leftTweetId === rightTweetId) {
    return true;
  }

  if (
    left.source_url &&
    right.source_url &&
    left.source_url === right.source_url &&
    left.source_url.includes("/status/")
  ) {
    return true;
  }

  const leftTime = getHistoricalResetTime(left);
  const rightTime = getHistoricalResetTime(right);
  return Boolean(
    (leftTweetId || rightTweetId) &&
    leftTime > 0 &&
    rightTime > 0 &&
    Math.abs(leftTime - rightTime) <= 5 * 60 * 1000,
  );
}

function isRejectedHistoricalReset(
  item: WindowEventLike,
  rejectedSignal: NonNullable<RadarData["rejected_tibo_resets"]>[number],
) {
  const itemTweetId = getTweetId(item.source_url);
  const signalTweetId = getTweetId(rejectedSignal.tweet_url);
  if (itemTweetId && signalTweetId && itemTweetId === signalTweetId) {
    return true;
  }

  if (item.source_url && item.source_url === rejectedSignal.tweet_url) {
    return true;
  }

  const itemTime = getHistoricalResetTime(item);
  const signalTime = getDateTime(rejectedSignal.tweet_created_at);
  return Boolean(
    item.details?.resetMethod === "強制リセット" &&
    itemTime > 0 &&
    signalTime > 0 &&
    Math.abs(itemTime - signalTime) <= 5 * 60 * 1000,
  );
}

export function getLocalSignalEnvironment(
  openAIStatus?: OpenAIStatusSignals | null,
): NonNullable<RadarData["codex_environment"]> {
  const recentSignals = LOCAL_OBSERVATION_SIGNALS.filter((signal) =>
    isCurrentLocalSignal(signal) && isWithinHours(signal.observedAt, 24),
  );
  const localStatusIncidents = recentSignals.filter(
    (signal) => signal.type === "status_incident",
  ).length;
  const officialIncidentHints = recentSignals.filter(
    (signal) => signal.type === "official_incident_hint",
  ).length;
  const officialUpdates = recentSignals.filter(
    (signal) => signal.type === "official_notice",
  ).length;
  const communityMentions = recentSignals.filter(
    (signal) => signal.type === "community_report",
  ).length;
  const issueAnomalies = recentSignals.filter(
    (signal) => signal.type === "limit_anomaly",
  ).length;
  const statusIncidents =
    localStatusIncidents + (openAIStatus?.statusIncidents24h ?? 0);
  const activeCodexIncidents = openAIStatus?.activeCodexIncidents ?? 0;
  const complaintPressure = deriveComplaintPressure({
    communityMentions,
    issueAnomalies,
    activeStatusIncidents: activeCodexIncidents,
    statusIncidents,
    officialIncidentHints,
  });

  // ここで getLocalModelUpdatedAt が必要だが循環参照を防ぐためにローカルで計算する
  const updatedCandidates = [
    openAIStatus?.updatedAt,
    ...LOCAL_OBSERVATION_SIGNALS.map((signal) => signal.observedAt),
    ...LOCAL_RESET_HISTORY.flatMap((item) => [
      item.closed_at,
      item.completed_at,
      item.opened_at,
      item.date,
    ]),
  ];
  const updatedAt = getLatestIsoDate(updatedCandidates) ?? new Date().toISOString();

  return {
    updated_at: updatedAt,
    status_incidents_24h: statusIncidents,
    official_incident_hints_24h: officialIncidentHints,
    official_updates_24h: officialUpdates,
    community_mentions_24h: communityMentions,
    issue_or_limit_anomalies_24h: issueAnomalies,
    complaint_pressure: complaintPressure.level,
    complaint_pressure_sources: complaintPressure.sources,
    openai_status_updated_at: openAIStatus?.updatedAt ?? null,
    openai_status_active_codex_incidents: activeCodexIncidents,
    openai_status_recent_codex_incidents:
      openAIStatus?.recentCodexIncidents ?? 0,
    openai_status_affected_codex_components:
      openAIStatus?.affectedCodexComponents ?? 0,
    openai_status_incidents_suppressed:
      openAIStatus?.suppressCodexIncidents ?? false,
    openai_status_latest_codex_incident:
      openAIStatus?.latestCodexIncidentName ?? null,
    reset_card: {
      status: "prediction_only",
    },
  };
}

export function getSignalEnvironment(
  data: RadarData | null,
): NonNullable<RadarData["codex_environment"]> {
  return data?.codex_environment ?? getLocalSignalEnvironment();
}

export function getLocalSignalEvaluation(
  data: RadarData | null,
  now: Date = new Date(),
): LocalSignalEvaluation {
  const environment = getSignalEnvironment(data);
  const latestResetAt = getLastGlobalResetAt(data);
  const localStatusSignals = LOCAL_OBSERVATION_SIGNALS.filter(
    (signal) =>
      signal.type === "status_incident" &&
      isCurrentLocalSignal(signal) &&
      isWithinHours(signal.observedAt, 24, now),
  );
  const statusIncidents = evaluateStatusIncidents({
    incidents: (data?.openai_status_history ?? []).filter(
      (item) => item.source === "openai_status",
    ),
    latestResetAt,
    now,
    suppressOpenAIIncidents:
      environment.openai_status_incidents_suppressed ?? false,
    affectedCodexComponents:
      environment.openai_status_affected_codex_components ?? 0,
    maxWeightedScore:
      LOCAL_PROBABILITY_WEIGHTS.countLimits.statusIncidents,
    localIncidents: localStatusSignals.map((signal) => ({
      id: signal.id,
      impact: "minor",
    })),
  });
  const complaintPressure = deriveComplaintPressure({
    communityMentions: environment.community_mentions_24h ?? 0,
    issueAnomalies: environment.issue_or_limit_anomalies_24h ?? 0,
    activeStatusIncidents: statusIncidents.activeStatusIncidentCount,
    statusIncidents: statusIncidents.includedIncidentCount,
    officialIncidentHints: environment.official_incident_hints_24h ?? 0,
  });

  return {
    environment,
    statusIncidents,
    complaintPressure,
    latestResetAt,
  };
}

export function getLatestActiveLocalSignal(
  type: LocalObservationSignal["type"],
  now: Date = new Date(),
) {
  return LOCAL_OBSERVATION_SIGNALS.filter(
    (signal) => signal.type === type && isCurrentLocalSignal(signal, now),
  )
    .sort((a, b) => getDateTime(b.observedAt) - getDateTime(a.observedAt))
    .at(0);
}

export function getEffectiveSignalStatus(
  signal: LocalObservationSignal,
  now: Date = new Date(),
) {
  const nowTime = now.getTime();
  if (signal.resolvedAt) {
    return "resolved";
  }

  // 1. 有効期限 (expiresAt) がすでに切れている場合は expired とする
  if (
    signal.status === "expired" ||
    (signal.status !== "resolved" &&
      signal.expiresAt &&
      getDateTime(signal.expiresAt) > 0 &&
      getDateTime(signal.expiresAt) <= nowTime)
  ) {
    return "expired";
  }

  // 2. 自動完了ロジック:
  // 予定時刻 (expectedAt) を過ぎている場合、通常は完了 (resolved) とする。
  // ただし、有効期限 (expiresAt) が未来である場合は、その期限までは active を維持する。
  if (
    signal.expectedAt &&
    getDateTime(signal.expectedAt) > 0 &&
    getDateTime(signal.expectedAt) <= nowTime
  ) {
    if (signal.expiresAt && getDateTime(signal.expiresAt) > nowTime) {
      return signal.status ?? "active";
    }
    return "resolved";
  }

  return signal.status ?? "active";
}

export function isCurrentLocalSignal(
  signal: LocalObservationSignal,
  now: Date = new Date(),
) {
  return getEffectiveSignalStatus(signal, now) === "active";
}

function getLatestAcceptedTiboExecutionAt(data: RadarData | null | undefined) {
  const executions = [
    ...(data?.active_tibo_signals ?? []),
    ...(data?.formal_tibo_resets ?? []),
  ].flatMap((signal) => {
    if (
      signal.signal_type !== "reset_executed" ||
      (signal.confidence ?? 0) < 0.95 ||
      signal.verification_status === "rejected"
    ) {
      return [];
    }

    const timestamp = new Date(signal.tweet_created_at).getTime();
    return Number.isNaN(timestamp) ? [] : [timestamp];
  });
  const latestTimestamp = Math.max(...executions, Number.NEGATIVE_INFINITY);

  return Number.isFinite(latestTimestamp) ? new Date(latestTimestamp) : null;
}

export function getActiveOfficialNotice(
  data: RadarData | null,
  latestResetAt: Date | null = getLastGlobalResetAt(data),
  now: Date = new Date(),
): ActiveOfficialNotice | null {
  const latestExecutionAt = getLatestAcceptedTiboExecutionAt(data);
  const cutoff = Math.max(
    latestResetAt?.getTime() ?? Number.NEGATIVE_INFINITY,
    latestExecutionAt?.getTime() ?? Number.NEGATIVE_INFINITY,
  );
  const dynamicNotices: Array<ActiveOfficialNotice> = (data?.active_tibo_signals ?? [])
    .flatMap((signal) => {
      if (
        signal.signal_type !== "official_notice" ||
        (signal.confidence ?? 0) < 0.95 ||
        signal.verification_status === "rejected"
      ) {
        return [];
      }

      const observedTime = new Date(signal.tweet_created_at).getTime();
      const expiresTime = signal.expires_at ? new Date(signal.expires_at).getTime() : Number.NaN;
      if (
        Number.isNaN(observedTime) ||
        Number.isNaN(expiresTime) ||
        expiresTime <= now.getTime() ||
        observedTime <= cutoff
      ) {
        return [];
      }

      return [{
        origin: "dynamic" as const,
        id: signal.tweet_id,
        title: signal.text ?? null,
        summary: signal.text ?? null,
        observedAt: signal.tweet_created_at,
        expectedAt: null,
        expectedEndAt: null,
        expiresAt: signal.expires_at ?? null,
        source: signal.tweet_url ?? null,
        sourceLabel: "Tibo (@tibo_maker)",
      }];
    });
  const localNotices = LOCAL_OBSERVATION_SIGNALS
    .filter(
      (signal) =>
        signal.type === "official_notice" &&
        isCurrentLocalSignal(signal, now) &&
        !Number.isNaN(new Date(signal.observedAt).getTime()),
    )
    .map((signal): ActiveOfficialNotice => ({
      origin: "local",
      id: signal.id,
      title: signal.title ?? null,
      summary: signal.title ?? null,
      observedAt: signal.observedAt,
      expectedAt: signal.expectedAt ?? null,
      expectedEndAt: signal.expectedEndAt ?? null,
      expiresAt: signal.expiresAt ?? null,
      source: signal.source ?? null,
      sourceLabel: signal.sourceLabel,
    }));

  return [...dynamicNotices, ...localNotices]
    .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime())
    .at(0) ?? null;
}

export function getRecent7DayResetCount(data?: RadarData | null): number {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const combinedHistory = combineResetHistory(
    LOCAL_RESET_HISTORY,
    data?.formal_tibo_resets ?? [],
    data?.rejected_tibo_resets ?? [],
  );

  return combinedHistory.filter((item) => {
    const resetMethod = item.details?.resetMethod;
    if (resetMethod === "任意リセット権1回配布") {
      return false;
    }
    const dateStr = item.completed_at ?? item.closed_at ?? item.opened_at ?? (item as any).date;
    if (!dateStr) return false;
    const time = new Date(dateStr).getTime();
    return !Number.isNaN(time) && time >= sevenDaysAgo && time <= now;
  }).length;
}

export function getMomentumBoost(period: "24h" | "48h", data?: RadarData | null): number {
  const count = getRecent7DayResetCount(data);
  const weightKey = period === "24h" ? "within24h" : "within48h";
  const daysSince = getDaysSinceLastGlobalReset(data);

  let rawBoost = 0;
  if (count >= 4) {
    rawBoost = LOCAL_PROBABILITY_WEIGHTS.momentumBoost.level2[weightKey];
  } else if (count === 3) {
    rawBoost = LOCAL_PROBABILITY_WEIGHTS.momentumBoost.level1[weightKey];
  }

  // 0〜1日目はクールダウン期のため、ラッシュ期ブーストを抑制する
  if (daysSince === 0) {
    return 0;
  }
  if (daysSince === 1) {
    return rawBoost * 0.5;
  }

  return rawBoost;
}

export function getLocalHistoryPressure(period: "24h" | "48h", data?: RadarData | null) {
  const daysSinceLastReset = getDaysSinceLastGlobalReset(data);
  if (daysSinceLastReset === null) {
    return 0;
  }

  const weightKey = period === "24h" ? "within24h" : "within48h";
  const pressure = LOCAL_PROBABILITY_WEIGHTS.historyPressure.find(
    (item) => daysSinceLastReset <= item.maxDaysSinceReset,
  );

  return pressure?.[weightKey] ?? 0;
}

export function getElapsedDayBoost(data?: RadarData | null) {
  const daysSinceLastReset = getDaysSinceLastGlobalReset(data);
  if (daysSinceLastReset === null) {
    return 0;
  }

  return daysSinceLastReset * LOCAL_PROBABILITY_WEIGHTS.elapsedDayBoost.perDay;
}

export function getDaysSinceLastGlobalReset(data?: RadarData | null, now: Date = new Date()) {
  const lastReset = getLastGlobalResetAt(data);
  if (!lastReset) {
    return null;
  }

  return Math.max(0, getCalendarDayDelta(now, lastReset));
}

export function getLastGlobalResetAt(data?: RadarData | null) {
  const combinedHistory = combineResetHistory(
    LOCAL_RESET_HISTORY,
    data?.formal_tibo_resets ?? [],
    data?.rejected_tibo_resets ?? [],
  );
  const candidates = combinedHistory.map((item) => {
    if ((item.kind === "window_opened" || item.status === "open") && !item.closed_at && !item.completed_at) {
      return null;
    }
    const resetMethod = item.details?.resetMethod;
    if (resetMethod === "任意リセット権1回配布") {
      return null;
    }
    return item.closed_at ?? item.completed_at ?? item.opened_at ?? (item as any).date ?? null;
  });

  const latestOfficialStr = getLatestIsoDate(candidates);
  const latestOfficialAt = latestOfficialStr ? new Date(latestOfficialStr) : null;
  const latestExecutionAt = getLatestAcceptedTiboExecutionAt(data);

  if (!latestOfficialAt) {
    return latestExecutionAt;
  }

  if (!latestExecutionAt || latestOfficialAt >= latestExecutionAt) {
    return latestOfficialAt;
  }

  return latestExecutionAt;
}

export function getLocalExpectationLevel(
  data: RadarData | null,
  locale: Locale = "ja",
  signalEvaluation: LocalSignalEvaluation = getLocalSignalEvaluation(data),
  activeOfficialNotice: ActiveOfficialNotice | null = getActiveOfficialNotice(
    data,
    signalEvaluation.latestResetAt,
  ),
  regularResetExpectedAt?: string | null,
  now: Date = new Date(),
) {
  const probability24h = getLocalResetProbability(
    data,
    "24h",
    signalEvaluation,
    activeOfficialNotice,
    now,
    regularResetExpectedAt,
  );
  const probability48h = getLocalResetProbability(
    data,
    "48h",
    signalEvaluation,
    activeOfficialNotice,
    now,
    regularResetExpectedAt,
  );
  return getExpectationLabel({ p24h: probability24h, p48h: probability48h }, locale);
}

export function getLocalProbabilityReason(
  data: RadarData | null,
  probability24h: number | undefined,
  probability48h: number | undefined,
  locale: Locale = "ja",
  signalEvaluation: LocalSignalEvaluation = getLocalSignalEvaluation(data),
  activeOfficialNotice: ActiveOfficialNotice | null = getActiveOfficialNotice(
    data,
    signalEvaluation.latestResetAt,
  ),
): string | null {
  const environment = signalEvaluation.environment;

  if (activeOfficialNotice) {
    return locale === "en"
      ? "An official reset notice has been detected, indicating a very high probability within 24 hours."
      : locale === "zh"
        ? "有官方重置预告，预计 24 小时内执行的概率极高。"
        : "公式リセット予告があるため、通常より高めに見ています。";
  }

  const p24 = probabilityToPercent(probability24h, locale);
  const p48 = probabilityToPercent(probability48h, locale);
  const issueAnomalies = environment.issue_or_limit_anomalies_24h ?? 0;
  const communityMentions = environment.community_mentions_24h ?? 0;
  const officialIncidentHints = environment.official_incident_hints_24h ?? 0;
  const officialUpdates = environment.official_updates_24h ?? 0;
  const lastReset = signalEvaluation.latestResetAt;
  
  let lastResetLabel = "";
  if (lastReset) {
    const days = getCalendarDayDelta(new Date(), lastReset);
    if (locale === "en") {
      if (days === 1) {
        lastResetLabel = "One day has passed since the last reset";
      } else {
        lastResetLabel = `${days} days have passed since the last reset`;
      }
    } else if (locale === "zh") {
      lastResetLabel = `自上次重置以来已过去 ${days} 天`;
    } else {
      lastResetLabel = `直近のリセットから${days}日経過`;
    }
  } else {
    lastResetLabel = locale === "en" ? "unknown days have passed since the last reset" : locale === "zh" ? "自上次重置以来的天数未知" : "直近のリセットから経過日数不明";
  }

  const statusSummary = formatStatusIncidentReason(
    signalEvaluation.statusIncidents,
    locale,
  );
  let signalSummary = statusSummary;
  if (locale === "en") {
    const extraParts: Array<string> = [];
    if (officialUpdates > 0) {
      extraParts.push("a reset-related developer signal is active");
    }
    if (issueAnomalies > 0) {
      extraParts.push("usage limit anomalies are reported");
    }
    if (communityMentions > 0) {
      extraParts.push("community reports regarding resets are observed");
    }

    if (extraParts.length > 0) {
      signalSummary = `${statusSummary} Additional signals indicate ${extraParts.join(" and ")}.`;
    }
  } else if (locale === "zh") {
    const extraParts: Array<string> = [];
    if (officialUpdates > 0) {
      extraParts.push("存在官方公告与预告");
    }
    if (issueAnomalies > 0) {
      extraParts.push("有使用限制异常的报告");
    }
    if (communityMentions > 0) {
      extraParts.push("有社区关于重置的讨论");
    }

    if (extraParts.length > 0) {
      signalSummary = `${statusSummary} 此外，${extraParts.join("，")}。`;
    }
  } else {
    const extraParts: Array<string> = [];
    if (officialUpdates > 0) {
      extraParts.push("公式からの予告・アナウンスがあります");
    }
    if (issueAnomalies > 0) {
      extraParts.push("利用上限まわりの異常報告があります");
    }
    if (communityMentions > 0) {
      extraParts.push("コミュニティ上でリセット報告があります");
    }

    if (extraParts.length > 0) {
      signalSummary = `${statusSummary} また、${extraParts.join("、")}。`;
    }
  }

  const activeHintSignals = LOCAL_OBSERVATION_SIGNALS.filter(
    (signal) =>
      signal.type === "official_incident_hint" &&
      isCurrentLocalSignal(signal)
  );

  let hintSummary: string | null = null;
  if (activeHintSignals.length > 0) {
    if (locale === "en") {
      hintSummary = "Official developer signals hinting at updates or resets have been observed.";
    } else if (locale === "zh") {
      hintSummary = "检测到来自官方开发者关于更新或重置的预告提示。";
    } else {
      hintSummary = "公式開発者から更新やリセットを示唆する投稿・シグナルが確認されています。";
    }
  }
  const combinedSignalSummary = hintSummary
    ? `${signalSummary} ${hintSummary}`
    : signalSummary;

  const activeBoostSignals = LOCAL_OBSERVATION_SIGNALS.filter(
    (signal) =>
      (signal.type === "probability_boost" ||
        typeof signal.boostValue24h === "number" ||
        typeof signal.boostValue48h === "number" ||
        typeof signal.boostValue === "number") &&
      isCurrentLocalSignal(signal)
  );

  const activeBoostSignalsWithReason = activeBoostSignals.filter(
    (sig) =>
      !!sig.boostReason &&
      ((sig.boostValue24h ?? sig.boostValue ?? 0) > 0 ||
        (sig.boostValue48h ?? sig.boostValue ?? 0) > 0)
  );

  let boostText = "";
  if (activeBoostSignalsWithReason.length > 0) {
    if (locale === "en") {
      const reasons = activeBoostSignalsWithReason.map(sig => translateDynamic(sig.boostReason ?? sig.title, locale)).join(" and ");
      boostText = ` The probability is higher than usual because of ${reasons}.`;
    } else if (locale === "zh") {
      const has9m = activeBoostSignalsWithReason.some(sig => sig.id.includes("9m"));
      const hasGpt56 = activeBoostSignalsWithReason.some(sig => (sig.boostReason ?? sig.title).includes("5.6"));
      if (has9m && hasGpt56) {
        boostText = " 考虑到可能为庆祝活跃用户达到 900 万而进行重置，以及 GPT-5.6 发布相关的庆祝活动，本次预测概率高于平时。";
      } else {
        const reasons = activeBoostSignalsWithReason.map(sig => translateDynamic(sig.boostReason ?? sig.title, locale)).join("和");
        boostText = ` 由于${reasons}，本次预测概率高于平时。`;
      }
    } else {
      const reasons = activeBoostSignalsWithReason.map(sig => translateDynamic(sig.boostReason ?? sig.title, locale)).join("および");
      boostText = ` ${reasons}のため、通常より確率を高く予測しています。`;
    }
  }

  const resetCount7d = getRecent7DayResetCount();
  const currentMomentum = getMomentumBoost("48h", data);
  let momentumText = "";
  if (currentMomentum > 0) {
    if (resetCount7d >= 4) {
      const text = "直近7日間でリセットが4回以上発生しており、連続リセットウェーブ（ラッシュ期）に入っているため予測確率を大幅に上昇補正しています。";
      momentumText = ` ${translateDynamic(text, locale)}`;
    } else if (resetCount7d === 3) {
      const text = "直近7日間でリセットが3回発生しており、リセット頻度が高まっているため予測確率を上昇補正しています。";
      momentumText = ` ${translateDynamic(text, locale)}`;
    }
  }


  if (locale === "en") {
    return `The current forecast is ${p24} within 24 hours and ${p48} within 48 hours. ${lastResetLabel}. ${combinedSignalSummary}${boostText}${momentumText}`;
  } else if (locale === "zh") {
    return `当前预测为 24 小时内 ${p24}、48 小时内 ${p48}。${lastResetLabel}，${combinedSignalSummary}${boostText}${momentumText}`;
  } else {
    return `現在の見立ては24時間以内${p24}・48時間以内${p48}です。${lastResetLabel}で、${combinedSignalSummary}${boostText}${momentumText}`;
  }
}

function clampCount(value: number | undefined, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(max, Math.max(min, value));
}
