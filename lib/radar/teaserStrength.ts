import { expandTiboSignalVariants } from "./tiboSecondarySignal";
import type { TiboSecondarySignal } from "./tiboSecondarySignal";
import {
  getTemporalExecutionWindowRelation,
  type ResetExecutionWindow,
} from "./tiboTemporal";
import { isTiboForecastSignalTerminatedAt } from "./officialNoticePolicy";

export const TIBO_TEASER_STRENGTHS = ["strong", "weak", "none"] as const;

export type TeaserStrength = (typeof TIBO_TEASER_STRENGTHS)[number];
export type ResetTeaserStatus = TeaserStrength | "unknown";

export type TiboSignalPresentationDisposition =
  | "official"
  | "strong_teaser"
  | "weak_teaser"
  | "none";

export type TiboSignalContextDependence =
  | "direct"
  | "reply_context"
  | "ambiguous";

export type TiboSignalInterpretation = {
  presentationDisposition: TiboSignalPresentationDisposition;
  officialNoticeEligible: boolean;
  probabilityTeaserEligible: boolean;
  timedProbabilityEligible: boolean;
  historyEligible: boolean;
  contextDependence: TiboSignalContextDependence;
  reason: string;
  uiTeaserFallback: boolean;
};

export type TiboSignalInterpretationOptions = {
  /** Timed policy may use a still-live resolved window beyond post age 48h. */
  ignoreCreatedAtLookback?: boolean;
};

const RESET_TEASER_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export type ResetTeaserSignal = {
  tweet_id?: string;
  tweet_created_at: string;
  text?: string | null;
  teaser_strength?: TeaserStrength | null;
  ai_teaser_strength?: TeaserStrength | null;
  signal_type?: string | null;
  confidence?: number | null;
  classification_source?: string | null;
  verification_status?: string | null;
  is_reply?: boolean | null;
  reply_context_text?: string | null;
  is_quote?: boolean | null;
  quote_context_text?: string | null;
  expires_at?: string | null;
  temporal_precision?: "exact_time" | "day" | "daypart" | "range" | "unknown" | null;
  temporal_confidence?: number | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
  temporal_resolution_status?: "resolved" | "unresolved" | "rejected" | null;
  secondary_signal?: TiboSecondarySignal | null;
  is_secondary_future_signal?: boolean;
  primary_event_at?: string;
  ui_teaser_fallback?: boolean;
};

export type TeaserStrengthWindowOptions = {
  includeReplies?: boolean;
  includeUiFallback?: boolean;
  resetExecutionWindow?: ResetExecutionWindow | null;
};

export function getEffectiveTeaserStrength(signal: {
  teaser_strength?: TeaserStrength | null;
  ai_teaser_strength?: TeaserStrength | null;
}) {
  return signal.teaser_strength ?? signal.ai_teaser_strength ?? null;
}

export function isTeaserStrength(value: unknown): value is TeaserStrength {
  return typeof value === "string" &&
    (TIBO_TEASER_STRENGTHS as readonly string[]).includes(value);
}

function getTimestamp(value: string | Date | null | undefined) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

