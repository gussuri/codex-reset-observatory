import { LOCAL_OBSERVATION_SIGNALS, type LocalObservationSignal } from "@/data/observationSignals";
import { LOCAL_PROBABILITY_WEIGHTS } from "@/data/predictionWeights";
import { LOCAL_RESET_HISTORY, LOCAL_PERSONAL_RESET_HISTORY } from "@/data/resetHistory";
import type { OpenAIStatusSignals } from "@/lib/openaiStatus";
import type { Locale, RadarData } from "./types";
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

export function getLocalResetProbability(
  data: RadarData | null,
  period: "24h" | "48h",
): number {
  const officialNotice = getLatestActiveLocalSignal("official_notice");
  const weightKey = period === "24h" ? "within24h" : "within48h";
  const noticeHoursUntil = getHoursUntil(officialNotice?.expectedAt);
  const periodHours = period === "24h" ? 24 : 48;

  if (
    officialNotice &&
    isUpcomingWithinHours(noticeHoursUntil, periodHours)
  ) {
    return LOCAL_PROBABILITY_WEIGHTS.officialNotice[weightKey];
  }

  const environment = getSignalEnvironment(data);
  const statusIncidents = clampCount(
    environment?.status_incidents_24h,
    0,
    LOCAL_PROBABILITY_WEIGHTS.countLimits.statusIncidents,
  );
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
  const complaintPressure = environment?.complaint_pressure;
  const pressureBoost =
    complaintPressure === "high"
      ? LOCAL_PROBABILITY_WEIGHTS.pressureBoost.high
      : complaintPressure === "medium"
        ? LOCAL_PROBABILITY_WEIGHTS.pressureBoost.medium
        : LOCAL_PROBABILITY_WEIGHTS.pressureBoost.low;

  const base = LOCAL_PROBABILITY_WEIGHTS.base[weightKey];
  const score =
    base +
    getLocalHistoryPressure(period) +
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
    pressureBoost;

  return Math.min(
    LOCAL_PROBABILITY_WEIGHTS.max[weightKey],
    Math.max(LOCAL_PROBABILITY_WEIGHTS.min, score),
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
  const complaintPressure =
    activeCodexIncidents > 0
      ? "high"
      : officialIncidentHints > 0 ||
          statusIncidents > 0 ||
          issueAnomalies >= 3 ||
          communityMentions >= 10
        ? "medium"
        : "low";

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
    complaint_pressure: complaintPressure,
    openai_status_updated_at: openAIStatus?.updatedAt ?? null,
    openai_status_active_codex_incidents: activeCodexIncidents,
    openai_status_recent_codex_incidents:
      openAIStatus?.recentCodexIncidents ?? 0,
    openai_status_affected_codex_components:
      openAIStatus?.affectedCodexComponents ?? 0,
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

  // 自動完了ロジック: 予定時刻 (expectedAt) があり、現在時刻がそれを過ぎている場合は完了 (resolved) とする
  if (
    signal.expectedAt &&
    getDateTime(signal.expectedAt) > 0 &&
    getDateTime(signal.expectedAt) <= Date.now()
  ) {
    return "resolved";
  }

  if (
    signal.status === "expired" ||
    (signal.status !== "resolved" &&
      signal.expiresAt &&
      getDateTime(signal.expiresAt) > 0 &&
      getDateTime(signal.expiresAt) <= Date.now())
  ) {
    return "expired";
  }

  return signal.status ?? "active";
}

export function isCurrentLocalSignal(signal: LocalObservationSignal) {
  return getEffectiveSignalStatus(signal) === "active";
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
  const candidates = [
    ...LOCAL_RESET_HISTORY.map((item) => {
      if ((item.kind === "window_opened" || item.status === "open") && !item.closed_at && !item.completed_at) {
        return null;
      }
      return item.closed_at ?? item.completed_at ?? item.opened_at ?? item.date ?? null;
    }),
    ...LOCAL_PERSONAL_RESET_HISTORY.map((item) => {
      if (item.resetType === "詫びリセット" || item.resetTypes?.includes("詫びリセット")) {
        return item.date ?? item.resetAt ?? null;
      }
      return null;
    }),
  ];

  const latest = getLatestIsoDate(candidates);
  return latest ? new Date(latest) : null;
}

export function getLocalExpectationLevel(data: RadarData | null, locale: Locale = "ja") {
  const probability24h = getLocalResetProbability(data, "24h");
  return getExpectationLabel(probability24h, locale);
}

export function getLocalProbabilityReason(
  data: RadarData | null,
  probability24h: number | undefined,
  probability48h: number | undefined,
  locale: Locale = "ja",
): string | null {
  const environment = getSignalEnvironment(data);
  const officialNotice = getLatestActiveLocalSignal("official_notice");
  const noticeHoursUntil = getHoursUntil(officialNotice?.expectedAt);

  if (officialNotice && isUpcomingWithinHours(noticeHoursUntil, 24)) {
    return locale === "en"
      ? "An official reset notice has been detected, indicating a very high probability within 24 hours."
      : locale === "zh"
        ? "有官方重置预告，预计 24 小时内执行的概率极高。"
        : "公式リセット予告があるため、通常より高めに見ています。";
  }

  if (officialNotice && isUpcomingWithinHours(noticeHoursUntil, 48)) {
    return locale === "en"
      ? "An official reset notice has been detected, indicating a high probability within 48 hours."
      : locale === "zh"
        ? "有官方重置预告，预计 48 小时内执行的概率较高。"
        : "公式リセット予告があり、48時間以内の見込みを高めに見ています。";
  }

  const p24 = probabilityToPercent(probability24h, locale);
  const p48 = probabilityToPercent(probability48h, locale);
  const statusIncidents = environment.status_incidents_24h ?? 0;
  const activeStatusIncidents =
    environment.openai_status_active_codex_incidents ?? 0;
  const issueAnomalies = environment.issue_or_limit_anomalies_24h ?? 0;
  const communityMentions = environment.community_mentions_24h ?? 0;
  const officialIncidentHints = environment.official_incident_hints_24h ?? 0;
  const officialUpdates = environment.official_updates_24h ?? 0;
  const lastReset = getLastGlobalResetAt();
  
  let lastResetLabel = "";
  if (lastReset) {
    const days = getCalendarDayDelta(new Date(), lastReset);
    if (locale === "en") {
      lastResetLabel = `${days} day${days !== 1 ? "s" : ""} elapsed since the last reset`;
    } else if (locale === "zh") {
      lastResetLabel = `自上次重置以来已过去 ${days} 天`;
    } else {
      lastResetLabel = `直近のリセットから${days}日経過`;
    }
  } else {
    lastResetLabel = locale === "en" ? "unknown days since the last reset" : locale === "zh" ? "自上次重置以来的天数未知" : "直近のリセットから経過日数不明";
  }

  const signals: Array<string> = [];
  if (locale === "en") {
    if (activeStatusIncidents > 0) {
      signals.push("Codex-related active Status incident");
    } else if (statusIncidents > 0) {
      signals.push("Recent Codex-related Status updates");
    }
    if (officialIncidentHints > 0) {
      signals.push("Official hints regarding capacity/errors");
    }
    if (issueAnomalies > 0) {
      signals.push("Anomalies in usage limits");
    }
    if (communityMentions > 0) {
      signals.push("Community reports on resets");
    }
    if (officialUpdates > 0) {
      signals.push("Official updates");
    }
  } else if (locale === "zh") {
    if (activeStatusIncidents > 0) {
      signals.push("Codex相关Active状态故障");
    } else if (statusIncidents > 0) {
      signals.push("最近的Codex状态信息");
    }
    if (officialIncidentHints > 0) {
      signals.push("官方关于容量/错误的提示");
    }
    if (issueAnomalies > 0) {
      signals.push("使用限制异常报告");
    }
    if (communityMentions > 0) {
      signals.push("社区关于重置的讨论");
    }
    if (officialUpdates > 0) {
      signals.push("官方更新");
    }
  } else {
    if (activeStatusIncidents > 0) {
      signals.push("Codex関連のStatus障害");
    } else if (statusIncidents > 0) {
      signals.push("直近のCodex関連Status情報");
    }
    if (officialIncidentHints > 0) {
      signals.push("公式寄りの障害・容量到達に関する投稿");
    }
    if (issueAnomalies > 0) {
      signals.push("利用上限まわりの異常報告");
    }
    if (communityMentions > 0) {
      signals.push("コミュニティ上のリセット関連報告");
    }
    if (officialUpdates > 0) {
      signals.push("公式更新");
    }
  }

  let hintSummary: string | null = null;
  if (officialIncidentHints > 0) {
    if (locale === "en") {
      hintSummary = "Official posts about capacity issues increase the chance of a compensation reset.";
    } else if (locale === "zh") {
      hintSummary = "官方发布了关于容量问题的提示，补偿性重置的概率正在增加。";
    } else {
      hintSummary = "公式寄りの障害・容量到達に関する投稿があり、詫びリセット要因が強まっています。";
    }
  }

  let signalSummary = "";
  if (signals.length > 0) {
    if (locale === "en") {
      signalSummary = `We observe: ${signals.join(", ")}.`;
    } else if (locale === "zh") {
      signalSummary = `观测到：${signals.join("、")}。`;
    } else {
      signalSummary = `${signals.join("、")}が見られます。`;
    }
  } else {
    if (locale === "en") {
      signalSummary = "No major official notices or incident signals are observed.";
    } else if (locale === "zh") {
      signalSummary = "未发现明显的官方预告或故障信号。";
    } else {
      signalSummary = "目立った公式予告や障害情報は見られません。";
    }
  }

  if (officialNotice && noticeHoursUntil !== null && noticeHoursUntil > 48) {
    if (locale === "en") {
      return `Current forecast is ${p24} within 24h and ${p48} within 48h. There is an official notice, but scheduled more than 48 hours away.`;
    } else if (locale === "zh") {
      return `当前预测为 24 小时内 ${p24}、48 小时内 ${p48}。虽然有官方重置预告，但计划时间在 48 小时之后。`;
    } else {
      return `現在の見立ては24時間以内${p24}・48時間以内${p48}です。公式リセット予告はありますが、予定時刻はまだ48時間より先です。`;
    }
  }

  if (locale === "en") {
    return `Current forecast is ${p24} within 24h and ${p48} within 48h. It has been ${lastResetLabel}, and ${hintSummary ?? signalSummary}`;
  } else if (locale === "zh") {
    return `当前预测为 24 小时内 ${p24}、48 小时内 ${p48}。${lastResetLabel}，${hintSummary ?? signalSummary}`;
  } else {
    return `現在の見立ては24時間以内${p24}・48時間以内${p48}です。${lastResetLabel}で、${hintSummary ?? signalSummary}`;
  }
}

function clampCount(value: number | undefined, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(max, Math.max(min, value));
}
