import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActiveTiboSignal } from "./types";
import type { BankedPostAssociationDecision } from "./resetPostAssociation";
import { classifyWithGemini, type GeminiClassificationInput, type GeminiClassificationOutput } from "./geminiClassification";
import { getTiboClassificationSafetyDecision, type ClassificationSignalType } from "./classification";
import { getTiboContextSafetyDecision } from "./tiboContextSafety";

const SECOND_OPINION_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const SECOND_OPINION_MAX_CANDIDATES = 5;
const SECOND_OPINION_MIN_CONFIDENCE = 0.95;
const BANKED_KEYWORD_PRIORITY_PATTERN =
  /\b(?:banked|reset(?:s|ting)?|credits?|limits?|quotas?|dots|everyones?|accounts?|land(?:ed|ing)?|activat\w*)\b/i;
const FORCED_RESET_KEYWORD_PRIORITY_PATTERN =
  /\b(?:reset(?:s|ting|ted)?|limits?|quotas?|weekly|usage|button|pressed|rollout|back|codex|pro|plus)\b/i;

export type BankedSecondOpinionObservation = {
  observation_key: string;
  reset_event_key: string;
  observed_at: string;
  previous_available_count: number;
  current_available_count: number;
};

export type BankedSecondOpinionResult = {
  signals: ActiveTiboSignal[];
  promotedTweetIds: string[];
  reviewedTweetIds: string[];
};

export type ForcedResetSecondOpinionObservation = {
  observedAt: string;
  previousUsedPercent: number;
  currentUsedPercent: number;
  cycleHint: string;
  confidence: string;
};

export type ForcedResetSecondOpinionResult = {
  signals: ActiveTiboSignal[];
  promotedResetSignals: ActiveTiboSignal[];
  promotedNoticeSignals: ActiveTiboSignal[];
  reviewedTweetIds: string[];
};

export type BankedSecondOpinionClassifier = (
  input: GeminiClassificationInput,
  options?: { model?: string; mode?: string },
) => Promise<GeminiClassificationOutput>;

type SecondOpinionPromotableType = "official_notice" | "reset_executed";
type SecondOpinionWebhookSender = (url: string, body: { content: string; text: string }) => Promise<void>;

function selectSecondOpinionCandidates(
  signals: readonly ActiveTiboSignal[],
  observedAt: string,
  keywordPriorityPattern: RegExp,
  maxCandidates = SECOND_OPINION_MAX_CANDIDATES,
): ActiveTiboSignal[] {
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime)) return [];
  const windowStart = observedTime - SECOND_OPINION_LOOKBACK_MS;

  return signals
    .filter((signal) => {
      if (signal.signal_type !== "irrelevant" && signal.signal_type !== "teaser") return false;
      if (signal.classification_source === "manual") return false;
      if (signal.verification_status === "rejected") return false;
      if (signal.is_reply === true || signal.is_quote === true) return false;
      const createdAt = Date.parse(signal.tweet_created_at);
      return Number.isFinite(createdAt) && createdAt >= windowStart && createdAt <= observedTime;
    })
    .sort((left, right) => {
      const leftPriority = keywordPriorityPattern.test(left.text ?? "") ? 1 : 0;
      const rightPriority = keywordPriorityPattern.test(right.text ?? "") ? 1 : 0;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return Date.parse(right.tweet_created_at) - Date.parse(left.tweet_created_at);
    })
    .slice(0, maxCandidates);
}

function isSecondOpinionAiConfigured(isCustomClassifier: boolean): boolean {
  if (isCustomClassifier) return true;
  const mode = (process.env.GEMINI_CLASSIFICATION_MODE || "off").toLowerCase();
  return mode !== "off" &&
    Boolean(process.env.GEMINI_API_KEY?.trim()) &&
    Boolean(process.env.GEMINI_MODEL?.trim());
}

