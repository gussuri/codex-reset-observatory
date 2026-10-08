import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { applyCodexUsageBankedAssociation, buildBankedDistributionEstimateWrite } from "./codexUsageAtomic";
import {
  buildBankedGrantAssociationWrite,
  type CodexUsageAtomicBankedObservationWrite,
} from "./codexUsageBankedGrant";
import { findBankedEstimateByExactObservation } from "./codexUsageRecoveryStore";
import type { ActiveTiboSignal } from "./radar/types";
import { getTrustedTiboEditIdentity } from "./radar/tiboEditIdentity";
import {
  resolveBankedAssociation,
} from "./codexUsageBankedAssociation";
import type { BankedPostAssociationDecision } from "./radar/resetPostAssociation";
import type { BankedDistributionEstimateInput } from "./codexUsageRecoveryStore";
import { invalidateRadarCache } from "./radar/cacheInvalidation";

const RECONCILIATION_TIBO_SELECT = [
  "tweet_id", "signal_type", "text", "tweet_url", "tweet_created_at", "detected_at",
  "expires_at", "verification_status", "confidence", "classification_source",
  "is_reply", "is_quote", "temporal_expression", "temporal_kind", "temporal_precision",
  "temporal_timezone", "temporal_confidence", "expected_start_at", "expected_end_at",
  "temporal_resolution_status", "logical_post_id", "edit_history_tweet_ids", "edit_version",
  "edit_metadata_source",
].join(",");

const TIBO_ASSOCIATION_PAGE_SIZE = 500;
const TIBO_ASSOCIATION_MAX_PAGES = 10;
const MAX_TIBO_EDIT_CHAIN_ROWS = 5000;
const TIBO_EDIT_CHAIN_PAGE_SIZE = 500;

function getReconciliationServiceClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("BANKED association reconciliation configuration unavailable");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

function parseDueObservation(value: unknown): BankedGrantAssociationReconciliationObservation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const stringFields = [
    "observation_key", "reset_event_key", "source_key", "limit_id", "plan_type",
    "previous_observed_at", "observed_at", "received_at", "observation_window_start_at",
    "observation_window_end_at",
  ];
  if (stringFields.some((field) => typeof row[field] !== "string")) return null;
  if (
    typeof row.previous_available_count !== "number" ||
    typeof row.current_available_count !== "number" ||
    !Number.isInteger(row.current_revision) ||
    !(row.current_decision_source === null || row.current_decision_source === "automatic" || row.current_decision_source === "manual")
  ) return null;
  const identityStatus = row.legacy_identity_status;
  if (identityStatus !== "resolved" && identityStatus !== "unresolved" && identityStatus !== "legacy_exact") return null;
  const candidateIds = Array.isArray(row.current_eligible_candidate_ids)
    ? row.current_eligible_candidate_ids.filter((id): id is string => typeof id === "string")
    : [];
  return {
    observation_key: row.observation_key as string,
    reset_event_key: row.reset_event_key as string,
    source_key: row.source_key as CodexUsageAtomicBankedObservationWrite["source_key"],
    limit_id: row.limit_id as CodexUsageAtomicBankedObservationWrite["limit_id"],
    plan_type: row.plan_type as string,
    previous_observed_at: row.previous_observed_at as string,
    observed_at: row.observed_at as string,
    received_at: row.received_at as string,
    previous_available_count: row.previous_available_count as number,
    current_available_count: row.current_available_count as number,
    observation_window_start_at: row.observation_window_start_at as string,
    observation_window_end_at: row.observation_window_end_at as string,
    execution_time_precision: "approximate",
    legacy_identity_status: identityStatus,
    legacy_reset_event_key: typeof row.legacy_reset_event_key === "string" ? row.legacy_reset_event_key : null,
    current_revision: row.current_revision as number,
    current_decision_source: row.current_decision_source as BankedGrantAssociationReconciliationObservation["current_decision_source"],
    current_notice_tweet_id: typeof row.current_notice_tweet_id === "string" ? row.current_notice_tweet_id : null,
    current_logical_post_id: typeof row.current_logical_post_id === "string" ? row.current_logical_post_id : null,
    current_eligible_candidate_ids: candidateIds,
  };
}

function parseTiboSignal(value: unknown): ActiveTiboSignal | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.tweet_id !== "string" ||
    typeof row.tweet_created_at !== "string" ||
    !(row.signal_type === "official_notice" || row.signal_type === "reset_executed" ||
      row.signal_type === "teaser" || row.signal_type === "irrelevant")
  ) return null;
  return {
    ...(row as unknown as ActiveTiboSignal),
    tweet_id: row.tweet_id,
    tweet_created_at: row.tweet_created_at,
    signal_type: row.signal_type as ActiveTiboSignal["signal_type"],
    text: typeof row.text === "string" ? row.text : "",
    expires_at: typeof row.expires_at === "string" ? row.expires_at : undefined,
    confidence: typeof row.confidence === "number" ? row.confidence : undefined,
    is_reply: row.is_reply === true,
    is_quote: row.is_quote === true,
  };
}

