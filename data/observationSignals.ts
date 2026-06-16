export type LocalObservationSignal = {
  id: string;
  observedAt: string;
  type:
    | "official_notice"
    | "status_incident"
    | "community_report"
    | "limit_anomaly";
  title: string;
  source?: string | null;
};

export const LOCAL_OBSERVATION_SIGNALS: Array<LocalObservationSignal> = [
  {
    id: "official-codex-rate-limit-reset-notice-2026-06-17",
    observedAt: "2026-06-17T04:30:00+09:00",
    type: "official_notice",
    title:
      "Tibo氏が、全プランのCodexレート制限を24時間以内にリセットすると発表しました。",
    source: "https://x.com/thsottiaux/status/2066956441173323943",
  },
];
