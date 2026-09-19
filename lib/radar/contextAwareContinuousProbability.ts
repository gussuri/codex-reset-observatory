import {
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_BACKFILL,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_EVALUATION_MODE,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_POLICY,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MINIMUM_SAMPLES,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_OPTIONS,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_PRIOR_STD_DEV,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_TARGET_DEFINITION,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
} from "@/data/shadowProbabilityConfig";
import type { PublishedV3FeatureSnapshot } from "./publishedV3FeatureSnapshot";
import { readPublishedV3FeatureSnapshot } from "./publishedV3FeatureSnapshot";
import { getPointInTimeRadarData } from "./prequentialCalibration";
import {
  getEffectiveTeaserStrength,
  type TeaserStrength,
} from "./teaserStrength";
import { getTiboReadSideSignals, type TiboReadSideSignal } from "./tiboLogicalProjection";
import type { RadarData } from "./types";
import {
  applyOfficialNoticeTimingPolicy,
} from "./regimeElapsedProbability";
import {
  getActiveOfficialNotice,
  type ActiveOfficialNotice,
} from "./probability";
import {
  derive12hFrom24hProbability,
  derive72hFrom48hProbability,
  type ShadowProbabilityHorizons,
  type ShadowProbabilityOptions,
  type ShadowSignalMultipliers,
} from "./shadowProbability";
import {
  calculateRandomContinuousBandwidthShadowPair,
} from "./randomContinuousBandwidthShadow";
import type { RandomContinuousProbabilityResult } from "./randomContinuousProbability";
import { enforceNextGenerationHorizonCoherence } from "./nextGenerationProbability";

const HOUR_MS = 60 * 60 * 1000;
const LOGIT_EPSILON = 1e-12;
const SOLVER_MAX_ITERATIONS = 96;
const SOLVER_TOLERANCE = 1e-10;
const MAX_ABS_COEFFICIENT = 20;

export type ContextAwareKnownState = "none" | "weak" | "strong";
export type ContextAwareContextState = ContextAwareKnownState | "unknown";
export type ContextAwareContextProvenance =
  | "saved-feature-snapshot"
  | "point-in-time-projection"
  | "audit-fallback"
  | "unknown";

export function isContextAwareContextProvenance(value: unknown): value is ContextAwareContextProvenance {
  return value === "saved-feature-snapshot"
    || value === "point-in-time-projection"
    || value === "audit-fallback"
    || value === "unknown";
}

export function isKnownContextAwareContextProvenance(
  value: unknown,
): value is Exclude<ContextAwareContextProvenance, "unknown"> {
  return value === "saved-feature-snapshot"
    || value === "point-in-time-projection"
    || value === "audit-fallback";
}

export type ContextAwareCalibrationRow = {
  generatedAt: string;
  baselineProbability24h: number;
  baselineProbability48h: number;
  contextState: ContextAwareContextState;
  actual24h?: boolean;
  actual48h?: boolean;
  trainingEligible?: boolean;
  contextStateProvenance?: ContextAwareContextProvenance;
  contextExclusionReason?: string | null;
  source?: string;
};

export type ContextAwareCalibrationSample = {
  probability: number;
  actual: boolean;
  contextState: ContextAwareKnownState;
  generatedAt?: string;
};

export type ContextAwareStateResolution = {
  contextState: ContextAwareContextState;
  contextStateProvenance: ContextAwareContextProvenance;
  trainingEligible: boolean;
  contextExclusionReason: string | null;
};

export type ContextAwareCoefficientFit = {
  alpha: number;
  betaWeak: number;
  betaStrong: number;
  sampleCount: number;
  positiveCount: number;
  stateCounts: {
    none: { count: number; positiveCount: number };
    weak: { count: number; positiveCount: number };
    strong: { count: number; positiveCount: number };
  };
  lastResolvedOrigin: string | null;
  priorStdDev: number;
  minimumSamples: number;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  solver: {
    converged: boolean;
    iterations: number;
    objective: number | null;
    reason: string | null;
  };
};

export type ContextAwareTrainingAudit = {
  selectedRows: Array<ContextAwareCalibrationRow>;
  excludedCount: number;
  excludedReasons: Record<string, number>;
};

export const CONTEXT_AWARE_FORECAST_AUDIT_VERSION = "v1" as const;

