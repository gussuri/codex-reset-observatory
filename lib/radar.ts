import {
  LOCAL_OBSERVATION_SIGNALS,
  type LocalObservationSignal,
} from "@/data/observationSignals";
import {
  EXPECTATION_THRESHOLDS,
  LOCAL_PROBABILITY_WEIGHTS,
  RECOMMENDED_ACTION_THRESHOLDS,
  REFRESH_INTERVAL_MS,
} from "@/data/predictionWeights";
import {
  HISTORY_LIMIT,
  LOCAL_MODEL_UPDATED_AT,
  LOCAL_PERSONAL_RESET_HISTORY,
  LOCAL_RESET_HISTORY,
  MANUAL_LAST_REGULAR_RESET_AT,
  MANUAL_NEXT_REGULAR_RESET_AT,
  MANUAL_NEXT_REGULAR_RESET_TIME_CONFIRMED,
} from "@/data/resetHistory";
import type {
  OpenAIStatusHistoryItem,
  OpenAIStatusSignals,
} from "@/lib/openaiStatus";

export type ProbabilityLevel = "low" | "medium" | "high" | "very_high";

export type RadarData = {
  data?: RadarData;
  result?: RadarData;
  current?: RadarData;
  schema_version?: string;
  service?: string;
  purpose?: string;
  timezone?: string;
  checked_at?: string;
  monitored_at?: string;
  updated_at?: string;
  status?: string;
  window_open?: boolean;
  message?: string;
  recommended_action?: string;
  window?: WindowLike & {
    open?: boolean;
    action?: string;
    message?: string;
    source_url?: string | null;
  };
  current_window?: {
    state?: string;
    message?: string;
    opened_at?: string | null;
    source?: string | null;
  };
  last_window?: WindowLike;
  latest_reset?: WindowLike;
  last_reset?: WindowLike;
  latest_window?: WindowLike;
  recent_windows?: Array<WindowLike>;
  metrics?: {
    last_3_months_window_minutes?: number;
    last_3_months_window_human?: string;
  };
  prediction?: {
    level?: ProbabilityLevel | string;
    probability_24h?: number;
    probability24h?: number;
    probability_24_hours?: number;
    probability_48h?: number;
    probability48h?: number;
    probability_48_hours?: number;
    expected_window?: string;
    summary?: string;
    summary_en?: string;
    reasoning_summary?: string;
    display_summary?: string;
    display_summary_en?: string;
    updated_at?: string;
    signal_summary_24h?: SignalSummaryLike;
    probability_history?: {
      events?: Array<WindowEventLike>;
    };
    cooldown?: {
      active?: boolean;
      until?: string | null;
    };
    should_notify?: boolean;
  };
  probabilities?: {
    probability_24h?: number;
    probability24h?: number;
    probability_48h?: number;
    probability48h?: number;
    within_24h?: number;
    within_48h?: number;
    "24h"?: number;
    "48h"?: number;
  };
  links?: {
    html?: string;
    rss?: string;
  };
  openai_status_history?: Array<OpenAIStatusHistoryItem>;
  codex_environment?: {
    updated_at?: string;
    status_incidents_24h?: number;
    official_incident_hints_24h?: number;
    official_updates_24h?: number;
    community_mentions_24h?: number;
    issue_or_limit_anomalies_24h?: number;
    complaint_pressure?: "low" | "medium" | "high" | string;
    openai_status_updated_at?: string | null;
    openai_status_active_codex_incidents?: number;
    openai_status_recent_codex_incidents?: number;
    openai_status_affected_codex_components?: number;
    openai_status_latest_codex_incident?: string | null;
    reset_card?: {
      probability_24h?: number;
      probability_48h?: number;
      level?: ProbabilityLevel | string;
      status?: string;
      note?: string;
    };
  };
};

export type WindowLike = {
  id?: string;
  guid?: string;
  title?: string;
  status?: string;
  opened_at?: string | null;
  closed_at?: string | null;
  completed_at?: string | null;
  window_minutes?: number;
  window_human?: string;
  scope?: string;
  summary?: string;
  source?: string | null;
  source_url?: string | null;
  link?: string | null;
  sources?: Array<{
    type?: string;
    url?: string | null;
  }>;
};

export type WindowEventLike = WindowLike & {
  kind?: string;
  date?: string;
  label?: string;
};

export type SignalSummaryLike = {
  observation_total?: number;
  candidate_total?: number;
  new_total?: number;
  seen_total?: number;
  observation_counts?: Record<string, number>;
  new_counts?: Record<string, number>;
  total?: number;
  counts?: Record<string, number>;
};

export type CachedRadarData = {
  data: RadarData;
  fetchedAt: string;
};