export function createBankedGrantAssociationReconciliationDependencies(
  client: SupabaseClient<any>,
): BankedGrantAssociationReconciliationDependencies {
  return {
    async listDue(now, limit) {
      const response = await client.rpc("list_banked_grant_observations_for_reconciliation", {
        p_now: now.toISOString(),
        p_limit: limit,
      });
      if (response.error) return { observations: [], hasMore: true, error: response.error };
      const rows = Array.isArray(response.data) ? response.data : [];
      const observations = rows
        .map(parseDueObservation)
        .filter((row): row is BankedGrantAssociationReconciliationObservation => row !== null);
      const malformedRows = rows.length - observations.length;
      return {
        observations,
        hasMore: rows.some((row) => Boolean((row as Record<string, unknown>).has_more)),
        ...(malformedRows > 0 ? { error: new Error("Malformed BANKED reconciliation candidate") } : {}),
      };
    },
    async resolveLegacyIdentity(observation) {
      const lookup = await findBankedEstimateByExactObservation(client, observation.observed_at);
      if (lookup.error) return { status: "unresolved", error: lookup.error };
      if (lookup.estimate?.resetEventKey) {
        return { status: "legacy_exact", legacyResetEventKey: lookup.estimate.resetEventKey };
      }
      return { status: "resolved" };
    },
    async loadSignals(observations) {
      const observedTimes = observations.map((observation) => Date.parse(observation.observed_at));
      if (observedTimes.some((time) => !Number.isFinite(time))) {
        return { signals: [], error: new Error("Invalid BANKED observation timestamp") };
      }
      const earliestObservedAt = new Date(Math.min(...observedTimes)).toISOString();
      const latestObservedAt = new Date(Math.max(...observedTimes)).toISOString();
      const roots: unknown[] = [];
      let cursor: { tweet_created_at: string; tweet_id: string } | null = null;
      let complete = false;
      for (let page = 0; page < TIBO_ASSOCIATION_MAX_PAGES; page += 1) {
        let query = client
          .from("tibo_signals")
          .select(RECONCILIATION_TIBO_SELECT)
          .eq("signal_type", "official_notice")
          .gte("expires_at", earliestObservedAt)
          .lte("tweet_created_at", latestObservedAt)
          .order("tweet_created_at", { ascending: true })
          .order("tweet_id", { ascending: true })
          .limit(TIBO_ASSOCIATION_PAGE_SIZE);
        if (cursor) {
          query = query.or(
            `tweet_created_at.gt.${cursor.tweet_created_at},and(tweet_created_at.eq.${cursor.tweet_created_at},tweet_id.gt.${cursor.tweet_id})`,
          );
        }
        const response = await query;
        if (response.error) return { signals: [], error: response.error };
        const pageRows: unknown[] = Array.isArray(response.data) ? response.data : [];
        roots.push(...pageRows);
        if (pageRows.length < TIBO_ASSOCIATION_PAGE_SIZE) {
          complete = true;
          break;
        }
        const last = pageRows[pageRows.length - 1] as Record<string, unknown> | undefined;
        if (typeof last?.tweet_created_at !== "string" || typeof last.tweet_id !== "string") {
          return { signals: [], error: new Error("Malformed Tibo association page cursor") };
        }
        cursor = { tweet_created_at: last.tweet_created_at, tweet_id: last.tweet_id };
      }
      if (!complete) {
        // Never publish from a truncated candidate set: unseen claims could
        // make an otherwise unique association ambiguous.
        return { signals: [], error: new Error("Tibo association candidate read is incomplete") };
      }

      const rootSignals = roots
        .map(parseTiboSignal)
        .filter((signal): signal is ActiveTiboSignal => signal !== null);
      const chainIds = new Set<string>();
      const logicalPostIds = new Set<string>();
      for (const signal of rootSignals) {
        if (signal.edit_metadata_source === "x_api") {
          for (const id of signal.edit_history_tweet_ids ?? []) chainIds.add(id);
        }
        const identity = getTrustedTiboEditIdentity(signal, signal.tweet_id);
        if (!identity) continue;
        logicalPostIds.add(identity.logical_post_id);
      }
      for (const observation of observations) {
        if (observation.current_notice_tweet_id) chainIds.add(observation.current_notice_tweet_id);
        for (const id of observation.current_eligible_candidate_ids ?? []) chainIds.add(id);
      }
      if (chainIds.size > MAX_TIBO_EDIT_CHAIN_ROWS) {
        return { signals: [], error: new Error("Tibo edit-chain candidate read is incomplete") };
      }
      const foundIds = new Set(rootSignals.map((signal) => signal.tweet_id));
      const missingChainIds = Array.from(chainIds).filter((id) => !foundIds.has(id));
      const expandedRows: unknown[] = [...roots];
      for (let offset = 0; offset < missingChainIds.length; offset += 100) {
        const idBatch = missingChainIds.slice(offset, offset + 100);
        const response = await client
          .from("tibo_signals")
          .select(RECONCILIATION_TIBO_SELECT)
          .in("tweet_id", idBatch);
        if (response.error) return { signals: [], error: response.error };
        expandedRows.push(...(response.data ?? []));
      }
      const knownSignals = expandedRows
        .map(parseTiboSignal)
        .filter((signal): signal is ActiveTiboSignal => signal !== null);
      for (const signal of knownSignals) {
        const identity = getTrustedTiboEditIdentity(signal, signal.tweet_id);
        if (identity) logicalPostIds.add(identity.logical_post_id);
      }

      const logicalIds = Array.from(logicalPostIds);
      if (logicalIds.length > MAX_TIBO_EDIT_CHAIN_ROWS) {
        return { signals: [], error: new Error("Tibo logical-post candidate read is incomplete") };
      }
      let editChainRowCount = 0;
      for (let batchOffset = 0; batchOffset < logicalIds.length; batchOffset += 100) {
        const logicalIdBatch = logicalIds.slice(batchOffset, batchOffset + 100);
        for (let offset = 0; offset <= MAX_TIBO_EDIT_CHAIN_ROWS; offset += TIBO_EDIT_CHAIN_PAGE_SIZE) {
          const response = await client
            .from("tibo_signals")
            .select(RECONCILIATION_TIBO_SELECT)
            .in("logical_post_id", logicalIdBatch)
            .order("tweet_id", { ascending: true })
            .range(offset, offset + TIBO_EDIT_CHAIN_PAGE_SIZE - 1);
          if (response.error) return { signals: [], error: response.error };
          const pageRows: unknown[] = Array.isArray(response.data) ? response.data : [];
          if (pageRows.length > 0 && offset >= MAX_TIBO_EDIT_CHAIN_ROWS) {
            return { signals: [], error: new Error("Tibo edit-chain candidate read is incomplete") };
          }
          editChainRowCount += pageRows.length;
          if (editChainRowCount > MAX_TIBO_EDIT_CHAIN_ROWS) {
            return { signals: [], error: new Error("Tibo edit-chain candidate read is incomplete") };
          }
          expandedRows.push(...pageRows);
          if (pageRows.length < TIBO_EDIT_CHAIN_PAGE_SIZE) break;
        }
      }
      const deduplicated = new Map<string, ActiveTiboSignal>();
      for (const value of expandedRows) {
        const signal = parseTiboSignal(value);
        if (signal) deduplicated.set(signal.tweet_id, signal);
      }
      return { signals: Array.from(deduplicated.values()) };
    },
    async persist(observation, decision, estimate, expectedRevision, decidedAt) {
      const associationWrite = buildBankedGrantAssociationWrite(
        { ...decision, observationKey: observation.observation_key },
        decidedAt,
        expectedRevision,
      );
      const response = await applyCodexUsageBankedAssociation(
        client,
        associationWrite,
        estimate ? buildBankedDistributionEstimateWrite(estimate) : null,
      );
      return {
        status: response.status,
        publicationChanged: response.publicationChanged,
        error: response.error,
      };
    },
    invalidate: () => invalidateRadarCache("tibo-event"),
  };
}