export type ContextAwareForecastAudit = {
  contextSnapshotVersion: typeof CONTEXT_AWARE_FORECAST_AUDIT_VERSION;
  contextState: ContextAwareContextState;
  contextStateProvenance: ContextAwareContextProvenance;
  trainingEligible: boolean;
  contextExclusionReason: string | null;
  baselineProbability24h: number;
  baselineProbability48h: number;
  contextAdjustedProbability24h: number;
  contextAdjustedProbability48h: number;
  alpha24h: number;
  alpha48h: number;
  betaWeak24h: number;
  betaWeak48h: number;
  betaStrong24h: number;
  betaStrong48h: number;
  trainingSampleCount24h: number;
  trainingSampleCount48h: number;
  positiveTrainingCount24h: number;
  positiveTrainingCount48h: number;
  noneSampleCount24h: number;
  noneSampleCount48h: number;
  nonePositiveCount24h: number;
  nonePositiveCount48h: number;
  weakSampleCount24h: number;
  weakSampleCount48h: number;
  weakPositiveCount24h: number;
  weakPositiveCount48h: number;
  strongSampleCount24h: number;
  strongSampleCount48h: number;
  strongPositiveCount24h: number;
  strongPositiveCount48h: number;
  lastResolvedOrigin24h: string | null;
  lastResolvedOrigin48h: string | null;
  excludedTrainingRowCount24h: number;
  excludedTrainingRowCount48h: number;
  excludedTrainingReasons24h: Record<string, number>;
  excludedTrainingReasons48h: Record<string, number>;
  priorStdDev: number;
  minimumSamples: number;
  fitFallbackUsed: boolean;
  fitFallbackReason: string | null;
  trainingReadStatus: "ok" | "error";
  horizonCoherenceAdjusted: boolean;
  officialNoticeOverride: boolean;
  ordinarySemanticSignalsApplied: false;
  underlyingModelVersion: typeof RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION;
  bandwidthHours: 18;
  truncationHours: 54;
};

export type ContextAwareContinuousProbabilityOptions = ShadowProbabilityOptions & {
  trainingRows?: Array<ContextAwareCalibrationRow>;
  trainingReadStatus?: "ok" | "error";
  precomputedChallenger?: RandomContinuousProbabilityResult;
  savedFeatureSnapshot?: PublishedV3FeatureSnapshot | null;
};

