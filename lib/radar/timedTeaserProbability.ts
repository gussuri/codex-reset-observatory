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

export type TimedTeaserEvidenceClass = "strong_contextual" | "strong_direct";

export type TimedTeaserReallocationWeight = {
  timedEvidenceClass: TimedTeaserEvidenceClass;
  reallocationWeight: number;
};

export type TimedTeaserReallocationAudit = {
  policyVersion: typeof TIMED_TEASER_REALLOCATION_POLICY_VERSION;
  applied: boolean;
  contextDependence: TiboSignalContextDependence | null;
  timedEvidenceClass: TimedTeaserEvidenceClass | null;
  reallocationWeight: number | null;
  temporalPrecision: ResetTeaserSignal["temporal_precision"] | null;
  cdf: {
    probability12h: number;
    probability24h: number;
    probability48h: number;
    probability72h: number;
  } | null;
};

/**
 * Converts the shared signal interpretation into a conservative time-window
 * evidence class. No source text or signal-specific heuristics are repeated
 * here; the interpretation is the single semantic input to this policy.
 */
export function getTimedTeaserReallocationWeight(
  interpretation: TiboSignalInterpretation,
): TimedTeaserReallocationWeight | null {
  if (
    interpretation.presentationDisposition !== "strong_teaser" ||
    !interpretation.timedProbabilityEligible
  ) {
    return null;
  }

  if (interpretation.contextDependence === "direct") {
    return {
      timedEvidenceClass: "strong_direct",
      reallocationWeight: TIMED_TEASER_REALLOCATION_CONFIG.strongDirectWeight,
    };
  }

  if (
    interpretation.contextDependence === "reply_context" ||
    interpretation.contextDependence === "ambiguous"
  ) {
    return {
      timedEvidenceClass: "strong_contextual",
      reallocationWeight: TIMED_TEASER_REALLOCATION_CONFIG.strongContextualWeight,
    };
  }

  return null;
}

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
 * Returns bounded read-side signals that are eligible for the contextual
 * timed-teaser policy, including resolved windows from the dedicated narrow
 * projection. This only reads the already-loaded logical projections.
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
    [
      ...getTiboReadSideSignals(
        data,
        "teaser",
        false,
        canonicalHistoryContext?.readSideProjection,
      ),
      ...getTiboReadSideSignals(data, "timed"),
    ],
  )
    .map(asResetTeaserSignal)
    .filter((signal) => {
      const key = signal.tweet_id ?? `${signal.tweet_created_at}:${signal.signal_type}`;
      if (seen.has(key)) return false;
      seen.add(key);

      const createdTime = timestamp(signal.tweet_created_at);
      const isResolved = signal.temporal_resolution_status === "resolved";
      if (createdTime === null || createdTime > nowTime) return false;
      if (!isResolved && createdTime < cutoffTime) return false;
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

      const interpretation = interpretTiboSignal(signal, now, {
        ignoreCreatedAtLookback: isResolved,
      });
      if (!interpretation.timedProbabilityEligible) return false;

      // Resolved windows are lifecycle-bound by their actual temporal CDF,
      // not by the age of the post that announced them. Keep unresolved
      // evidence on the existing bounded lookback because it has no reliable
      // execution window to anchor its lifetime.
      if (isResolved) {
        const cdf = getCdf(signal, now);
        return cdf !== null && Object.values(cdf).some((value) => value > 0);
      }
      return true;
    })
    .map((signal) => ({
      signal,
      interpretation: interpretTiboSignal(signal, now, {
        ignoreCreatedAtLookback: signal.temporal_resolution_status === "resolved",
      }),
    }))
    .sort((left, right) =>
      contextSpecificity(right.interpretation.contextDependence) -
        contextSpecificity(left.interpretation.contextDependence) ||
      temporalSpecificity(right.signal) - temporalSpecificity(left.signal) ||
      (right.signal.confidence ?? 0) - (left.signal.confidence ?? 0) ||
      (timestamp(right.signal.tweet_created_at) ?? 0) - (timestamp(left.signal.tweet_created_at) ?? 0),
    );
}

/**
 * Direct strong teasers are removed from the pre-existing ordinary signal
 * multiplier path before the timed policy is applied. Contextual candidates
 * are not ordinary probability teasers, so their source data is unchanged.
 */
export function excludeTimedTeaserFromOrdinaryPath(
  data: RadarData | null,
  candidate: TimedTeaserCandidate | null,
) {
  if (
    !data ||
    !candidate ||
    candidate.interpretation.contextDependence !== "direct" ||
    !candidate.signal.tweet_id
  ) {
    return data;
  }

  const tweetId = candidate.signal.tweet_id;
  const filter = <T extends { tweet_id?: string | null }>(signals: T[] | undefined) =>
    signals?.filter((signal) => signal.tweet_id !== tweetId);

  return {
    ...data,
    active_tibo_signals: filter(data.active_tibo_signals),
    recent_tibo_signals: filter(data.recent_tibo_signals),
    formal_tibo_resets: filter(data.formal_tibo_resets),
  };
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
 * Reallocates a bounded amount of probability mass toward one resolved future
 * window. The caller removes a direct strong candidate from the ordinary
 * teaser path before this policy runs, so the evidence is counted once.
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
    timedEvidenceClass: null,
    reallocationWeight: null,
    temporalPrecision: null,
    cdf: null,
  };
  const weightPolicy = candidate
    ? getTimedTeaserReallocationWeight(candidate.interpretation)
    : null;
  if (!candidate || !weightPolicy) {
    return { predictions: base, audit: emptyAudit };
  }

  const cdf = getCdf(candidate.signal, now);
  if (!cdf) return { predictions: base, audit: emptyAudit };

  const weight = weightPolicy.reallocationWeight;
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
      timedEvidenceClass: weightPolicy.timedEvidenceClass,
      reallocationWeight: weight,
      temporalPrecision: candidate.signal.temporal_precision ?? null,
      cdf,
    } satisfies TimedTeaserReallocationAudit,
  };
}
