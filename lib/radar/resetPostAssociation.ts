import type { ActiveTiboSignal } from "./types";
import {
  hasFutureBankedDistributionIntent,
  isBankedDistributionNotice,
  isBroadBankedDistributionNotice,
  isConditionalBankedDistributionNotice,
} from "./bankedReset";
import {
  TIBO_FORECAST_SIGNAL_TERMINATIONS,
} from "./officialNoticePolicy";
import { buildTiboReadSideProjection } from "./tiboLogicalProjection";

export const BANKED_POST_ASSOCIATION_VERSION = "banked-post-association-v1";

export type BankedGrantObservationForMatching = {
  observationKey: string;
  resetEventKey: string;
  sourceKey: string;
  limitId: string;
  planType: string;
  previousObservedAt: string | null;
  observedAt: string;
  receivedAt: string;
  previousAvailableCount: number;
  currentAvailableCount: number;
};

export type BankedAssociationExclusionReason =
  | "not_official_notice"
  | "reply_or_quote"
  | "rejected_or_low_confidence"
  | "no_banked_distribution_claim"
  | "scope_unverified_or_conditional"
  | "notice_after_observation"
  | "terminated_before_observation"
  | "expired_before_observation"
  | "unbounded_notice_lifecycle"
  | "scheduled_claim_unresolved"
  | "schedule_does_not_overlap_observation"
  | "unscheduled_claim_not_in_progress"
  | "claim_negated_or_cancelled"
  | "scope_does_not_cover_observed_plan"
  | "scope_does_not_cover_all_paid_plans"
  | "edit_chain_unresolved"
  | "edit_chain_conflict";

export type NormalizedBankedPostClaim = {
  tweetId: string;
  logicalPostId: string;
  sourceTweetIds: string[];
  createdAt: string;
  validFrom: string;
  validUntil: string | null;
  claimKind: "banked_distribution" | "not_banked_distribution";
  scope: "all_paid" | "conditional" | "unknown";
  phase: "in_progress" | "recurring" | "scheduled" | "unresolved";
  scheduleStartAt: string | null;
  scheduleEndAt: string | null;
  schedulePrecision: string | null;
  coveredPlanTypes: string[] | null;
  eligible: boolean;
  exclusionReason: BankedAssociationExclusionReason | null;
};

export type BankedPostAssociationDecision = {
  status: "accepted" | "pending" | "conflict";
  reason: string;
  matcherVersion: typeof BANKED_POST_ASSOCIATION_VERSION;
  observationKey: string;
  resetEventKey: string;
  noticeTweetId: string | null;
  logicalPostId: string | null;
  sourceTweetIds: string[];
  eligibleCandidateIds: string[];
  excludedCandidates: Array<{ tweetId: string; reason: BankedAssociationExclusionReason }>;
  legacy_identity_status?: "resolved" | "unresolved" | "legacy_exact";
  legacy_reset_event_key?: string | null;
};