export type RadarViewModel = {
  status: string;
  expectation: string;
  probability24h?: number;
  probability48h?: number;
  action: string;
  lastUpdated?: string | null;
  regularResetForecast: {
    date: string;
    time?: string | null;
    remaining: string;
    sourceResetAt?: string | null;
    expectedAt?: string | null;
    lastCompletedAt?: string | null;
    remainingDays?: number | null;
    isNoticeWindow: boolean;
  };
  activeWindow: {
    active: boolean;
    kind: "official" | "regular" | "none";
    label: string;
    summary: string;
    openedAt?: string | null;
    source?: string | null;
    forecastDate?: string;
    forecastTime?: string | null;
    remaining?: string;
  };
  reasoningSummary: string | null;
  latestWindow: {
    kind: "observed" | "regular";
    title: string;
    summary: string;
    scope: string;
    openedAt?: string | null;
    closedAt?: string | null;
    windowLength: string;
  };
  recentHistory: Array<{
    key: string;
    title: string;
    resetType: string;
    status: string;
    date?: string | null;
    signalAt?: string | null;
    resetAt?: string | null;
    signalLabel: string;
    resetLabel: string;
    scopeLabel?: string;
    scope: string;
    windowLabel?: string;
    windowLength: string;
    source?: string | null;
  }>;
};

const DISPLAY_TIME_ZONE = "Asia/Tokyo";
const DAY_MS = 24 * 60 * 60 * 1000;

export function getLocalRadarData({
  openAIStatus,
}: {
  openAIStatus?: OpenAIStatusSignals | null;
} = {}): RadarData {
  const checkedAt = new Date().toISOString();
  const updatedAt = getLocalModelUpdatedAt(openAIStatus);

  return {
    schema_version: "local-v1",
    service: "codex-reset-observatory",
    purpose: "local-reset-observation",
    timezone: DISPLAY_TIME_ZONE,
    checked_at: checkedAt,
    monitored_at: checkedAt,
    updated_at: updatedAt,
    status: "none",
    window_open: false,
    openai_status_history: openAIStatus?.history ?? [],
    codex_environment: getLocalSignalEnvironment(openAIStatus),
  };
}

export function probabilityToPercent(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "不明";
  }

  const normalized = normalizeProbability(value);

  return `${Math.round(normalized * 100)}%`;
}

export function getExpectationLabel(
  value: number | string | null | undefined,
) {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();

    switch (normalized) {
      case "low":
        return "低";
      case "medium":
        return "中";
      case "high":
        return "高";
      case "very_high":
      case "very-high":
      case "critical":
        return "超高";
      default:
        return value || "不明";
    }
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    return "不明";
  }

  const normalized = normalizeProbability(value);

  if (normalized < EXPECTATION_THRESHOLDS.medium) {
    return "低";
  }

  if (normalized < EXPECTATION_THRESHOLDS.high) {
    return "中";
  }

  if (normalized < EXPECTATION_THRESHOLDS.veryHigh) {
    return "高";
  }

  return "超高";
}

export function getRefreshIntervalMs(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return REFRESH_INTERVAL_MS.unknown;
  }

  const normalized = normalizeProbability(value);

  if (normalized < EXPECTATION_THRESHOLDS.medium) {
    return REFRESH_INTERVAL_MS.low;
  }

  if (normalized < EXPECTATION_THRESHOLDS.high) {
    return REFRESH_INTERVAL_MS.medium;
  }

  if (normalized < EXPECTATION_THRESHOLDS.veryHigh) {
    return REFRESH_INTERVAL_MS.high;
  }

  return REFRESH_INTERVAL_MS.veryHigh;
}

export function getRefreshIntervalLabel(value: number | undefined) {
  const intervalMs = getRefreshIntervalMs(value);

  if (intervalMs === REFRESH_INTERVAL_MS.veryHigh) {
    return "30分";
  }

  return `${Math.round(intervalMs / 60 / 60 / 1000)}時間`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "不明";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: "short",
  }).format(date);
}

function formatDateTimeCompact(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(value);
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(value);
}

export function translateStatus(
  status: string | undefined,
  isWindowOpen: boolean | undefined,
) {
  if (isWindowOpen) {
    return "公式リセット予告が出ています";
  }

  switch (status) {
    case "none":
      return "現在リセットは実施されていません";
    case "open":
      return "公式リセット予告が出ています";
    case "closed":
      return "直近のリセットは終了しています";
    default:
      return status || "不明";
  }
}

export function translateAction(action: string | undefined) {
  switch (action) {
    case "wait":
      return "様子を見る";
    case "use_quota":
      return "必要なら残り枠を使う";
    case "watch":
      return "続報を確認する";
    default:
      return action || "不明";
  }
}

