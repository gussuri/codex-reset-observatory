import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GA4_ID_PATTERN = /^G-[A-Z0-9]{10}$/;

export function readWranglerGaMeasurementId(wranglerPath = resolve(process.cwd(), "wrangler.jsonc")) {
  const raw = readFileSync(wranglerPath, "utf8");
  const parsed = JSON.parse(raw);
  const candidate = parsed?.vars?.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (typeof candidate !== "string") {
    return undefined;
  }
  const trimmed = candidate.trim();
  return GA4_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * @param {Record<string, string | undefined>} [baseEnv]
 * @param {string} [wranglerPath]
 * @returns {Record<string, string | undefined>}
 */
export function resolveCloudflareNextBuildEnv(
  baseEnv = process.env,
  wranglerPath = resolve(process.cwd(), "wrangler.jsonc"),
) {
  const resolved = { ...baseEnv };
  if (!resolved.NEXT_PUBLIC_GA_MEASUREMENT_ID) {
    const wranglerId = readWranglerGaMeasurementId(wranglerPath);
    if (wranglerId) {
      resolved.NEXT_PUBLIC_GA_MEASUREMENT_ID = wranglerId;
    }
  }
  if (!resolved.NEXT_PUBLIC_VERCEL_ENV) {
    resolved.NEXT_PUBLIC_VERCEL_ENV = resolved.VERCEL_ENV || "production";
  }
  return resolved;
}

function runNextBuild() {
  const require = createRequire(import.meta.url);
  const nextPkgPath = require.resolve("next/package.json");
  const nextBin = join(dirname(nextPkgPath), "dist", "bin", "next");
  const env = resolveCloudflareNextBuildEnv();

  const result = spawnSync(process.execPath, [nextBin, "build"], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  runNextBuild();
}
