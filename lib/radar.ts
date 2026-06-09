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
    remaining: string;
    sourceResetAt?: string | null;
    expectedAt?: string | null;
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
    remaining?: string;
  };
  reasoningSummary: string;
  latestWindow: {
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
    scope: string;
    windowLength: string;
    source?: string | null;
  }>;
};

export const SOURCE_SITE_URL = "https://codexradar.com/en/";
const DISPLAY_TIME_ZONE = "Asia/Tokyo";
const DAY_MS = 24 * 60 * 60 * 1000;

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

  if (normalized < 0.1) {
    return "低";
  }

  if (normalized < 0.3) {
    return "中";
  }

  if (normalized < 0.6) {
    return "高";
  }

  return "超高";
}

export function getRefreshIntervalMs(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 3 * 60 * 60 * 1000;
  }

  const normalized = normalizeProbability(value);

  if (normalized < 0.1) {
    return 6 * 60 * 60 * 1000;
  }

  if (normalized < 0.3) {
    return 3 * 60 * 60 * 1000;
  }

  if (normalized < 0.6) {
    return 60 * 60 * 1000;
  }

  return 30 * 60 * 1000;
}

export function getRefreshIntervalLabel(value: number | undefined) {
  const intervalMs = getRefreshIntervalMs(value);

  if (intervalMs === 30 * 60 * 1000) {
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
  const predictionLevel =
    source?.prediction?.level ??
    getString(source, ["prediction_level", "level", "expectation_level"]);
  const latestWindow = getLatestWindow(source);
  const observedHistory = getRecentHistory(source);
  const regularResetForecast = getRegularResetForecast(
    observedHistory[0]?.resetAt ?? observedHistory[0]?.date ?? null,
  );
  const activeWindow = getDisplayResetNotice(
    getActiveWindow(source),
    regularResetForecast,
  );
  const recentHistory = addRegularResetForecastToHistory(
    observedHistory,
    regularResetForecast,
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
      windowLength: formatWindowLength(latestWindow?.window_minutes),
    },
    recentHistory,
  };
}

function getRegularResetForecast(latestResetAt: string | null | undefined) {
  if (!latestResetAt) {
    return {
      date: "不明",
      remaining: "残り不明",
      sourceResetAt: latestResetAt,
      expectedAt: null,
      remainingDays: null,
      isNoticeWindow: false,
    };
  }

  const latestResetDate = new Date(latestResetAt);

  if (Number.isNaN(latestResetDate.getTime())) {
    return {
      date: "不明",
      remaining: "残り不明",
      sourceResetAt: latestResetAt,
      expectedAt: null,
      remainingDays: null,
      isNoticeWindow: false,
    };
  }

  const nextRegularReset = new Date(latestResetDate.getTime() + 7 * DAY_MS);
  const remainingDays = getCalendarDayDelta(nextRegularReset, new Date());

  return {
    date: formatDate(nextRegularReset),
    remaining:
      remainingDays > 0
        ? `残り${remainingDays}日`
        : remainingDays === 0
          ? "残り0日"
          : "予想日を過ぎています",
    sourceResetAt: latestResetAt,
    expectedAt: nextRegularReset.toISOString(),
    remainingDays,
    isNoticeWindow: remainingDays >= 0 && remainingDays <= 3,
  };
}

function getDisplayResetNotice(
  officialWindow: RadarViewModel["activeWindow"],
  regularResetForecast: RadarViewModel["regularResetForecast"],
): RadarViewModel["activeWindow"] {
  if (officialWindow.active) {
    return officialWindow;
  }

  if (regularResetForecast.isNoticeWindow) {
    return {
      active: true,
      kind: "regular",
      label: "定期リセット予想",
      summary:
        "本家サイトの公式リセット予告はありません。最新履歴のリセット実施日から7日後を、1週間サイクルの定期リセット予想として表示しています。",
      openedAt: regularResetForecast.sourceResetAt,
      forecastDate: regularResetForecast.date,
      remaining: regularResetForecast.remaining,
      source: null,
    };
  }

  return officialWindow;
}

