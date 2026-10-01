import {
  PUBLIC_RANDOM_RESET_EXECUTION_ESTIMATOR_VERSIONS,
  isPublicRandomResetExecutionEstimate,
  type ResetExecutionEstimate,
} from "@/lib/radar/resetExecution";
import {
  MANUAL_EXCLUDED_RECOVERY_OBSERVATION_IDS,
  MANUAL_EXCLUDED_RESET_EVENT_KEYS,
  isExcludedRecoveryObservationId,
  isExcludedResetEventKey,
} from "@/data/resetHistory";
import {
  RESET_MARKER_SCHEMA_VERSION,
  type ResetMarkerPayload,
} from "@/lib/radar/resetMarker";
import type { SupabaseClient } from "@supabase/supabase-js";

export const RESET_MARKER_CACHE_CONTROL = "public, max-age=0, s-maxage=300";
const RESET_MARKER_QUERY_LIMIT = Math.max(
  1,
  MANUAL_EXCLUDED_RESET_EVENT_KEYS.length + MANUAL_EXCLUDED_RECOVERY_OBSERVATION_IDS.length + 1,
);
const RESET_MARKER_COLUMNS = "reset_event_key,display_execution_at,execution_time_source,execution_time_confidence,execution_time_precision,execution_window_start_at,execution_window_end_at,recovery_observation_id,tibo_primary_tweet_id,tibo_source_tweet_ids,official_notice_tweet_id,estimator_version";

type ResetMarkerRow = {
  reset_event_key?: unknown;
  display_execution_at?: unknown;
  execution_time_source?: unknown;
  execution_time_confidence?: unknown;
  execution_time_precision?: unknown;
  execution_window_start_at?: unknown;
  execution_window_end_at?: unknown;
  recovery_observation_id?: unknown;
  tibo_primary_tweet_id?: unknown;
  tibo_source_tweet_ids?: unknown;
  official_notice_tweet_id?: unknown;
  estimator_version?: unknown;
};

function toResetMarker(row: ResetMarkerRow | null | undefined): ResetMarkerPayload {
  const eventKey = typeof row?.reset_event_key === "string" ? row.reset_event_key.trim() : "";
  const estimate: Partial<ResetExecutionEstimate> = {
    displayExecutionAt: typeof row?.display_execution_at === "string" ? row.display_execution_at : undefined,
    executionTimeSource: typeof row?.execution_time_source === "string"
      ? row.execution_time_source as ResetExecutionEstimate["executionTimeSource"]
      : undefined,
    executionTimeConfidence: typeof row?.execution_time_confidence === "string"
      ? row.execution_time_confidence as ResetExecutionEstimate["executionTimeConfidence"]
      : undefined,
    executionTimePrecision: typeof row?.execution_time_precision === "string"
      ? row.execution_time_precision as ResetExecutionEstimate["executionTimePrecision"]
      : undefined,
    executionWindowStartAt: typeof row?.execution_window_start_at === "string" ? row.execution_window_start_at : null,
    executionWindowEndAt: typeof row?.execution_window_end_at === "string" ? row.execution_window_end_at : null,
    recoveryObservationId: typeof row?.recovery_observation_id === "string" ? row.recovery_observation_id : null,
    tiboPrimaryTweetId: typeof row?.tibo_primary_tweet_id === "string" ? row.tibo_primary_tweet_id : null,
    tiboSourceTweetIds: Array.isArray(row?.tibo_source_tweet_ids)
      ? row.tibo_source_tweet_ids.filter((tweetId): tweetId is string => typeof tweetId === "string")
      : [],
    officialNoticeTweetId: typeof row?.official_notice_tweet_id === "string" ? row.official_notice_tweet_id : null,
    estimatorVersion: typeof row?.estimator_version === "string" ? row.estimator_version : undefined,
  };
  if (!eventKey || !isPublicRandomResetExecutionEstimate(estimate)) {
    return {
      schemaVersion: RESET_MARKER_SCHEMA_VERSION,
      marker: null,
      resetAt: null,
    };
  }

  const executionTime = Date.parse(estimate.displayExecutionAt!);
  const resetAt = new Date(executionTime).toISOString();
  return {
    schemaVersion: RESET_MARKER_SCHEMA_VERSION,
    marker: `${eventKey}:${resetAt}`,
    resetAt,
  };
}

export async function readLatestUsageObservationResetMarker(
  client: SupabaseClient<any>,
  now = new Date(),
) {
  const nowIso = now.toISOString();
  const result = await client
    .from("reset_execution_estimates")
    .select(RESET_MARKER_COLUMNS)
    .eq("execution_time_source", "usage_observation")
    .in("estimator_version", [...PUBLIC_RANDOM_RESET_EXECUTION_ESTIMATOR_VERSIONS])
    .eq("execution_time_confidence", "high")
    .eq("execution_time_precision", "approximate")
    .not("execution_window_start_at", "is", null)
    .not("execution_window_end_at", "is", null)
    .not("recovery_observation_id", "is", null)
    .lte("display_execution_at", nowIso)
    .order("display_execution_at", { ascending: false })
    .limit(RESET_MARKER_QUERY_LIMIT);

  if (result.error) {
    return { marker: null, error: result.error };
  }

  const rows = Array.isArray(result.data)
    ? result.data as ResetMarkerRow[]
    : result.data
      ? [result.data as ResetMarkerRow]
      : [];
  const latestNonExcludedRow = rows.find((row) =>
    !isExcludedResetEventKey(typeof row.reset_event_key === "string" ? row.reset_event_key : null) &&
    !isExcludedRecoveryObservationId(
      typeof row.recovery_observation_id === "string" ? row.recovery_observation_id : null,
    )
  );

  return { marker: toResetMarker(latestNonExcludedRow), error: null };
}
