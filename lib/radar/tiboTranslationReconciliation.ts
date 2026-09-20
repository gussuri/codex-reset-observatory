import { createClient } from "@supabase/supabase-js";

import {
  translateWithGeminiWithRetry,
  type GeminiTranslationOutput,
  type GeminiTranslationRetryOptions,
} from "./geminiTranslation";
import {
  isTiboTranslationValid,
} from "./tiboTranslationValidation";

export const TIBO_TRANSLATION_REPAIR_SIGNAL_TYPES = [
  "official_notice",
  "teaser",
  "reset_executed",
] as const;

export const TIBO_TRANSLATION_REPAIR_BATCH_SIZE = 4;
export const TIBO_TRANSLATION_REPAIR_AUDIT_LIMIT = 100;
export const TIBO_TRANSLATION_REPAIR_TIMEOUT_MS = 5_000;

const TIBO_TRANSLATION_COLUMNS = [
  "tweet_id",
  "signal_type",
  "text",
  "tweet_created_at",
  "translated_text_ja",
  "translated_text_zh",
].join(",");

export type TiboTranslationStoreClient = {
  from(table: "tibo_signals"): any;
};

export type MissingTiboTranslationRow = {
  tweetId: string;
  signalType: (typeof TIBO_TRANSLATION_REPAIR_SIGNAL_TYPES)[number];
  text: string;
  tweetCreatedAt: string;
  translatedTextJa: string | null;
  translatedTextZh: string | null;
};

export type TiboTranslationRepairOutcome = {
  tweetId: string;
  signalType: string;
  missingLocales: string[];
  writtenLocales: string[];
  status: string;
};

export type TiboTranslationRepairResult = {
  scanned: number;
  candidates: number;
  attempted: number;
  geminiRequests: number;
  writes: number;
  rateLimited: boolean;
  invalidated: boolean;
  outcomes: TiboTranslationRepairOutcome[];
};

export type TiboTranslationReconciliationOptions = {
  store: TiboTranslationStoreClient;
  rows?: readonly MissingTiboTranslationRow[];
  maxRows?: number;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  translate?: (
    input: { text: string; tweetCreatedAt?: string },
    options?: GeminiTranslationRetryOptions,
  ) => Promise<GeminiTranslationOutput>;
  invalidateRadarData?: () => void | Promise<void>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isRepairSignalType(
  value: unknown,
): value is (typeof TIBO_TRANSLATION_REPAIR_SIGNAL_TYPES)[number] {
  return TIBO_TRANSLATION_REPAIR_SIGNAL_TYPES.includes(value as typeof TIBO_TRANSLATION_REPAIR_SIGNAL_TYPES[number]);
}

function toMissingTranslationRow(value: unknown): MissingTiboTranslationRow | null {
  if (!isObject(value)) return null;
  const tweetId = nonEmptyString(value.tweet_id);
  const text = nonEmptyString(value.text);
  const tweetCreatedAt = nonEmptyString(value.tweet_created_at);
  if (!tweetId || !text || !tweetCreatedAt || !isRepairSignalType(value.signal_type)) {
    return null;
  }

  const translatedTextJa = nullableString(value.translated_text_ja);
  const translatedTextZh = nullableString(value.translated_text_zh);
  if (
    isTiboTranslationValid(text, translatedTextJa, "ja") &&
    isTiboTranslationValid(text, translatedTextZh, "zh")
  ) return null;

  return {
    tweetId,
    signalType: value.signal_type,
    text,
    tweetCreatedAt,
    translatedTextJa,
    translatedTextZh,
  };
}

export async function listMissingTiboTranslations(
  store: TiboTranslationStoreClient,
  limit = TIBO_TRANSLATION_REPAIR_AUDIT_LIMIT,
): Promise<MissingTiboTranslationRow[]> {
  const boundedLimit = Math.min(
    TIBO_TRANSLATION_REPAIR_AUDIT_LIMIT,
    Math.max(1, Math.floor(limit)),
  );
  const result = await store
    .from("tibo_signals")
    .select(TIBO_TRANSLATION_COLUMNS)
    .in("signal_type", [...TIBO_TRANSLATION_REPAIR_SIGNAL_TYPES])
    .order("tweet_created_at", { ascending: false })
    .limit(boundedLimit);

  if (result.error) throw new Error("Tibo translation candidate lookup failed");
  const rows: unknown[] = Array.isArray(result.data) ? result.data : [];
  return rows
    .map(toMissingTranslationRow)
    .filter((row): row is MissingTiboTranslationRow => Boolean(row));
}

export function getTiboTranslationServiceClient(): TiboTranslationStoreClient {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase Service Role configuration.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  }) as unknown as TiboTranslationStoreClient;
}

