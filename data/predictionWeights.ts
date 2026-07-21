export const EXPECTATION_THRESHOLDS = {
  medium: { p24h: 0.1, p48h: 0.3 },
  high: { p24h: 0.3, p48h: 0.6 },
  veryHigh: { p24h: 0.6, p48h: 0.8 },
} as const;

export const RECOMMENDED_ACTION_THRESHOLDS = {
  watch: 0.1,
  medium: 0.3,
  high: 0.6,
} as const;

export const REFRESH_INTERVAL_MS = {
  unknown: 3 * 60 * 60 * 1000,
  low: 6 * 60 * 60 * 1000,
  medium: 3 * 60 * 60 * 1000,
  high: 60 * 60 * 1000,
  veryHigh: 30 * 60 * 1000,
} as const;

export const LOCAL_PROBABILITY_WEIGHTS = {
  min: 0.02,
  max: {
    within24h: 0.72,
    within48h: 0.82,
  },
  officialNotice: {
    within24h: 0.9,
    within48h: 0.96,
  },
  base: {
    within24h: 0.025,
    within48h: 0.06,
  },
  countLimits: {
    statusIncidents: 5,
    officialIncidentHints: 3,
    officialUpdates: 8,
    communityMentions: 80,
    issueAnomalies: 30,
  },
  signalWeights: {
    statusIncident: {
      within24h: 0.05,
      within48h: 0.07,
    },
    officialUpdate: {
      within24h: 0.004,
      within48h: 0.007,
    },
    officialIncidentHint: {
      within24h: 0.25,
      within48h: 0.32,
    },
    communityMention: {
      within24h: 0.0008,
      within48h: 0.0015,
    },
    issueAnomaly: {
      within24h: 0.004,
      within48h: 0.007,
    },
  },
  pressureBoost: {
    high: 0.12,
    medium: 0.05,
    low: 0,
  },
  elapsedDayBoost: {
    perDay: 0.01,
  },
  historyPressure: [
    {
      maxDaysSinceReset: 2,
      within24h: -0.02,
      within48h: -0.04,
    },
    {
      maxDaysSinceReset: 5,
      within24h: 0,
      within48h: 0,
    },
    {
      maxDaysSinceReset: 9,
      within24h: 0.015,
      within48h: 0.035,
    },
    {
      maxDaysSinceReset: 13,
      within24h: 0.035,
      within48h: 0.07,
    },
    {
      maxDaysSinceReset: Number.POSITIVE_INFINITY,
      within24h: 0.05,
      within48h: 0.09,
    },
  ],
} as const;
