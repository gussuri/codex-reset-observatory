import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST } from "../app/api/webhook/tibo/route";

const ENV_KEYS = [
  "TIBO_WEBHOOK_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_CLASSIFICATION_MODE",
] as const;

function restoreEnvironment(previous: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function buildRequest() {
  return new NextRequest("http://localhost/api/webhook/tibo", {
    method: "POST",
    headers: {
      authorization: "Bearer test-webhook-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      tweetId: "2084000000000000200",
      text: "I reset usage limits for Codex.",
      tweetUrl: "https://x.com/thsottiaux/status/2084000000000000200",
      tweetCreatedAt: "2026-08-04T00:00:00.000Z",
    }),
  });
}

test("Tibo state SELECT failure fails closed before upsert or formal adoption", async () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const fetchMethods: string[] = [];
  const infoMessages: unknown[][] = [];

  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "off";
  globalThis.fetch = async (input, init) => {
    fetchMethods.push(init?.method ?? (input instanceof Request ? input.method : "GET"));
    return new Response(JSON.stringify({ code: "PGRST_TEST", message: "lookup failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  };
  console.info = (...args: unknown[]) => {
    infoMessages.push(args);
  };

  try {
    const response = await POST(buildRequest());
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.deepEqual(body, { error: "Tibo state lookup unavailable" });
    assert.deepEqual(fetchMethods, ["GET"]);
    assert.equal(infoMessages.length, 0);
    assert.equal(JSON.stringify(body).includes("test-service-role-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    restoreEnvironment(previous);
  }
});
