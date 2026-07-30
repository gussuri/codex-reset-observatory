import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase Service Role configuration.");
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    // Fail closed if TIBO_WEBHOOK_SECRET is not configured
    const expectedSecret = process.env.TIBO_WEBHOOK_SECRET;
    if (!expectedSecret) {
      return NextResponse.json(
        { error: "Server Configuration Error: TIBO_WEBHOOK_SECRET is not configured." },
        { status: 503 }
      );
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");

    if (!token || token !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      sessionId,
      lastSuccessfulParseAt,
      lastSeenTweetId,
      lastScanError,
      selectorVersion,
    } = body;

    const supabase = getSupabaseServiceClient();
    const now = new Date();

    // 1. Fetch current heartbeat record
    const { data: existing } = await supabase
      .from("tibo_heartbeat")
      .select("*")
      .eq("id", "main")
      .single();

    let sessionStartedAt = existing?.session_started_at || now.toISOString();
    let heartbeatCount = (existing?.heartbeat_count || 0) + 1;
    let maxGapSeconds = existing?.max_gap_seconds || 0;
    let lastGapSeconds = 0;

    // 2. New session reset logic (only when sessionId changes)
    const isNewSession = existing?.session_id !== sessionId;
    if (isNewSession) {
      sessionStartedAt = now.toISOString();
      heartbeatCount = 1;
      maxGapSeconds = 0;
      lastGapSeconds = 0;
    } else if (existing?.last_heartbeat_at) {
      const prevTime = new Date(existing.last_heartbeat_at).getTime();
      lastGapSeconds = Math.max(0, Math.floor((now.getTime() - prevTime) / 1000));
      if (lastGapSeconds > maxGapSeconds) {
        maxGapSeconds = lastGapSeconds;
      }
    }

    const payload = {
      id: "main",
      session_id: sessionId || "default_session",
      session_started_at: sessionStartedAt,
      last_heartbeat_at: now.toISOString(),
      last_successful_parse_at: lastSuccessfulParseAt || null,
      last_seen_tweet_id: lastSeenTweetId || null,
      last_scan_error: lastScanError || null,
      selector_version: selectorVersion || "v1",
      heartbeat_count: heartbeatCount,
      max_gap_seconds: maxGapSeconds,
      last_gap_seconds: lastGapSeconds,
      updated_at: now.toISOString(),
    };

    const { error } = await supabase
      .from("tibo_heartbeat")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.error("[Heartbeat Error] Supabase upsert failed:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      heartbeatCount,
      maxGapSeconds,
      lastGapSeconds,
    });
  } catch (err: any) {
    console.error("[Heartbeat Error]", err);
    return NextResponse.json({ error: err.message || "Internal Error" }, { status: 500 });
  }
}
