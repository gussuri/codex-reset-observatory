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
  LOCAL_RESET_HISTORY,
  MANUAL_LAST_REGULAR_RESET_AT,
  MANUAL_NEXT_REGULAR_RESET_AT,
  MANUAL_NEXT_REGULAR_RESET_TIME_CONFIRMED,
  MANUAL_SCHEDULE_ANCHOR_AT,
} from "@/data/resetHistory";
import type {
  OpenAIStatusHistoryItem,
  OpenAIStatusSignals,
} from "@/lib/openaiStatus";

// 分割したモジュールから型やヘルパー、確率計算をインポート
import type { ActiveTiboSignal, HistoryRecordKind, HistorySourceKind, Locale, ProbabilityLevel, RadarData, RadarDataHealth, WindowLike, WindowEventLike, RadarViewModel, CachedRadarData, PublicRadarSnapshot, PublicRadarViewModel } from "./radar/types";
import { combineResetHistory } from "./radar/tiboHistory";
import { isBroadResetScope, isEligibleRandomResetEvent } from "./radar/resetEligibility";
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
  formatElapsedResetDuration,
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
  getActiveOfficialNotice,
  getLocalSignalEnvironment,
  getLocalSignalEvaluation,
  getSignalEnvironment,
  getLatestActiveLocalSignal,
  getEffectiveSignalStatus,
  isCurrentLocalSignal,
  getLocalHistoryPressure,
  getElapsedDayBoost,
  getDaysSinceLastGlobalReset,
  getCompletedResetTimestamp,
  getLastGlobalResetAt,
  getDisplayProbabilityReason,
  getLocalProbabilityReason,
  type LocalSignalEvaluation,
} from "./radar/probability";
import { calculatePublishedProbability } from "./radar/publishedProbability";

// 再エクスポート（外部ファイルからのインポート互換性を維持）
export type { Locale, ProbabilityLevel, RadarData, WindowLike, WindowEventLike, RadarViewModel, CachedRadarData, PublicRadarSnapshot, PublicRadarViewModel };
export type { HistoryRecordKind, HistorySourceKind };
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
  checkedAt,
  calculationNow,
  dataHealth,
  activeTiboSignals = [],
  recentTiboSignals,
  formalTiboResets = [],
  rejectedTiboResets = [],
  regularResetEvents = [],
}: {
  openAIStatus?: OpenAIStatusSignals | null;
  checkedAt?: string;
  calculationNow?: Date;
  dataHealth?: RadarDataHealth;
  activeTiboSignals?: RadarData["active_tibo_signals"];
  recentTiboSignals?: RadarData["recent_tibo_signals"];
  formalTiboResets?: RadarData["formal_tibo_resets"];
  rejectedTiboResets?: RadarData["rejected_tibo_resets"];
  regularResetEvents?: RadarData["regular_reset_events"];
} = {}): RadarData {
  const now = calculationNow ?? new Date();
  const resolvedCheckedAt = checkedAt ?? now.toISOString();
  const updatedAt = getLocalModelUpdatedAt(openAIStatus, {
    formal_tibo_resets: formalTiboResets,
    rejected_tibo_resets: rejectedTiboResets,
    regular_reset_events: regularResetEvents,
  });

  return {
    schema_version: "local-v1",
    service: "codex-reset-observatory",
    purpose: "local-reset-observation",
    timezone: DISPLAY_TIME_ZONE,
    checked_at: resolvedCheckedAt,
    data_health: dataHealth,
    monitored_at: resolvedCheckedAt,
    updated_at: updatedAt,
    status: "none",
    window_open: false,
    openai_status_history: openAIStatus?.history ?? [],
    codex_environment: getLocalSignalEnvironment(openAIStatus, now),
    active_tibo_signals: activeTiboSignals,
    recent_tibo_signals: recentTiboSignals,
    formal_tibo_resets: formalTiboResets,
    rejected_tibo_resets: rejectedTiboResets,
    regular_reset_events: regularResetEvents,
  };
}

