import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { fetchOpenAIStatusSignals } from "@/lib/openaiStatus";
import { getLocalRadarData, getRandomResetHeatmapEventTimes } from "@/lib/radar";
import {
  combineDataSourceHealth,
  createRadarDataHealth,
  getDatabaseReadHealth,
  getRequiredConfigurationHealth,
} from "@/lib/radar/dataHealth";
import type {
  ActiveTiboSignal,
  DataFetchResult,
  DataSourceHealth,
  Locale,
  PublicRadarSnapshot,
  RadarData,
} from "@/lib/radar/types";
import { toPublicRadarSnapshot } from "@/lib/radar/publicDto";
import {
  findRelatedTiboNotice,
  isFormalTiboResetSignal,
  type FormalTiboResetSignal,
  type RejectedTiboResetSignal,
  type TiboNoticeSignal,
} from "@/lib/radar/tiboHistory";
import type { RegularResetEventRow } from "@/lib/radar/regularResetSchedule";

export const API_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
export const RADAR_CORE_CACHE_TTL_SECONDS = 60;

export const ACTIVE_TIBO_SIGNAL_TYPES: ActiveTiboSignal["signal_type"][] = [
  "official_notice",
  "reset_executed",
  "teaser",
];
const TIBO_CACHE_BUCKET_MS = 60 * 1000;

type ActiveTiboQueryBuilder = {
  not(column: string, operator: string, value: null): ActiveTiboQueryBuilder;
  gt(column: string, value: string): ActiveTiboQueryBuilder;
  or(filters: string): ActiveTiboQueryBuilder;
  in(column: string, values: string[]): ActiveTiboQueryBuilder;
  order(column: string, options: { ascending: boolean }): ActiveTiboQueryBuilder;
  limit(count: number): Promise<{ data: unknown[] | null; error: unknown | null }>;
};

export function applyActiveTiboQueryFilters(
  query: ActiveTiboQueryBuilder,
  expiryBoundaryIso: string,
) {
  return query
    .not("expires_at", "is", null)
    .gt("expires_at", expiryBoundaryIso)
    .or("verification_status.is.null,verification_status.neq.rejected")
    .or("is_reply.is.null,is_reply.eq.false")
    .in("signal_type", [...ACTIVE_TIBO_SIGNAL_TYPES]);
}

function getTiboCacheBoundary(now: Date) {
  const time = now.getTime();
  if (!Number.isFinite(time)) return new Date(0).toISOString();
  return new Date(Math.floor(time / TIBO_CACHE_BUCKET_MS) * TIBO_CACHE_BUCKET_MS).toISOString();
}

// 1. Raw Supabase fetch function. The boundary is both a safe query cutoff and
// an unstable_cache argument, so active expiry filters are not frozen forever
// under a constant cache key while avoiding a per-second cache key explosion.
async function fetchRawTiboSignals(expiryBoundaryIso: string): Promise<DataFetchResult<ActiveTiboSignal[]>> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const configuration = getRequiredConfigurationHealth([
    supabaseUrl,
    supabaseServiceRoleKey,
  ]);

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return { data: [], health: configuration };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await applyActiveTiboQueryFilters(
      supabase.from("tibo_signals").select("*") as unknown as ActiveTiboQueryBuilder,
      expiryBoundaryIso,
    )
      .order("tweet_created_at", { ascending: false })
      .limit(20);

    const health = getDatabaseReadHealth(configuration, {
      hasData: data !== null,
      hasError: Boolean(error),
    });
    if (error) {
      console.error("Active Tibo signals query failed", error);
    }
    const activeSignals = data
      ? (data as Array<ActiveTiboSignal & { ai_teaser_strength?: ActiveTiboSignal["teaser_strength"] }>).map(
          (signal) => ({
            ...signal,
            teaser_strength: signal.teaser_strength ?? signal.ai_teaser_strength ?? null,
          }),
        )
      : [];
    return { data: activeSignals, health };
  } catch (error) {
    console.error("Failed to load active Tibo signals", error);
    return { data: [], health: { state: "degraded", detail: "request_failed" } };
  }
}