const USAGE_RESET_CONTEXT_PATTERN = /\b(?:banked\s+reset|reset\s+button|usage\s+reset|usage\s+limit|rate\s+limit|quota|paid\s+plan|codex|chatgpt\s+work)\b/i;
const RESET_WORD_PATTERN = /\breset(?:s|ting)?\b/i;
const FUTURE_TIMING_PATTERN = /\b(?:today|tonight|tomorrow|soon|later|next\s+(?:week|month|year)|(?:this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const EXPLICIT_CLOCK_PATTERN = /\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i;
const EXPLICIT_RESET_OR_LIMIT_PATTERN = /\b(?:reset(?:s|ting)?|usage\s+limits?|rate\s+limits?|quota(?:s)?)\b/i;
const EXPLICIT_RESET_SCHEDULE_PATTERN = /\b(?:reset(?:s|ting)?|usage\s+limits?|rate\s+limits?|quota(?:s)?)\b[\s\S]{0,100}\b(?:at|by|on)\s+(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|today|tonight|tomorrow|(?:this|next)\s+\w+|\w+day)\b/i;
const EXPLICIT_SCHEDULE_INTENT_PATTERN = /\b(?:scheduled|set|due|expected)\b[\s\S]{0,40}\b(?:for|at|by|on)\b/i;
const EXPLICIT_NEGATION_PATTERN = /\b(?:no|nope|never|not|isn't|isnt|wasn't|wasnt|won't|wont|don't|dont|doesn't|doesnt|cannot|can't|cant|cancel(?:led|ed)?|canceled)\b[\s\S]{0,100}\b(?:reset|button|limit|quota)\b|\b(?:reset|button|limit|quota)\b[\s\S]{0,100}\b(?:no|nope|never|not|isn't|isnt|wasn't|wasnt|won't|wont|don't|dont|doesn't|doesnt|cancel(?:led|ed)?|canceled)\b/i;
const COMPLETION_PATTERN = /\b(?:already|just|successfully|done|completed|complete|happened|landed|arrived|propagated|issued|distributed|available|applied|live|active)\b[\s\S]{0,100}\b(?:reset|button|limit|quota)\b|\b(?:reset|button|limit|quota)\b[\s\S]{0,100}\b(?:already|just|successfully|done|completed|complete|happened|landed|arrived|propagated|issued|distributed|available|applied|live|active)\b|\b(?:i|we)\s+(?:pressed|hit|used|activated)\s+(?:the\s+)?(?:reset\s+)?button\b/i;
const AFFIRMATIVE_FUTURE_COMMITMENT_PATTERN = /\b(?:will|we['’]?ll|i['’]?ll|going\s+to|plan(?:s|ned)?\s+to|scheduled\s+to|set\s+to)\b[\s\S]{0,80}\b(?:reset|button|limit|quota|come|coming|happen|happening|land|landing|arrive|arriving)\b|\b(?:still\s+)?(?:come|coming|happen|happening|land|landing|arrive|arriving)\b/i;
const UNCERTAIN_FUTURE_COMMITMENT_PATTERN = /\b(?:maybe|might|could|possibly|perhaps|who\s+knows|we['’]?ll\s+see)\b/i;

function getContextDependence(signal: ResetTeaserSignal): TiboSignalContextDependence {
  const hasContext = Boolean(
    signal.reply_context_text?.trim() || signal.quote_context_text?.trim(),
  );

  if (signal.is_reply === true) return hasContext ? "reply_context" : "ambiguous";
  if (signal.is_quote === true) return "ambiguous";
  return hasContext ? "ambiguous" : "direct";
}

function getExternalContext(signal: ResetTeaserSignal) {
  return [signal.reply_context_text, signal.quote_context_text]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join("\n");
}

function hasResolvedFutureWindow(signal: ResetTeaserSignal, now: Date) {
  if (signal.temporal_resolution_status !== "resolved") return false;
  const nowTime = now.getTime();
  const startTime = getTimestamp(signal.expected_start_at);
  const endTime = getTimestamp(signal.expected_end_at);
  return Number.isFinite(nowTime) &&
    startTime !== null &&
    endTime !== null &&
    endTime >= startTime &&
    endTime > nowTime;
}

function hasValidatedDirectStrongConfidence(signal: ResetTeaserSignal) {
  if (signal.classification_source === "manual") return true;
  return typeof signal.confidence === "number" &&
    Number.isFinite(signal.confidence) &&
    signal.confidence >= 0.8;
}

function hasValidatedManualStrongReplyTimedTeaserEvidence(
  signal: ResetTeaserSignal,
  now: Date,
) {
  return signal.signal_type === "teaser" &&
    signal.is_reply === true &&
    signal.is_quote !== true &&
    signal.verification_status === "confirmed" &&
    signal.classification_source === "manual" &&
    getEffectiveTeaserStrength(signal) === "strong" &&
    hasResolvedFutureWindow(signal, now);
}

function hasExplicitAutomaticOfficialReplyEvidence(signal: ResetTeaserSignal) {
  const authorText = signal.text ?? "";
  if (!EXPLICIT_RESET_OR_LIMIT_PATTERN.test(authorText)) return false;

  const hasFutureSchedule = FUTURE_TIMING_PATTERN.test(authorText) ||
    EXPLICIT_CLOCK_PATTERN.test(authorText);
  if (!hasFutureSchedule) return false;

  const hasCommitmentOrSchedule =
    AFFIRMATIVE_FUTURE_COMMITMENT_PATTERN.test(authorText) ||
    EXPLICIT_RESET_SCHEDULE_PATTERN.test(authorText) ||
    EXPLICIT_SCHEDULE_INTENT_PATTERN.test(authorText);
  if (!hasCommitmentOrSchedule) return false;

  return !EXPLICIT_NEGATION_PATTERN.test(authorText) &&
    !COMPLETION_PATTERN.test(authorText);
}

function isOfficialNoticeEligible(signal: ResetTeaserSignal) {
  if (signal.signal_type !== "official_notice" ||
      signal.verification_status === "rejected" ||
      signal.is_quote === true ||
      typeof signal.confidence !== "number" ||
      !Number.isFinite(signal.confidence) ||
      signal.confidence < 0.95) {
    return false;
  }

  if (signal.is_reply !== true) return true;

  const manuallyVerifiedReply = signal.verification_status === "confirmed" &&
    signal.classification_source === "manual";
  return manuallyVerifiedReply || hasExplicitAutomaticOfficialReplyEvidence(signal);
}

function hasResetContext(signal: ResetTeaserSignal) {
  const externalContext = getExternalContext(signal);
  const combinedText = `${signal.text ?? ""}\n${externalContext}`;
  return Boolean(externalContext) &&
    RESET_WORD_PATTERN.test(combinedText) &&
    USAGE_RESET_CONTEXT_PATTERN.test(combinedText);
}

function hasStrongContextualTimedTeaserEvidence(
  signal: ResetTeaserSignal,
  now: Date,
  options: TiboSignalInterpretationOptions = {},
) {
  if (signal.signal_type !== "official_notice" && signal.signal_type !== "teaser") return false;
  if (signal.is_reply !== true && signal.is_quote !== true) return false;
  if (signal.verification_status === "rejected") return false;
  if (typeof signal.confidence !== "number" || !Number.isFinite(signal.confidence) || signal.confidence < 0.8 || signal.confidence >= 0.95) {
    return false;
  }

  const authorText = signal.text ?? "";
  const createdTime = getTimestamp(signal.tweet_created_at);
  const nowTime = now.getTime();
  if (createdTime === null || !Number.isFinite(nowTime) || createdTime > nowTime ||
      (!options.ignoreCreatedAtLookback && createdTime < nowTime - RESET_TEASER_LOOKBACK_MS)) {
    return false;
  }
  if (!hasResetContext(signal) || !FUTURE_TIMING_PATTERN.test(authorText)) return false;
  if (!AFFIRMATIVE_FUTURE_COMMITMENT_PATTERN.test(authorText)) return false;
  if (UNCERTAIN_FUTURE_COMMITMENT_PATTERN.test(authorText)) return false;
  if (EXPLICIT_NEGATION_PATTERN.test(authorText) || COMPLETION_PATTERN.test(authorText)) return false;
  return hasResolvedFutureWindow(signal, now);
}

function canDeriveAmbiguousContextTeaser(
  signal: ResetTeaserSignal,
  now: Date,
) {
  if (getEffectiveTeaserStrength(signal) !== null) return false;
  if (signal.signal_type !== "official_notice") return false;
  if (signal.is_reply !== true && signal.is_quote !== true) return false;
  if (signal.verification_status === "rejected") return false;
  if (typeof signal.confidence !== "number" || !Number.isFinite(signal.confidence) || signal.confidence >= 0.95) {
    return false;
  }

  const externalContext = getExternalContext(signal);
  if (!externalContext) return false;
  if (signal.temporal_resolution_status !== "resolved") return false;
  const createdTime = getTimestamp(signal.tweet_created_at);
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime) || createdTime === null || createdTime > nowTime || createdTime < nowTime - RESET_TEASER_LOOKBACK_MS) {
    return false;
  }

  const expectedStartTime = getTimestamp(signal.expected_start_at);
  const expectedEndTime = getTimestamp(signal.expected_end_at);
  if (expectedStartTime === null && expectedEndTime === null) return false;
  if ((expectedStartTime !== null && expectedStartTime <= createdTime) &&
      (expectedEndTime !== null && expectedEndTime <= createdTime)) {
    return false;
  }

  const authorText = signal.text ?? "";
  const combinedText = `${authorText}\n${externalContext}`;
  if (!RESET_WORD_PATTERN.test(combinedText) || !USAGE_RESET_CONTEXT_PATTERN.test(combinedText)) return false;
  if (!FUTURE_TIMING_PATTERN.test(authorText)) return false;
  if (EXPLICIT_NEGATION_PATTERN.test(combinedText) || COMPLETION_PATTERN.test(authorText)) return false;

  return true;
}

/**
 * Interprets stored source facts for a caller-specific presentation/use case.
 * This does not rewrite persisted signal_type or promote an ambiguous signal
 * into probability or canonical-history inputs.
 */
export function interpretTiboSignal(
  signal: ResetTeaserSignal,
  now: Date = new Date(),
  options: TiboSignalInterpretationOptions = {},
): TiboSignalInterpretation {
  const effectiveStrength = getEffectiveTeaserStrength(signal);
  const rejected = signal.verification_status === "rejected";
  const officialNoticeEligible = isOfficialNoticeEligible(signal);
  const probabilityTeaserEligible = !rejected &&
    signal.signal_type === "teaser" &&
    signal.is_reply !== true &&
    signal.is_quote !== true &&
    (effectiveStrength === "strong" || effectiveStrength === "weak");
  const historyEligible = !rejected &&
    signal.signal_type === "reset_executed" &&
    signal.is_reply !== true &&
    signal.is_quote !== true &&
    typeof signal.confidence === "number" &&
    Number.isFinite(signal.confidence) &&
    signal.confidence >= 0.95;
  const contextDependence = getContextDependence(signal);
  const strongContextualTimedTeaser =
    (effectiveStrength === null || effectiveStrength === "strong") &&
    hasStrongContextualTimedTeaserEvidence(signal, now, options);
  const directStrongTimedTeaser = !rejected &&
    signal.signal_type === "teaser" &&
    signal.is_reply !== true &&
    signal.is_quote !== true &&
    effectiveStrength === "strong" &&
    hasValidatedDirectStrongConfidence(signal) &&
    hasResolvedFutureWindow(signal, now);
  const manualStrongReplyTimedTeaser = !rejected &&
    hasValidatedManualStrongReplyTimedTeaserEvidence(signal, now);
  const timedProbabilityEligible = !rejected &&
    !officialNoticeEligible &&
    !historyEligible &&
    (strongContextualTimedTeaser || directStrongTimedTeaser || manualStrongReplyTimedTeaser);

  if (rejected) {
    return {
      presentationDisposition: "none",
      officialNoticeEligible,
      probabilityTeaserEligible,
      timedProbabilityEligible: false,
      historyEligible,
      contextDependence,
      reason: "rejected",
      uiTeaserFallback: false,
    };
  }

  if (officialNoticeEligible) {
    return {
      presentationDisposition: "official",
      officialNoticeEligible,
      probabilityTeaserEligible,
      timedProbabilityEligible: false,
      historyEligible,
      contextDependence,
      reason: "official_source",
      uiTeaserFallback: false,
    };
  }

  if (signal.signal_type === "reset_executed") {
    return {
      presentationDisposition: "none",
      officialNoticeEligible,
      probabilityTeaserEligible,
      timedProbabilityEligible: false,
      historyEligible,
      contextDependence,
      reason: "reset_executed",
      uiTeaserFallback: false,
    };
  }

  if (effectiveStrength === "strong" || effectiveStrength === "weak") {
    return {
      presentationDisposition: effectiveStrength === "strong" ? "strong_teaser" : "weak_teaser",
      officialNoticeEligible,
      probabilityTeaserEligible,
      timedProbabilityEligible,
      historyEligible,
      contextDependence,
      reason: signal.signal_type === "official_notice"
        ? "independent_teaser_strength"
        : "persisted_teaser_strength",
      uiTeaserFallback: signal.signal_type === "official_notice",
    };
  }

  if (strongContextualTimedTeaser) {
    return {
      presentationDisposition: "strong_teaser",
      officialNoticeEligible,
      probabilityTeaserEligible,
      timedProbabilityEligible: true,
      historyEligible,
      contextDependence,
      reason: "strong_timed_context",
      uiTeaserFallback: true,
    };
  }

  if (canDeriveAmbiguousContextTeaser(signal, now)) {
    return {
      presentationDisposition: "weak_teaser",
      officialNoticeEligible,
      probabilityTeaserEligible,
      timedProbabilityEligible,
      historyEligible,
      contextDependence,
      reason: "ambiguous_context",
      uiTeaserFallback: true,
    };
  }

  return {
    presentationDisposition: "none",
    officialNoticeEligible,
    probabilityTeaserEligible,
    timedProbabilityEligible,
    historyEligible,
    contextDependence,
    reason: "no_teaser_evidence",
    uiTeaserFallback: false,
  };
}

/**
 * Returns a presentation-only fallback for an ambiguous reply or quote that the
 * classifier related to a reset but did not safely admit as an official notice.
 * The fallback can be weak or a bounded strong-timed disposition; it is not an
 * ordinary teaser input and never becomes canonical history.
 */
export function getFallbackUiTeaserStrength(
  signal: ResetTeaserSignal,
  now: Date = new Date(),
): Extract<TeaserStrength, "weak" | "strong"> | null {
  const interpretation = interpretTiboSignal(signal, now);
  if (!interpretation.uiTeaserFallback) return null;
  return interpretation.presentationDisposition === "strong_teaser" ? "strong" : "weak";
}

/**
 * Returns posts eligible for a 48-hour teaser-strength window.
 * Expiration is intentionally not part of this filter; callers can choose
 * whether replies belong to their own use of the shared time window.
 */
export function getTeaserStrengthSignals(
  signals: readonly ResetTeaserSignal[] | null | undefined,
  latestResetAt: string | Date | null | undefined,
  now: Date = new Date(),
  options: TeaserStrengthWindowOptions = {},
) {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return [];

  const latestResetTime = getTimestamp(latestResetAt);
  const cutoffTime = nowTime - RESET_TEASER_LOOKBACK_MS;
  const includeReplies = options.includeReplies ?? true;
  const includeUiFallback = options.includeUiFallback ?? false;
  const resetExecutionWindow = options.resetExecutionWindow ?? (latestResetTime === null
    ? null
    : { executionWindowStartAt: null, executionWindowEndAt: new Date(latestResetTime).toISOString() });
  const activeForecastSignals = (signals ?? []).filter((signal) =>
    !isTiboForecastSignalTerminatedAt(signal.tweet_id, now)
  );
  const expandedSignals = expandTiboSignalVariants(activeForecastSignals);

  return expandedSignals
    .map((signal) => {
      const interpretation = includeUiFallback ? interpretTiboSignal(signal, now) : null;
      if (interpretation?.uiTeaserFallback &&
          (interpretation.presentationDisposition === "weak_teaser" ||
            interpretation.presentationDisposition === "strong_teaser")) {
        return {
          ...signal,
          teaser_strength: interpretation.presentationDisposition === "strong_teaser"
            ? "strong" as const
            : "weak" as const,
          ui_teaser_fallback: true,
        };
      }
      return signal;
    })
    .filter((signal) => {
    const isUiFallback = signal.ui_teaser_fallback === true;
    const createdTime = getTimestamp(signal.tweet_created_at);
    const primaryEventTime = signal.is_secondary_future_signal === true
      ? getTimestamp(signal.primary_event_at)
      : null;
    const temporalRelation = getTemporalExecutionWindowRelation(
      signal.temporal_resolution_status === "resolved"
        ? {
            status: signal.temporal_resolution_status,
            expectedStartAt: signal.expected_start_at ?? null,
            expectedEndAt: signal.expected_end_at ?? null,
          }
        : null,
      resetExecutionWindow,
    );
    const isFutureWindowAfterBoundary = temporalRelation === "before";
    const isSemanticallyAfterBoundary = latestResetTime === null ||
      (createdTime !== null && createdTime > latestResetTime) ||
      (primaryEventTime !== null && primaryEventTime === latestResetTime) ||
      (createdTime !== null && createdTime <= latestResetTime && isFutureWindowAfterBoundary);
    return Boolean(
      createdTime !== null &&
        createdTime <= nowTime &&
        createdTime >= cutoffTime &&
        isSemanticallyAfterBoundary &&
        signal.verification_status !== "rejected" &&
        (isUiFallback || signal.signal_type !== "official_notice") &&
        signal.signal_type !== "reset_executed" &&
        (includeReplies || signal.is_reply !== true),
    );
    });
}

/**
 * UI aggregation keeps its existing reply-inclusive behavior. Probability
 * code uses getTeaserStrengthSignals directly with replies disabled.
 */
export function getUiResetTeaserSignals(
  signals: readonly ResetTeaserSignal[] | null | undefined,
  latestResetAt: string | Date | null | undefined,
  now: Date = new Date(),
  resetExecutionWindow: ResetExecutionWindow | null = null,
) {
  return getTeaserStrengthSignals(signals, latestResetAt, now, {
    includeReplies: true,
    includeUiFallback: true,
    resetExecutionWindow,
  });
}

/**
 * Aggregates the UI-only teaser state without changing the meaning of any
 * active signal, expiry, or probability input.
 */
export function aggregateResetTeaserStatus(
  signals: readonly ResetTeaserSignal[] | null | undefined,
  latestResetAt: string | Date | null | undefined,
  now: Date = new Date(),
  resetExecutionWindow: ResetExecutionWindow | null = null,
): ResetTeaserStatus {
  const eligibleSignals = getUiResetTeaserSignals(
    signals,
    latestResetAt,
    now,
    resetExecutionWindow,
  );
  let hasEligiblePost = false;
  let hasWeak = false;
  let hasNone = false;

  for (const signal of eligibleSignals) {
    hasEligiblePost = true;
    const strength = getEffectiveTeaserStrength(signal);
    if (strength === "strong") return "strong";
    if (strength === "weak") {
      hasWeak = true;
    } else if (strength === "none") {
      hasNone = true;
    }
  }

  if (hasWeak) return "weak";
  if (hasNone) return "none";
  return hasEligiblePost ? "unknown" : "none";
}

export type TeaserStrengthAssessment = {
  teaserStrength: TeaserStrength | null;
  teaserStrengthConfidence: number | null;
  teaserStrengthEvidenceQuote: string | null;
  teaserStrengthReasonJa: string | null;
};

function getExactEvidenceQuote(value: unknown, sourceText: string) {
  if (typeof value !== "string" || value.length > 300) return null;

  const quote = value.trim();
  if (!quote) return null;
  return sourceText.toLowerCase().includes(quote.toLowerCase()) ? quote : null;
}

export function parseTeaserStrengthAssessment(
  value: unknown,
  sourceText: string,
): TeaserStrengthAssessment {
  if (!value || typeof value !== "object") {
    return {
      teaserStrength: null,
      teaserStrengthConfidence: null,
      teaserStrengthEvidenceQuote: null,
      teaserStrengthReasonJa: null,
    };
  }

  const parsed = value as Record<string, unknown>;
  const teaserStrength = isTeaserStrength(parsed.teaserStrength)
    ? parsed.teaserStrength
    : null;
  if (!teaserStrength) {
    return {
      teaserStrength: null,
      teaserStrengthConfidence: null,
      teaserStrengthEvidenceQuote: null,
      teaserStrengthReasonJa: null,
    };
  }

  const confidence = parsed.teaserStrengthConfidence;
  const teaserStrengthConfidence = typeof confidence === "number" &&
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 1
    ? confidence
    : null;

  return {
    teaserStrength,
    teaserStrengthConfidence,
    teaserStrengthEvidenceQuote: getExactEvidenceQuote(
      parsed.teaserStrengthEvidenceQuote,
      sourceText,
    ),
    teaserStrengthReasonJa:
      typeof parsed.teaserStrengthReasonJa === "string"
        ? parsed.teaserStrengthReasonJa.slice(0, 500)
        : null,
  };
}
