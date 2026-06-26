import type { OpenAIStatusHistoryItem } from "@/lib/openaiStatus";

export type Locale = "ja" | "en" | "zh";

export type ProbabilityLevel = "low" | "medium" | "high" | "very_high";

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
    expectedAt?: string | null;
    source?: string | null;
    sourceLabel?: string | null;
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
    resetTypes?: Array<string>;
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