export function getRadarViewModel(
  data: RadarData | null,
  locale: Locale = "ja",
  limitHistory: boolean = true,
  signalEvaluationOverride?: LocalSignalEvaluation,
  calculationNow: Date = new Date(),
): RadarViewModel {
  const source = unwrapRadarData(data);
  const signalEvaluation =
    signalEvaluationOverride ?? getLocalSignalEvaluation(source, calculationNow);
  const activeOfficialNotice = getActiveOfficialNotice(
    source,
    signalEvaluation.latestResetAt,
    calculationNow,
  );
  const observedLatestWindow = getLatestWindow(source);
  const observedHistory = getRecentHistory(source, locale, limitHistory);
  const latestCompletedLocalWindow = getLatestCompletedLocalWindow(source);
  const effectiveLatestResetAt = getLastGlobalResetAt(source, calculationNow)?.toISOString() ??
    observedHistory.find((item) => item.resetAt)?.resetAt ??
    null;

  const regularResetForecast = getRegularResetForecast(
    effectiveLatestResetAt,
    locale,
    source,
    calculationNow,
  );
  const probabilityCalculation = calculatePublishedProbability(source, {
    now: calculationNow,
    signalEvaluation,
    activeOfficialNotice,
    regularResetExpectedAt: regularResetForecast.expectedAt,
  });
  const probability12h = probabilityCalculation.probability12h;
  const probability24h = probabilityCalculation.probability24h;
  const probability48h = probabilityCalculation.probability48h;
  const probability72h = probabilityCalculation.probability72h;
  const predictionLevel = getExpectationLabel(
    { p24h: probability24h, p48h: probability48h },
    locale,
  );
  const latestWindow =
    (observedLatestWindow && getHistoryRecordKind(observedLatestWindow) === "confirmed_global"
      ? observedLatestWindow
      : undefined) ?? latestCompletedLocalWindow;
  const activeWindow = getDisplayResetNotice(getActiveWindow(activeOfficialNotice, locale));
  const recentHistory = addPersonalResetEventsToHistory(
    observedHistory,
    locale,
    limitHistory
  );

  return {
    status: translateStatus(
      getString(source, ["status", "current_window.state"]),
      source?.window_open,
      locale
    ),
    expectation: predictionLevel ?? getExpectationLabel({ p24h: probability24h, p48h: probability48h }, locale),
    probability12h,
    probability24h,
    probability48h,
    probability72h,
    action: getRecommendedAction(activeWindow, probability24h, locale),
    lastUpdated:
      source?.checked_at ??
      source?.monitored_at ??
      source?.updated_at ??
      source?.prediction?.updated_at ??
      null,
    regularResetForecast,
    activeWindow,
    reasoningSummary: getLocalProbabilityReason(
      source,
      probability24h,
      probability48h,
      locale,
      signalEvaluation,
      activeOfficialNotice,
      true,
      calculationNow,
      probability12h,
      probability72h,
    ),
    displayReasoningSummary: getDisplayProbabilityReason(
      source,
      probability24h,
      probability48h,
      locale,
      signalEvaluation,
      activeOfficialNotice,
      calculationNow,
    ),
    latestWindow: {
      kind: isRegularResetWindow(latestWindow) ? "regular" : "observed",
      recordKind: latestWindow ? getHistoryRecordKind(latestWindow) : undefined,
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
      source: getEventSource(latestWindow ?? {}),
      sourceKind: getHistorySourceKind(latestWindow ?? {}),
    },
    recentHistory,
  };
}

function getLatestRegularOrForcedResetAt(
  data?: RadarData | null,
  now: Date = new Date(),
): string | null {
  let latestTime = 0;
  let latestDateStr: string | null = null;

  const nowTime = now.getTime();

  // 全体履歴から、周期の基準にできる完了済みイベントだけを拾う。
  const combinedHistory = getCombinedResetHistory(data);
  for (const item of combinedHistory) {
    const isPersistedRegular = getHistoryRecordKind(item) === "regular_completed";
    if (
      item.status?.toLowerCase() === "rejected" ||
      item.status?.toLowerCase() === "voided" ||
      (!isPersistedRegular && !isBroadResetScope(item))
    ) {
      continue;
    }

    const legacyItem = item as WindowEventLike & {
      cycleType?: string;
      resetMethod?: string;
      resetType?: string;
    };
    const resetMethod = item.details?.resetMethod ?? legacyItem.resetMethod ?? "";
    const cycleType =
      item.details?.cycleType ??
      legacyItem.cycleType ??
      legacyItem.resetType ??
      (item.title?.includes("定期リセット") ? "定期リセット" : "");
    if (resetMethod !== "強制リセット" && cycleType !== "定期リセット") {
      continue;
    }

    const completedTime = getCompletedResetTimestamp(item);
    const dateStr = item.closed_at ?? item.completed_at ?? null;
    if (
      !dateStr ||
      completedTime === null ||
      !Number.isFinite(completedTime) ||
      !Number.isFinite(nowTime) ||
      completedTime > nowTime
    ) {
      continue;
    }

    if (completedTime > latestTime) {
      latestTime = completedTime;
      latestDateStr = dateStr;
    }
  }

  return latestDateStr;
}

