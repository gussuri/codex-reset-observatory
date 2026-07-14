export type LocalObservationSignal = {
  id: string;
  observedAt: string;
  type:
    | "official_notice"
    | "official_incident_hint"
    | "status_incident"
    | "community_report"
    | "limit_anomaly"
    | "probability_boost";
  title: string;
  keywords?: Array<string>;
  source?: string | null;
  sourceLabel?: string | null;
  expectedAt?: string | null;
  expectedEndAt?: string | null;
  expiresAt?: string | null;
  resolvedAt?: string | null;
  status?: "active" | "resolved" | "expired";
  skipAutoHistoryMerge?: boolean;
  boostValue?: number;
  boostValue24h?: number;
  boostValue48h?: number;
  boostReason?: string;
};

export const LOCAL_OBSERVATION_SIGNALS: Array<LocalObservationSignal> = [
  {
    id: "boost-gpt-5.6-release-8m-followup-2026-07-15",
    observedAt: "2026-07-15T04:34:00+09:00",
    type: "probability_boost",
    status: "active",
    expiresAt: "2026-07-18T00:00:00+09:00",
    boostValue24h: 19,
    boostValue48h: 28,
    boostReason: "GPT-5.6リリース記念",
    title: "GPT-5.6リリース記念",
    source: "https://x.com/thsottiaux",
  },
  {
    id: "official-tibo-8m-users-notice-2026-07-15",
    observedAt: "2026-07-15T04:34:00+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-07-15T04:34:00+09:00",
    expiresAt: "2026-07-15T09:00:00+09:00",
    resolvedAt: "2026-07-15T04:34:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "Tibo氏（OpenAI Codex開発者）が、アクティブユーザー数800万人突破を記念してCodex利用上限を再びリセットしたと発表しました。",
    keywords: ["8m users", "800万人", "celebration", "記念", "Tibo", "thsottiaux"],
    source: "https://x.com/thsottiaux",
    sourceLabel: "Tibo氏（OpenAI Codex開発者）のXポストより",
  },
  {
    id: "boost-8m-celebration-hint-2026-07-14",
    observedAt: "2026-07-14T15:00:00+09:00",
    type: "probability_boost",
    status: "resolved",
    expiresAt: "2026-07-15T04:34:00+09:00",
    boostValue24h: 30,
    boostValue48h: 30,
    boostReason: "800万人アクティブユーザー記念の可能性",
    title: "800万人アクティブユーザー記念の可能性",
    source: "https://x.com/thsottiaux",
  },
  {
    id: "official-tibo-7m-users-banked-reset-notice-2026-07-14",
    observedAt: "2026-07-13T07:00:00+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-07-14T07:00:00+09:00",
    expectedEndAt: "2026-07-14T23:59:00+09:00",
    expiresAt: "2026-07-14T23:59:00+09:00",
    resolvedAt: "2026-07-14T03:40:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "Tibo氏（OpenAI Codex開発者）が、明日アクティブユーザー数700万人突破を記念して全有料ユーザーに任意リセット枠（banked reset）1回分を付与すると発表しました。",
    keywords: ["7m users", "700万人", "milestone", "banked reset", "任意リセット", "thsottiaux"],
    source: "https://x.com/thsottiaux",
    sourceLabel: "Tibo氏（OpenAI Codex開発者）のXポストより",
  },
  {
    id: "official-tibo-6m-users-notice-2026-07-13",
    observedAt: "2026-07-13T03:00:00+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-07-13T04:00:00+09:00",
    expiresAt: "2026-07-13T08:00:00+09:00",
    resolvedAt: "2026-07-13T03:30:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "Tibo氏（OpenAI Codex開発者）が、アクティブユーザー数600万人突破を記念して1時間以内にCodex利用上限をリセットすると発表しました。",
    keywords: ["6m users", "600万人", "celebration", "記念", "Tibo", "thsottiaux"],
    source: "https://x.com/thsottiaux",
    sourceLabel: "Tibo氏（OpenAI Codex開発者）のXポストより",
  },
  {
    id: "boost-gpt-5.6-release-2026-07-10",
    observedAt: "2026-07-10T14:30:00+09:00",
    type: "probability_boost",
    status: "resolved",
    expiresAt: "2026-07-15T01:14:00+09:00",
    resolvedAt: "2026-07-15T01:14:00+09:00",
    title: "GPT-5.6リリース記念ランダムリセット警戒期間に伴う確率底上げブースト",
    boostValue24h: 0.20,
    boostValue48h: 0.28,
    boostReason: "GPT-5.6リリース記念",
    source: null,
    sourceLabel: "システムによる確率調整",
  },
  {
    id: "official-tibo-gpt56-sol-2nd-reset-2026-07-10",
    observedAt: "2026-07-10T14:30:00+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-07-11T14:30:00+09:00",
    expiresAt: "2026-07-11T14:30:00+09:00",
    resolvedAt: "2026-07-11T03:26:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "Tibo氏（OpenAI Codex開発者）がGPT-5.6 Solローンチを記念し、ChatGPT WorkとCodex全体で2回目のレート制限リセットを24時間以内に実施すると発表。",
    keywords: ["GPT-5.6", "Sol", "2nd reset", "2回目", "ChatGPT Work", "Codex", "Tibo", "thsottiaux"],
    source: "https://x.com/thsottiaux",
    sourceLabel: "Tibo氏（OpenAI Codex開発者）のXポストより",
  },
  {
    id: "official-tibo-gpt56-sol-3rd-reset-2026-07-11",
    observedAt: "2026-07-11T00:00:00+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-07-11T16:00:00+09:00",
    expiresAt: "2026-07-12T00:00:00+09:00",
    resolvedAt: "2026-07-11T15:00:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "Tibo氏（OpenAI Codex開発者）が、GPT-5.6 Solローンチ記念の3回目のレート制限リセットを本日後半に実施すると発表しました。",
    keywords: ["GPT-5.6", "Sol", "3rd reset", "3回目", "later today", "Codex", "Tibo", "thsottiaux"],
    source: "https://x.com/thsottiaux",
    sourceLabel: "Tibo氏（OpenAI Codex開発者）のXポストより",
  },
  {
    id: "official-tibo-reset-today-afternoon-2026-07-10",
    observedAt: "2026-07-10T04:09:00+09:00",
    type: "official_notice",
    status: "resolved",
    expectedAt: "2026-07-10T07:00:00+09:00",
    expiresAt: "2026-07-10T12:00:00+09:00",
    resolvedAt: "2026-07-10T07:00:00+09:00",
    skipAutoHistoryMerge: true,
    title:
      "OpenAI Codex開発者のTibo氏が「リセットは今日の午後（米国太平洋時間）に来る」と発言しました。",
    keywords: ["Tibo", "thsottiaux", "reset", "today", "午後", "リセット"],
    source: "https://x.com/thsottiaux",
    sourceLabel: "Tibo氏（OpenAI Codex開発者）のXポストより",
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
      "OpenAI関係者がAI Engineerイベントで Codex reset button の実演を示唆し、Tibo氏も \"It's happening\" と反応しています。",
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
    status: "resolved",
    expectedAt: "2026-06-30T09:30:00+09:00",
    expiresAt: "2026-06-30T12:00:00+09:00",
    resolvedAt: "2026-06-30T09:30:00+09:00",
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
