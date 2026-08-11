import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CODEX_USAGE_SOURCE_KEY,
  getPublicRecoveryObservation,
  type CodexRecoveryObservation,
  type CodexUsageSnapshot,
} from "./codexUsageRecovery";

export type CodexUsageMonitorStateRow = {
  source_key: string;
  observed_at: string;
  received_at: string;
  limit_id: string;
  plan_type: string;
  used_percent: number;
  window_duration_mins: number;
  resets_at: number;
  updated_at: string;
};

export type CodexRecoveryObservationRow = {
  id: string;
  source_key: string;
  observed_at: string;
  previous_used_percent: number;
  current_used_percent: number;
  previous_resets_at: number;
  current_resets_at: number;
  cycle_hint: "regular" | "unexpected" | "unknown";
  confidence: "strong" | "medium";
  status: "observed" | "confirmed" | "rejected";
  matched_tibo_tweet_id: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

const STATE_COLUMNS = "source_key,observed_at,received_at,limit_id,plan_type,used_percent,window_duration_mins,resets_at,updated_at";
const OBSERVATION_COLUMNS = "id,source_key,observed_at,previous_used_percent,current_used_percent,previous_resets_at,current_resets_at,cycle_hint,confidence,status,matched_tibo_tweet_id,confirmed_at,created_at,updated_at";

export function toCodexUsageSnapshot(row: CodexUsageMonitorStateRow | null | undefined): CodexUsageSnapshot | null {
  if (!row || row.source_key !== CODEX_USAGE_SOURCE_KEY || row.limit_id !== "codex") return null;
  if (row.window_duration_mins !== 10080 || !Number.isFinite(row.used_percent) || !Number.isInteger(row.resets_at)) return null;
  return {
    observedAt: row.observed_at,
    limitId: "codex",
    planType: row.plan_type,
    usedPercent: row.used_percent,
    windowDurationMins: 10080,
    resetsAt: row.resets_at,
  };
}

export function toCodexRecoveryObservation(row: CodexRecoveryObservationRow | null | undefined): CodexRecoveryObservation | null {
  if (!row || row.source_key !== CODEX_USAGE_SOURCE_KEY) return null;
  if (![
    "regular",
    "unexpected",
    "unknown",
  ].includes(row.cycle_hint)) return null;
  if (!(row.confidence === "strong" || row.confidence === "medium")) return null;
  if (!(row.status === "observed" || row.status === "confirmed" || row.status === "rejected")) return null;
  return {
    id: row.id,
    sourceKey: row.source_key,
    observedAt: row.observed_at,
    previousUsedPercent: row.previous_used_percent,
    currentUsedPercent: row.current_used_percent,
    previousResetsAt: row.previous_resets_at,
    currentResetsAt: row.current_resets_at,
    cycleHint: row.cycle_hint,
    confidence: row.confidence,
    status: row.status,
    matchedTiboTweetId: row.matched_tibo_tweet_id,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function readCodexUsageMonitorState(client: SupabaseClient<any>) {
  const result = await client
    .from("codex_usage_monitor_state")
    .select(STATE_COLUMNS)
    .eq("source_key", CODEX_USAGE_SOURCE_KEY)
    .maybeSingle();
  return {
    row: toCodexUsageSnapshot(result.data as CodexUsageMonitorStateRow | null),
    error: result.error,
  };
}

export async function upsertCodexUsageMonitorState(
  client: SupabaseClient<any>,
  snapshot: CodexUsageSnapshot,
  receivedAt: string,
) {
  const result = await client
    .from("codex_usage_monitor_state")
    .upsert({
      source_key: CODEX_USAGE_SOURCE_KEY,
      observed_at: snapshot.observedAt,
      received_at: receivedAt,
      limit_id: snapshot.limitId,
      plan_type: snapshot.planType,
      used_percent: snapshot.usedPercent,
      window_duration_mins: snapshot.windowDurationMins,
      resets_at: snapshot.resetsAt,
      updated_at: receivedAt,
    }, { onConflict: "source_key" });
  return result.error;
}

export async function insertCodexRecoveryObservation(
  client: SupabaseClient<any>,
  observation: Omit<CodexRecoveryObservation, "id" | "createdAt" | "updatedAt">,
) {
  const result = await client
    .from("codex_recovery_observations")
    .upsert({
      source_key: observation.sourceKey,
      observed_at: observation.observedAt,
      previous_used_percent: observation.previousUsedPercent,
      current_used_percent: observation.currentUsedPercent,
      previous_resets_at: observation.previousResetsAt,
      current_resets_at: observation.currentResetsAt,
      cycle_hint: observation.cycleHint,
      confidence: observation.confidence,
      status: observation.status,
      matched_tibo_tweet_id: observation.matchedTiboTweetId ?? null,
      confirmed_at: observation.confirmedAt ?? null,
      updated_at: observation.confirmedAt ?? observation.observedAt,
    }, { onConflict: "source_key,observed_at,current_resets_at" });
  return result.error;
}

export async function findRecentFormalTiboReset(
  client: SupabaseClient<any>,
  observedAt: string,
  matchWindowMs: number,
) {
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time)) return { tweetId: null, error: null };

  const result = await client
    .from("tibo_signals")
    .select("tweet_id,tweet_created_at,signal_type,confidence,verification_status,is_reply")
    .eq("signal_type", "reset_executed")
    .eq("is_reply", false)
    .neq("verification_status", "rejected")
    .gte("tweet_created_at", new Date(time - matchWindowMs).toISOString())
    .lte("tweet_created_at", new Date(time + matchWindowMs).toISOString())
    .order("tweet_created_at", { ascending: true })
    .limit(20);

  if (result.error) return { tweetId: null, error: result.error };

  const candidates = (result.data ?? [])
    .filter((row) => typeof row.tweet_id === "string" && typeof row.tweet_created_at === "string" && Number(row.confidence) >= 0.95)
    .sort((left, right) => Math.abs(Date.parse(left.tweet_created_at) - time) - Math.abs(Date.parse(right.tweet_created_at) - time));
  return { tweetId: candidates[0]?.tweet_id ?? null, error: null };
}

export async function confirmNearestCodexRecoveryObservation(
  client: SupabaseClient<any>,
  tiboTweetId: string,
  tiboTweetCreatedAt: string,
  matchWindowMs: number,
  confirmedAt: string,
) {
  const time = Date.parse(tiboTweetCreatedAt);
  if (!Number.isFinite(time)) return { matched: false, error: null };

  const result = await client
    .from("codex_recovery_observations")
    .select(OBSERVATION_COLUMNS)
    .eq("source_key", CODEX_USAGE_SOURCE_KEY)
    .eq("status", "observed")
    .neq("cycle_hint", "regular")
    .gte("observed_at", new Date(time - matchWindowMs).toISOString())
    .lte("observed_at", new Date(time + matchWindowMs).toISOString())
    .order("observed_at", { ascending: true })
    .limit(20);

  if (result.error) return { matched: false, error: result.error };

  const candidates = (result.data ?? [])
    .map((row) => toCodexRecoveryObservation(row as CodexRecoveryObservationRow))
    .filter((row): row is CodexRecoveryObservation => Boolean(row && (row.confidence === "strong" || row.confidence === "medium")))
    .sort((left, right) => Math.abs(Date.parse(left.observedAt) - time) - Math.abs(Date.parse(right.observedAt) - time));
  const nearest = candidates[0];
  if (!nearest?.id) return { matched: false, error: null };

  const update = await client
    .from("codex_recovery_observations")
    .update({
      status: "confirmed",
      matched_tibo_tweet_id: tiboTweetId,
      confirmed_at: confirmedAt,
      updated_at: confirmedAt,
    })
    .eq("id", nearest.id)
    .eq("status", "observed");
  return { matched: !update.error, error: update.error };
}

export async function fetchPublicCodexRecoveryObservation(
  client: SupabaseClient<any>,
  now: Date,
) {
  const result = await client
    .from("codex_recovery_observations")
    .select(OBSERVATION_COLUMNS)
    .eq("source_key", CODEX_USAGE_SOURCE_KEY)
    .eq("status", "observed")
    .eq("confidence", "strong")
    .neq("cycle_hint", "regular")
    .order("observed_at", { ascending: false })
    .limit(20);

  if (result.error) return { data: null, error: result.error };

  for (const row of result.data ?? []) {
    const observation = toCodexRecoveryObservation(row as CodexRecoveryObservationRow);
    const publicObservation = getPublicRecoveryObservation(observation, now);
    if (publicObservation) return { data: publicObservation, error: null };
  }

  return { data: null, error: null };
}

export async function readCodexRecoveryObservations(client: SupabaseClient<any>) {
  const result = await client
    .from("codex_recovery_observations")
    .select(OBSERVATION_COLUMNS)
    .eq("source_key", CODEX_USAGE_SOURCE_KEY)
    .eq("status", "observed")
    .eq("confidence", "strong")
    .neq("cycle_hint", "regular")
    .order("observed_at", { ascending: false })
    .limit(20);

  return {
    rows: (result.data ?? [])
      .map((row) => toCodexRecoveryObservation(row as CodexRecoveryObservationRow))
      .filter((row): row is CodexRecoveryObservation => Boolean(row)),
    error: result.error,
  };
}