export function translateSourceText(value: string | undefined) {
  if (!value) {
    return "不明";
  }

  const dictionary: Record<string, string> = {
    "500 万用户庆祝重置": "500万人達成記念リセット",
    "5M users celebration reset": "500万人達成記念リセット",
    "Codex 可靠性事故补偿重置": "Codex障害対応の利用上限リセット",
    "Codex usage-limit reset": "Codex利用上限リセット",
    "长会话压缩耗额异常补偿重置": "長時間セッション圧縮の消費異常に対する補償リセット",
    "Sam 点赞承诺速率限制重置": "Sam氏の投稿をきっかけにしたレート制限リセット",
    "GPT-5.5 能力退化补偿重置": "GPT-5.5性能低下への補償リセット",
    "周度庆祝付费计划重置": "週次の節目を祝う有料プランリセット",
    "400 万活跃用户里程碑重置": "400万アクティブユーザー達成記念リセット",
    "局部故障补偿重置": "一部障害への補償リセット",
    "一周年纪念重置": "1周年記念リセット",
    "300 万周活用户与新计划重置": "300万週間アクティブユーザーと新プランに伴うリセット",
    "所有付费计划": "全有料プラン",
    "现有 $200 Pro 用户": "既存の$200 Proユーザー",
    "All paid plans": "全有料プラン",
    "All plans": "全プラン",
    "Codex users": "Codexユーザー",
    "Codex 用户": "Codexユーザー",
    "无窗": "即時リセット",
    "9小时25分": "9時間25分",
    "19小时53分": "19時間53分",
    "8分钟": "8分",
    "17小时20分": "17時間20分",
    "Tibo 表示过去 24 小时内有三次影响 Codex 可靠性的小事故，并已为所有付费计划重置 Codex 使用限制。":
      "過去24時間にCodexの信頼性へ影響する小規模な障害が3件発生したとして、Tibo氏が全有料プランのCodex利用上限をリセットしたと発表しました。",
    "Tibo 将这次重置解释为庆祝 Codex 达到 500 万用户；随后确认所有付费 ChatGPT 订阅的周额度和 5 小时额度都已恢复到 100%。":
      "Codexの500万人達成を祝うリセットとして説明され、その後、有料ChatGPTプランの週次枠と5時間枠が100%に戻ったことが確認されました。",
    "Tibo 表示 Codex 长会话压缩的 cache hit rate 受回滚优化影响，导致限制消耗更快；修复后已为所有账号重置使用限制。":
      "長時間セッション圧縮のキャッシュヒット率が低下して利用上限の消費が速くなっていた問題について、修正後に全アカウントの利用制限がリセットされました。",
    "Sam 发文称推文获 1 个赞后 Tibo 会重置 Codex 速率限制，随后社区在数分钟内反馈重置完成。":
      "Sam氏の投稿をきっかけに、数分後にはコミュニティからリセット完了の反応が出ました。",
    "Tibo 表示两个 GPT-5.5 能力退化问题已修复后，付费计划的使用限制完成重置。":
      "GPT-5.5の性能低下に関する2件の問題が修正された後、有料プランの利用制限がリセットされました。",
    "为庆祝顺利的一周，并让用户继续用 GPT-5.5 构建，所有付费计划的限制已重置。":
      "順調な週を祝い、GPT-5.5での開発を継続できるよう、全有料プランの制限がリセットされました。",
    "Codex 达到 400 万活跃用户后，Tibo 和 Sam 均预告当天会重置；几小时后出现多条用户反馈称额度已重置。":
      "Codexが400万アクティブユーザーに達した後、Tibo氏とSam氏が当日のリセットを示唆し、数時間後に利用枠が戻ったという反応が複数出ました。",
    "短暂的 Codex 局部故障后，Tibo 表示即将重置速率限制。评论区约 2 小时 43 分钟后出现“usage is back to 100%”等用户反馈。":
      "短時間のCodex部分障害後、Tibo氏がレート制限のリセットを示唆し、約2時間43分後に利用枠が100%に戻ったという反応が出ました。",
    "为纪念产品一周年，Codex 对所有计划的速率限制进行了重置。":
      "製品1周年を記念して、Codexの全プランのレート制限がリセットされました。",
    "Codex 达到 300 万周活用户后，Tibo 表示正在重置限制；随后 @OpenAI 在新计划发布时确认现有 $200 Pro 用户的 Codex 速率限制已再次重置。":
      "Codexが週間アクティブユーザー300万人に達した後、制限のリセットが進められ、新プラン発表時に既存の$200 Proユーザー向けCodex制限も再度リセットされたことが確認されました。",
    "没有新的事故补偿线索，官方最新动作是个人 10X 用量奖励而非全局重置。社区仍有额度压力和求 reset 声音，但更像被奖励计划带出的需求反馈。":
      "新しい障害補償の手がかりはなく、公式の最新動きは全体リセットではなく個別の10倍利用量リワードです。コミュニティには利用枠への圧力やリセット要望が残っていますが、リワード施策に反応した需要フィードバック寄りに見えます。",
    "Codex limits were reset after a usage-limit issue was resolved.":
      "利用上限に関する問題への対応として、Codexの利用上限がリセットされました。",
    "Tibo framed this reset as a celebration of Codex reaching 5M users; weekly and 5-hour limits for paid ChatGPT subscriptions were restored to 100%.":
      "Codexの利用者500万人達成を記念し、有料ChatGPTプランの週次および5時間ごとの上限が100%に戻されました。",
    "暂无正式速蹬窗口": "公式リセット予告はありません",
    "当前没有开启的速蹬窗口": "公式リセット予告はありません",
    "未来 24-48 小时": "今後24〜48時間",
  };

  return dictionary[value] ?? value;
}