async function reviewAndPromoteSecondOpinionCandidates(options: {
  signals: readonly ActiveTiboSignal[];
  candidates: readonly ActiveTiboSignal[];
  observedAt: string;
  monitorContext: string;
  allowedSignalTypes: ReadonlySet<SecondOpinionPromotableType>;
  validateCandidatePromotion?: (candidate: ActiveTiboSignal, targetType: SecondOpinionPromotableType) => boolean;
  supabase?: SupabaseClient | null;
  classify: BankedSecondOpinionClassifier;
}): Promise<{
  signals: ActiveTiboSignal[];
  promotedEntries: Array<{ signal: ActiveTiboSignal; signalType: SecondOpinionPromotableType }>;
  reviewedTweetIds: string[];
}> {
  const {
    signals,
    candidates,
    observedAt,
    monitorContext,
    allowedSignalTypes,
    validateCandidatePromotion,
    supabase = null,
    classify,
  } = options;
  if (candidates.length === 0) {
    return { signals: [...signals], promotedEntries: [], reviewedTweetIds: [] };
  }

  const promotedById = new Map<string, { signal: ActiveTiboSignal; signalType: SecondOpinionPromotableType }>();
  const reviewedTweetIds: string[] = [];

  for (const candidate of candidates) {
    reviewedTweetIds.push(candidate.tweet_id);
    let aiResult: GeminiClassificationOutput;
    try {
      aiResult = await classify(
        {
          text: candidate.text ?? "",
          tweetCreatedAt: candidate.tweet_created_at,
          isReply: candidate.is_reply === true,
          isQuote: candidate.is_quote === true,
          secondOpinionMonitorContext: monitorContext,
        },
        { mode: "primary" },
      );
    } catch {
      continue;
    }

    if (
      aiResult.status !== "success" ||
      (aiResult.confidence ?? 0) < SECOND_OPINION_MIN_CONFIDENCE ||
      !allowedSignalTypes.has(aiResult.signalType as SecondOpinionPromotableType)
    ) {
      continue;
    }

    const promotedType = aiResult.signalType as SecondOpinionPromotableType;
    if (validateCandidatePromotion && !validateCandidatePromotion(candidate, promotedType)) {
      continue;
    }

    const observedMs = Date.parse(observedAt);
    const currentExpiryMs = candidate.expires_at ? Date.parse(candidate.expires_at) : Number.NaN;
    const extendedExpiry =
      Number.isFinite(currentExpiryMs) && currentExpiryMs > observedMs
        ? candidate.expires_at!
        : new Date(observedMs + 60 * 60 * 1000).toISOString();
    const reason = aiResult.reasonJa?.trim() || "Second-opinion review with Usage Monitor corroboration.";

    if (supabase) {
      const { error } = await supabase
        .from("tibo_signals")
        .update({
          signal_type: promotedType,
          confidence: aiResult.confidence,
          classification_source: "gemini",
          classification_reason: `[second-opinion] ${reason}`,
          ai_signal_type: aiResult.signalType,
          ai_confidence: aiResult.confidence,
          ai_reason_ja: aiResult.reasonJa,
          ai_model: aiResult.model,
          ai_classified_at: aiResult.classifiedAt,
          expires_at: extendedExpiry,
        })
        .eq("tweet_id", candidate.tweet_id)
        .neq("classification_source", "manual");
      if (error) continue;
    }

    promotedById.set(candidate.tweet_id, {
      signalType: promotedType,
      signal: {
        ...candidate,
        signal_type: promotedType,
        confidence: aiResult.confidence ?? SECOND_OPINION_MIN_CONFIDENCE,
        classification_source: "gemini",
        expires_at: extendedExpiry,
      },
    });
  }

  if (promotedById.size === 0) {
    return { signals: [...signals], promotedEntries: [], reviewedTweetIds };
  }

  return {
    signals: signals.map((signal) => promotedById.get(signal.tweet_id)?.signal ?? signal),
    promotedEntries: Array.from(promotedById.values()),
    reviewedTweetIds,
  };
}

function isForcedResetPromotionSafe(
  candidate: ActiveTiboSignal,
  targetType: SecondOpinionPromotableType,
): boolean {
  if (targetType !== "reset_executed") return true;
  const text = String(candidate.text ?? "");
  if (getTiboClassificationSafetyDecision(text, targetType as ClassificationSignalType).signalType !== "reset_executed") {
    return false;
  }
  const contextSafety = getTiboContextSafetyDecision({
    authorText: text,
    selectedSignalType: "reset_executed",
  });
  return !contextSafety || contextSafety.signalType === "reset_executed";
}

async function dispatchAlertWebhook(
  webhookUrl: string | undefined,
  message: string,
  sendWebhook?: SecondOpinionWebhookSender,
): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    if (sendWebhook) {
      await sendWebhook(webhookUrl, { content: message, text: message });
    } else {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message, text: message }),
        signal: AbortSignal.timeout(3000),
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Selects recent non-manual, non-rejected Tibo posts within 48h prior to an observed
 * BANKED grant that were classified as irrelevant/teaser and could be re-evaluated.
 */