export type BankedPostAssociationContext = {
  protectedAssociation?: {
    noticeTweetId: string;
    provenance: "manual" | "accepted";
  } | null;
  explicitSameEventNoticeTweetId?: string | null;
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function trustedLogicalPostId(signal: ActiveTiboSignal) {
  const history = signal.edit_history_tweet_ids;
  const logicalPostId = signal.logical_post_id?.trim();
  if (
    signal.edit_metadata_source === "x_api" &&
    logicalPostId &&
    Array.isArray(history) &&
    history.includes(signal.tweet_id)
  ) {
    return logicalPostId;
  }
  return signal.tweet_id;
}

function getNoticeTermination(signal: ActiveTiboSignal) {
  const ids = Array.from(new Set([
    signal.tweet_id,
    ...(signal.edit_history_tweet_ids ?? []),
    signal.logical_post_id ?? "",
  ].filter(Boolean)));
  const entries = ids
    .map((tweetId) => ({ tweetId, termination: TIBO_FORECAST_SIGNAL_TERMINATIONS[tweetId] }))
    .filter((item): item is { tweetId: string; termination: NonNullable<typeof item.termination> } => Boolean(item.termination));
  if (entries.length === 0) return null;
  return entries.reduce((earliest, current) =>
    Date.parse(current.termination.endedAt) < Date.parse(earliest.termination.endedAt)
      ? current
      : earliest,
  ).termination.endedAt;
}

function hasExplicitLoadingClaim(text: string) {
  return /\b(?:(?:am|is|are)\s+)?loading\b[\s\S]{0,120}\b(?:banked\s+resets?|reset\s+credits?)\b[\s\S]{0,120}\b(?:into\s+(?:all|every)\s+accounts?|in\s+everyone['’]s\s+(?:paid\s+)?accounts?)\b|\bcurrently\s+(?:loading|distributing|granting)\b[\s\S]{0,100}\b(?:banked\s+resets?|reset\s+credits?)\b/i.test(text);
}

function hasRecurringClaim(text: string) {
  return /\b(?:every|each)\s+(?:day|week|month)\b|\b(?:daily|weekly|monthly)\b/i.test(text);
}

function hasNegatedDistributionClaim(text: string) {
  if (
    /\b(?:not|never|no longer|won['’]?t|will not|isn['’]?t|aren['’]?t|is not|are not|cancel(?:ed|led)?|stopped)\b[\s\S]{0,100}\b(?:loading|distribut(?:e|ing)|grant(?:ing|ed)|giv(?:e|ing)|banked\s+resets?|reset\s+credits?)\b/i.test(text) ||
    /\b(?:no|zero)\s+(?:banked\s+)?(?:resets?|reset\s+credits?)\b[\s\S]{0,80}\b(?:load|distribut|grant|give)\b/i.test(text)
  ) return true;

  const clauses = text.split(/[.!?]+|\b(?:update|correction)\s*:\s*/i).map((clause) => clause.trim());
  const hasBankedClaim = clauses.some((clause) => isBankedDistributionNotice(clause));
  const cancelsSameDistribution = clauses.some((clause) =>
    /\b(?:this|that|the)\s+(?:banked\s+)?(?:distribution|grant|banked\s+reset|reset\s+credit)\b[\s\S]{0,80}\b(?:cancel(?:ed|led)|stopp?ed|will not happen|won['’]?t happen)\b/i.test(clause),
  );
  return hasBankedClaim && cancelsSameDistribution;
}

function getExplicitCoveredPlanTypes(text: string): string[] | null {
  const plan = "(?:plus|pro|business|enterprise|team|edu)";
  const separator = "(?:\\s*,\\s*(?:and\\s+)?|\\s+(?:and|or)\\s+)";
  const list = `(${plan}(?:${separator}${plan})*)`;
  const patterns = [
    new RegExp(`\\b(?:all\\s+)?${list}\\s+(?:users?|accounts?|subscribers?)\\b`, "i"),
    new RegExp(`\\b(?:all\\s+)?accounts?\\s+of\\s+${list}\\s+users?\\b`, "i"),
    new RegExp(`\\b(?:users?|accounts?|subscribers?)\\s+(?:on|of)\\s+${list}\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return Array.from(new Set(match[1].toLowerCase().match(/plus|pro|business|enterprise|team|edu/g) ?? []));
    }
  }
  return null;
}

const ALL_PAID_PLAN_TYPES_FOR_AUTOMATIC_PUBLICATION = ["plus", "pro", "business"] as const;

function hasAllPaidPublicScope(text: string) {
  const clauses = text.split(/[.!?。！？;]+/).map((clause) => clause.trim()).filter(Boolean);
  return clauses.some((clause) => {
    if (!isBroadBankedDistributionNotice(clause) || isConditionalBankedDistributionNotice(clause)) return false;
    const explicitPlans = getExplicitCoveredPlanTypes(clause);
    return explicitPlans === null || ALL_PAID_PLAN_TYPES_FOR_AUTOMATIC_PUBLICATION.every((plan) =>
      explicitPlans.includes(plan),
    );
  });
}

function hasUnresolvedFutureLoadingSchedule(signal: ActiveTiboSignal, text: string) {
  const expectedStart = parseTime(signal.expected_start_at);
  const expectedEnd = parseTime(signal.expected_end_at);
  if (
    signal.temporal_resolution_status === "resolved" &&
    expectedStart !== null && expectedEnd !== null && expectedEnd >= expectedStart
  ) return false;

  const futureSchedule = /\b(?:tomorrow|next\s+(?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|\b(?:on\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?\b|\b(?:on\s+)?\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i;
  const loading = /\b(?:(?:am|is|are|'m|'re)\s+)?loading\b[\s\S]{0,100}\b(?:banked\s+resets?|reset\s+credits?)\b/i;
  return text.split(/[.!?。！？;]+/).some((clause) => futureSchedule.test(clause) && loading.test(clause));
}

function getFirstExclusion(
  signal: ActiveTiboSignal,
  observedTime: number,
): BankedAssociationExclusionReason | null {
  if (signal.signal_type !== "official_notice") return "not_official_notice";
  if (signal.is_reply === true || signal.is_quote === true) return "reply_or_quote";
  if (signal.verification_status === "rejected" || (signal.confidence ?? 0) < 0.95) {
    return "rejected_or_low_confidence";
  }
  const text = signal.text ?? "";
  const createdAt = parseTime(signal.tweet_created_at);
  if (createdAt === null || createdAt > observedTime) return "notice_after_observation";
  const terminationAt = parseTime(getNoticeTermination(signal));
  if (terminationAt !== null && observedTime >= terminationAt) return "terminated_before_observation";
  const expiryAt = parseTime(signal.expires_at);
  if (expiryAt !== null && observedTime >= expiryAt) return "expired_before_observation";
  if (hasNegatedDistributionClaim(text)) return "claim_negated_or_cancelled";
  if (!isBankedDistributionNotice(text)) return "no_banked_distribution_claim";
  if (!hasAllPaidPublicScope(text)) {
    return "scope_unverified_or_conditional";
  }
  if (hasUnresolvedFutureLoadingSchedule(signal, text)) return "scheduled_claim_unresolved";
  if (expiryAt === null && terminationAt === null) return "unbounded_notice_lifecycle";
  return null;
}

export function normalizeBankedPostClaim(
  signal: ActiveTiboSignal,
  context: { observedAt: string },
): NormalizedBankedPostClaim {
  const createdAt = parseTime(signal.tweet_created_at);
  const observedTime = parseTime(context.observedAt);
  const observed = observedTime ?? Number.NaN;
  const text = signal.text ?? "";
  const expiryAt = parseTime(signal.expires_at);
  const terminationAt = parseTime(getNoticeTermination(signal));
  const validUntilMs = [expiryAt, terminationAt].filter((time): time is number => time !== null).reduce<number | null>(
    (earliest, time) => earliest === null || time < earliest ? time : earliest,
    null,
  );
  const scheduleStartAt = signal.temporal_resolution_status === "resolved"
    ? signal.expected_start_at ?? null
    : null;
  const scheduleEndAt = signal.temporal_resolution_status === "resolved"
    ? signal.expected_end_at ?? null
    : null;
  const resolvedSchedule = parseTime(scheduleStartAt) !== null && parseTime(scheduleEndAt) !== null;
  const futureClaim = hasFutureBankedDistributionIntent(text);
  const phase: NormalizedBankedPostClaim["phase"] = resolvedSchedule
    ? "scheduled"
    : hasRecurringClaim(text)
      ? "recurring"
      : hasExplicitLoadingClaim(text)
        ? "in_progress"
        : futureClaim
          ? "unresolved"
          : "unresolved";
  let exclusionReason = getFirstExclusion(signal, observed);
  if (!exclusionReason && futureClaim && phase !== "recurring" && signal.temporal_resolution_status !== "resolved") {
    exclusionReason = "scheduled_claim_unresolved";
  }
  if (!exclusionReason && phase === "scheduled") {
    const start = parseTime(scheduleStartAt);
    const end = parseTime(scheduleEndAt);
    if (start === null || end === null || end < start) {
      exclusionReason = "scheduled_claim_unresolved";
    }
  }
  if (!exclusionReason && phase === "unresolved") {
    exclusionReason = "unscheduled_claim_not_in_progress";
  }

  const scope: NormalizedBankedPostClaim["scope"] = hasAllPaidPublicScope(text)
    ? "all_paid"
    : "conditional";

  return {
    tweetId: signal.tweet_id,
    logicalPostId: trustedLogicalPostId(signal),
    sourceTweetIds: signal.edit_metadata_source === "x_api" && Array.isArray(signal.edit_history_tweet_ids)
      ? Array.from(new Set(signal.edit_history_tweet_ids))
      : [signal.tweet_id],
    createdAt: signal.tweet_created_at,
    validFrom: signal.tweet_created_at,
    validUntil: validUntilMs === null ? null : new Date(validUntilMs).toISOString(),
    claimKind: isBankedDistributionNotice(text) && !hasNegatedDistributionClaim(text)
      ? "banked_distribution"
      : "not_banked_distribution",
    scope,
    phase,
    scheduleStartAt,
    scheduleEndAt,
    schedulePrecision: signal.temporal_precision ?? null,
    coveredPlanTypes: getExplicitCoveredPlanTypes(text),
    eligible: exclusionReason === null,
    exclusionReason,
  };
}

/**
 * Collapse trusted edit chains before association. Raw historical versions are
 * never independently eligible: only the effective authoritative content is
 * considered, while incomplete or conflicted chains remain explicit blockers.
 */
export function normalizeBankedPostClaims(
  signals: readonly ActiveTiboSignal[],
  context: { observedAt: string },
): NormalizedBankedPostClaim[] {
  const projection = buildTiboReadSideProjection({ recent_tibo_signals: signals });
  const claims: NormalizedBankedPostClaim[] = projection.effectiveSignals.map((signal) =>
    normalizeBankedPostClaim(signal, context),
  );
  const seen = new Set(claims.map((claim) => claim.logicalPostId));
  const signalById = new Map(signals.map((signal) => [signal.tweet_id, signal]));

  for (const post of projection.suppressedLogicalPosts) {
    if (seen.has(post.logicalPostId)) continue;
    const source = post.rawVersions.find((row) => signalById.has(row.tweet_id));
    if (!source) continue;
    const claim = normalizeBankedPostClaim(signalById.get(source.tweet_id)!, context);
    claim.logicalPostId = post.logicalPostId;
    claim.sourceTweetIds = [...post.sourceTweetIds];
    claim.eligible = false;
    claim.exclusionReason = post.latestVersionPresent === false
      ? "edit_chain_unresolved"
      : "edit_chain_conflict";
    claims.push(claim);
    seen.add(post.logicalPostId);
  }

  for (const conflict of projection.conflicts) {
    const unresolvedIds = conflict.tweetIds.filter((tweetId) => {
      const signal = signalById.get(tweetId);
      return signal && !claims.some((claim) =>
        claim.tweetId === tweetId || claim.sourceTweetIds.includes(tweetId),
      );
    });
    for (const tweetId of unresolvedIds) {
      const signal = signalById.get(tweetId);
      if (!signal) continue;
      const claim = normalizeBankedPostClaim(signal, context);
      claim.eligible = false;
      claim.exclusionReason = "edit_chain_conflict";
      claims.push(claim);
    }
  }

  return claims.sort((left, right) =>
    left.logicalPostId.localeCompare(right.logicalPostId) || left.tweetId.localeCompare(right.tweetId),
  );
}

function scheduleOverlapsObservation(
  observation: BankedGrantObservationForMatching,
  claim: NormalizedBankedPostClaim,
) {
  const start = parseTime(claim.scheduleStartAt);
  const end = parseTime(claim.scheduleEndAt);
  const observed = parseTime(observation.observedAt);
  if (start === null || end === null || observed === null || end < start) return false;
  if (claim.schedulePrecision === "exact_time") {
    const previous = parseTime(observation.previousObservedAt);
    if (previous !== null && previous <= observed) {
      return previous <= end && observed >= start;
    }
    return observed >= start && observed <= end;
  }
  const previous = parseTime(observation.previousObservedAt);
  if (previous !== null && previous <= observed) {
    return previous < end && observed >= start;
  }
  return observed >= start && observed < end;
}

function coversObservedPlan(claim: NormalizedBankedPostClaim, observation: BankedGrantObservationForMatching) {
  if (!claim.coveredPlanTypes) return true;
  const plan = observation.planType.trim().toLowerCase();
  return claim.coveredPlanTypes.includes(plan);
}

function decision(
  observation: BankedGrantObservationForMatching,
  status: BankedPostAssociationDecision["status"],
  reason: string,
  eligibleCandidateIds: string[],
  excludedCandidates: BankedPostAssociationDecision["excludedCandidates"],
  accepted?: NormalizedBankedPostClaim,
): BankedPostAssociationDecision {
  return {
    status,
    reason,
    matcherVersion: BANKED_POST_ASSOCIATION_VERSION,
    observationKey: observation.observationKey,
    resetEventKey: observation.resetEventKey,
    noticeTweetId: accepted?.tweetId ?? null,
    logicalPostId: accepted?.logicalPostId ?? null,
    sourceTweetIds: accepted?.sourceTweetIds ?? [],
    eligibleCandidateIds,
    excludedCandidates,
  };
}

export function matchBankedObservationToPosts(
  observation: BankedGrantObservationForMatching,
  claims: readonly NormalizedBankedPostClaim[],
  context: BankedPostAssociationContext = {},
): BankedPostAssociationDecision {
  const observationTime = parseTime(observation.observedAt);
  if (
    observationTime === null ||
    observation.previousAvailableCount < 0 ||
    observation.currentAvailableCount <= observation.previousAvailableCount
  ) {
    return decision(observation, "conflict", "invalid_grant_observation", [], []);
  }

  // Keep decision audit focused on plausible BANKED claims. Notice lookup can
  // span many unrelated Tibo rows; persisting a generic exclusion for every
  // irrelevant post would make each association decision grow with the whole
  // timeline without adding useful matching evidence.
  const excludedCandidates = claims
    .filter((claim) => !claim.eligible && (
      claim.claimKind === "banked_distribution" ||
      claim.exclusionReason === "claim_negated_or_cancelled"
    ))
    .map((claim) => ({ tweetId: claim.tweetId, reason: claim.exclusionReason ?? "no_banked_distribution_claim" as const }))
  const scheduleMismatches = claims
    .filter((claim) => claim.eligible && claim.phase === "scheduled" && !scheduleOverlapsObservation(observation, claim))
    .map((claim) => ({ tweetId: claim.tweetId, reason: "schedule_does_not_overlap_observation" as const }));
  const scopeMismatches = claims
    .filter((claim) => claim.eligible && !coversObservedPlan(claim, observation))
    .map((claim) => ({ tweetId: claim.tweetId, reason: "scope_does_not_cover_observed_plan" as const }));
  excludedCandidates.push(...scheduleMismatches, ...scopeMismatches);
  excludedCandidates.sort((left, right) => left.tweetId.localeCompare(right.tweetId));
  const eligible = claims
    .filter((claim) => claim.eligible)
    .filter((claim) => coversObservedPlan(claim, observation))
    .filter((claim) => claim.phase === "scheduled"
      ? scheduleOverlapsObservation(observation, claim)
      : claim.phase === "in_progress" || claim.phase === "recurring")
    .sort((left, right) => left.logicalPostId.localeCompare(right.logicalPostId) || left.tweetId.localeCompare(right.tweetId));
  const eligibleCandidateIds = Array.from(new Set(eligible.map((claim) => claim.logicalPostId))).sort();

  if (context.protectedAssociation) {
    const protectedId = context.protectedAssociation.noticeTweetId;
    const match = eligible.find((claim) => claim.tweetId === protectedId || claim.logicalPostId === protectedId);
    if (!match) {
      const protectedDecision = decision(observation, "conflict", "manual_association_protected", eligibleCandidateIds, excludedCandidates);
      protectedDecision.noticeTweetId = protectedId;
      protectedDecision.logicalPostId = protectedId;
      return protectedDecision;
    }
    return decision(observation, "accepted", "manual_association_preserved", eligibleCandidateIds, excludedCandidates, match);
  }

  if (context.explicitSameEventNoticeTweetId) {
    const explicit = eligible.find((claim) => claim.tweetId === context.explicitSameEventNoticeTweetId || claim.logicalPostId === context.explicitSameEventNoticeTweetId);
    if (explicit) return decision(observation, "accepted", "explicit_same_event_reference", eligibleCandidateIds, excludedCandidates, explicit);
  }

  if (eligibleCandidateIds.length > 1) {
    return decision(observation, "pending", "multiple_eligible_claims", eligibleCandidateIds, excludedCandidates);
  }
  if (eligible.length === 1) {
    return decision(observation, "accepted", "unique_active_distribution_claim", eligibleCandidateIds, excludedCandidates, eligible[0]);
  }

  const unresolvedSchedule = claims.some((claim) => claim.exclusionReason === "scheduled_claim_unresolved");
  const reason = unresolvedSchedule
    ? "scheduled_claim_unresolved"
    : scheduleMismatches.length > 0
      ? "schedule_does_not_overlap_observation"
    : excludedCandidates.length > 0
      ? "no_current_lifecycle_match"
      : "no_eligible_claim";
  return decision(observation, "pending", reason, [], excludedCandidates);
}
