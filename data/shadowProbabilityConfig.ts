export const LEGACY_SHADOW_PROBABILITY_MODEL_VERSION = "hazard-odds-v2-random-only";
export const SHADOW_PROBABILITY_MODEL_VERSION = "hazard-odds-v3-random-inclusive";
export const RECENCY_H30_PROBABILITY_MODEL_VERSION = "hazard-odds-v3-recency-bayes-h30-r3";
export const CALIBRATED_SHADOW_MODEL_VERSION_V1 =
  "hazard-odds-v4-logit-calibrated-prequential-v1";
export const CALIBRATED_SHADOW_MODEL_VERSION_V2 =
  "hazard-odds-v4-logit-calibrated-prequential-v2";
export const CALIBRATED_SHADOW_MODEL_VERSION =
  "hazard-odds-v4-logit-calibrated-prequential-v3";
export const CALIBRATED_SHADOW_ARCHIVED_MODEL_VERSIONS = [
  CALIBRATED_SHADOW_MODEL_VERSION_V1,
  CALIBRATED_SHADOW_MODEL_VERSION_V2,
] as const;
// Freeze the shared elapsed-hazard parameters for the public elapsed-only model
// and the full-regime shadow until their prospective samples are sufficient.
// A single reset, miss, or new observation must not trigger retuning.
export const REGIME_ELAPSED_FULL_MODEL_VERSION = "hazard-regime-elapsed-v1";
export const ELAPSED_ONLY_MODEL_VERSION = "hazard-elapsed-v1";
export const NEXT_GENERATION_B_MODEL_VERSION = "hazard-regime-random-continuous-calibrated-v1";
export const NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION =
  "hazard-regime-random-continuous-calibrated-post-reset-age-v2";
export const NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION =
  "post-reset-regime-attenuation-0-24h-v1";
export const NEXT_GENERATION_B_POST_RESET_AGE_START_HOURS = 24;
export const PUBLISHED_PROBABILITY_MODEL_VERSION = NEXT_GENERATION_B_MODEL_VERSION;
export const PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION = CALIBRATED_SHADOW_MODEL_VERSION;
export const PUBLISHED_STABLE_FALLBACK_MODEL_VERSION = ELAPSED_ONLY_MODEL_VERSION;
export const PUBLISHED_PROBABILITY_ADOPTION_MODE = "manual" as const;
export const PUBLISHED_PROBABILITY_ADOPTION_DATE = "2026-08-23";
export const PUBLISHED_PROBABILITY_ADOPTION_AT = "2026-08-23T02:04:00.000Z";
export const PUBLISHED_PROBABILITY_PREVIOUS_ADOPTION_AT = "2026-08-20T11:21:37.105Z";
export const PUBLISHED_PROBABILITY_ADOPTION_GATE_STATUS = "not_met" as const;
// Shadow-only comparison: the random-event hazard clock ignores regular recovery boundaries.
// Keep these parameters frozen until the prospective sample is sufficient for manual review.
export const RANDOM_ELAPSED_SHADOW_MODEL_VERSION = "hazard-regime-random-elapsed-v1";
export const RANDOM_ELAPSED_SHADOW_FREEZE_AT = "2026-08-11T18:38:51.000Z";
export const RANDOM_ELAPSED_SHADOW_FREEZE_POLICY =
  "A single reset, miss, or new observation must not trigger retuning.";
export const RANDOM_ELAPSED_SHADOW_TARGET_DEFINITION =
  "Broad-scope random reset probability modeled by elapsed time since the latest broad-scope random reset and the existing point-in-time random-reset regime. Regular resets remain recovery boundaries for product/state logic but do not reset the random-event hazard clock.";