// 2. Module-scoped unstable_cache wrapper (60s TTL, tagged "radar-data")
const getCachedTiboSignals = unstable_cache(
  fetchRawTiboSignals,
  ["tibo-signals-cache-v2"],
  {
    revalidate: 60,
    tags: ["radar-data"],
  }
);

function isMissingTiboOptionalColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof value.code === "string" ? value.code : "";
  const message = [value.message, value.details]
    .filter((item): item is string => typeof item === "string")
    .join(" ");

  return (
    /(translated_text_(ja|zh)|ai_teaser_strength(?:_confidence|_evidence_quote|_reason_ja)?|ai_temporal_|expected_(start|end)_at|temporal_resolution_)/i.test(message) &&
    (code === "PGRST204" ||
      code === "42703" ||
      /column|schema cache|does not exist/i.test(message))
  );
}

async function fetchRawTiboHistorySignals(
  includeReplies = false,
): Promise<DataFetchResult<Array<FormalTiboResetSignal>>> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const configuration = getRequiredConfigurationHealth([
    supabaseUrl,
    supabaseServiceRoleKey,
  ]);

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return { data: [], health: configuration };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
    const queryTiboHistory = (fields: string) => {
      const query = supabase
        .from("tibo_signals")
        .select(fields);
      const filteredQuery = includeReplies
        ? query
        : query.or("is_reply.is.null,is_reply.eq.false");
      return filteredQuery
        .order("tweet_created_at", { ascending: false })
        .limit(1000);
    };
    type TiboHistoryQueryResult = {
      data: Array<FormalTiboResetSignal> | null;
      error: unknown | null;
    };
    let result = (await queryTiboHistory(
      "tweet_id,text,tweet_url,tweet_created_at,detected_at,expires_at,signal_type,confidence,verification_status,classification_source,ai_classification_status,ai_reset_type_ja,ai_notice_to_execution,ai_teaser_strength,ai_teaser_strength_confidence,ai_teaser_strength_evidence_quote,ai_teaser_strength_reason_ja,ai_temporal_expression,ai_temporal_kind,ai_temporal_precision,ai_temporal_timezone,ai_temporal_confidence,expected_start_at,expected_end_at,temporal_resolution_status,temporal_resolution_version,translated_text_ja,translated_text_zh,is_reply",
    )) as TiboHistoryQueryResult;

    if (result.error && isMissingTiboOptionalColumnError(result.error)) {
      result = (await queryTiboHistory(
        "tweet_id,text,tweet_url,tweet_created_at,detected_at,expires_at,signal_type,confidence,verification_status,classification_source,ai_classification_status,ai_reset_type_ja,ai_notice_to_execution,is_reply",
      )) as TiboHistoryQueryResult;
    }

    const { data, error } = result;

    const health = getDatabaseReadHealth(configuration, {
      hasData: data !== null,
      hasError: Boolean(error),
    });
    if (error) {
      console.error("Tibo reset history query failed", error);
    }
    return {
      data: data ?? [],
      health,
    };
  } catch (error) {
    console.error("Failed to load Tibo reset history", error);
    return { data: [], health: { state: "degraded", detail: "request_failed" } };
  }
}

const getCachedTiboHistorySignals = unstable_cache(
  () => fetchRawTiboHistorySignals(false),
  ["tibo-history-signals-cache-v2"],
  {
    revalidate: 60,
    tags: ["radar-data"],
  },
);

function isRegularResetEventRow(value: unknown): value is RegularResetEventRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RegularResetEventRow>;
  return (
    typeof row.schedule_key === "string" &&
    typeof row.window_start_at === "string" &&
    typeof row.window_end_at === "string" &&
    typeof row.representative_at === "string" &&
    typeof row.scheduled_at === "string" &&
    typeof row.completed_at === "string" &&
    row.cycle_type === "定期リセット" &&
    typeof row.reset_method === "string" &&
    typeof row.scope === "string" &&
    row.record_kind === "regular_completed" &&
    (row.status === "completed" || row.status === "corrected" || row.status === "voided")
  );
}