export function isSafeHttpUrl(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getRadarViewModel(data: RadarData | null): RadarViewModel {
  const source = unwrapRadarData(data);
  const probability24h = getProbability(source, "24h");
  const probability48h = getProbability(source, "48h");
  const predictionLevel = getLocalExpectationLevel(source);
  const observedLatestWindow = getLatestWindow(source);
  const observedHistory = getRecentHistory(source);
  const latestObservedResetAt =
    observedHistory.find((item) => item.resetAt)?.resetAt ?? null;
  const regularResetForecast = getRegularResetForecast(
    latestObservedResetAt,
  );
  const latestWindow = getLatestWindowWithRegularReset(
    observedLatestWindow,
    regularResetForecast,
  );
  const activeWindow = getDisplayResetNotice(getActiveWindow(source));
  const recentHistory = addPersonalResetEventsToHistory(
    addRegularResetForecastToHistory(observedHistory, regularResetForecast),
  );

  return {
    status: translateStatus(
      getString(source, ["status", "current_window.state"]),
      source?.window_open,
    ),
    expectation: getExpectationLabel(predictionLevel ?? probability24h),
    probability24h,
    probability48h,
    action: getRecommendedAction(source, probability24h),
    lastUpdated:
      source?.checked_at ??
      source?.monitored_at ??
      source?.updated_at ??
      source?.prediction?.updated_at ??
      null,
    regularResetForecast,
    activeWindow,
    reasoningSummary: getReasoningSummary(source, probability24h, probability48h),
    latestWindow: {
      kind: isRegularResetWindow(latestWindow) ? "regular" : "observed",
      title: translateSourceText(latestWindow?.title),
      summary: latestWindow?.summary
        ? translateSourceText(latestWindow.summary)
        : "概要は取得できていません。",
      scope: translateSourceText(latestWindow?.scope),
      openedAt: latestWindow?.opened_at ?? null,
      closedAt:
        latestWindow?.closed_at ??
        latestWindow?.completed_at ??
        latestWindow?.opened_at ??
        null,
      windowLength: latestWindow?.window_human
        ? translateSourceText(latestWindow.window_human)
        : formatWindowLength(latestWindow?.window_minutes),
    },
    recentHistory,
  };
}

function getRegularResetForecast(latestResetAt: string | null | undefined) {
  const manualNextRegularReset = new Date(MANUAL_NEXT_REGULAR_RESET_AT);
  const hasManualNextRegularReset = !Number.isNaN(manualNextRegularReset.getTime());
  const manualLastRegularReset = new Date(MANUAL_LAST_REGULAR_RESET_AT);
  const current = new Date();
  const hasManualLastRegularReset =
    !Number.isNaN(manualLastRegularReset.getTime()) &&
    manualLastRegularReset.getTime() <= current.getTime();

  if (
    !latestResetAt &&
    !hasManualNextRegularReset &&
    !hasManualLastRegularReset
  ) {
    return {
      date: "不明",
      time: null,
      remaining: "残り不明",
      sourceResetAt: latestResetAt,
      expectedAt: null,
      lastCompletedAt: null,
      remainingDays: null,
      isNoticeWindow: false,
    };
  }

  const latestResetDate = latestResetAt ? new Date(latestResetAt) : null;
  const hasLatestResetDate =
    Boolean(latestResetDate) && !Number.isNaN((latestResetDate as Date).getTime());

  if (
    !hasManualNextRegularReset &&
    !hasLatestResetDate &&
    !hasManualLastRegularReset
  ) {
    return {
      date: "不明",
      time: null,
      remaining: "残り不明",
      sourceResetAt: latestResetAt,
      expectedAt: null,
      lastCompletedAt: null,
      remainingDays: null,
      isNoticeWindow: false,
    };
  }

  const rolledRegularReset = rollRegularResetForward(
    hasManualNextRegularReset ? manualNextRegularReset : null,
    current,
  );
  const lastCompletedDate = getLatestDate(
    rolledRegularReset.lastCompletedAt,
    hasManualLastRegularReset ? manualLastRegularReset : null,
  );
  const lastCompletedAt = lastCompletedDate?.toISOString() ?? null;
  const scheduleAnchor = getLatestDate(
    lastCompletedDate,
    hasLatestResetDate ? latestResetDate : null,
  );
  const nextRegularResetFromAnchor = scheduleAnchor
    ? rollResetDateForward(
        new Date(scheduleAnchor.getTime() + 7 * DAY_MS),
        current,
      )
    : null;
  const nextRegularReset = getLatestDate(
    rolledRegularReset.nextReset,
    nextRegularResetFromAnchor,
  );
  const remainingDays = getCalendarDayDelta(nextRegularReset, current);

  return {
    date: formatDate(nextRegularReset),
    time:
      hasManualNextRegularReset && MANUAL_NEXT_REGULAR_RESET_TIME_CONFIRMED
        ? formatTime(nextRegularReset)
        : null,
    remaining:
      remainingDays > 0
        ? `残り${remainingDays}日`
        : remainingDays === 0
          ? "残り0日"
          : "予想日を過ぎています",
    sourceResetAt: scheduleAnchor?.toISOString() ?? lastCompletedAt ?? latestResetAt,
    expectedAt: nextRegularReset.toISOString(),
    lastCompletedAt,
    remainingDays,
    isNoticeWindow:
      remainingDays >= 0 && (hasManualNextRegularReset || remainingDays <= 3),
  };
}

function getLatestDate(...values: Array<Date | null | undefined>) {
  return values
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0];
}