export type ContextAwareContinuousProbabilityResult = {
  modelVersion: typeof CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION;
  calculatedAt: string;
  targetDefinition: typeof CONTEXT_AWARE_CONTINUOUS_PROBABILITY_TARGET_DEFINITION;
  underlyingModelVersion: typeof RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION;
  baseline: ShadowProbabilityHorizons;
  contextAdjusted: ShadowProbabilityHorizons;
  predictions: ShadowProbabilityHorizons;
  contextState: ContextAwareContextState;
  contextStateProvenance: ContextAwareContextProvenance;
  trainingEligible: boolean;
  contextExclusionReason: string | null;
  fit24h: ContextAwareCoefficientFit;
  fit48h: ContextAwareCoefficientFit;
  excludedTrainingRowCount24h: number;
  excludedTrainingRowCount48h: number;
  excludedTrainingReasons24h: Record<string, number>;
  excludedTrainingReasons48h: Record<string, number>;
  trainingReadStatus: "ok" | "error";
  fitFallbackUsed: boolean;
  fitFallbackReason: string | null;
  horizonCoherenceAdjusted: boolean;
  officialNoticeOverride: {
    active: boolean;
    probability12h: number | null;
    probability24h: number | null;
    probability48h: number | null;
    probability72h: number | null;
  };
  officialNoticeTimingPolicyVersion: "official-notice-window-v3";
  randomContinuous: RandomContinuousProbabilityResult["randomContinuous"];
  randomContinuousResult: RandomContinuousProbabilityResult;
  signalMultipliers: ShadowSignalMultipliers;
  bandwidthHours: 18;
  truncationHours: 54;
  freezeAt: typeof CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT;
  freezePolicy: typeof CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_POLICY;
  evaluationMode: typeof CONTEXT_AWARE_CONTINUOUS_PROBABILITY_EVALUATION_MODE;
  backfilled: typeof CONTEXT_AWARE_CONTINUOUS_PROBABILITY_BACKFILL;
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function clampProbability(value: number) {
  return Number.isFinite(value)
    ? Math.min(1 - LOGIT_EPSILON, Math.max(LOGIT_EPSILON, value))
    : 0.5;
}

function logit(value: number) {
  const safe = clampProbability(value);
  return Math.log(safe / (1 - safe));
}

function sigmoid(value: number) {
  if (value >= 0) {
    const exponential = Math.exp(-value);
    return 1 / (1 + exponential);
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function log1pExp(value: number) {
  if (value > 0) return value + Math.log1p(Math.exp(-value));
  return Math.log1p(Math.exp(value));
}

function featureVector(state: ContextAwareKnownState | "unknown") {
  if (state === "weak") return [1, 1, 0] as const;
  if (state === "strong") return [1, 0, 1] as const;
  if (state === "none") return [1, 0, 0] as const;
  return [0, 0, 0] as const;
}

export function getContextAwareFeatureVector(state: ContextAwareContextState) {
  return [...featureVector(state)] as [number, number, number];
}

function isKnownState(value: ContextAwareContextState): value is ContextAwareKnownState {
  return value === "none" || value === "weak" || value === "strong";
}

function objective(
  coefficients: readonly number[],
  samples: Array<ContextAwareCalibrationSample>,
  priorPrecision: number,
) {
  const likelihood = samples.reduce((sum, sample) => {
    const features = featureVector(sample.contextState);
    const eta = logit(sample.probability) + features.reduce(
      (inner, feature, index) => inner + feature * coefficients[index],
      0 as number,
    );
    return sum + log1pExp(eta) - Number(sample.actual) * eta;
  }, 0);
  const prior = coefficients.reduce((sum, coefficient) => sum + coefficient ** 2, 0) * priorPrecision / 2;
  return likelihood + prior;
}

function solveLinearSystem(matrix: number[][], rightHandSide: number[]) {
  const augmented = matrix.map((row, index) => [...row, rightHandSide[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (!Number.isFinite(augmented[pivot][column]) || Math.abs(augmented[pivot][column]) < 1e-14) {
      return null;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry <= 3; entry += 1) augmented[column][entry] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= 3; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  return augmented.map((row) => row[3]);
}

function makeStateCounts(samples: Array<ContextAwareCalibrationSample>) {
  const counts = {
    none: { count: 0, positiveCount: 0 },
    weak: { count: 0, positiveCount: 0 },
    strong: { count: 0, positiveCount: 0 },
  };
  for (const sample of samples) {
    counts[sample.contextState].count += 1;
    counts[sample.contextState].positiveCount += Number(sample.actual);
  }
  return counts;
}

function makeFit(
  samples: Array<ContextAwareCalibrationSample>,
  coefficients: readonly number[],
  priorStdDev: number,
  minimumSamples: number,
  fallbackUsed: boolean,
  fallbackReason: string | null,
  solver: ContextAwareCoefficientFit["solver"],
): ContextAwareCoefficientFit {
  const validOrigins = samples
    .map((sample) => sample.generatedAt)
    .filter((value): value is string => timestamp(value) !== null)
    .sort((left, right) => timestamp(left)! - timestamp(right)!);
  return {
    alpha: coefficients[0],
    betaWeak: coefficients[1],
    betaStrong: coefficients[2],
    sampleCount: samples.length,
    positiveCount: samples.reduce((sum, sample) => sum + Number(sample.actual), 0),
    stateCounts: makeStateCounts(samples),
    lastResolvedOrigin: validOrigins.at(-1) ?? null,
    priorStdDev,
    minimumSamples,
    fallbackUsed,
    fallbackReason,
    solver,
  };
}

export function fitContextAwareLogitMAP(
  samples: Array<ContextAwareCalibrationSample>,
  priorStdDev = CONTEXT_AWARE_CONTINUOUS_PROBABILITY_PRIOR_STD_DEV,
  minimumSamples = CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MINIMUM_SAMPLES,
) {
  const safePrior = Number.isFinite(priorStdDev) && priorStdDev > 0 ? priorStdDev : 0;
  const safeMinimum = Number.isInteger(minimumSamples) && minimumSamples >= 1 ? minimumSamples : Number.MAX_SAFE_INTEGER;
  const zero = [0, 0, 0] as const;
  const baseSolver = {
    converged: false,
    iterations: 0,
    objective: null,
    reason: null as string | null,
  };
  if (safePrior <= 0) {
    return makeFit(samples, zero, priorStdDev, minimumSamples, true, "invalid_prior", {
      ...baseSolver,
      reason: "invalid_prior",
    });
  }
  if (samples.length < safeMinimum) {
    return makeFit(samples, zero, priorStdDev, minimumSamples, true, "insufficient_training_samples", {
      ...baseSolver,
      reason: "insufficient_training_samples",
    });
  }

  const priorPrecision = 1 / (safePrior * safePrior);
  let coefficients = [0, 0, 0];
  let converged = false;
  let iterations = 0;
  let solverReason: string | null = null;
  for (let iteration = 0; iteration < SOLVER_MAX_ITERATIONS; iteration += 1) {
    iterations = iteration + 1;
    const gradient = coefficients.map((coefficient) => coefficient * priorPrecision);
    const hessian = Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 3 }, (_, column) => row === column ? priorPrecision : 0),
    );
    for (const sample of samples) {
      const features = featureVector(sample.contextState);
      const eta = logit(sample.probability) + features.reduce(
        (sum, feature, index) => sum + feature * coefficients[index],
        0 as number,
      );
      const probability = sigmoid(eta);
      const residual = probability - Number(sample.actual);
      for (let index = 0; index < 3; index += 1) {
        gradient[index] += residual * features[index];
        for (let other = 0; other < 3; other += 1) {
          hessian[index][other] += probability * (1 - probability) * features[index] * features[other];
        }
      }
    }
    const step = solveLinearSystem(hessian, gradient.map((value) => -value));
    if (!step || step.some((value) => !Number.isFinite(value))) {
      solverReason = "singular_hessian";
      break;
    }
    const currentObjective = objective(coefficients, samples, priorPrecision);
    let stepScale = 1;
    let next = coefficients.map((coefficient, index) =>
      Math.min(MAX_ABS_COEFFICIENT, Math.max(-MAX_ABS_COEFFICIENT, coefficient + step[index])),
    );
    while (objective(next, samples, priorPrecision) > currentObjective && stepScale > 1 / 4096) {
      stepScale /= 2;
      next = coefficients.map((coefficient, index) =>
        Math.min(MAX_ABS_COEFFICIENT, Math.max(-MAX_ABS_COEFFICIENT, coefficient + step[index] * stepScale)),
      );
    }
    const movement = Math.max(...next.map((coefficient, index) => Math.abs(coefficient - coefficients[index])));
    coefficients = next;
    if (movement < SOLVER_TOLERANCE) {
      converged = true;
      break;
    }
  }
  if (!converged && solverReason === null) solverReason = "iteration_limit";
  const finite = coefficients.every(Number.isFinite);
  if (!finite || solverReason === "singular_hessian") {
    return makeFit(samples, zero, priorStdDev, minimumSamples, true, "solver_failed", {
      converged: false,
      iterations,
      objective: null,
      reason: solverReason ?? "non_finite_coefficients",
    });
  }
  return makeFit(
    samples,
    coefficients,
    priorStdDev,
    minimumSamples,
    false,
    null,
    {
      converged,
      iterations,
      objective: objective(coefficients, samples, priorPrecision),
      reason: solverReason,
    },
  );
}

export function getContextAwareLogitAdjustment(
  fit: Pick<ContextAwareCoefficientFit, "alpha" | "betaWeak" | "betaStrong">,
  state: ContextAwareContextState,
) {
  if (state === "weak") return fit.alpha + fit.betaWeak;
  if (state === "strong") return fit.alpha + fit.betaStrong;
  if (state === "none") return fit.alpha;
  return 0;
}

export function applyContextAwareLogitAdjustment(
  probability: number,
  state: ContextAwareContextState,
  fit: Pick<ContextAwareCoefficientFit, "alpha" | "betaWeak" | "betaStrong">,
) {
  const adjustment = getContextAwareLogitAdjustment(fit, state);
  if (adjustment === 0 || !Number.isFinite(adjustment)) {
    return Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 0;
  }
  return Math.min(1, Math.max(0, sigmoid(logit(probability) + adjustment)));
}

function getJstDayKey(value: string) {
  const parsed = timestamp(value);
  if (parsed === null) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(parsed));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isFiniteProbability(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function selectContextAwareTrainingRows(
  rows: Array<ContextAwareCalibrationRow>,
  asOf: Date,
  horizonHours: 24 | 48,
) {
  const asOfTime = asOf.getTime();
  const sorted = rows
    .filter((row) => {
      const generatedTime = timestamp(row.generatedAt);
      const actual = horizonHours === 24 ? row.actual24h : row.actual48h;
      const baseline = horizonHours === 24 ? row.baselineProbability24h : row.baselineProbability48h;
      return generatedTime !== null
        && Number.isFinite(asOfTime)
        && generatedTime < asOfTime
        && generatedTime + horizonHours * HOUR_MS <= asOfTime
        && typeof actual === "boolean"
        && isFiniteProbability(baseline)
        && isKnownState(row.contextState)
        && row.trainingEligible !== false
        && isKnownContextAwareContextProvenance(row.contextStateProvenance);
    })
    .slice()
    .sort((left, right) => timestamp(left.generatedAt)! - timestamp(right.generatedAt)!);
  const selected = new Map<string, ContextAwareCalibrationRow>();
  for (const row of sorted) {
    const dayKey = getJstDayKey(row.generatedAt);
    if (dayKey && !selected.has(dayKey)) selected.set(dayKey, row);
  }
  return Array.from(selected.values());
}

function getTrainingAudit(
  rows: Array<ContextAwareCalibrationRow>,
  asOf: Date,
  horizonHours: 24 | 48,
): ContextAwareTrainingAudit {
  const asOfTime = asOf.getTime();
  const excludedReasons: Record<string, number> = {};
  const addExcluded = (reason: string) => {
    excludedReasons[reason] = (excludedReasons[reason] ?? 0) + 1;
  };
  const eligible: Array<ContextAwareCalibrationRow> = [];
  for (const row of rows) {
    const generatedTime = timestamp(row.generatedAt);
    const actual = horizonHours === 24 ? row.actual24h : row.actual48h;
    const baseline = horizonHours === 24 ? row.baselineProbability24h : row.baselineProbability48h;
    if (generatedTime === null || !Number.isFinite(asOfTime)) {
      addExcluded("invalid_origin");
    } else if (generatedTime >= asOfTime) {
      addExcluded("future_origin");
    } else if (generatedTime + horizonHours * HOUR_MS > asOfTime) {
      addExcluded("unresolved_outcome");
    } else if (typeof actual !== "boolean") {
      addExcluded("unresolved_outcome");
    } else if (!isFiniteProbability(baseline)) {
      addExcluded("invalid_baseline");
    } else if (!isKnownState(row.contextState)) {
      addExcluded(row.contextExclusionReason ?? "unknown_context");
    } else if (row.trainingEligible === false) {
      addExcluded(row.contextExclusionReason ?? "excluded_context");
    } else if (!isKnownContextAwareContextProvenance(row.contextStateProvenance)) {
      addExcluded("unknown_provenance");
    } else {
      eligible.push(row);
    }
  }
  const selected = selectContextAwareTrainingRows(eligible, asOf, horizonHours);
  if (eligible.length > selected.length) addExcluded("daily_first_duplicate");
  return {
    selectedRows: selected,
    excludedCount: Object.values(excludedReasons).reduce((sum, count) => sum + count, 0),
    excludedReasons,
  };
}

function toSamples(
  rows: Array<ContextAwareCalibrationRow>,
  horizonHours: 24 | 48,
) {
  return rows.flatMap((row): Array<ContextAwareCalibrationSample> => {
    const actual = horizonHours === 24 ? row.actual24h : row.actual48h;
    const probability = horizonHours === 24 ? row.baselineProbability24h : row.baselineProbability48h;
    if (typeof actual !== "boolean" || !isFiniteProbability(probability) || !isKnownState(row.contextState)) return [];
    return [{
      probability,
      actual,
      contextState: row.contextState,
      generatedAt: row.generatedAt,
    }];
  });
}

function getActiveSignalAtOrigin(signal: TiboReadSideSignal, originTime: number) {
  const createdTime = timestamp(signal.tweet_created_at);
  if (createdTime === null || createdTime > originTime || signal.is_reply === true) return false;
  const expiresTime = timestamp(signal.expires_at);
  return expiresTime === null || expiresTime > originTime;
}

function fromSavedFeatureSnapshot(
  snapshot: PublishedV3FeatureSnapshot,
  options: { officialNoticeActive?: boolean; otherContextActive?: boolean },
): ContextAwareStateResolution {
  if (options.officialNoticeActive || snapshot.tiboSignalType === "official_notice") {
    return {
      contextState: "unknown",
      contextStateProvenance: "saved-feature-snapshot",
      trainingEligible: false,
      contextExclusionReason: "official_notice_active",
    };
  }
  if (options.otherContextActive || snapshot.statusIncident === true) {
    return {
      contextState: "unknown",
      contextStateProvenance: "saved-feature-snapshot",
      trainingEligible: false,
      contextExclusionReason: snapshot.statusIncident === true ? "status_incident" : "other_context_active",
    };
  }
  if (snapshot.tiboSignalType === "teaser") {
    if (snapshot.tiboTeaserStrength === "weak" || snapshot.tiboTeaserStrength === "strong") {
      return {
        contextState: snapshot.tiboTeaserStrength,
        contextStateProvenance: "saved-feature-snapshot",
        trainingEligible: true,
        contextExclusionReason: null,
      };
    }
    return {
      contextState: "unknown",
      contextStateProvenance: "saved-feature-snapshot",
      trainingEligible: false,
      contextExclusionReason: "unknown_teaser_strength",
    };
  }
  if (snapshot.usableTiboSignal === false || snapshot.tiboSignalType === "irrelevant" || snapshot.tiboSignalType === "reset_executed") {
    return {
      contextState: "none",
      contextStateProvenance: "saved-feature-snapshot",
      trainingEligible: true,
      contextExclusionReason: null,
    };
  }
  return {
    contextState: "unknown",
    contextStateProvenance: "saved-feature-snapshot",
    trainingEligible: false,
    contextExclusionReason: "unknown_context",
  };
}

export function resolveContextAwareContext(
  data: RadarData | null | undefined,
  origin: Date,
  options: {
    savedFeatureSnapshot?: unknown;
    officialNoticeActive?: boolean;
    otherContextActive?: boolean;
  } = {},
): ContextAwareStateResolution {
  if (options.savedFeatureSnapshot !== undefined) {
    const snapshot = readPublishedV3FeatureSnapshot(options.savedFeatureSnapshot);
    return snapshot
      ? fromSavedFeatureSnapshot(snapshot, options)
      : {
          contextState: "unknown",
          contextStateProvenance: "unknown",
          trainingEligible: false,
          contextExclusionReason: "unknown_context",
        };
  }

  const originTime = origin.getTime();
  const pointInTimeData = getPointInTimeRadarData(data ?? null, origin);
  if (!pointInTimeData || !Number.isFinite(originTime)) {
    return {
      contextState: "unknown",
      contextStateProvenance: "unknown",
      trainingEligible: false,
      contextExclusionReason: "unknown_context",
    };
  }
  if (options.officialNoticeActive) {
    return {
      contextState: "unknown",
      contextStateProvenance: "point-in-time-projection",
      trainingEligible: false,
      contextExclusionReason: "official_notice_active",
    };
  }
  if (options.otherContextActive || (pointInTimeData.openai_status_history ?? []).length > 0) {
    return {
      contextState: "unknown",
      contextStateProvenance: "point-in-time-projection",
      trainingEligible: false,
      contextExclusionReason: (pointInTimeData.openai_status_history ?? []).length > 0
        ? "status_incident"
        : "other_context_active",
    };
  }

  const signals = getTiboReadSideSignals(pointInTimeData, "all", true)
    .filter((signal) => getActiveSignalAtOrigin(signal, originTime));
  if (signals.some((signal) => signal.signal_type === "official_notice")) {
    return {
      contextState: "unknown",
      contextStateProvenance: "point-in-time-projection",
      trainingEligible: false,
      contextExclusionReason: "official_notice_active",
    };
  }
  const teaser = signals
    .filter((signal) => signal.signal_type === "teaser")
    .sort((left, right) => timestamp(right.tweet_created_at)! - timestamp(left.tweet_created_at)!)[0];
  if (!teaser) {
    return {
      contextState: "none",
      contextStateProvenance: "point-in-time-projection",
      trainingEligible: true,
      contextExclusionReason: null,
    };
  }
  const strength: TeaserStrength | null = getEffectiveTeaserStrength(teaser);
  if (strength === "weak" || strength === "strong") {
    return {
      contextState: strength,
      contextStateProvenance: "point-in-time-projection",
      trainingEligible: true,
      contextExclusionReason: null,
    };
  }
  return {
    contextState: "unknown",
    contextStateProvenance: "point-in-time-projection",
    trainingEligible: false,
    contextExclusionReason: "unknown_teaser_strength",
  };
}

export function hasExcludedSignalMultipliers(multipliers: ShadowSignalMultipliers) {
  const excludedKeys: Array<keyof Pick<ShadowSignalMultipliers,
    "statusSignal" | "officialIncidentHint" | "officialUpdate" | "communitySignal" | "usageLimitAnomaly" | "complaintPressure">> = [
    "statusSignal",
    "officialIncidentHint",
    "officialUpdate",
    "communitySignal",
    "usageLimitAnomaly",
    "complaintPressure",
  ];
  return excludedKeys.some((key) =>
    multipliers[key].probability24h > 1 + 1e-9 || multipliers[key].probability48h > 1 + 1e-9,
  );
}

function buildHorizonPair(probability24h: number, probability48h: number): ShadowProbabilityHorizons {
  return {
    probability12h: derive12hFrom24hProbability(probability24h),
    probability24h,
    probability48h,
    probability72h: derive72hFrom48hProbability(probability48h),
  };
}

export function toContextAwareForecastAudit(
  result: ContextAwareContinuousProbabilityResult,
): ContextAwareForecastAudit {
  const stateCounts24h = result.fit24h.stateCounts;
  const stateCounts48h = result.fit48h.stateCounts;
  return {
    contextSnapshotVersion: CONTEXT_AWARE_FORECAST_AUDIT_VERSION,
    contextState: result.contextState,
    contextStateProvenance: result.contextStateProvenance,
    trainingEligible: result.trainingEligible,
    contextExclusionReason: result.contextExclusionReason,
    baselineProbability24h: result.baseline.probability24h,
    baselineProbability48h: result.baseline.probability48h,
    contextAdjustedProbability24h: result.contextAdjusted.probability24h,
    contextAdjustedProbability48h: result.contextAdjusted.probability48h,
    alpha24h: result.fit24h.alpha,
    alpha48h: result.fit48h.alpha,
    betaWeak24h: result.fit24h.betaWeak,
    betaWeak48h: result.fit48h.betaWeak,
    betaStrong24h: result.fit24h.betaStrong,
    betaStrong48h: result.fit48h.betaStrong,
    trainingSampleCount24h: result.fit24h.sampleCount,
    trainingSampleCount48h: result.fit48h.sampleCount,
    positiveTrainingCount24h: result.fit24h.positiveCount,
    positiveTrainingCount48h: result.fit48h.positiveCount,
    noneSampleCount24h: stateCounts24h.none.count,
    noneSampleCount48h: stateCounts48h.none.count,
    nonePositiveCount24h: stateCounts24h.none.positiveCount,
    nonePositiveCount48h: stateCounts48h.none.positiveCount,
    weakSampleCount24h: stateCounts24h.weak.count,
    weakSampleCount48h: stateCounts48h.weak.count,
    weakPositiveCount24h: stateCounts24h.weak.positiveCount,
    weakPositiveCount48h: stateCounts48h.weak.positiveCount,
    strongSampleCount24h: stateCounts24h.strong.count,
    strongSampleCount48h: stateCounts48h.strong.count,
    strongPositiveCount24h: stateCounts24h.strong.positiveCount,
    strongPositiveCount48h: stateCounts48h.strong.positiveCount,
    lastResolvedOrigin24h: result.fit24h.lastResolvedOrigin,
    lastResolvedOrigin48h: result.fit48h.lastResolvedOrigin,
    excludedTrainingRowCount24h: result.excludedTrainingRowCount24h,
    excludedTrainingRowCount48h: result.excludedTrainingRowCount48h,
    excludedTrainingReasons24h: result.excludedTrainingReasons24h,
    excludedTrainingReasons48h: result.excludedTrainingReasons48h,
    priorStdDev: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_PRIOR_STD_DEV,
    minimumSamples: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MINIMUM_SAMPLES,
    fitFallbackUsed: result.fitFallbackUsed,
    fitFallbackReason: result.fitFallbackReason,
    trainingReadStatus: result.trainingReadStatus,
    horizonCoherenceAdjusted: result.horizonCoherenceAdjusted,
    officialNoticeOverride: result.officialNoticeOverride.active,
    ordinarySemanticSignalsApplied: false,
    underlyingModelVersion: result.underlyingModelVersion,
    bandwidthHours: result.bandwidthHours,
    truncationHours: result.truncationHours,
  };
}

export function calculateContextAwareContinuousProbability(
  data: RadarData | null,
  options: ContextAwareContinuousProbabilityOptions = {},
): ContextAwareContinuousProbabilityResult {
  const now = options.now ?? new Date();
  const trainingReadStatus = options.trainingReadStatus ?? "ok";
  const challenger = options.precomputedChallenger ?? calculateRandomContinuousBandwidthShadowPair(
    data,
    options,
  ).challenger;
  const state = resolveContextAwareContext(data, now, {
    savedFeatureSnapshot: options.savedFeatureSnapshot,
    officialNoticeActive: options.activeOfficialNotice !== null &&
      options.activeOfficialNotice !== undefined &&
      options.activeOfficialNotice.affectsProbability !== false,
    otherContextActive: hasExcludedSignalMultipliers(challenger.multipliers),
  });
  const rows = options.trainingRows ?? [];
  const audit24h = trainingReadStatus === "error"
    ? { selectedRows: [], excludedCount: rows.length, excludedReasons: rows.length > 0 ? { training_read_error: rows.length } : {} }
    : getTrainingAudit(rows, now, 24);
  const audit48h = trainingReadStatus === "error"
    ? { selectedRows: [], excludedCount: rows.length, excludedReasons: rows.length > 0 ? { training_read_error: rows.length } : {} }
    : getTrainingAudit(rows, now, 48);
  const fit24h = trainingReadStatus === "error"
    ? fitContextAwareLogitMAP([], CONTEXT_AWARE_CONTINUOUS_PROBABILITY_PRIOR_STD_DEV, CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MINIMUM_SAMPLES)
    : fitContextAwareLogitMAP(toSamples(audit24h.selectedRows, 24));
  const fit48h = trainingReadStatus === "error"
    ? fitContextAwareLogitMAP([], CONTEXT_AWARE_CONTINUOUS_PROBABILITY_PRIOR_STD_DEV, CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MINIMUM_SAMPLES)
    : fitContextAwareLogitMAP(toSamples(audit48h.selectedRows, 48));
  const baseline = challenger.baseline;
  const contextAdjustedPair = enforceNextGenerationHorizonCoherence(
    applyContextAwareLogitAdjustment(baseline.probability24h, state.contextState, fit24h),
    applyContextAwareLogitAdjustment(baseline.probability48h, state.contextState, fit48h),
  );
  const contextAdjusted = buildHorizonPair(
    contextAdjustedPair.probability24h,
    contextAdjustedPair.probability48h,
  );
  const latestRecoveryResetAt = challenger.randomContinuous.latestRecoveryResetAt;
  const notice: ActiveOfficialNotice | null = options.activeOfficialNotice === undefined
    ? getActiveOfficialNotice(
        data,
        latestRecoveryResetAt ? new Date(latestRecoveryResetAt) : null,
        now,
        options.localObservationSignals,
        null,
        false,
        false,
        options.canonicalHistoryContext,
      )
    : options.activeOfficialNotice;
  const noticeHorizons = applyOfficialNoticeTimingPolicy(contextAdjusted, notice, now);
  const policyHorizons = noticeHorizons ?? contextAdjusted;
  const finalPair = enforceNextGenerationHorizonCoherence(
    policyHorizons.probability24h,
    policyHorizons.probability48h,
  );
  const predictions: ShadowProbabilityHorizons = {
    probability12h: noticeHorizons
      ? policyHorizons.probability12h
      : derive12hFrom24hProbability(finalPair.probability24h),
    probability24h: finalPair.probability24h,
    probability48h: finalPair.probability48h,
    probability72h: Math.max(
      finalPair.probability48h,
      noticeHorizons
        ? policyHorizons.probability72h
        : derive72hFrom48hProbability(finalPair.probability48h),
    ),
  };
  const fitFallbackReasons = [fit24h.fallbackReason, fit48h.fallbackReason].filter(
    (reason): reason is string => reason !== null,
  );
  const fitFallbackUsed = trainingReadStatus === "error" || fit24h.fallbackUsed || fit48h.fallbackUsed;
  const fitFallbackReason = trainingReadStatus === "error"
    ? "prediction_history_training_query_failed"
    : fitFallbackReasons[0] ?? null;

  return {
    modelVersion: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
    calculatedAt: now.toISOString(),
    targetDefinition: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_TARGET_DEFINITION,
    underlyingModelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    baseline,
    contextAdjusted,
    predictions,
    contextState: state.contextState,
    contextStateProvenance: state.contextStateProvenance,
    trainingEligible: state.trainingEligible,
    contextExclusionReason: state.contextExclusionReason,
    fit24h,
    fit48h,
    excludedTrainingRowCount24h: audit24h.excludedCount,
    excludedTrainingRowCount48h: audit48h.excludedCount,
    excludedTrainingReasons24h: audit24h.excludedReasons,
    excludedTrainingReasons48h: audit48h.excludedReasons,
    trainingReadStatus,
    fitFallbackUsed,
    fitFallbackReason,
    horizonCoherenceAdjusted: contextAdjustedPair.adjusted || finalPair.adjusted,
    officialNoticeOverride: {
      active: noticeHorizons !== null,
      probability12h: noticeHorizons?.probability12h ?? null,
      probability24h: noticeHorizons?.probability24h ?? null,
      probability48h: noticeHorizons?.probability48h ?? null,
      probability72h: noticeHorizons?.probability72h ?? null,
    },
    officialNoticeTimingPolicyVersion: "official-notice-window-v3",
    randomContinuous: challenger.randomContinuous,
    randomContinuousResult: challenger,
    signalMultipliers: challenger.multipliers,
    bandwidthHours: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_OPTIONS.bandwidthHours,
    truncationHours: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_OPTIONS.truncationHours,
    freezeAt: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT,
    freezePolicy: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_POLICY,
    evaluationMode: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_EVALUATION_MODE,
    backfilled: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_BACKFILL,
  };
}
