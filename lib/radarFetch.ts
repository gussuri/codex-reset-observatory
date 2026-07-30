import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { fetchOpenAIStatusSignals } from "@/lib/openaiStatus";
import { getLocalRadarData } from "@/lib/radar";
import type { RadarData } from "@/lib/radar";

export const API_CACHE_CONTROL = "s-maxage=300, stale-while-revalidate=600";

export type ActiveTiboSignal = {
  tweet_id: string;
  signal_type: "official_notice" | "reset_executed" | "teaser" | "irrelevant";
  text: string;
  tweet_url: string;
  tweet_created_at: string;
  detected_at: string;
  expires_at: string;
  verification_status: "auto_unverified" | "confirmed" | "rejected";
  confidence: number;
  classification_reason: string;
  is_reply?: boolean;
  is_quote?: boolean;
};

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

/**
 * Fetches recent active Tibo signals with dynamic time-filtering performed OUTSIDE the cache.
 */
export async function getActiveTiboSignals(): Promise<ActiveTiboSignal[]> {
  const cachedSignals = await getCachedTiboSignals();
  const now = Date.now();

  // Dynamic filtering outside the cache on every request
  return cachedSignals.filter((signal) => {
    if (signal.verification_status === "rejected") return false;
    const expiresTime = new Date(signal.expires_at).getTime();
    return !isNaN(expiresTime) && expiresTime > now;
  });
}

export async function fetchCurrentRadarData(
  options: { cache?: RequestCache; revalidate?: number } = {},
): Promise<RadarData> {
  const openAIStatus = await fetchOpenAIStatusSignals(options);
  const activeSignals = await getActiveTiboSignals();

  return getLocalRadarData({
    openAIStatus,
    activeTiboSignals: activeSignals,
  });
}
