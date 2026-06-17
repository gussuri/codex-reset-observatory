export type LocalObservationSignal = {
  id: string;
  observedAt: string;
  type:
    | "official_notice"
    | "official_incident_hint"
    | "status_incident"
    | "community_report"
    | "limit_anomaly";
  title: string;
  keywords?: Array<string>;
  source?: string | null;
  expiresAt?: string | null;
  resolvedAt?: string | null;
  status?: "active" | "resolved" | "expired";
};

export const LOCAL_OBSERVATION_SIGNALS: Array<LocalObservationSignal> = [
  {
    id: "official-codex-rate-limit-reset-notice-2026-06-17",
    observedAt: "2026-06-17T04:30:00+09:00",
    type: "official_notice",
    status: "active",
    expiresAt: "2026-06-18T04:30:00+09:00",
    resolvedAt: null,
    title:
      "Tibo氏が、全プランのCodexレート制限を24時間以内にリセットすると発表しました。",
    keywords: ["rate limit", "利用上限", "レート制限"],
    source: "https://x.com/thsottiaux/status/2066956441173323943",
  },
  {
    id: "official-codex-capacity-error-hint-2026-06-16",
    observedAt: "2026-06-16T22:30:00+09:00",
    type: "official_incident_hint",
    status: "active",
    expiresAt: "2026-06-18T22:30:00+09:00",
    resolvedAt: null,
    title:
      "Tibo氏が、Codexの一部ユーザーでモデル容量到達エラーが多発していると投稿しました。",
    keywords: [
      "capacity",
      "model reached capacity",
      "high error rate",
      "容量",
      "エラー率",
    ],
    source: null,
  },
];
