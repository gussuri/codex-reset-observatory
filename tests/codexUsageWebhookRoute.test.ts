import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST } from "../app/api/webhook/codex-usage/route";
import { shouldCreateNoticeBackedEstimate } from "../lib/codexUsageRecovery";

const ENV_KEYS = [
  "CODEX_USAGE_MONITOR_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function withEnvironment(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function buildRequest(overrides: Record<string, unknown> = {}, authorization = "Bearer monitor-secret") {
  return new NextRequest("http://localhost/api/webhook/codex-usage", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      observedAt: "2026-08-11T00:02:00.000Z",
      limitId: "codex",
      planType: "plus",
      usedPercent: 0,
      windowDurationMins: 10080,
      resetsAt: 1787012727,
      ...overrides,
    }),
  });
}

test("missing monitor secret returns 503 without contacting storage", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: undefined,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response("unexpected", { status: 500 });
  };

  try {
    const response = await POST(buildRequest());
    assert.equal(response.status, 503);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("wrong monitor secret returns 401", async () => {
  const restore = withEnvironment({ CODEX_USAGE_MONITOR_SECRET: "monitor-secret" });
  try {
    const response = await POST(buildRequest({}, "Bearer wrong-secret"));
    assert.equal(response.status, 401);
  } finally {
    restore();
  }
});

test("unknown and personal payload fields are rejected before storage", async () => {
  const restore = withEnvironment({ CODEX_USAGE_MONITOR_SECRET: "monitor-secret" });
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response("unexpected", { status: 500 });
  };

  try {
    for (const field of ["email", "accountId", "token", "cookie", "unexpectedField"]) {
      const response = await POST(buildRequest({ [field]: "private" }));
      assert.equal(response.status, 400);
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("the first valid snapshot is stored as a baseline only", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  const bodies: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    methods.push(init?.method ?? (input instanceof Request ? input.method : "GET"));
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (methods.length === 1) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "baseline" });
    assert.deepEqual(methods, ["GET", "POST"]);
    assert.deepEqual(bodies[0], {
      source_key: "local-codex-app-server",
      observed_at: "2026-08-11T00:02:00.000Z",
      received_at: bodies[0] && typeof bodies[0] === "object" ? (bodies[0] as Record<string, unknown>).received_at : undefined,
      limit_id: "codex",
      plan_type: "plus",
      used_percent: 0,
      window_duration_mins: 10080,
      resets_at: 1787012727,
      updated_at: bodies[0] && typeof bodies[0] === "object" ? (bodies[0] as Record<string, unknown>).updated_at : undefined,
    });
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("notice-backed estimate is not created for a strong unknown recovery", () => {
  assert.equal(
    shouldCreateNoticeBackedEstimate(
      { id: "notice-1" },
      { confidence: "strong", cycleHint: "unknown" },
      { id: "recovery-1" },
    ),
    false,
  );
});

test("notice-backed estimate is created for a strong unexpected recovery", () => {
  assert.equal(
    shouldCreateNoticeBackedEstimate(
      { id: "notice-1" },
      { confidence: "strong", cycleHint: "unexpected" },
      { id: "recovery-1" },
    ),
    true,
  );
});
