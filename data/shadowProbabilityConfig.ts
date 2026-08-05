export const LEGACY_SHADOW_PROBABILITY_MODEL_VERSION = "hazard-odds-v2-random-only";
export const SHADOW_PROBABILITY_MODEL_VERSION = "hazard-odds-v3-random-inclusive";
export const PUBLISHED_PROBABILITY_MODEL_VERSION = "hazard-odds-v3-recency-bayes-h30-r2";
export const PUBLISHED_RECENCY_HALF_LIFE_DAYS = 30;
export const CALIBRATED_SHADOW_MODEL_VERSION_V1 =
  "hazard-odds-v4-logit-calibrated-prequential-v1";
export const CALIBRATED_SHADOW_MODEL_VERSION =
  "hazard-odds-v4-logit-calibrated-prequential-v2";
export const CALIBRATED_SHADOW_ARCHIVED_MODEL_VERSIONS = [
  CALIBRATED_SHADOW_MODEL_VERSION_V1,
] as const;
export const CALIBRATED_SHADOW_POINT_IN_TIME_PROJECTION_VERSION =
  "status-conservative-v2";
export const CALIBRATED_SHADOW_POINT_IN_TIME_PROJECTION_LIMITATIONS =
  "Intermediate Status updates are unavailable; incidents updated after an origin are conservatively projected as investigating.";

export const HAZARD_BIN_HOURS = 24;
export const HAZARD_TAIL_START_DAYS = 7;

export const GLOBAL_PRIOR_EVENT_COUNT = 1;
export const GLOBAL_PRIOR_EXPOSURE_DAYS = 10;
export const BIN_PRIOR_EQUIVALENT_EXPOSURE_DAYS = 20;

export const MIN_BASELINE_DAILY_PROBABILITY = 0.01;
export const MAX_BASELINE_DAILY_PROBABILITY = 0.35;

export const MAX_TOTAL_ODDS_MULTIPLIER_24H = 5;
export const MAX_TOTAL_ODDS_MULTIPLIER_48H = 6;

export const SHADOW_CONFIDENCE_INTERVAL_COUNT = 30;
export const SHADOW_CONFIDENCE_EXPOSURE_DAYS = 120;

export const SHADOW_SIGNAL_MULTIPLIER_CONFIG = {
  recentResetMomentum: {
    two: 1.05,
    three: 1.15,
    fourOrMore: 1.25,
  },
  regularResetProximity: {
    probability24h: 0.35,
    probability48h: 0.5,
  },
  teaser: {
    probability24h: 0.8,
    probability48h: 1.2,
  },
  statusSignal: {
    probability24h: 0.5,
    probability48h: 0.7,
  },
  officialIncidentHint: {
    one: { probability24h: 1.75, probability48h: 1.9 },
    twoOrMore: { probability24h: 2.5, probability48h: 2.8 },
  },
  officialUpdate: {
    probability24hPerItem: 0.2,
    probability48hPerItem: 0.25,
    maxItems: 2,
  },
  communitySignal: {
    probability24h: 0.15,
    probability48h: 0.2,
  },
  usageLimitAnomaly: {
    probability24h: 0.25,
    probability48h: 0.35,
  },
  complaintPressure: {
    medium: 1.1,
    high: 1.25,
  },
} as const;

export const SHADOW_TARGET_DEFINITION =
  "Completed broad-scope random reset events after reset-history deduplication; includes forced resets and Banked Reset distributions, while excluding regular resets, narrow-scope distributions, pending or opened-only records, rejected Tibo signals, future or invalid timestamps, and reference records.";

export const RECENCY_SHADOW_MODEL_CONFIG = [
  {
    modelVersion: "hazard-odds-v3-recency-bayes-h14-r2",
    halfLifeDays: 14,
  },
  {
    modelVersion: PUBLISHED_PROBABILITY_MODEL_VERSION,
    halfLifeDays: PUBLISHED_RECENCY_HALF_LIFE_DAYS,
  },
  {
    modelVersion: "hazard-odds-v3-recency-bayes-h60-r2",
    halfLifeDays: 60,
  },
] as const;
