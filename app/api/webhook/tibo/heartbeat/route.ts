import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildHeartbeatRecord,
  isStaleHeartbeatPayload,
  isMissingHeartbeatDiagnosticColumn,
  withoutHeartbeatDiagnosticColumns,
  type ExistingHeartbeatRecord,
  type HeartbeatRecord,
} from "../../../../../lib/radar/heartbeat";
import { isBearerAuthorizationValid } from "../../../../../lib/security/bearerAuth";

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

const MAX_HEARTBEAT_CAS_ATTEMPTS = 3;

function nextUpdatedAt(now: Date, existing: ExistingHeartbeatRecord | null): string {
  const previousUpdatedAt = existing?.updated_at ? new Date(existing.updated_at).getTime() : NaN;
  const nextTime = Number.isFinite(previousUpdatedAt)
    ? Math.max(now.getTime(), previousUpdatedAt + 1)
    : now.getTime();
  return new Date(nextTime).toISOString();
}

async function writeHeartbeatCas(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  payload: HeartbeatRecord | ReturnType<typeof withoutHeartbeatDiagnosticColumns>,
  existing: ExistingHeartbeatRecord | null,
) {
  if (!existing) {
    return supabase
      .from("tibo_heartbeat")
      .insert(payload)
      .select("id")
      .maybeSingle();
  }

  let update = supabase
    .from("tibo_heartbeat")
    .update(payload)
    .eq("id", "main");
  update = existing.updated_at
    ? update.eq("updated_at", existing.updated_at)
    : update.is("updated_at", null);
  return update.select("id").maybeSingle();
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

    if (!isBearerAuthorizationValid(req.headers.get("authorization"), expectedSecret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    const supabase = getSupabaseServiceClient();

    for (let attempt = 0; attempt < MAX_HEARTBEAT_CAS_ATTEMPTS; attempt += 1) {
      const { data: existing, error: readError } = await supabase
        .from("tibo_heartbeat")
        .select("*")
        .eq("id", "main")
        .single();

      if (readError && readError.code !== "PGRST116") {
        console.error("[Heartbeat Error] Supabase read failed:", readError);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      const existingRecord = (readError?.code === "PGRST116" ? null : existing) as ExistingHeartbeatRecord | null;
      if (isStaleHeartbeatPayload(body, existingRecord)) {
        return NextResponse.json({ success: true, stale: true });
      }

      const now = new Date();
      const payload = buildHeartbeatRecord(body, existingRecord, now);
      payload.updated_at = nextUpdatedAt(now, existingRecord);

      let writeResult = await writeHeartbeatCas(supabase, payload, existingRecord);
      if (isMissingHeartbeatDiagnosticColumn(writeResult.error)) {
        const legacyPayload = withoutHeartbeatDiagnosticColumns(payload);
        writeResult = await writeHeartbeatCas(supabase, legacyPayload, existingRecord);
      }

      if (
        writeResult.error?.code === "23505" ||
        writeResult.error?.code === "PGRST116" ||
        (!writeResult.error && !writeResult.data)
      ) {
        continue;
      }
      if (writeResult.error) {
        console.error("[Heartbeat Error] Supabase compare-and-swap failed:", writeResult.error);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        heartbeatCount: payload.heartbeat_count,
        maxGapSeconds: payload.max_gap_seconds,
        lastGapSeconds: payload.last_gap_seconds,
      });
    }

    return NextResponse.json({ error: "Heartbeat changed concurrently; retry later." }, { status: 503 });
  } catch (err: any) {
    console.error("[Heartbeat Error]", err);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
