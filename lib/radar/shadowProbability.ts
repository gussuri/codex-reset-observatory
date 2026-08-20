import {
  AUTOMATED_TIBO_SIGNAL_WEIGHTS,
  LOCAL_PROBABILITY_WEIGHTS,
} from "@/data/predictionWeights";
import {
  BIN_PRIOR_EQUIVALENT_EXPOSURE_DAYS,
  GLOBAL_PRIOR_EVENT_COUNT,
  GLOBAL_PRIOR_EXPOSURE_DAYS,
  HAZARD_BIN_HOURS,
  HAZARD_TAIL_START_DAYS,
  MAX_BASELINE_DAILY_PROBABILITY,
  MAX_TOTAL_ODDS_MULTIPLIER_24H,
  MAX_TOTAL_ODDS_MULTIPLIER_48H,
  MIN_BASELINE_DAILY_PROBABILITY,
  SHADOW_CONFIDENCE_EXPOSURE_DAYS,
  SHADOW_CONFIDENCE_INTERVAL_COUNT,
  SHADOW_PROBABILITY_MODEL_VERSION,
  SHADOW_SIGNAL_MULTIPLIER_CONFIG,
  SHADOW_TARGET_DEFINITION,
} from "@/data/shadowProbabilityConfig";
import {
  LOCAL_OBSERVATION_SIGNALS,
  type LocalObservationSignal,
} from "@/data/observationSignals";
import { LOCAL_RESET_HISTORY } from "@/data/resetHistory";
import type {
  ActiveOfficialNotice,
  LocalSignalEvaluation,
} from "./probability";
import {
  getCompletedResetTimestamp,
  getEffectiveSignalStatus,
  getActiveOfficialNotice,
  getLocalSignalEvaluation,
  getRecent7DayResetCount,
  getRegularResetProximityBoost,
  getTeaserDecayFactor,
} from "./probability";
import type { RadarData, WindowEventLike } from "./types";
import { combineResetHistory, getNoticeBackedHistoryInputs } from "./tiboHistory";
import { isEligibleRandomResetEvent } from "./resetEligibility";
import { getTeaserStrengthSignals } from "./teaserStrength";
import { getTemporalNoticeCoverage } from "./tiboTemporal";

const HOUR_MS = 60 * 60 * 1000;

export type ShadowResetEvent = {
  id: string;
  resetAt: string;
};

export type ShadowHazardBin = {
  startHour: number;
  endHour: number | null;
  exposureHours: number;
  observedEvents: number;
  posteriorLambdaPerHour: number;
  impliedDailyProbability: number;
};

export type ShadowHazard = {
  globalLambdaPerHour: number;
  observedEventCount: number;
  weightedEventCount: number;
  completedEventCount: number;
  completedIntervalCount: number;
  totalExposureHours: number;
  weightedExposureHours: number;
  totalExposureDays: number;
  bins: Array<ShadowHazardBin>;
};

export type ShadowHazardBuildOptions = {
  completedIntervalWeight?: (input: {
    previousTime: number;
    currentTime: number;
    intervalHours: number;
  }) => number;
};

export type ShadowProbabilityPair = {
  probability24h: number;
  probability48h: number;
};

export type ShadowProbabilityHorizons = {
  probability12h: number;
  probability24h: number;
  probability48h: number;
  probability72h: number;
};

export type ShadowSignalMultipliers = {
  recentResetMomentum: ShadowProbabilityPair;
  regularResetProximity: ShadowProbabilityPair;
  teaser: ShadowProbabilityPair;
  teaserStrength: ShadowProbabilityPair;
  statusSignal: ShadowProbabilityPair;
  officialIncidentHint: ShadowProbabilityPair;
  officialUpdate: ShadowProbabilityPair;
  communitySignal: ShadowProbabilityPair;
  usageLimitAnomaly: ShadowProbabilityPair;
  complaintPressure: ShadowProbabilityPair;
  combinedBeforeCap: ShadowProbabilityPair;
  combinedAfterCap: ShadowProbabilityPair;
};

export type ShadowSignalInputs = {
  recentResetCount7d: number;
  regularResetProximity: number;
  teaserScore: number;
  teaserStrengthMultiplier?: ShadowProbabilityPair;
  normalizedStatusScore: number;
  officialIncidentHintCount: number;
  officialUpdateCount: number;
  communityScore: number;
  usageLimitAnomalyScore: number;
  complaintPressure: "low" | "medium" | "high";
};