// Preregistered prospective-only continuous estimator. The implementation is intentionally
// added separately after this configuration is committed; do not fit or backfill it before
// RANDOM_CONTINUOUS_SHADOW_FREEZE_AT.
export const RANDOM_CONTINUOUS_SHADOW_MODEL_VERSION = "hazard-regime-random-continuous-v1";
export const RANDOM_CONTINUOUS_SHADOW_FREEZE_AT = "2026-08-18T16:14:21.000Z";
export const RANDOM_CONTINUOUS_SHADOW_FREEZE_POLICY =
  "A single reset, miss, or new observation must not trigger retuning.";
export const RANDOM_CONTINUOUS_SHADOW_TARGET_DEFINITION = RANDOM_ELAPSED_SHADOW_TARGET_DEFINITION;
export const RANDOM_CONTINUOUS_SHADOW_BANDWIDTH_HOURS = 24;
export const RANDOM_CONTINUOUS_SHADOW_GRID_HOURS = 1;
export const RANDOM_CONTINUOUS_SHADOW_TRUNCATION_HOURS = 72;
export const RANDOM_CONTINUOUS_SHADOW_LOCAL_PRIOR_EXPOSURE_DAYS = 2;
export const RANDOM_CONTINUOUS_SHADOW_LOCAL_PRIOR_WINDOW_HOURS = 48;
export const RANDOM_CONTINUOUS_SHADOW_KERNEL = "gaussian" as const;
export const RANDOM_CONTINUOUS_SHADOW_PROBE_AGES_HOURS = [
  96,
  120,
  132,
  144,
  156,
  168,
  192,
  216,
] as const;

// Next-generation model identities are independently preregistered. Keep their
// identity and freeze boundary separate from the existing model aliases;
// B is public after its manual adoption boundary while A/C remain shadows.
export const NEXT_GENERATION_A_MODEL_VERSION = "hazard-ensemble-logit-stack-v1";
export const NEXT_GENERATION_B_RAW_MODEL_VERSION = RANDOM_CONTINUOUS_SHADOW_MODEL_VERSION;
export const NEXT_GENERATION_FREEZE_AT = "2026-08-21T03:27:00.000Z";
export const NEXT_GENERATION_FREEZE_POLICY =
  "A single reset, miss, or new observation must not trigger retuning.";
export const NEXT_GENERATION_EVALUATION_MODE = "prospective" as const;
export const NEXT_GENERATION_BACKFILL = false as const;
export const NEXT_GENERATION_AUTO_PUBLISH = false as const;

export const NEXT_GENERATION_B_FROZEN_CONTINUOUS_CONFIG = {
  bandwidthHours: 24,
  gridHours: 1,
  truncationHours: 72,
  localPriorExposureDays: 2,
  localPriorWindowHours: 48,
  integrationStepMinutes: 10,
  globalPriorEventCount: 1,
  globalPriorExposureDays: 10,
  minimumDailyProbability: 0.01,
  maximumDailyProbability: 0.35,
} as const;

export const NEXT_GENERATION_B_FROZEN_REGIME_CONFIG = {
  binScheme: "A" as const,
  priorExposureDays: 2,
  regimeHalfLifeDays: 3,
  regimeRatioExponent: 1,
  minRegimeMultiplier: 0.5,
  maxRegimeMultiplier: 2,
} as const;

export const NEXT_GENERATION_B_FROZEN_SIGNAL_CONFIG = {
  teaser: { probability24h: 0.8, probability48h: 1.2 },
  teaserStrength: {
    lookbackHours: 48,
    weak: { multiplier24h: 1.15, multiplier48h: 1.2 },
    strong: { multiplier24h: 1.35, multiplier48h: 1.5 },
  },
  statusSignal: { probability24h: 0.5, probability48h: 0.7 },
  officialIncidentHint: {
    one: { probability24h: 1.75, probability48h: 1.9 },
    twoOrMore: { probability24h: 2.5, probability48h: 2.8 },
  },
  officialUpdate: { probability24hPerItem: 0.2, probability48hPerItem: 0.25, maxItems: 2 },
  communitySignal: { probability24h: 0.15, probability48h: 0.2 },
  usageLimitAnomaly: { probability24h: 0.25, probability48h: 0.35 },
  complaintPressure: { medium: 1.1, high: 1.25 },
  maximumCombinedOddsMultiplier24h: 5,
  maximumCombinedOddsMultiplier48h: 6,
} as const;

