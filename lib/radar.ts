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

// 分割したモジュールから型やヘルパー、確率計算をインポート
import type { Locale, ProbabilityLevel, RadarData, WindowLike, WindowEventLike, RadarViewModel, CachedRadarData } from "./radar/types";
import {
  translateUI,
  translateDynamic,
  translateExpectation,
} from "./radar/i18n";
import {
  probabilityToPercent,
  normalizeProbability,
  getExpectationLabel,
  getRefreshIntervalMs,
  getRefreshIntervalLabel,
  formatDateTime,
  formatDateTimeCompact,
  formatTime,
  translateStatus,
  translateAction,
  isSafeHttpUrl,
  formatDate,
  getCalendarDayDelta,
  getTimeZoneDay,
  formatWindowLength,
  getLatestIsoDate,
  getDateTime,
  isWithinHours,
  getHoursUntil,
  isUpcomingWithinHours,
  DISPLAY_TIME_ZONE,
  DAY_MS,
} from "./radar/helpers";
import {
  getLocalResetProbability,
  getLocalSignalEnvironment,
  getSignalEnvironment,
  getLatestActiveLocalSignal,
  getEffectiveSignalStatus,
  isCurrentLocalSignal,
  getLocalHistoryPressure,
  getElapsedDayBoost,
  getDaysSinceLastGlobalReset,
  getLastGlobalResetAt,
  getLocalExpectationLevel,
  getLocalProbabilityReason,
} from "./radar/probability";

// 再エクスポート（外部ファイルからのインポート互換性を維持）
export type { Locale, ProbabilityLevel, RadarData, WindowLike, WindowEventLike, RadarViewModel, CachedRadarData };
export {
  probabilityToPercent,
  getExpectationLabel,
  getRefreshIntervalMs,
  getRefreshIntervalLabel,
  formatDateTime,
  isSafeHttpUrl,
};

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

export function getRadarViewModel(data: RadarData | null, locale: Locale = "ja"): RadarViewModel {
  const source = unwrapRadarData(data);
  const probability24h = getProbability(source, "24h");
  const probability48h = getProbability(source, "48h");
  const predictionLevel = getLocalExpectationLevel(source, locale);
  const observedLatestWindow = getLatestWindow(source);
  const observedHistory = getRecentHistory(source, locale);
  const latestCompletedLocalWindow = getLatestCompletedLocalWindow();
  const latestObservedResetAt =
    observedHistory.find((item) => item.resetAt)?.resetAt ?? null;
  const regularResetForecast = getRegularResetForecast(
    latestObservedResetAt,
    locale
  );
  const latestWindow =
    getLatestWindowWithRegularReset(
      observedLatestWindow ?? latestCompletedLocalWindow,
      regularResetForecast,
      locale
    ) ?? latestCompletedLocalWindow;
  const activeWindow = getDisplayResetNotice(getActiveWindow(source, locale));
  const recentHistory = addPersonalResetEventsToHistory(
    addRegularResetForecastToHistory(observedHistory, regularResetForecast, locale),
    locale
  );

  return {
    status: translateStatus(
      getString(source, ["status", "current_window.state"]),
      source?.window_open,
      locale
    ),
    expectation: predictionLevel ?? getExpectationLabel(probability24h, locale),
    probability24h,
    probability48h,
    action: getRecommendedAction(source, probability24h, locale),
    lastUpdated:
      source?.checked_at ??
      source?.monitored_at ??
      source?.updated_at ??
      source?.prediction?.updated_at ??
      null,
    regularResetForecast,
    activeWindow,
    reasoningSummary: getReasoningSummary(source, probability24h, probability48h, locale),
    latestWindow: {
      kind: isRegularResetWindow(latestWindow) ? "regular" : "observed",
      title: translateDynamic(latestWindow?.title, locale),
      summary: latestWindow?.summary
        ? translateDynamic(latestWindow.summary, locale)
        : (locale === "en" ? "No summary is available." : locale === "zh" ? "未能获取概要。" : "概要は取得できていません。"),
      scopeLabel: latestWindow?.scopeLabel ? translateDynamic(latestWindow.scopeLabel, locale) : undefined,
      scope: translateDynamic(latestWindow?.scope, locale),
      openedAt: latestWindow?.opened_at ?? null,
      closedAt:
        latestWindow?.closed_at ??
        latestWindow?.completed_at ??
        latestWindow?.opened_at ??
        null,
      windowLabel: latestWindow?.windowLabel ? translateDynamic(latestWindow.windowLabel, locale) : undefined,
      windowLength: latestWindow?.window_human
        ? translateDynamic(latestWindow.window_human, locale)
        : formatWindowLength(latestWindow?.window_minutes, locale),
    },
    recentHistory,
  };
}