function rollRegularResetForward(
  manualReset: Date | null,
  current: Date,
) {
  if (!manualReset) {
    return {
      nextReset: null,
      lastCompletedAt: null,
    };
  }

  let nextReset = new Date(manualReset);
  let lastCompletedAt: Date | null = null;

  while (nextReset.getTime() <= current.getTime()) {
    lastCompletedAt = nextReset;
    nextReset = new Date(nextReset.getTime() + 7 * DAY_MS);
  }

  return {
    nextReset,
    lastCompletedAt,
  };
}

function rollResetDateForward(reset: Date, current: Date) {
  let nextReset = new Date(reset);

  while (nextReset.getTime() <= current.getTime()) {
    nextReset = new Date(nextReset.getTime() + 7 * DAY_MS);
  }

  return nextReset;
}

function getDisplayResetNotice(
  officialWindow: RadarViewModel["activeWindow"],
): RadarViewModel["activeWindow"] {
  return officialWindow;
}

function addRegularResetForecastToHistory(
  history: RadarViewModel["recentHistory"],
  regularResetForecast: RadarViewModel["regularResetForecast"],
) {
  if (!regularResetForecast.expectedAt) {
    return history;
  }

  const regularItems: RadarViewModel["recentHistory"] = [];

  if (regularResetForecast.lastCompletedAt) {
    regularItems.push({
      key: `regular-reset-completed-${regularResetForecast.lastCompletedAt}`,
      title: "定期リセット",
      resetType: "定期リセット",
      status: "終了",
      date: regularResetForecast.lastCompletedAt,
      signalAt: null,
      resetAt: regularResetForecast.lastCompletedAt,
      signalLabel: "",
      resetLabel: "実施",
      scope: "全有料プラン",
      windowLength: "定期実施",
      source: null,
    });
  }

  const sortedHistory = [...regularItems, ...history].sort((a, b) => {
    const aTime = getHistorySortTime(a);
    const bTime = getHistorySortTime(b);
    return bTime - aTime;
  });

  return sortedHistory.slice(0, HISTORY_LIMIT);
}

function addPersonalResetEventsToHistory(history: RadarViewModel["recentHistory"]) {
  const seen = new Set(history.map((item) => item.key));
  const personalItems = LOCAL_PERSONAL_RESET_HISTORY.filter(
    (item) => !seen.has(item.key),
  );

  return [...personalItems, ...history]
    .sort((a, b) => getHistorySortTime(b) - getHistorySortTime(a))
    .slice(0, HISTORY_LIMIT);
}

function getLatestWindowWithRegularReset(
  latestWindow: WindowLike | undefined,
  regularResetForecast: RadarViewModel["regularResetForecast"],
): WindowLike | undefined {
  if (!regularResetForecast.lastCompletedAt) {
    return latestWindow;
  }

  const regularResetTime = new Date(regularResetForecast.lastCompletedAt).getTime();
  const latestWindowTime = getWindowResetTime(latestWindow);

  if (latestWindowTime > regularResetTime) {
    return latestWindow;
  }

  return {
    id: `regular-reset-${regularResetForecast.lastCompletedAt}`,
    title: "定期リセット",
    status: "closed",
    opened_at: regularResetForecast.lastCompletedAt,
    closed_at: regularResetForecast.lastCompletedAt,
    completed_at: regularResetForecast.lastCompletedAt,
    window_minutes: 0,
    window_human: "定期実施",
    scope: "全有料プラン",
    summary:
      "1週間サイクルの定期リセットが実施されました。",
  };
}

