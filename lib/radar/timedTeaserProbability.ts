import {
  TIMED_TEASER_REALLOCATION_CONFIG,
  TIMED_TEASER_REALLOCATION_POLICY_VERSION,
} from "@/data/shadowProbabilityConfig";
import type { CanonicalResetHistoryContext } from "./tiboHistory";
import { expandTiboSignalVariants } from "./tiboSecondarySignal";
import {
  getTemporalExecutionWindowRelation,
  getTemporalTeaserCdf,
  type ResetExecutionWindow,
} from "./tiboTemporal";
import { isTiboForecastSignalTerminatedAt } from "./officialNoticePolicy";
import {
  interpretTiboSignal,
  type ResetTeaserSignal,
  type TiboSignalContextDependence,
  type TiboSignalInterpretation,
} from "./teaserStrength";
import { getTiboReadSideSignals } from "./tiboLogicalProjection";
import type { RadarData } from "./types";
import type { ShadowProbabilityHorizons } from "./shadowProbability";

const HOUR_MS = 60 * 60 * 1000;
const TIMED_TEASER_LOOKBACK_MS = 48 * HOUR_MS;

export type TimedTeaserCandidate = {
  signal: ResetTeaserSignal;
  interpretation: TiboSignalInterpretation;
};

export type TimedTeaserReallocationAudit = {
  policyVersion: typeof TIMED_TEASER_REALLOCATION_POLICY_VERSION;
  applied: boolean;
  contextDependence: TiboSignalContextDependence | null;
  weight: number | null;
  temporalPrecision: ResetTeaserSignal["temporal_precision"] | null;
  cdf: {
    probability12h: number;
    probability24h: number;
    probability48h: number;
    probability72h: number;
  } | null;
};

function timestamp(value: string | Date | null | undefined) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function temporalSpecificity(signal: ResetTeaserSignal) {
  switch (signal.temporal_precision) {
    case "exact_time": return 4;
    case "daypart": return 3;
    case "range": return 2;
    case "day": return 1;
    default: return 0;
  }
}

function contextSpecificity(context: TiboSignalContextDependence) {
  if (context === "direct") return 2;
  if (context === "reply_context") return 1;
  return 0;
}

function asResetTeaserSignal(signal: ResetTeaserSignal): ResetTeaserSignal {
  return signal;
}

/**
 * Returns the recent read-side signals that are eligible for the bounded
 * contextual timed-teaser policy. This only reads the already-loaded logical
 * projection; it does not fetch canonical history or add a database query.
 */
export function getTimedTeaserCandidates(
  data: RadarData | null,
  latestResetAt: string | Date | null | undefined,
  now: Date,
  resetExecutionWindow: ResetExecutionWindow | null = null,
  canonicalHistoryContext?: CanonicalResetHistoryContext,
): TimedTeaserCandidate[] {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return [];

  const latestResetTime = timestamp(latestResetAt);
  const cutoffTime = nowTime - TIMED_TEASER_LOOKBACK_MS;
  const effectiveExecutionWindow = resetExecutionWindow ?? (
    latestResetTime === null
      ? null
      : { executionWindowStartAt: null, executionWindowEndAt: new Date(latestResetTime).toISOString() }
  );
  const seen = new Set<string>();

  return expandTiboSignalVariants(
    getTiboReadSideSignals(
      data,
      "teaser",
      false,
      canonicalHistoryContext?.readSideProjection,
    ),
  )
    .map(asResetTeaserSignal)
    .filter((signal) => {
      const key = signal.tweet_id ?? `${signal.tweet_created_at}:${signal.signal_type}`;
      if (seen.has(key)) return false;
      seen.add(key);

      const createdTime = timestamp(signal.tweet_created_at);
      if (createdTime === null || createdTime > nowTime || createdTime < cutoffTime) return false;
      if (isTiboForecastSignalTerminatedAt(signal.tweet_id, now)) return false;
      if (signal.verification_status === "rejected") return false;

      const temporalRelation = getTemporalExecutionWindowRelation(
        signal.temporal_resolution_status === "resolved"
          ? {
              status: "resolved",
              expectedStartAt: signal.expected_start_at ?? null,
              expectedEndAt: signal.expected_end_at ?? null,
            }
          : null,
        effectiveExecutionWindow,
      );
      const isSemanticallyAfterBoundary = latestResetTime === null ||
        createdTime > latestResetTime ||
        temporalRelation === "before";
      if (!isSemanticallyAfterBoundary) return false;

      const interpretation = interpretTiboSignal(signal, now);
      return interpretation.timedProbabilityEligible;
    })
    .map((signal) => ({
      signal,
      interpretation: interpretTiboSignal(signal, now),
    }))
    .sort((left, right) =>
      contextSpecificity(right.interpretation.contextDependence) -
        contextSpecificity(left.interpretation.contextDependence) ||
      temporalSpecificity(right.signal) - temporalSpecificity(left.signal) ||
      (right.signal.confidence ?? 0) - (left.signal.confidence ?? 0) ||
      (timestamp(right.signal.tweet_created_at) ?? 0) - (timestamp(left.signal.tweet_created_at) ?? 0),
    );
}