function getRegularResetForecast(latestResetAt: string | null | undefined, locale: Locale = "ja") {
  const manualNextRegularReset = new Date(MANUAL_NEXT_REGULAR_RESET_AT);
  const hasManualNextRegularReset = !Number.isNaN(manualNextRegularReset.getTime());
  const manualLastRegularReset = new Date(MANUAL_LAST_REGULAR_RESET_AT);
  const current = new Date();
  const hasManualLastRegularReset =
    !Number.isNaN(manualLastRegularReset.getTime()) &&
    manualLastRegularReset.getTime() <= current.getTime();

  const unknownLabel = locale === "en" ? "Unknown" : locale === "zh" ? "未知" : "不明";
  const remainingUnknown = locale === "en" ? "Unknown remaining" : locale === "zh" ? "剩余时间未知" : "残り不明";

  if (
    !latestResetAt &&
    !hasManualNextRegularReset &&
    !hasManualLastRegularReset
  ) {
    return {
      date: unknownLabel,
      time: null,
      remaining: remainingUnknown,
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
      date: unknownLabel,
      time: null,
      remaining: remainingUnknown,
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

  let remainingText = "";
  if (remainingDays > 0) {
    remainingText = locale === "en" ? `${remainingDays} day${remainingDays !== 1 ? "s" : ""} left` : locale === "zh" ? `剩余 ${remainingDays} 天` : `残り${remainingDays}日`;
  } else if (remainingDays === 0) {
    remainingText = locale === "en" ? "0 days left" : locale === "zh" ? "剩余 0 天" : "残り0日";
  } else {
    remainingText = locale === "en" ? "Past expected date" : locale === "zh" ? "已超过预计日期" : "予想日を過ぎています";
  }

  const bcp47 = locale === "en" ? "en-US" : locale === "zh" ? "zh-CN" : "ja-JP";
  const formattedDate = new Intl.DateTimeFormat(bcp47, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(nextRegularReset);

  return {
    date: formattedDate,
    time:
      hasManualNextRegularReset && MANUAL_NEXT_REGULAR_RESET_TIME_CONFIRMED
        ? formatTime(nextRegularReset)
        : null,
    remaining: remainingText,
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
  locale: Locale = "ja",
) {
  if (!regularResetForecast.expectedAt) {
    return history;
  }

  const regularItems: RadarViewModel["recentHistory"] = [];

  if (
    regularResetForecast.lastCompletedAt &&
    !hasHistoryResetAt(history, regularResetForecast.lastCompletedAt)
  ) {
    regularItems.push({
      key: `regular-reset-completed-${regularResetForecast.lastCompletedAt}`,
      title: translateDynamic("定期リセット", locale),
      resetType: translateDynamic("定期リセット", locale),
      resetTypes: [translateDynamic("定期リセット", locale)],
      status: translateDynamic("終了", locale),
      date: regularResetForecast.lastCompletedAt,
      signalAt: null,
      resetAt: regularResetForecast.lastCompletedAt,
      signalLabel: "",
      resetLabel: translateDynamic("実施", locale),
      scope: translateDynamic("全有料プラン", locale),
      windowLength: translateDynamic("定期実施", locale),
      source: null,
      details: {
        cycleType: translateDynamic("定期リセット", locale),
        reasonType: translateDynamic("通常更新", locale),
        resetMethod: translateDynamic("強制リセット", locale),
        scope: translateDynamic("全有料プラン", locale),
        noticeToExecution: translateDynamic("定期実施", locale),
        note: translateDynamic("1週間サイクルの定期リセットが実施されました。", locale),
      },
    });
  }

  const sortedHistory = [...regularItems, ...history].sort((a, b) => {
    const aTime = getHistorySortTime(a);
    const bTime = getHistorySortTime(b);
    return bTime - aTime;
  });

  return sortedHistory.slice(0, HISTORY_LIMIT);
}

function addPersonalResetEventsToHistory(
  history: RadarViewModel["recentHistory"],
  locale: Locale = "ja",
) {
  const seen = new Set(history.map((item) => item.key));
  const personalItems = LOCAL_PERSONAL_RESET_HISTORY.filter(
    (item) => !seen.has(item.key),
  ).map((item) => {
    const itemAsWindow: WindowLike = {
      title: item.title,
      scope: item.scope,
      summary: item.summary ?? undefined,
      window_human: item.windowLength,
      details: item.details,
    };

    // 任意リセット履歴アイテムの多言語化
    return {
      ...item,
      title: translateDynamic(item.title, locale),
      resetType: translateDynamic(item.resetType, locale),
      resetTypes: item.resetTypes?.map(t => translateDynamic(t, locale)) ?? [translateDynamic(item.resetType, locale)],
      status: translateDynamic(item.status, locale),
      signalLabel: item.signalLabel ? translateDynamic(item.signalLabel, locale) : "",
      resetLabel: item.resetLabel ? translateDynamic(item.resetLabel, locale) : "",
      scopeLabel: item.scopeLabel ? translateDynamic(item.scopeLabel, locale) : undefined,
      scope: translateDynamic(item.scope, locale),
      windowLabel: item.windowLabel ? translateDynamic(item.windowLabel, locale) : undefined,
      windowLength: translateDynamic(item.windowLength, locale),
      summary: item.summary ? translateDynamic(item.summary, locale) : null,
      details: getHistoryDetails(itemAsWindow, locale),
    };
  });

  return [...personalItems, ...history]
    .sort((a, b) => getHistorySortTime(b) - getHistorySortTime(a))
    .slice(0, HISTORY_LIMIT);
}

function getLatestWindowWithRegularReset(
  latestWindow: WindowLike | undefined,
  regularResetForecast: RadarViewModel["regularResetForecast"],
  locale: Locale = "ja",
): WindowLike | undefined {
  if (!regularResetForecast.lastCompletedAt) {
    return latestWindow;
  }

  const regularResetTime = new Date(regularResetForecast.lastCompletedAt).getTime();
  const latestWindowTime = getWindowResetTime(latestWindow);

  if (latestWindowTime >= regularResetTime) {
    return latestWindow;
  }

  return {
    id: `regular-reset-${regularResetForecast.lastCompletedAt}`,
    title: translateDynamic("定期リセット", locale),
    status: "closed",
    opened_at: regularResetForecast.lastCompletedAt,
    closed_at: regularResetForecast.lastCompletedAt,
    completed_at: regularResetForecast.lastCompletedAt,
    window_minutes: 0,
    window_human: translateDynamic("定期実施", locale),
    scope: translateDynamic("全有料プラン", locale),
    summary: translateDynamic("1週間サイクルの定期リセットが実施されました。", locale),
  };
}

function getLatestCompletedLocalWindow(): WindowLike | undefined {
  const globalHistory = getCombinedResetHistory();

  const personalEvents = LOCAL_PERSONAL_RESET_HISTORY.map((item): WindowLike => {
    return {
      id: item.key,
      title: item.title,
      status: "closed",
      opened_at: item.signalAt ?? item.date ?? null,
      closed_at: item.date ?? item.resetAt ?? null,
      completed_at: item.date ?? item.resetAt ?? null,
      window_minutes: 0,
      window_human: item.windowLength,
      scopeLabel: item.scopeLabel,
      scope: item.scope,
      summary: item.summary ?? undefined,
      windowLabel: item.windowLabel,
    };
  });

  const allEvents = [...globalHistory, ...personalEvents];

  return allEvents.filter((item) => getCompletedResetAt(item))
    .sort((a, b) => {
      const aTime = getDateTime(getCompletedResetAt(a));
      const bTime = getDateTime(getCompletedResetAt(b));
      return bTime - aTime;
    })
    .at(0);
}

function hasHistoryResetAt(
  history: RadarViewModel["recentHistory"],
  resetAt: string,
) {
  const resetTime = getDateTime(resetAt);

  return history.some((item) => getDateTime(item.resetAt) === resetTime);
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

function getHistoryText(item: WindowLike & { kind?: string }) {
  return `${item.title ?? ""} ${item.summary ?? ""} ${item.window_human ?? ""} ${item.scope ?? ""}`.toLowerCase();
}

function getHistoryCycleType(item: WindowLike & { kind?: string }, locale: Locale) {
  const text = getHistoryText(item);

  if (text.includes("定期") || text.includes("weekly") || text.includes("1週間サイクル")) {
    return translateDynamic("定期リセット", locale);
  }

  if (
    text.includes("任意") ||
    text.includes("manual reset") ||
    text.includes("referral") ||
    text.includes("招待")
  ) {
    return translateDynamic("個人別リセット", locale);
  }

  return translateDynamic("ランダムリセット", locale);
}

function getHistoryReasonType(item: WindowLike & { kind?: string }, locale: Locale) {
  const text = getHistoryText(item);

  if (text.includes("定期") || text.includes("weekly") || text.includes("1週間サイクル")) {
    return translateDynamic("通常更新", locale);
  }

  if (
    text.includes("可靠性") ||
    text.includes("补偿") ||
    text.includes("compensation") ||
    text.includes("reliability") ||
    text.includes("incident") ||
    text.includes("障害") ||
    text.includes("補償") ||
    text.includes("詫び") ||
    text.includes("不具合") ||
    text.includes("bug") ||
    text.includes("rate limit") ||
    text.includes("レート制限")
  ) {
    return translateDynamic("詫びリセット", locale);
  }

  if (
    text.includes("庆祝") ||
    text.includes("celebration") ||
    text.includes("5m") ||
    text.includes("500 万") ||
    text.includes("500万") ||
    text.includes("記念") ||
    text.includes("milestone")
  ) {
    return translateDynamic("ご祝儀リセット", locale);
  }

  return translateDynamic("その他", locale);
}

function getHistoryResetMethod(item: WindowLike & { kind?: string }, locale: Locale) {
  const text = getHistoryText(item);

  if (text.includes("定期") || text.includes("weekly") || text.includes("1週間サイクル")) {
    return translateDynamic("利用上限更新", locale);
  }

  if (
    text.includes("任意") ||
    text.includes("manual reset") ||
    text.includes("credit") ||
    text.includes("配布")
  ) {
    return translateDynamic("任意リセット権1回配布", locale);
  }

  if (
    item.kind === "reset_completed" ||
    item.kind === "window_closed" ||
    item.closed_at ||
    item.completed_at ||
    text.includes("強制") ||
    text.includes("forced") ||
    text.includes("フルリセット") ||
    text.includes("reset")
  ) {
    return translateDynamic("強制リセット", locale);
  }

  return translateDynamic("不明", locale);
}

function getHistoryNoticeToExecution(item: WindowLike & { kind?: string }, locale: Locale) {
  if (item.window_human) {
    return translateDynamic(item.window_human, locale);
  }

  if (typeof item.window_minutes === "number") {
    return formatWindowLength(item.window_minutes, locale);
  }

  return translateDynamic("不明", locale);
}

function getHistoryDetails(
  item: WindowLike & { kind?: string },
  locale: Locale,
): NonNullable<RadarViewModel["recentHistory"][number]["details"]> {
  if (item.details) {
    return {
      cycleType: translateDynamic(item.details.cycleType, locale),
      reasonType: translateDynamic(item.details.reasonType, locale),
      resetMethod: translateDynamic(item.details.resetMethod, locale),
      scope: translateDynamic(item.details.scope, locale),
      noticeToExecution: translateDynamic(item.details.noticeToExecution, locale),
      note: item.details.note ? translateDynamic(item.details.note, locale) : null,
    };
  }

  const scope = item.scope ? translateDynamic(item.scope, locale) : translateDynamic("不明", locale);

  return {
    cycleType: getHistoryCycleType(item, locale),
    reasonType: getHistoryReasonType(item, locale),
    resetMethod: getHistoryResetMethod(item, locale),
    scope,
    noticeToExecution: getHistoryNoticeToExecution(item, locale),
    note: item.summary ? translateDynamic(item.summary, locale) : null,
  };
}

function getResetTypes(item: WindowLike & { kind?: string }, locale: Locale = "ja") {
  const text = `${item.title ?? ""} ${item.summary ?? ""}`.toLowerCase();

  const types: Array<string> = [];

  if (text.includes("1週間サイクル") || text.includes("定期") || text.includes("weekly")) {
    types.push(translateDynamic("定期リセット", locale));
  }

  if (
    text.includes("可靠性") ||
    text.includes("补偿") ||
    text.includes("compensation") ||
    text.includes("reliability") ||
    text.includes("incident") ||
    text.includes("障害") ||
    text.includes("補償") ||
    text.includes("rate limit") ||
    text.includes("レート制限")
  ) {
    types.push(translateDynamic("詫びリセット", locale));
  }

  if (
    text.includes("庆祝") ||
    text.includes("celebration") ||
    text.includes("5m") ||
    text.includes("500 万") ||
    text.includes("500万") ||
    text.includes("記念") ||
    text.includes("milestone")
  ) {
    types.push(translateDynamic("ご祝儀リセット", locale));
  }

  if (item.kind === "window_opened" || item.status === "open") {
    types.push(translateDynamic("予告付き臨時リセット", locale));
  }

  if (!item.closed_at && !item.completed_at && item.kind !== "reset_completed") {
    types.push(translateDynamic("コミュニティ予測", locale));
  }

  if (types.length === 0) {
    types.push(translateDynamic("その他", locale));
  }

  return Array.from(new Set(types));
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

function translateEventStatus(value: string | undefined, locale: Locale = "ja") {
  switch (value) {
    case "reset_completed":
      return translateDynamic("リセット実施", locale);
    case "window_opened":
      return translateDynamic("予告検知", locale);
    case "window_closed":
    case "closed":
      return translateDynamic("終了", locale);
    case "open":
      return translateDynamic("予告中", locale);
    default:
      return value ? translateDynamic(value, locale) : (locale === "en" ? "Unknown" : locale === "zh" ? "未知" : "不明");
  }
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
    ...getCombinedResetHistory().flatMap((item) => [
      item.closed_at,
      item.completed_at,
      item.opened_at,
      item.date,
    ]),
  ];

  return getLatestIsoDate(candidates) ?? LOCAL_MODEL_UPDATED_AT;
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

function getRecentHistory(_data: RadarData | null, locale: Locale = "ja") {
  const items = getCombinedResetHistory().filter((item): item is WindowEventLike =>
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
        title: translateDynamic(item.title, locale),
        resetType: getResetTypes(item, locale)[0],
        resetTypes: getResetTypes(item, locale),
        status: translateEventStatus(item.kind ?? item.status, locale),
        details: getHistoryDetails(item, locale),
        date: item.date ?? resetAt ?? item.opened_at,
        signalAt: item.opened_at ?? item.date ?? null,
        resetAt,
        signalLabel: translateDynamic("検知", locale),
        resetLabel: isPendingNotice ? translateDynamic("実施予定", locale) : translateDynamic("実施", locale),
        scope: translateDynamic(item.scope, locale),
        windowLabel: isPendingNotice ? translateDynamic("予告内容", locale) : undefined,
        windowLength: item.window_human
          ? translateDynamic(item.window_human, locale)
          : formatWindowLength(item.window_minutes, locale),
        source,
        summary: item.summary ? translateDynamic(item.summary, locale) : null,
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

function getActiveWindow(_data: RadarData | null, locale: Locale = "ja"): RadarViewModel["activeWindow"] {
  const officialNotice = getLatestActiveLocalSignal("official_notice");
  const active = Boolean(officialNotice);
  const openedAt = officialNotice?.observedAt ?? null;
  const expectedAt = officialNotice?.expectedAt ?? null;
  const source = officialNotice?.source ?? null;
  const noticeTitle = officialNotice?.title ?? null;

  if (active) {
    let summary = "";
    if (noticeTitle) {
      const transTitle = translateDynamic(noticeTitle, locale);
      summary = locale === "en"
        ? `${transTitle} Please prioritize checking the details of the official notice.`
        : locale === "zh"
          ? `${transTitle} 请优先确认官方预告的详细内容。`
          : `${transTitle} 予告内容を優先して最新状況を確認してください。`;
    } else {
      summary = locale === "en"
        ? "An official reset notice has been detected. Please prioritize checking the notice."
        : locale === "zh"
          ? "已检测到官方重置预告。请优先确认预告内容。"
          : "このサイトで確認した公式リセット予告があります。予告内容を優先して最新状況を確認してください。";
    }

    return {
      active,
      kind: "official",
      label: translateDynamic("予告中", locale),
      summary,
      openedAt,
      expectedAt,
      source,
      sourceLabel: translateDynamic(officialNotice?.sourceLabel ?? "Codexに表示あり", locale),
    };
  }

  return {
    active,
    kind: "none",
    label: translateDynamic("予告なし", locale),
    summary: locale === "en"
      ? "At this moment, there are no official reset notices detected."
      : locale === "zh"
        ? "目前未检测到官方重置预告。"
        : "現時点で、このサイトで確認した公式リセット予告はありません。",
    openedAt,
    expectedAt,
    source,
    sourceLabel: null,
  };
}

function getRecommendedAction(
  data: RadarData | null,
  probability24h: number | undefined,
  locale: Locale = "ja",
) {
  const activeWindow = getActiveWindow(data, locale);

  if (activeWindow.active) {
    return locale === "en"
      ? "An official reset notice is active. Prioritize using up your remaining quota or plan your work ahead."
      : locale === "zh"
        ? "官方重置预告已发布。请优先在重置前使用剩余额度，或提前调整重要工作的安排。"
        : "公式リセット予告が出ています。リセット前に残り枠を使うか、重要な作業を前倒しする判断を優先してください。";
  }

  const normalized =
    typeof probability24h === "number" ? normalizeProbability(probability24h) : 0;

  if (normalized >= RECOMMENDED_ACTION_THRESHOLDS.high) {
    return locale === "en"
      ? "High probability within 24 hours. While not an official notice yet, checking the status before heavy tasks is recommended."
      : locale === "zh"
        ? "预计 24 小时内有极高重置可能。虽然尚未发布官方预告，但在执行繁重任务前确认最新状况会更为稳妥。"
        : "24時間以内の見込みが高い状態です。まだ公式予告ではありませんが、重い作業の前に最新状況を確認すると安心です。";
  }

  if (normalized >= RECOMMENDED_ACTION_THRESHOLDS.medium) {
    return locale === "en"
      ? "Reset probability is slightly elevated. Consider watching the status and quota while carrying out non-urgent heavy tasks."
      : locale === "zh"
        ? "重置的可能性略高。建议边观察剩余额度和最新信息，边安排非紧急的大型任务。"
        : "リセットの可能性はやや高めです。急ぎでない大きな作業は、残り枠と最新情報を見ながら進めるのがおすすめです。";
  }

  if (normalized >= RECOMMENDED_ACTION_THRESHOLDS.watch) {
    return locale === "en"
      ? "Moderate probability. No official notices; continue with your work while checking status updates every few hours."
      : locale === "zh"
        ? "中等期望度。由于没有官方预告，可在继续进行常规工作的同时，每隔几小时确认一次状态变化。"
        : "中程度の見立てです。公式予告はないため、必要な作業は進めながら、数時間おきに変化を確認してください。";
  }

  return locale === "en"
    ? "Low reset probability. You can proceed with your tasks as usual."
    : locale === "zh"
      ? "重置概率较低。您可以照常进行各项工作。"
      : "リセットの可能性は低いです。通常通り作業を進めて問題ありません。";
}

function getReasoningSummary(
  data: RadarData | null,
  probability24h: number | undefined,
  probability48h: number | undefined,
  locale: Locale = "ja",
): string | null {
  return getLocalProbabilityReason(data, probability24h, probability48h, locale);
}

function isRegularResetWindow(value: WindowLike | undefined) {
  return Boolean(value?.id?.startsWith("regular-reset-") || value?.title?.includes("定期"));
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

function getCompletedResetAt(item: WindowEventLike) {
  if (isPendingResetNotice(item) || item.status === "active") {
    return null;
  }

  if (item.closed_at || item.completed_at) {
    return item.closed_at ?? item.completed_at ?? null;
  }

  return item.kind === "reset_completed" ? item.opened_at ?? item.date ?? null : null;
}

function getCombinedResetHistory(): Array<WindowEventLike> {
  const autoResolvedSignals = LOCAL_OBSERVATION_SIGNALS.filter(
    (sig) => sig.type === "official_notice" && getEffectiveSignalStatus(sig) === "resolved" && !sig.skipAutoHistoryMerge
  );

  const autoResolvedItems = autoResolvedSignals.map((sig): WindowEventLike => {
    let title = "臨時リセット";
    if (sig.id.includes("regular") || sig.title.includes("定期") || sig.keywords?.includes("weekly") || sig.keywords?.includes("定期")) {
      title = "定期リセット";
    } else if (sig.title.includes("補償") || sig.title.includes("障害") || sig.title.includes("詫び") || sig.keywords?.includes("補償") || sig.keywords?.includes("詫び")) {
      title = "詫びリセット";
    }

    return {
      id: sig.id,
      title: title,
      kind: "reset_completed",
      status: "closed",
      opened_at: sig.observedAt,
      closed_at: sig.expectedAt ?? sig.observedAt,
      completed_at: sig.expectedAt ?? sig.observedAt,
      window_minutes: 0,
      window_human: sig.title.includes("任意") || sig.title.includes("マニュアル") ? "任意リセット配布" : "リセット実施",
      scope: "全有料プラン",
      summary: sig.title,
      source_url: sig.source ?? null,
    };
  });

  return [...LOCAL_RESET_HISTORY, ...autoResolvedItems];
}
