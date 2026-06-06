import { NextResponse } from "next/server";
import { API_CACHE_CONTROL, fetchCurrentRadarData } from "@/lib/radarFetch";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await fetchCurrentRadarData({ cache: "no-store" });

  if (!data) {
    return NextResponse.json(
      { error: "Failed to fetch current data" },
      { status: 502 },
    );
  }

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": API_CACHE_CONTROL,
    },
  });
}
