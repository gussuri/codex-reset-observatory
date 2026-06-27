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
  sourceLabel?: string | null;
  expectedAt?: string | null;
  expiresAt?: string | null;
  resolvedAt?: string | null;
  status?: "active" | "resolved" | "expired";
};

export const LOCAL_OBSERVATION_SIGNALS: Array<LocalObservationSignal> = [
  {
    id: "official-codex-compensation-reset-notice-2026-06-27",
    observedAt: "2026-06-27T08:41:00+09:00",
    type: "official_notice",
    status: "active",
    expectedAt: "2026-06-27T12:00:00+09:00",
    expiresAt: "2026-06-28T09:00:00+09:00",
    resolvedAt: null,
    title:
      "Tibo氏が、過剰な利用制限消費問題の補償として、全プランのCodex利用制限を数時間以内にリセットすると発表しました。",
    keywords: ["rate limit", "usage limit", "reset", "利用上限", "バグ", "補償"],
    source: "https://x.com/thsottiaux",
    sourceLabel: "Tibo氏の公式Xで告知あり",
  },
  {
    id: "official-codex-regular-reset-notice-2026-06-25",
    observedAt: "2026-06-22T13:27:58+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-06-25T07:01:00+09:00",
    expiresAt: "2026-06-25T08:01:00+09:00",
    resolvedAt: "2026-06-25T07:01:00+09:00",
    title:
      "2026/06/25 07:01 JST に、全有料プランのCodex利用上限リセットが予定されています。",
    keywords: ["rate limit", "usage limit", "reset", "利用上限", "レート制限"],
    source: null,
  },
  {
    id: "official-codex-rate-limit-reset-notice-2026-06-17",
    observedAt: "2026-06-17T04:30:00+09:00",
    type: "official_notice",
    status: "resolved",
    expiresAt: "2026-06-18T04:30:00+09:00",
    resolvedAt: "2026-06-18T07:00:00+09:00",
    title:
      "Tibo氏が、全プランのCodexレート制限を24時間以内にリセットすると発表しました。",
    keywords: ["rate limit", "利用上限", "レート制限"],
    source: "https://x.com/thsottiaux/status/2066956441173323943",
  },
  {
    id: "official-codex-capacity-error-hint-2026-06-16",
    observedAt: "2026-06-16T22:30:00+09:00",
    type: "official_incident_hint",
    status: "resolved",
    expiresAt: "2026-06-18T22:30:00+09:00",
    resolvedAt: "2026-06-18T07:00:00+09:00",
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
