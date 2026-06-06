import { NextResponse } from "next/server";

const CURRENT_JSON_URL = "https://codex-reset-radar.pages.dev/current.json";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(CURRENT_JSON_URL, {
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${response.status}` },
        { status: 502 },
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch current.json";

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
