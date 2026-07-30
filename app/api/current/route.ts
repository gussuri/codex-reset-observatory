import { NextResponse } from "next/server";
import { API_CACHE_CONTROL, fetchCurrentRadarData } from "@/lib/radarFetch";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await fetchCurrentRadarData({ cache: "no-store" });

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
