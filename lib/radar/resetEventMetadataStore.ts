import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCompletedResetTimestamp } from "./probability";
import {
  generateResetEventMetadata,
  RESET_EVENT_METADATA_PROMPT_VERSION,
  type GeneratedResetReasonType,
  type ResetEventMetadataResult,
} from "./resetEventMetadata";
import { fetchResetDisplayNameByKey } from "./resetDisplayNameStore";
import { getCanonicalResetDisplayNameEventKey, isAutoMetadataEligibleCanonicalEvent } from "./resetDisplayNameEligibility";
import {
  isMonitorConfirmedResetCopyEvidence,
  type MonitorResetCopyEvidence,
} from "./monitorResetCopyLifecycle";
import { normalizeResetScope } from "./resetScope";
import type { ResetDisplayNameRecord, WindowEventLike } from "./types";

export type ResetEventMetadataStoreOutcome = {
  eventKey: string | null;
  status: string;
  wrote: boolean;
  skipped: boolean;
  record?: ResetDisplayNameRecord | null;
};

type ResetEventMetadataStoreOptions = {
  canonicalEventKey?: string;
  monitorEvidence?: MonitorResetCopyEvidence;
  existingRecord?: ResetDisplayNameRecord | null;
  sourcePostText?: string | null;
  sourceTweetId?: string | null;
  now?: Date;
  generatedAt?: string;
  apiKey?: string | null;
  model?: string;
  timeoutMs?: number;
  supabase?: SupabaseClient;
  generate?: typeof generateResetEventMetadata;
};

function getServerSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function isMissingMetadataColumnsError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = [value.message, value.details]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  return value.code === "PGRST204" || /event_metadata|event_(?:reason|scope|summary|note)/i.test(message);
}

const EVENT_METADATA_FIELDS = [
  "event_reason_type",
  "event_scope",
  "event_summary_ja",
  "event_summary_en",
  "event_summary_zh",
  "event_note_ja",
  "event_note_en",
  "event_note_zh",
  "event_metadata_model",
  "event_metadata_prompt_version",
  "event_metadata_status",
  "event_metadata_flags",
  "event_metadata_generated_at",
  "event_metadata_input_hash",
] as const;

export function hashResetEventMetadataInput(input: {
  completedAt: string;
  sourceContext: string;
  fallbackReasonType?: string | null;
  fallbackScope?: string | null;
  evidenceFingerprint?: string | null;
  model?: string | null;
}) {
  return createHash("sha256")
    .update(JSON.stringify({
      ...input,
      generationContract: {
        promptVersion: RESET_EVENT_METADATA_PROMPT_VERSION,
        model: input.model?.trim() || undefined,
      },
    }))
    .digest("hex");
}

function getFallbackReasonType(item: WindowEventLike): GeneratedResetReasonType | null {
  const reason = item.details?.reasonType;
  return reason === "詫びリセット" || reason === "ご祝儀リセット" ? reason : null;
}

function getFallbackScope(item: WindowEventLike) {
  return normalizeResetScope(item.scope ?? item.details?.scope) ?? null;
}

const AUTO_COPY_HASHES_FLAG = "auto-copy-hashes-v1:";
const AUTO_COPY_FIELDS = [
  "event_reason_type",
  "event_scope",
  "event_summary_ja",
  "event_summary_en",
  "event_summary_zh",
  "event_note_ja",
  "event_note_en",
  "event_note_zh",
] as const;
type AutoCopyField = (typeof AUTO_COPY_FIELDS)[number];

function hashMetadataValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function getAutoCopyHashes(record: ResetDisplayNameRecord | null | undefined) {
  const marker = record?.event_metadata_flags?.find((flag) => flag.startsWith(AUTO_COPY_HASHES_FLAG));
  if (!marker) return {} as Partial<Record<AutoCopyField, string>>;
  try {
    const value = JSON.parse(marker.slice(AUTO_COPY_HASHES_FLAG.length)) as Record<string, unknown>;
    return Object.fromEntries(AUTO_COPY_FIELDS.flatMap((field) =>
      typeof value[field] === "string" && /^[a-f0-9]{64}$/.test(value[field])
        ? [[field, value[field]]]
        : [],
    )) as Partial<Record<AutoCopyField, string>>;
  } catch {
    return {} as Partial<Record<AutoCopyField, string>>;
  }
}

