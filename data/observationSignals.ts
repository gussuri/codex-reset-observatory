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
  skipAutoHistoryMerge?: boolean;
};

export const LOCAL_OBSERVATION_SIGNALS: Array<LocalObservationSignal> = [
  {
    id: "official-gpt-5.6-release-notice-2026-07-08",
    observedAt: "2026-07-08T13:36:00+09:00",
    type: "official_notice",
    status: "active",
    expectedAt: "2026-07-09T04:00:00+09:00",
    expiresAt: "2026-07-09T10:00:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "OpenAIがGPT-5.6（Sol/Terra/Luna）の太平洋時間7月8日12:00（日本時間7月9日4:00）リリースを発表。リリース記念としてCodex利用制限の全体リセットが実施される可能性があります。",
    keywords: ["GPT-5.6", "Sol", "Terra", "Luna", "release", "celebration", "リリース", "記念", "全体リセット"],
    source: "https://x.com/OpenAI",
    sourceLabel: "OpenAI公式Xで告知あり",
  },
  {
    id: "official-codex-reset-button-demo-notice-2026-07-02",
    observedAt: "2026-07-02T05:30:00+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-07-02T05:00:00+09:00",
    expiresAt: "2026-07-02T10:00:00+09:00",
    resolvedAt: "2026-07-02T05:50:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "OpenAI関係者がAI Engineerイベントで Codex reset button の実演を示唆し、Tibo氏も “It's happening” と反応しています。",
    keywords: [
      "reset button",
      "AI Engineer",
      "demo",
      "実演",
      "Romain Huet",
      "It's happening",
    ],
    source: null,
    sourceLabel: "Romain Huet氏 & Tibo氏の公式Xにて言及あり",
  },
  {
    id: "official-codex-forced-reset-notice-2026-06-30",
    observedAt: "2026-06-30T08:50:00+09:00",
    type: "official_notice",
    status: "active",
    expectedAt: "2026-06-30T09:30:00+09:00",
    expiresAt: "2026-06-30T12:00:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "Tibo氏が、1時間以内に全員のCodex利用制限を再度フルリセットすると発表しました。",
    keywords: ["forced reset", "limit reset", "強制リセット", "利用制限"],
    source: null,
    sourceLabel: "Tibo氏の公式Xで告知あり",
  },
  {
    id: "official-codex-additional-credit-notice-2026-06-30",
    observedAt: "2026-06-30T08:50:00+09:00",
    type: "official_notice",
    status: "expired",
    expectedAt: "2026-07-01T09:00:00+09:00",
    expiresAt: "2026-07-01T15:00:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "Tibo氏が、今後24時間以内に全有料プランへ任意リセット枠をさらに1回分追加配布すると発表しました。",
    keywords: ["manual reset", "credit reset", "任意リセット", "追加配布"],
    source: null,
    sourceLabel: "Tibo氏の公式Xで告知あり",
  },
  {
    id: "official-excessive-consumption-forced-reset-notice-2026-06-29",
    observedAt: "2026-06-29T09:00:00+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-06-29T09:00:00+09:00",
    expiresAt: "2026-06-30T09:00:00+09:00",
    resolvedAt: "2026-06-29T09:00:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "Tibo氏が、Codexの過剰な利用制限消費問題の調査に伴い、全員の利用制限を強制リセットしたと発表しました。",
    keywords: ["forced reset", "limit reset", "強制リセット", "利用制限", "バグ", "補償"],
    source: null,
    sourceLabel: "Tibo氏の公式Xで報告あり",
  },
  {
    id: "official-codex-compensation-reset-notice-2026-06-27",
    observedAt: "2026-06-27T08:41:00+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-06-27T12:00:00+09:00",
    expiresAt: "2026-06-28T09:00:00+09:00",
    resolvedAt: "2026-06-27T12:00:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "Tibo氏が、過剰な利用制限消費問題の補償として、全プランのCodex利用制限を数時間以内にリセットすると発表しました。",
    keywords: ["rate limit", "usage limit", "reset", "利用上限", "バグ", "補償"],
    source: null,
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
    skipAutoHistoryMerge: true,
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
    source: null,
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