function getWindowResetTime(value: WindowLike | undefined) {
  const resetAt =
    value?.closed_at ?? value?.completed_at ?? value?.opened_at ?? null;

  if (!resetAt) {
    return 0;
  }

  const time = new Date(resetAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isRegularResetWindow(value: WindowLike | undefined) {
  return Boolean(value?.id?.startsWith("regular-reset-"));
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(value);
}

function getCalendarDayDelta(target: Date, current: Date) {
  const targetDay = getTimeZoneDay(target);
  const currentDay = getTimeZoneDay(current);

  return Math.round((targetDay - currentDay) / DAY_MS);
}

function getTimeZoneDay(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
  );
}

function getActiveWindow(_data: RadarData | null): RadarViewModel["activeWindow"] {
  const officialNotice = getLatestActiveLocalSignal("official_notice");
  const active = Boolean(officialNotice);
  const openedAt = officialNotice?.observedAt ?? null;
  const source = officialNotice?.source ?? null;
  const noticeTitle = officialNotice?.title ?? null;

  if (active) {
    return {
      active,
      kind: "official",
      label: "予告あり",
      summary: noticeTitle
        ? `${noticeTitle} 予告内容を優先して最新状況を確認してください。`
        : "このサイトで確認した公式リセット予告があります。予告内容を優先して最新状況を確認してください。",
      openedAt,
      source,
    };
  }

  return {
    active,
    kind: "none",
    label: "予告なし",
    summary:
      "現時点で、このサイトで確認した公式リセット予告はありません。",
    openedAt,
    source,
  };
}

function getRecommendedAction(
  data: RadarData | null,
  probability24h: number | undefined,
) {
  const activeWindow = getActiveWindow(data);

  if (activeWindow.active) {
    return "公式リセット予告が出ています。リセット前に残り枠を使うか、重要な作業を前倒しする判断を優先してください。";
  }

  const normalized =
    typeof probability24h === "number" ? normalizeProbability(probability24h) : 0;

  if (normalized >= RECOMMENDED_ACTION_THRESHOLDS.high) {
    return "24時間以内の見込みが高い状態です。まだ公式予告ではありませんが、重い作業の前に最新状況を確認すると安心です。";
  }

  if (normalized >= RECOMMENDED_ACTION_THRESHOLDS.medium) {
    return "リセットの可能性はやや高めです。急ぎでない大きな作業は、残り枠と最新情報を見ながら進めるのがおすすめです。";
  }

  if (normalized >= RECOMMENDED_ACTION_THRESHOLDS.watch) {
    return "中程度の見立てです。公式予告はないため、必要な作業は進めながら、数時間おきに変化を確認してください。";
  }

  return translateAction(data?.recommended_action);
}

function getReasoningSummary(
  data: RadarData | null,
  probability24h: number | undefined,
  probability48h: number | undefined,
): string | null {
  return getLocalProbabilityReason(data, probability24h, probability48h);
}

function getRecentHistory(_data: RadarData | null) {
  const items = LOCAL_RESET_HISTORY.filter((item): item is WindowEventLike =>
    Boolean(item?.title),
  );

  const seen = new Set<string>();

  return items
    .map((item) => {
      const isPendingNotice = isPendingResetNotice(item);
      const resetAt = isPendingNotice
        ? null
        : item.closed_at ?? item.completed_at ?? item.opened_at ?? null;
      const key = item.id ?? item.guid ?? `${item.title}-${resetAt ?? item.date ?? ""}`;
      const source = getEventSource(item);

      return {
        key,
        title: translateSourceText(item.title),
        resetType: getResetType(item),
        status: translateEventStatus(item.kind ?? item.status),
        date: item.date ?? resetAt ?? item.opened_at,
        signalAt: item.opened_at ?? item.date ?? null,
        resetAt,
        signalLabel: "検知",
        resetLabel: isPendingNotice ? "実施予定" : "実施",
        scope: translateSourceText(item.scope),
        windowLabel: isPendingNotice ? "予告内容" : undefined,
        windowLength: item.window_human
          ? translateSourceText(item.window_human)
          : formatWindowLength(item.window_minutes),
        source,
      };
    })
    .filter((item) => {
      const dedupeKey = getHistoryDedupeKey(item);

      if (seen.has(dedupeKey)) {
        return false;
      }

      seen.add(dedupeKey);
      return true;
    })
    .sort((a, b) => {
      const aTime = getHistorySortTime(a);
      const bTime = getHistorySortTime(b);
      return bTime - aTime;
    })
    .slice(0, HISTORY_LIMIT);
}

function getHistorySortTime(
  item: Pick<RadarViewModel["recentHistory"][number], "date" | "resetAt" | "signalAt">,
) {
  const value = item.resetAt ?? item.date ?? item.signalAt ?? null;

  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getHistoryDedupeKey(item: RadarViewModel["recentHistory"][number]) {
  const resetAt = item.resetAt ? new Date(item.resetAt).getTime() : null;
  const resetKey =
    typeof resetAt === "number" && !Number.isNaN(resetAt)
      ? String(resetAt)
      : item.resetAt ?? item.date ?? "";

  return `${item.title}-${resetKey}`;
}

function getResetType(item: WindowLike & { kind?: string }) {
  const text = `${item.title ?? ""} ${item.summary ?? ""}`.toLowerCase();

  if (
    text.includes("可靠性") ||
    text.includes("补偿") ||
    text.includes("compensation") ||
    text.includes("reliability") ||
    text.includes("incident") ||
    text.includes("障害") ||
    text.includes("補償")
  ) {
    return "詫びリセット";
  }

  if (
    text.includes("庆祝") ||
    text.includes("celebration") ||
    text.includes("5m") ||
    text.includes("500 万") ||
    text.includes("500万") ||
    text.includes("記念")
  ) {
    return "ご祝儀リセット";
  }

  if (item.kind === "window_opened" || item.status === "open") {
    return "予告付き臨時リセット";
  }

  if (!item.closed_at && !item.completed_at && item.kind !== "reset_completed") {
    return "コミュニティ予測";
  }

  return "その他";
}

function getEventSource(item: WindowLike) {
  if (item.source) {
    return item.source;
  }

  if (item.source_url) {
    return item.source_url;
  }

  if (item.link) {
    return item.link;
  }

  return item.sources?.find((source) => source.url)?.url ?? null;
}

function translateEventStatus(value: string | undefined) {
  switch (value) {
    case "reset_completed":
      return "リセット実施";
    case "window_opened":
      return "予告検知";
    case "window_closed":
    case "closed":
      return "終了";
    case "open":
      return "予告中";
    default:
      return value || "不明";
  }
}

function formatWindowLength(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "不明";
  }

  if (value <= 0) {
    return "即時リセット";
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}時間${minutes}分`;
  }

  if (hours > 0) {
    return `${hours}時間`;
  }

  return `${minutes}分`;
}

function isPendingResetNotice(item: WindowLike & { kind?: string }) {
  return Boolean(
    (item.kind === "window_opened" || item.status === "open") &&
      !item.closed_at &&
      !item.completed_at,
  );
}

function getLocalModelUpdatedAt(openAIStatus?: OpenAIStatusSignals | null) {
  const candidates = [
    LOCAL_MODEL_UPDATED_AT,
    openAIStatus?.updatedAt,
    ...LOCAL_OBSERVATION_SIGNALS.map((signal) => signal.observedAt),
    ...LOCAL_RESET_HISTORY.flatMap((item) => [
      item.closed_at,
      item.completed_at,
      item.opened_at,
      item.date,
    ]),
  ];

  return getLatestIsoDate(candidates) ?? LOCAL_MODEL_UPDATED_AT;
}

function getLocalSignalEnvironment(
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

  return {
    updated_at: getLocalModelUpdatedAt(openAIStatus),
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

function getSignalEnvironment(
  data: RadarData | null,
): NonNullable<RadarData["codex_environment"]> {
  return data?.codex_environment ?? getLocalSignalEnvironment();
}

function getLatestLocalSignal(type: LocalObservationSignal["type"]) {
  return LOCAL_OBSERVATION_SIGNALS.filter((signal) => signal.type === type)
    .sort((a, b) => getDateTime(b.observedAt) - getDateTime(a.observedAt))
    .at(0);
}

function getLatestActiveLocalSignal(type: LocalObservationSignal["type"]) {
  return LOCAL_OBSERVATION_SIGNALS.filter(
    (signal) => signal.type === type && isCurrentLocalSignal(signal),
  )
    .sort((a, b) => getDateTime(b.observedAt) - getDateTime(a.observedAt))
    .at(0);
}

function getEffectiveSignalStatus(signal: LocalObservationSignal) {
  if (signal.resolvedAt) {
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

function isCurrentLocalSignal(signal: LocalObservationSignal) {
  return getEffectiveSignalStatus(signal) === "active";
}

function getPeriodWeightKey(period: "24h" | "48h") {
  return period === "24h" ? "within24h" : "within48h";
}

function getLocalHistoryPressure(period: "24h" | "48h") {
  const lastReset = getLastGlobalResetAt();
  if (!lastReset) {
    return 0;
  }

  const daysSinceLastReset = getCalendarDayDelta(new Date(), lastReset);
  const weightKey = getPeriodWeightKey(period);
  const pressure = LOCAL_PROBABILITY_WEIGHTS.historyPressure.find(
    (item) => daysSinceLastReset <= item.maxDaysSinceReset,
  );

  return pressure?.[weightKey] ?? 0;
}

function getLastGlobalResetAt() {
  const latest = getLatestIsoDate(
    [
      MANUAL_LAST_REGULAR_RESET_AT,
      ...LOCAL_RESET_HISTORY.map(getCompletedResetAt),
    ],
  );

  return latest ? new Date(latest) : null;
}

function getCompletedResetAt(item: WindowEventLike) {
  if (isPendingResetNotice(item) || item.status === "active") {
    return null;
  }

  if (item.closed_at || item.completed_at) {
    return item.closed_at ?? item.completed_at ?? null;
  }

  return item.kind === "reset_completed" ? item.opened_at ?? item.date ?? null : null;
}

function getLatestIsoDate(values: Array<string | null | undefined>) {
  const latest = values
    .map((value) => (value ? new Date(value) : null))
    .filter((value): value is Date => Boolean(value && !Number.isNaN(value.getTime())))
    .sort((a, b) => b.getTime() - a.getTime())
    .at(0);

  return latest?.toISOString() ?? null;
}

function getDateTime(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isWithinHours(value: string, hours: number) {
  const time = getDateTime(value);
  if (!time) {
    return false;
  }

  return Date.now() - time <= hours * 60 * 60 * 1000;
}

function getLocalExpectationLevel(data: RadarData | null) {
  const probability24h = getLocalResetProbability(data, "24h");
  return getExpectationLabel(probability24h);
}

function getLocalResetProbability(
  data: RadarData | null,
  period: "24h" | "48h",
) {
  const isOfficialWindow = Boolean(getLatestActiveLocalSignal("official_notice"));
  const weightKey = getPeriodWeightKey(period);

  if (isOfficialWindow) {
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

function getLocalProbabilityReason(
  data: RadarData | null,
  probability24h: number | undefined,
  probability48h: number | undefined,
) {
  const environment = getSignalEnvironment(data);
  const isOfficialWindow = Boolean(getLatestActiveLocalSignal("official_notice"));

  if (isOfficialWindow) {
    return "公式リセット予告があるため、通常より高めに見ています。";
  }

  const p24 = probabilityToPercent(probability24h);
  const p48 = probabilityToPercent(probability48h);
  const statusIncidents = environment.status_incidents_24h ?? 0;
  const activeStatusIncidents =
    environment.openai_status_active_codex_incidents ?? 0;
  const issueAnomalies = environment.issue_or_limit_anomalies_24h ?? 0;
  const communityMentions = environment.community_mentions_24h ?? 0;
  const officialIncidentHints = environment.official_incident_hints_24h ?? 0;
  const officialUpdates = environment.official_updates_24h ?? 0;
  const lastReset = getLastGlobalResetAt();
  const lastResetLabel = lastReset
    ? `${getCalendarDayDelta(new Date(), lastReset)}日経過`
    : "不明";
  const signals: Array<string> = [];

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

  const hintSummary =
    officialIncidentHints > 0
      ? "公式寄りの障害・容量到達に関する投稿があり、詫びリセット要因が強まっています。"
      : null;
  const signalSummary =
    signals.length > 0
      ? `${signals.join("、")}が見られます。`
      : "目立った公式予告や障害情報は見られません。";

  return `現在の見立ては24時間以内${p24}・48時間以内${p48}です。直近のリセットから${lastResetLabel}で、${hintSummary ?? signalSummary}`;
}

function clampCount(value: number | undefined, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(max, Math.max(min, value));
}

function getProbability(
  data: RadarData | null,
  period: "24h" | "48h",
): number | undefined {
  return getLocalResetProbability(data, period);
}

function getLatestWindow(data: RadarData | null): WindowLike | undefined {
  if (!data) {
    return undefined;
  }

  const direct = [
    data.recent_windows?.[0],
    data.window,
    data.last_window,
    data.latest_reset,
    data.last_reset,
    data.latest_window,
    getObject<WindowLike>(data, ["latestReset", "lastReset", "lastWindow"]),
  ].find((item) => item?.title);

  if (direct) {
    return direct;
  }

  const events = data.prediction?.probability_history?.events;
  const latestEvent = events
    ?.filter((event) => event.title)
    .slice()
    .reverse()
    .find((event) =>
      ["reset_completed", "window_closed", "window_opened"].includes(
        event.kind ?? "",
      ),
    );

  return latestEvent;
}

function unwrapRadarData(data: RadarData | null): RadarData | null {
  if (!data) {
    return null;
  }

  return data.data ?? data.result ?? data.current ?? data;
}

function normalizeProbability(value: number) {
  if (value > 1) {
    return value / 100;
  }

  return value;
}

function getString(
  source: Record<string, unknown> | null | undefined,
  paths: string[],
) {
  const value = getValue(source, paths);
  return typeof value === "string" ? value : undefined;
}

function getObject<T>(
  source: Record<string, unknown> | null | undefined,
  paths: string[],
) {
  const value = getValue(source, paths);
  return value && typeof value === "object" ? (value as T) : undefined;
}

function getValue(
  source: Record<string, unknown> | null | undefined,
  paths: string[],
) {
  if (!source) {
    return undefined;
  }

  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      return (current as Record<string, unknown>)[key];
    }, source);

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}
