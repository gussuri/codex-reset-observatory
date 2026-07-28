export type LocalObservationSignal = {
  id: string;
  observedAt: string;
  expectedAt?: string;
  expectedEndAt?: string;
  type: "official_notice" | "official_incident_hint" | "probability_boost" | "status_incident" | "community_report" | "limit_anomaly";
  status: "active" | "resolved" | "expired";
  expiresAt?: string;
  resolvedAt?: string;
  boostValue?: number;
  boostValue24h?: number;
  boostValue48h?: number;
  boostReason?: string;
  title: string;
  source: string;
  sourceLabel: string;
  skipAutoHistoryMerge?: boolean;
  keywords?: Array<string>;
};

export const LOCAL_OBSERVATION_SIGNALS: Array<LocalObservationSignal> = [
  {
    id: "official-tibo-recharge-tomorrow-hint-2026-07-28",
    observedAt: "2026-07-27T19:00:00.000Z",
    type: "probability_boost",
    status: "active",
    expiresAt: "2026-07-30T04:00:00.000Z",
    boostValue24h: 0.40,
    boostValue48h: 0.55,
    boostReason: "Tibo氏の「明日またChatGPTとCodexの楽しい出来事で会いましょう」匂わせ投稿",
    title: "Tibo氏の「明日また会いましょう」匂わせ投稿",
    source: "https://x.com/thsottiaux",
    sourceLabel: "Tibo氏（OpenAI Codex開発責任者）のXポストより",
  },
  {
    id: "boost-post-reset-adjustment-2026-07-28",
    observedAt: "2026-07-28T03:09:00.000Z",
    type: "probability_boost",
    status: "active",
    expiresAt: "2026-07-29T21:00:00+09:00",
    boostValue24h: -0.20,
    boostValue48h: -0.05,
    title: "前回リセット直後（間隔理論による確率抑制）",
    source: "https://x.com/thsottiaux",
    sourceLabel: "Codex リセット観測データ (間隔理論)",
  },
];