export function selectBankedSecondOpinionCandidates(
  signals: readonly ActiveTiboSignal[],
  observedAt: string,
  maxCandidates = SECOND_OPINION_MAX_CANDIDATES,
): ActiveTiboSignal[] {
  return selectSecondOpinionCandidates(signals, observedAt, BANKED_KEYWORD_PRIORITY_PATTERN, maxCandidates);
}

/**
 * Selects recent non-manual, non-rejected Tibo posts within 48h prior to an unexpected
 * forced quota recovery that were classified as irrelevant/teaser and could be re-evaluated.
 */
export function selectForcedResetSecondOpinionCandidates(
  signals: readonly ActiveTiboSignal[],
  observedAt: string,
  maxCandidates = SECOND_OPINION_MAX_CANDIDATES,
): ActiveTiboSignal[] {
  return selectSecondOpinionCandidates(signals, observedAt, FORCED_RESET_KEYWORD_PRIORITY_PATTERN, maxCandidates);
}

/**
 * Re-evaluates recent Tibo candidates with Usage Monitor corroboration context when
 * automatic BANKED matching ended in no_eligible_claim.
 */
export async function runBankedSecondOpinionReview(options: {
  observation: BankedSecondOpinionObservation;
  signals: readonly ActiveTiboSignal[];
  supabase?: SupabaseClient | null;
  classify?: BankedSecondOpinionClassifier;
}): Promise<BankedSecondOpinionResult> {
  const { observation, signals, supabase = null, classify = classifyWithGemini } = options;
  if (!isSecondOpinionAiConfigured(options.classify !== undefined)) {
    return { signals: [...signals], promotedTweetIds: [], reviewedTweetIds: [] };
  }

  const candidates = selectBankedSecondOpinionCandidates(signals, observation.observed_at);
  const monitorContext = [
    `Usage Monitor observed an actual BANKED reset credit increase (${observation.previous_available_count} -> ${observation.current_available_count}) at ${observation.observed_at}.`,
    "Re-evaluate whether this post announces that broad banked reset distribution/activation for paid users or everyone's accounts.",
    "Only return official_notice (>= 0.95 confidence) if the post itself announces a broad banked reset activation, rollout, or account delivery; keep unrelated chatter as irrelevant and pure speculation as teaser.",
  ].join(" ");

  const outcome = await reviewAndPromoteSecondOpinionCandidates({
    signals,
    candidates,
    observedAt: observation.observed_at,
    monitorContext,
    allowedSignalTypes: new Set<SecondOpinionPromotableType>(["official_notice"]),
    supabase,
    classify,
  });

  return {
    signals: outcome.signals,
    promotedTweetIds: outcome.promotedEntries.map((entry) => entry.signal.tweet_id),
    reviewedTweetIds: outcome.reviewedTweetIds,
  };
}

/**
 * Re-evaluates recent Tibo candidates with Usage Monitor recovery context when an
 * unexpected quota recovery occurred without a corroborated formal reset or notice.
 */
export async function runForcedResetSecondOpinionReview(options: {
  observation: ForcedResetSecondOpinionObservation;
  signals: readonly ActiveTiboSignal[];
  supabase?: SupabaseClient | null;
  classify?: BankedSecondOpinionClassifier;
}): Promise<ForcedResetSecondOpinionResult> {
  const { observation, signals, supabase = null, classify = classifyWithGemini } = options;
  if (!isSecondOpinionAiConfigured(options.classify !== undefined)) {
    return {
      signals: [...signals],
      promotedResetSignals: [],
      promotedNoticeSignals: [],
      reviewedTweetIds: [],
    };
  }

  const candidates = selectForcedResetSecondOpinionCandidates(signals, observation.observedAt);
  const monitorContext = [
    `Usage Monitor observed an unexpected global Codex quota recovery (${observation.previousUsedPercent}% -> ${observation.currentUsedPercent}%, cycleHint=${observation.cycleHint}, confidence=${observation.confidence}) at ${observation.observedAt}.`,
    "Re-evaluate whether this post announces a current global forced quota reset execution (reset_executed, >= 0.95 confidence) OR an official reset notice/rollout (official_notice, >= 0.95 confidence).",
    "Only promote when the post itself announces a reset execution or official notice; keep pure teasers as teaser and unrelated chatter as irrelevant.",
  ].join(" ");

  const outcome = await reviewAndPromoteSecondOpinionCandidates({
    signals,
    candidates,
    observedAt: observation.observedAt,
    monitorContext,
    allowedSignalTypes: new Set<SecondOpinionPromotableType>(["reset_executed", "official_notice"]),
    validateCandidatePromotion: isForcedResetPromotionSafe,
    supabase,
    classify,
  });

  return {
    signals: outcome.signals,
    promotedResetSignals: outcome.promotedEntries
      .filter((entry) => entry.signalType === "reset_executed")
      .map((entry) => entry.signal),
    promotedNoticeSignals: outcome.promotedEntries
      .filter((entry) => entry.signalType === "official_notice")
      .map((entry) => entry.signal),
    reviewedTweetIds: outcome.reviewedTweetIds,
  };
}

