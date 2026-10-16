import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as postLogProbability } from "../app/api/log-probability/route";
import { getRadarViewModel, getLocalRadarData } from "../lib/radar";
import { hasOfficialNoticeForLog } from "../lib/logProbability";

test("log probability marks a dynamic official notice as official", () => {
  const calculationNow = new Date("2026-08-05T00:00:00.000Z");
  const now = calculationNow.getTime();
  const data = getLocalRadarData({
    activeTiboSignals: [
      {
        tweet_id: "route-reset",
        signal_type: "reset_executed",
        confidence: 0.98,
        tweet_created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
      {
        tweet_id: "route-notice",
        signal_type: "official_notice",
        text: "A dynamic official reset notice",
        confidence: 0.96,
        tweet_created_at: new Date(now).toISOString(),
        expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        verification_status: "auto_unverified",
      },
    ],
    calculationNow,
  });

  const viewModel = getRadarViewModel(data, "ja", false, undefined, calculationNow);

  assert.equal(viewModel.activeWindow.active, true);
  assert.equal(viewModel.activeWindow.kind, "official");
  assert.equal(hasOfficialNoticeForLog(viewModel), true);
});

test("route passes bypassCache: true to fetchCurrentRadarDataWithTrainingState", () => {
  const source = readFileSync(resolve("app/api/log-probability/route.ts"), "utf8");
  assert.match(
    source,
    /fetchCurrentRadarDataWithTrainingState\(\{[\s\S]*?bypassCache:\s*true[\s\S]*?\}\)/,
  );
});

test("route guards against degraded data or error training state before persistence", () => {
  const source = readFileSync(resolve("app/api/log-probability/route.ts"), "utf8");
  assert.match(
    source,
    /rawData\.data_health\?\.overall === "degraded"\s*\|\|\s*trainingState\?\.status === "error"/,
  );
  assert.match(
    source,
    /status:\s*503/,
  );
});

test("postLogProbability skips persistence and returns 503 when upstream data health is degraded", async () => {
  const previous = {
    CRON_SECRET: process.env.CRON_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = globalThis.fetch;

  process.env.CRON_SECRET = "test-cron-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  let saveAttempted = false;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("status.openai.com")) {
      return new Response("degraded", { status: 503 });
    }
    if (url.includes("prediction_history") && input instanceof Request && input.method === "POST") {
      saveAttempted = true;
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = await postLogProbability(
      new NextRequest("http://localhost/api/log-probability", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.skipped, true);
    assert.match(body.reason, /upstream data health is degraded/);
    assert.equal(saveAttempted, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key as keyof typeof previous] = value;
    }
  }
});

test("postLogProbability skips persistence and returns 503 when training state has error", async () => {
  const previous = {
    CRON_SECRET: process.env.CRON_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = globalThis.fetch;

  process.env.CRON_SECRET = "test-cron-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  let saveAttempted = false;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (url.includes("summary.json")) {
      return new Response(JSON.stringify({
        page: { updated_at: "2026-08-05T00:00:00.000Z" },
        status: { indicator: "none" },
        components: [],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("incidents.json")) {
      return new Response(JSON.stringify({
        page: { updated_at: "2026-08-05T00:00:00.000Z" },
        incidents: [],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("prediction_history") && method === "GET") {
      return new Response(
        JSON.stringify({ code: "PGRST500", message: "prediction_history read error" }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("prediction_history") && method === "POST") {
      saveAttempted = true;
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = await postLogProbability(
      new NextRequest("http://localhost/api/log-probability", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.skipped, true);
    assert.match(body.reason, /training state error/);
    assert.equal(saveAttempted, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key as keyof typeof previous] = value;
    }
  }
});
