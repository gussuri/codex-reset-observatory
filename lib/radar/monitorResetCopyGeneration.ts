import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readCodexRecoveryObservationById,
  readResetExecutionEstimateByEventKey,
  readResetExecutionEstimateByRecoveryObservationId,
} from "../codexUsageRecoveryStore";
import { fetchMonitorResetCopySourceRows, buildMonitorConfirmedResetCopyContext } from "./monitorResetCopyLifecycle";
import { ensureResetDisplayNameForEvent } from "./resetDisplayNameStore";
import { ensureResetEventMetadataForEvent } from "./resetEventMetadataStore";
import { RANDOM_RESET_NAME_MODEL } from "./randomResetNaming";

export type MonitorResetCopyGenerationOutcome = {
  status: "generated" | "deferred";
  reason?: string;
  eventKey?: string;
  displayNameStatus?: string;
  metadataStatus?: string;
};

/**
 * Reconstructs copy input only from the estimate, observation, and Tibo rows
 * that have already been persisted. Callers pass an RPC-returned observation
 * identity or canonical event key; an inbound key is never used as the write
 * identity.
 */
export async function generateMonitorResetCopyFromPersistedEvent(
  client: SupabaseClient<any>,
  identity: { recoveryObservationId: string } | { canonicalEventKey: string },
): Promise<MonitorResetCopyGenerationOutcome> {
  const estimateResult = "recoveryObservationId" in identity
    ? await readResetExecutionEstimateByRecoveryObservationId(client, identity.recoveryObservationId)
    : await readResetExecutionEstimateByEventKey(client, identity.canonicalEventKey);
  if (estimateResult.error) return { status: "deferred", reason: "estimate_lookup_failed" };

  const estimate = estimateResult.estimate;
  const eventKey = estimate?.resetEventKey?.trim() || "";
  if (
    !estimate ||
    !eventKey ||
    eventKey === "usage-reset-pending" ||
    !estimate.recoveryObservationId ||
    ("canonicalEventKey" in identity && eventKey !== identity.canonicalEventKey.trim())
  ) {
    return { status: "deferred", reason: "persisted_estimate_unavailable" };
  }

  const recoveryResult = await readCodexRecoveryObservationById(client, estimate.recoveryObservationId);
  if (recoveryResult.error || !recoveryResult.observation) {
    return { status: "deferred", reason: "persisted_recovery_unavailable", eventKey };
  }

  const sourceResult = await fetchMonitorResetCopySourceRows(client, [
    ...estimate.tiboSourceTweetIds,
    ...(estimate.officialNoticeTweetId ? [estimate.officialNoticeTweetId] : []),
  ]);
  if (sourceResult.error) {
    return { status: "deferred", reason: "persisted_source_lookup_failed", eventKey };
  }

  const context = buildMonitorConfirmedResetCopyContext({
    estimate,
    recoveryObservation: recoveryResult.observation,
    sourceRows: sourceResult.rows,
  });
  if (!context) return { status: "deferred", reason: "verified_source_context_unavailable", eventKey };

  const generationOptions = {
    canonicalEventKey: context.evidence.eventKey,
    sourcePostText: context.sourceContext,
    sourceTweetId: context.sourceTweetId,
    monitorEvidence: context.evidence,
    apiKey: process.env.GEMINI_API_KEY?.trim() || null,
    model: RANDOM_RESET_NAME_MODEL,
    timeoutMs: 8_000,
  };
  const displayName = await ensureResetDisplayNameForEvent(context.item, generationOptions);
  const metadata = await ensureResetEventMetadataForEvent(context.item, {
    ...generationOptions,
    supabase: client,
  });
  return {
    status: "generated",
    eventKey: context.evidence.eventKey,
    displayNameStatus: displayName.status,
    metadataStatus: metadata.status,
  };
}
