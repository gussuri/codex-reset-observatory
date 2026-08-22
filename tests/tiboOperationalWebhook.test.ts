import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
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
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function installGeminiMock(result: Record<string, unknown>) {
  const original = https.request;
  https.request = ((...args: any[]) => {
    const callback = args[2] as (response: EventEmitter & { statusCode?: number }) => void;
    const request = new EventEmitter() as EventEmitter & {
      write: (body: string) => boolean;
      end: () => void;
    };
    request.write = () => true;
    request.end = () => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit("data", JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
        }));
        response.emit("end");
      });
    };
    return request;
  }) as typeof https.request;
  return () => {
    https.request = original;
  };
}

function installSupabaseMock(requestBodies: Array<Record<string, unknown>>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (init?.body) requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const method = init?.method ?? "GET";
    if (method === "GET") {
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
  return () => {
    globalThis.fetch = original;
  };
}

function buildRequest(text: string, createdAt: string) {
  return new NextRequest("http://localhost/api/webhook/tibo", {
    method: "POST",
    headers: {
      authorization: "Bearer test-webhook-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      tweetId: "2091033630147854385",
      text,
      tweetUrl: "https://x.com/thsottiaux/status/2091033630147854385",
      tweetCreatedAt: createdAt,
    }),
  });
}

function configureEnvironment() {
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  process.env.GEMINI_TRANSLATION_MODE = "off";
}

test("webhook persists Tibo investigating state with an exact 12-hour operational expiry", async () => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const bodies: Array<Record<string, unknown>> = [];
  configureEnvironment();
  const restoreFetch = installSupabaseMock(bodies);
  const text = "Update on rate limits in Codex. The cache hit rate has been worse this week. We are investigating and will have an update tomorrow.";
  const restoreGemini = installGeminiMock({
    signalType: "irrelevant",
    confidence: 0.99,
    temporalDirection: "unclear",
    evidenceQuote: "cache hit rate has been worse this week",
    reasonJa: "リセットの実行や予定ではありません。",
    resetTypeJa: null,
    noticeToExecution: null,
    teaserStrength: "none",
    teaserStrengthConfidence: 0.99,
    teaserStrengthEvidenceQuote: null,
    teaserStrengthReasonJa: "リセット匂わせではありません。",
    codexOperationalStatus: "investigating",
    codexOperationalConfidence: 0.99,
    codexOperationalEvidenceQuote: "We are investigating",
    codexOperationalReasonJa: "Codexのキャッシュヒット率低下を調査中です。",
  });

  try {
    const response = await POST(buildRequest(text, "2026-08-22T05:24:01.000Z"));
    assert.equal(response.status, 200);
    const upsert = bodies.find((body) => body.tweet_id === "2091033630147854385");
    assert.ok(upsert);
    assert.equal(upsert.signal_type, "irrelevant");
    assert.equal(upsert.codex_operational_status, "investigating");
    assert.equal(upsert.codex_operational_confidence, 0.99);
    assert.equal(upsert.codex_operational_evidence_quote, "We are investigating");
    assert.equal(upsert.codex_operational_expires_at, "2026-08-22T17:24:01.000Z");
  } finally {
    restoreGemini();
    restoreFetch();
    restoreEnvironment(previous);
  }
});

test("webhook stores operational none without an expiry", async () => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const bodies: Array<Record<string, unknown>> = [];
  configureEnvironment();
  const restoreFetch = installSupabaseMock(bodies);
  const text = "Sharing a normal Codex product update.";
  const restoreGemini = installGeminiMock({
    signalType: "irrelevant",
    confidence: 0.99,
    temporalDirection: "unclear",
    evidenceQuote: "normal Codex product update",
    reasonJa: "リセットとは無関係です。",
    resetTypeJa: null,
    noticeToExecution: null,
    teaserStrength: "none",
    teaserStrengthConfidence: 0.99,
    teaserStrengthEvidenceQuote: null,
    teaserStrengthReasonJa: "匂わせではありません。",
    codexOperationalStatus: "none",
    codexOperationalConfidence: 0.99,
    codexOperationalEvidenceQuote: null,
    codexOperationalReasonJa: "現在の運用問題についての投稿ではありません。",
  });

  try {
    const response = await POST(buildRequest(text, "2026-08-22T05:24:01.000Z"));
    assert.equal(response.status, 200);
    const upsert = bodies.find((body) => body.tweet_id === "2091033630147854385");
    assert.ok(upsert);
    assert.equal(upsert.codex_operational_status, "none");
    assert.equal(upsert.codex_operational_expires_at, null);
  } finally {
    restoreGemini();
    restoreFetch();
    restoreEnvironment(previous);
  }
});