export type ShadowProbabilityResult = {
  modelVersion: string;
  calculatedAt: string;
  targetDefinition: string;
  predictions: ShadowProbabilityHorizons;
  baseline: ShadowProbabilityHorizons;
  confidence: {
    level: "low" | "medium" | "high";
    reason: string;
    completedIntervalCount: number;
    totalExposureDays: number;
  };
  hazard: ShadowHazard;
  multipliers: ShadowSignalMultipliers;
  officialNoticeOverride: {
    active: boolean;
    probability12h: number | null;
    probability24h: number | null;
    probability48h: number | null;
    probability72h: number | null;
  };
  warnings: string[];
};

export type ShadowProbabilityOptions = {
  now?: Date;
  signalEvaluation?: LocalSignalEvaluation;
  activeOfficialNotice?: ActiveOfficialNotice | null;
  regularResetExpectedAt?: string | null;
  staticHistory?: Array<WindowEventLike>;
  localObservationSignals?: Array<LocalObservationSignal>;
};

export type ShadowProbabilityModelOptions = {
  modelVersion?: string;
  hazardOptions?: ShadowHazardBuildOptions;
  includeTeaserStrengthBoost?: boolean;
  legacyOfficialNoticeOverride?: boolean;
};

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function derive12hFrom24hProbability(probability24h: number) {
  const safe24h = clamp01(probability24h);
  return clamp01(1 - Math.pow(1 - safe24h, 12 / 24));
}

export function derive72hFrom48hProbability(probability48h: number) {
  const safe48h = clamp01(probability48h);
  return clamp01(1 - Math.pow(1 - safe48h, 72 / 48));
}

function finiteNonNegative(value: number | undefined | null) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getTweetId(sourceUrl: string | null | undefined) {
  return sourceUrl?.match(/\/status\/(\d+)/i)?.[1] ?? null;
}

function isShadowTargetReset(item: WindowEventLike, nowTime: number) {
  return isEligibleRandomResetEvent(item, getCompletedResetTimestamp(item), nowTime);
}

