import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { fetchOpenAIStatusSignals } from "@/lib/openaiStatus";
import { getLocalRadarData } from "@/lib/radar";
import type { ActiveTiboSignal, RadarData } from "@/lib/radar/types";
import {
  findRelatedTiboNotice,
  isFormalTiboResetSignal,
  type FormalTiboResetSignal,
  type RejectedTiboResetSignal,
  type TiboNoticeSignal,
} from "@/lib/radar/tiboHistory";

export const API_CACHE_CONTROL = "s-maxage=300, stale-while-revalidate=600";

// 1. Raw Supabase fetch function
async function fetchRawTiboSignals(): Promise<ActiveTiboSignal[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return [];
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

    if (error || !data) {
      return [];
    }

    return data as ActiveTiboSignal[];
  } catch {
    return [];
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

async function fetchRawTiboHistorySignals(): Promise<Array<FormalTiboResetSignal>> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return [];
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

    if (error || !data) {
      return [];
    }

    return data as Array<FormalTiboResetSignal>;
  } catch {
    return [];
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

export async function fetchFormalTiboResetSignals(): Promise<Array<FormalTiboResetSignal>> {
  const signals = await getCachedTiboHistorySignals();
  const acceptedResets = signals.filter(isFormalTiboResetSignal);
  const notices = signals
    .map(toNoticeSignal)
    .filter((signal): signal is TiboNoticeSignal => Boolean(signal));

  return acceptedResets.map((signal) => {
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
}

export async function fetchRejectedTiboResetSignals(): Promise<Array<RejectedTiboResetSignal>> {
  const signals = await getCachedTiboHistorySignals();

  return signals
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
}

/**
 * Fetches recent active Tibo signals with dynamic time-filtering performed OUTSIDE the cache.
 */
export async function getActiveTiboSignals(): Promise<ActiveTiboSignal[]> {
  const cachedSignals = await getCachedTiboSignals();
  const now = Date.now();

  // Dynamic filtering outside the cache on every request
  return cachedSignals.filter((signal) => {
    if (signal.verification_status === "rejected") return false;
    if (!signal.expires_at) return false;
    const expiresTime = new Date(signal.expires_at).getTime();
    return !isNaN(expiresTime) && expiresTime > now;
  });
}

export async function fetchCurrentRadarData(
  options: { cache?: RequestCache; revalidate?: number } = {},
): Promise<RadarData> {
  const [openAIStatus, activeSignals, formalTiboResets, rejectedTiboResets] = await Promise.all([
    fetchOpenAIStatusSignals(options),
    getActiveTiboSignals(),
    fetchFormalTiboResetSignals(),
    fetchRejectedTiboResetSignals(),
  ]);

  return getLocalRadarData({
    openAIStatus,
    activeTiboSignals: activeSignals,
    formalTiboResets,
    rejectedTiboResets,
  });
}
