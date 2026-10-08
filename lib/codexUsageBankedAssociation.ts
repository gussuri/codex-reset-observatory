import type { ActiveTiboSignal } from "./radar/types";
import type { CodexUsageAtomicBankedObservationWrite } from "./codexUsageBankedGrant";
import type { BankedDistributionEstimateInput } from "./codexUsageRecoveryStore";
import {
  matchBankedObservationToPosts,
  normalizeBankedPostClaims,
  type BankedPostAssociationDecision,
} from "./radar/resetPostAssociation";

export function toBankedMatcherObservation(
  observation: CodexUsageAtomicBankedObservationWrite,
) {
  return {
    observationKey: observation.observation_key,
    resetEventKey: observation.reset_event_key,
    sourceKey: observation.source_key,
    limitId: observation.limit_id,
    planType: observation.plan_type,
    previousObservedAt: observation.previous_observed_at,
    observedAt: observation.observed_at,
    receivedAt: observation.received_at,
    previousAvailableCount: observation.previous_available_count,
    currentAvailableCount: observation.current_available_count,
  };
}

export function resolveBankedAssociation(
  observation: CodexUsageAtomicBankedObservationWrite,
  signals: readonly ActiveTiboSignal[],
  options: { observedAt: string; lookupFailed?: boolean; lookupFailureReason?: string },
): { decision: BankedPostAssociationDecision; estimate: BankedDistributionEstimateInput | null } {
  const matcherObservation = toBankedMatcherObservation(observation);
  if (options.lookupFailed) {
    const pending = matchBankedObservationToPosts(matcherObservation, []);
    return {
      decision: { ...pending, reason: options.lookupFailureReason ?? "candidate_lookup_failed" },
      estimate: null,
    };
  }

  const claims = normalizeBankedPostClaims(signals, { observedAt: options.observedAt });
  const decision = matchBankedObservationToPosts(matcherObservation, claims);
  if (decision.status !== "accepted" || !decision.noticeTweetId) {
    return { decision, estimate: null };
  }

  const selected = signals.find((signal) => signal.tweet_id === decision.noticeTweetId);
  if (!selected) {
    return {
      decision: { ...decision, status: "pending", reason: "accepted_candidate_missing", noticeTweetId: null, logicalPostId: null, sourceTweetIds: [] },
      estimate: null,
    };
  }
  const sourceIds = new Set(decision.sourceTweetIds);
  const chain = signals
    .filter((signal) => sourceIds.has(signal.tweet_id))
    .sort((left, right) => Date.parse(left.tweet_created_at) - Date.parse(right.tweet_created_at));
  const firstAnnouncement = chain[0] ?? selected;
  return {
    decision,
    estimate: {
      resetEventKey: observation.reset_event_key,
      displayExecutionAt: observation.observed_at,
      tiboAnnouncedAt: firstAnnouncement.tweet_created_at,
      tiboPrimaryTweetId: selected.tweet_id,
      tiboSourceTweetIds: [...decision.sourceTweetIds],
      officialNoticeTweetId: selected.tweet_id,
      officialNoticeAt: selected.tweet_created_at,
    },
  };
}
