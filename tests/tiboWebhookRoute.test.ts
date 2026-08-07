import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST } from "../app/api/webhook/tibo/route";

const ENV_KEYS = [
  "TIBO_WEBHOOK_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_CLASSIFICATION_MODE",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_TRANSLATION_MODE",
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

function buildRequest(overrides: Record<string, unknown> = {}) {
  const body = {
    tweetId: "2084000000000000200",
    text: "I reset usage limits for Codex.",
    tweetUrl: "https://x.com/thsottiaux/status/2084000000000000200",
    tweetCreatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
  return new NextRequest("http://localhost/api/webhook/tibo", {
    method: "POST",
    headers: {
      authorization: "Bearer test-webhook-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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
  process.env.GEMINI_TRANSLATION_MODE = "off";
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

test("new reply metadata is validated and persisted while old payload fields remain compatible", async () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  const originalFetch = globalThis.fetch;
  const fetchMethods: string[] = [];
  const requestBodies: unknown[] = [];

  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "off";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  globalThis.fetch = async (input, init) => {
    fetchMethods.push(init?.method ?? (input instanceof Request ? input.method : "GET"));
    if (init?.body) requestBodies.push(JSON.parse(String(init.body)));
    if (fetchMethods.length === 1) {
      return new Response(JSON.stringify({ data: null, error: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [], error: null }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await POST(
      buildRequest({
        isReply: true,
        replyToHandles: ["alice"],
        replyContextText: "A reset is coming soon.",
        sourceTimeline: "with_replies",
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(fetchMethods, ["GET", "POST"]);
    const upsertBody = requestBodies[0] as Record<string, unknown>;
    assert.equal(upsertBody.is_reply, true);
    assert.deepEqual(upsertBody.reply_to_handles, ["@alice"]);
    assert.equal(upsertBody.reply_context_text, "A reset is coming soon.");
    assert.equal(upsertBody.source_timeline, "with_replies");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("automatically stores Gemini Japanese and Chinese translations without changing the webhook response", async () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  const originalFetch = globalThis.fetch;
  const fetchMethods: string[] = [];
  const requestBodies: unknown[] = [];

  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "off";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  process.env.GEMINI_TRANSLATION_MODE = "on";
  globalThis.fetch = async (input, init) => {
    fetchMethods.push(init?.method ?? (input instanceof Request ? input.method : "GET"));
    if (init?.body) requestBodies.push(JSON.parse(String(init.body)));
    if (fetchMethods.length === 1) {
      return new Response(JSON.stringify({ data: null, error: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (fetchMethods.length === 2) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      ja: "Codexの利用上限をリセットしました。",
                      zh: "我已重置 Codex 的使用上限。",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ data: [], error: null }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await POST(
      buildRequest({
        text: "I reset usage limits for Codex.\nEnjoy!",
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(fetchMethods, ["GET", "POST", "POST"]);
    const upsertBody = requestBodies[1] as Record<string, unknown>;
    assert.equal(upsertBody.translated_text_ja, "Codexの利用上限をリセットしました。");
    assert.equal(upsertBody.translated_text_zh, "我已重置 Codex 的使用上限。");
    const responseBody = await response.json();
    assert.equal(responseBody.success, true);
    assert.equal("translated_text_ja" in responseBody, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});
