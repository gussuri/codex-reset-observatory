import { NextResponse } from "next/server";
import { API_CACHE_CONTROL, fetchPublicRadarSnapshot } from "@/lib/radarFetch";
import type { Locale } from "@/lib/radar/types";

export const dynamic = "force-dynamic";

function getLocale(value: string | null): Locale {
  return value === "en" || value === "zh" ? value : "ja";
}

export async function GET(request: Request) {
  const locale = getLocale(new URL(request.url).searchParams.get("locale"));
  const data = await fetchPublicRadarSnapshot(locale);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": API_CACHE_CONTROL,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
