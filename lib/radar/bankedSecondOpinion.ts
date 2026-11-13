import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActiveTiboSignal } from "./types";
import type { BankedPostAssociationDecision } from "./resetPostAssociation";
import { classifyWithGemini, type GeminiClassificationInput, type GeminiClassificationOutput } from "./geminiClassification";

const SECOND_OPINION_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const SECOND_OPINION_MAX_CANDIDATES = 5;
const SECOND_OPINION_MIN_CONFIDENCE = 0.95;
const BANKED_KEYWORD_PRIORITY_PATTERN =
  /\b(?:banked|reset(?:s|ting)?|credits?|limits?|quotas?|dots|everyones?|accounts?|land(?:ed|ing)?|activat\w*)\b/i;

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

export type BankedSecondOpinionClassifier = (
  input: GeminiClassificationInput,
  options?: { model?: string; mode?: string },
) => Promise<GeminiClassificationOutput>;

/**
 * Selects recent non-manual, non-rejected Tibo posts within 48h prior to an observed
 * BANKED grant that were classified as irrelevant/teaser and could be re-evaluated.
 */
export function selectBankedSecondOpinionCandidates(
  signals: readonly ActiveTiboSignal[],
  observedAt: string,
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
      const leftPriority = BANKED_KEYWORD_PRIORITY_PATTERN.test(left.text ?? "") ? 1 : 0;
      const rightPriority = BANKED_KEYWORD_PRIORITY_PATTERN.test(right.text ?? "") ? 1 : 0;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return Date.parse(right.tweet_created_at) - Date.parse(left.tweet_created_at);
    })
    .slice(0, maxCandidates);
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
  const candidates = selectBankedSecondOpinionCandidates(signals, observation.observed_at);
  if (candidates.length === 0) {
    return { signals: [...signals], promotedTweetIds: [], reviewedTweetIds: [] };
  }

  const isCustomClassifier = options.classify !== undefined;
  const mode = (process.env.GEMINI_CLASSIFICATION_MODE || "off").toLowerCase();
  if (!isCustomClassifier && (mode === "off" || !process.env.GEMINI_API_KEY?.trim() || !process.env.GEMINI_MODEL?.trim())) {
    return { signals: [...signals], promotedTweetIds: [], reviewedTweetIds: [] };
  }

  const monitorContext = [
    `Usage Monitor observed an actual BANKED reset credit increase (${observation.previous_available_count} -> ${observation.current_available_count}) at ${observation.observed_at}.`,
    "Re-evaluate whether this post announces that broad banked reset distribution/activation for paid users or everyone's accounts.",
    "Only return official_notice (>= 0.95 confidence) if the post itself announces a broad banked reset activation, rollout, or account delivery; keep unrelated chatter as irrelevant and pure speculation as teaser.",
  ].join(" ");

  const promotedById = new Map<string, ActiveTiboSignal>();
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
      aiResult.signalType !== "official_notice" ||
      (aiResult.confidence ?? 0) < SECOND_OPINION_MIN_CONFIDENCE
    ) {
      continue;
    }

    const observedMs = Date.parse(observation.observed_at);
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
          signal_type: "official_notice",
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
      ...candidate,
      signal_type: "official_notice",
      confidence: aiResult.confidence ?? SECOND_OPINION_MIN_CONFIDENCE,
      classification_source: "gemini",
      expires_at: extendedExpiry,
    });
  }

  if (promotedById.size === 0) {
    return { signals: [...signals], promotedTweetIds: [], reviewedTweetIds };
  }

  return {
    signals: signals.map((signal) => promotedById.get(signal.tweet_id) ?? signal),
    promotedTweetIds: Array.from(promotedById.keys()),
    reviewedTweetIds,
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
  sendWebhook?: (url: string, body: { content: string; text: string }) => Promise<void>;
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
  if (!webhookUrl) return false;

  const message = [
    `[Codex Reset Observatory] BANKED grant observation is ${decision.status} (${decision.reason}).`,
    `Observed at: ${observation.observed_at} (${observation.previous_available_count} -> ${observation.current_available_count})`,
    `Event key: ${observation.reset_event_key}`,
    recentCandidates.length > 0 ? `Recent Tibo candidates: ${recentCandidates.join(", ")}` : "Recent Tibo candidates: none",
  ].join("\n");

  try {
    if (options.sendWebhook) {
      await options.sendWebhook(webhookUrl, { content: message, text: message });
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