export async function reconcileCodexUsageBankedGrantAssociations(
  options: { now?: Date; batchSize?: number; maxBatches?: number } = {},
) {
  const client = getReconciliationServiceClient();
  return runBankedGrantAssociationReconciliation(
    createBankedGrantAssociationReconciliationDependencies(client),
    options,
  );
}

export type BankedGrantAssociationReconciliationObservation = CodexUsageAtomicBankedObservationWrite & {
  current_revision: number;
  current_decision_source: "automatic" | "manual" | null;
  current_notice_tweet_id?: string | null;
  current_logical_post_id?: string | null;
  current_eligible_candidate_ids?: string[];
};

export type BankedGrantLegacyIdentityResolution = {
  status: "resolved" | "unresolved" | "legacy_exact";
  legacyResetEventKey?: string | null;
  error?: unknown;
};

export type BankedGrantAssociationReconciliationDependencies = {
  listDue: (
    now: Date,
    limit: number,
  ) => Promise<{
    observations: BankedGrantAssociationReconciliationObservation[];
    hasMore: boolean;
    error?: unknown;
  }>;
  resolveLegacyIdentity?: (
    observation: BankedGrantAssociationReconciliationObservation,
  ) => Promise<BankedGrantLegacyIdentityResolution>;
  loadSignals: (
    observations: readonly BankedGrantAssociationReconciliationObservation[],
  ) => Promise<{ signals: ActiveTiboSignal[]; error?: unknown }>;
  persist: (
    observation: BankedGrantAssociationReconciliationObservation,
    decision: BankedPostAssociationDecision,
    estimate: BankedDistributionEstimateInput | null,
    expectedRevision: number,
    decidedAt: string,
  ) => Promise<{
    status: "accepted" | "pending" | "conflict" | "stale" | null;
    publicationChanged: boolean;
    error?: unknown;
  }>;
  invalidate: () => void | Promise<void>;
};