export function getShadowCompletedResetEvents(
  data: RadarData | null,
  now: Date,
  staticHistory: Array<WindowEventLike> = LOCAL_RESET_HISTORY,
): Array<ShadowResetEvent> {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return [];

  const { noticeSignals, recoveryObservations, estimates } = getNoticeBackedHistoryInputs(data);
  const combinedHistory = combineResetHistory(
    staticHistory,
    data?.formal_tibo_resets ?? [],
    data?.rejected_tibo_resets ?? [],
    data?.regular_reset_events ?? [],
    noticeSignals,
    recoveryObservations,
    estimates,
  );
  const seen = new Set<string>();

  return combinedHistory
    .filter((item) => isShadowTargetReset(item, nowTime))
    .flatMap((item) => {
      const resetAt = getCompletedResetTimestamp(item);
      if (resetAt === null) return [];
      const sourceIdentity = getTweetId(item.source_url)
        ?? (item.source_url?.includes("/status/") ? item.source_url : null);
      const key = sourceIdentity
        ? `source:${sourceIdentity}`
        : `${item.id ?? "unknown"}:${resetAt}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        id: item.id ?? key,
        resetAt: new Date(resetAt).toISOString(),
      }];
    })
    .sort((left, right) => getTimestamp(left.resetAt)! - getTimestamp(right.resetAt)!);
}

function getBinIndex(ageHours: number) {
  return Math.min(
    Math.max(0, Math.floor(ageHours / HAZARD_BIN_HOURS)),
    Math.floor((HAZARD_TAIL_START_DAYS * 24) / HAZARD_BIN_HOURS),
  );
}

function createEmptyBins() {
  const binCount = Math.floor((HAZARD_TAIL_START_DAYS * 24) / HAZARD_BIN_HOURS) + 1;
  return Array.from({ length: binCount }, (_, index): ShadowHazardBin => ({
    startHour: index * HAZARD_BIN_HOURS,
    endHour: index === binCount - 1 ? null : (index + 1) * HAZARD_BIN_HOURS,
    exposureHours: 0,
    observedEvents: 0,
    posteriorLambdaPerHour: 0,
    impliedDailyProbability: 0,
  }));
}

function addExposure(
  bins: Array<ShadowHazardBin>,
  startHour: number,
  durationHours: number,
  weight = 1,
) {
  if (
    !Number.isFinite(startHour)
    || !Number.isFinite(durationHours)
    || durationHours <= 0
    || !Number.isFinite(weight)
    || weight < 0
  ) {
    return;
  }

  const endHour = startHour + durationHours;
  let cursor = Math.max(0, startHour);
  while (cursor < endHour) {
    const index = getBinIndex(cursor);
    const bin = bins[index];
    const boundary = bin.endHour ?? Number.POSITIVE_INFINITY;
    const segmentEnd = Math.min(endHour, boundary);
    bin.exposureHours += Math.max(0, segmentEnd - cursor) * weight;
    if (!Number.isFinite(segmentEnd) || segmentEnd <= cursor) break;
    cursor = segmentEnd;
  }
}

export function buildShadowHazard(
  events: Array<ShadowResetEvent>,
  now: Date,
  options: ShadowHazardBuildOptions = {},
): ShadowHazard {
  const nowTime = now.getTime();
  const uniqueEvents = Array.from(
    new Map(
      events
        .map((event) => ({ event, timestamp: getTimestamp(event.resetAt) }))
        .filter(({ timestamp }) => timestamp !== null && timestamp <= nowTime)
        .map(({ event, timestamp }) => [`${event.id}:${timestamp}`, {
          id: event.id,
          resetAt: new Date(timestamp!).toISOString(),
        }]),
    ).values(),
  ).sort((left, right) => getTimestamp(left.resetAt)! - getTimestamp(right.resetAt)!);

  const bins = createEmptyBins();
  let rawObservedEventCount = 0;
  let weightedEventCount = 0;
  let weightedExposureHours = 0;

  for (let index = 1; index < uniqueEvents.length; index += 1) {
    const previousTime = getTimestamp(uniqueEvents[index - 1].resetAt)!;
    const currentTime = getTimestamp(uniqueEvents[index].resetAt)!;
    const intervalHours = (currentTime - previousTime) / HOUR_MS;
    if (intervalHours <= 0) continue;
    const rawWeight = options.completedIntervalWeight?.({
      previousTime,
      currentTime,
      intervalHours,
    }) ?? 1;
    const weight = Number.isFinite(rawWeight) && rawWeight >= 0 ? rawWeight : 0;
    addExposure(bins, 0, intervalHours, weight);
    bins[getBinIndex(intervalHours)].observedEvents += weight;
    rawObservedEventCount += 1;
    weightedEventCount += weight;
    weightedExposureHours += intervalHours * weight;
  }

  if (uniqueEvents.length > 0) {
    const latestTime = getTimestamp(uniqueEvents[uniqueEvents.length - 1].resetAt)!;
    const censoredHours = Math.max(0, (nowTime - latestTime) / HOUR_MS);
    addExposure(bins, 0, censoredHours, 1);
    weightedExposureHours += censoredHours;
  }

  const effectiveEventCount = weightedEventCount;
  const effectiveExposureHours = weightedExposureHours;
  const globalLambdaPerHour = (
    effectiveEventCount + GLOBAL_PRIOR_EVENT_COUNT
  ) / (
    effectiveExposureHours + GLOBAL_PRIOR_EXPOSURE_DAYS * 24
  );
  const binPriorExposureHours = BIN_PRIOR_EQUIVALENT_EXPOSURE_DAYS * 24;
  const binPriorEventCount = globalLambdaPerHour * binPriorExposureHours;

  for (const bin of bins) {
    const posteriorLambda = (
      bin.observedEvents + binPriorEventCount
    ) / (
      bin.exposureHours + binPriorExposureHours
    );
    const impliedDailyProbability = clamp01(1 - Math.exp(-posteriorLambda * 24));
    const safeDailyProbability = Math.min(
      MAX_BASELINE_DAILY_PROBABILITY,
      Math.max(MIN_BASELINE_DAILY_PROBABILITY, impliedDailyProbability),
    );
    bin.posteriorLambdaPerHour = -Math.log(1 - safeDailyProbability) / 24;
    bin.impliedDailyProbability = safeDailyProbability;
  }

  return {
    globalLambdaPerHour,
    observedEventCount: rawObservedEventCount,
    weightedEventCount,
    completedEventCount: uniqueEvents.length,
    completedIntervalCount: rawObservedEventCount,
    totalExposureHours: weightedExposureHours,
    weightedExposureHours,
    totalExposureDays: weightedExposureHours / 24,
    bins,
  };
}

export function integrateHazardProbability(
  hazard: ShadowHazard,
  startAgeHours: number,
  horizonHours: number,
) {
  if (!Number.isFinite(startAgeHours) || !Number.isFinite(horizonHours) || horizonHours <= 0) {
    return 0;
  }

  const start = Math.max(0, startAgeHours);
  const end = start + horizonHours;
  let cursor = start;
  let cumulativeHazard = 0;
  while (cursor < end) {
    const bin = hazard.bins[getBinIndex(cursor)];
    const boundary = bin.endHour ?? Number.POSITIVE_INFINITY;
    const segmentEnd = Math.min(end, boundary);
    const segmentHours = Math.max(0, segmentEnd - cursor);
    cumulativeHazard += bin.posteriorLambdaPerHour * segmentHours;
    if (!Number.isFinite(segmentEnd) || segmentEnd <= cursor) break;
    cursor = segmentEnd;
  }

  return clamp01(1 - Math.exp(-Math.max(0, cumulativeHazard)));
}

export function probabilityToOdds(probability: number) {
  const safeProbability = clamp01(probability);
  if (safeProbability <= 0) return 0;
  if (safeProbability >= 1) return Number.POSITIVE_INFINITY;
  return safeProbability / (1 - safeProbability);
}

export function oddsToProbability(odds: number) {
  if (odds === Number.POSITIVE_INFINITY) return 1;
  if (!Number.isFinite(odds) || odds <= 0) return 0;
  return clamp01(odds / (1 + odds));
}

export function applyOddsMultiplier(probability: number, multiplier: number) {
  if (probability <= 0) return 0;
  if (probability >= 1) return 1;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return oddsToProbability(probabilityToOdds(probability) * multiplier);
}

function pair(probability24h: number, probability48h: number): ShadowProbabilityPair {
  return { probability24h, probability48h };
}

function multiplyPairs(values: Array<ShadowProbabilityPair>) {
  return values.reduce(
    (result, value) => pair(
      result.probability24h * value.probability24h,
      result.probability48h * value.probability48h,
    ),
    pair(1, 1),
  );
}

export function calculateShadowSignalMultipliers(input: ShadowSignalInputs): ShadowSignalMultipliers {
  // hazard-odds-v3-random-inclusive estimates the random-reset process. Recent
  // reset frequency and regular-reset proximity remain in the input shape for
  // audit compatibility, but must not change the public random-reset odds.
  const recentResetMultiplier = 1;
  const regularResetMultiplier = 1;
  const teaserScore = clamp01(input.teaserScore);
  const statusScore = clamp01(input.normalizedStatusScore);
  const communityScore = clamp01(input.communityScore);
  const anomalyScore = clamp01(input.usageLimitAnomalyScore);
  const hintCount = finiteNonNegative(input.officialIncidentHintCount);
  const updateCount = Math.min(
    SHADOW_SIGNAL_MULTIPLIER_CONFIG.officialUpdate.maxItems,
    finiteNonNegative(input.officialUpdateCount),
  );

  const multipliersWithoutCombined: Omit<ShadowSignalMultipliers, "combinedBeforeCap" | "combinedAfterCap"> = {
    recentResetMomentum: pair(recentResetMultiplier, recentResetMultiplier),
    regularResetProximity: pair(regularResetMultiplier, regularResetMultiplier),
    teaser: pair(
      1 + teaserScore * SHADOW_SIGNAL_MULTIPLIER_CONFIG.teaser.probability24h,
      1 + teaserScore * SHADOW_SIGNAL_MULTIPLIER_CONFIG.teaser.probability48h,
    ),
    teaserStrength: input.teaserStrengthMultiplier ?? pair(1, 1),
    statusSignal: pair(
      1 + statusScore * SHADOW_SIGNAL_MULTIPLIER_CONFIG.statusSignal.probability24h,
      1 + statusScore * SHADOW_SIGNAL_MULTIPLIER_CONFIG.statusSignal.probability48h,
    ),
    officialIncidentHint: hintCount >= 2
      ? pair(
          SHADOW_SIGNAL_MULTIPLIER_CONFIG.officialIncidentHint.twoOrMore.probability24h,
          SHADOW_SIGNAL_MULTIPLIER_CONFIG.officialIncidentHint.twoOrMore.probability48h,
        )
      : hintCount >= 1
        ? pair(
            SHADOW_SIGNAL_MULTIPLIER_CONFIG.officialIncidentHint.one.probability24h,
            SHADOW_SIGNAL_MULTIPLIER_CONFIG.officialIncidentHint.one.probability48h,
          )
        : pair(1, 1),
    officialUpdate: pair(
      1 + updateCount * SHADOW_SIGNAL_MULTIPLIER_CONFIG.officialUpdate.probability24hPerItem,
      1 + updateCount * SHADOW_SIGNAL_MULTIPLIER_CONFIG.officialUpdate.probability48hPerItem,
    ),
    communitySignal: pair(
      1 + communityScore * SHADOW_SIGNAL_MULTIPLIER_CONFIG.communitySignal.probability24h,
      1 + communityScore * SHADOW_SIGNAL_MULTIPLIER_CONFIG.communitySignal.probability48h,
    ),
    usageLimitAnomaly: pair(
      1 + anomalyScore * SHADOW_SIGNAL_MULTIPLIER_CONFIG.usageLimitAnomaly.probability24h,
      1 + anomalyScore * SHADOW_SIGNAL_MULTIPLIER_CONFIG.usageLimitAnomaly.probability48h,
    ),
    complaintPressure: input.complaintPressure === "high"
      ? pair(
          SHADOW_SIGNAL_MULTIPLIER_CONFIG.complaintPressure.high,
          SHADOW_SIGNAL_MULTIPLIER_CONFIG.complaintPressure.high,
        )
      : input.complaintPressure === "medium"
        ? pair(
            SHADOW_SIGNAL_MULTIPLIER_CONFIG.complaintPressure.medium,
            SHADOW_SIGNAL_MULTIPLIER_CONFIG.complaintPressure.medium,
          )
        : pair(1, 1),
  };
  const combinedBeforeCap = multiplyPairs(Object.values(multipliersWithoutCombined));
  const combinedAfterCap = pair(
    Math.min(MAX_TOTAL_ODDS_MULTIPLIER_24H, combinedBeforeCap.probability24h),
    Math.min(MAX_TOTAL_ODDS_MULTIPLIER_48H, combinedBeforeCap.probability48h),
  );

  return {
    ...multipliersWithoutCombined,
    combinedBeforeCap,
    combinedAfterCap,
  };
}

function getLatestAcceptedTiboResetTime(data: RadarData | null, now: Date) {
  return Math.max(
    ...[
      ...(data?.active_tibo_signals ?? []),
      ...(data?.formal_tibo_resets ?? []),
    ]
      .filter(
        (signal) =>
          signal.signal_type === "reset_executed" &&
          (signal.confidence ?? 0) >= 0.95 &&
          signal.verification_status !== "rejected",
      )
      .map((signal) => getTimestamp(signal.tweet_created_at))
      .filter((timestamp): timestamp is number => timestamp !== null && timestamp <= now.getTime()),
    Number.NEGATIVE_INFINITY,
  );
}

function getEligibleFormalTeaserSignals(
  data: RadarData | null,
  now: Date,
  latestResetTime: number | null,
) {
  const latestTiboResetTime = getLatestAcceptedTiboResetTime(data, now);
  const cutoff = Math.max(latestTiboResetTime, latestResetTime ?? Number.NEGATIVE_INFINITY);

  return [
    ...(data?.active_tibo_signals ?? []),
    ...(data?.formal_tibo_resets ?? []),
  ].filter((signal) => {
    const createdAt = getTimestamp(signal.tweet_created_at);
    return Boolean(
      signal.signal_type === "teaser" &&
        (signal.confidence ?? 0) >= 0.8 &&
        signal.verification_status !== "rejected" &&
        signal.is_reply !== true &&
        createdAt !== null &&
        createdAt <= now.getTime() &&
        createdAt > cutoff,
    );
  });
}

function getTeaserScore(
  data: RadarData | null,
  now: Date,
  latestResetTime: number | null,
  localObservationSignals: Array<LocalObservationSignal> = LOCAL_OBSERVATION_SIGNALS,
) {
  const activeLocalBoosts = localObservationSignals.filter((signal) => {
    const observedAt = getTimestamp(signal.observedAt);
    return Boolean(
      observedAt !== null &&
        observedAt <= now.getTime() &&
        getEffectiveSignalStatus(signal, now) === "active" &&
        (signal.type === "probability_boost" ||
          typeof signal.boostValue24h === "number" ||
          typeof signal.boostValue48h === "number" ||
          typeof signal.boostValue === "number"),
    );
  });

  if (activeLocalBoosts.length > 0) {
    return clamp01(Math.max(
      ...activeLocalBoosts.map((signal) => {
        const decay = typeof signal.boostDecayHours === "number"
          ? getTeaserDecayFactor(signal.observedAt, now, signal.boostDecayHours)
          : 1;
        const score24h = (signal.boostValue24h ?? signal.boostValue ?? 0) * decay /
          AUTOMATED_TIBO_SIGNAL_WEIGHTS.teaser.within24h;
        const score48h = (signal.boostValue48h ?? signal.boostValue ?? 0) * decay /
          AUTOMATED_TIBO_SIGNAL_WEIGHTS.teaser.within48h;
        return Math.max(score24h, score48h);
      }),
    ));
  }

  const dynamicTeasers = getEligibleFormalTeaserSignals(data, now, latestResetTime);

  if (dynamicTeasers.length === 0) return 0;
  return clamp01(Math.max(
    ...dynamicTeasers.map((signal) =>
      getTeaserDecayFactor(signal.tweet_created_at, now),
    ),
  ));
}

function getTeaserStrengthSourceSignals(data: RadarData | null) {
  const seen = new Set<string>();
  return [
    ...(data?.active_tibo_signals ?? []),
    ...(data?.recent_tibo_signals ?? []),
  ].flatMap((signal) => {
    if (seen.has(signal.tweet_id)) return [];
    seen.add(signal.tweet_id);
    return [{
      tweet_created_at: signal.tweet_created_at,
      teaser_strength: signal.teaser_strength ?? null,
      signal_type: signal.signal_type,
      verification_status: signal.verification_status,
      is_reply: signal.is_reply,
    }];
  });
}

function getTeaserStrengthMultiplier(
  data: RadarData | null,
  now: Date,
  latestResetTime: number | null,
) {
  // A formal teaser already owns this signal slot. Do not multiply its
  // established 1.8x/2.2x effect by the weaker strength signal.
  if (getEligibleFormalTeaserSignals(data, now, latestResetTime).length > 0) {
    return pair(1, 1);
  }

  const latestResetAt = latestResetTime === null ? null : new Date(latestResetTime);
  const eligibleSignals = getTeaserStrengthSignals(
    getTeaserStrengthSourceSignals(data),
    latestResetAt,
    now,
    { includeReplies: false },
  ).filter(
    (signal) => signal.teaser_strength === "strong" || signal.teaser_strength === "weak",
  );

  if (eligibleSignals.length === 0) return pair(1, 1);

  return pair(
    Math.max(
      ...eligibleSignals.map((signal) => {
        const strength = signal.teaser_strength;
        if (strength !== "strong" && strength !== "weak") return 1;
        const initial = SHADOW_SIGNAL_MULTIPLIER_CONFIG.teaserStrength[strength];
        const progress = getTeaserDecayFactor(
          signal.tweet_created_at,
          now,
          SHADOW_SIGNAL_MULTIPLIER_CONFIG.teaserStrength.lookbackHours,
        );
        return 1 + (initial.multiplier24h - 1) * progress;
      }),
    ),
    Math.max(
      ...eligibleSignals.map((signal) => {
        const strength = signal.teaser_strength;
        if (strength !== "strong" && strength !== "weak") return 1;
        const initial = SHADOW_SIGNAL_MULTIPLIER_CONFIG.teaserStrength[strength];
        const progress = getTeaserDecayFactor(
          signal.tweet_created_at,
          now,
          SHADOW_SIGNAL_MULTIPLIER_CONFIG.teaserStrength.lookbackHours,
        );
        return 1 + (initial.multiplier48h - 1) * progress;
      }),
    ),
  );
}

function getRegularProximityScore(expectedAt: string | null | undefined, now: Date) {
  if (!expectedAt) return 0;
  const score24h = getRegularResetProximityBoost("24h", expectedAt, now);
  const score48h = getRegularResetProximityBoost("48h", expectedAt, now);
  const config24h = LOCAL_PROBABILITY_WEIGHTS.regularResetProximity.forecast24h;
  const config48h = LOCAL_PROBABILITY_WEIGHTS.regularResetProximity.forecast48h;
  return clamp01(Math.max(
    config24h.max > config24h.entry
      ? (score24h - config24h.entry) / (config24h.max - config24h.entry)
      : 0,
    config48h.max > config48h.entry
      ? (score48h - config48h.entry) / (config48h.max - config48h.entry)
      : 0,
  ));
}

export function getShadowSignalInputs(
  data: RadarData | null,
  now: Date,
  signalEvaluation: LocalSignalEvaluation,
  latestResetTime: number | null,
  regularResetExpectedAt: string | null | undefined,
  includeTeaserStrengthBoost: boolean,
  localObservationSignals: Array<LocalObservationSignal> = LOCAL_OBSERVATION_SIGNALS,
): ShadowSignalInputs {
  const environment = signalEvaluation.environment;
  return {
    recentResetCount7d: getRecent7DayResetCount(data, now),
    regularResetProximity: getRegularProximityScore(regularResetExpectedAt, now),
    teaserScore: getTeaserScore(data, now, latestResetTime, localObservationSignals),
    teaserStrengthMultiplier: includeTeaserStrengthBoost
      ? getTeaserStrengthMultiplier(data, now, latestResetTime)
      : pair(1, 1),
    normalizedStatusScore: clamp01(
      signalEvaluation.statusIncidents.weightedStatusScore /
        LOCAL_PROBABILITY_WEIGHTS.countLimits.statusIncidents,
    ),
    officialIncidentHintCount: finiteNonNegative(environment.official_incident_hints_24h),
    officialUpdateCount: finiteNonNegative(environment.official_updates_24h),
    communityScore: clamp01(
      finiteNonNegative(environment.community_mentions_24h) /
        LOCAL_PROBABILITY_WEIGHTS.countLimits.communityMentions,
    ),
    usageLimitAnomalyScore: clamp01(
      finiteNonNegative(environment.issue_or_limit_anomalies_24h) /
        LOCAL_PROBABILITY_WEIGHTS.countLimits.issueAnomalies,
    ),
    complaintPressure: signalEvaluation.complaintPressure.level,
  };
}

function getConfidence(
  hazard: ShadowHazard,
  officialNoticeActive: boolean,
) {
  if (officialNoticeActive) {
    return {
      level: "high" as const,
      reason: "An active official notice overrides the normal confidence tier.",
    };
  }
  if (
    hazard.completedIntervalCount >= SHADOW_CONFIDENCE_INTERVAL_COUNT &&
    hazard.totalExposureDays >= SHADOW_CONFIDENCE_EXPOSURE_DAYS
  ) {
    return {
      level: "medium" as const,
      reason: "The completed interval count and exposure meet the shadow model's medium-confidence floor.",
    };
  }
  return {
    level: "low" as const,
    reason: "The available completed intervals or exposure are below the medium-confidence floor.",
  };
}

function applyOfficialNoticeTimingPolicy(
  baseline: ShadowProbabilityHorizons,
  notice: ActiveOfficialNotice | null,
  now: Date,
  legacyOfficialNoticeOverride: boolean,
) {
  if (!notice) return null;
  if (legacyOfficialNoticeOverride) {
    return {
      probability12h: derive12hFrom24hProbability(0.9),
      probability24h: 0.9,
      probability48h: 0.96,
      probability72h: derive72hFrom48hProbability(0.96),
    } satisfies ShadowProbabilityHorizons;
  }

  const temporalResolution = {
    status: notice.temporalResolutionStatus ?? "unresolved",
    temporalPrecision: notice.temporalPrecision ?? "unknown",
    confidence: notice.temporalConfidence ?? null,
    expectedStartAt: notice.expectedAt,
    expectedEndAt: notice.expectedEndAt,
  };
  const coverage24 = getTemporalNoticeCoverage(temporalResolution, now, 24);
  const coverage48 = getTemporalNoticeCoverage(temporalResolution, now, 48);
  if (coverage24 === null || coverage48 === null) {
    return {
      probability12h: derive12hFrom24hProbability(0.9),
      probability24h: 0.9,
      probability48h: 0.96,
      probability72h: derive72hFrom48hProbability(0.96),
    } satisfies ShadowProbabilityHorizons;
  }

  const probability24h = clamp01(
    baseline.probability24h + coverage24 * (0.9 - baseline.probability24h),
  );
  const probability48h = Math.min(
    1,
    Math.max(
      probability24h,
      baseline.probability48h + coverage48 * (0.96 - baseline.probability48h),
    ),
  );
  return {
    probability12h: derive12hFrom24hProbability(probability24h),
    probability24h,
    probability48h,
    probability72h: Math.max(probability48h, derive72hFrom48hProbability(probability48h)),
  } satisfies ShadowProbabilityHorizons;
}

export function calculateShadowProbabilityForModel(
  data: RadarData | null,
  options: ShadowProbabilityOptions = {},
  modelOptions: ShadowProbabilityModelOptions = {},
): ShadowProbabilityResult {
  const now = options.now ?? new Date();
  const localObservationSignals = options.localObservationSignals ?? LOCAL_OBSERVATION_SIGNALS;
  const signalEvaluation = options.signalEvaluation ?? getLocalSignalEvaluation(data, now, localObservationSignals);
  const events = getShadowCompletedResetEvents(data, now, options.staticHistory);
  const hazard = buildShadowHazard(events, now, modelOptions.hazardOptions);
  const latestResetTime = events.length > 0
    ? getTimestamp(events[events.length - 1].resetAt)
    : null;
  const resolvedOfficialNotice = options.activeOfficialNotice === undefined
    ? getActiveOfficialNotice(
        data,
        latestResetTime === null ? null : new Date(latestResetTime),
        now,
        localObservationSignals,
      )
    : options.activeOfficialNotice;
  const ageHours = latestResetTime === null
    ? 0
    : Math.max(0, (now.getTime() - latestResetTime) / HOUR_MS);
  const baseline: ShadowProbabilityHorizons = {
    probability12h: integrateHazardProbability(hazard, ageHours, 12),
    probability24h: integrateHazardProbability(hazard, ageHours, 24),
    probability48h: integrateHazardProbability(hazard, ageHours, 48),
    probability72h: integrateHazardProbability(hazard, ageHours, 72),
  };
  const inputs = getShadowSignalInputs(
    data,
    now,
    signalEvaluation,
    latestResetTime,
    options.regularResetExpectedAt,
    modelOptions.includeTeaserStrengthBoost === true,
    localObservationSignals,
  );
  const multipliers = calculateShadowSignalMultipliers(inputs);
  const adjusted: ShadowProbabilityHorizons = {
    probability12h: applyOddsMultiplier(
      baseline.probability12h,
      multipliers.combinedAfterCap.probability24h,
    ),
    probability24h: applyOddsMultiplier(
      baseline.probability24h,
      multipliers.combinedAfterCap.probability24h,
    ),
    probability48h: applyOddsMultiplier(
      baseline.probability48h,
      multipliers.combinedAfterCap.probability48h,
    ),
    probability72h: applyOddsMultiplier(
      baseline.probability72h,
      multipliers.combinedAfterCap.probability48h,
    ),
  };
  const officialNoticeActive = Boolean(resolvedOfficialNotice);
  const officialNoticePredictions = applyOfficialNoticeTimingPolicy(
    baseline,
    resolvedOfficialNotice,
    now,
    modelOptions.legacyOfficialNoticeOverride === true,
  );
  const officialNoticeOverride = {
    active: officialNoticeActive,
    probability12h: officialNoticePredictions?.probability12h ?? null,
    probability24h: officialNoticePredictions?.probability24h ?? null,
    probability48h: officialNoticePredictions?.probability48h ?? null,
    probability72h: officialNoticePredictions?.probability72h ?? null,
  };
  const confidence = getConfidence(hazard, officialNoticeActive);
  const warnings: string[] = [];
  if (hazard.completedIntervalCount < 2) {
    warnings.push("Historical completed intervals are sparse; treat this shadow result as exploratory.");
  }
  if (!options.regularResetExpectedAt) {
    warnings.push("Regular reset proximity is retained for audit input but is not applied by the random-only shadow model.");
  }

  return {
    modelVersion: modelOptions.modelVersion ?? SHADOW_PROBABILITY_MODEL_VERSION,
    calculatedAt: now.toISOString(),
    targetDefinition: SHADOW_TARGET_DEFINITION,
    predictions: officialNoticeActive ? officialNoticePredictions! : adjusted,
    baseline,
    confidence: {
      ...confidence,
      completedIntervalCount: hazard.completedIntervalCount,
      totalExposureDays: hazard.totalExposureDays,
    },
    hazard,
    multipliers,
    officialNoticeOverride,
    warnings,
  };
}

export function calculateShadowProbability(
  data: RadarData | null,
  options: ShadowProbabilityOptions = {},
) {
  return calculateShadowProbabilityForModel(data, options, {
    // The canonical random-inclusive model shares the UI's eligible teaser
    // strength signal. Formal teasers still suppress this auxiliary multiplier
    // inside getTeaserStrengthMultiplier to prevent double counting.
    includeTeaserStrengthBoost: true,
  });
}

export function getConstantProbabilityBaseline(
  hazard: ShadowHazard,
  startAgeHours: number,
  horizonHours: number,
) {
  const probability = 1 - Math.exp(-hazard.globalLambdaPerHour * Math.max(0, horizonHours));
  void startAgeHours;
  return clamp01(probability);
}

export function getElapsedTimeOnlyBaseline(
  hazard: ShadowHazard,
  startAgeHours: number,
  horizonHours: number,
) {
  const ageFactor = clamp01(startAgeHours / (HAZARD_TAIL_START_DAYS * 24));
  const elapsedLambda = hazard.globalLambdaPerHour * ageFactor;
  return clamp01(1 - Math.exp(-elapsedLambda * Math.max(0, horizonHours)));
}

export function getShadowBaselineAgeHours(data: RadarData | null, now: Date, events?: Array<ShadowResetEvent>) {
  const resetEvents = events ?? getShadowCompletedResetEvents(data, now);
  if (resetEvents.length === 0) return 0;
  const lastReset = getTimestamp(resetEvents[resetEvents.length - 1].resetAt);
  return lastReset === null ? 0 : Math.max(0, (now.getTime() - lastReset) / HOUR_MS);
}

export function getShadowResultWithoutSignals(
  data: RadarData | null,
  options: ShadowProbabilityOptions = {},
) {
  const now = options.now ?? new Date();
  const events = getShadowCompletedResetEvents(data, now, options.staticHistory);
  const hazard = buildShadowHazard(events, now);
  const ageHours = getShadowBaselineAgeHours(data, now, events);
  return pair(
    integrateHazardProbability(hazard, ageHours, 24),
    integrateHazardProbability(hazard, ageHours, 48),
  );
}
