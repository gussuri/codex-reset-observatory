import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config.mjs";
import {
  readWranglerGaMeasurementId,
  resolveCloudflareNextBuildEnv,
} from "../scripts/cloudflare-next-build.mjs";
import { isAnalyticsHostAllowed, isValidGa4MeasurementId } from "../lib/sponsorAnalytics";

test("wrangler.jsonc defines a valid GA4 measurement ID for Cloudflare builds", () => {
  const measurementId = readWranglerGaMeasurementId();
  assert.ok(measurementId, "wrangler.jsonc vars.NEXT_PUBLIC_GA_MEASUREMENT_ID must be set");
  assert.equal(isValidGa4MeasurementId(measurementId), true);
});

test("resolveCloudflareNextBuildEnv supplies GA4 ID and production host restriction for OpenNext builds", () => {
  const env = resolveCloudflareNextBuildEnv({});
  assert.equal(isValidGa4MeasurementId(env.NEXT_PUBLIC_GA_MEASUREMENT_ID), true);
  assert.equal(env.NEXT_PUBLIC_VERCEL_ENV, "production");
  assert.equal(
    isAnalyticsHostAllowed("codex.gussuriworks.com", env.NEXT_PUBLIC_VERCEL_ENV),
    true,
  );
  assert.equal(
    isAnalyticsHostAllowed("preview.codex-reset-observatory.workers.dev", env.NEXT_PUBLIC_VERCEL_ENV),
    false,
  );

  const explicit = resolveCloudflareNextBuildEnv({
    NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-CUSTOM1234",
    NEXT_PUBLIC_VERCEL_ENV: "preview",
  });
  assert.equal(explicit.NEXT_PUBLIC_GA_MEASUREMENT_ID, "G-CUSTOM1234");
  assert.equal(explicit.NEXT_PUBLIC_VERCEL_ENV, "preview");
});

test("nextConfig CSP allows both GA4 and Cloudflare Web Analytics when built with Cloudflare env", async () => {
  const originalMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const originalVercelEnv = process.env.VERCEL_ENV;
  try {
    const cfEnv = resolveCloudflareNextBuildEnv({});
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = cfEnv.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    delete process.env.VERCEL_ENV;

    const routes = await nextConfig.headers();
    const policy = routes[0]?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    assert.ok(policy);
    assert.match(policy, /script-src[^;]*https:\/\/www\.googletagmanager\.com/i);
    assert.match(policy, /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/i);
    assert.match(policy, /connect-src[^;]*https:\/\/\*\.google-analytics\.com/i);
    assert.match(policy, /connect-src[^;]*https:\/\/cloudflareinsights\.com/i);
  } finally {
    if (originalMeasurementId === undefined) {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    } else {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalMeasurementId;
    }
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
  }
});
