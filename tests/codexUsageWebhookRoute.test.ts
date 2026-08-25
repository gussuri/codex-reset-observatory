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

test("generic credits cannot create a BANKED distribution event", async () => {
  const restore = withEnvironment({ CODEX_USAGE_MONITOR_SECRET: "monitor-secret" });
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response("unexpected", { status: 500 });
  };

  try {
    const response = await POST(buildRequest({
      bankedCredit: { available: true, unlimited: false, balance: "1" },
      bankedCreditChange: true,
    }));
    assert.equal(response.status, 400);
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
      banked_reset_available_count: null,
      last_banked_grant_at: null,
      updated_at: bodies[0] && typeof bodies[0] === "object" ? (bodies[0] as Record<string, unknown>).updated_at : undefined,
    });
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a broad BANKED notice plus a matching local credit grant creates one banked estimate without a reset recovery", async () => {
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
        observed_at: "2026-08-11T00:00:00.000Z",
        received_at: "2026-08-11T00:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 20,
        window_duration_mins: 10080,
        resets_at: 1_787_012_727,
        coverage_started_at: "2026-08-10T23:00:00.000Z",
        updated_at: "2026-08-11T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([{
        tweet_id: "banked-notice-route-test",
        text: "During the day we will credit all Codex and ChatGPT Work users with a BANKED reset.",
        tweet_url: "https://x.com/thsottiaux/status/banked-notice-route-test",
        tweet_created_at: "2026-08-10T23:00:00.000Z",
        expires_at: "2026-08-12T00:00:00.000Z",
        signal_type: "official_notice",
        confidence: 0.99,
        verification_status: "auto_unverified",
        is_reply: false,
        ai_temporal_precision: "daypart",
        expected_start_at: "2026-08-11T00:00:00.000Z",
        expected_end_at: "2026-08-11T23:59:59.000Z",
        temporal_resolution_status: "resolved",
        ai_temporal_timezone: "America/Los_Angeles",
        ai_temporal_confidence: 0.98,
      }]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    if (method === "POST" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-08-11T00:02:00.000Z",
      bankedResetAvailableCount: 1,
      bankedResetCountChange: true,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_distribution_observed" });
    const estimateWrite = requests.find((request) =>
      request.url.includes("reset_execution_estimates") && request.method !== "GET",
    );
    assert.equal(estimateWrite?.body?.reset_event_key, "banked-reset-banked-notice-route-test");
    assert.equal(estimateWrite?.body?.display_execution_at, "2026-08-11T00:02:00.000Z");
    assert.equal(estimateWrite?.body?.recovery_observation_id, null);
    assert.equal(requests.filter((request) =>
      request.url.includes("reset_execution_estimates") && request.method !== "GET",
    ).length, 1);
    assert.equal(requests.some((request) =>
      request.url.includes("regular_reset_events") && request.method !== "GET",
    ), false);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a BANKED credit keeps the first notice and uses the most specific notice as representative", async () => {
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
        observed_at: "2026-08-21T23:30:00.000Z",
        received_at: "2026-08-21T23:30:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 20,
        window_duration_mins: 10080,
        resets_at: 1_787_200_000,
        coverage_started_at: "2026-08-21T22:00:00.000Z",
        updated_at: "2026-08-21T23:30:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([
        {
          tweet_id: "banked-old-route-test",
          text: "During the day we will credit all Codex and ChatGPT Work users with a BANKED reset.",
          tweet_url: "https://x.com/thsottiaux/status/banked-old-route-test",
          tweet_created_at: "2026-08-21T12:00:00.000Z",
          expires_at: "2026-08-22T08:00:00.000Z",
          signal_type: "official_notice",
          confidence: 0.99,
          verification_status: "auto_unverified",
          is_reply: false,
          ai_temporal_precision: "daypart",
          expected_start_at: "2026-08-21T12:00:00.000Z",
          expected_end_at: "2026-08-22T07:00:00.000Z",
          temporal_resolution_status: "resolved",
          ai_temporal_timezone: "America/Los_Angeles",
          ai_temporal_confidence: 0.98,
        },
        {
          tweet_id: "banked-new-route-test",
          text: "The banked reset will be there by 8pm PST. For all paid users of ChatGPT Work and Codex.",
          tweet_url: "https://x.com/thsottiaux/status/banked-new-route-test",
          tweet_created_at: "2026-08-21T23:40:34.000Z",
          expires_at: "2026-08-22T06:00:00.000Z",
          signal_type: "official_notice",
          confidence: 0.99,
          verification_status: "auto_unverified",
          is_reply: false,
          ai_temporal_precision: "exact_time",
          expected_start_at: "2026-08-21T23:40:34.000Z",
          expected_end_at: "2026-08-22T04:00:00.000Z",
          temporal_resolution_status: "resolved",
          ai_temporal_timezone: "PST",
          ai_temporal_confidence: 0.95,
        },
        {
          tweet_id: "unrelated-later-route-test",
          text: "A reset is planned for later.",
          tweet_url: "https://x.com/thsottiaux/status/unrelated-later-route-test",
          tweet_created_at: "2026-08-21T23:45:00.000Z",
          expires_at: "2026-08-22T10:00:00.000Z",
          signal_type: "official_notice",
          confidence: 0.99,
          verification_status: "auto_unverified",
          is_reply: false,
        },
      ]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    if (method === "POST" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-08-21T23:50:00.000Z",
      usedPercent: 20,
      resetsAt: 1_787_200_000,
      bankedResetAvailableCount: 1,
      bankedResetCountChange: true,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_distribution_observed" });
    const estimateWrite = requests.find((request) =>
      request.url.includes("reset_execution_estimates") && request.method !== "GET",
    );
    assert.equal(estimateWrite?.body?.reset_event_key, "banked-reset-banked-old-route-test");
    assert.equal(estimateWrite?.body?.tibo_announced_at, "2026-08-21T12:00:00.000Z");
    assert.equal(estimateWrite?.body?.tibo_primary_tweet_id, "banked-new-route-test");
    assert.deepEqual(estimateWrite?.body?.tibo_source_tweet_ids, [
      "banked-old-route-test",
      "banked-new-route-test",
    ]);
    assert.equal(estimateWrite?.body?.official_notice_tweet_id, "banked-new-route-test");
    assert.equal(estimateWrite?.body?.official_notice_at, "2026-08-21T23:40:34.000Z");
    assert.equal(requests.filter((request) =>
      request.url.includes("reset_execution_estimates") && request.method !== "GET",
    ).length, 1);
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

test("regular recovery records the observation and canonical event without matching or promoting a nearby Tibo reset", async () => {
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
        observed_at: "2026-08-10T23:58:00.000Z",
        received_at: "2026-08-10T23:58:01.000Z",
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
      observedAt: "2026-08-11T00:02:00.000Z",
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
    const regularCompletion = requests.find((request) => request.url.includes("regular_reset_events") && request.method !== "GET");
    assert.equal(regularCompletion?.body?.scheduled_at, "2026-08-11T00:00:00.000Z");
    assert.equal(regularCompletion?.body?.completed_at, "2026-08-11T00:02:00.000Z");
    assert.notEqual(regularCompletion?.body?.scheduled_at, regularCompletion?.body?.completed_at);
    assert.equal(requests.filter((request) => request.url.includes("regular_reset_events") && request.method !== "GET").length, 1);
    assert.equal(requests.some((request) => request.url.includes("tibo_signals") && request.method !== "GET"), false);
    assert.equal(requests.some((request) => request.url.includes("codex_usage_monitor_state") && request.method !== "GET"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("regular recovery with an official notice records regular history without promoting a global reset", async () => {
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
        observed_at: "2026-08-10T23:58:00.000Z",
        received_at: "2026-08-10T23:58:01.000Z",
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
      observedAt: "2026-08-11T00:02:00.000Z",
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
    const regularCompletion = requests.find((request) => request.url.includes("regular_reset_events") && request.method !== "GET");
    assert.equal(regularCompletion?.body?.scheduled_at, "2026-08-11T00:00:00.000Z");
    assert.equal(regularCompletion?.body?.completed_at, "2026-08-11T00:02:00.000Z");
    assert.notEqual(regularCompletion?.body?.scheduled_at, regularCompletion?.body?.completed_at);
    assert.equal(requests.filter((request) => request.url.includes("regular_reset_events") && request.method !== "GET").length, 1);
    assert.equal(requests.some((request) => request.url.includes("codex_usage_monitor_state") && request.method !== "GET"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("teaser plus strong unexpected recovery persists an immediate history estimate without a completion post", async () => {
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
        observed_at: "2026-08-25T00:00:00.000Z",
        received_at: "2026-08-25T00:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 100,
        window_duration_mins: 10080,
        resets_at: Math.floor(Date.parse("2026-08-27T00:00:00.000Z") / 1000),
        coverage_started_at: "2026-08-25T00:00:00.000Z",
        updated_at: "2026-08-26T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([{
        tweet_id: "teaser-route-test",
        text: "The five hour limits are back.",
        tweet_url: "https://x.com/thsottiaux/status/teaser-route-test",
        tweet_created_at: "2026-08-25T00:00:00.000Z",
        expires_at: "2026-08-25T03:00:00.000Z",
        signal_type: "teaser",
        confidence: 0.9,
        verification_status: "auto_unverified",
        is_reply: false,
      }]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    if (method === "POST" && url.includes("codex_recovery_observations")) {
      return new Response(JSON.stringify({
        id: "recovery-teaser-route-test",
        source_key: "local-codex-app-server",
        observed_at: "2026-08-25T00:04:00.000Z",
        previous_observed_at: "2026-08-25T00:00:00.000Z",
        previous_used_percent: 100,
        current_used_percent: 0,
        previous_resets_at: Math.floor(Date.parse("2026-08-27T00:00:00.000Z") / 1000),
        current_resets_at: Math.floor(Date.parse("2026-08-28T00:00:00.000Z") / 1000),
        cycle_hint: "unexpected",
        confidence: "strong",
        status: "observed",
        matched_tibo_tweet_id: null,
        confirmed_at: null,
        created_at: "2026-08-25T00:04:00.000Z",
        updated_at: "2026-08-25T00:04:00.000Z",
      }), { status: 201 });
    }
    if (method === "POST" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-08-25T00:04:00.000Z",
      usedPercent: 0,
      resetsAt: Math.floor(Date.parse("2026-08-28T00:00:00.000Z") / 1000),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "teaser_corroborated" });
    const observation = requests.find((request) => request.url.includes("codex_recovery_observations"));
    assert.equal(observation?.body?.status, "observed");
    assert.equal(observation?.body?.matched_tibo_tweet_id, null);
    assert.equal(observation?.body?.confidence, "strong");
    const estimate = requests.find((request) =>
      request.url.includes("reset_execution_estimates") && request.method !== "GET",
    );
    assert.equal(estimate?.body?.reset_event_key, "tibo-reset-teaser-route-test");
    assert.equal(estimate?.body?.tibo_primary_tweet_id, "teaser-route-test");
    assert.equal(estimate?.body?.official_notice_tweet_id, null);
    assert.equal(estimate?.body?.display_execution_at, "2026-08-25T00:04:00.000Z");
    assert.equal(requests.some((request) => request.url.includes("regular_reset_events") && request.method !== "GET"), false);
    assert.equal(requests.some((request) => request.url.includes("tibo_signals") && request.method !== "GET"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("non-regular recovery beyond five minutes does not write regular history", async () => {
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
        observed_at: "2026-08-11T00:03:01.000Z",
        received_at: "2026-08-11T00:03:02.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 69,
        window_duration_mins: 10080,
        resets_at: Math.floor(Date.parse("2026-08-11T00:00:00.000Z") / 1000),
        coverage_started_at: "2026-08-10T23:00:00.000Z",
        updated_at: "2026-08-11T00:03:02.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-08-11T00:05:01.000Z",
      usedPercent: 0,
      resetsAt: Math.floor(Date.parse("2026-08-18T00:00:00.000Z") / 1000),
    }));

    assert.equal(response.status, 200);
    const observation = requests.find((request) => request.url.includes("codex_recovery_observations"));
    assert.equal(observation?.body?.cycle_hint, "unexpected");
    assert.equal(requests.some((request) => request.url.includes("regular_reset_events") && request.method !== "GET"), false);
    assert.equal(requests.some((request) => request.url.includes("codex_usage_monitor_state") && request.method !== "GET"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("personal banked reset consumption records observation and updates state but suppresses public random reset estimate", async () => {
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
        observed_at: "2026-08-11T00:00:00.000Z",
        received_at: "2026-08-11T00:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 80,
        window_duration_mins: 10080,
        resets_at: 1787000000,
        coverage_started_at: "2026-08-10T00:00:00.000Z",
        banked_reset_available_count: 1,
        last_banked_grant_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-11T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    if (method === "POST" && url.includes("codex_recovery_observations")) {
      return new Response(JSON.stringify({
        data: {
          id: "observation-personal-123",
          source_key: "local-codex-app-server",
          observed_at: "2026-08-11T00:02:00.000Z",
          previous_observed_at: "2026-08-11T00:00:00.000Z",
          previous_used_percent: 80,
          current_used_percent: 0,
          previous_resets_at: 1787000000,
          current_resets_at: 1787604800,
          cycle_hint: "unexpected",
          confidence: "strong",
          status: "observed",
          matched_tibo_tweet_id: null,
          confirmed_at: null,
          created_at: "2026-08-11T00:02:01.000Z",
          updated_at: "2026-08-11T00:02:01.000Z",
        },
        error: null,
      }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-08-11T00:02:00.000Z",
      usedPercent: 0,
      resetsAt: 1787604800,
      bankedResetAvailableCount: 0,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "personal_reset" });

    // 1. Observation is recorded as an unconfirmed personal observation
    const observationWrite = requests.find((request) =>
      request.url.includes("codex_recovery_observations") && request.method !== "GET",
    );
    assert.ok(observationWrite, "Observation should be written for audit");
    assert.equal(observationWrite?.body?.cycle_hint, "unexpected");
    assert.equal(observationWrite?.body?.confidence, "strong");
    assert.equal(observationWrite?.body?.status, "observed");
    assert.equal(observationWrite?.body?.matched_tibo_tweet_id, null);

    // 2. State is updated to reflect banked count 0 and carry forward grant timestamp
    const stateWrite = requests.find((request) =>
      request.url.includes("codex_usage_monitor_state") && request.method !== "GET",
    );
    assert.ok(stateWrite, "State should be updated");
    assert.equal(stateWrite?.body?.banked_reset_available_count, 0);
    assert.equal(stateWrite?.body?.last_banked_grant_at, "2026-08-01T00:00:00.000Z");

    // 3. CRITICAL: NO public reset execution estimate is created!
    const estimateWrites = requests.filter((request) =>
      request.url.includes("reset_execution_estimates") && request.method !== "GET",
    );
    assert.equal(estimateWrites.length, 0, "No public random reset estimate must be written for personal reset");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
