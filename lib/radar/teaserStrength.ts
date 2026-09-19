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

const RESET_TEASER_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export type ResetTeaserSignal = {
  tweet_id?: string;
  tweet_created_at: string;
  text?: string | null;
  teaser_strength?: TeaserStrength | null;
  ai_teaser_strength?: TeaserStrength | null;
  signal_type?: string | null;
  confidence?: number | null;
  verification_status?: string | null;
  is_reply?: boolean | null;
  reply_context_text?: string | null;
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
const EXPLICIT_NEGATION_PATTERN = /\b(?:no|nope|never|not|isn't|isnt|wasn't|wasnt|won't|wont|don't|dont|doesn't|doesnt|cannot|can't|cant|cancel(?:led|ed)?|canceled)\b[\s\S]{0,100}\b(?:reset|button|limit|quota)\b|\b(?:reset|button|limit|quota)\b[\s\S]{0,100}\b(?:no|nope|never|not|isn't|isnt|wasn't|wasnt|won't|wont|don't|dont|doesn't|doesnt|cancel(?:led|ed)?|canceled)\b/i;
const COMPLETION_PATTERN = /\b(?:already|just|successfully|done|completed|complete|happened|landed|arrived|propagated|issued|distributed|available|applied|live|active)\b[\s\S]{0,100}\b(?:reset|button|limit|quota)\b|\b(?:reset|button|limit|quota)\b[\s\S]{0,100}\b(?:already|just|successfully|done|completed|complete|happened|landed|arrived|propagated|issued|distributed|available|applied|live|active)\b|\b(?:i|we)\s+(?:pressed|hit|used|activated)\s+(?:the\s+)?(?:reset\s+)?button\b/i;

/**
 * Returns a weak, presentation-only fallback for an ambiguous reply that the
 * classifier related to a reset but did not safely admit as an official notice.
 * This deliberately never produces a strong signal and is not used by model
 * probability inputs.
 */
export function getFallbackUiTeaserStrength(
  signal: ResetTeaserSignal,
  now: Date = new Date(),
): Extract<TeaserStrength, "weak"> | null {
  if (getEffectiveTeaserStrength(signal) !== null) return null;
  if (signal.signal_type !== "official_notice" || signal.is_reply !== true) return null;
  if (signal.verification_status === "rejected") return null;
  if (typeof signal.confidence !== "number" || !Number.isFinite(signal.confidence) || signal.confidence >= 0.95) {
    return null;
  }
  if (!signal.reply_context_text?.trim()) return null;
  if (signal.temporal_resolution_status !== "resolved") return null;
  const createdTime = getTimestamp(signal.tweet_created_at);
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime) || createdTime === null || createdTime > nowTime || createdTime < nowTime - RESET_TEASER_LOOKBACK_MS) return null;
  const expectedStartTime = getTimestamp(signal.expected_start_at);
  const expectedEndTime = getTimestamp(signal.expected_end_at);
  if (expectedStartTime === null && expectedEndTime === null) return null;
  if ((expectedStartTime !== null && expectedStartTime <= createdTime) &&
      (expectedEndTime !== null && expectedEndTime <= createdTime)) {
    return null;
  }

  const authorText = signal.text ?? "";
  const combinedText = `${authorText}\n${signal.reply_context_text}`;
  if (!RESET_WORD_PATTERN.test(combinedText) || !USAGE_RESET_CONTEXT_PATTERN.test(combinedText)) return null;
  if (!FUTURE_TIMING_PATTERN.test(authorText)) return null;
  if (EXPLICIT_NEGATION_PATTERN.test(combinedText) || COMPLETION_PATTERN.test(authorText)) return null;

  return "weak";
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
      if (includeUiFallback && getFallbackUiTeaserStrength(signal, now) === "weak") {
        return {
          ...signal,
          teaser_strength: "weak" as const,
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
