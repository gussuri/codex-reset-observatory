import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getLatestRegularScheduleAnchorAt } from "@/lib/radar";
import { fetchCurrentRadarData } from "@/lib/radarFetch";
import { getDueRegularResetEventRows } from "@/lib/radar/regularResetSchedule";
import { isBearerAuthorizationValid } from "@/lib/security/bearerAuth";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

async function syncRegularResetEvents(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return response({ ok: false, error: "configuration_unavailable" }, 503);
  if (!isBearerAuthorizationValid(request.headers.get("authorization"), cronSecret)) {
    return response({ ok: false, error: "unauthorized" }, 401);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ ok: false, error: "configuration_unavailable" }, 503);
  }

  try {
    const now = new Date();
    const radarData = await fetchCurrentRadarData({
      cache: "no-store",
      bypassCache: true,
      calculationNow: now,
    });
    const supabaseHealth = radarData.data_health?.sources.supabaseSignals;
    if (!supabaseHealth || supabaseHealth.state !== "ok") {
      console.error("Regular reset event sync skipped", { detail: "source_unavailable" });
      return response({ ok: false, error: "source_unavailable" }, 503);
    }

    const latestAnchorAt = getLatestRegularScheduleAnchorAt(radarData, now);
    if (!latestAnchorAt) {
      console.error("Regular reset event sync skipped", { detail: "anchor_unavailable" });
      return response({ ok: false, error: "anchor_unavailable" }, 503);
    }

    const dueRows = getDueRegularResetEventRows(now, latestAnchorAt);
    if (dueRows.length > 0) {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });
      const { error } = await supabase
        .from("regular_reset_events")
        .upsert(dueRows, {
          onConflict: "schedule_key",
          ignoreDuplicates: true,
        });

      if (error) {
        console.error("Regular reset event sync failed", { detail: "database_error" });
        return response({ ok: false, error: "database_unavailable" }, 503);
      }
    }

    return response({ ok: true, dueCount: dueRows.length });
  } catch {
    console.error("Regular reset event sync failed", { detail: "request_failed" });
    return response({ ok: false, error: "database_unavailable" }, 503);
  }
}

export async function GET(request: NextRequest) {
  return syncRegularResetEvents(request);
}

export async function POST(request: NextRequest) {
  return syncRegularResetEvents(request);
}