async function fetchRawRegularResetEvents(): Promise<
  DataFetchResult<RegularResetEventRow[]>
> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const configuration = getRequiredConfigurationHealth([
    supabaseUrl,
    supabaseServiceRoleKey,
  ]);

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return { data: [], health: configuration };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase
      .from("regular_reset_events")
      .select(
        "schedule_key,window_start_at,window_end_at,representative_at,scheduled_at,completed_at,cycle_type,reset_method,scope,record_kind,status,correction_reason,corrected_at",
      )
      .order("completed_at", { ascending: false })
      .limit(1000);

    const health = getDatabaseReadHealth(configuration, {
      hasData: data !== null,
      hasError: Boolean(error),
    });
    if (error) {
      console.error("Regular reset events query failed", { detail: "database_error" });
      return { data: [], health };
    }

    const rows = (data ?? []).filter(isRegularResetEventRow);
    return { data: rows, health };
  } catch {
    console.error("Failed to load regular reset events", { detail: "request_failed" });
    return { data: [], health: { state: "degraded", detail: "request_failed" } };
  }
}

const getCachedRegularResetEvents = unstable_cache(
  () => fetchRawRegularResetEvents(),
  ["regular-reset-events-cache-v1"],
  {
    revalidate: 60,
    tags: ["radar-data"],
  },
);

function toNoticeSignal(signal: FormalTiboResetSignal): TiboNoticeSignal | null {
  if (signal.is_reply === true) return null;
  if (signal.signal_type !== "official_notice" && signal.signal_type !== "teaser") {
    return null;
  }

  return {
    tweet_id: signal.tweet_id,
    text: signal.text,
    tweet_url: signal.tweet_url,
    tweet_created_at: signal.tweet_created_at,
    signal_type: signal.signal_type,
    confidence: signal.confidence,
    verification_status: signal.verification_status,
  };
}

type TiboSignalBundle = {
  activeSignals: Array<ActiveTiboSignal>;
  recentSignals: Array<ActiveTiboSignal>;
  formalResets: Array<FormalTiboResetSignal>;
  rejectedResets: Array<RejectedTiboResetSignal>;
  health: DataSourceHealth;
};

export function associateTiboNotices(
  acceptedResets: Array<FormalTiboResetSignal>,
  notices: Array<TiboNoticeSignal>,
) {
  const sortedResets = acceptedResets
    .slice()
    .sort(
      (left, right) =>
        new Date(left.tweet_created_at).getTime() - new Date(right.tweet_created_at).getTime(),
    );
  const associated: Array<FormalTiboResetSignal> = [];
  let previousResetAt: string | null = null;
  let index = 0;

  while (index < sortedResets.length) {
    const groupTime = new Date(sortedResets[index].tweet_created_at).getTime();
    const groupPreviousResetAt = previousResetAt;
    while (
      index < sortedResets.length &&
      new Date(sortedResets[index].tweet_created_at).getTime() === groupTime
    ) {
      const signal = sortedResets[index];
      associated.push({
        ...signal,
        related_notice: findRelatedTiboNotice(signal, notices, groupPreviousResetAt),
      });
      index += 1;
    }
    previousResetAt = sortedResets[index - 1].tweet_created_at;
  }

  return associated.reverse();
}

