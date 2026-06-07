import type { MetadataRoute } from "next";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = "https://codex-reset-observatory.vercel.app";
const APP_DIR = join(process.cwd(), "app");
const PAGE_FILE_PATTERN = /^page\.(tsx|ts|jsx|js|mdx)$/;
const IGNORED_SEGMENTS = new Set(["api"]);

export default function sitemap(): MetadataRoute.Sitemap {
  return getPublicRoutes().map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: "hourly",
    priority: route === "/" ? 1 : 0.7,
  }));
}

function getPublicRoutes() {
  return Array.from(new Set(readRoutes(APP_DIR))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function readRoutes(directory: string, segments: string[] = []): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const routes: string[] = [];

  if (entries.some((entry) => PAGE_FILE_PATTERN.test(entry.name))) {
    routes.push(toRoutePath(segments));
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_SEGMENTS.has(entry.name)) {
      continue;
    }

    const childDirectory = join(directory, entry.name);

    if (!statSync(childDirectory).isDirectory()) {
      continue;
    }

    routes.push(...readRoutes(childDirectory, [...segments, entry.name]));
  }

  return routes;
}

function toRoutePath(segments: string[]) {
  const visibleSegments = segments.filter(
    (segment) => !segment.startsWith("(") && !segment.startsWith("_"),
  );

  return visibleSegments.length > 0 ? `/${visibleSegments.join("/")}` : "/";
}
