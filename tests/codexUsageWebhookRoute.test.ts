import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST } from "../app/api/webhook/codex-usage/route";
import { POST as POSTTibo } from "../app/api/webhook/tibo/route";
import { shouldCreateNoticeBackedEstimate } from "../lib/codexUsageRecovery";
import { NOTICE_LOOKBACK_MS } from "../lib/radar/tiboHistory";

const ENV_KEYS = [
  "CODEX_USAGE_MONITOR_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const ATOMIC_RPC_PATH = "/rpc/apply_codex_usage_webhook_write_v2";
const FUTURE_REPLY_ATOMIC_RPC_PATH = "/rpc/apply_codex_usage_future_reply_webhook_write";
const BANKED_ASSOCIATION_RPC_PATH = "/rpc/record_banked_grant_association_decision";

type MockRequest = {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
};

function getAtomicPlan(body: Record<string, unknown> | null) {
  const plan = body?.p_plan;
  return plan && typeof plan === "object" ? plan as Record<string, unknown> : null;
}

function respondToAtomicRpc(body: Record<string, unknown> | null, observationId = "route-observation-id") {
  const plan = getAtomicPlan(body);
  return new Response(JSON.stringify({
    status: "applied",
    retry_required: false,
    observation_id: plan?.observation ? observationId : null,
  }), { status: 200 });
}

function respondToBankedAssociationRpc(body: Record<string, unknown> | null) {
  const decision = body?.p_decision && typeof body.p_decision === "object"
    ? body.p_decision as Record<string, unknown>
    : null;
  const status = decision?.status;
  return new Response(JSON.stringify({
    status: status === "accepted" || status === "pending" || status === "conflict" ? status : "invalid",
    published: status === "accepted",
  }), { status: 200 });
}

function getAtomicPlanFromRequests(requests: ReadonlyArray<MockRequest>) {
  const rpcRequest = requests.find((request) =>
    request.method === "POST" && (
      request.url.includes(ATOMIC_RPC_PATH) || request.url.includes(FUTURE_REPLY_ATOMIC_RPC_PATH)
    ),
  );
  assert.ok(rpcRequest, "The webhook should use the atomic write RPC");
  const plan = getAtomicPlan(rpcRequest!.body);
  assert.ok(plan, "The atomic RPC should receive a write plan");
  return plan!;
}

function getAtomicPlanPart(requests: ReadonlyArray<MockRequest>, key: string) {
  const value = getAtomicPlanFromRequests(requests)[key];
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function verifiedFutureReplyRow(overrides: Record<string, unknown> = {}) {
  const parentId = "2113162277688070445";
  const replyId = "2113162413008884099";
  const revision = "a".repeat(64);
  const parentText = "Day 17/ Bet you thought we forgot, but no, it’s reset day today.";
  const replyText = "Lands tomorrow before 10am PST.";
  return {
    tweet_id: replyId,
    text: replyText,
    tweet_url: `https://x.com/thsottiaux/status/${replyId}`,
    tweet_created_at: "2026-10-22T06:55:54.000Z",
    expires_at: "2026-10-23T06:55:54.000Z",
    signal_type: "official_notice",
    confidence: 0.98,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    ai_signal_type: "official_notice",
    ai_confidence: 0.98,
    ai_classification_status: "success",
    ai_temporal_direction: "future",
    ai_notice_timing_status: "known",
    ai_evidence_quote: replyText,
    ai_temporal_expression: "tomorrow before 10am PST",
    ai_temporal_kind: "deadline",
    ai_temporal_precision: "range",
    ai_temporal_timezone: "PST",
    ai_temporal_confidence: 0.95,
    ai_contextual_reset_assessment: "same_global_reset",
    ai_contextual_reset_tweet_id: parentId,
    is_reply: true,
    is_quote: false,
    quote_context_text: null,
    quote_tweet_url: null,
    quote_author_handle: null,
    reply_to_handles: ["@thsottiaux"],
    reply_context_text: parentText,
    source_context_snapshot: {
      parent: {
        tweetId: parentId,
        tweetUrl: `https://x.com/thsottiaux/status/${parentId}`,
        authorHandle: "@thsottiaux",
        text: parentText,
      },
    },
    source_context_revision_hashes: [revision],
    source_context_classified_revision_hashes: [revision],
    source_context_generation: 1,
    temporal_expression: "tomorrow before 10am PST",
    temporal_kind: "deadline",
    temporal_precision: "range",
    temporal_timezone: "PST",
    temporal_confidence: 0.95,
    temporal_resolution_source: null,
    temporal_resolution_status: "resolved",
    temporal_resolution_version: "tibo-temporal-v9-deadline-start-estimate",
    expected_start_at: "2026-10-22T15:00:00.000Z",
    expected_end_at: "2026-10-22T18:00:00.000Z",
    logical_post_id: replyId,
    edit_history_tweet_ids: [replyId],
    edit_version: 1,
    edit_metadata_source: "none",
    ...overrides,
  };
}

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

function assertUsageWebhookQueryBounds(
  requests: ReadonlyArray<{ url: string; method: string }>,
  observedAt: string,
) {
  const tiboRequest = requests.find((request) =>
    request.method === "GET" && request.url.includes("tibo_signals"),
  );
  assert.ok(tiboRequest, "The webhook should query Tibo signals");
  const tiboUrl = new URL(tiboRequest!.url);
  const observedIso = new Date(observedAt).toISOString();
  const lookbackIso = new Date(Date.parse(observedAt) - NOTICE_LOOKBACK_MS).toISOString();
  const orFilters = tiboUrl.searchParams.getAll("or");
  assert.equal(tiboUrl.searchParams.get("tweet_created_at"), `lte.${observedIso}`);
  assert.equal(tiboUrl.searchParams.get("order"), "tweet_created_at.desc,tweet_id.desc");
  assert.equal(tiboUrl.searchParams.get("limit"), "1000");
  assert.ok(orFilters.some((value) =>
    value.includes(`tweet_created_at.gte.${lookbackIso}`) &&
    value.includes(`expires_at.gt.${observedIso}`),
  ), `Expected a bounded Tibo lookback/active-window filter: ${orFilters.join(" | ")}`);

  const regularRequest = requests.find((request) =>
    request.method === "GET" && request.url.includes("regular_reset_events"),
  );
  assert.ok(regularRequest, "The webhook should query regular reset events");
  const regularUrl = new URL(regularRequest!.url);
  assert.equal(regularUrl.searchParams.get("cycle_type"), "eq.定期リセット");
  assert.equal(regularUrl.searchParams.get("record_kind"), "eq.regular_completed");
  assert.equal(regularUrl.searchParams.get("status"), "in.(completed,corrected)");
  assert.equal(regularUrl.searchParams.get("completed_at"), `lte.${observedIso}`);
  assert.equal(regularUrl.searchParams.get("order"), "completed_at.desc");
  assert.equal(regularUrl.searchParams.get("limit"), "1");
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
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    methods.push(method);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (method === "POST" && (
      url.includes(ATOMIC_RPC_PATH) || url.includes(FUTURE_REPLY_ATOMIC_RPC_PATH)
    )) {
      return respondToAtomicRpc(bodies.at(-1) as Record<string, unknown> | null);
    }
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
    const plan = getAtomicPlan(bodies[0] as Record<string, unknown>);
    assert.ok(plan);
    assert.deepEqual(plan?.state, {
      source_key: "local-codex-app-server",
      observed_at: "2026-08-11T00:02:00.000Z",
      received_at: plan?.state && typeof plan.state === "object" ? (plan.state as Record<string, unknown>).received_at : undefined,
      limit_id: "codex",
      plan_type: "plus",
      used_percent: 0,
      window_duration_mins: 10080,
      resets_at: 1787012727,
      coverage_started_at: "2026-08-11T00:02:00.000Z",
      banked_reset_available_count: null,
      last_banked_grant_at: null,
      updated_at: plan?.state && typeof plan.state === "object" ? (plan.state as Record<string, unknown>).updated_at : undefined,
    });
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("an explicit all-paid BANKED loading notice plus a matching credit grant creates one banked estimate", async () => {
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
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }

    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-09-04T03:00:00.000Z",
        received_at: "2026-09-04T03:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 20,
        window_duration_mins: 10080,
        resets_at: 1_787_012_727,
        coverage_started_at: "2026-09-04T02:00:00.000Z",
        banked_reset_available_count: 1,
        updated_at: "2026-08-11T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([{
        tweet_id: "2095651088502591861",
        text: "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users.",
        tweet_url: "https://x.com/thsottiaux/status/2095651088502591861",
        tweet_created_at: "2026-09-03T23:12:09.000Z",
        expires_at: "2026-09-05T00:00:00.000Z",
        signal_type: "official_notice",
        confidence: 0.98,
        verification_status: "auto_unverified",
        is_reply: false,
        ai_temporal_precision: "daypart",
        expected_start_at: null,
        expected_end_at: null,
        temporal_resolution_status: "unresolved",
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
      observedAt: "2026-09-04T03:34:46.386Z",
      bankedResetAvailableCount: 2,
      bankedResetCountChange: true,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_distribution_observed" });
    const estimateWrite = getAtomicPlanPart(requests, "banked_distribution_estimate");
    assert.equal(estimateWrite?.reset_event_key, "banked-reset-local-codex-app-server-observation-20260904T033446386Z");
    assert.equal(estimateWrite?.display_execution_at, "2026-09-04T03:34:46.386Z");
    assert.equal(estimateWrite?.tibo_announced_at, "2026-09-03T23:12:09.000Z");
    assert.equal(estimateWrite?.official_notice_tweet_id, "2095651088502591861");
    assert.deepEqual(estimateWrite?.tibo_source_tweet_ids, ["2095651088502591861"]);
    const atomicPlan = getAtomicPlanFromRequests(requests);
    assert.equal(atomicPlan.observation, undefined);
    assert.equal(atomicPlan.regular_reset_event, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("webhook association lookup expands a trusted logical post to a later rejected manual edit", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const originalId = "2095651088502591861";
  const editedId = "2095651088502591862";
  const originalNotice = {
    tweet_id: originalId,
    text: "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users.",
    tweet_url: `https://x.com/thsottiaux/status/${originalId}`,
    tweet_created_at: "2026-09-03T23:12:09.000Z",
    expires_at: "2026-09-05T00:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.98,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    is_reply: false,
    logical_post_id: originalId,
    edit_history_tweet_ids: [originalId],
    edit_version: 1,
    edit_metadata_source: "x_api",
  };
  const rejectedManualEdit = {
    ...originalNotice,
    tweet_id: editedId,
    text: "Correction: the BANKED reset will not be distributed.",
    tweet_url: `https://x.com/thsottiaux/status/${editedId}`,
    tweet_created_at: "2026-09-04T03:35:00.000Z",
    signal_type: "irrelevant",
    verification_status: "rejected",
    classification_source: "manual",
    edit_history_tweet_ids: [originalId, editedId],
    edit_version: 2,
  };

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) return respondToAtomicRpc(body);
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-09-04T03:00:00.000Z",
        received_at: "2026-09-04T03:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 20,
        window_duration_mins: 10080,
        resets_at: 1_787_012_727,
        coverage_started_at: "2026-09-04T02:00:00.000Z",
        banked_reset_available_count: 1,
        updated_at: "2026-09-04T03:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      const query = new URL(url);
      if (query.searchParams.has("logical_post_id")) {
        return new Response(JSON.stringify([originalNotice, rejectedManualEdit]), { status: 200 });
      }
      return new Response(JSON.stringify(query.searchParams.has("tweet_id") ? [] : [originalNotice]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-04T03:34:46.386Z",
      usedPercent: 20,
      bankedResetAvailableCount: 2,
      bankedResetCountChange: true,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      accepted: true,
      recovery: "banked_grant_observed_pending_association",
    });
    const expansion = requests.find((request) =>
      request.method === "GET" && new URL(request.url).searchParams.has("logical_post_id"),
    );
    assert.ok(expansion, "The webhook must expand a trusted edit chain by logical_post_id");
    const expansionUrl = new URL(expansion!.url);
    assert.equal(expansionUrl.searchParams.get("logical_post_id"), `in.(${originalId})`);
    assert.match(expansionUrl.searchParams.get("select") ?? "", /(?:^|,)classification_source(?:,|$)/);
    assert.equal(expansionUrl.searchParams.has("verification_status"), false);
    assert.equal(expansionUrl.searchParams.has("tweet_created_at"), false);

    const plan = getAtomicPlanFromRequests(requests);
    assert.ok(plan.banked_grant_observation, "The fact is still persisted for later reconciliation");
    assert.equal(plan.banked_distribution_estimate, undefined);
    assert.equal(getAtomicPlanPart(requests, "banked_post_association_decision")?.status, "pending");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a BANKED observation after its Astra notice expired stays pending and does not back the recovery", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const astraSignal = {
    tweet_id: "2095651088502591861",
    text: "We will give one banked reset for every day you don't have access to Astra on your paid ChatGPT plan.",
    tweet_url: "https://x.com/thsottiaux/status/2095651088502591861",
    tweet_created_at: "2026-09-03T23:12:09.000Z",
    expires_at: "2026-09-06T00:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.98,
    verification_status: "auto_unverified",
    is_reply: false,
  };
  const previousResetsAt = Math.floor(Date.parse("2026-09-11T03:55:00.000Z") / 1000);
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "terminated-astra-observation");
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-09-04T22:40:00.000Z",
        received_at: "2026-09-04T22:40:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 80,
        window_duration_mins: 10080,
        resets_at: previousResetsAt,
        coverage_started_at: "2026-09-04T22:00:00.000Z",
        banked_reset_available_count: 1,
        last_banked_grant_at: "2026-09-04T03:34:46.386Z",
        updated_at: "2026-09-04T22:40:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      const query = new URL(url);
      const formalResetQuery = query.searchParams.getAll("or")
        .some((value) => value.includes("signal_type.eq.reset_executed"));
      return new Response(JSON.stringify(formalResetQuery ? [] : [astraSignal]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-04T22:45:00.000Z",
      usedPercent: 0,
      resetsAt: currentResetsAt,
      bankedResetAvailableCount: 2,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_grant_observed_pending_association" });
    const bankedEstimate = getAtomicPlanPart(requests, "banked_distribution_estimate");
    assert.equal(bankedEstimate, null);
    const association = getAtomicPlanPart(requests, "banked_post_association_decision");
    assert.equal(association?.status, "pending");
    const recoveryEstimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.equal(recoveryEstimate?.reset_event_key, "usage-reset-pending");
    assert.equal(recoveryEstimate?.official_notice_tweet_id, null);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("BANKED count growth and an unexpected recovery use separate notice contexts", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const astraSignal = {
    tweet_id: "2095651088502591861",
    text: "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users.",
    tweet_url: "https://x.com/thsottiaux/status/2095651088502591861",
    tweet_created_at: "2026-09-03T23:12:09.000Z",
    expires_at: "2026-09-05T00:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.98,
    verification_status: "auto_unverified",
    is_reply: false,
    expected_start_at: null,
    expected_end_at: null,
    temporal_resolution_status: "unresolved",
  };
  const previousResetsAt = Math.floor(Date.parse("2026-09-11T03:55:00.000Z") / 1000);
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "simultaneous-banked-recovery");
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-09-04T03:55:00.000Z",
        received_at: "2026-09-04T03:55:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 80,
        window_duration_mins: 10080,
        resets_at: previousResetsAt,
        coverage_started_at: "2026-09-04T02:00:00.000Z",
        banked_reset_available_count: 2,
        last_banked_grant_at: "2026-09-04T03:00:00.000Z",
        updated_at: "2026-09-04T03:55:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      const query = new URL(url);
      const formalResetQuery = query.searchParams.getAll("or")
        .some((value) => value.includes("signal_type.eq.reset_executed"));
      return new Response(JSON.stringify(formalResetQuery ? [] : [astraSignal]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-04T04:00:00.000Z",
      usedPercent: 0,
      resetsAt: currentResetsAt,
      bankedResetAvailableCount: 3,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_distribution_observed" });

    const bankedEstimate = getAtomicPlanPart(requests, "banked_distribution_estimate");
    assert.equal(bankedEstimate?.reset_event_key, "banked-reset-local-codex-app-server-observation-20260904T040000000Z");
    assert.equal(bankedEstimate?.official_notice_tweet_id, "2095651088502591861");

    const recoveryEstimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.equal(recoveryEstimate?.reset_event_key, "usage-reset-pending");
    assert.equal(recoveryEstimate?.official_notice_tweet_id, null);
    assert.deepEqual(recoveryEstimate?.tibo_source_tweet_ids, []);
    assert.equal(getAtomicPlanFromRequests(requests).regular_reset_event, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a simultaneous unexpected recovery uses a matching one-shot notice instead of the persistent BANKED notice", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const astraSignal = {
    tweet_id: "2095651088502591861",
    text: "We will give one banked reset for every day you don't have access to Astra on your paid ChatGPT plan, starting today.",
    tweet_url: "https://x.com/thsottiaux/status/2095651088502591861",
    tweet_created_at: "2026-09-03T23:12:09.000Z",
    expires_at: "2026-09-04T00:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.98,
    verification_status: "auto_unverified",
    is_reply: false,
    expected_start_at: "2026-09-04T02:12:09.000Z",
    expected_end_at: "2026-09-04T02:30:00.000Z",
    temporal_resolution_status: "resolved",
  };
  const recoveryNotice = {
    tweet_id: "recovery-one-shot-notice",
    text: "We are resetting usage for everyone now.",
    tweet_url: "https://x.com/thsottiaux/status/recovery-one-shot-notice",
    tweet_created_at: "2026-09-04T03:58:00.000Z",
    expires_at: "2026-09-04T05:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.99,
    verification_status: "auto_unverified",
    is_reply: false,
    expected_start_at: "2026-09-04T03:55:00.000Z",
    expected_end_at: "2026-09-04T04:05:00.000Z",
    temporal_resolution_status: "resolved",
  };
  const previousResetsAt = Math.floor(Date.parse("2026-09-11T03:55:00.000Z") / 1000);
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "simultaneous-one-shot-recovery");
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-09-04T03:55:00.000Z",
        received_at: "2026-09-04T03:55:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 80,
        window_duration_mins: 10080,
        resets_at: previousResetsAt,
        coverage_started_at: "2026-09-04T02:00:00.000Z",
        banked_reset_available_count: 2,
        last_banked_grant_at: "2026-09-04T03:00:00.000Z",
        updated_at: "2026-09-04T03:55:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      const query = new URL(url);
      const formalResetQuery = query.searchParams.getAll("or")
        .some((value) => value.includes("signal_type.eq.reset_executed"));
      return new Response(JSON.stringify(formalResetQuery ? [] : [astraSignal, recoveryNotice]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-04T04:00:00.000Z",
      usedPercent: 0,
      resetsAt: currentResetsAt,
      bankedResetAvailableCount: 3,
    }));

    assert.equal(response.status, 200);
    const plan = getAtomicPlanFromRequests(requests);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_grant_observed_pending_association" });
    const bankedEstimate = getAtomicPlanPart(requests, "banked_distribution_estimate");
    assert.equal(bankedEstimate, null);
    assert.equal(getAtomicPlanPart(requests, "banked_post_association_decision")?.status, "pending");

    const recoveryEstimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.equal(recoveryEstimate?.reset_event_key, "tibo-reset-recovery-one-shot-notice");
    assert.equal(recoveryEstimate?.official_notice_tweet_id, "recovery-one-shot-notice");
    assert.deepEqual(recoveryEstimate?.tibo_source_tweet_ids, ["recovery-one-shot-notice"]);
    assert.equal(plan.regular_reset_event, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a simultaneous BANKED grant and near-regular recovery keep the recovery regular", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const astraSignal = {
    tweet_id: "2095651088502591861",
    text: "We will give one banked reset for every day you don't have access to Astra on your paid ChatGPT plan, starting today.",
    tweet_url: "https://x.com/thsottiaux/status/2095651088502591861",
    tweet_created_at: "2026-09-03T23:12:09.000Z",
    expires_at: "2026-09-04T00:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.98,
    verification_status: "auto_unverified",
    is_reply: false,
    expected_start_at: "2026-09-04T02:12:09.000Z",
    expected_end_at: "2026-09-04T02:30:00.000Z",
    temporal_resolution_status: "resolved",
  };
  const previousResetsAt = Math.floor(Date.parse("2026-09-04T03:59:00.000Z") / 1000);
  const currentResetsAt = Math.floor(Date.parse("2026-09-11T03:59:00.000Z") / 1000);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "simultaneous-regular-recovery");
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-09-04T03:55:00.000Z",
        received_at: "2026-09-04T03:55:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 80,
        window_duration_mins: 10080,
        resets_at: previousResetsAt,
        coverage_started_at: "2026-09-04T02:00:00.000Z",
        banked_reset_available_count: 2,
        last_banked_grant_at: "2026-09-04T03:00:00.000Z",
        updated_at: "2026-09-04T03:55:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      const query = new URL(url);
      const formalResetQuery = query.searchParams.getAll("or")
        .some((value) => value.includes("signal_type.eq.reset_executed"));
      return new Response(JSON.stringify(formalResetQuery ? [] : [astraSignal]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-04T04:00:00.000Z",
      usedPercent: 0,
      resetsAt: currentResetsAt,
      bankedResetAvailableCount: 3,
    }));

    assert.equal(response.status, 200);
    const plan = getAtomicPlanFromRequests(requests);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_grant_observed_pending_association" });
    const bankedEstimate = getAtomicPlanPart(requests, "banked_distribution_estimate");
    assert.equal(bankedEstimate, null);
    assert.equal(getAtomicPlanPart(requests, "banked_post_association_decision")?.status, "pending");

    const regularCompletion = getAtomicPlanPart(requests, "regular_reset_event");
    assert.equal(regularCompletion?.scheduled_at, "2026-09-04T03:59:00.000Z");
    assert.equal(regularCompletion?.completed_at, "2026-09-04T04:00:00.000Z");
    assert.equal(plan.execution_estimate, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a recurring all-paid notice supports later grants with distinct observation identities", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const firstObservedAt = "2026-09-04T03:34:46.386Z";
  const observedAt = "2026-09-04T04:34:46.386Z";
  const firstEventKey = "banked-reset-2095651088502591861";
  let latestEstimate: Record<string, unknown> = {
    reset_event_key: firstEventKey,
    display_execution_at: firstObservedAt,
    created_at: firstObservedAt,
    official_notice_tweet_id: "2095651088502591861",
  };

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-09-04T03:00:00.000Z",
        received_at: "2026-09-04T03:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 20,
        window_duration_mins: 10080,
        resets_at: 1_787_012_727,
        coverage_started_at: "2026-09-04T02:00:00.000Z",
        banked_reset_available_count: 1,
        last_banked_grant_at: firstObservedAt,
        updated_at: "2026-09-04T03:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([{
        tweet_id: "2095651088502591861",
        text: "We will distribute a BANKED reset every week to all paid users.",
        tweet_url: "https://x.com/thsottiaux/status/2095651088502591861",
        tweet_created_at: "2026-09-03T23:12:09.000Z",
        expires_at: "2026-09-10T00:00:00.000Z",
        signal_type: "official_notice",
        confidence: 0.98,
        verification_status: "auto_unverified",
        is_reply: false,
        expected_start_at: null,
        expected_end_at: null,
        temporal_resolution_status: "unresolved",
      }]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: latestEstimate, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt,
      bankedResetAvailableCount: 2,
      bankedResetCountChange: true,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_distribution_observed" });
    const estimateWrite = getAtomicPlanPart(requests, "banked_distribution_estimate");
    assert.equal(
      estimateWrite?.reset_event_key,
      "banked-reset-local-codex-app-server-observation-20260904T043446386Z",
    );
    assert.deepEqual(estimateWrite?.tibo_source_tweet_ids, ["2095651088502591861"]);
    assert.equal(estimateWrite?.official_notice_tweet_id, "2095651088502591861");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("bounded notice lookup keeps the latest signal available beyond 1000 old rows", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const observedAt = "2026-08-11T00:02:00.000Z";
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const latestNotice = {
    tweet_id: "latest-banked-notice-after-old-rows",
    text: "During the day we will credit all Codex and ChatGPT Work users with a BANKED reset.",
    tweet_url: "https://x.com/thsottiaux/status/latest-banked-notice-after-old-rows",
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
  };
  const oldSignals = Array.from({ length: 1001 }, (_, index) => ({
    tweet_id: `old-tibo-signal-${index}`,
    text: "An unrelated historical post.",
    tweet_url: `https://x.com/thsottiaux/status/old-tibo-signal-${index}`,
    tweet_created_at: "2020-01-01T00:00:00.000Z",
    expires_at: "2020-01-02T00:00:00.000Z",
    signal_type: "irrelevant",
    confidence: 0.1,
    verification_status: "auto_unverified",
    is_reply: false,
  }));

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }

    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-08-10T23:00:00.000Z",
        received_at: "2026-08-10T23:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 20,
        window_duration_mins: 10080,
        resets_at: 1_787_012_727,
        coverage_started_at: "2026-08-10T22:00:00.000Z",
        banked_reset_available_count: 0,
        updated_at: "2026-08-10T23:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      const query = new URL(url);
      const observedIso = new Date(observedAt).toISOString();
      const lookbackIso = new Date(Date.parse(observedAt) - NOTICE_LOOKBACK_MS).toISOString();
      const orFilters = query.searchParams.getAll("or");
      const bounded =
        query.searchParams.get("tweet_created_at") === `lte.${observedIso}` &&
        query.searchParams.get("order") === "tweet_created_at.desc,tweet_id.desc" &&
        query.searchParams.get("limit") === "1000" &&
        orFilters.some((value) =>
          value.includes(`tweet_created_at.gte.${lookbackIso}`) &&
          value.includes(`expires_at.gt.${observedIso}`),
        );
      return new Response(JSON.stringify(bounded ? [latestNotice, ...oldSignals] : oldSignals), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt,
      bankedResetAvailableCount: 1,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_distribution_observed" });
    assertUsageWebhookQueryBounds(requests, observedAt);
    const estimateWrite = getAtomicPlanPart(requests, "banked_distribution_estimate");
    assert.equal(estimateWrite?.reset_event_key, "banked-reset-local-codex-app-server-observation-20260811T000200000Z");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("registered persistent lookup still excludes an expired Astra notice from a new grant", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const observedAt = "2026-09-04T00:00:00.000Z";
  const astraNotice = {
    tweet_id: "2095651088502591861",
    text: "We will give one banked reset for every day you don't have access to Astra on your paid ChatGPT plan, starting today.",
    tweet_url: "https://x.com/thsottiaux/status/2095651088502591861",
    tweet_created_at: "2026-09-01T23:12:09.000Z",
    expires_at: "2026-09-02T00:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.98,
    verification_status: "auto_unverified",
    is_reply: false,
    ai_temporal_precision: "daypart",
    expected_start_at: "2026-09-04T02:12:09.000Z",
    expected_end_at: "2026-09-04T02:12:09.000Z",
    temporal_resolution_status: "resolved",
    ai_temporal_timezone: "America/Los_Angeles",
    ai_temporal_confidence: 0.98,
  };
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-09-03T23:59:00.000Z",
        received_at: "2026-09-03T23:59:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 20,
        window_duration_mins: 10080,
        resets_at: 1_787_012_727,
        coverage_started_at: "2026-09-03T22:00:00.000Z",
        banked_reset_available_count: 1,
        updated_at: "2026-09-03T23:59:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      const query = new URL(url);
      const persistentLookup = query.searchParams.get("tweet_id") === "in.(2095651088502591861)";
      return new Response(JSON.stringify(persistentLookup ? [astraNotice] : []), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt,
      usedPercent: 20,
      bankedResetAvailableCount: 2,
      bankedResetCountChange: true,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_grant_observed_pending_association" });
    const tiboRequests = requests.filter((request) => request.method === "GET" && request.url.includes("tibo_signals"));
    assert.equal(tiboRequests.length, 2);
    const boundedRequest = tiboRequests.find((request) => !new URL(request.url).searchParams.has("tweet_id"));
    assert.ok(boundedRequest);
    const persistentRequest = tiboRequests.find((request) => new URL(request.url).searchParams.get("tweet_id") === "in.(2095651088502591861)");
    assert.ok(persistentRequest);
    const estimateWrite = getAtomicPlanPart(requests, "banked_distribution_estimate");
    assert.equal(estimateWrite, null);
    assert.equal(getAtomicPlanPart(requests, "banked_post_association_decision")?.status, "pending");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a BANKED association does not merge identity or notice fields from an independent post", async () => {
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
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }

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
        banked_reset_available_count: 0,
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
    const estimateWrite = getAtomicPlanPart(requests, "banked_distribution_estimate");
    assert.equal(estimateWrite?.reset_event_key, "banked-reset-local-codex-app-server-observation-20260821T235000000Z");
    assert.equal(estimateWrite?.tibo_announced_at, "2026-08-21T12:00:00.000Z");
    assert.equal(estimateWrite?.tibo_primary_tweet_id, "banked-old-route-test");
    assert.deepEqual(estimateWrite?.tibo_source_tweet_ids, ["banked-old-route-test"]);
    assert.equal(estimateWrite?.official_notice_tweet_id, "banked-old-route-test");
    assert.equal(estimateWrite?.official_notice_at, "2026-08-21T12:00:00.000Z");
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
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }

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
      ["GET", "GET", "POST"],
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
  const observedAt = "2026-08-11T00:02:00.000Z";
  const latestRegularEvent = {
    schedule_key: "weekly-regular-reset:2026-08-10T12:00:00.000Z",
    window_start_at: "2026-08-10T11:58:00.000Z",
    window_end_at: "2026-08-10T12:13:00.000Z",
    representative_at: "2026-08-10T12:00:00.000Z",
    scheduled_at: "2026-08-10T12:00:00.000Z",
    completed_at: "2026-08-10T12:02:00.000Z",
    cycle_type: "定期リセット",
    reset_method: "強制リセット",
    scope: "任意リセット未使用アカウント",
    record_kind: "regular_completed",
    status: "completed",
  };
  const oldRegularEvents = Array.from({ length: 1001 }, (_, index) => ({
    ...latestRegularEvent,
    schedule_key: `old-regular-reset-${index}`,
    completed_at: "2020-01-01T00:00:00.000Z",
  }));
  let regularRowsReturned: "latest" | "old" | null = null;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }

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
      const query = new URL(url);
      const bounded =
        query.searchParams.get("completed_at") === `lte.${new Date(observedAt).toISOString()}` &&
        query.searchParams.get("order") === "completed_at.desc" &&
        query.searchParams.get("limit") === "1";
      regularRowsReturned = bounded ? "latest" : "old";
      return new Response(JSON.stringify(bounded ? [latestRegularEvent] : oldRegularEvents), { status: 200 });
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
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response("[]", { status: 200 });
    }
    if (method === "GET" && url.includes("codex_recovery_observations")) {
      return new Response("[]", { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt,
      usedPercent: 0,
      resetsAt: Math.floor(Date.parse("2026-08-18T00:00:00.000Z") / 1000),
    }));

    assert.equal(response.status, 200);
    assert.equal(regularRowsReturned, "latest");
    const tiboRequests = requests.filter((request) => request.url.includes("tibo_signals") && request.method === "GET");
    assert.equal(tiboRequests.filter((request) => !new URL(request.url).searchParams.has("tweet_id")).length, 1, JSON.stringify(requests));
    assert.equal(tiboRequests.filter((request) => new URL(request.url).searchParams.has("tweet_id")).length, 1, JSON.stringify(requests));
    assert.equal(getAtomicPlanFromRequests(requests).promotion, undefined);
    const observation = getAtomicPlanPart(requests, "observation");
    assert.equal(observation?.matched_tibo_tweet_id, null);
    assert.equal(observation?.status, "observed");
    assert.equal(observation?.cycle_hint, "regular");
    assert.equal(observation?.confidence, "medium");
    const regularCompletion = getAtomicPlanPart(requests, "regular_reset_event");
    assert.equal(regularCompletion?.scheduled_at, "2026-08-11T00:00:00.000Z");
    assert.equal(regularCompletion?.completed_at, "2026-08-11T00:02:00.000Z");
    assert.notEqual(regularCompletion?.scheduled_at, regularCompletion?.completed_at);
    assert.equal(getAtomicPlanFromRequests(requests).promotion, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a prior monitor reset excludes consumed notices but preserves a future scheduled one-shot notice", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const observedAt = "2026-10-28T08:08:00.000Z";
  const priorObservedAt = "2026-10-27T10:00:00.000Z";
  const priorPreviousObservedAt = "2026-10-27T09:58:00.000Z";
  const previousResetsAt = Math.floor(Date.parse("2026-10-31T06:30:00.000Z") / 1000);
  const currentResetsAt = Math.floor(Date.parse("2026-11-07T06:30:00.000Z") / 1000);
  const priorEstimateRow = {
    id: "prior-estimate",
    reset_event_key: "usage-reset-prior-monitor",
    display_execution_at: priorObservedAt,
    execution_time_source: "usage_observation",
    execution_time_confidence: "high",
    execution_time_precision: "approximate",
    execution_window_start_at: priorPreviousObservedAt,
    execution_window_end_at: priorObservedAt,
    recovery_observation_id: "prior-monitor-observation",
    recovery_previous_observed_at: priorPreviousObservedAt,
    recovery_observed_at: priorObservedAt,
    tibo_announced_at: null,
    tibo_primary_tweet_id: null,
    tibo_source_tweet_ids: [],
    official_notice_tweet_id: null,
    official_notice_at: null,
    estimator_version: "usage-execution-monitor-v1",
    manual_override_at: null,
    manual_override_by: null,
    manual_override_reason: null,
    manual_execution_at: null,
    manual_execution_precision: null,
    created_at: priorObservedAt,
    updated_at: priorObservedAt,
  };
  const priorObservationRow = {
    id: "prior-monitor-observation",
    source_key: "local-codex-app-server",
    observed_at: priorObservedAt,
    previous_observed_at: priorPreviousObservedAt,
    previous_used_percent: 80,
    current_used_percent: 0,
    previous_resets_at: 1_788_000_000,
    current_resets_at: 1_788_604_800,
    cycle_hint: "unexpected",
    confidence: "strong",
    status: "observed",
    matched_tibo_tweet_id: null,
    confirmed_at: null,
    created_at: priorObservedAt,
    updated_at: priorObservedAt,
  };
  const oldNotice = {
    tweet_id: "2119999999999999999",
    text: "Day 21/ the reset is coming soon.",
    tweet_url: "https://x.com/thsottiaux/status/2119999999999999999",
    tweet_created_at: "2026-10-26T05:40:00.000Z",
    expires_at: "2026-10-30T05:40:00.000Z",
    signal_type: "official_notice",
    confidence: 0.99,
    verification_status: "confirmed",
    is_reply: false,
  };
  const scheduledNotice = {
    tweet_id: "2110000000000000000",
    text: "We will reset Codex usage limits for everyone between 08:00 and 10:00 UTC.",
    tweet_url: "https://x.com/thsottiaux/status/2110000000000000000",
    tweet_created_at: "2026-10-27T01:00:00.000Z",
    expires_at: "2026-10-28T09:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.99,
    verification_status: "confirmed",
    is_reply: false,
    temporal_resolution_status: "resolved",
    temporal_precision: "range",
    expected_start_at: "2026-10-28T07:00:00.000Z",
    expected_end_at: "2026-10-28T09:00:00.000Z",
  };
  const requests: MockRequest[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "current-monitor-observation");
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-10-28T08:06:00.000Z",
        received_at: "2026-10-28T08:06:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 80,
        window_duration_mins: 10080,
        resets_at: previousResetsAt,
        coverage_started_at: "2026-10-21T06:30:00.000Z",
        banked_reset_available_count: 0,
        last_banked_grant_at: null,
        updated_at: "2026-10-28T06:30:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      const query = new URL(url);
      const formalResetQuery = query.searchParams.getAll("or")
        .some((value) => value.includes("signal_type.eq.reset_executed"));
      return new Response(JSON.stringify(formalResetQuery ? [] : [oldNotice, scheduledNotice]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response("[]", { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      const query = new URL(url);
      const recoveryOnly = query.searchParams.get("recovery_observation_id") === "not.is.null";
      const filtered = query.searchParams.has("reset_event_key") ||
        (query.searchParams.has("recovery_observation_id") && !recoveryOnly);
      return new Response(JSON.stringify(filtered ? [] : [priorEstimateRow]), { status: 200 });
    }
    if (method === "GET" && url.includes("codex_recovery_observations")) {
      const query = new URL(url);
      const observationIdFilter = query.searchParams.get("id") ?? "";
      return new Response(JSON.stringify(
        !observationIdFilter || observationIdFilter.includes(priorObservationRow.id)
          ? [priorObservationRow]
          : [],
      ), { status: 200 });
    }
    return new Response("[]", { status: method === "POST" ? 201 : 200 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt,
      usedPercent: 0,
      resetsAt: currentResetsAt,
    }));

    const responseBody = await response.json();
    assert.equal(response.status, 200, JSON.stringify(responseBody));
    assert.deepEqual(responseBody, { accepted: true, recovery: "observed_unconfirmed" });
    const estimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.equal(estimate?.reset_event_key, "tibo-reset-2110000000000000000");
    assert.equal(estimate?.tibo_primary_tweet_id, scheduledNotice.tweet_id);
    assert.deepEqual(estimate?.tibo_source_tweet_ids, [scheduledNotice.tweet_id]);
    assert.equal(estimate?.tibo_announced_at, scheduledNotice.tweet_created_at);
    const recoveryHistoryRequest = requests.find((request) => {
      if (request.method !== "GET" || !request.url.includes("reset_execution_estimates")) return false;
      return new URL(request.url).searchParams.has("recovery_observation_id");
    });
    assert.ok(
      recoveryHistoryRequest,
      `the prior boundary should read recovery-backed estimates: ${JSON.stringify(
        requests.filter((request) => request.url.includes("reset_execution_estimates")).map((request) => request.url),
      )}`,
    );
    const recoveryHistoryQuery = new URL(recoveryHistoryRequest.url).searchParams;
    assert.equal(
      recoveryHistoryQuery.get("recovery_observation_id"),
      "not.is.null",
      recoveryHistoryRequest.url,
    );
    const executionTimeFilters = recoveryHistoryQuery.getAll("display_execution_at");
    assert.ok(executionTimeFilters.some((filter) => filter.startsWith("gte.")));
    assert.ok(executionTimeFilters.some((filter) => filter.startsWith("lte.")));
    const observationHistoryRequest = requests.find((request) =>
      request.method === "GET" && request.url.includes("codex_recovery_observations"),
    );
    assert.ok(observationHistoryRequest, "prior monitor observations should be loaded by estimate ID");
    assert.ok(
      new URL(observationHistoryRequest.url).searchParams.get("id")?.includes(priorObservationRow.id),
    );
    assert.equal(
      requests.some((request) => request.url.includes("read_banked_reset_publication_state")),
      false,
      "the forced recovery boundary lookup must not depend on BANKED publication state",
    );
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
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }

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
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response("[]", { status: 200 });
    }
    if (method === "GET" && url.includes("codex_recovery_observations")) {
      return new Response("[]", { status: 200 });
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
    assertUsageWebhookQueryBounds(requests, "2026-08-11T00:02:00.000Z");
    const observation = getAtomicPlanPart(requests, "observation");
    assert.equal(observation?.cycle_hint, "unknown");
    assert.equal(observation?.confidence, "strong");
    assert.equal(observation?.status, "observed");
    const regularCompletion = getAtomicPlanPart(requests, "regular_reset_event");
    assert.equal(regularCompletion?.scheduled_at, "2026-08-11T00:00:00.000Z");
    assert.equal(regularCompletion?.completed_at, "2026-08-11T00:02:00.000Z");
    assert.notEqual(regularCompletion?.scheduled_at, regularCompletion?.completed_at);
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
  const observedAt = "2026-08-25T00:04:00.000Z";
  const latestTeaser = {
    tweet_id: "teaser-route-test",
    text: "The five hour limits are back.",
    tweet_url: "https://x.com/thsottiaux/status/teaser-route-test",
    tweet_created_at: "2026-08-25T00:00:00.000Z",
    expires_at: "2026-08-25T03:00:00.000Z",
    signal_type: "teaser",
    confidence: 0.9,
    verification_status: "auto_unverified",
    is_reply: false,
  };
  const oldSignals = Array.from({ length: 1001 }, (_, index) => ({
    ...latestTeaser,
    tweet_id: `old-teaser-signal-${index}`,
    text: "An unrelated historical post.",
    tweet_url: `https://x.com/thsottiaux/status/old-teaser-signal-${index}`,
    tweet_created_at: "2020-01-01T00:00:00.000Z",
    expires_at: "2020-01-02T00:00:00.000Z",
    signal_type: "irrelevant",
    confidence: 0.1,
  }));
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "recovery-teaser-route-test");
    }

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
      const query = new URL(url);
      const observedIso = new Date(observedAt).toISOString();
      const lookbackIso = new Date(Date.parse(observedAt) - NOTICE_LOOKBACK_MS).toISOString();
      const bounded =
        query.searchParams.get("tweet_created_at") === `lte.${observedIso}` &&
        query.searchParams.get("order") === "tweet_created_at.desc,tweet_id.desc" &&
        query.searchParams.get("limit") === "1000" &&
        query.searchParams.getAll("or").some((value) =>
          value.includes(`tweet_created_at.gte.${lookbackIso}`) &&
          value.includes(`expires_at.gt.${observedIso}`),
        );
      return new Response(JSON.stringify(bounded ? [latestTeaser, ...oldSignals] : oldSignals), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response("[]", { status: 200 });
    }
    if (method === "GET" && url.includes("codex_recovery_observations")) {
      return new Response("[]", { status: 200 });
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
      observedAt,
      usedPercent: 0,
      resetsAt: Math.floor(Date.parse("2026-08-28T00:00:00.000Z") / 1000),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "teaser_corroborated" });
    assertUsageWebhookQueryBounds(requests, observedAt);
    const observation = getAtomicPlanPart(requests, "observation");
    assert.equal(observation?.status, "observed");
    assert.equal(observation?.matched_tibo_tweet_id, null);
    assert.equal(observation?.confidence, "strong");
    const estimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.equal(estimate?.reset_event_key, "tibo-reset-teaser-route-test");
    assert.equal(estimate?.tibo_primary_tweet_id, "teaser-route-test");
    assert.equal(estimate?.official_notice_tweet_id, null);
    assert.equal(estimate?.display_execution_at, "2026-08-25T00:04:00.000Z");
    const atomicPlan = getAtomicPlanFromRequests(requests);
    assert.equal(atomicPlan.regular_reset_event, undefined);
    assert.equal(atomicPlan.promotion, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a future-dated teaser is not used to corroborate an earlier monitor recovery", async () => {
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
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "recovery-future-teaser-route-test");
    }

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
        updated_at: "2026-08-25T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([{
        tweet_id: "future-teaser-route-test",
        text: "A reset may land tomorrow.",
        tweet_url: "https://x.com/thsottiaux/status/future-teaser-route-test",
        tweet_created_at: "2026-08-25T00:00:00.000Z",
        expires_at: "2026-08-27T00:00:00.000Z",
        signal_type: "teaser",
        confidence: 0.9,
        verification_status: "auto_unverified",
        is_reply: false,
        ai_temporal_direction: "future",
        ai_temporal_kind: "relative_day",
        temporal_precision: "day",
        expected_start_at: "2026-08-26T07:00:00.000Z",
        expected_end_at: "2026-08-27T07:00:00.000Z",
        temporal_resolution_status: "resolved",
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
        id: "recovery-future-teaser-route-test",
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
    assert.deepEqual(await response.json(), { accepted: true, recovery: "observed_unconfirmed" });
    assertUsageWebhookQueryBounds(requests, "2026-08-25T00:04:00.000Z");
    const estimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.equal(estimate?.reset_event_key, "usage-reset-pending");
    assert.equal(estimate?.is_monitor_observed, true);
    assert.equal(estimate?.tibo_primary_tweet_id, null);
    assert.deepEqual(estimate?.tibo_source_tweet_ids, []);
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
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "recovery-non-regular-route-test");
    }

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
    const observation = getAtomicPlanPart(requests, "observation");
    assert.equal(observation?.cycle_hint, "unexpected");
    const atomicPlan = getAtomicPlanFromRequests(requests);
    assert.equal(atomicPlan.regular_reset_event, undefined);
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
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "observation-personal-123");
    }

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

    // 1. Observation is recorded as a rejected public/global recovery candidate
    const observationWrite = getAtomicPlanPart(requests, "observation");
    assert.ok(observationWrite, "Observation should be written for audit");
    assert.equal(observationWrite?.cycle_hint, "unexpected");
    assert.equal(observationWrite?.confidence, "strong");
    assert.equal(observationWrite?.status, "rejected");
    assert.equal(observationWrite?.matched_tibo_tweet_id, null);

    // 2. State is updated to reflect banked count 0 and carry forward grant timestamp
    const stateWrite = getAtomicPlanPart(requests, "state");
    assert.ok(stateWrite, "State should be updated");
    assert.equal(stateWrite?.banked_reset_available_count, 0);
    assert.equal(stateWrite?.last_banked_grant_at, "2026-08-01T00:00:00.000Z");

    // 3. CRITICAL: NO public reset execution estimate is created!
    assert.equal(getAtomicPlanFromRequests(requests).execution_estimate, undefined,
      "No public random reset estimate must be written for personal reset");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

