import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assessRandomResetNameResult,
  generateRandomResetName,
  RANDOM_RESET_NAME_MODEL,
  RANDOM_RESET_NAME_PROMPT_VERSION,
  RANDOM_RESET_NAME_V1_PROMPT_VERSION,
  toRandomResetNameInput,
  type RandomResetNameEvaluationInput,
  type RandomResetNameGenerationResult,
} from "./randomResetNaming";
import { getCompletedResetTimestamp } from "./probability";
import { isEligibleRandomResetEvent } from "./resetEligibility";
import {
  getResetDisplayNameEventKey,
  getResetDisplayNameSourceTweetId,
  isGenericResetDisplayTitle,
} from "./resetDisplayNames";
import type { ResetDisplayNameRecord, WindowEventLike } from "./types";

export const RESET_DISPLAY_NAME_COLUMNS = [
  "event_key",
  "source_tweet_id",
  "manual_name_ja",
  "ai_name_ja",
  "ai_confidence",
  "ai_evidence",
  "ai_reason",
  "ai_model",
  "ai_prompt_version",
  "ai_input_mode",
  "ai_status",
  "ai_flags",
  "ai_generated_at",
  "input_hash",
  "created_at",
  "updated_at",
].join(",");

export type ResetDisplayNameGenerationOutcome = {
  eventKey: string | null;
  status: string;
  displayName: string | null;
  inputMode: "metadata" | "metadata+source" | null;
  skipped: boolean;
};

function getServerSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof value.code === "string" ? value.code : "";
  const message = [value.message, value.details]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  return code === "PGRST205" || /reset_display_names|relation .* does not exist/i.test(message);
}

export async function fetchResetDisplayNames(): Promise<ResetDisplayNameRecord[]> {
  const supabase = getServerSupabaseClient();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from("reset_display_names")
      .select(RESET_DISPLAY_NAME_COLUMNS)
      .limit(2000);
    if (error) {
      console.warn("[Reset display names] read skipped", {
        detail: isMissingTableError(error) ? "table_unavailable" : "database_error",
      });
      return [];
    }
    return (data ?? []) as unknown as ResetDisplayNameRecord[];
  } catch {
    console.warn("[Reset display names] read skipped", { detail: "request_failed" });
    return [];
  }
}

async function fetchResetDisplayNameByKey(
  supabase: SupabaseClient,
  eventKey: string,
) {
  const { data, error } = await supabase
    .from("reset_display_names")
    .select(RESET_DISPLAY_NAME_COLUMNS)
    .eq("event_key", eventKey)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error("Reset display name lookup failed");
  }
  return (data as ResetDisplayNameRecord | null) ?? null;
}

export function hashResetDisplayNameInput(
  input: RandomResetNameEvaluationInput,
  sourcePostText: string | null,
) {
  return createHash("sha256")
    .update(JSON.stringify({ input: { ...input, sourcePostText }, sourcePostText }))
    .digest("hex");
}

export function shouldReuseResetDisplayNameResult(
  record: ResetDisplayNameRecord | null,
  inputHash: string,
  model: string,
) {
  return Boolean(
    record &&
      record.input_hash === inputHash &&
      record.ai_model === model &&
      record.ai_prompt_version === RANDOM_RESET_NAME_PROMPT_VERSION &&
      ["accepted", "null", "review_required"].includes(record.ai_status ?? ""),
  );
}

export function shouldPreserveExistingAcceptedResetDisplayName(
  record: ResetDisplayNameRecord | null | undefined,
) {
  return Boolean(
    record?.ai_status === "accepted" &&
      typeof record.ai_name_ja === "string" &&
      record.ai_name_ja.trim() &&
      (record.ai_prompt_version === RANDOM_RESET_NAME_V1_PROMPT_VERSION || record.ai_prompt_version === null),
  );
}

export function shouldSkipResetDisplayNameGenerationWithoutSource(
  sourcePostText: string | null | undefined,
) {
  return !sourcePostText?.trim();
}

function buildUpsertPayload(
  eventKey: string,
  sourceTweetId: string | null,
  inputMode: "metadata" | "metadata+source",
  inputHash: string,
  result: RandomResetNameGenerationResult,
  existing: ResetDisplayNameRecord | null,
  generatedAt: string,
) {
  const acceptance = assessRandomResetNameResult(result);
  return {
    event_key: eventKey,
    source_tweet_id: sourceTweetId ?? existing?.source_tweet_id ?? null,
    manual_name_ja: existing?.manual_name_ja ?? null,
    ai_name_ja: acceptance.status === "accepted" ? result.name : null,
    ai_confidence: result.confidence,
    ai_evidence: result.evidence,
    ai_reason: result.reason,
    ai_model: result.model,
    ai_prompt_version: RANDOM_RESET_NAME_PROMPT_VERSION,
    ai_input_mode: inputMode,
    ai_status: acceptance.status,
    ai_flags: result.flags,
    ai_generated_at: generatedAt,
    input_hash: inputHash,
    updated_at: generatedAt,
  };
}

export function getResetDisplayNameWritePayload(args: {
  eventKey: string;
  sourceTweetId?: string | null;
  inputMode: "metadata" | "metadata+source";
  inputHash: string;
  result: RandomResetNameGenerationResult;
  existing?: ResetDisplayNameRecord | null;
  generatedAt: string;
}) {
  return buildUpsertPayload(
    args.eventKey,
    args.sourceTweetId ?? null,
    args.inputMode,
    args.inputHash,
    args.result,
    args.existing ?? null,
    args.generatedAt,
  );
}

