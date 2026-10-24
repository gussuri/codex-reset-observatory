import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CodexRecoveryObservation } from "../codexUsageRecovery";
import {
  MONITOR_OBSERVED_RESET_EXECUTION_ESTIMATOR_VERSION,
  TEASER_CORROBORATED_RESET_EXECUTION_ESTIMATOR_VERSION,
  type ResetExecutionEstimate,
} from "./resetExecution";
import {
  RESET_EVENT_METADATA_PROMPT_VERSION,
} from "./resetEventMetadata";
import {
  RANDOM_RESET_NAME_MODEL,
  RANDOM_RESET_NAME_PROMPT_VERSION,
} from "./randomResetNaming";
import {
  attachTiboFormalReplyAdmissionProof,
  getCurrentTiboFormalReplyAdmissionProof,
  type TiboFormalReplyAdmissionProof,
  type TiboFormalReplyAdmissionSignal,
} from "./tiboFormalReplyAdmission";
import {
  findNoticeBackedRecoveryEvents,
  isNoticeBackedRecoveryEvent,
  type FormalTiboResetSignal,
  type TiboNoticeSignal,
} from "./tiboHistory";
import type { ResetDisplayNameSourceRow } from "./resetDisplayNameSourceContext";
import type { WindowEventLike } from "./types";

export type MonitorResetCopySourceRow = ResetDisplayNameSourceRow;

export type MonitorResetCopyEvidence = {
  eventKey: string;
  recoveryObservationId: string;
  recoveryStatus: "confirmed";
  recoveryObservedAt: string;
  recoveryConfirmedAt: string;
  fingerprint: string;
};

export type MonitorConfirmedResetCopyContext = {
  item: WindowEventLike;
  sourceContext: string;
  sourceTweetId: string | null;
  evidence: MonitorResetCopyEvidence;
};

type SourceRole = "notice" | "completion" | "verified reply completion";

type UsableSource = {
  row: MonitorResetCopySourceRow;
  role: SourceRole;
  replyProof: TiboFormalReplyAdmissionProof | null;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const LIFECYCLE_CONTRACT = "monitor-confirmed-reset-copy-v1";

function isMissingReplyProofColumnsError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = [value.message, value.details]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  return (value.code === "PGRST204" || value.code === "42703" || /column|schema cache|does not exist/i.test(message)) &&
    /formal_reply_admission_proof|source_context_|ai_contextual_reset_|ai_temporal_|ai_signal_type|ai_confidence|ai_classification_status|ai_evidence_quote|classification_source/i.test(message);
}