export type BankedGrantAssociationReconciliationResult = {
  scanned: number;
  accepted: number;
  pending: number;
  conflict: number;
  stale: number;
  failed: number;
  invalidated: boolean;
  hasMore: boolean;
};

export async function runBankedGrantAssociationReconciliation(
  dependencies: BankedGrantAssociationReconciliationDependencies,
  options: { now?: Date; batchSize?: number; maxBatches?: number } = {},
): Promise<BankedGrantAssociationReconciliationResult> {
  const now = options.now ?? new Date();
  const batchSize = Math.min(50, Math.max(1, Math.trunc(options.batchSize ?? 10)));
  const maxBatches = Math.min(10, Math.max(1, Math.trunc(options.maxBatches ?? 5)));
  const result: BankedGrantAssociationReconciliationResult = {
    scanned: 0,
    accepted: 0,
    pending: 0,
    conflict: 0,
    stale: 0,
    failed: 0,
    invalidated: false,
    hasMore: false,
  };
  let publicationChanged = false;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const due = await dependencies.listDue(now, batchSize);
    if (due.error) {
      result.failed += 1;
      result.hasMore = true;
      break;
    }
    if (due.observations.length === 0) {
      result.hasMore = false;
      break;
    }

    const identityResults = await Promise.all(due.observations.map(async (observation) => {
      if (observation.legacy_identity_status !== "unresolved") {
        return { observation, failed: false };
      }
      if (!dependencies.resolveLegacyIdentity) {
        return { observation, failed: true };
      }
      const resolution = await dependencies.resolveLegacyIdentity(observation);
      if (resolution.error || resolution.status === "unresolved") {
        return { observation, failed: true };
      }
      return {
        observation: {
          ...observation,
          legacy_identity_status: resolution.status,
          legacy_reset_event_key: resolution.status === "legacy_exact"
            ? resolution.legacyResetEventKey ?? null
            : null,
        },
        failed: false,
      };
    }));
    const observations = identityResults.map((item) => item.observation);
    const lookup = await dependencies.loadSignals(due.observations);
    for (let observationIndex = 0; observationIndex < observations.length; observationIndex += 1) {
      const observation = observations[observationIndex]!;
      const identityFailed = identityResults[observationIndex]!.failed;
      result.scanned += 1;
      const resolved = resolveBankedAssociation(
        observation,
        lookup.signals,
        {
          observedAt: observation.observed_at,
          lookupFailed: identityFailed || Boolean(lookup.error),
          lookupFailureReason: identityFailed ? "exact_legacy_estimate_lookup_failed" : undefined,
        },
      );
      const decision = {
        ...resolved.decision,
        legacy_identity_status: observation.legacy_identity_status ?? "resolved",
        legacy_reset_event_key: observation.legacy_reset_event_key ?? null,
      };
      const persisted = await dependencies.persist(
        observation,
        decision,
        decision.status === "accepted" && decision.legacy_reset_event_key && resolved.estimate
          ? { ...resolved.estimate, resetEventKey: decision.legacy_reset_event_key }
          : resolved.estimate,
        observation.current_revision,
        now.toISOString(),
      );
      if (persisted.error || persisted.status === null) {
        result.failed += 1;
        result.hasMore = true;
        // Do not hot-loop a row whose durable CAS/write is unavailable.
        if (batchIndex === maxBatches - 1 || due.hasMore) break;
        break;
      }
      if (persisted.status === "stale") {
        result.stale += 1;
        continue;
      }
      result[persisted.status] += 1;
      publicationChanged ||= persisted.publicationChanged;
    }

    if (result.failed > 0) {
      result.hasMore = true;
      break;
    }
    result.hasMore = due.hasMore;
    if (!due.hasMore) break;
  }

  if (publicationChanged) {
    await dependencies.invalidate();
    result.invalidated = true;
  }
  return result;
}
