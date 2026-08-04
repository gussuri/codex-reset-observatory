import { NextRequest, NextResponse } from "next/server";

import { SITE_URL } from "@/lib/siteMetadata";

const LEGACY_HOST = "codex-reset-observatory.vercel.app";

export function middleware(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase();
  if (hostname !== LEGACY_HOST) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  // Keep legacy API endpoints available during the extension domain migration.
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const destination = new URL(`${SITE_URL}/`);
  destination.pathname = pathname;
  destination.search = request.nextUrl.search;
  return NextResponse.redirect(destination, 308);
}

export const config = {
  matcher: ["/:path*"],
};