function getRegularResetForecast(
  latestResetAt: string | null | undefined,
  locale: Locale = "ja",
  data?: RadarData | null,
  now: Date = new Date(),
) {
  // 1. 履歴情報から最も最新の「強制リセット」または「定期リセット」を自動検出
  const autoLatestResetAt = getLatestRegularOrForcedResetAt(data, now);

  const unknownLabel = locale === "en" ? "Unknown" : locale === "zh" ? "未知" : "不明";
  const remainingUnknown = locale === "en" ? "Unknown remaining" : locale === "zh" ? "剩余时间未知" : "残り不明";

  // 「最後に完了した定期リセット日」= 自動検出された最新の基準リセット時刻
  const lastCompletedAt = autoLatestResetAt;
  const current = now;

  // 基準イベントから7日後を起点にし、過ぎていれば7日ずつ次へ進める。
  const nextRegularReset = autoLatestResetAt
    ? rollResetDateForward(new Date(autoLatestResetAt), current)
    : null;

  if (!nextRegularReset) {
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

  const remainingDays = getCalendarDayDelta(nextRegularReset, current);

  const remainingMs = Math.max(0, nextRegularReset.getTime() - current.getTime());
  const remainingDuration = formatElapsedResetDuration(remainingMs, locale);
  const remainingText = locale === "en"
    ? `${remainingDuration} remaining`
    : locale === "zh"
      ? `剩余${remainingDuration}`
      : `残り${remainingDuration}`;

  const bcp47 = locale === "en" ? "en-US" : locale === "zh" ? "zh-CN" : "ja-JP";
  const formattedDate = new Intl.DateTimeFormat(bcp47, {
    year: "numeric",
    month: locale === "en" ? "short" : "2-digit",
    day: locale === "en" ? "numeric" : "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(nextRegularReset);

  return {
    date: formattedDate,
    time: formatTime(nextRegularReset),
    remaining: remainingText,
    sourceResetAt: autoLatestResetAt,
    expectedAt: nextRegularReset.toISOString(),
    lastCompletedAt,
    remainingDays,
    isNoticeWindow: remainingMs <= 72 * 60 * 60 * 1000,
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

function addPersonalResetEventsToHistory(
  history: RadarViewModel["recentHistory"],
  _locale: Locale = "ja",
  limit: boolean = true,
) {
  const result = [...history].sort((a, b) => getHistorySortTime(b) - getHistorySortTime(a));
  return limit ? result.slice(0, HISTORY_LIMIT) : result;
}

function getLatestCompletedLocalWindow(data?: RadarData | null): WindowLike | undefined {
  const globalHistory = getCombinedResetHistory(data);

  return globalHistory
    .filter((item) =>
      getCompletedResetAt(item) &&
      (getHistoryRecordKind(item) === "confirmed_global" ||
        getHistoryRecordKind(item) === "regular_completed")
    )
    .sort((a, b) => {
      const aTime = getDateTime(getCompletedResetAt(a));
      const bTime = getDateTime(getCompletedResetAt(b));
      return bTime - aTime;
    })
    .at(0);
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

const REGULAR_RESET_SCOPE = "任意リセット未使用アカウント";
const REGULAR_RESET_SUMMARY =
  "通常の1週間サイクルのタイミングで、Codexの利用上限リセットが実施されました。";
const BANKED_RESET_METHOD = "任意リセット権1回配布";

function isRegularHistoryItem(item: WindowLike) {
  return item.recordKind === "regular_completed" || item.details?.cycleType === "定期リセット";
}

function getRegularResetMethod(item: WindowLike) {
  return item.details?.resetMethod || "強制リセット";
}

function getRegularResetScope(item: WindowLike, resetMethod: string) {
  if (resetMethod === BANKED_RESET_METHOD) {
    return item.details?.scope ?? item.scope ?? "全有料プラン";
  }

  return REGULAR_RESET_SCOPE;
}

function getRegularResetSummary(item: WindowLike, resetMethod: string) {
  if (resetMethod === BANKED_RESET_METHOD && item.details?.note) {
    return item.details.note;
  }

  return REGULAR_RESET_SUMMARY;
}

export function getHistoryRecordKind(item: WindowLike): HistoryRecordKind {
  if (
    item.recordKind === "confirmed_global" ||
    item.recordKind === "banked_distribution" ||
    item.recordKind === "reference" ||
    item.recordKind === "regular_completed"
  ) {
    return item.recordKind;
  }

  const resetMethod = item.details?.resetMethod ?? "";
  if (
    resetMethod === "任意リセット権1回配布" ||
    item.id?.includes("banked-reset") ||
    item.id?.includes("reset-credit") ||
    item.id?.includes("reset-button")
  ) {
    return "banked_distribution";
  }

  if (item.id?.includes("regular-reset")) {
    return "reference";
  }

  // Missing or unknown classifications must not become confirmed history.
  return "reference";
}

export function getHistorySourceKind(item: WindowLike): HistorySourceKind {
  if (item.sourceKind) {
    return item.sourceKind;
  }

  const source = getEventSource(item);
  if (!source) {
    return "none";
  }

  try {
    const url = new URL(source);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "status.openai.com") {
      return "official_status";
    }
    if ((hostname === "x.com" || hostname === "twitter.com") && /\/status\/\d+/i.test(url.pathname)) {
      return "direct_post";
    }
    if (hostname === "x.com" || hostname === "twitter.com") {
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length === 1) {
        return "profile";
      }
    }
  } catch {
    return "none";
  }

  return "none";
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
    text.includes("banked reset") ||
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
    text.includes("hard reset") ||
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
  if (isRegularHistoryItem(item)) {
    const resetMethod = getRegularResetMethod(item);
    const scope = getRegularResetScope(item, resetMethod);
    const note = getRegularResetSummary(item, resetMethod);

    return {
      cycleType: translateDynamic("定期リセット", locale),
      reasonType: translateDynamic("定期更新", locale),
      resetMethod: translateDynamic(resetMethod, locale),
      scope: translateDynamic(scope, locale),
      noticeToExecution: "",
      noticeType: undefined,
      note: translateDynamic(note, locale),
    };
  }

  if (item.details) {
    return {
      cycleType: translateDynamic(item.details.cycleType, locale),
      reasonType: translateDynamic(item.details.reasonType, locale),
      resetMethod: translateDynamic(item.details.resetMethod, locale),
      scope: translateDynamic(item.details.scope, locale),
      noticeToExecution: translateDynamic(item.details.noticeToExecution, locale),
      noticeType: item.details.noticeType ? translateDynamic(item.details.noticeType, locale) : translateDynamic("なし", locale),
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
    noticeType: translateDynamic("なし", locale),
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

function getLocalModelUpdatedAt(
  openAIStatus?: OpenAIStatusSignals | null,
  data?: RadarData | null,
) {
  const candidates = [
    LOCAL_MODEL_UPDATED_AT,
    openAIStatus?.updatedAt,
    ...LOCAL_OBSERVATION_SIGNALS.map((signal) => signal.observedAt),
    ...getCombinedResetHistory(data).flatMap((item) => [
      item.closed_at,
      item.completed_at,
      item.opened_at,
      item.date,
    ]),
  ];

  return getLatestIsoDate(candidates) ?? LOCAL_MODEL_UPDATED_AT;
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

function getRecentHistory(data: RadarData | null, locale: Locale = "ja", limit: boolean = true) {
  const items = getCombinedResetHistory(data).filter((item): item is WindowEventLike =>
    Boolean(item?.title),
  );

  const seen = new Set<string>();

  const result = items
    .map((item) => {
      const isRegular = isRegularHistoryItem(item);
      const isPendingNotice = isPendingResetNotice(item);
      const resetAt = isPendingNotice
        ? null
        : item.closed_at ?? item.completed_at ?? item.opened_at ?? null;
      const key = item.id ?? item.guid ?? `${item.title}-${resetAt ?? item.date ?? ""}`;
      const source = getEventSource(item);
      const recordKind = getHistoryRecordKind(item);
      const sourceKind = getHistorySourceKind(item);
      const resetMethod = isRegular ? getRegularResetMethod(item) : null;
      const regularSummary = isRegular
        ? getRegularResetSummary(item, resetMethod ?? "強制リセット")
        : null;
      const resetTypes = isRegular
        ? [translateDynamic("定期リセット", locale)]
        : getResetTypes(item, locale);
      const details = getHistoryDetails(item, locale);

      return {
        key,
        recordKind,
        title: isRegular
          ? translateDynamic("定期リセット", locale)
          : translateDynamic(item.title, locale),
        resetType: resetTypes[0],
        resetTypes,
        status: isRegular
          ? translateDynamic("リセット実施", locale)
          : translateEventStatus(item.kind ?? item.status, locale),
        details,
        date: item.date ?? resetAt ?? item.opened_at,
        signalAt: isRegular ? null : item.opened_at ?? null,
        resetAt,
        signalLabel: isRegular ? "" : translateUI("detectionTime", locale),
        resetLabel: isPendingNotice ? translateDynamic("実施予定", locale) : translateDynamic("実施", locale),
        scope: isRegular
          ? details.scope
          : translateDynamic(item.scope, locale),
        windowLabel: isPendingNotice ? translateDynamic("予告内容", locale) : undefined,
        windowLength: item.window_human
          ? translateDynamic(item.window_human, locale)
          : formatWindowLength(item.window_minutes, locale),
        source: isRegular ? null : source,
        sourceKind: isRegular ? "none" : sourceKind,
        summary: isRegular
          ? translateDynamic(regularSummary ?? REGULAR_RESET_SUMMARY, locale)
          : item.summary
            ? translateDynamic(item.summary, locale)
            : null,
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
    });

  return limit ? result.slice(0, HISTORY_LIMIT) : result;
}

function getActiveWindow(
  officialNotice: ReturnType<typeof getActiveOfficialNotice>,
  locale: Locale = "ja",
): RadarViewModel["activeWindow"] {
  const active = Boolean(officialNotice);
  const openedAt = officialNotice?.observedAt ?? null;
  const expectedAt = officialNotice?.expectedAt ?? null;
  const expectedEndAt = officialNotice?.expectedEndAt ?? null;
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
      label: translateUI("activeNoticeLabel", locale),
      summary,
      openedAt,
      expectedAt,
      expectedEndAt,
      source,
      sourceLabel: translateDynamic(officialNotice?.sourceLabel ?? "Codexに表示あり", locale),
    };
  }

  return {
    active,
    kind: "none",
    label: translateUI("noNoticeLabel", locale),
    summary: locale === "en"
      ? "At this moment, there are no official reset notices detected."
      : locale === "zh"
        ? "目前未检测到官方重置预告。"
        : "現時点で、このサイトで確認した公式リセット予告はありません。",
    openedAt,
    expectedAt,
    expectedEndAt,
    source,
    sourceLabel: null,
  };
}

function getRecommendedAction(
  activeWindow: RadarViewModel["activeWindow"],
  probability24h: number | undefined,
  locale: Locale = "ja",
) {
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
      ? "High reset probability within the next 12 to 48 hours. While not an official notice yet, checking the status before heavy tasks is recommended."
      : locale === "zh"
        ? "预计未来 12 至 48 小时内有较高重置可能。虽然尚未发布官方预告，但在执行繁重任务前确认最新状况会更为稳妥。"
        : "12〜48時間以内の見込みが高い状態です。まだ公式予告ではありませんが、重い作業の前に最新状況を確認すると安心です。";
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

function isRegularResetWindow(value: WindowLike | undefined) {
  return Boolean(value?.id?.startsWith("regular-reset-") || value?.title?.includes("定期"));
}

export function getCompletedResetAt(item: WindowEventLike) {
  if (isPendingResetNotice(item) || item.status === "active") {
    return null;
  }

  if (item.closed_at || item.completed_at) {
    return item.closed_at ?? item.completed_at ?? null;
  }

  return item.kind === "reset_completed" ? item.opened_at ?? item.date ?? null : null;
}

export function getRandomResetHeatmapEventTimes(
  data: RadarData | null | undefined,
  now: Date = new Date(),
) {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return [];

  return getCombinedResetHistory(data).flatMap((item) => {
    const completedAt = getCompletedResetAt(item);
    const completedTime = completedAt ? new Date(completedAt).getTime() : null;
    if (!isEligibleRandomResetEvent(item, completedTime, nowTime)) {
      return [];
    }

    return [new Date(completedTime!).toISOString()];
  });
}

function getCombinedResetHistory(data?: RadarData | null): Array<WindowEventLike> {
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
      recordKind: "confirmed_global",
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

  return combineResetHistory(
    [...LOCAL_RESET_HISTORY, ...autoResolvedItems],
    data?.formal_tibo_resets ?? [],
    data?.rejected_tibo_resets ?? [],
    data?.regular_reset_events ?? [],
  );
}