async function getTiboSignalBundle(now: Date = new Date()): Promise<TiboSignalBundle> {
  const tiboCacheBoundary = getTiboCacheBoundary(now);
  const [activeResult, historyResult, recentResult] = await Promise.all([
    getCachedTiboSignals(tiboCacheBoundary),
    getCachedTiboHistorySignals(),
    getCachedTiboRecentSignals(),
  ]);
  const activeSignals = activeResult.data.filter((signal) => {
    if (signal.verification_status === "rejected") return false;
    if (!signal.expires_at) return false;
    const expiresTime = new Date(signal.expires_at).getTime();
    return !isNaN(expiresTime) && expiresTime > now.getTime();
  });
  const signals = historyResult.data;
  const recentSignalsSource = recentResult.data;
  const acceptedResets = signals.filter(isFormalTiboResetSignal);
  const notices = signals
    .map(toNoticeSignal)
    .filter((signal): signal is TiboNoticeSignal => Boolean(signal));

  const formalResets = associateTiboNotices(acceptedResets, notices);
  const recentSignals = recentSignalsSource.map((signal) => ({
    tweet_id: signal.tweet_id,
    signal_type: signal.signal_type,
    text: signal.text,
    tweet_url: signal.tweet_url,
    tweet_created_at: signal.tweet_created_at,
    detected_at: signal.detected_at ?? undefined,
    expires_at: signal.expires_at ?? undefined,
    verification_status: signal.verification_status,
    translated_text_ja: signal.translated_text_ja ?? null,
    translated_text_zh: signal.translated_text_zh ?? null,
    teaser_strength: signal.ai_teaser_strength ?? null,
    ai_temporal_expression: signal.ai_temporal_expression ?? null,
    ai_temporal_kind: signal.ai_temporal_kind ?? null,
    ai_temporal_precision: signal.ai_temporal_precision ?? null,
    ai_temporal_timezone: signal.ai_temporal_timezone ?? null,
    ai_temporal_confidence: signal.ai_temporal_confidence ?? null,
    expected_start_at: signal.expected_start_at ?? null,
    expected_end_at: signal.expected_end_at ?? null,
    temporal_resolution_status: signal.temporal_resolution_status ?? null,
    temporal_resolution_version: signal.temporal_resolution_version ?? null,
    is_reply: signal.is_reply ?? undefined,
  }));
  const rejectedResets = signals
    .filter(
      (signal) =>
        signal.signal_type === "reset_executed" &&
        signal.is_reply !== true &&
        (signal.confidence ?? 0) >= 0.95 &&
        signal.verification_status === "rejected",
    )
    .map(({ tweet_id, tweet_url, tweet_created_at }) => ({
      tweet_id,
      tweet_url,
      tweet_created_at,
    }));

  return {
    activeSignals,
    recentSignals,
    formalResets,
    rejectedResets,
    health: combineDataSourceHealth(
      activeResult.health,
      historyResult.health,
      recentResult.health,
    ),
  };
}

export async function fetchFormalTiboResetSignals(): Promise<Array<FormalTiboResetSignal>> {
  return (await getTiboSignalBundle()).formalResets;
}

export async function fetchRejectedTiboResetSignals(): Promise<Array<RejectedTiboResetSignal>> {
  return (await getTiboSignalBundle()).rejectedResets;
}

/**
 * Fetches recent active Tibo signals with dynamic time-filtering performed OUTSIDE the cache.
 */
export async function getActiveTiboSignals(): Promise<ActiveTiboSignal[]> {
  return (await getTiboSignalBundle()).activeSignals;
}

export async function fetchCurrentRadarData(
  options: { cache?: RequestCache; revalidate?: number; calculationNow?: Date } = {},
): Promise<RadarData> {
  const calculationNow = options.calculationNow ?? new Date();
  const checkedAt = calculationNow.toISOString();
  const [openAIStatus, tiboSignals, regularResetEvents] = await Promise.all([
    fetchOpenAIStatusSignals(options),
    getTiboSignalBundle(calculationNow),
    getCachedRegularResetEvents(),
  ]);

  return getLocalRadarData({
    checkedAt,
    calculationNow,
    dataHealth: createRadarDataHealth(
      checkedAt,
      combineDataSourceHealth(tiboSignals.health, regularResetEvents.health),
      openAIStatus.health,
    ),
    openAIStatus: openAIStatus.data,
    activeTiboSignals: tiboSignals.activeSignals,
    recentTiboSignals: tiboSignals.recentSignals,
    formalTiboResets: tiboSignals.formalResets,
    rejectedTiboResets: tiboSignals.rejectedResets,
    regularResetEvents: regularResetEvents.data,
  });
}

