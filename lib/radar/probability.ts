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
  const periodHours = period === "24h" ? 24 : 48;

  if (hasOfficialNoticeWithinHours(officialNotice, periodHours)) {
    return LOCAL_PROBABILITY_WEIGHTS.officialNotice[weightKey];
  }

  const environment = getSignalEnvironment(data);
  
  // OpenAI Status およびローカルシグナルの重大度 (impact) に応じた重み付き障害スコアの算出
  let weightedStatusScore = 0;
  const statusHistory = data?.openai_status_history ?? [];
  const codexIncidents = statusHistory.filter(
    (item) =>
      item.source === "openai_status" &&
      ((item.createdAt && isWithinHours(item.createdAt, 24)) ||
        (item.updatedAt && isWithinHours(item.updatedAt, 24)) ||
        item.status !== "resolved")
  );

  const localStatusSignals = LOCAL_OBSERVATION_SIGNALS.filter(
    (signal) =>
      signal.type === "status_incident" &&
      isCurrentLocalSignal(signal) &&
      isWithinHours(signal.observedAt, 24)
  );

  const mergedIncidents = new Map<string, { impact: string | null }>();
  for (const item of codexIncidents) {
    mergedIncidents.set(item.id, { impact: item.impact });
  }
  for (const signal of localStatusSignals) {
    if (!mergedIncidents.has(signal.id)) {
      mergedIncidents.set(signal.id, { impact: "minor" });
    }
  }

  for (const incident of Array.from(mergedIncidents.values())) {
    const impact = incident.impact?.toLowerCase();
    let multiplier = 1.0;
    if (impact === "critical") {
      multiplier = 3.0;
    } else if (impact === "major") {
      multiplier = 2.0;
    }
    weightedStatusScore += multiplier;
  }

  // 影響コンポーネント数も 1.0 倍として加算
  const affectedComponents = environment?.openai_status_affected_codex_components ?? 0;
  weightedStatusScore += affectedComponents;

  const statusIncidents = clampCount(
    weightedStatusScore,
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

  // 期間限定のイベントブースト（確率底上げ）を収集して加算
  const activeBoostSignals = LOCAL_OBSERVATION_SIGNALS.filter(
    (signal) =>
      signal.type === "probability_boost" &&
      isCurrentLocalSignal(signal) &&
      signal.boostValue !== undefined
  );
  const eventBoost = activeBoostSignals.reduce(
    (sum, sig) => sum + (sig.boostValue ?? 0),
    0
  );

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
    pressureBoost +
    eventBoost;

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
): string | null {
  const environment = getSignalEnvironment(data);
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

  let signalSummary = "";
  if (locale === "en") {
    const statusText = activeStatusIncidents > 0
      ? "a Codex-related incident is active on the official status page"
      : "no active incidents are listed on the official status page";

    const extraParts: Array<string> = [];
    if (officialUpdates > 0) {
      extraParts.push("official announcements/forecasts are active");
    }
    if (officialIncidentHints > 0) {
      extraParts.push("official capacity warnings are posted");
    }
    if (issueAnomalies > 0) {
      extraParts.push("usage limit anomalies are reported");
    }
    if (communityMentions > 0) {
      extraParts.push("community reports regarding resets are observed");
    }

    if (extraParts.length > 0) {
      signalSummary = `While ${statusText}, ${extraParts.join(" and ")}.`;
    } else {
      signalSummary = activeStatusIncidents > 0
        ? "A Codex-related incident is active on the official status page."
        : "No active incidents are listed on the official status page.";
    }
  } else if (locale === "zh") {
    const statusText = activeStatusIncidents > 0
      ? "官方状态页正显示Codex相关故障"
      : "官方状态页目前未显示进行中的故障";

    const extraParts: Array<string> = [];
    if (officialUpdates > 0) {
      extraParts.push("存在官方公告与预告");
    }
    if (officialIncidentHints > 0) {
      extraParts.push("并检测到关于容量的官方提示");
    }
    if (issueAnomalies > 0) {
      extraParts.push("且有使用限制异常的报告");
    }
    if (communityMentions > 0) {
      extraParts.push("以及社区关于重置的讨论");
    }

    if (extraParts.length > 0) {
      signalSummary = `${statusText}，${extraParts.join("，")}。`;
    } else {
      signalSummary = activeStatusIncidents > 0
        ? "官方状态页正显示Codex相关故障。"
        : "官方状态页目前未显示进行中的故障。";
    }
  } else {
    const statusText = activeStatusIncidents > 0
      ? "公式ステータスにCodex関連の障害が発生しており"
      : "公式ステータスに発生中の障害はなく";

    const extraParts: Array<string> = [];
    if (officialUpdates > 0) {
      extraParts.push("公式からの予告・アナウンスがあります");
    }
    if (officialIncidentHints > 0) {
      extraParts.push("容量到達に関する公式投稿が確認されています");
    }
    if (issueAnomalies > 0) {
      extraParts.push("利用上限まわりの異常報告があります");
    }
    if (communityMentions > 0) {
      extraParts.push("コミュニティ上でリセット報告があります");
    }

    if (extraParts.length > 0) {
      signalSummary = `${statusText}、${extraParts.join("、")}。`;
    } else {
      signalSummary = activeStatusIncidents > 0
        ? "公式ステータスにCodex関連の障害が発生しています。"
        : "公式ステータスに発生中の障害はありません。";
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
