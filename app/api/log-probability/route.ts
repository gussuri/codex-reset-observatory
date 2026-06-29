import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchCurrentRadarData } from "@/lib/radarFetch";
import { getRadarViewModel } from "@/lib/radar";
import { getSignalEnvironment, getLatestActiveLocalSignal } from "@/lib/radar/probability";

export const dynamic = "force-dynamic";

let supabaseInstance: any = null;

function getSupabaseClient() {
  if (supabaseInstance) return supabaseInstance;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase environment variables (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) are missing.");
  }

  supabaseInstance = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
  return supabaseInstance;
}

async function handleLogRequest(request: NextRequest) {
  // Authorization ヘッダーによる認証
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. 最新の観測データをフェッチ
    const rawData = await fetchCurrentRadarData({ cache: "no-store" });
    
    // 2. ViewModel を構築して確率等を計算
    const viewModel = getRadarViewModel(rawData, "ja");

    // 3. パラメータや各種フラグの抽出
    const environment = getSignalEnvironment(rawData);
    const officialNotice = getLatestActiveLocalSignal("official_notice");
    
    const hasOfficialNotice = !!officialNotice;
    const incidentHintCount = environment.official_incident_hints_24h ?? 0;
    const statusIncidentCount = environment.status_incidents_24h ?? 0;

    // 期待度（日本語）を英語キーに変換
    const expectationMap: Record<string, string> = {
      "低": "low",
      "中": "medium",
      "高": "high",
      "超高": "very_high",
    };
    const expectationKey = expectationMap[viewModel.expectation] ?? "unknown";

    // 4. 重複排除用の logged_hour の計算 (時分秒を 00:00:00 に丸める)
    const loggedHour = new Date();
    loggedHour.setMinutes(0, 0, 0);
    loggedHour.setMilliseconds(0);

    // 5. Supabase への保存 (logged_hour が衝突した場合は upsert で上書き)
    const supabase = getSupabaseClient();
    const { data: insertedRows, error } = await supabase
      .from("prediction_history")
      .upsert(
        {
          logged_hour: loggedHour.toISOString(),
          probability_24h: viewModel.probability24h,
          probability_48h: viewModel.probability48h,
          expectation: expectationKey,
          reasons: viewModel.reasoningSummary,
          official_notice: hasOfficialNotice,
          incident_hint: incidentHintCount,
          status_incidents: statusIncidentCount,
          debug_info: {
            logged_at: new Date().toISOString(),
            complaint_pressure: environment.complaint_pressure,
            openai_status_active_codex_incidents: environment.openai_status_active_codex_incidents,
          },
        },
        {
          onConflict: "logged_hour",
        }
      )
      .select();

    if (error) {
      console.error("Supabase upsert error:", error);
      return NextResponse.json({ error: "Database save failed", details: error.message }, { status: 500 });
    }

    const savedRecord = insertedRows && insertedRows.length > 0 ? insertedRows[0] : null;
    const recordedAt = savedRecord?.recorded_at || new Date().toISOString();

    return NextResponse.json({
      ok: true,
      action: "upserted",
      logged_hour: loggedHour.toISOString(),
      recorded_at: recordedAt,
      probability_24h: viewModel.probability24h,
      probability_48h: viewModel.probability48h,
      expectation: expectationKey,
    });
  } catch (err: any) {
    console.error("Log probability execution error:", err);
    return NextResponse.json({ error: "Internal Server Error", details: err?.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleLogRequest(request);
}

export async function POST(request: NextRequest) {
  return handleLogRequest(request);
}