// Third next-generation shadow. Keep its identity, fit constants, and freeze
// boundary independent from A/B so future changes require a new C version.
export const NEXT_GENERATION_C_MODEL_VERSION = "hazard-contextual-burst-circadian-v1";
export const NEXT_GENERATION_C_FREEZE_AT = "2026-08-22T06:15:00.000Z";
export const NEXT_GENERATION_C_FREEZE_POLICY =
  "A single reset, miss, or new observation must not trigger retuning.";
export const NEXT_GENERATION_C_CONTEXT_PRIOR_STD_DEV = 0.5;
export const NEXT_GENERATION_C_MINIMUM_RANDOM_EVENTS = 15;
export const NEXT_GENERATION_C_MINIMUM_EXPOSURE_CELLS = 720;
export const NEXT_GENERATION_C_MIN_MULTIPLIER = 0.5;
export const NEXT_GENERATION_C_MAX_MULTIPLIER = 2;
export const NEXT_GENERATION_C_SOLVER_MAX_ITERATIONS = 250;
export const NEXT_GENERATION_C_SOLVER_TOLERANCE = 1e-7;
export const NEXT_GENERATION_C_SOLVER_INITIAL_STEP = 1;
export const NEXT_GENERATION_C_SOLVER_BACKTRACKING_FACTOR = 0.5;
export const NEXT_GENERATION_C_SOLVER_MAX_BACKTRACKING_STEPS = 24;
export const NEXT_GENERATION_C_FROZEN_CONTINUOUS_CONFIG = {
  bandwidthHours: 24,
  gridHours: 1,
  truncationHours: 72,
  localPriorExposureDays: 2,
  localPriorWindowHours: 48,
  integrationStepMinutes: 10,
  globalPriorEventCount: 1,
  globalPriorExposureDays: 10,
  minimumDailyProbability: 0.01,
  maximumDailyProbability: 0.35,
} as const;
export const NEXT_GENERATION_C_FROZEN_SIGNAL_CONFIG = NEXT_GENERATION_B_FROZEN_SIGNAL_CONFIG;

