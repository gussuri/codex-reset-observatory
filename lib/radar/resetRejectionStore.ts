import { revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REJECTED_RESET_EXECUTION_ESTIMATOR_VERSION,
  isPublicRandomResetExecutionEstimate,
  isRejectedResetExecutionEstimate,
} from "./resetExecution";
export { REJECTED_RESET_EXECUTION_ESTIMATOR_VERSION };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResetRejectionInput = {
  eventKey: string;
  reason: string;
  by?: string | null;
};

export type ValidatedResetRejectionInput = {
  eventKey: string;
  reason: string;
  by: string;
};

export type TargetEstimateInfo = {
  resetEventKey: string;
  displayExecutionAt: string;
  executionTimeSource: string;
  executionTimeConfidence: string;
  executionTimePrecision: string;
  estimatorVersion: string;
  recoveryObservationId: string | null;
  manualOverrideAt: string | null;
  manualOverrideBy: string | null;
  manualOverrideReason: string | null;
  isPublicEstimate: boolean;
  isAlreadyRejected: boolean;
};

export type TargetObservationInfo = {
  id: string;
  status: string;
  observedAt: string;
  confidence: string;
  cycleHint: string;
  isAlreadyRejected: boolean;
};

export type ResetRejectionTarget = {
  eventKey: string;
  canonicalEventKey: string;
  targetEstimate: TargetEstimateInfo | null;
  targetObservation: TargetObservationInfo | null;
  overallStatus: "active" | "already_rejected";
  summary: {
    displayExecutionAt: string | null;
    executionTimeSource: string | null;
    currentConfidence: string | null;
    estimatorVersion: string | null;
    observationStatus: string | null;
    isPublicEstimate: boolean;
    probabilityEligibilityImpact: string;
  };
};

export type ResetRejectionResult = {
  status: "applied" | "dry_run" | "already_rejected" | "not_found";
  eventKey: string;
  apply: boolean;
  target: ResetRejectionTarget | null;
  audit: {
    rejectedAt: string;
    rejectedBy: string;
    rejectionReason: string;
  } | null;
  proposedMutation: {
    resetExecutionEstimates?: {
      match: { reset_event_key: string };
      update: Record<string, unknown>;
    };
    codexRecoveryObservations?: {
      match: { id: string };
      update: Record<string, unknown>;
    };
  } | null;
  appliedMutation?: {
    resetExecutionEstimates?: Record<string, unknown>;
    codexRecoveryObservations?: Record<string, unknown>;
  } | null;
  cacheInvalidation: {
    tag: string;
    revalidated: boolean;
    reason?: string;
  };
  message: string;
};

export function validateResetRejectionInput(
  input: ResetRejectionInput,
): ValidatedResetRejectionInput {
  const eventKey = typeof input.eventKey === "string" ? input.eventKey.trim() : "";
  if (!eventKey) {
    throw new Error("--event-key is required and cannot be empty.");
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    throw new Error("--reason is required and cannot be empty.");
  }

  const by = typeof input.by === "string" && input.by.trim() ? input.by.trim() : "operator";

  return { eventKey, reason, by };
}

