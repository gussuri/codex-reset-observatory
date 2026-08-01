import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { fetchOpenAIStatusSignals } from "@/lib/openaiStatus";
import { getLocalRadarData } from "@/lib/radar";
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
  RadarData,
} from "@/lib/radar/types";
import {
  findRelatedTiboNotice,
  isFormalTiboResetSignal,
  type FormalTiboResetSignal,
  type RejectedTiboResetSignal,
  type TiboNoticeSignal,
} from "@/lib/radar/tiboHistory";

export const API_CACHE_CONTROL = "s-maxage=300, stale-while-revalidate=600";

// 1. Raw Supabase fetch function
async function fetchRawTiboSignals(): Promise<DataFetchResult<ActiveTiboSignal[]>> {
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
      .from("tibo_signals")
      .select("*")
      .order("tweet_created_at", { ascending: false })
      .limit(20);

    const health = getDatabaseReadHealth(configuration, {
      hasData: data !== null,
      hasError: Boolean(error),
    });
    if (error) {
      console.error("Active Tibo signals query failed", error);
    }
    return { data: data ? (data as ActiveTiboSignal[]) : [], health };
  } catch (error) {
    console.error("Failed to load active Tibo signals", error);
    return { data: [], health: { state: "degraded", detail: "request_failed" } };
  }
}

// 2. Module-scoped unstable_cache wrapper (60s TTL, tagged "radar-data")
const getCachedTiboSignals = unstable_cache(
  fetchRawTiboSignals,
  ["tibo-signals-cache"],
  {
    revalidate: 60,
    tags: ["radar-data"],
  }
);

async function fetchRawTiboHistorySignals(): Promise<DataFetchResult<Array<FormalTiboResetSignal>>> {
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
      .from("tibo_signals")
      .select(
        "tweet_id,text,tweet_url,tweet_created_at,detected_at,expires_at,signal_type,confidence,verification_status,classification_source,ai_classification_status,ai_reset_type_ja,ai_notice_to_execution",
      )
      .in("signal_type", ["reset_executed", "official_notice", "teaser"])
      .order("tweet_created_at", { ascending: false })
      .limit(1000);

    const health = getDatabaseReadHealth(configuration, {
      hasData: data !== null,
      hasError: Boolean(error),
    });
    if (error) {
      console.error("Tibo reset history query failed", error);
    }
    return {
      data: data ? (data as Array<FormalTiboResetSignal>) : [],
      health,
    };
  } catch (error) {
    console.error("Failed to load Tibo reset history", error);
    return { data: [], health: { state: "degraded", detail: "request_failed" } };
  }
}

const getCachedTiboHistorySignals = unstable_cache(
  fetchRawTiboHistorySignals,
  ["tibo-history-signals-cache"],
  {
    revalidate: 60,
    tags: ["radar-data"],
  },
);

function toNoticeSignal(signal: FormalTiboResetSignal): TiboNoticeSignal | null {
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
  formalResets: Array<FormalTiboResetSignal>;
  rejectedResets: Array<RejectedTiboResetSignal>;
  health: DataSourceHealth;
};

async function getTiboSignalBundle(): Promise<TiboSignalBundle> {
  const [activeResult, historyResult] = await Promise.all([
    getCachedTiboSignals(),
    getCachedTiboHistorySignals(),
  ]);
  const now = Date.now();
  const activeSignals = activeResult.data.filter((signal) => {
    if (signal.verification_status === "rejected") return false;
    if (!signal.expires_at) return false;
    const expiresTime = new Date(signal.expires_at).getTime();
    return !isNaN(expiresTime) && expiresTime > now;
  });
  const signals = historyResult.data;
  const acceptedResets = signals.filter(isFormalTiboResetSignal);
  const notices = signals
    .map(toNoticeSignal)
    .filter((signal): signal is TiboNoticeSignal => Boolean(signal));

  const formalResets = acceptedResets.map((signal) => {
    const resetTime = new Date(signal.tweet_created_at).getTime();
    const previousReset = acceptedResets
      .filter((candidate) => new Date(candidate.tweet_created_at).getTime() < resetTime)
      .sort(
        (left, right) =>
          new Date(right.tweet_created_at).getTime() - new Date(left.tweet_created_at).getTime(),
      )[0];

    return {
      ...signal,
      related_notice: findRelatedTiboNotice(
        signal,
        notices,
        previousReset?.tweet_created_at ?? null,
      ),
    };
  });
  const rejectedResets = signals
    .filter(
      (signal) =>
        signal.signal_type === "reset_executed" &&
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
    formalResets,
    rejectedResets,
    health: combineDataSourceHealth(activeResult.health, historyResult.health),
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
  options: { cache?: RequestCache; revalidate?: number } = {},
): Promise<RadarData> {
  const checkedAt = new Date().toISOString();
  const [openAIStatus, tiboSignals] = await Promise.all([
    fetchOpenAIStatusSignals(options),
    getTiboSignalBundle(),
  ]);

  return getLocalRadarData({
    checkedAt,
    dataHealth: createRadarDataHealth(
      checkedAt,
      tiboSignals.health,
      openAIStatus.health,
    ),
    openAIStatus: openAIStatus.data,
    activeTiboSignals: tiboSignals.activeSignals,
    formalTiboResets: tiboSignals.formalResets,
    rejectedTiboResets: tiboSignals.rejectedResets,
  });
}
