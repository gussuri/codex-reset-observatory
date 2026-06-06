import { NextResponse } from "next/server";

const CURRENT_JSON_URL = "https://codex-reset-radar.pages.dev/current.json";
const FETCH_TIMEOUT_MS = 8000;

export const dynamic = "force-dynamic";

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CURRENT_JSON_URL, {
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch current data" },
        { status: 502 },
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch current data" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