function mergeMetadataCopy(
  existing: ResetDisplayNameRecord | null,
  result: ResetEventMetadataResult,
) {
  const previousHashes = getAutoCopyHashes(existing);
  const nextHashes: Partial<Record<AutoCopyField, string>> = {};
  const values: Record<AutoCopyField, unknown> = {
    event_reason_type: result.reasonType,
    event_scope: result.scope,
    event_summary_ja: result.summaryJa,
    event_summary_en: result.summaryEn,
    event_summary_zh: result.summaryZh,
    event_note_ja: result.noteJa,
    event_note_en: result.noteEn,
    event_note_zh: result.noteZh,
  };

  for (const field of AUTO_COPY_FIELDS) {
    const current = existing?.[field];
    const isCurrentAutoCopy = Boolean(
      previousHashes[field] && previousHashes[field] === hashMetadataValue(current),
    );
    const hasExistingValue = current !== null && current !== undefined &&
      !(typeof current === "string" && current.trim() === "");
    const mayWrite = !hasExistingValue || isCurrentAutoCopy;
    if (!mayWrite) {
      values[field] = current;
      continue;
    }
    if (result.status === "success") {
      nextHashes[field] = hashMetadataValue(values[field]);
    } else if (isCurrentAutoCopy) {
      values[field] = current;
      nextHashes[field] = hashMetadataValue(current);
    }
  }

  const flags = (result.flags ?? []).filter((flag) => !flag.startsWith(AUTO_COPY_HASHES_FLAG));
  if (Object.keys(nextHashes).length > 0) {
    flags.push(`${AUTO_COPY_HASHES_FLAG}${JSON.stringify(nextHashes)}`);
  }
  return { values, flags };
}

function buildMetadataWritePayload(
  eventKey: string,
  sourceTweetId: string | null,
  existing: ResetDisplayNameRecord | null,
  result: ResetEventMetadataResult,
  inputHash: string,
  generatedAt: string,
) {
  const copy = mergeMetadataCopy(existing, result);
  return {
    event_key: eventKey,
    source_tweet_id: sourceTweetId ?? existing?.source_tweet_id ?? null,
    manual_name_ja: existing?.manual_name_ja ?? null,
    manual_name_en: existing?.manual_name_en ?? null,
    manual_name_zh: existing?.manual_name_zh ?? null,
    ai_name_ja: existing?.ai_name_ja ?? null,
    ai_name_en: existing?.ai_name_en ?? null,
    ai_name_zh: existing?.ai_name_zh ?? null,
    ai_confidence: existing?.ai_confidence ?? null,
    ai_evidence: existing?.ai_evidence ?? null,
    ai_reason: existing?.ai_reason ?? null,
    ai_model: existing?.ai_model ?? null,
    ai_prompt_version: existing?.ai_prompt_version ?? null,
    ai_input_mode: existing?.ai_input_mode ?? null,
    ai_status: existing?.ai_status ?? null,
    ai_flags: existing?.ai_flags ?? null,
    ai_generated_at: existing?.ai_generated_at ?? null,
    input_hash: existing?.input_hash ?? null,
    created_at: existing?.created_at ?? undefined,
    updated_at: generatedAt,
    event_reason_type: copy.values.event_reason_type,
    event_scope: copy.values.event_scope,
    event_summary_ja: copy.values.event_summary_ja,
    event_summary_en: copy.values.event_summary_en,
    event_summary_zh: copy.values.event_summary_zh,
    event_note_ja: copy.values.event_note_ja,
    event_note_en: copy.values.event_note_en,
    event_note_zh: copy.values.event_note_zh,
    event_metadata_model: result.model,
    event_metadata_prompt_version: result.promptVersion,
    event_metadata_status: result.status,
    event_metadata_flags: copy.flags,
    event_metadata_generated_at: generatedAt,
    event_metadata_input_hash: inputHash,
  };
}

async function writeMetadata(
  supabase: SupabaseClient,
  payload: ReturnType<typeof buildMetadataWritePayload>,
  existing: ResetDisplayNameRecord | null,
) {
  let query = existing
    ? supabase.from("reset_display_names").update(payload).eq("event_key", payload.event_key)
    : supabase.from("reset_display_names").insert(payload);
  if (existing) {
    query = existing.updated_at
      ? query.eq("updated_at", existing.updated_at)
      : query.is("updated_at", null);
  }
  const { data, error } = await query.select("event_key").maybeSingle();
  if (!error) return data ? "written" as const : "write_conflict" as const;
  if (isMissingMetadataColumnsError(error)) {
    // Schema propagation must not turn a durable source event into a failed
    // webhook. The metadata is retried after the migration is available.
    return "schema_unavailable" as const;
  }
  throw new Error("Reset event metadata write failed");
}

