import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildHeartbeatRecord } from "../../../../../lib/radar/heartbeat";

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

function isMissingScanSummaryColumn(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === "PGRST204" ||
        error.message?.toLowerCase().includes("last_scan_summary")),
  );
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

    const supabase = getSupabaseServiceClient();
    const now = new Date();

    // 1. Fetch current heartbeat record
    const { data: existing } = await supabase
      .from("tibo_heartbeat")
      .select("*")
      .eq("id", "main")
      .single();

    const payload = buildHeartbeatRecord(body, existing, now);

    let { error } = await supabase
      .from("tibo_heartbeat")
      .upsert(payload, { onConflict: "id" });

    // Keep the heartbeat operational while an existing deployment is waiting
    // for the additive migration to reach its Supabase project.
    if (isMissingScanSummaryColumn(error)) {
      const { last_scan_summary: _ignoredSummary, ...legacyPayload } = payload;
      const retry = await supabase
        .from("tibo_heartbeat")
        .upsert(legacyPayload, { onConflict: "id" });
      error = retry.error;
    }

    if (error) {
      console.error("[Heartbeat Error] Supabase upsert failed:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      heartbeatCount: payload.heartbeat_count,
      maxGapSeconds: payload.max_gap_seconds,
      lastGapSeconds: payload.last_gap_seconds,
    });
  } catch (err: any) {
    console.error("[Heartbeat Error]", err);
    return NextResponse.json({ error: err.message || "Internal Error" }, { status: 500 });
  }
}
