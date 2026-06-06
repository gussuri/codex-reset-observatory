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
  current_window?: {
    state?: string;
    message?: string;
    opened_at?: string | null;
    source?: string | null;
  };
  last_window?: {
    id?: string;
    title?: string;
    status?: string;
    opened_at?: string | null;
    closed_at?: string | null;
    completed_at?: string | null;
    window_minutes?: number;
    window_human?: string;
    scope?: string;
    summary?: string;
    sources?: Array<{
      type?: string;
      url?: string | null;
    }>;
  };
  latest_reset?: WindowLike;
  last_reset?: WindowLike;
  latest_window?: WindowLike;
  prediction?: {
    level?: ProbabilityLevel | string;
    probability_24h?: number;
    probability24h?: number;
    probability_24_hours?: number;
    probability_48h?: number;
    probability48h?: number;
    probability_48_hours?: number;
    expected_window?: string;
    reasoning_summary?: string;
    updated_at?: string;
    probability_history?: {
      events?: Array<WindowEventLike>;
    };
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
  scope?: string;
  summary?: string;
  source?: string | null;
  link?: string | null;
};

export type WindowEventLike = WindowLike & {
  kind?: string;
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
  latestWindow: {
    title: string;
    summary: string;
    scope: string;
    openedAt?: string | null;
    closedAt?: string | null;
  };
};

export const SOURCE_SITE_URL = "https://codex-reset-radar.pages.dev/en/";

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
    timeZone: "Asia/Tokyo",
    timeZoneName: "short",
  }).format(date);
}

export function translateStatus(
  status: string | undefined,
  isWindowOpen: boolean | undefined,
) {
  if (isWindowOpen) {
    return "リセット期間が開いています";
  }

  switch (status) {
    case "none":
      return "開いているリセット期間はありません";
    case "open":
      return "リセット期間が開いています";
    case "closed":
      return "直近のリセット期間は終了済みです";
    default:
      return status || "不明";
  }
}

export function translateAction(action: string | undefined) {
  switch (action) {
    case "wait":
      return "様子見";
    case "use_quota":
      return "残り枠の利用を検討";
    case "watch":
      return "続報を確認";
    default:
      return action || "不明";
  }
}

export function translateSourceText(value: string | undefined) {
  if (!value) {
    return "不明";
  }

  const dictionary: Record<string, string> = {
    "Codex 可靠性事故补偿重置": "Codex 信頼性障害の補償リセット",
    "所有付费计划": "全有料プラン",
    "Tibo 表示过去 24 小时内有三次影响 Codex 可靠性的小事故，并已为所有付费计划重置 Codex 使用限制。":
      "Tibo が、過去24時間に Codex の信頼性へ影響する小規模な障害が3件あったとして、全有料プランの Codex 利用制限をリセットしたと発表しました。",
    "暂无正式速蹬窗口": "現在、正式なリセット期間はありません",
    "当前没有开启的速蹬窗口": "現在、開いているリセット期間はありません",
    "未来 24-48 小时": "今後24〜48時間",
  };

  return dictionary[value] ?? value;
}

export function getRadarViewModel(data: RadarData | null): RadarViewModel {
  const source = unwrapRadarData(data);
  const probability24h = getProbability(source, "24h");
  const probability48h = getProbability(source, "48h");
  const predictionLevel =
    source?.prediction?.level ??
    getString(source, ["prediction_level", "level", "expectation_level"]);
  const latestWindow = getLatestWindow(source);

  return {
    status: translateStatus(
      getString(source, ["status", "current_window.state"]),
      source?.window_open,
    ),
    expectation: getExpectationLabel(predictionLevel ?? probability24h),
    probability24h,
    probability48h,
    action: translateAction(source?.recommended_action),
    lastUpdated:
      source?.checked_at ??
      source?.monitored_at ??
      source?.updated_at ??
      source?.prediction?.updated_at ??
      null,
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
    },
  };
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

  const direct =
    data.last_window ??
    data.latest_reset ??
    data.last_reset ??
    data.latest_window ??
    getObject<WindowLike>(data, ["latestReset", "lastReset", "lastWindow"]);

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
