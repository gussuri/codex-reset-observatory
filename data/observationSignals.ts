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

export const LOCAL_OBSERVATION_SIGNALS: Array<LocalObservationSignal> = [];
