import type { RandomResetNameGenerationResult } from "./randomResetNaming";
import type {
  ResetDisplayNameCandidateAiStatus,
  ResetDisplayNameCandidateRecord,
  ResetDisplayNameCandidateSeed,
} from "./resetDisplayNameCandidateTypes";

export const RESET_DISPLAY_NAME_CANDIDATE_COLUMNS = [
  "candidate_id",
  "notice_dedupe_key",
  "official_notice_tweet_id",
  "logical_post_id",
  "notice_tweet_ids",
  "source_tweet_ids",
  "source_snapshot_hash",
  "input_hash",
  "next_retry_at",
  "ai_name_ja",
  "ai_name_en",
  "ai_name_zh",
  "ai_confidence",
  "ai_evidence",
  "ai_reason",
  "ai_flags",
  "ai_model",
  "ai_prompt_version",
  "ai_input_mode",
  "ai_status",
  "lifecycle_status",
  "generation_attempts",
  "last_generated_at",
  "promoted_event_key",
  "promoted_at",
  "created_at",
  "updated_at",
].join(",");

export type ResetDisplayNameCandidateStoreClient = {
  rpc(
    functionName: "upsert_reset_display_name_candidate_seed" | "promote_reset_display_name_candidate",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown | null }>;
  from(table: "reset_display_name_candidates"): any;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableStringValue(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : null;
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null || typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (isObject(error) && typeof error.message === "string") return error.message;
  return "unknown database error";
}

function toResetDisplayNameCandidateRecord(value: unknown): ResetDisplayNameCandidateRecord | null {
  if (!isObject(value)) return null;

  const candidateId = stringValue(value.candidate_id);
  const noticeDedupeKey = stringValue(value.notice_dedupe_key);
  const officialNoticeTweetId = stringValue(value.official_notice_tweet_id);
  const logicalPostId = nullableStringValue(value.logical_post_id);
  const noticeTweetIds = stringArray(value.notice_tweet_ids);
  const sourceTweetIds = stringArray(value.source_tweet_ids);
  const sourceSnapshotHash = nullableStringValue(value.source_snapshot_hash);
  const inputHash = nullableStringValue(value.input_hash);
  const nextRetryAt = nullableStringValue(value.next_retry_at);
  const aiNameJa = nullableStringValue(value.ai_name_ja);
  const aiNameEn = nullableStringValue(value.ai_name_en);
  const aiNameZh = nullableStringValue(value.ai_name_zh);
  const aiConfidence = nullableNumber(value.ai_confidence);
  const aiEvidence = nullableStringValue(value.ai_evidence);
  const aiReason = nullableStringValue(value.ai_reason);
  const aiFlags = stringArray(value.ai_flags);
  const aiModel = nullableStringValue(value.ai_model);
  const aiPromptVersion = nullableStringValue(value.ai_prompt_version);
  const aiInputMode = nullableStringValue(value.ai_input_mode);
  const aiStatus = value.ai_status;
  const lifecycleStatus = value.lifecycle_status;
  const generationAttempts = value.generation_attempts;
  const lastGeneratedAt = nullableStringValue(value.last_generated_at);
  const promotedEventKey = nullableStringValue(value.promoted_event_key);
  const promotedAt = nullableStringValue(value.promoted_at);
  const createdAt = stringValue(value.created_at);
  const updatedAt = stringValue(value.updated_at);

  if (
    !candidateId ||
    !noticeDedupeKey ||
    !officialNoticeTweetId ||
    logicalPostId === undefined ||
    !noticeTweetIds ||
    !sourceTweetIds ||
    sourceSnapshotHash === undefined ||
    inputHash === undefined ||
    nextRetryAt === undefined ||
    aiNameJa === undefined ||
    aiNameEn === undefined ||
    aiNameZh === undefined ||
    aiConfidence === undefined ||
    aiEvidence === undefined ||
    aiReason === undefined ||
    !aiFlags ||
    aiModel === undefined ||
    aiPromptVersion === undefined ||
    aiInputMode === undefined ||
    (aiStatus !== "unprocessed" && aiStatus !== "pending" && aiStatus !== "accepted" &&
      aiStatus !== "null" && aiStatus !== "review_required" && aiStatus !== "api_error" &&
      aiStatus !== "rate_limited" && aiStatus !== "invalid_response") ||
    (lifecycleStatus !== "provisional" && lifecycleStatus !== "promoted" &&
      lifecycleStatus !== "superseded" && lifecycleStatus !== "expired") ||
    typeof generationAttempts !== "number" ||
    !Number.isInteger(generationAttempts) ||
    generationAttempts < 0 ||
    lastGeneratedAt === undefined ||
    promotedEventKey === undefined ||
    promotedAt === undefined ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    candidateId,
    noticeDedupeKey,
    officialNoticeTweetId,
    logicalPostId,
    noticeTweetIds,
    sourceTweetIds,
    sourceSnapshotHash,
    inputHash,
    aiNameJa,
    aiNameEn,
    aiNameZh,
    aiConfidence,
    aiEvidence,
    aiReason,
    aiFlags,
    aiModel,
    aiPromptVersion,
    aiInputMode,
    aiStatus: aiStatus as ResetDisplayNameCandidateAiStatus,
    lifecycleStatus,
    generationAttempts,
    lastGeneratedAt,
    promotedEventKey,
    promotedAt,
    createdAt,
    updatedAt,
    nextRetryAt,
  };
}

function seedPayload(seed: ResetDisplayNameCandidateSeed) {
  return {
    official_notice_tweet_id: seed.officialNoticeTweetId,
    logical_post_id: seed.logicalPostId,
    notice_tweet_ids: [...seed.noticeTweetIds],
    source_tweet_ids: [...seed.sourceTweetIds],
  };
}

export async function upsertResetDisplayNameCandidateSeed(
  client: ResetDisplayNameCandidateStoreClient,
  seed: ResetDisplayNameCandidateSeed,
): Promise<ResetDisplayNameCandidateRecord> {
  const { data, error } = await client.rpc("upsert_reset_display_name_candidate_seed", {
    p_seed: seedPayload(seed),
  });
  if (error) {
    throw new Error(`Reset display name candidate seed failed: ${errorMessage(error)}`);
  }

  const record = toResetDisplayNameCandidateRecord(data);
  if (!record) throw new Error("Reset display name candidate seed returned an invalid record");
  return record;
}

export async function listResetDisplayNameCandidates(
  client: ResetDisplayNameCandidateStoreClient,
): Promise<ResetDisplayNameCandidateRecord[]> {
  const { data, error } = await client
    .from("reset_display_name_candidates")
    .select(RESET_DISPLAY_NAME_CANDIDATE_COLUMNS)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Reset display name candidate read failed: ${errorMessage(error)}`);
  if (data !== null && !Array.isArray(data)) {
    throw new Error("Reset display name candidate read returned an invalid result");
  }

  const rawRecords: unknown[] = Array.isArray(data) ? data : [];
  const records = rawRecords.map(toResetDisplayNameCandidateRecord);
  if (records.some((record) => record === null)) {
    throw new Error("Reset display name candidate read returned an invalid record");
  }
  return records as ResetDisplayNameCandidateRecord[];
}

function nonEmpty(value: string) {
  return value.trim().length > 0;
}

export async function claimResetDisplayNameCandidateGeneration(
  client: ResetDisplayNameCandidateStoreClient,
  input: {
    candidateId: string;
    sourceSnapshotHash: string;
    inputHash: string;
    now: string;
    stalePendingBefore: string;
  },
): Promise<ResetDisplayNameCandidateRecord | null> {
  if (!nonEmpty(input.candidateId) || !nonEmpty(input.sourceSnapshotHash) || !nonEmpty(input.inputHash)) {
    return null;
  }

  const { data, error } = await client
    .from("reset_display_name_candidates")
    .update({
      ai_status: "pending",
      source_snapshot_hash: input.sourceSnapshotHash,
      input_hash: input.inputHash,
      updated_at: input.now,
    })
    .eq("candidate_id", input.candidateId)
    .eq("lifecycle_status", "provisional")
    .or(`next_retry_at.is.null,next_retry_at.lte.${input.now}`)
    .or(`ai_status.neq.pending,updated_at.lt.${input.stalePendingBefore}`)
    .select(RESET_DISPLAY_NAME_CANDIDATE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Reset display name candidate claim failed: ${errorMessage(error)}`);
  if (data === null) return null;

  const record = toResetDisplayNameCandidateRecord(data);
  if (!record) throw new Error("Reset display name candidate claim returned an invalid record");
  return record;
}