type SharedRadarCore = {
  data: RadarData;
  generatedAt: string;
};

/**
 * One locale-independent Data Cache entry feeds the pages and the API. Next's
 * persistent Data Cache keeps the last successful value available during a
 * stale-while-revalidate cycle and across normal cold starts.
 */
const getCachedRadarCore = unstable_cache(
  async (): Promise<SharedRadarCore> => {
    const data = await fetchCurrentRadarData({ cache: "no-store" });
    if (data.data_health?.overall === "degraded") {
      // Do not replace a healthy Data Cache entry with a partial live result.
      // Next can continue serving the previous value while this revalidates.
      throw new Error("required_source_degraded");
    }
    return {
      data,
      generatedAt: data.checked_at ?? new Date().toISOString(),
    };
  },
  ["radar-core-cache-v2"],
  {
    revalidate: RADAR_CORE_CACHE_TTL_SECONDS,
    tags: ["radar-data"],
  },
);

const getCachedTiboRecentSignals = unstable_cache(
  // The UI-only teaser aggregation may use replies; formal history uses the
  // separate reply-excluding cache above.
  () => fetchRawTiboHistorySignals(true),
  ["tibo-recent-signals-cache-v1"],
  {
    revalidate: 60,
    tags: ["radar-data"],
  },
);

function isOlderThanCacheTtl(generatedAt: string) {
  const generatedTime = new Date(generatedAt).getTime();
  return (
    !Number.isNaN(generatedTime) &&
    Date.now() - generatedTime > RADAR_CORE_CACHE_TTL_SECONDS * 1000
  );
}

async function getSafeRadarFallback(): Promise<SharedRadarCore> {
  const data = await fetchCurrentRadarData({ cache: "no-store" });
  return {
    data,
    generatedAt: data.checked_at ?? new Date().toISOString(),
  };
}

export async function fetchSharedRadarCore() {
  try {
    const core = await getCachedRadarCore();
    const stale = isOlderThanCacheTtl(core.generatedAt);
    if (stale) {
      console.warn("[Radar stale fallback] serving an older cached snapshot", {
        reason: "cached_data_stale",
      });
    }
    return {
      ...core,
      stale,
    };
  } catch {
    // A first-request failure has no Data Cache value to serve. The existing
    // local/static fallback remains renderable and is marked degraded/stale.
    console.warn("[Radar stale fallback] live radar data was unavailable", {
      reason: "live_data_unavailable",
    });
    try {
      const fallback = await getSafeRadarFallback();
      return { ...fallback, stale: true };
    } catch {
      const checkedAt = new Date().toISOString();
      const fallback = getLocalRadarData({
        checkedAt,
        dataHealth: {
          overall: "degraded",
          checkedAt,
          sources: {
            supabaseSignals: { state: "degraded", detail: "request_failed" },
            openAIStatus: { state: "degraded", detail: "request_failed" },
          },
        },
      });
      return { data: fallback, generatedAt: checkedAt, stale: true };
    }
  }
}

export async function fetchPublicRadarSnapshot(
  locale: Locale,
  options: { limitHistory?: boolean } = {},
): Promise<PublicRadarSnapshot> {
  const calculationNow = new Date();
  const core = await fetchSharedRadarCore();
  return toPublicRadarSnapshot(core.data, locale, {
    stale: core.stale,
    generatedAt: core.generatedAt,
    limitHistory: options.limitHistory,
    calculationNow,
  });
}

export async function fetchRadarPageData(locale: Locale) {
  const calculationNow = new Date();
  const core = await fetchSharedRadarCore();

  return {
    initialData: toPublicRadarSnapshot(core.data, locale, {
      stale: core.stale,
      generatedAt: core.generatedAt,
      calculationNow,
    }),
    randomResetHeatmapEventTimes: getRandomResetHeatmapEventTimes(core.data, calculationNow),
  };
}