export async function fetchMonitorResetCopySourceRows(
  supabase: SupabaseClient,
  sourceTweetIds: readonly string[],
): Promise<{ rows: MonitorResetCopySourceRow[]; error: unknown | null }> {
  const ids = Array.from(new Set(sourceTweetIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return { rows: [], error: null };

  const fullColumns = "tweet_id,text,tweet_url,tweet_created_at,signal_type,confidence,verification_status,is_reply,is_quote,classification_source,ai_signal_type,ai_confidence,ai_classification_status,ai_temporal_direction,ai_evidence_quote,source_context_revision_hashes,source_context_classified_revision_hashes,source_context_generation,formal_reply_admission_proof,logical_post_id,edit_history_tweet_ids,edit_version,edit_metadata_source";
  let result: { data: any; error: any } = await supabase
    .from("tibo_signals")
    .select(fullColumns)
    .in("tweet_id", ids)
    .limit(32);

  if (result.error && isMissingReplyProofColumnsError(result.error)) {
    result = await supabase
      .from("tibo_signals")
      .select("tweet_id,text,tweet_url,tweet_created_at,signal_type,confidence,verification_status,is_reply,is_quote")
      .in("tweet_id", ids)
      .eq("is_reply", false)
      .limit(32);
  }
  if (result.error) return { rows: [], error: result.error };

  const dataRows: unknown[] = Array.isArray(result.data) ? result.data : [];
  const rows = dataRows.flatMap((raw): MonitorResetCopySourceRow[] => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    if (!value || typeof value.tweet_id !== "string" || typeof value.text !== "string") return [];
    return [{
      ...(value as unknown as MonitorResetCopySourceRow),
      tweet_id: value.tweet_id,
      text: value.text,
      tweet_url: typeof value.tweet_url === "string" ? value.tweet_url : null,
      tweet_created_at: typeof value.tweet_created_at === "string" ? value.tweet_created_at : null,
      signal_type: typeof value.signal_type === "string" ? value.signal_type : null,
      confidence: typeof value.confidence === "number" ? value.confidence : null,
      verification_status: typeof value.verification_status === "string" ? value.verification_status : null,
      is_reply: value.is_reply === true,
      is_quote: value.is_quote === true,
    }];
  });
  return { rows, error: null };
}

function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function textHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function getRowReplyProof(row: MonitorResetCopySourceRow) {
  const attached = attachTiboFormalReplyAdmissionProof(
    row as Record<string, unknown>,
  );
  return getCurrentTiboFormalReplyAdmissionProof(
    attached as unknown as TiboFormalReplyAdmissionSignal,
  );
}

function isSourceRowForCanonicalEvent(
  row: MonitorResetCopySourceRow,
  canonicalSourceTweetIds: ReadonlySet<string>,
) {
  return typeof row.tweet_id === "string" &&
    typeof row.text === "string" &&
    canonicalSourceTweetIds.has(row.tweet_id.trim()) &&
    row.tweet_id.trim().length > 0 &&
    row.text.trim().length > 0 &&
    row.verification_status !== "rejected" &&
    row.signal_type !== "irrelevant";
}

function classifySourceRow(
  row: MonitorResetCopySourceRow,
  canonicalSourceTweetIds: ReadonlySet<string>,
  eventKey: string,
): UsableSource | null {
  if (!isSourceRowForCanonicalEvent(row, canonicalSourceTweetIds)) return null;

  if (row.is_reply === true) {
    if (row.is_quote === true || row.signal_type !== "reset_executed") return null;
    const replyProof = getRowReplyProof(row);
    if (!replyProof) return null;
    const proofIsSameEvent = replyProof.targetTweetId === row.tweet_id && (
      canonicalSourceTweetIds.has(replyProof.contextualResetTweetId) ||
      eventKey === `tibo-reset-${replyProof.contextualResetTweetId}`
    );
    if (!proofIsSameEvent) return null;
    return { row, role: "verified reply completion", replyProof };
  }

  if (row.signal_type === "official_notice" || row.signal_type === "teaser") {
    return { row, role: "notice", replyProof: null };
  }
  if (row.signal_type === "reset_executed") {
    return { row, role: "completion", replyProof: null };
  }
  return null;
}

function compareSources(left: UsableSource, right: UsableSource) {
  const leftTime = parseTime(left.row.tweet_created_at);
  const rightTime = parseTime(right.row.tweet_created_at);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (leftTime !== null && rightTime === null) return -1;
  if (leftTime === null && rightTime !== null) return 1;
  return left.row.tweet_id.localeCompare(right.row.tweet_id);
}

function normalizeHashList(value: string[] | null | undefined) {
  return Array.isArray(value)
    ? value.filter((hash): hash is string => typeof hash === "string" && HASH_PATTERN.test(hash))
    : [];
}

function sourceRevision(source: UsableSource) {
  const { row, replyProof } = source;
  return {
    tweetId: row.tweet_id.trim(),
    role: source.role,
    textHash: textHash(row.text),
    createdAt: row.tweet_created_at ?? null,
    logicalPostId: row.logical_post_id ?? null,
    editVersion: row.edit_version ?? null,
    editMetadataSource: row.edit_metadata_source ?? null,
    editHistoryTweetIds: row.edit_history_tweet_ids ?? null,
    sourceContextRevisionHashes: normalizeHashList(row.source_context_revision_hashes),
    sourceContextClassifiedRevisionHashes: normalizeHashList(row.source_context_classified_revision_hashes),
    sourceContextGeneration: row.source_context_generation ?? null,
    replyProof: replyProof
      ? {
          targetTweetId: replyProof.targetTweetId,
          contextualResetTweetId: replyProof.contextualResetTweetId,
          pathTweetIds: replyProof.pathTweetIds,
          sourceContextRevisionHashes: replyProof.sourceContextRevisionHashes,
          sourceContextGeneration: replyProof.sourceContextGeneration,
          targetTextHash: replyProof.targetTextHash,
        }
      : null,
  };
}

function buildFingerprint(
  estimate: ResetExecutionEstimate,
  observation: CodexRecoveryObservation,
  sources: readonly UsableSource[],
) {
  const normalizedSources = sources.map(sourceRevision).sort((left, right) =>
    left.tweetId.localeCompare(right.tweetId),
  );
  return createHash("sha256")
    .update(JSON.stringify({
      lifecycleContract: LIFECYCLE_CONTRACT,
      generationContract: {
        namePromptVersion: RANDOM_RESET_NAME_PROMPT_VERSION,
        nameModel: RANDOM_RESET_NAME_MODEL,
        metadataPromptVersion: RESET_EVENT_METADATA_PROMPT_VERSION,
        metadataModel: RANDOM_RESET_NAME_MODEL,
      },
      eventKey: estimate.resetEventKey,
      recovery: {
        id: observation.id,
        status: observation.status,
        confirmedAt: observation.confirmedAt,
        observedAt: observation.observedAt,
      },
      completionAt: estimate.displayExecutionAt,
      sources: normalizedSources,
    }))
    .digest("hex");
}

function buildSourceContext(
  event: WindowEventLike,
  observation: CodexRecoveryObservation,
  sources: readonly UsableSource[],
) {
  const lines = [
    `[Usage Monitor recovery | event_key=${event.id} recovery_observation_id=${observation.id} status=${observation.status} observed_at=${observation.observedAt} confirmed_at=${observation.confirmedAt}]`,
  ];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]!;
    const proof = source.replyProof;
    const roleDetails = source.role === "verified reply completion" && proof
      ? ` contextual_reset_tweet_id=${proof.contextualResetTweetId} path_tweet_ids=${proof.pathTweetIds.join(",")}`
      : "";
    lines.push(
      `[Tibo ${source.role} | tweet_id=${source.row.tweet_id}${roleDetails}]`,
      source.row.text.trim(),
      `[End Tibo source ${index + 1}]`,
    );
  }
  const context = lines.join("\n");
  return context.length <= 25_000 ? context : null;
}