async function assertEstimateWriteFailureDoesNotAdvanceState(mode: "standalone" | "teaser") {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  let stateWriteCount = 0;
  let estimateWriteCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      const plan = getAtomicPlan(body);
      if (plan?.execution_estimate) {
        estimateWriteCount += 1;
        return new Response(JSON.stringify({ message: "estimate write failed" }), { status: 500 });
      }
      return respondToAtomicRpc(body, "recovery-estimate-write-error");
    }

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
        updated_at: "2026-08-25T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify(mode === "teaser"
        ? [{
            tweet_id: "teaser-estimate-write-error",
            text: "The five hour limits are back.",
            tweet_url: "https://x.com/thsottiaux/status/teaser-estimate-write-error",
            tweet_created_at: "2026-08-25T00:00:00.000Z",
            expires_at: "2026-08-26T00:00:00.000Z",
            signal_type: "teaser",
            confidence: 0.9,
            verification_status: "auto_unverified",
            is_reply: false,
          }]
        : []), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    if (method === "POST" && url.includes("codex_recovery_observations")) {
      return new Response(JSON.stringify({
        id: "recovery-estimate-write-error",
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
    if (method !== "GET" && url.includes("reset_execution_estimates")) {
      estimateWriteCount += 1;
      return new Response(JSON.stringify({ message: "estimate write failed" }), { status: 500 });
    }
    if (method !== "GET" && url.includes("codex_usage_monitor_state")) {
      stateWriteCount += 1;
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

    assert.equal(response.status, 503);
    assert.equal(estimateWriteCount, 1);
    assert.equal(stateWriteCount, 0);
    const body = await response.json() as Record<string, unknown>;
    assert.notEqual(body.recovery, "confirmed");
    assert.notEqual(body.recovery, "teaser_corroborated");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
}

test("a standalone unexpected recovery does not advance state when its estimate write fails", async () => {
  await assertEstimateWriteFailureDoesNotAdvanceState("standalone");
});

test("a teaser-correlated recovery does not advance state when its estimate write fails", async () => {
  await assertEstimateWriteFailureDoesNotAdvanceState("teaser");
});

test("server-side BANKED count increases restore distribution without a client change marker", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  let serverCount = 0;
  let estimateWriteCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      const plan = getAtomicPlan(body);
      const state = plan?.state;
      if (state && typeof state === "object" && typeof (state as Record<string, unknown>).banked_reset_available_count === "number") {
        serverCount = (state as Record<string, unknown>).banked_reset_available_count as number;
      }
      if (plan?.banked_distribution_estimate) estimateWriteCount += 1;
      return respondToAtomicRpc(body);
    }

    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-08-11T00:00:00.000Z",
        received_at: "2026-08-11T00:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 20,
        window_duration_mins: 10080,
        resets_at: Math.floor(Date.parse("2026-08-18T00:00:00.000Z") / 1000),
        coverage_started_at: "2026-08-10T23:00:00.000Z",
        banked_reset_available_count: serverCount,
        last_banked_grant_at: null,
        updated_at: "2026-08-11T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([{
        tweet_id: "server-banked-increase-notice",
        text: "During the day we will credit all Codex and ChatGPT Work users with a BANKED reset.",
        tweet_url: "https://x.com/thsottiaux/status/server-banked-increase-notice",
        tweet_created_at: "2026-08-10T23:00:00.000Z",
        expires_at: "2026-08-12T00:00:00.000Z",
        signal_type: "official_notice",
        confidence: 0.99,
        verification_status: "auto_unverified",
        is_reply: false,
        expected_start_at: "2026-08-11T00:00:00.000Z",
        expected_end_at: "2026-08-11T23:59:59.000Z",
        temporal_resolution_status: "resolved",
      }]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    if (method === "POST" && url.includes("reset_execution_estimates")) {
      estimateWriteCount += 1;
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    if (method !== "GET" && url.includes("codex_usage_monitor_state")) {
      if (typeof body?.banked_reset_available_count === "number") {
        serverCount = body.banked_reset_available_count;
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  };

  try {
    for (const [observedAt, currentCount] of [
      ["2026-08-11T00:02:00.000Z", 1],
      ["2026-08-11T00:04:00.000Z", 2],
    ] as const) {
      const response = await POST(buildRequest({
        observedAt,
        bankedResetAvailableCount: currentCount,
        usedPercent: 20,
        resetsAt: Math.floor(Date.parse("2026-08-18T00:00:00.000Z") / 1000),
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_distribution_observed" });
    }

    assert.equal(serverCount, 2);
    assert.equal(estimateWriteCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("an unknown server BANKED count does not create a distribution from a positive snapshot", async () => {
  for (const previousCount of [null, undefined]) {
    const restore = withEnvironment({
      CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
    });
    const originalFetch = globalThis.fetch;
    let estimateWriteCount = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;

      if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
        assert.equal(getAtomicPlan(body)?.banked_distribution_estimate, undefined);
        return respondToAtomicRpc(body);
      }

      if (method === "GET" && url.includes("codex_usage_monitor_state")) {
        return new Response(JSON.stringify({
          source_key: "local-codex-app-server",
          observed_at: "2026-08-11T00:00:00.000Z",
          received_at: "2026-08-11T00:00:01.000Z",
          limit_id: "codex",
          plan_type: "plus",
          used_percent: 20,
          window_duration_mins: 10080,
          resets_at: Math.floor(Date.parse("2026-08-18T00:00:00.000Z") / 1000),
          coverage_started_at: "2026-08-10T23:00:00.000Z",
          ...(previousCount === undefined ? {} : { banked_reset_available_count: previousCount }),
          updated_at: "2026-08-11T00:00:01.000Z",
        }), { status: 200 });
      }
      if (method === "GET" && url.includes("tibo_signals")) {
        return new Response(JSON.stringify([{
          tweet_id: "unknown-banked-count-notice",
          text: "During the day we will credit all Codex and ChatGPT Work users with a BANKED reset.",
          tweet_url: "https://x.com/thsottiaux/status/unknown-banked-count-notice",
          tweet_created_at: "2026-08-10T23:00:00.000Z",
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
      if (method === "GET" && url.includes("reset_execution_estimates")) {
        return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
      }
      if (method !== "GET" && url.includes("reset_execution_estimates")) {
        estimateWriteCount += 1;
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
    };

    try {
      const response = await POST(buildRequest({
        observedAt: "2026-08-11T00:02:00.000Z",
        bankedResetAvailableCount: 1,
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { accepted: true, recovery: "no_recovery" });
      assert.equal(estimateWriteCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  }
});

test("bypass reproduction: without protocol v2 postReason, restarted monitor initial snapshot (40/B) with DB previous (60/A) falsely creates recovery estimate", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const previousResetsAt = Math.floor(Date.parse("2026-09-11T03:55:00.000Z") / 1000);
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body, "bypass-observation-id");
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-09-10T00:00:00.000Z",
        received_at: "2026-09-10T00:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 60,
        window_duration_mins: 10080,
        resets_at: previousResetsAt,
        coverage_started_at: "2026-09-09T22:00:00.000Z",
        banked_reset_available_count: 1,
        last_banked_grant_at: null,
        updated_at: "2026-09-10T00:00:01.000Z",
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
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    // Legacy monitor behavior on restart: sends initial snapshot (40/B) without postReason or version
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:02:00.000Z",
      usedPercent: 40,
      resetsAt: currentResetsAt,
    }));
    assert.equal(response.status, 200);
    const plan = getAtomicPlanFromRequests(requests);
    // Demonstrates legacy vulnerability: without postReason, unconfirmed initial snapshot is promoted to random reset
    assert.ok(plan.execution_estimate, "Bypass confirmed: server falsely creates reset estimate for unconfirmed snapshot");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

function createMockSupabaseFetch(options?: {
  previousState?: Record<string, unknown>;
  tiboSignals?: unknown[];
  regularEvents?: unknown[];
}) {
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const previousResetsAt = Math.floor(Date.parse("2026-09-11T03:55:00.000Z") / 1000);
  const defaultState = {
    source_key: "local-codex-app-server",
    observed_at: "2026-09-10T00:00:00.000Z",
    received_at: "2026-09-10T00:00:01.000Z",
    limit_id: "codex",
    plan_type: "plus",
    used_percent: 60,
    window_duration_mins: 10080,
    resets_at: previousResetsAt,
    coverage_started_at: "2026-09-09T22:00:00.000Z",
    banked_reset_available_count: 1,
    last_banked_grant_at: null,
    updated_at: "2026-09-10T00:00:01.000Z",
  };

  const fetchHandler = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      const rpcBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return respondToBankedAssociationRpc(rpcBody);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && (
      url.includes(ATOMIC_RPC_PATH) || url.includes(FUTURE_REPLY_ATOMIC_RPC_PATH)
    )) {
      return respondToAtomicRpc(body, "mock-observation-id");
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify(options?.previousState ?? defaultState), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      const query = new URL(url);
      const replyExcluded = query.searchParams.getAll("or").some((filter) => filter.includes("is_reply"));
      const rows = options?.tiboSignals ?? [];
      return new Response(JSON.stringify(replyExcluded
        ? rows.filter((row) => (row as Record<string, unknown>).is_reply !== true)
        : rows), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify(options?.regularEvents ?? []), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response("[]", { status: 200 });
    }
    if (method === "GET" && url.includes("codex_recovery_observations")) {
      return new Response("[]", { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  return { requests, fetchHandler };
}

test("a strict future reply can corroborate only the bounded matching recovery query", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const previousResetsAt = Math.floor(Date.parse("2026-10-23T03:55:00.000Z") / 1000);
  const { requests, fetchHandler } = createMockSupabaseFetch({
    previousState: {
      source_key: "local-codex-app-server",
      observed_at: "2026-10-22T17:54:00.000Z",
      received_at: "2026-10-22T17:54:01.000Z",
      limit_id: "codex",
      plan_type: "plus",
      used_percent: 60,
      window_duration_mins: 10080,
      resets_at: previousResetsAt,
      coverage_started_at: "2026-10-22T16:00:00.000Z",
      banked_reset_available_count: 1,
      last_banked_grant_at: null,
      updated_at: "2026-10-22T17:54:01.000Z",
    },
    tiboSignals: [verifiedFutureReplyRow()],
  });
  globalThis.fetch = fetchHandler;

  try {
    const requestBody = {
      observedAt: "2026-10-22T17:59:00.000Z",
      usedPercent: 0,
      resetsAt: Math.floor(Date.parse("2026-10-30T03:55:00.000Z") / 1000),
      monitorProtocolVersion: 2,
      postReason: "recovery_candidate",
    };
    const response = await POST(buildRequest(requestBody));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "observed_unconfirmed" });
    const estimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.equal(estimate?.official_notice_tweet_id, "2113162413008884099");
    assert.equal(estimate?.official_notice_at, "2026-10-22T06:55:54.000Z");
    const plan = getAtomicPlanFromRequests(requests);
    assert.equal(plan.future_reply_claim && (plan.future_reply_claim as Record<string, unknown>).event_key, "2113162277688070445");
    assert.deepEqual(
      (plan.future_reply_claim as Record<string, unknown>)?.reply_proof,
      verifiedFutureReplyRow(),
      "the forward RPC must receive the exact full row snapshot that passed the JS validator",
    );
    const fallbackEstimate = plan.future_reply_fallback_execution_estimate as Record<string, unknown> | undefined;
    assert.equal(fallbackEstimate?.reset_event_key, "usage-reset-pending");
    assert.equal(fallbackEstimate?.is_monitor_observed, true);
    assert.ok(requests.some((request) => request.url.includes(FUTURE_REPLY_ATOMIC_RPC_PATH)));

    const replayResponse = await POST(buildRequest(requestBody));
    assert.equal(replayResponse.status, 200);
    const futureReplyWrites = requests.filter((request) =>
      request.method === "POST" && request.url.includes(FUTURE_REPLY_ATOMIC_RPC_PATH),
    );
    assert.equal(futureReplyWrites.length, 2);
    const firstReplayPlan = getAtomicPlan(futureReplyWrites[0]!.body)!;
    const secondReplayPlan = getAtomicPlan(futureReplyWrites[1]!.body)!;
    assert.deepEqual(secondReplayPlan.future_reply_claim, firstReplayPlan.future_reply_claim);
    assert.deepEqual(secondReplayPlan.future_reply_fallback_execution_estimate, firstReplayPlan.future_reply_fallback_execution_estimate);

    const tiboReads = requests.filter((request) => request.method === "GET" && request.url.includes("tibo_signals"));
    const boundedRead = tiboReads.find((request) => !new URL(request.url).searchParams.has("tweet_id"));
    const persistentRead = tiboReads.find((request) => new URL(request.url).searchParams.has("tweet_id"));
    assert.ok(boundedRead);
    assert.ok(persistentRead);
    const boundedUrl = new URL(boundedRead!.url);
    const persistentUrl = new URL(persistentRead!.url);
    assert.equal(boundedUrl.searchParams.get("is_reply"), null, "bounded recovery lookup may consider replies");
    assert.ok(!boundedUrl.searchParams.getAll("or").some((filter) => filter.includes("is_reply")));
    assert.ok(persistentUrl.searchParams.getAll("or").some((filter) => filter.includes("is_reply")), "persistent notices keep the reply exclusion");
    for (const column of [
      "source_context_snapshot",
      "source_context_revision_hashes",
      "source_context_classified_revision_hashes",
      "source_context_generation",
      "reply_context_text",
      "reply_to_handles",
      "temporal_resolution_version",
    ]) {
      assert.ok(boundedUrl.searchParams.get("select")?.split(",").includes(column), `query projection must include ${column}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("different strict reply events overlapping one recovery fail closed instead of selecting the newest", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const previousResetsAt = Math.floor(Date.parse("2026-10-23T03:55:00.000Z") / 1000);
  const secondParentId = "2113162277688070446";
  const secondReply = verifiedFutureReplyRow({
    tweet_id: "2113162413008884100",
    tweet_url: "https://x.com/thsottiaux/status/2113162413008884100",
    tweet_created_at: "2026-10-22T06:56:54.000Z",
    ai_contextual_reset_tweet_id: secondParentId,
    reply_context_text: "Day 18/ Reset day today.",
    source_context_snapshot: {
      parent: {
        tweetId: secondParentId,
        tweetUrl: `https://x.com/thsottiaux/status/${secondParentId}`,
        authorHandle: "@thsottiaux",
        text: "Day 18/ Reset day today.",
      },
    },
  });
  const { requests, fetchHandler } = createMockSupabaseFetch({
    previousState: {
      source_key: "local-codex-app-server",
      observed_at: "2026-10-22T17:54:00.000Z",
      received_at: "2026-10-22T17:54:01.000Z",
      limit_id: "codex",
      plan_type: "plus",
      used_percent: 60,
      window_duration_mins: 10080,
      resets_at: previousResetsAt,
      coverage_started_at: "2026-10-22T16:00:00.000Z",
      banked_reset_available_count: 1,
      last_banked_grant_at: null,
      updated_at: "2026-10-22T17:54:01.000Z",
    },
    tiboSignals: [verifiedFutureReplyRow(), secondReply],
  });
  globalThis.fetch = fetchHandler;

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-10-22T17:59:00.000Z",
      usedPercent: 0,
      resetsAt: Math.floor(Date.parse("2026-10-30T03:55:00.000Z") / 1000),
      monitorProtocolVersion: 2,
      postReason: "recovery_candidate",
    }));

    assert.equal(response.status, 200);
    const estimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.equal(estimate?.reset_event_key, "usage-reset-pending");
    assert.equal(estimate?.official_notice_tweet_id, null);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("same-parent strict reply edit variants remain one corroborating event", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const previousResetsAt = Math.floor(Date.parse("2026-10-23T03:55:00.000Z") / 1000);
  const firstReplyId = "2113162413008884099";
  const secondReplyId = "2113162413008884100";
  const editHistory = [firstReplyId, secondReplyId];
  const firstReply = verifiedFutureReplyRow({
    logical_post_id: firstReplyId,
    edit_history_tweet_ids: editHistory,
    edit_version: 1,
    edit_metadata_source: "x_api",
  });
  const secondReply = verifiedFutureReplyRow({
    tweet_id: secondReplyId,
    tweet_url: `https://x.com/thsottiaux/status/${secondReplyId}`,
    tweet_created_at: "2026-10-22T06:56:54.000Z",
    logical_post_id: firstReplyId,
    edit_history_tweet_ids: editHistory,
    edit_version: 2,
    edit_metadata_source: "x_api",
  });
  const { requests, fetchHandler } = createMockSupabaseFetch({
    previousState: {
      source_key: "local-codex-app-server",
      observed_at: "2026-10-22T17:54:00.000Z",
      received_at: "2026-10-22T17:54:01.000Z",
      limit_id: "codex",
      plan_type: "plus",
      used_percent: 60,
      window_duration_mins: 10080,
      resets_at: previousResetsAt,
      coverage_started_at: "2026-10-22T16:00:00.000Z",
      banked_reset_available_count: 1,
      last_banked_grant_at: null,
      updated_at: "2026-10-22T17:54:01.000Z",
    },
    tiboSignals: [firstReply, secondReply],
  });
  globalThis.fetch = fetchHandler;

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-10-22T17:59:00.000Z",
      usedPercent: 0,
      resetsAt: Math.floor(Date.parse("2026-10-30T03:55:00.000Z") / 1000),
      monitorProtocolVersion: 2,
      postReason: "recovery_candidate",
    }));

    assert.equal(response.status, 200);
    const plan = getAtomicPlanFromRequests(requests);
    const estimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.equal(estimate?.reset_event_key, "tibo-reset-2113162277688070445");
    assert.equal((estimate?.tibo_source_tweet_ids as string[]).length, 2);
    assert.equal((plan.future_reply_claim as Record<string, unknown>)?.event_key, "2113162277688070445");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("protocol v2 strict validation: rejects missing postReason with status 400", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:02:00.000Z",
      usedPercent: 40,
      resetsAt: 1787617527,
      monitorProtocolVersion: 2,
    }));
    assert.equal(response.status, 400);
  } finally {
    restore();
  }
});

test("protocol v2 strict validation: rejects invalid postReason with status 400", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:02:00.000Z",
      usedPercent: 40,
      resetsAt: 1787617527,
      monitorProtocolVersion: 2,
      postReason: "unauthorized_drop",
    }));
    assert.equal(response.status, 400);
  } finally {
    restore();
  }
});

