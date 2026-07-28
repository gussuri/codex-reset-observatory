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
    observedAt: "2026-07-28T04:00:00.000Z",
    type: "probability_boost",
    status: "active",
    expiresAt: "2026-07-30T04:00:00.000Z",
    boostValue24h: 0.345,
    boostValue48h: 0.48,
    boostReason: "Tibo氏の「明日またChatGPTとCodexの楽しい出来事で会いましょう」匂わせ投稿",
    title: "Tibo氏の「明日また会いましょう」匂わせ投稿",
    source: "https://x.com/thsottiaux",
    sourceLabel: "Tibo氏（OpenAI Codex開発責任者）のXポストより",
  },
  {
    id: "boost-post-reset-adjustment-2026-07-28",
    observedAt: "2026-07-28T02:10:00.000Z",
    type: "probability_boost",
    status: "resolved",
    resolvedAt: "2026-07-28T04:00:00.000Z",
    expiresAt: "2026-07-30T02:10:00.000Z",
    boostValue24h: -0.05,
    boostValue48h: -0.05,
    boostReason: "7/28 02:10 UTCのリセット実施に伴い確率補正完了",
    title: "7/28 リセット実施に伴う確率補正",
    source: "https://x.com/thsottiaux",
    sourceLabel: "Codex リセット観測データ",
  },
];