export function getTiboTranslationRepairLocales(row: MissingTiboTranslationRow) {
  return [
    isTiboTranslationValid(row.text, row.translatedTextJa, "ja") ? null : "ja",
    isTiboTranslationValid(row.text, row.translatedTextZh, "zh") ? null : "zh",
  ].filter((locale): locale is string => Boolean(locale));
}

async function updateTiboTranslation(
  store: TiboTranslationStoreClient,
  row: MissingTiboTranslationRow,
  column: "translated_text_ja" | "translated_text_zh",
  value: string,
) {
  const currentValue = column === "translated_text_ja"
    ? row.translatedTextJa
    : row.translatedTextZh;
  let query = store
    .from("tibo_signals")
    .update({ [column]: value })
    .eq("tweet_id", row.tweetId);
  query = currentValue === null
    ? query.or(`${column}.is.null,${column}.eq.`)
    : query.eq(column, currentValue);
  const result = await query.select("tweet_id");
  if (result.error) throw new Error("Tibo translation update failed");
  return Array.isArray(result.data) && result.data.length > 0;
}

export async function reconcileMissingTiboTranslations(
  options: TiboTranslationReconciliationOptions,
): Promise<TiboTranslationRepairResult> {
  const rows = options.rows ?? await listMissingTiboTranslations(
    options.store,
    options.maxRows ?? TIBO_TRANSLATION_REPAIR_BATCH_SIZE,
  );
  const maxRows = Math.min(
    TIBO_TRANSLATION_REPAIR_BATCH_SIZE,
    Math.max(1, Math.floor(options.maxRows ?? TIBO_TRANSLATION_REPAIR_BATCH_SIZE)),
  );
  const candidates = rows.filter((row) => getTiboTranslationRepairLocales(row).length > 0).slice(0, maxRows);
  const translate = options.translate ?? translateWithGeminiWithRetry;
  const outcomes: TiboTranslationRepairOutcome[] = [];
  let attempted = 0;
  let geminiRequests = 0;
  let writes = 0;
  let rateLimited = false;

  for (const row of candidates) {
    const locales = getTiboTranslationRepairLocales(row);
    attempted += 1;
    geminiRequests += 1;
    const result = await translate(
      { text: row.text, tweetCreatedAt: row.tweetCreatedAt },
      {
        apiKey: options.apiKey,
        model: options.model,
        timeoutMs: options.timeoutMs ?? TIBO_TRANSLATION_REPAIR_TIMEOUT_MS,
        maxAttempts: 2,
        retryDelayMs: 250,
      },
    );

    if (result.status === "rate_limited") {
      rateLimited = true;
      outcomes.push({
        tweetId: row.tweetId,
        signalType: row.signalType,
        missingLocales: locales,
        writtenLocales: [],
        status: result.status,
      });
      break;
    }

    if (result.status !== "success") {
      outcomes.push({
        tweetId: row.tweetId,
        signalType: row.signalType,
        missingLocales: locales,
        writtenLocales: [],
        status: `translation_${result.status}`,
      });
      continue;
    }

    const validResults = locales.every((locale) =>
      locale === "ja"
        ? isTiboTranslationValid(row.text, result.textJa, "ja")
        : isTiboTranslationValid(row.text, result.textZh, "zh"),
    );
    if (!validResults) {
      outcomes.push({
        tweetId: row.tweetId,
        signalType: row.signalType,
        missingLocales: locales,
        writtenLocales: [],
        status: "translation_invalid_translation",
      });
      continue;
    }

    const writtenLocales: string[] = [];
    try {
      if (locales.includes("ja") && result.textJa) {
        if (await updateTiboTranslation(options.store, row, "translated_text_ja", result.textJa)) {
          writtenLocales.push("ja");
          writes += 1;
        }
      }
      if (locales.includes("zh") && result.textZh) {
        if (await updateTiboTranslation(options.store, row, "translated_text_zh", result.textZh)) {
          writtenLocales.push("zh");
          writes += 1;
        }
      }
    } catch {
      outcomes.push({
        tweetId: row.tweetId,
        signalType: row.signalType,
        missingLocales: locales,
        writtenLocales,
        status: "write_failed",
      });
      break;
    }

    outcomes.push({
      tweetId: row.tweetId,
      signalType: row.signalType,
      missingLocales: locales,
      writtenLocales,
      status: writtenLocales.length > 0 ? "translated" : "unchanged",
    });
  }

  const invalidated = writes > 0;
  if (invalidated) await options.invalidateRadarData?.();

  return {
    scanned: rows.length,
    candidates: candidates.length,
    attempted,
    geminiRequests,
    writes,
    rateLimited,
    invalidated,
    outcomes,
  };
}