export function extractObservationUuid(eventKey: string): string | null {
  const trimmed = eventKey.trim();
  if (UUID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("usage-reset-")) {
    const candidate = trimmed.slice("usage-reset-".length);
    if (UUID_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function findResetRejectionTarget(
  client: SupabaseClient<any>,
  inputKey: string,
): Promise<{
  estimateRow: any | null;
  observationRow: any | null;
  target: ResetRejectionTarget;
} | null> {
  const trimmedKey = inputKey.trim();
  let estimateRow: any | null = null;
  let observationRow: any | null = null;

  // 1. Try finding by exact reset_event_key
  const { data: byExactKey, error: exactError } = await client
    .from("reset_execution_estimates")
    .select("*")
    .eq("reset_event_key", trimmedKey)
    .maybeSingle();

  if (!exactError && byExactKey) {
    estimateRow = byExactKey;
  }

  // 2. If not found and key does not start with usage-reset-, try usage-reset-<key>
  if (!estimateRow && !trimmedKey.startsWith("usage-reset-")) {
    const prefixedKey = `usage-reset-${trimmedKey}`;
    const { data: byPrefixedKey, error: prefixError } = await client
      .from("reset_execution_estimates")
      .select("*")
      .eq("reset_event_key", prefixedKey)
      .maybeSingle();

    if (!prefixError && byPrefixedKey) {
      estimateRow = byPrefixedKey;
    }
  }

  // 3. If still not found and input looks like a UUID, try recovery_observation_id
  const observationUuid = extractObservationUuid(trimmedKey);
  if (!estimateRow && observationUuid) {
    const { data: byObsId, error: obsError } = await client
      .from("reset_execution_estimates")
      .select("*")
      .eq("recovery_observation_id", observationUuid)
      .maybeSingle();

    if (!obsError && byObsId) {
      estimateRow = byObsId;
    }
  }

  // 4. Find matching observation row if UUID is available
  const targetObsId = estimateRow?.recovery_observation_id || observationUuid;
  if (targetObsId && UUID_PATTERN.test(targetObsId)) {
    const { data: obsData, error: obsLookupError } = await client
      .from("codex_recovery_observations")
      .select("*")
      .eq("id", targetObsId)
      .maybeSingle();

    if (!obsLookupError && obsData) {
      observationRow = obsData;
    }
  }

  // If neither estimate nor observation found, return null
  if (!estimateRow && !observationRow) {
    return null;
  }

  const canonicalEventKey = estimateRow?.reset_event_key || (observationRow ? `usage-reset-${observationRow.id}` : trimmedKey);

  const targetEstimate: TargetEstimateInfo | null = estimateRow
    ? {
        resetEventKey: estimateRow.reset_event_key,
        displayExecutionAt: estimateRow.display_execution_at,
        executionTimeSource: estimateRow.execution_time_source,
        executionTimeConfidence: estimateRow.execution_time_confidence,
        executionTimePrecision: estimateRow.execution_time_precision,
        estimatorVersion: estimateRow.estimator_version,
        recoveryObservationId: estimateRow.recovery_observation_id ?? null,
        manualOverrideAt: estimateRow.manual_override_at ?? null,
        manualOverrideBy: estimateRow.manual_override_by ?? null,
        manualOverrideReason: estimateRow.manual_override_reason ?? null,
        isPublicEstimate: isPublicRandomResetExecutionEstimate({
          displayExecutionAt: estimateRow.display_execution_at,
          executionTimeSource: estimateRow.execution_time_source,
          executionTimeConfidence: estimateRow.execution_time_confidence,
          executionTimePrecision: estimateRow.execution_time_precision,
          executionWindowStartAt: estimateRow.execution_window_start_at,
          executionWindowEndAt: estimateRow.execution_window_end_at,
          recoveryObservationId: estimateRow.recovery_observation_id,
          officialNoticeTweetId: estimateRow.official_notice_tweet_id,
          tiboPrimaryTweetId: estimateRow.tibo_primary_tweet_id,
          tiboSourceTweetIds: estimateRow.tibo_source_tweet_ids ?? [],
          estimatorVersion: estimateRow.estimator_version,
        }),
        isAlreadyRejected: isRejectedResetExecutionEstimate({
          estimatorVersion: estimateRow.estimator_version,
        }),
      }
    : null;

  const targetObservation: TargetObservationInfo | null = observationRow
    ? {
        id: observationRow.id,
        status: observationRow.status,
        observedAt: observationRow.observedAt ?? observationRow.observed_at,
        confidence: observationRow.confidence,
        cycleHint: observationRow.cycleHint ?? observationRow.cycle_hint,
        isAlreadyRejected: observationRow.status === "rejected",
      }
    : null;

  const estimateAlreadyRejected = targetEstimate ? targetEstimate.isAlreadyRejected : true;
  const observationAlreadyRejected = targetObservation ? targetObservation.isAlreadyRejected : true;
  const overallStatus = estimateAlreadyRejected && observationAlreadyRejected
    ? "already_rejected"
    : "active";

  const target: ResetRejectionTarget = {
    eventKey: trimmedKey,
    canonicalEventKey,
    targetEstimate,
    targetObservation,
    overallStatus,
    summary: {
      displayExecutionAt: targetEstimate?.displayExecutionAt ?? targetObservation?.observedAt ?? null,
      executionTimeSource: targetEstimate?.executionTimeSource ?? "usage_observation",
      currentConfidence: targetEstimate?.executionTimeConfidence ?? targetObservation?.confidence ?? null,
      estimatorVersion: targetEstimate?.estimatorVersion ?? null,
      observationStatus: targetObservation?.status ?? null,
      isPublicEstimate: targetEstimate?.isPublicEstimate ?? false,
      probabilityEligibilityImpact: overallStatus === "already_rejected"
        ? "Already rejected: completely excluded from public history, lastRandomResetAt, and probability clock."
        : targetEstimate?.isPublicEstimate
          ? "Currently active public estimate: rejection will disqualify it from public history, lastRandomResetAt, and probability clock."
          : "Internal estimate / observation: rejection will prevent promotion to public history and mark observation rejected.",
    },
  };

  return { estimateRow, observationRow, target };
}

export function invalidateRadarCache(
  revalidateFn: (tag: string) => void = revalidateTag,
): { tag: string; revalidated: boolean; reason?: string } {
  try {
    revalidateFn("radar-data");
    return { tag: "radar-data", revalidated: true };
  } catch (error) {
    return {
      tag: "radar-data",
      revalidated: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function applyResetRejection(
  client: SupabaseClient<any>,
  rawInput: ResetRejectionInput,
  options: {
    apply?: boolean;
    now?: Date;
    invalidateCache?: () => { tag: string; revalidated: boolean; reason?: string };
  } = {},
): Promise<ResetRejectionResult> {
  const input = validateResetRejectionInput(rawInput);
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const found = await findResetRejectionTarget(client, input.eventKey);
  if (!found) {
    return {
      status: "not_found",
      eventKey: input.eventKey,
      apply: options.apply === true,
      target: null,
      audit: null,
      proposedMutation: null,
      appliedMutation: null,
      cacheInvalidation: { tag: "radar-data", revalidated: false, reason: "target_not_found" },
      message: `No matching reset execution estimate or recovery observation found for event key: ${input.eventKey}`,
    };
  }

  const { estimateRow, observationRow, target } = found;

  const proposedEstimateUpdate = estimateRow
    ? {
        estimator_version: REJECTED_RESET_EXECUTION_ESTIMATOR_VERSION,
        execution_time_confidence: "low",
        manual_override_at: nowIso,
        manual_override_by: input.by,
        manual_override_reason: input.reason,
        updated_at: nowIso,
      }
    : undefined;

  const proposedObservationUpdate = observationRow
    ? {
        status: "rejected",
        updated_at: nowIso,
      }
    : undefined;

  const proposedMutation = {
    ...(proposedEstimateUpdate && estimateRow
      ? {
          resetExecutionEstimates: {
            match: { reset_event_key: estimateRow.reset_event_key },
            update: proposedEstimateUpdate,
          },
        }
      : {}),
    ...(proposedObservationUpdate && observationRow
      ? {
          codexRecoveryObservations: {
            match: { id: observationRow.id },
            update: proposedObservationUpdate,
          },
        }
      : {}),
  };

  const audit = {
    rejectedAt: nowIso,
    rejectedBy: input.by,
    rejectionReason: input.reason,
  };

  // Idempotency check: if already rejected, do not re-apply
  if (target.overallStatus === "already_rejected") {
    return {
      status: "already_rejected",
      eventKey: input.eventKey,
      apply: options.apply === true,
      target,
      audit: {
        rejectedAt: target.targetEstimate?.manualOverrideAt ?? target.targetObservation?.observedAt ?? nowIso,
        rejectedBy: target.targetEstimate?.manualOverrideBy ?? "operator",
        rejectionReason: target.targetEstimate?.manualOverrideReason ?? "Already rejected",
      },
      proposedMutation: null,
      appliedMutation: null,
      cacheInvalidation: { tag: "radar-data", revalidated: false, reason: "already_rejected" },
      message: `Reset event '${target.canonicalEventKey}' is already logically rejected. No database changes were made.`,
    };
  }

  // Dry-run mode: return plan without executing mutations
  if (!options.apply) {
    return {
      status: "dry_run",
      eventKey: input.eventKey,
      apply: false,
      target,
      audit,
      proposedMutation,
      appliedMutation: null,
      cacheInvalidation: {
        tag: "radar-data",
        revalidated: false,
        reason: "dry_run (would execute revalidateTag('radar-data') on --apply)",
      },
      message: `Dry-run completed for '${target.canonicalEventKey}'. No changes were written to the database. Re-run with --apply to execute.`,
    };
  }

  // Real apply mode: execute updates
  const appliedMutation: {
    resetExecutionEstimates?: Record<string, unknown>;
    codexRecoveryObservations?: Record<string, unknown>;
  } = {};

  if (proposedEstimateUpdate && estimateRow) {
    const { error: estimateUpdateError } = await client
      .from("reset_execution_estimates")
      .update(proposedEstimateUpdate)
      .eq("reset_event_key", estimateRow.reset_event_key);

    if (estimateUpdateError) {
      throw new Error(`Failed to update reset_execution_estimates: ${estimateUpdateError.message}`);
    }
    appliedMutation.resetExecutionEstimates = proposedEstimateUpdate;
  }

  if (proposedObservationUpdate && observationRow) {
    const { error: obsUpdateError } = await client
      .from("codex_recovery_observations")
      .update(proposedObservationUpdate)
      .eq("id", observationRow.id);

    if (obsUpdateError) {
      throw new Error(`Failed to update codex_recovery_observations: ${obsUpdateError.message}`);
    }
    appliedMutation.codexRecoveryObservations = proposedObservationUpdate;
  }

  // Cache invalidation
  const invalidationResult = options.invalidateCache
    ? options.invalidateCache()
    : invalidateRadarCache();

  return {
    status: "applied",
    eventKey: input.eventKey,
    apply: true,
    target: {
      ...target,
      overallStatus: "already_rejected",
    },
    audit,
    proposedMutation,
    appliedMutation,
    cacheInvalidation: invalidationResult,
    message: `Successfully logically rejected '${target.canonicalEventKey}'. Related recovery observation marked 'rejected', estimator version set to '${REJECTED_RESET_EXECUTION_ESTIMATOR_VERSION}', and cache invalidated.`,
  };
}