function getCdf(signal: ResetTeaserSignal, now: Date) {
  const resolution = {
    status: signal.temporal_resolution_status === "resolved" ? "resolved" as const : "unresolved" as const,
    temporalPrecision: signal.temporal_precision ?? "unknown" as const,
    confidence: signal.temporal_confidence ?? null,
    expectedStartAt: signal.expected_start_at ?? null,
    expectedEndAt: signal.expected_end_at ?? null,
  };
  const values = [12, 24, 48, 72].map((horizonHours) =>
    getTemporalTeaserCdf(resolution, now, horizonHours),
  );
  return values.every((value): value is number => value !== null)
    ? {
        probability12h: values[0],
        probability24h: values[1],
        probability48h: values[2],
        probability72h: values[3],
      }
    : null;
}

function mix(base: number, teaserCdf: number, weight: number) {
  return clamp01((1 - weight) * clamp01(base) + weight * clamp01(teaserCdf));
}

function monotoneHorizons(values: ShadowProbabilityHorizons): ShadowProbabilityHorizons {
  const probability12h = clamp01(values.probability12h);
  const probability24h = Math.max(probability12h, clamp01(values.probability24h));
  const probability48h = Math.max(probability24h, clamp01(values.probability48h));
  const probability72h = Math.max(probability48h, clamp01(values.probability72h));
  return { probability12h, probability24h, probability48h, probability72h };
}

/**
 * Reallocates a bounded amount of probability mass toward one resolved,
 * contextual future window. Direct formal teasers remain on their existing
 * ordinary teaser path, so they are not counted twice here.
 */
export function applyTimedTeaserProbabilityReallocation(
  base: ShadowProbabilityHorizons,
  candidate: TimedTeaserCandidate | null,
  now: Date,
) {
  const emptyAudit: TimedTeaserReallocationAudit = {
    policyVersion: TIMED_TEASER_REALLOCATION_POLICY_VERSION,
    applied: false,
    contextDependence: null,
    weight: null,
    temporalPrecision: null,
    cdf: null,
  };
  if (!candidate || candidate.interpretation.probabilityTeaserEligible) {
    return { predictions: base, audit: emptyAudit };
  }

  const cdf = getCdf(candidate.signal, now);
  if (!cdf) return { predictions: base, audit: emptyAudit };

  const weight = TIMED_TEASER_REALLOCATION_CONFIG.contextualStrongWeight;
  const predictions = monotoneHorizons({
    probability12h: mix(base.probability12h, cdf.probability12h, weight),
    probability24h: mix(base.probability24h, cdf.probability24h, weight),
    probability48h: mix(base.probability48h, cdf.probability48h, weight),
    probability72h: mix(base.probability72h, cdf.probability72h, weight),
  });
  return {
    predictions,
    audit: {
      policyVersion: TIMED_TEASER_REALLOCATION_POLICY_VERSION,
      applied: true,
      contextDependence: candidate.interpretation.contextDependence,
      weight,
      temporalPrecision: candidate.signal.temporal_precision ?? null,
      cdf,
    } satisfies TimedTeaserReallocationAudit,
  };
}