async function upsertResetDisplayName(
  supabase: SupabaseClient,
  payload: ReturnType<typeof buildUpsertPayload>,
) {
  const { error } = await supabase
    .from("reset_display_names")
    .upsert(payload, { onConflict: "event_key" });
  if (error) throw new Error("Reset display name write failed");
}

export async function ensureResetDisplayNameForEvent(
  item: WindowEventLike,
  options: {
    sourcePostText?: string | null;
    sourceTweetId?: string | null;
    now?: Date;
    apiKey?: string | null;
    model?: string;
    timeoutMs?: number;
  },
): Promise<ResetDisplayNameGenerationOutcome> {
  const eventKey = getResetDisplayNameEventKey(item);
  const now = options.now ?? new Date();
  const completedAt = getCompletedResetTimestamp(item);
  if (
    !eventKey ||
    completedAt === null ||
    !isEligibleRandomResetEvent(item, completedAt, now.getTime()) ||
    !isGenericResetDisplayTitle(item.title)
  ) {
    return { eventKey, status: "skipped", displayName: null, inputMode: null, skipped: true };
  }

  const supabase = getServerSupabaseClient();
  if (!supabase || !options.apiKey) {
    return { eventKey, status: "api_error", displayName: null, inputMode: null, skipped: true };
  }

  const sourcePostText = options.sourcePostText?.trim() || null;
  const input = toRandomResetNameInput(item, completedAt);
  input.sourcePostText = sourcePostText;
  const inputMode = sourcePostText ? "metadata+source" : "metadata";
  const inputHash = hashResetDisplayNameInput(input, sourcePostText);
  let existing: ResetDisplayNameRecord | null = null;
  try {
    existing = await fetchResetDisplayNameByKey(supabase, eventKey);
  } catch {
    return { eventKey, status: "api_error", displayName: null, inputMode, skipped: true };
  }

  if (existing?.manual_name_ja?.trim()) {
    return { eventKey, status: "manual", displayName: existing.manual_name_ja.trim(), inputMode, skipped: true };
  }
  const existingAiName = existing?.ai_name_ja?.trim() ?? null;
  if (shouldPreserveExistingAcceptedResetDisplayName(existing) && existingAiName) {
    return {
      eventKey,
      status: "preserved_legacy_accepted",
      displayName: existingAiName,
      inputMode,
      skipped: true,
    };
  }
  if (shouldSkipResetDisplayNameGenerationWithoutSource(sourcePostText)) {
    return {
      eventKey,
      status: existing?.ai_status === "accepted" ? "preserved_existing" : "source_unavailable",
      displayName: existing?.ai_status === "accepted" ? existing.ai_name_ja : null,
      inputMode,
      skipped: true,
    };
  }
  if (shouldReuseResetDisplayNameResult(existing, inputHash, options.model ?? RANDOM_RESET_NAME_MODEL)) {
    return {
      eventKey,
      status: existing?.ai_status ?? "skipped",
      displayName: existing?.ai_name_ja ?? null,
      inputMode,
      skipped: true,
    };
  }

  const result = await generateRandomResetName(input, {
    apiKey: options.apiKey,
    model: options.model ?? RANDOM_RESET_NAME_MODEL,
    timeoutMs: options.timeoutMs,
  });
  const acceptance = assessRandomResetNameResult(result);

  // A failed regeneration never hides an already accepted name.
  if (existing?.ai_status === "accepted" && acceptance.status !== "accepted") {
    return {
      eventKey,
      status: acceptance.status,
      displayName: existing.ai_name_ja,
      inputMode,
      skipped: true,
    };
  }

  try {
    await upsertResetDisplayName(
      supabase,
      buildUpsertPayload(
        eventKey,
        options.sourceTweetId ?? getResetDisplayNameSourceTweetId(item),
        inputMode,
        inputHash,
        result,
        existing,
        new Date().toISOString(),
      ),
    );
  } catch {
    return { eventKey, status: "api_error", displayName: null, inputMode, skipped: true };
  }

  return {
    eventKey,
    status: acceptance.status,
    displayName: acceptance.displayName,
    inputMode,
    skipped: false,
  };
}

export async function applyAcceptedResetDisplayName(
  record: ReturnType<typeof getResetDisplayNameWritePayload>,
) {
  const supabase = getServerSupabaseClient();
  if (!supabase) throw new Error("Supabase configuration is unavailable");
  const acceptance = assessRandomResetNameResult(recordToResult(record));
  if (acceptance.status !== "accepted") return false;
  await upsertResetDisplayName(supabase, record);
  return true;
}

function recordToResult(record: ReturnType<typeof getResetDisplayNameWritePayload>): RandomResetNameGenerationResult {
  return {
    name: record.ai_name_ja,
    confidence: record.ai_confidence,
    evidence: record.ai_evidence,
    reason: record.ai_reason,
    evidenceGrounded: record.ai_evidence !== null,
    flags: record.ai_flags ?? [],
    status: "success",
    model: record.ai_model ?? RANDOM_RESET_NAME_MODEL,
    promptVersion: record.ai_prompt_version ?? RANDOM_RESET_NAME_V1_PROMPT_VERSION,
    latencyMs: 0,
    httpStatus: 200,
    retryAfterSeconds: null,
  };
}