/**
 * Emits a structured warning log and optional webhook alert when an observed
 * BANKED grant remains pending/withheld or conflicted after reconciliation.
 */
export async function notifyPendingBankedAssociation(options: {
  observation: BankedSecondOpinionObservation;
  decision: BankedPostAssociationDecision;
  candidateSignals: readonly ActiveTiboSignal[];
  sendWebhook?: SecondOpinionWebhookSender;
}): Promise<boolean> {
  const { observation, decision, candidateSignals } = options;
  if (decision.status === "accepted") return false;

  const recentCandidates = selectBankedSecondOpinionCandidates(candidateSignals, observation.observed_at, 3)
    .map((signal) => `${signal.tweet_id} (${signal.signal_type})`);

  console.warn("[BANKED Association Pending]", {
    observationKey: observation.observation_key,
    resetEventKey: observation.reset_event_key,
    observedAt: observation.observed_at,
    status: decision.status,
    reason: decision.reason,
    recentCandidates,
  });

  const webhookUrl =
    process.env.BANKED_ASSOCIATION_ALERT_WEBHOOK_URL?.trim() ||
    process.env.RADAR_ALERT_WEBHOOK_URL?.trim();

  const message = [
    `[Codex Reset Observatory] BANKED grant observation is ${decision.status} (${decision.reason}).`,
    `Observed at: ${observation.observed_at} (${observation.previous_available_count} -> ${observation.current_available_count})`,
    `Event key: ${observation.reset_event_key}`,
    recentCandidates.length > 0 ? `Recent Tibo candidates: ${recentCandidates.join(", ")}` : "Recent Tibo candidates: none",
  ].join("\n");

  return dispatchAlertWebhook(webhookUrl, message, options.sendWebhook);
}

/**
 * Emits a structured warning log and optional webhook alert when an unexpected
 * quota recovery falls back to monitor-only pending state without a Tibo post match.
 */
export async function notifyPendingForcedResetAssociation(options: {
  observation: ForcedResetSecondOpinionObservation;
  candidateSignals: readonly ActiveTiboSignal[];
  sendWebhook?: SecondOpinionWebhookSender;
}): Promise<boolean> {
  const { observation, candidateSignals } = options;
  const recentCandidates = selectForcedResetSecondOpinionCandidates(candidateSignals, observation.observedAt, 3)
    .map((signal) => `${signal.tweet_id} (${signal.signal_type})`);

  console.warn("[Forced Reset Association Pending]", {
    observedAt: observation.observedAt,
    cycleHint: observation.cycleHint,
    confidence: observation.confidence,
    previousUsedPercent: observation.previousUsedPercent,
    currentUsedPercent: observation.currentUsedPercent,
    recentCandidates,
  });

  const webhookUrl =
    process.env.RESET_PENDING_ALERT_WEBHOOK_URL?.trim() ||
    process.env.BANKED_ASSOCIATION_ALERT_WEBHOOK_URL?.trim() ||
    process.env.RADAR_ALERT_WEBHOOK_URL?.trim();

  const message = [
    `[Codex Reset Observatory] Unexpected quota recovery recorded as usage-reset-pending (no formal Tibo post matched).`,
    `Observed at: ${observation.observedAt} (${observation.previousUsedPercent}% -> ${observation.currentUsedPercent}%, cycleHint=${observation.cycleHint})`,
    recentCandidates.length > 0 ? `Recent Tibo candidates: ${recentCandidates.join(", ")}` : "Recent Tibo candidates: none",
  ].join("\n");

  return dispatchAlertWebhook(webhookUrl, message, options.sendWebhook);
}
