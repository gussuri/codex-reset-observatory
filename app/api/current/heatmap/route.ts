import { NextResponse } from "next/server";
import {
  fetchRandomResetHeatmapEventTimes,
  PUBLIC_RADAR_SNAPSHOT_BUCKET_SECONDS,
} from "@/lib/radarFetch";

export const dynamic = "force-dynamic";

const MAX_CALCULATION_AGE_MS = PUBLIC_RADAR_SNAPSHOT_BUCKET_SECONDS * 2 * 1000;

function getCalculationTime(value: string | null) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() - timestamp) > MAX_CALCULATION_AGE_MS
  ) {
    return new Date();
  }
  return new Date(timestamp);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const calculationAt = getCalculationTime(requestUrl.searchParams.get("calculationAt"));
  const eventTimes = await fetchRandomResetHeatmapEventTimes(calculationAt);

  return NextResponse.json(
    { eventTimes },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