function retryAt(
  generatedAt: string,
  aiStatus: ResetDisplayNameCandidateAiStatus,
  retryAfterSeconds: number | null,
) {
  if (aiStatus !== "rate_limited") return null;
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    throw new Error("Reset display name candidate result requires a valid generatedAt timestamp");
  }
  const providerDelay = typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
    ? retryAfterSeconds
    : 0;
  return new Date(generatedAtMs + Math.max(3_600, providerDelay) * 1_000).toISOString();
}

export async function writeResetDisplayNameCandidateGeneration(
  client: ResetDisplayNameCandidateStoreClient,
  input: {
    candidateId: string;
    sourceSnapshotHash: string;
    inputHash: string;
    aiStatus: ResetDisplayNameCandidateAiStatus;
    aiInputMode: "notice-precompute-v1";
    result: RandomResetNameGenerationResult;
    retryAfterSeconds: number | null;
    generatedAt: string;
  },
): Promise<void> {
  const existing = await client
    .from("reset_display_name_candidates")
    .select("generation_attempts")
    .eq("candidate_id", input.candidateId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`Reset display name candidate result read failed: ${errorMessage(existing.error)}`);
  }
  if (!isObject(existing.data) ||
    typeof existing.data.generation_attempts !== "number" ||
    !Number.isInteger(existing.data.generation_attempts) ||
    existing.data.generation_attempts < 0) {
    throw new Error("Reset display name candidate result requires an existing candidate");
  }

  const { data, error } = await client
    .from("reset_display_name_candidates")
    .update({
      source_snapshot_hash: input.sourceSnapshotHash,
      input_hash: input.inputHash,
      ai_name_ja: input.result.name,
      ai_name_en: input.result.nameEn ?? null,
      ai_name_zh: input.result.nameZh ?? null,
      ai_confidence: input.result.confidence,
      ai_evidence: input.result.evidence,
      ai_reason: input.result.reason,
      ai_flags: [...input.result.flags],
      ai_model: input.result.model,
      ai_prompt_version: input.result.promptVersion ?? null,
      ai_input_mode: input.aiInputMode,
      ai_status: input.aiStatus,
      generation_attempts: existing.data.generation_attempts + 1,
      last_generated_at: input.generatedAt,
      next_retry_at: retryAt(input.generatedAt, input.aiStatus, input.retryAfterSeconds),
      updated_at: input.generatedAt,
    })
    .eq("candidate_id", input.candidateId)
    .select("candidate_id")
    .maybeSingle();
  if (error) throw new Error(`Reset display name candidate result write failed: ${errorMessage(error)}`);
  if (data === null) throw new Error("Reset display name candidate result write did not find the candidate");
}
