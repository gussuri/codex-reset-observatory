import type { OpenAIStatusHistoryItem } from "@/lib/openaiStatus";
import type {
  FormalTiboResetSignal,
  RejectedTiboResetSignal,
} from "./tiboHistory";

export type Locale = "ja" | "en" | "zh";

export type ProbabilityLevel = "low" | "medium" | "high" | "very_high";

export type HistoryRecordKind =
  | "confirmed_global"
  | "banked_distribution"
  | "reference";

export type HistorySourceKind =
  | "direct_post"
  | "profile"
  | "official_status"
  | "none";

export type ResetHistoryDetails = {
  cycleType: string;
  reasonType: string;
  resetMethod: string;
  scope: string;
  noticeToExecution: string;
  noticeType?: string;
  note?: string | null;
};

export type WindowLike = {
  id?: string;
  guid?: string;
  title?: string;
  status?: string;
  opened_at?: string | null;
  closed_at?: string | null;
  completed_at?: string | null;
  date?: string | null;
  window_minutes?: number;
  window_human?: string;
  scopeLabel?: string;
  scope?: string;
  summary?: string;
  source?: string | null;
  source_url?: string | null;
  sourceKind?: HistorySourceKind;
  recordKind?: HistoryRecordKind;
  link?: string | null;
  sources?: Array<{
    type?: string;
    url?: string | null;
  }>;
  windowLabel?: string;
  details?: ResetHistoryDetails;
};

export type WindowEventLike = WindowLike & {
  kind?: string;
  date?: string | null;
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

export type ActiveTiboSignal = {
  tweet_id: string;
  signal_type: "official_notice" | "reset_executed" | "teaser" | "irrelevant";
  text?: string;
  tweet_url?: string;
  tweet_created_at: string;
  detected_at?: string;
  expires_at?: string;
  verification_status?: "auto_unverified" | "confirmed" | "rejected";
  confidence?: number;
  classification_reason?: string;
  is_reply?: boolean;
  is_quote?: boolean;
};

export type DataSourceState = "ok" | "degraded" | "misconfigured";

export type DataSourceDetail =
  | "missing_configuration"
  | "request_failed"
  | "invalid_response"
  | "database_error"
  | "partial_response";

export type DataSourceHealth = {
  state: DataSourceState;
  detail?: DataSourceDetail;
};

export type DataFetchResult<T> = {
  data: T;
  health: DataSourceHealth;
};

export type RadarDataHealth = {
  overall: "ok" | "degraded";
  checkedAt: string;
  sources: {
    supabaseSignals: DataSourceHealth;
    openAIStatus: DataSourceHealth;
  };
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
  data_health?: RadarDataHealth;
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
    probability_12h?: number;
    probability12h?: number;
    probability_12_hours?: number;
    probability_24h?: number;
    probability24h?: number;
    probability_24_hours?: number;
    probability_48h?: number;
    probability48h?: number;
    probability_48_hours?: number;
    probability_72h?: number;
    probability72h?: number;
    probability_72_hours?: number;
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
    probability_12h?: number;
    probability12h?: number;
    within_12h?: number;
    "12h"?: number;
    probability_24h?: number;
    probability24h?: number;
    probability_48h?: number;
    probability48h?: number;
    probability_72h?: number;
    probability72h?: number;
    within_72h?: number;
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
  active_tibo_signals?: Array<ActiveTiboSignal>;
  formal_tibo_resets?: Array<FormalTiboResetSignal>;
  rejected_tibo_resets?: Array<RejectedTiboResetSignal>;
  codex_environment?: {
    updated_at?: string;
    status_incidents_24h?: number;
    official_incident_hints_24h?: number;
    official_updates_24h?: number;
    community_mentions_24h?: number;
    issue_or_limit_anomalies_24h?: number;
    complaint_pressure?: "low" | "medium" | "high" | string;
    complaint_pressure_sources?: Array<string>;
    openai_status_updated_at?: string | null;
    openai_status_active_codex_incidents?: number;
    openai_status_recent_codex_incidents?: number;
    openai_status_affected_codex_components?: number;
    openai_status_incidents_suppressed?: boolean;
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

export type RadarViewModel = {
  status: string;
  expectation: string;
  probability12h?: number;
  probability24h?: number;
  probability48h?: number;
  probability72h?: number;
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
    expectedEndAt?: string | null;
    source?: string | null;
    sourceLabel?: string | null;
    forecastDate?: string;
    forecastTime?: string | null;
    remaining?: string;
  };
  reasoningSummary: string | null;
  displayReasoningSummary: string | null;
  latestWindow: {
    kind: "observed" | "regular";
    recordKind?: HistoryRecordKind;
    title: string;
    summary: string;
    scopeLabel?: string;
    scope: string;
    openedAt?: string | null;
    closedAt?: string | null;
    windowLabel?: string;
    windowLength: string;
    source?: string | null;
    sourceKind?: HistorySourceKind;
  };
  recentHistory: Array<{
    key: string;
    title: string;
    resetType: string;
    resetTypes?: Array<string>;
    status: string;
    details?: ResetHistoryDetails;
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
    sourceKind?: HistorySourceKind;
    recordKind?: HistoryRecordKind;
    summary?: string | null;
  }>;
};

// The browser-facing view model is an explicit projection of the internal
// model. Audit-only action and reasoning fields stay server-side.
export type PublicRadarViewModel = Pick<
  RadarViewModel,
  | "status"
  | "expectation"
  | "probability12h"
  | "probability24h"
  | "probability48h"
  | "probability72h"
  | "lastUpdated"
  | "regularResetForecast"
  | "activeWindow"
  | "displayReasoningSummary"
  | "latestWindow"
  | "recentHistory"
>;

export type PublicDataHealth = {
  overall: "ok" | "degraded";
  stale: boolean;
  generatedAt: string;
  sources: {
    supabaseSignals: DataSourceHealth;
    openAIStatus: DataSourceHealth;
  };
};

export type PublicRadarSnapshot = {
  schemaVersion: string;
  checkedAt: string;
  updatedAt: string | null;
  dataHealth: PublicDataHealth;
  viewModel: PublicRadarViewModel;
};

export type CachedRadarData = {
  schemaVersion: "public-v1";
  locale: Locale;
  data: PublicRadarSnapshot;
  fetchedAt: string;
};
