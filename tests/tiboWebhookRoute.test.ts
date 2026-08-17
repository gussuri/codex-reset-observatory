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

test("empty and whitespace-only source text are rejected before any database call", async () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  };

  try {
    for (const text of ["", "   \n\t"]) {
      const response = await POST(buildRequest({ text }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Invalid text" });
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
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
        isQuote: true,
        quoteContextText: "So what about our reset?",
        quoteTweetUrl: "https://x.com/blueemi99/status/9876543210",
        quoteAuthorHandle: "@blueemi99",
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(fetchMethods, ["GET", "POST"]);
    const upsertBody = requestBodies[0] as Record<string, unknown>;
    assert.equal(upsertBody.is_reply, true);
    assert.deepEqual(upsertBody.reply_to_handles, ["@alice"]);
    assert.equal(upsertBody.reply_context_text, "A reset is coming soon.");
    assert.equal(upsertBody.source_timeline, "with_replies");
    assert.equal(upsertBody.is_quote, true);
    assert.equal(upsertBody.quote_context_text, "So what about our reset?");
    assert.equal(upsertBody.quote_tweet_url, "https://x.com/blueemi99/status/9876543210");
    assert.equal(upsertBody.quote_author_handle, "@blueemi99");
    assert.equal(upsertBody.ai_teaser_strength, null);
    assert.equal(upsertBody.ai_teaser_strength_confidence, null);
    assert.equal(upsertBody.teaser_strength, null);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("webhook reprocessing preserves a manual final teaser state", async () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  const originalFetch = globalThis.fetch;
  const requestBodies: unknown[] = [];
  let fetchCalls = 0;

  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "off";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  globalThis.fetch = async (_input, init) => {
    fetchCalls += 1;
    if (init?.body) requestBodies.push(JSON.parse(String(init.body)));
    if (fetchCalls === 1) {
      return new Response(JSON.stringify({
        tweet_id: "2089063967301730789",
        text: "Maybe",
        tweet_url: "https://x.com/thsottiaux/status/2089063967301730789",
        tweet_created_at: "2026-08-16T18:57:17.000Z",
        detected_at: "2026-08-16T19:06:58.000Z",
        expires_at: "2026-08-17T18:57:17.000Z",
        signal_type: "teaser",
        confidence: null,
        classification_reason: "手動修正: 親投稿への条件付き返信としてweak teaserと確認。",
        verification_status: "confirmed",
        classification_source: "manual",
        teaser_strength: "weak",
        is_reply: true,
        reply_to_handles: ["@Ananth7e"],
        reply_context_text: "are we going to get a reset when codex crosses 20M users?",
        source_timeline: "with_replies",
        translated_text_ja: null,
        translated_text_zh: null,
        ai_signal_type: "irrelevant",
        ai_confidence: 0.95,
        ai_reason_ja: "文脈のない短い返信として判定しました。",
        ai_teaser_strength: null,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (fetchCalls === 2) {
      return new Response(JSON.stringify({ data: null, error: null }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [], error: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await POST(buildRequest({
      tweetId: "2089063967301730789",
      text: "Maybe",
      tweetUrl: "https://x.com/thsottiaux/status/2089063967301730789",
      tweetCreatedAt: "2026-08-16T18:57:17.000Z",
    }));
    assert.equal(response.status, 200);
    const upsertBody = requestBodies[0] as Record<string, unknown>;
    assert.equal(upsertBody.signal_type, "teaser");
    assert.equal(upsertBody.confidence, null);
    assert.equal(upsertBody.classification_source, "manual");
    assert.equal(upsertBody.teaser_strength, "weak");
    assert.equal(upsertBody.is_reply, true);
    assert.deepEqual(upsertBody.reply_to_handles, ["@Ananth7e"]);
    assert.equal(upsertBody.reply_context_text, "are we going to get a reset when codex crosses 20M users?");
    assert.equal(upsertBody.expires_at, "2026-08-17T18:57:17.000Z");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("fresh Usage Monitor coverage defers an uncorroborated Tibo reset", async () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  const originalFetch = globalThis.fetch;
  const requestBodies: unknown[] = [];
  const fetchMethods: string[] = [];

  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "off";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  const receivedAt = Date.now();
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
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: new Date(receivedAt - 30_000).toISOString(),
        received_at: new Date(receivedAt - 29_000).toISOString(),
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 32,
        window_duration_mins: 10080,
        resets_at: 1787198370,
        coverage_started_at: new Date(receivedAt - 10 * 60_000).toISOString(),
        updated_at: new Date(receivedAt - 29_000).toISOString(),
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (fetchMethods.length === 3) {
      return new Response(JSON.stringify([]), {
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
    const response = await POST(buildRequest({
      tweetCreatedAt: new Date(receivedAt - 60_000).toISOString(),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(fetchMethods, ["GET", "GET", "GET", "POST"]);
    const upsertBody = requestBodies[0] as Record<string, unknown>;
    assert.equal(upsertBody.signal_type, "irrelevant");
    assert.equal(upsertBody.rule_signal_type, "reset_executed");
    assert.equal(upsertBody.classification_reason, "Usage Monitorがfreshですが、quota recoveryが未確認のため正式resetとして保留しています。");
    const responseBody = await response.json();
    assert.equal(responseBody.formalAdoption.newlyAdopted, false);
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
    assert.deepEqual(fetchMethods, ["GET", "POST", "GET", "GET", "POST", "GET", "GET", "POST", "POST"]);
    const upsertBody = requestBodies[1] as Record<string, unknown>;
    assert.equal(upsertBody.translated_text_ja, "Codexの利用上限をリセットしました。");
    assert.equal(upsertBody.translated_text_zh, "我已重置 Codex 的使用上限。");
    const responseBody = await response.json();
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.teaserStrength, null);
    assert.equal("translated_text_ja" in responseBody, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});
