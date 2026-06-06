export type ProbabilityLevel = "low" | "medium" | "high" | "very_high";

export type RadarData = {
  checked_at?: string;
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
    title?: string;
    status?: string;
    opened_at?: string | null;
    closed_at?: string | null;
    scope?: string;
    summary?: string;
  };
  prediction?: {
    level?: ProbabilityLevel | string;
    probability_24h?: number;
    probability_48h?: number;
    expected_window?: string;
    reasoning_summary?: string;
  };
  links?: {
    html?: string;
    rss?: string;
  };
};

export type CachedRadarData = {
  data: RadarData;
  fetchedAt: string;
};

export const SOURCE_SITE_URL = "https://codex-reset-radar.pages.dev/en/";

export function probabilityToPercent(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "不明";
  }

  return `${Math.round(value * 100)}%`;
}

export function getExpectationLabel(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "不明";
  }

  if (value < 0.1) {
    return "低";
  }

  if (value < 0.3) {
    return "中";
  }

  if (value < 0.6) {
    return "高";
  }

  return "超高";
}

export function getRefreshIntervalMs(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 3 * 60 * 60 * 1000;
  }

  if (value < 0.1) {
    return 6 * 60 * 60 * 1000;
  }

  if (value < 0.3) {
    return 3 * 60 * 60 * 1000;
  }

  if (value < 0.6) {
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

export function translateStatus(status: string | undefined, isWindowOpen: boolean | undefined) {
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