export async function ensureResetEventMetadataForEvent(
  item: WindowEventLike,
  options: ResetEventMetadataStoreOptions,
): Promise<ResetEventMetadataStoreOutcome> {
  const now = options.now ?? new Date();
  const eventKey = options.canonicalEventKey?.trim() || getCanonicalResetDisplayNameEventKey(item);
  const completedAtMs = getCompletedResetTimestamp(item);
  if (
    !eventKey ||
    completedAtMs === null ||
    !isAutoMetadataEligibleCanonicalEvent(item, now) ||
    !isMonitorConfirmedResetCopyEvidence(item, options.monitorEvidence, now)
  ) {
    return { eventKey, status: "skipped", wrote: false, skipped: true };
  }

  const sourceContext = options.sourcePostText?.trim() || null;
  if (!sourceContext) {
    return { eventKey, status: "source_unavailable", wrote: false, skipped: true };
  }

  const apiKey = options.apiKey?.trim();
  const supabase = options.supabase ?? getServerSupabaseClient();
  if (!supabase || !apiKey) {
    return { eventKey, status: "api_error", wrote: false, skipped: true };
  }

  const completedAt = new Date(completedAtMs).toISOString();
  const fallbackReasonType = getFallbackReasonType(item);
  const fallbackScope = getFallbackScope(item);
  const input = {
    completedAt,
    sourceContext,
    fallbackReasonType,
    fallbackScope,
    evidenceFingerprint: options.monitorEvidence?.fingerprint ?? null,
    model: options.model ?? null,
  };
  const inputHash = hashResetEventMetadataInput(input);

  let existing: ResetDisplayNameRecord | null = null;
  if (options.existingRecord !== undefined) {
    existing = options.existingRecord;
  } else {
    try {
      existing = await fetchResetDisplayNameByKey(supabase, eventKey);
    } catch {
      return { eventKey, status: "read_error", wrote: false, skipped: true };
    }
  }

  // Successful same-input metadata may contain human-edited summaries or notes.
  // A prompt upgrade alone must not overwrite that event-level correction.
  if (
    existing?.event_metadata_status === "success" &&
    existing.event_metadata_input_hash === inputHash
  ) {
    return { eventKey, status: "reused", wrote: false, skipped: true };
  }

  const existingHashes = getAutoCopyHashes(existing);
  const hasWritableCopyField = AUTO_COPY_FIELDS.some((field) => {
    const value = existing?.[field];
    const hasValue = value !== null && value !== undefined &&
      !(typeof value === "string" && value.trim() === "");
    return !hasValue || Boolean(
      existingHashes[field] && existingHashes[field] === hashMetadataValue(value),
    );
  });
  if (!hasWritableCopyField) {
    return { eventKey, status: "human_content_preserved", wrote: false, skipped: true, record: existing };
  }

  const generate = options.generate ?? generateResetEventMetadata;
  let result: ResetEventMetadataResult;
  try {
    result = await generate(input, {
      apiKey,
      model: options.model,
      timeoutMs: options.timeoutMs,
    });
  } catch {
    return { eventKey, status: "generation_error", wrote: false, skipped: true };
  }

  let freshExisting: ResetDisplayNameRecord | null;
  try {
    const reRead = await fetchResetDisplayNameByKey(supabase, eventKey);
    freshExisting = reRead;
  } catch {
    return { eventKey, status: "read_error", wrote: false, skipped: true };
  }

  if (result.status !== "success" && freshExisting?.event_metadata_status === "success") {
    return { eventKey, status: "generation_failed_preserved", wrote: false, skipped: true, record: freshExisting };
  }

  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const payload = buildMetadataWritePayload(
    eventKey,
    options.sourceTweetId ?? item.sourceTweetIds?.[0] ?? null,
    freshExisting,
    result,
    inputHash,
    generatedAt,
  );

  try {
    const writeStatus = await writeMetadata(supabase, payload, freshExisting);
    if (writeStatus !== "written") {
      return {
        eventKey,
        status: writeStatus,
        record: freshExisting,
        wrote: false,
        skipped: true,
      };
    }
  } catch {
    return { eventKey, status: "write_error", wrote: false, skipped: true };
  }

  return { eventKey, status: result.status, wrote: true, skipped: false };
}
