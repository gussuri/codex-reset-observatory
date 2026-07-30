import { LOCAL_OBSERVATION_SIGNALS, type LocalObservationSignal } from "@/data/observationSignals";
import { LOCAL_PROBABILITY_WEIGHTS } from "@/data/predictionWeights";
import { LOCAL_RESET_HISTORY } from "@/data/resetHistory";
import type { OpenAIStatusSignals } from "@/lib/openaiStatus";
import type { Locale, RadarData } from "./types";
import { translateDynamic } from "./i18n";
import {
  deriveComplaintPressure,
  evaluateStatusIncidents,
  formatStatusIncidentReason,
  type StatusIncidentEvaluation,
} from "./signalEvaluation";
import {
  getCalendarDayDelta,
  getHoursUntil,
  getLatestIsoDate,
  isUpcomingWithinHours,
  isWithinHours,
  getDateTime,
  probabilityToPercent,
  getExpectationLabel,
} from "./helpers";

export type LocalSignalEvaluation = {
  environment: NonNullable<RadarData["codex_environment"]>;
  statusIncidents: StatusIncidentEvaluation;
  complaintPressure: ReturnType<typeof deriveComplaintPressure>;
  latestResetAt: Date | null;
};

export function getLocalResetProbability(
  data: RadarData | null,
  period: "24h" | "48h",
  signalEvaluation: LocalSignalEvaluation = getLocalSignalEvaluation(data),
): number {
  const weightKey = period === "24h" ? "within24h" : "within48h";
  const periodHours = period === "24h" ? 24 : 48;

  const tiboSignals = (data as any)?.active_tibo_signals as Array<any> | undefined;
  const hasExecuted = tiboSignals?.some(
    (s) => s.signal_type === "reset_executed" && (s.confidence ?? 0) >= 0.95
  );
  const hasValidNotice = tiboSignals?.some(
    (s) => s.signal_type === "official_notice" && (s.confidence ?? 0) >= 0.95
  );

  const officialNotice = getLatestActiveLocalSignal("official_notice");

  // reset_executed cancels active notice mode. If valid notice exists and no execution, trigger Notice Mode (24h: 90%, 48h: 96%)
  if (!hasExecuted) {
    if (hasValidNotice || hasOfficialNoticeWithinHours(officialNotice, periodHours)) {
      return LOCAL_PROBABILITY_WEIGHTS.officialNotice[weightKey];
    }
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
      isCurrentLocalSignal(signal)
  );

  let eventBoost = activeBoostSignals.reduce((sum, sig) => {
    const boost = period === "24h"
      ? (sig.boostValue24h ?? sig.boostValue ?? 0)
      : (sig.boostValue48h ?? sig.boostValue ?? 0);

    return sum + boost;
  }, 0);

  // If valid Supabase teaser exists (confidence >= 0.80) and no local teaser boost signal is already applied, add automated teaser boost
  const validSupabaseTeaser = tiboSignals?.find(
    (s) => s.signal_type === "teaser" && (s.confidence ?? 0) >= 0.80
  );
  if (validSupabaseTeaser && activeBoostSignals.length === 0) {
    const teaserBoost = period === "24h" ? 0.40 : 0.55;
    eventBoost += teaserBoost;
  }

  const hasActiveTeaserOrEventBoost = activeBoostSignals.length > 0;

  const score =
    base +
    getMomentumBoost(period) +
    (hasActiveTeaserOrEventBoost ? getLocalHistoryPressure(period) : 0) +
    getElapsedDayBoost() +
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
  const latestResetAt = getLastGlobalResetAt();
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

export function getLatestActiveLocalSignal(type: LocalObservationSignal["type"]) {
  return LOCAL_OBSERVATION_SIGNALS.filter(
    (signal) => signal.type === type && isCurrentLocalSignal(signal),
  )
    .sort((a, b) => getDateTime(b.observedAt) - getDateTime(a.observedAt))
    .at(0);
}

export function getEffectiveSignalStatus(signal: LocalObservationSignal) {
  if (signal.resolvedAt) {
    return "resolved";
  }

  // 1. 有効期限 (expiresAt) がすでに切れている場合は expired とする
  if (
    signal.status === "expired" ||
    (signal.status !== "resolved" &&
      signal.expiresAt &&
      getDateTime(signal.expiresAt) > 0 &&
      getDateTime(signal.expiresAt) <= Date.now())
  ) {
    return "expired";
  }

  // 2. 自動完了ロジック:
  // 予定時刻 (expectedAt) を過ぎている場合、通常は完了 (resolved) とする。
  // ただし、有効期限 (expiresAt) が未来である場合は、その期限までは active を維持する。
  if (
    signal.expectedAt &&
    getDateTime(signal.expectedAt) > 0 &&
    getDateTime(signal.expectedAt) <= Date.now()
  ) {
    if (signal.expiresAt && getDateTime(signal.expiresAt) > Date.now()) {
      return signal.status ?? "active";
    }
    return "resolved";
  }

  return signal.status ?? "active";
}

export function isCurrentLocalSignal(signal: LocalObservationSignal) {
  return getEffectiveSignalStatus(signal) === "active";
}

export function getRecent7DayResetCount(): number {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  return LOCAL_RESET_HISTORY.filter((item) => {
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

export function getMomentumBoost(period: "24h" | "48h"): number {
  const count = getRecent7DayResetCount();
  const weightKey = period === "24h" ? "within24h" : "within48h";

  if (count >= 4) {
    return LOCAL_PROBABILITY_WEIGHTS.momentumBoost.level2[weightKey];
  }
  if (count === 3) {
    return LOCAL_PROBABILITY_WEIGHTS.momentumBoost.level1[weightKey];
  }
  return 0;
}

export function getLocalHistoryPressure(period: "24h" | "48h") {
  const daysSinceLastReset = getDaysSinceLastGlobalReset();
  if (daysSinceLastReset === null) {
    return 0;
  }

  const weightKey = period === "24h" ? "within24h" : "within48h";
  const pressure = LOCAL_PROBABILITY_WEIGHTS.historyPressure.find(
    (item) => daysSinceLastReset <= item.maxDaysSinceReset,
  );

  return pressure?.[weightKey] ?? 0;
}

export function getElapsedDayBoost() {
  const daysSinceLastReset = getDaysSinceLastGlobalReset();
  if (daysSinceLastReset === null) {
    return 0;
  }

  return daysSinceLastReset * LOCAL_PROBABILITY_WEIGHTS.elapsedDayBoost.perDay;
}

export function getDaysSinceLastGlobalReset() {
  const lastReset = getLastGlobalResetAt();
  if (!lastReset) {
    return null;
  }

  return Math.max(0, getCalendarDayDelta(new Date(), lastReset));
}

export function getLastGlobalResetAt() {
  const candidates = LOCAL_RESET_HISTORY.map((item) => {
    if ((item.kind === "window_opened" || item.status === "open") && !item.closed_at && !item.completed_at) {
      return null;
    }
    const resetMethod = item.details?.resetMethod;
    if (resetMethod === "任意リセット権1回配布") {
      return null;
    }
    return item.closed_at ?? item.completed_at ?? item.opened_at ?? (item as any).date ?? null;
  });

  const latest = getLatestIsoDate(candidates);
  return latest ? new Date(latest) : null;
}

export function getLocalExpectationLevel(
  data: RadarData | null,
  locale: Locale = "ja",
  signalEvaluation: LocalSignalEvaluation = getLocalSignalEvaluation(data),
) {
  const probability24h = getLocalResetProbability(data, "24h", signalEvaluation);
  const probability48h = getLocalResetProbability(data, "48h", signalEvaluation);
  return getExpectationLabel({ p24h: probability24h, p48h: probability48h }, locale);
}

function hasOfficialNoticeWithinHours(
  notice: ReturnType<typeof getLatestActiveLocalSignal>,
  periodHours: number,
) {
  const scheduledHoursUntil = getHoursUntil(notice?.expectedAt);
  if (isUpcomingWithinHours(scheduledHoursUntil, periodHours)) {
    return true;
  }

  if (notice?.expectedAt) {
    return false;
  }

  return isUpcomingWithinHours(getHoursUntil(notice?.expiresAt), periodHours);
}

export function getLocalProbabilityReason(
  data: RadarData | null,
  probability24h: number | undefined,
  probability48h: number | undefined,
  locale: Locale = "ja",
  signalEvaluation: LocalSignalEvaluation = getLocalSignalEvaluation(data),
): string | null {
  const environment = signalEvaluation.environment;
  const officialNotice = getLatestActiveLocalSignal("official_notice");
  const noticeHoursUntil = getHoursUntil(officialNotice?.expectedAt);

  if (hasOfficialNoticeWithinHours(officialNotice, 24)) {
    return locale === "en"
      ? "An official reset notice has been detected, indicating a very high probability within 24 hours."
      : locale === "zh"
        ? "有官方重置预告，预计 24 小时内执行的概率极高。"
        : "公式リセット予告があるため、通常より高めに見ています。";
  }

  if (hasOfficialNoticeWithinHours(officialNotice, 48)) {
    return locale === "en"
      ? "An official reset notice has been detected, indicating a high probability within 48 hours."
      : locale === "zh"
        ? "有官方重置预告，预计 48 小时内执行的概率较高。"
        : "公式リセット予告があり、48時間以内の見込みを高めに見ています。";
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
  let momentumText = "";
  if (resetCount7d >= 4) {
    const text = "直近7日間でリセットが4回以上発生しており、連続リセットウェーブ（ラッシュ期）に入っているため予測確率を大幅に上昇補正しています。";
    momentumText = ` ${translateDynamic(text, locale)}`;
  } else if (resetCount7d === 3) {
    const text = "直近7日間でリセットが3回発生しており、リセット頻度が高まっているため予測確率を上昇補正しています。";
    momentumText = ` ${translateDynamic(text, locale)}`;
  }

  if (officialNotice && noticeHoursUntil !== null && noticeHoursUntil > 48) {
    if (locale === "en") {
      return `The current forecast is ${p24} within 24 hours and ${p48} within 48 hours. There is an official notice, but scheduled more than 48 hours away. ${combinedSignalSummary}${boostText}${momentumText}`;
    } else if (locale === "zh") {
      return `当前预测为 24 小时内 ${p24}、48 小时内 ${p48}。虽然有官方重置预告，但计划时间在 48 小时之后。${combinedSignalSummary}${boostText}${momentumText}`;
    } else {
      return `現在の見立ては24時間以内${p24}・48時間以内${p48}です。公式リセット予告はありますが、予定時刻はまだ48時間より先です。${combinedSignalSummary}${boostText}${momentumText}`;
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