export function isMonitorConfirmedResetCopyEvidence(
  item: WindowEventLike,
  evidence: MonitorResetCopyEvidence | null | undefined,
  now: Date = new Date(),
) {
  if (!evidence || !isNoticeBackedRecoveryEvent(item)) return false;
  const eventKey = item.id?.trim() || item.guid?.trim() || "";
  const eventCompletedAt = parseTime(item.completed_at ?? item.closed_at ?? item.date);
  const observedAt = parseTime(evidence.recoveryObservedAt);
  const confirmedAt = parseTime(evidence.recoveryConfirmedAt);
  return Boolean(
    item.recordKind === "confirmed_global" &&
      item.status?.trim().toLowerCase() !== "rejected" &&
      eventKey && eventKey === evidence.eventKey &&
      item.recoveryObservationId === evidence.recoveryObservationId &&
      evidence.recoveryStatus === "confirmed" &&
      observedAt !== null &&
      eventCompletedAt === observedAt &&
      confirmedAt !== null &&
      confirmedAt <= now.getTime() &&
      HASH_PATTERN.test(evidence.fingerprint),
  );
}

export function buildMonitorConfirmedResetCopyContext(input: {
  estimate: ResetExecutionEstimate;
  recoveryObservation: CodexRecoveryObservation;
  sourceRows: readonly MonitorResetCopySourceRow[];
  candidate?: MonitorResetCopySourceRow | null;
  now?: Date;
}): MonitorConfirmedResetCopyContext | null {
  const { estimate, recoveryObservation } = input;
  if (
    !estimate.resetEventKey.trim() ||
    !estimate.recoveryObservationId ||
    estimate.recoveryObservationId !== recoveryObservation.id ||
    recoveryObservation.status !== "confirmed" ||
    !recoveryObservation.confirmedAt ||
    parseTime(recoveryObservation.confirmedAt) === null ||
    parseTime(recoveryObservation.observedAt) === null ||
    estimate.displayExecutionAt !== recoveryObservation.observedAt ||
    (estimate.manualOverrideAt || estimate.manualExecutionAt)
  ) {
    return null;
  }

  const rawRows = [...input.sourceRows, ...(input.candidate ? [input.candidate] : [])];
  const uniqueRows = new Map<string, MonitorResetCopySourceRow>();
  for (const row of rawRows) {
    if (row?.tweet_id?.trim() && !uniqueRows.has(row.tweet_id.trim())) {
      uniqueRows.set(row.tweet_id.trim(), row);
    }
  }
  const sourceTweetIds = new Set([
    ...estimate.tiboSourceTweetIds,
    ...(estimate.officialNoticeTweetId ? [estimate.officialNoticeTweetId] : []),
  ].map((tweetId) => tweetId.trim()).filter(Boolean));
  const sources = Array.from(uniqueRows.values())
    .flatMap((row) => {
      const source = classifySourceRow(row, sourceTweetIds, estimate.resetEventKey);
      return source ? [source] : [];
    })
    .sort(compareSources);
  if (sources.length === 0) return null;

  const sourceSignals: Array<TiboNoticeSignal | FormalTiboResetSignal> = [];
  for (const { row } of sources) {
    const normalized = {
      ...row,
      tweet_id: row.tweet_id.trim(),
      text: row.text.trim(),
      tweet_url: row.tweet_url?.trim() || `https://x.com/thsottiaux/status/${row.tweet_id.trim()}`,
      tweet_created_at: row.tweet_created_at ?? "",
      signal_type: row.signal_type,
      confidence: typeof row.confidence === "number" ? row.confidence : null,
      verification_status: row.verification_status === "confirmed" || row.verification_status === "rejected"
        ? row.verification_status
        : "auto_unverified",
    };
    if (normalized.signal_type === "official_notice" || normalized.signal_type === "teaser") {
      sourceSignals.push(normalized as TiboNoticeSignal);
    } else if (normalized.signal_type === "reset_executed") {
      sourceSignals.push(attachTiboFormalReplyAdmissionProof(
        normalized as unknown as Record<string, unknown>,
      ) as unknown as FormalTiboResetSignal);
    }
  }
  const item = findNoticeBackedRecoveryEvents(
    sourceSignals,
    [recoveryObservation],
    [estimate],
  ).find((event) => event.id === estimate.resetEventKey);
  if (!item || !isNoticeBackedRecoveryEvent(item)) return null;

  // The history builder supplies event identity, chronology, and monitor backing.
  // Copy only source rows already proven to be part of that canonical event.
  const canonicalIds = new Set(item.sourceTweetIds ?? []);
  const canonicalSources = sources.filter((source) => {
    if (!canonicalIds.has(source.row.tweet_id)) return false;
    if (!source.replyProof) return true;
    return canonicalIds.has(source.replyProof.contextualResetTweetId) ||
      item.id === `tibo-reset-${source.replyProof.contextualResetTweetId}`;
  });
  if (canonicalSources.length === 0) return null;

  const sourceContext = buildSourceContext(item, recoveryObservation, canonicalSources);
  if (!sourceContext) return null;
  const fingerprint = buildFingerprint(estimate, recoveryObservation, canonicalSources);
  const evidence: MonitorResetCopyEvidence = {
    eventKey: estimate.resetEventKey,
    recoveryObservationId: recoveryObservation.id,
    recoveryStatus: "confirmed",
    recoveryObservedAt: recoveryObservation.observedAt,
    recoveryConfirmedAt: recoveryObservation.confirmedAt!,
    fingerprint,
  };
  if (!isMonitorConfirmedResetCopyEvidence(item, evidence, input.now ?? new Date())) return null;

  const completionSource = canonicalSources.find((source) => source.role !== "notice");
  const sourceTweetId = completionSource?.row.tweet_id ?? canonicalSources[0]?.row.tweet_id ?? null;
  return { item, sourceContext, sourceTweetId, evidence };
}
