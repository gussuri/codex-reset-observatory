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
    assert.deepEqual(methods, ["GET", "POST", "PATCH"]);
    assert.deepEqual(bodies[0], {
      source_key: "local-codex-app-server",
      observed_at: "2026-08-11T00:02:00.000Z",
      received_at: bodies[0] && typeof bodies[0] === "object" ? (bodies[0] as Record<string, unknown>).received_at : undefined,
      limit_id: "codex",
      plan_type: "plus",
      used_percent: 0,
      window_duration_mins: 10080,
      resets_at: 1787012727,
      coverage_started_at: "2026-08-11T00:02:00.000Z",
      updated_at: bodies[0] && typeof bodies[0] === "object" ? (bodies[0] as Record<string, unknown>).updated_at : undefined,
    });
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("an unapplied coverage migration falls back without failing the first snapshot", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      if (url.includes("coverage_started_at")) {
        return new Response(JSON.stringify({
          code: "PGRST204",
          message: "Could not find the 'coverage_started_at' column of 'codex_usage_monitor_state'",
        }), { status: 400 });
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    if (method === "POST" && url.includes("codex_usage_monitor_state")) {
      if (body && "coverage_started_at" in body) {
        return new Response(JSON.stringify({
          code: "PGRST204",
          message: "Could not find the 'coverage_started_at' column of 'codex_usage_monitor_state'",
        }), { status: 400 });
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    if (method === "PATCH" && url.includes("codex_usage_monitor_state")) {
      assert.equal(body && "coverage_started_at" in body, false);
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
  };

  try {
    const response = await POST(buildRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "baseline" });
    assert.deepEqual(
      requests.map((request) => request.method),
      ["GET", "GET", "POST", "POST", "PATCH"],
    );
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

test("local regular recovery remains a personal observation and does not create a global regular event", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-08-11T00:22:00.000Z",
        received_at: "2026-08-11T00:22:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 69,
        window_duration_mins: 10080,
        resets_at: Math.floor(Date.parse("2026-08-11T00:00:00.000Z") / 1000),
        coverage_started_at: "2026-08-10T23:00:00.000Z",
        updated_at: "2026-08-11T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "POST" && url.includes("codex_recovery_observations")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    if (method === "POST" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    if (method === "POST" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-08-11T00:30:00.000Z",
      usedPercent: 0,
      resetsAt: Math.floor(Date.parse("2026-08-18T00:00:00.000Z") / 1000),
    }));

    assert.equal(response.status, 200);
    assert.equal(requests.filter((request) => request.url.includes("tibo_signals") && request.method === "GET").length, 1, JSON.stringify(requests));
    assert.equal(requests.some((request) => request.url.includes("tibo_signals") && request.method !== "GET"), false);
    const observation = requests.find((request) => request.url.includes("codex_recovery_observations"));
    assert.equal(observation?.body?.matched_tibo_tweet_id, null);
    assert.equal(observation?.body?.status, "observed");
    assert.equal(observation?.body?.cycle_hint, "regular");
    assert.equal(observation?.body?.confidence, "medium");
    assert.equal(requests.some((request) => request.url.includes("regular_reset_events") && request.method !== "GET"), false);
    assert.equal(requests.some((request) => request.url.includes("codex_usage_monitor_state") && request.method !== "GET"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("local regular recovery with an official notice stays personal and does not promote a global reset", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-08-11T00:22:00.000Z",
        received_at: "2026-08-11T00:22:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 69,
        window_duration_mins: 10080,
        resets_at: Math.floor(Date.parse("2026-08-11T00:00:00.000Z") / 1000),
        coverage_started_at: "2026-08-10T23:00:00.000Z",
        updated_at: "2026-08-11T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([{
        tweet_id: "official-notice-personal-test",
        text: "A reset is planned",
        tweet_url: "https://x.com/thsottiaux/status/official-notice-personal-test",
        tweet_created_at: "2026-08-10T00:00:00.000Z",
        expires_at: "2026-08-12T00:00:00.000Z",
        signal_type: "official_notice",
        confidence: 0.99,
        verification_status: "auto_unverified",
        is_reply: false,
      }]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "POST" && url.includes("codex_recovery_observations")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    if (method === "POST" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    if (method === "POST" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-08-11T00:30:00.000Z",
      usedPercent: 0,
      resetsAt: Math.floor(Date.parse("2026-08-18T00:00:00.000Z") / 1000),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "observed_unconfirmed" });
    const observation = requests.find((request) => request.url.includes("codex_recovery_observations"));
    assert.equal(observation?.body?.cycle_hint, "unknown");
    assert.equal(observation?.body?.confidence, "strong");
    assert.equal(observation?.body?.status, "observed");
    assert.equal(requests.some((request) => request.url.includes("tibo_signals") && request.method !== "GET"), false);
    assert.equal(requests.some((request) => request.url.includes("regular_reset_events") && request.method !== "GET"), false);
    assert.equal(requests.some((request) => request.url.includes("codex_usage_monitor_state") && request.method !== "GET"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