function addRegularResetForecastToHistory(
  history: RadarViewModel["recentHistory"],
  regularResetForecast: RadarViewModel["regularResetForecast"],
) {
  if (!regularResetForecast.expectedAt) {
    return history;
  }

  return [
    {
      key: `regular-reset-forecast-${regularResetForecast.expectedAt}`,
      title: "次回定期リセット予想",
      resetType: "定期リセット",
      status: "予想",
      date: regularResetForecast.expectedAt,
      signalAt: regularResetForecast.sourceResetAt ?? null,
      resetAt: regularResetForecast.expectedAt,
      signalLabel: "基準",
      resetLabel: "予想",
      scope: "1週間サイクル",
      windowLength: "7日後",
      source: null,
    },
    ...history,
  ].slice(0, 5);
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

function getActiveWindow(data: RadarData | null): RadarViewModel["activeWindow"] {
  const state = data?.current_window?.state ?? data?.window?.status ?? data?.status;
  const active = Boolean(data?.window_open) || state === "open";
  const openedAt = data?.current_window?.opened_at ?? data?.window?.opened_at ?? null;
  const source =
    data?.current_window?.source ??
    data?.window?.source ??
    data?.window?.source_url ??
    null;

  if (active) {
    return {
      active,
      kind: "official",
      label: "予告あり",
      summary:
        "Codex Reset Radarが公式シグナルを検知しています。予告どおりリセットされる可能性が高いため、残り枠を使う判断を優先してください。",
      openedAt,
      source,
    };
  }

  return {
    active,
    kind: "none",
    label: "予告なし",
    summary:
      "現時点で、Codex Reset Radar が検知している公式リセット予告はありません。",
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

  if (normalized >= 0.6) {
    return "24時間以内の見込みが高い状態です。まだ公式予告ではありませんが、重い作業の前に最新状況を確認すると安心です。";
  }

  if (normalized >= 0.3) {
    return "リセットの可能性はやや高めです。急ぎでない大きな作業は、残り枠と最新情報を見ながら進めるのがおすすめです。";
  }

  if (normalized >= 0.1) {
    return "中程度の見立てです。公式予告はないため、必要な作業は進めながら、数時間おきに変化を確認してください。";
  }

  return translateAction(data?.recommended_action);
}

function getReasoningSummary(
  data: RadarData | null,
  probability24h: number | undefined,
  probability48h: number | undefined,
) {
  const englishSummary =
    data?.prediction?.display_summary_en ?? data?.prediction?.summary_en;
  const signalSummary = getSignalSummary(data?.prediction?.signal_summary_24h);
  const normalizedEnglishSummary = englishSummary?.toLowerCase();

  if (normalizedEnglishSummary?.includes("no official reset window")) {
    return "公式リセット予告や明確な補償示唆は確認されていません。直近のStatus障害はアカウント/契約まわりが中心で、Codex全体の障害とは読み切れません。一方で、コミュニティでは利用上限への圧力やリセット要望が続いているため、中程度の見立てです。";
  }

  if (
    normalizedEnglishSummary?.includes("targeted 10x reward") ||
    normalizedEnglishSummary?.includes("not a broad compensation reset")
  ) {
    return "公式側の動きは一部ユーザー向けの10X利用量付与に近く、全体向けの補償リセットとは読みづらい状況です。利用上限への不満や一部の異常報告はありますが、長時間のStatus障害や明確な公式予告は確認できていないため、期待度は低めです。";
  }

  if (signalSummary?.observed || signalSummary?.candidates) {
    const hasOfficialSignal = Boolean(signalSummary.official);
    const hasStatusSignal = Boolean(signalSummary.status);
    const hasCommunitySignal = Boolean(
      signalSummary.community || signalSummary.candidates,
    );

    if (hasOfficialSignal) {
      return "公式に近いシグナルが出ているため、通常よりリセット期待度を高めに見ています。ただし、リセット時刻が明示された予告かどうかは、公式リセット予告欄を優先して確認してください。";
    }

    if (hasStatusSignal && hasCommunitySignal) {
      return "Status上の問題や利用上限への不満は見られますが、Codex全体の補償リセットにつながるほど強い材料とはまだ言い切れません。公式予告はない一方で、コミュニティ側のリセット要望が続いているため、中程度の見立てです。";
    }

    if (hasStatusSignal) {
      return "Status上の問題は確認されていますが、現時点ではCodexの利用枠リセットに直結する内容とは読み切れません。公式予告が出るまでは、強いリセット材料としては扱いにくい状態です。";
    }

    if (hasCommunitySignal) {
      return "コミュニティでは利用上限への不満やリセット要望が見られます。ただし、公式側の予告や補償示唆は確認できていないため、期待度を押し上げる材料としては限定的です。";
    }

    return "公開シグナルは拾えていますが、公式予告や大きな障害に結びつく材料はまだ弱めです。現時点では、確定的なリセット予告というより様子見寄りの見立てです。";
  }

  const p24 = probabilityToPercent(probability24h);
  const p48 = probabilityToPercent(probability48h);

  return `現在の見立ては24時間以内が${p24}、48時間以内が${p48}です。詳しい根拠は取得できていないため、公式リセット予告の有無を優先して確認してください。`;
}

function getSignalSummary(summary: SignalSummaryLike | undefined) {
  if (!summary) {
    return undefined;
  }

  const counts = summary.observation_counts ?? summary.counts;

  return {
    observed: summary.observation_total ?? summary.total,
    candidates: summary.candidate_total,
    fresh: summary.new_total,
    official: counts?.official_x,
    community: counts?.community_x,
    status: counts?.openai_status,
    market: counts?.market_x,
  };
}

function getRecentHistory(data: RadarData | null) {
  if (!data) {
    return [];
  }

  const items = [
    ...(data.prediction?.probability_history?.events ?? []),
    ...(data.recent_windows ?? []),
    ...(data.recent_windows?.length ? [] : [data.window]),
    data.last_window,
    data.latest_reset,
    data.last_reset,
    data.latest_window,
  ].filter((item): item is WindowEventLike => Boolean(item?.title));

  const seen = new Set<string>();

  return items
    .map((item) => {
      const resetAt = item.closed_at ?? item.completed_at ?? item.opened_at ?? null;
      const key = item.id ?? item.guid ?? `${item.title}-${resetAt ?? item.date ?? ""}`;
      const source = getEventSource(item);

      return {
        key,
        title: translateSourceText(item.title),
        resetType: getResetType(item),
        status: translateEventStatus(item.kind ?? item.status),
        date: item.date ?? resetAt,
        signalAt: item.opened_at ?? item.date ?? null,
        resetAt,
        signalLabel: "検知",
        resetLabel: "実施",
        scope: translateSourceText(item.scope),
        windowLength: formatWindowLength(item.window_minutes),
        source,
      };
    })
    .filter((item) => {
      if (seen.has(item.key)) {
        return false;
      }

      seen.add(item.key);
      return true;
    })
    .sort((a, b) => {
      const aTime = a.resetAt ? new Date(a.resetAt).getTime() : 0;
      const bTime = b.resetAt ? new Date(b.resetAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 5);
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

function getProbability(
  data: RadarData | null,
  period: "24h" | "48h",
): number | undefined {
  const candidates =
    period === "24h"
      ? [
          data?.prediction?.probability_24h,
          data?.prediction?.probability24h,
          data?.prediction?.probability_24_hours,
          data?.probabilities?.probability_24h,
          data?.probabilities?.probability24h,
          data?.probabilities?.within_24h,
          data?.probabilities?.["24h"],
          getNumber(data, ["probability_24h", "probability24h", "within_24h"]),
        ]
      : [
          data?.prediction?.probability_48h,
          data?.prediction?.probability48h,
          data?.prediction?.probability_48_hours,
          data?.probabilities?.probability_48h,
          data?.probabilities?.probability48h,
          data?.probabilities?.within_48h,
          data?.probabilities?.["48h"],
          getNumber(data, ["probability_48h", "probability48h", "within_48h"]),
        ];

  const value = candidates.find(
    (candidate) => typeof candidate === "number" && !Number.isNaN(candidate),
  );

  return typeof value === "number" ? normalizeProbability(value) : undefined;
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

function getNumber(
  source: Record<string, unknown> | null | undefined,
  paths: string[],
) {
  const value = getValue(source, paths);
  return typeof value === "number" ? value : undefined;
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
