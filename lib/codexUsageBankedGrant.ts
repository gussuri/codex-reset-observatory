import {
  CODEX_USAGE_SOURCE_KEY,
  type CodexUsageSnapshot,
} from "./codexUsageRecovery";
import type { UsageMonitorState } from "./codexUsageMonitorCoverage";
import type { BankedPostAssociationDecision } from "./radar/resetPostAssociation";

export type CodexUsageAtomicBankedObservationWrite = {
  observation_key: string;
  reset_event_key: string;
  source_key: typeof CODEX_USAGE_SOURCE_KEY;
  limit_id: "codex";
  plan_type: string;
  previous_observed_at: string;
  observed_at: string;
  received_at: string;
  previous_available_count: number;
  current_available_count: number;
  observation_window_start_at: string;
  observation_window_end_at: string;
  execution_time_precision: "approximate";
  legacy_identity_status?: "resolved" | "unresolved" | "legacy_exact";
  legacy_reset_event_key?: string | null;
};

export type CodexUsageAtomicBankedAssociationWrite = {
  observation_key: string;
  expected_revision: number;
  status: BankedPostAssociationDecision["status"];
  reason: string;
  matcher_version: string;
  notice_tweet_id: string | null;
  logical_post_id: string | null;
  source_tweet_ids: string[];
  eligible_candidate_ids: string[];
  excluded_candidates: Array<{ tweetId: string; reason: string }>;
  decided_at: string;
  legacy_identity_status?: "resolved" | "unresolved" | "legacy_exact";
  legacy_reset_event_key?: string | null;
};

function parseTime(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampToken(value: string) {
  const parsed = parseTime(value);
  if (parsed === null) return null;
  return new Date(parsed).toISOString().replace(/[-:.]/g, "");
}

/**
 * Creates an immutable BANKED count-increase fact. A client event flag alone
 * is not evidence: the server must see a compatible, known predecessor count.
 */
export function buildBankedGrantObservationWrite(input: {
  previousState: UsageMonitorState | null | undefined;
  snapshot: CodexUsageSnapshot;
  receivedAt: string;
  compatibleResetEventKey?: string | null;
}): CodexUsageAtomicBankedObservationWrite | null {
  const previous = input.previousState;
  const previousCount = previous?.bankedResetAvailableCount;
  const currentCount = input.snapshot.bankedResetAvailableCount;
  const previousTime = parseTime(previous?.observedAt);
  const observedTime = parseTime(input.snapshot.observedAt);
  const receivedTime = parseTime(input.receivedAt);
  const token = timestampToken(input.snapshot.observedAt);

  if (
    !previous ||
    previous.sourceKey !== CODEX_USAGE_SOURCE_KEY ||
    previous.limitId !== input.snapshot.limitId ||
    previous.planType !== input.snapshot.planType ||
    previous.windowDurationMins !== input.snapshot.windowDurationMins ||
    typeof previousCount !== "number" ||
    !Number.isSafeInteger(previousCount) ||
    previousCount < 0 ||
    typeof currentCount !== "number" ||
    !Number.isSafeInteger(currentCount) ||
    currentCount <= previousCount ||
    previousTime === null ||
    observedTime === null ||
    observedTime <= previousTime ||
    receivedTime === null ||
    token === null
  ) {
    return null;
  }

  // Protocol-v2 explicitly marks startup baselines and structural plan/window
  // rebases. A count delta observed on either boundary is not grant evidence.
  if (
    input.snapshot.monitorProtocolVersion === 2 &&
    (input.snapshot.postReason === "initial" || input.snapshot.postReason === "structure_change")
  ) {
    return null;
  }

  const observedAt = new Date(observedTime).toISOString();
  return {
    observation_key: `${CODEX_USAGE_SOURCE_KEY}:${input.snapshot.limitId}:${observedAt}`,
    reset_event_key: input.compatibleResetEventKey?.trim() ||
      `banked-reset-${CODEX_USAGE_SOURCE_KEY}-observation-${token}`,
    source_key: CODEX_USAGE_SOURCE_KEY,
    limit_id: input.snapshot.limitId,
    plan_type: input.snapshot.planType,
    previous_observed_at: new Date(previousTime).toISOString(),
    observed_at: observedAt,
    received_at: new Date(receivedTime).toISOString(),
    previous_available_count: previousCount,
    current_available_count: currentCount,
    observation_window_start_at: new Date(previousTime).toISOString(),
    observation_window_end_at: observedAt,
    execution_time_precision: "approximate",
    ...(input.compatibleResetEventKey?.trim()
      ? {
          legacy_identity_status: "legacy_exact" as const,
          legacy_reset_event_key: input.compatibleResetEventKey.trim(),
        }
      : {}),
  };
}

export function buildBankedGrantAssociationWrite(
  association: BankedPostAssociationDecision,
  decidedAt: string,
  expectedRevision = 0,
): CodexUsageAtomicBankedAssociationWrite {
  return {
    observation_key: association.observationKey,
    expected_revision: expectedRevision,
    status: association.status,
    reason: association.reason,
    matcher_version: association.matcherVersion,
    notice_tweet_id: association.noticeTweetId,
    logical_post_id: association.logicalPostId,
    source_tweet_ids: [...association.sourceTweetIds],
    eligible_candidate_ids: [...association.eligibleCandidateIds],
    excluded_candidates: association.excludedCandidates.map((candidate) => ({ ...candidate })),
    decided_at: decidedAt,
    legacy_identity_status: association.legacy_identity_status ?? "resolved",
    legacy_reset_event_key: association.legacy_reset_event_key ?? null,
  };
}