export const NEXT_GENERATION_A_COMPONENT_VERSIONS = [
  CALIBRATED_SHADOW_MODEL_VERSION,
  NEXT_GENERATION_B_MODEL_VERSION,
  REGIME_ELAPSED_FULL_MODEL_VERSION,
  RANDOM_ELAPSED_SHADOW_MODEL_VERSION,
  RECENCY_H30_PROBABILITY_MODEL_VERSION,
] as const;
export const NEXT_GENERATION_A_COMPONENT_LOGIT_EPSILON = 1e-4;
export const NEXT_GENERATION_A_ALPHA_PRIOR_STD_DEV = 0.5;
export const NEXT_GENERATION_A_WEIGHT_PRIOR_MEAN = 0.2;
export const NEXT_GENERATION_A_WEIGHT_PRIOR_STD_DEV = 0.15;
export const NEXT_GENERATION_A_MINIMUM_SAMPLES = 10;
export const NEXT_GENERATION_A_SOLVER_MAX_ITERATIONS = 200;
export const NEXT_GENERATION_A_SOLVER_TOLERANCE = 1e-7;
export const NEXT_GENERATION_A_SOLVER_INITIAL_STEP = 1;
export const NEXT_GENERATION_A_SOLVER_BACKTRACKING_FACTOR = 0.5;
export const NEXT_GENERATION_A_SOLVER_MAX_BACKTRACKING_STEPS = 20;
export const PUBLISHED_RECENCY_HALF_LIFE_DAYS = 30;
export const REGIME_ELAPSED_SELECTED_BIN_SCHEME = "A" as const;
export const REGIME_ELAPSED_SELECTED_PRIOR_EXPOSURE_DAYS = 2;
export const REGIME_ELAPSED_SELECTED_REGIME_HALF_LIFE_DAYS = 3;
export const REGIME_ELAPSED_SELECTED_RATIO_EXPONENT = 1;
export const REGIME_ELAPSED_MIN_MULTIPLIER = 0.5;
export const REGIME_ELAPSED_MAX_MULTIPLIER = 2;
// Single source of truth for the frozen full regime-elapsed shadow configuration.
// Candidate evaluation may still explore other configurations separately.
export const PUBLISHED_REGIME_ELAPSED_MODEL_OPTIONS = {
  modelVersion: REGIME_ELAPSED_FULL_MODEL_VERSION,
  binScheme: REGIME_ELAPSED_SELECTED_BIN_SCHEME,
  priorExposureDays: REGIME_ELAPSED_SELECTED_PRIOR_EXPOSURE_DAYS,
  regimeHalfLifeDays: REGIME_ELAPSED_SELECTED_REGIME_HALF_LIFE_DAYS,
  regimeRatioExponent: REGIME_ELAPSED_SELECTED_RATIO_EXPONENT,
  minRegimeMultiplier: REGIME_ELAPSED_MIN_MULTIPLIER,
  maxRegimeMultiplier: REGIME_ELAPSED_MAX_MULTIPLIER,
  mode: "full" as const,
} as const;
// The published forecast uses the same frozen elapsed hazard, but deliberately
// excludes the regime multiplier. The full model remains available for shadow
// diagnostics and prospective comparison.
export const PUBLISHED_ELAPSED_MODEL_OPTIONS = {
  ...PUBLISHED_REGIME_ELAPSED_MODEL_OPTIONS,
  modelVersion: ELAPSED_ONLY_MODEL_VERSION,
  mode: "elapsed-only" as const,
} as const;
export const REGIME_ELAPSED_BIN_SCHEME_CANDIDATES = ["A", "B"] as const;
export const REGIME_ELAPSED_PRIOR_EXPOSURE_DAY_CANDIDATES = [2, 5, 10, 20] as const;
export const REGIME_ELAPSED_REGIME_HALF_LIFE_CANDIDATES = [3, 5, 7, 10, 14] as const;
export const REGIME_ELAPSED_RATIO_EXPONENT_CANDIDATES = [0.25, 0.5, 0.75, 1] as const;
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
  teaserStrength: {
    lookbackHours: 48,
    weak: {
      multiplier24h: 1.15,
      multiplier48h: 1.2,
    },
    strong: {
      multiplier24h: 1.35,
      multiplier48h: 1.5,
    },
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
  maximumCombinedOddsMultiplier24h: MAX_TOTAL_ODDS_MULTIPLIER_24H,
  maximumCombinedOddsMultiplier48h: MAX_TOTAL_ODDS_MULTIPLIER_48H,
} as const;

export const SHADOW_TARGET_DEFINITION =
  "Completed broad-scope random reset events after reset-history deduplication; includes forced resets and Banked Reset distributions, while excluding regular resets, narrow-scope distributions, pending or opened-only records, rejected Tibo signals, future or invalid timestamps, and reference records.";

export const RECENCY_SHADOW_MODEL_CONFIG = [
  {
    modelVersion: "hazard-odds-v3-recency-bayes-h14-r2",
    halfLifeDays: 14,
    includeTeaserStrengthBoost: false,
  },
  {
    modelVersion: RECENCY_H30_PROBABILITY_MODEL_VERSION,
    halfLifeDays: PUBLISHED_RECENCY_HALF_LIFE_DAYS,
    includeTeaserStrengthBoost: true,
  },
  {
    modelVersion: "hazard-odds-v3-recency-bayes-h60-r2",
    halfLifeDays: 60,
    includeTeaserStrengthBoost: false,
  },
] as const;