test("protocol v2 strict validation: rejects invalid monitorProtocolVersion with status 400", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  try {
    for (const invalidVersion of [0, 3, -1, 99]) {
      const response = await POST(buildRequest({
        observedAt: "2026-09-10T00:02:00.000Z",
        usedPercent: 40,
        resetsAt: 1787617527,
        monitorProtocolVersion: invalidVersion,
        postReason: "recovery_candidate",
      }));
      assert.equal(response.status, 400);
    }
  } finally {
    restore();
  }
});

test("Test A: protocol v2 observed recovery (recovery_candidate) creates execution estimate and updates state", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);
  const { requests, fetchHandler } = createMockSupabaseFetch();
  globalThis.fetch = fetchHandler;

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:02:00.000Z",
      usedPercent: 5,
      resetsAt: currentResetsAt,
      monitorProtocolVersion: 2,
      postReason: "recovery_candidate",
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "observed_unconfirmed" });
    const executionEstimate = getAtomicPlanPart(requests, "execution_estimate");
    const observation = getAtomicPlanPart(requests, "observation");
    const state = getAtomicPlanPart(requests, "state");
    assert.ok(executionEstimate, "Confirmed recovery candidate must create an execution estimate");
    assert.equal(executionEstimate?.display_execution_at, "2026-09-10T00:02:00.000Z");
    assert.equal(executionEstimate?.is_monitor_observed, true);
    assert.equal(observation?.cycle_hint, "unexpected");
    assert.equal(state?.used_percent, 5);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("Test B: protocol v2 restart bypass regression (initial) updates baseline without creating execution estimate", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);
  const { requests, fetchHandler } = createMockSupabaseFetch();
  globalThis.fetch = fetchHandler;

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:02:00.000Z",
      usedPercent: 40,
      resetsAt: currentResetsAt,
      monitorProtocolVersion: 2,
      postReason: "initial",
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "initial" });
    const plan = getAtomicPlanFromRequests(requests);
    const state = getAtomicPlanPart(requests, "state");
    assert.equal(plan.execution_estimate, undefined, "Initial snapshot must NOT create execution estimate (bypass prevented)");
    assert.equal(plan.observation, undefined, "Initial snapshot must NOT create recovery observation row");
    assert.equal(state?.used_percent, 40, "Initial snapshot must update baseline in monitor state");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("Test C: protocol v2 heartbeat bypass regression (heartbeat) updates state without creating execution estimate", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);
  const { requests, fetchHandler } = createMockSupabaseFetch();
  globalThis.fetch = fetchHandler;

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:02:00.000Z",
      usedPercent: 40,
      resetsAt: currentResetsAt,
      monitorProtocolVersion: 2,
      postReason: "heartbeat",
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "heartbeat" });
    const plan = getAtomicPlanFromRequests(requests);
    const state = getAtomicPlanPart(requests, "state");
    assert.equal(plan.execution_estimate, undefined, "Heartbeat snapshot must NOT create execution estimate (bypass prevented)");
    assert.equal(state?.used_percent, 40, "Heartbeat snapshot must update monitor state");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("Test E: protocol v2 BANKED count change (banked_reset_count_change) creates banked distribution estimate", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const previousResetsAt = Math.floor(Date.parse("2026-09-11T03:55:00.000Z") / 1000);
  const { requests, fetchHandler } = createMockSupabaseFetch({
    previousState: {
      source_key: "local-codex-app-server",
      observed_at: "2026-09-10T00:00:00.000Z",
      received_at: "2026-09-10T00:00:01.000Z",
      limit_id: "codex",
      plan_type: "plus",
      used_percent: 60,
      window_duration_mins: 10080,
      resets_at: previousResetsAt,
      coverage_started_at: "2026-09-09T22:00:00.000Z",
      banked_reset_available_count: 0,
      last_banked_grant_at: null,
      updated_at: "2026-09-10T00:00:01.000Z",
    },
    tiboSignals: [{
      tweet_id: "tibo-banked-v2-notice",
      text: "During the day we will credit all Codex and ChatGPT Work users with a BANKED reset.",
      tweet_url: "https://x.com/thsottiaux/status/tibo-banked-v2-notice",
      tweet_created_at: "2026-09-09T23:00:00.000Z",
      expires_at: "2026-09-11T00:00:00.000Z",
      signal_type: "official_notice",
      confidence: 0.99,
      verification_status: "auto_unverified",
      is_reply: false,
      expected_start_at: "2026-09-10T00:00:00.000Z",
      expected_end_at: "2026-09-10T23:59:59.000Z",
      temporal_resolution_status: "resolved",
    }],
  });
  globalThis.fetch = fetchHandler;

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:02:00.000Z",
      usedPercent: 60,
      resetsAt: previousResetsAt,
      bankedResetAvailableCount: 1,
      bankedResetCountChange: true,
      monitorProtocolVersion: 2,
      postReason: "banked_reset_count_change",
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "banked_distribution_observed" });
    const plan = getAtomicPlanFromRequests(requests);
    const bankedEstimate = getAtomicPlanPart(requests, "banked_distribution_estimate");
    const state = getAtomicPlanPart(requests, "state");
    assert.ok(bankedEstimate, "Banked count change must create banked distribution estimate");
    assert.equal(plan.execution_estimate, undefined, "Banked count change must not create weekly recovery estimate");
    assert.equal(state?.banked_reset_available_count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("Test F: protocol v2 structure change (structure_change) updates state without creating recovery estimate", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);
  const { requests, fetchHandler } = createMockSupabaseFetch();
  globalThis.fetch = fetchHandler;

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:02:00.000Z",
      planType: "pro",
      usedPercent: 40,
      resetsAt: currentResetsAt,
      monitorProtocolVersion: 2,
      postReason: "structure_change",
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "structure_change" });
    const plan = getAtomicPlanFromRequests(requests);
    const state = getAtomicPlanPart(requests, "state");
    assert.equal(plan.execution_estimate, undefined, "Structure change must not create execution estimate");
    assert.equal(state?.plan_type, "pro");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("Test G: protocol v2 stale snapshot with recovery_candidate returns ignored_stale", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);
  const { requests, fetchHandler } = createMockSupabaseFetch();
  globalThis.fetch = fetchHandler;

  try {
    // DB has observed_at: "2026-09-10T00:00:00.000Z"
    // Stale snapshot has earlier observedAt: "2026-09-09T23:59:00.000Z"
    const response = await POST(buildRequest({
      observedAt: "2026-09-09T23:59:00.000Z",
      usedPercent: 5,
      resetsAt: currentResetsAt,
      monitorProtocolVersion: 2,
      postReason: "recovery_candidate",
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "ignored_stale" });
    assert.equal(requests.some((r) => r.method === "POST" && r.url.includes(ATOMIC_RPC_PATH)), false);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("Test H: protocol v2 firstEvidence chronology is preserved in reset execution estimate", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);
  const { requests, fetchHandler } = createMockSupabaseFetch();
  globalThis.fetch = fetchHandler;

  try {
    // Candidate started at t=0s ("2026-09-10T00:00:30.000Z" with 5% usage).
    // Confirmed at t=120s by local monitor.
    // Local monitor posts the firstEvidence snapshot:
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:00:30.000Z",
      usedPercent: 5,
      resetsAt: currentResetsAt,
      monitorProtocolVersion: 2,
      postReason: "recovery_candidate",
    }));
    assert.equal(response.status, 200);
    const executionEstimate = getAtomicPlanPart(requests, "execution_estimate");
    assert.ok(executionEstimate);
    // Display execution time strictly preserves the initial detection moment (t=0s), not confirmation time
    assert.equal(executionEstimate?.display_execution_at, "2026-09-10T00:00:30.000Z");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("Test I: legacy protocol v1 compatibility allows fallback evaluation without version or postReason", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const previousResetsAt = Math.floor(Date.parse("2026-09-11T03:55:00.000Z") / 1000);
  const currentResetsAt = Math.floor(Date.parse("2026-09-18T03:55:00.000Z") / 1000);
  const { requests, fetchHandler } = createMockSupabaseFetch();
  globalThis.fetch = fetchHandler;

  try {
    // Legacy client payload: no monitorProtocolVersion, no postReason
    // Arithmetic drop: 60% -> 5%, resetsAt +7d
    const response = await POST(buildRequest({
      observedAt: "2026-09-10T00:02:00.000Z",
      usedPercent: 5,
      resetsAt: currentResetsAt,
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "observed_unconfirmed" });
    const plan = getAtomicPlanFromRequests(requests);
    assert.ok(plan.execution_estimate, "Legacy client arithmetic recovery accepted for zero-downtime deploy");

    // Legacy client payload with no recovery: 60% -> 60%, resetsAt unchanged
    requests.length = 0;
    const noRecoveryResponse = await POST(buildRequest({
      observedAt: "2026-09-10T00:04:00.000Z",
      usedPercent: 60,
      resetsAt: previousResetsAt,
    }));
    assert.equal(noRecoveryResponse.status, 200);
    assert.deepEqual(await noRecoveryResponse.json(), { accepted: true, recovery: "no_recovery" });
    const noRecoveryPlan = getAtomicPlanFromRequests(requests);
    assert.equal(noRecoveryPlan.execution_estimate, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("quoted BANKED distribution context is not promoted to a public grant association", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: MockRequest[] = [];
  const notice = {
    tweet_id: "quoted-banked-notice",
    text: "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users.",
    tweet_url: "https://x.com/thsottiaux/status/quoted-banked-notice",
    tweet_created_at: "2026-08-10T23:30:00.000Z",
    expires_at: "2026-08-12T00:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.99,
    verification_status: "confirmed",
    is_reply: false,
    is_quote: true,
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });
    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }
    if (method === "POST" && url.includes(BANKED_ASSOCIATION_RPC_PATH)) {
      return respondToBankedAssociationRpc(body);
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-08-11T00:00:00.000Z",
        received_at: "2026-08-11T00:00:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 30,
        window_duration_mins: 10080,
        resets_at: 1_787_012_727,
        coverage_started_at: "2026-08-10T23:00:00.000Z",
        banked_reset_available_count: 0,
        last_banked_grant_at: null,
        updated_at: "2026-08-11T00:00:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([notice]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 201 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt: "2026-08-11T00:02:00.000Z",
      usedPercent: 30,
      bankedResetAvailableCount: 1,
      bankedResetCountChange: true,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      accepted: true,
      recovery: "banked_grant_observed_pending_association",
    });
    const tiboRead = requests.find((request) => request.method === "GET" && request.url.includes("tibo_signals"));
    assert.ok(tiboRead);
    assert.match(new URL(tiboRead!.url).searchParams.get("select") ?? "", /(?:^|,)is_quote(?:,|$)/);
    const plan = getAtomicPlanFromRequests(requests);
    assert.ok(plan.banked_grant_observation, "The count increase remains durably recorded");
    assert.equal(plan.banked_distribution_estimate, undefined);
    const decision = plan.banked_post_association_decision as Record<string, unknown>;
    assert.equal(decision.status, "pending");
    assert.deepEqual(decision.excluded_candidates, [{
      tweetId: "quoted-banked-notice",
      reason: "reply_or_quote",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

for (const formalAdoption of [
  { status: "claimed_new" as const, resetEventKey: "canonical", expectedEstimateRead: true },
  { status: "conflict" as const, resetEventKey: "wrong-event-key", expectedEstimateRead: false },
]) {
test(`atomic promotion ${formalAdoption.status === "conflict" ? "blocks copy on identity conflict" : "claims formal identity before copy generation"}`, async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const deferredTweetId = "2099999999999999991";
  const observedAt = "2026-08-26T01:15:00.000Z";

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-08-26T01:10:00.000Z",
        received_at: "2026-08-26T01:10:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 100,
        window_duration_mins: 10080,
        resets_at: 1_788_000_000,
        coverage_started_at: "2026-08-26T01:00:00.000Z",
        banked_reset_available_count: 0,
        last_banked_grant_at: null,
        updated_at: "2026-08-26T01:10:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify([{
        tweet_id: deferredTweetId,
        text: "I have reset usage limits for Codex and ChatGPT Work.",
        tweet_url: `https://x.com/thsottiaux/status/${deferredTweetId}`,
        tweet_created_at: "2026-08-26T01:14:00.000Z",
        signal_type: "irrelevant",
        confidence: 0.1,
        verification_status: "auto_unverified",
        classification_source: "gemini",
        ai_signal_type: "reset_executed",
        ai_confidence: 0.99,
        rule_signal_type: "reset_executed",
        rule_confidence: 0.99,
        is_reply: false,
      }]), { status: 200 });
    }
    if (method === "GET" && url.includes("regular_reset_events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === "GET" && url.includes("reset_execution_estimates")) {
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }
    if (method === "POST" && url.includes("/rpc/claim_tibo_formal_adoption")) {
      const claimedEventKey = formalAdoption.resetEventKey === "canonical"
        ? String(body?.p_reset_event_key)
        : formalAdoption.resetEventKey;
      return new Response(JSON.stringify({
        status: formalAdoption.status,
        record: {
          id: "adoption-rec-1",
          logical_post_id: deferredTweetId,
          logical_post_tweet_ids: [deferredTweetId],
          reset_event_key: claimedEventKey,
          representative_tweet_id: deferredTweetId,
          source_tweet_ids: [deferredTweetId],
          claim_source: "new_adoption",
          adopted_at: observedAt,
          claimed_at: observedAt,
          created_at: observedAt,
          updated_at: observedAt,
        },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt,
      usedPercent: 0,
      resetsAt: 1_788_604_800,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      accepted: true,
      recovery: "confirmed",
    });

    const plan = getAtomicPlanFromRequests(requests);
    assert.ok(plan.promotion, "Atomic write plan must include promotion");
    assert.equal((plan.promotion as { tweet_id: string }).tweet_id, deferredTweetId);

    const formalClaim = requests.find((req) => req.url.includes("/rpc/claim_tibo_formal_adoption"));
    assert.ok(formalClaim, "A promoted reset must claim its formal identity after the atomic monitor write");
    assert.equal(formalClaim!.body?.p_reset_event_key, `tibo-reset-${deferredTweetId}`);
    assert.equal(formalClaim!.body?.p_claim_source, "new_adoption");
    const atomicWriteIndex = requests.findIndex((req) => req.url.includes(ATOMIC_RPC_PATH));
    const postAtomicEstimateReads = requests.slice(atomicWriteIndex + 1).filter((req) =>
      req.method === "GET" && req.url.includes("reset_execution_estimates"),
    );
    assert.equal(postAtomicEstimateReads.length > 0, formalAdoption.expectedEstimateRead,
      "A failed or mismatched formal claim must stop persisted-event copy generation");
    assert.equal(requests.some((req) => req.url.includes("generativelanguage.googleapis.com")), false);
    assert.equal(requests.some((req) => req.url.includes("reset_display_names") && req.method !== "GET"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
}

test("Tibo-first recovery generates copy from the persisted canonical monitor event", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  const requests: MockRequest[] = [];
  const noticeId = "2099999999999999921";
  const completionId = "2099999999999999922";
  const observedAt = "2026-08-26T01:15:00.000Z";
  const sourceRows: Array<{
    tweet_id: string;
    text: string;
    tweet_url: string;
    tweet_created_at: string;
    signal_type: string;
    confidence: number;
    verification_status: string;
    classification_source: string;
    is_reply: boolean;
    is_quote: boolean;
    ai_signal_type?: string;
    rule_signal_type?: string;
  }> = [
    {
      tweet_id: noticeId,
      text: "We will reset usage limits for all paid users after fixing a billing quality issue.",
      tweet_url: `https://x.com/thsottiaux/status/${noticeId}`,
      tweet_created_at: "2026-08-26T01:05:00.000Z",
      signal_type: "official_notice",
      confidence: 0.99,
      verification_status: "confirmed",
      classification_source: "gemini",
      is_reply: false,
      is_quote: false,
    },
    {
      tweet_id: completionId,
      text: "I reset usage limits for all paid users. The quality issue is fixed.",
      tweet_url: `https://x.com/thsottiaux/status/${completionId}`,
      tweet_created_at: "2026-08-26T01:14:00.000Z",
      signal_type: "reset_executed",
      confidence: 0.99,
      verification_status: "confirmed",
      classification_source: "gemini",
      is_reply: false,
      is_quote: false,
    },
  ];
  let persistedEstimate: Record<string, unknown> | null = null;
  let persistedObservation: Record<string, unknown> | null = null;
  let displayName: Record<string, unknown> | null = null;
  const geminiPrompts: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      const plan = getAtomicPlan(body);
      const estimate = plan?.execution_estimate;
      const observation = plan?.observation;
      if (estimate && typeof estimate === "object") {
        persistedEstimate = {
          ...(estimate as Record<string, unknown>),
          id: "route-estimate-id",
          recovery_observation_id: "route-observation-id",
        };
      }
      if (observation && typeof observation === "object") {
        persistedObservation = {
          ...(observation as Record<string, unknown>),
          id: "route-observation-id",
          created_at: observedAt,
          updated_at: new Date().toISOString(),
        };
      }
      return respondToAtomicRpc(body);
    }

    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop() ?? "";
    if (method === "GET" && table === "codex_usage_monitor_state") {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-08-26T01:10:00.000Z",
        received_at: "2026-08-26T01:10:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 100,
        window_duration_mins: 10080,
        resets_at: 1_788_000_000,
        coverage_started_at: "2026-08-26T01:00:00.000Z",
        banked_reset_available_count: 0,
        last_banked_grant_at: null,
        updated_at: "2026-08-26T01:10:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && table === "tibo_signals") {
      const tweetFilter = parsed.searchParams.get("tweet_id");
      if (tweetFilter?.startsWith("in.(")) {
        const ids = tweetFilter.slice(4, -1).split(",");
        return new Response(JSON.stringify(sourceRows.filter((row) => ids.includes(row.tweet_id))), { status: 200 });
      }
      let rows = sourceRows;
      const signalFilter = parsed.searchParams.get("signal_type");
      if (signalFilter?.startsWith("eq.")) {
        rows = rows.filter((row) => row.signal_type === signalFilter.slice(3));
      } else if (signalFilter?.startsWith("in.(")) {
        const types = signalFilter.slice(4, -1).split(",");
        rows = rows.filter((row) => types.includes(row.signal_type));
      } else if (parsed.searchParams.has("or")) {
        rows = rows.filter((row) => row.signal_type === "reset_executed" ||
          row.ai_signal_type === "reset_executed" || row.rule_signal_type === "reset_executed");
      }
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (method === "GET" && table === "regular_reset_events") {
      return new Response("[]", { status: 200 });
    }
    if (method === "GET" && table === "reset_execution_estimates") {
      const eventFilter = parsed.searchParams.get("reset_event_key");
      const recoveryObservationFilter = parsed.searchParams.get("recovery_observation_id");
      const estimateRow = persistedEstimate && (
        eventFilter === `eq.${persistedEstimate.reset_event_key}` ||
        recoveryObservationFilter === `eq.${persistedEstimate.recovery_observation_id}`
      )
        ? persistedEstimate
        : null;
      return new Response(JSON.stringify(estimateRow ?? []), { status: 200 });
    }
    if (method === "GET" && table === "codex_recovery_observations") {
      const idFilter = parsed.searchParams.get("id");
      return new Response(JSON.stringify(
        persistedObservation && idFilter === "eq.route-observation-id" ? persistedObservation : [],
      ), { status: 200 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      const prompt = JSON.stringify(body);
      geminiPrompts.push(prompt);
      const metadataRequest = prompt.includes("Canonical related Tibo posts:");
      const result = metadataRequest
        ? {
            reasonType: "詫びリセット",
            scope: null,
            scopeEvidence: null,
            summaryJa: "品質問題の修正後に利用枠をリセット",
            summaryEn: "Usage limits reset after a quality fix",
            summaryZh: "质量问题修复后重置使用额度",
            noteJa: "告知投稿では品質問題への対応が説明され、完了投稿では利用枠の復旧が確認されました。",
            noteEn: "The notice described the quality fix, and the completion post confirmed restored limits.",
            noteZh: "告知帖说明了质量问题的修复，完成帖确认了额度恢复。",
            reasonJa: "品質問題への対応が投稿に明示されています。",
          }
        : {
            nameJa: "品質修正後の利用枠リセット",
            nameEn: "Usage Reset After Quality Fix Reset",
            nameZh: "质量修复后的额度重置",
            reason: "The paired notice and completion posts describe a quality fix.",
          };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (method === "GET" && table === "reset_display_names") {
      return new Response(JSON.stringify(displayName ? [displayName] : []), { status: 200 });
    }
    if ((method === "POST" || method === "PATCH") && table === "reset_display_names") {
      displayName = { ...(displayName ?? {}), ...(body ?? {}) };
      return new Response(JSON.stringify([displayName]), { status: 200 });
    }
    return new Response("[]", { status: method === "POST" ? 201 : 200 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt,
      usedPercent: 0,
      resetsAt: 1_788_604_800,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, recovery: "confirmed" });
    const plan = getAtomicPlanFromRequests(requests);
    assert.equal((plan.execution_estimate as Record<string, unknown>).reset_event_key, `tibo-reset-${completionId}`);
    assert.ok(displayName);
    const storedDisplayName = displayName as Record<string, unknown>;
    assert.equal(storedDisplayName.event_key, `tibo-reset-${completionId}`);
    assert.equal(storedDisplayName.ai_status, "accepted");
    assert.equal(storedDisplayName.event_metadata_status, "success");
    assert.equal(storedDisplayName.event_summary_ja, "品質問題の修正後に利用枠をリセット");
    assert.equal(geminiPrompts.length, 2);
    assert.ok(geminiPrompts.every((prompt) => prompt.includes("Usage Monitor recovery")));
    assert.ok(geminiPrompts.every((prompt) => prompt.includes(noticeId) && prompt.includes(completionId)));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    restore();
  }
});

for (const arrivalOrder of ["monitor-first", "day17-reply-first"] as const) {
  test(`${arrivalOrder} webhook arrival order generates copy only from the linked persisted event`, async () => {
    const restore = withEnvironment({
      CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
    });
    const originalFetch = globalThis.fetch;
    const previousTiboSecret = process.env.TIBO_WEBHOOK_SECRET;
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.TIBO_WEBHOOK_SECRET = "tibo-test-secret";
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const reply = verifiedFutureReplyRow();
    const replyId = String(reply.tweet_id);
    const parentId = "2113162277688070445";
    const recoveryObservedAt = "2026-10-22T17:59:00.000Z";
    const previousObservedAt = "2026-10-22T17:54:00.000Z";
    const canonicalEventKey = `tibo-reset-${parentId}`;
    const requests: MockRequest[] = [];
    const geminiPrompts: string[] = [];
    let sourceReady = arrivalOrder === "day17-reply-first";
    let persistedEstimate: Record<string, unknown> | null = null;
    let originalEstimateEventKey: string | null = null;
    let persistedObservation: Record<string, unknown> | null = null;
    let displayName: Record<string, unknown> | null = null;
    const getPersistedEstimate = (): Record<string, unknown> | null => persistedEstimate;
    const getDisplayName = (): Record<string, unknown> | null => displayName;

    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      requests.push({ url, method, body });
      const parsed = new URL(url);
      const table = parsed.pathname.split("/").pop() ?? "";

      if (method === "POST" && (url.includes(ATOMIC_RPC_PATH) || url.includes(FUTURE_REPLY_ATOMIC_RPC_PATH))) {
        const plan = getAtomicPlan(body);
        const estimate = plan?.execution_estimate;
        const observation = plan?.observation;
        if (estimate && typeof estimate === "object") {
          const initiallyPersistedEventKey = plan?.future_reply_claim
            ? String((estimate as Record<string, unknown>).reset_event_key)
            : "usage-reset-route-observation-id";
          originalEstimateEventKey = initiallyPersistedEventKey;
          persistedEstimate = {
            ...(estimate as Record<string, unknown>),
            reset_event_key: initiallyPersistedEventKey,
            id: "route-estimate-id",
            recovery_observation_id: "route-observation-id",
          };
        }
        if (observation && typeof observation === "object") {
          persistedObservation = {
            ...(observation as Record<string, unknown>),
            id: "route-observation-id",
            created_at: recoveryObservedAt,
            updated_at: recoveryObservedAt,
          };
        }
        return respondToAtomicRpc(body);
      }

      if (method === "POST" && url.includes("/rpc/merge_tibo_source_context_enrichment")) {
        sourceReady = true;
        return new Response(JSON.stringify({ status: "duplicate" }), { status: 200 });
      }

      if (method === "POST" && url.includes("/rpc/reconcile_codex_future_reply_notice")) {
        if (!persistedEstimate) {
          return new Response(JSON.stringify({ status: "not_linked" }), { status: 200 });
        }
        persistedEstimate = {
          ...persistedEstimate,
          execution_window_start_at: previousObservedAt,
          execution_window_end_at: recoveryObservedAt,
          tibo_announced_at: reply.tweet_created_at,
          tibo_primary_tweet_id: replyId,
          tibo_source_tweet_ids: [replyId],
          official_notice_tweet_id: replyId,
          official_notice_at: reply.tweet_created_at,
        };
        return new Response(JSON.stringify({
          status: "linked",
          reset_event_key: persistedEstimate.reset_event_key,
          needs_cache_invalidation: false,
        }), { status: 200 });
      }

      if (url.includes("generativelanguage.googleapis.com")) {
        const prompt = JSON.stringify(body);
        geminiPrompts.push(prompt);
        const result = prompt.includes("Canonical related Tibo posts:")
          ? {
              reasonType: "ご祝儀リセット",
              scope: null,
              scopeEvidence: null,
              summaryJa: "Day 17の投稿に続く返信で期限が案内され、利用枠の回復が観測されました。",
              summaryEn: "A reply to the Day 17 post gave a deadline, and the usage recovery was observed.",
              summaryZh: "Day 17帖子的回复说明了期限，之后观测到额度恢复。",
              noteJa: "Day 17の投稿と同じリセットについて、続く返信で期限が案内されました。",
              noteEn: "A follow-up reply gave a deadline for the same reset described in the Day 17 post.",
              noteZh: "后续回复说明了 Day 17 帖子中同一重置的期限。",
              reasonJa: "明示的な詫び根拠がないため、ご祝儀を運用カテゴリとして適用しました。これは祝賀や原因を示す事実ではありません。",
            }
          : {
              nameJa: null,
              nameEn: null,
              nameZh: null,
              reason: "The canonical notice and monitor observation identify the event.",
            };
        if (prompt.includes("Canonical related Tibo posts:")) {
          displayName = {
            ...(displayName ?? {}),
            manual_name_ja: "手動で決めた名前",
            manual_name_en: "Manually chosen name",
            manual_name_zh: "人工确定的名称",
            ai_name_ja: "以前のAI名を維持",
            ai_name_en: "Keep the previous AI name",
            ai_name_zh: "保留以前的AI名称",
            ai_status: "accepted",
            ai_prompt_version: "previous-name-prompt",
            input_hash: "previous-name-input-hash",
            event_reason_type: "詫びリセット",
            event_scope: "全有料プラン",
            event_summary_ja: "人手で直した日本語要約",
            event_summary_en: "Human edited English summary",
            event_summary_zh: "人工修订的中文摘要",
            event_note_ja: "人手で直した日本語補足。",
            event_note_en: "Human edited English note.",
            event_note_zh: "人工修订的中文补充。",
            event_metadata_status: "success",
            event_metadata_input_hash: "previous-success-hash",
            event_metadata_flags: [],
          };
        }
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "GET" && table === "codex_usage_monitor_state") {
        return new Response(JSON.stringify({
          source_key: "local-codex-app-server",
          observed_at: previousObservedAt,
          received_at: "2026-10-22T17:54:01.000Z",
          limit_id: "codex",
          plan_type: "plus",
          used_percent: 60,
          window_duration_mins: 10080,
          resets_at: Math.floor(Date.parse("2026-10-23T03:55:00.000Z") / 1000),
          coverage_started_at: "2026-10-22T16:00:00.000Z",
          banked_reset_available_count: 1,
          last_banked_grant_at: null,
          updated_at: "2026-10-22T17:54:01.000Z",
        }), { status: 200 });
      }

      if (method === "GET" && table === "tibo_signals") {
        return new Response(JSON.stringify(sourceReady ? [reply] : []), { status: 200 });
      }

      if (method === "GET" && table === "regular_reset_events") {
        return new Response("[]", { status: 200 });
      }

      if (method === "GET" && table === "reset_execution_estimates") {
        const eventKey = parsed.searchParams.get("reset_event_key");
        const observationId = parsed.searchParams.get("recovery_observation_id");
        const estimate = persistedEstimate && (
          eventKey === `eq.${persistedEstimate.reset_event_key}` ||
          observationId === `eq.${persistedEstimate.recovery_observation_id}`
        ) ? persistedEstimate : null;
        return new Response(JSON.stringify(estimate ?? []), { status: 200 });
      }

      if (method === "GET" && table === "codex_recovery_observations") {
        const observationId = parsed.searchParams.get("id");
        return new Response(JSON.stringify(
          persistedObservation && observationId === "eq.route-observation-id" ? persistedObservation : [],
        ), { status: 200 });
      }

      if (method === "GET" && table === "reset_display_names") {
        return new Response(JSON.stringify(displayName ? [displayName] : []), { status: 200 });
      }

      if ((method === "POST" || method === "PATCH") && table === "reset_display_names") {
        const value = body && Array.isArray(body) ? body[0] : body;
        displayName = { ...(displayName ?? {}), ...(value ?? {}) };
        return new Response(JSON.stringify([displayName]), { status: 200 });
      }

      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    };

    const postVerifiedReplyContext = async () => POSTTibo(new NextRequest("http://localhost/api/webhook/tibo", {
      method: "POST",
      headers: {
        authorization: "Bearer tibo-test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "source_context_enrichment",
        tweetId: replyId,
        text: reply.text,
        tweetUrl: reply.tweet_url,
        tweetCreatedAt: reply.tweet_created_at,
        isReply: true,
        replyToHandles: ["@thsottiaux"],
        replyParentTweetId: parentId,
        replyParentTweetUrl: `https://x.com/thsottiaux/status/${parentId}`,
        replyContextText: "Day 17/ Bet you thought we forgot, but no, it’s reset day today.",
      }),
    }));

    try {
      if (arrivalOrder === "monitor-first") {
        const monitorResponse = await POST(buildRequest({
          observedAt: recoveryObservedAt,
          usedPercent: 0,
          resetsAt: Math.floor(Date.parse("2026-10-30T03:55:00.000Z") / 1000),
          monitorProtocolVersion: 2,
          postReason: "recovery_candidate",
        }));
        assert.equal(monitorResponse.status, 200);
        assert.deepEqual(await monitorResponse.json(), { accepted: true, recovery: "observed_unconfirmed" });
        assert.equal(geminiPrompts.length, 0, "A pending monitor estimate cannot generate before its reply link exists");
      }

      const tiboResponse = await postVerifiedReplyContext();
      assert.equal(tiboResponse.status, 200);
      assert.deepEqual(await tiboResponse.json(), { success: true, status: "duplicate" });
      if (arrivalOrder === "day17-reply-first") {
        assert.equal(geminiPrompts.length, 0, "The notice alone cannot generate reset copy");
      }

      if (arrivalOrder === "day17-reply-first") {
        const monitorResponse = await POST(buildRequest({
          observedAt: recoveryObservedAt,
          usedPercent: 0,
          resetsAt: Math.floor(Date.parse("2026-10-30T03:55:00.000Z") / 1000),
          monitorProtocolVersion: 2,
          postReason: "recovery_candidate",
        }));
        assert.equal(monitorResponse.status, 200);
        assert.deepEqual(await monitorResponse.json(), { accepted: true, recovery: "observed_unconfirmed" });
      }

      const linkedEstimate = getPersistedEstimate();
      assert.ok(linkedEstimate);
      assert.equal(originalEstimateEventKey, arrivalOrder === "monitor-first"
        ? "usage-reset-route-observation-id"
        : canonicalEventKey);
      assert.equal(linkedEstimate.reset_event_key, originalEstimateEventKey, "reply reconciliation preserves the estimate's original event key");
      assert.equal(linkedEstimate.official_notice_tweet_id, replyId);
      assert.equal(geminiPrompts.length, 2, "Both copy generators run after the persisted monitor event is linked");
      const metadataPrompt = geminiPrompts.find((prompt) => prompt.includes("Canonical related Tibo posts:"));
      assert.ok(metadataPrompt, "The metadata generator receives persisted Tibo source context");
      const namePrompt = geminiPrompts.find((prompt) => !prompt.includes("Canonical related Tibo posts:"));
      assert.ok(namePrompt, "The display-name generator receives persisted Tibo source context");
      const parentText = "Day 17/ Bet you thought we forgot, but no, it’s reset day today.";
      for (const prompt of [metadataPrompt!, namePrompt!]) {
        assert.ok(prompt.includes("verified reply notice"));
        assert.ok(prompt.includes("verified reply parent"));
        assert.ok(prompt.includes(String(reply.text)));
        assert.ok(prompt.includes(parentText));
        assert.ok(prompt.includes(parentId));
      }
      assert.equal(getDisplayName()?.event_metadata_status, "success");
      assert.equal(getDisplayName()?.manual_name_ja, "手動で決めた名前");
      assert.equal(getDisplayName()?.manual_name_en, "Manually chosen name");
      assert.equal(getDisplayName()?.manual_name_zh, "人工确定的名称");
      assert.equal(getDisplayName()?.ai_name_ja, "以前のAI名を維持");
      assert.equal(getDisplayName()?.ai_name_en, "Keep the previous AI name");
      assert.equal(getDisplayName()?.ai_name_zh, "保留以前的AI名称");
      assert.equal(getDisplayName()?.event_summary_ja, "人手で直した日本語要約");
      assert.equal(getDisplayName()?.event_summary_en, "Human edited English summary");
      assert.equal(getDisplayName()?.event_summary_zh, "人工修订的中文摘要");
      assert.equal(getDisplayName()?.event_note_ja, "人手で直した日本語補足。");
      assert.equal(getDisplayName()?.event_note_en, "Human edited English note.");
      assert.equal(getDisplayName()?.event_note_zh, "人工修订的中文补充。");
    } finally {
      globalThis.fetch = originalFetch;
      restore();
      if (previousTiboSecret === undefined) delete process.env.TIBO_WEBHOOK_SECRET;
      else process.env.TIBO_WEBHOOK_SECRET = previousTiboSecret;
      if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousGeminiKey;
    }
  });
}

test("partial error on notice lookup writes fallback observation and executes cache invalidation path", async () => {
  const restore = withEnvironment({
    CODEX_USAGE_MONITOR_SECRET: "monitor-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  });
  const originalFetch = globalThis.fetch;
  const requests: MockRequest[] = [];
  const observedAt = "2026-08-26T01:15:00.000Z";

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (method === "POST" && url.includes(ATOMIC_RPC_PATH)) {
      return respondToAtomicRpc(body);
    }
    if (method === "GET" && url.includes("codex_usage_monitor_state")) {
      return new Response(JSON.stringify({
        source_key: "local-codex-app-server",
        observed_at: "2026-08-26T01:10:00.000Z",
        received_at: "2026-08-26T01:10:01.000Z",
        limit_id: "codex",
        plan_type: "plus",
        used_percent: 100,
        window_duration_mins: 10080,
        resets_at: 1_788_000_000,
        coverage_started_at: "2026-08-26T01:00:00.000Z",
        banked_reset_available_count: 0,
        last_banked_grant_at: null,
        updated_at: "2026-08-26T01:10:01.000Z",
      }), { status: 200 });
    }
    if (method === "GET" && url.includes("tibo_signals")) {
      return new Response(JSON.stringify({ message: "database connection error" }), { status: 500 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };

  try {
    const response = await POST(buildRequest({
      observedAt,
      usedPercent: 0,
      resetsAt: 1_788_604_800,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      accepted: true,
      recovery: "recovery_observed_unconfirmed",
    });

    const plan = getAtomicPlanFromRequests(requests);
    assert.ok(plan.observation, "Must write fallback observation when uncorroborated recovery occurs");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
