import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as postTiboHeartbeat } from "../app/api/webhook/tibo/heartbeat/route";
import {
  classifyHeartbeatPayloadObservation,
  isStaleHeartbeatPayload,
  type HeartbeatRecord,
  type HeartbeatTimelineDiagnostic,
  type HeartbeatTimelineDiagnostics,
} from "../lib/radar/heartbeat";

const initialAt = new Date(Date.now() - 3 * 60_000).toISOString();
const freshAt = new Date(Date.now() - 1_000).toISOString();
const oldAt = new Date(Date.now() - 60_000).toISOString();

function makeLaneDiagnostics(scanAt: string, repliesParseCount: number): HeartbeatTimelineDiagnostics {
  const slot = (
    sourceTimeline: "profile" | "with_replies",
    parseSuccessCount: number,
  ): HeartbeatTimelineDiagnostic => ({
    sourceTimeline,
    status: parseSuccessCount > 0 ? "healthy" : "empty",
    observedAt: scanAt,
    scanTimestamp: scanAt,
    lastSuccessfulParseAt: parseSuccessCount > 0 ? scanAt : null,
    sessionStartedAt: "2026-10-20T16:00:00.000Z",
    documentStartedAt: "2026-10-20T23:00:01.000Z",
    scanSequence: 10,
    articleCount: sourceTimeline === "profile" ? 8 : 1,
    matchingTiboStatusCount: parseSuccessCount,
    parseSuccessCount,
    selectorVersion: "v1.14-current-timeline-diagnostics",
    recoveryStatus: "not_attempted",
    recoveryMoveCount: 0,
    recoveryMaxMoves: 4,
  });
  return {
    formatVersion: 2 as const,
    profile: slot("profile", 8),
    with_replies: slot("with_replies", repliesParseCount),
  };
}

function makeBody(
  heartbeatObservedAt: string,
  replyParseCount: number,
  lastSuccessfulParseAt: string | null,
) {
  return {
    sessionId: "same-session",
    heartbeatObservedAt,
    lastSuccessfulParseAt,
    selectorVersion: "v1.14-current-timeline-diagnostics",
    lastScanSummary: {
      articleCount: 8,
      timeElementCount: 8,
      tweetTextCount: 8,
      matchingTiboStatusCount: 8,
      translatedTweetCount: 0,
      tweetDatetimeCount: 8,
      parseSuccessCount: 8,
      currentUrl: "https://x.com/thsottiaux",
      selectorVersion: "v1.14-current-timeline-diagnostics",
      scanTimestamp: heartbeatObservedAt,
    },
    timelineDiagnostics: makeLaneDiagnostics(heartbeatObservedAt, replyParseCount),
  };
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/webhook/tibo/heartbeat", {
    method: "POST",
    headers: {
      authorization: "Bearer test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function makeInitialRow(): HeartbeatRecord {
  return {
    id: "main",
    session_id: "same-session",
    session_started_at: "2026-10-20T16:00:00.000Z",
    last_heartbeat_at: initialAt,
    last_successful_parse_at: initialAt,
    last_seen_tweet_id: "12345678901234567",
    newest_seen_tweet_created_at: "2026-10-21T00:08:00.000Z",
    last_scan_error: null,
    selector_version: "v1.14-current-timeline-diagnostics",
    last_page_reload_at: null,
    last_page_reload_status: "success",
    last_page_reload_error: null,
    last_scan_summary: {
      articleCount: 8,
      timeElementCount: 8,
      tweetTextCount: 8,
      nonEmptyTweetTextCount: 8,
      matchingTiboStatusCount: 8,
      translatedTweetCount: 0,
      tweetDatetimeCount: 8,
      parseSuccessCount: 8,
      currentUrl: "https://x.com/thsottiaux",
      selectorVersion: "v1.14-current-timeline-diagnostics",
      scanTimestamp: initialAt,
      heartbeatObservedAt: initialAt,
      timelineDiagnostics: makeLaneDiagnostics(initialAt, 1),
    },
    heartbeat_count: 3,
    max_gap_seconds: 300,
    last_gap_seconds: 300,
    updated_at: initialAt,
  };
}

test("heartbeat staleness falls back to the stored heartbeat time for legacy rows", () => {
  assert.equal(isStaleHeartbeatPayload({
    sessionId: "live-old-extension",
    lastSuccessfulParseAt: "2026-10-21T00:10:00.000Z",
    selectorVersion: "v1.12",
  }, {
    last_heartbeat_at: "2026-10-21T00:09:00.000Z",
    last_scan_summary: null,
  }), false, "legacy clients without the observation-time contract must remain live by receipt time");

  assert.equal(isStaleHeartbeatPayload({ heartbeatObservedAt: initialAt }, {
    last_heartbeat_at: initialAt,
    last_scan_summary: null,
  }), true);
  assert.equal(isStaleHeartbeatPayload({ heartbeatObservedAt: freshAt }, {
    last_heartbeat_at: initialAt,
    last_scan_summary: null,
  }), false);
});

test("unknown declared timeline formats without a heartbeat timestamp are invalid, not legacy", () => {
  assert.deepEqual(classifyHeartbeatPayloadObservation({
    selectorVersion: "v2.4-any-name",
    timelineDiagnostics: { formatVersion: 99 },
  }), { kind: "invalid" });
});

test("heartbeat route rejects a timestamp-less payload that declares timeline diagnostics", async () => {
  const previousEnv = {
    TIBO_WEBHOOK_SECRET: process.env.TIBO_WEBHOOK_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = globalThis.fetch;
  process.env.TIBO_WEBHOOK_SECRET = "test-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify(makeInitialRow()), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    const response = await postTiboHeartbeat(makeRequest({
      sessionId: "current-extension",
      selectorVersion: "v1.14-current-timeline-diagnostics",
      timelineDiagnostics: makeLaneDiagnostics(freshAt, 0),
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Invalid heartbeat observation timestamp.");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("heartbeat route rejects delayed and concurrent stale payloads using updated_at CAS", async () => {
  const previousEnv = {
    TIBO_WEBHOOK_SECRET: process.env.TIBO_WEBHOOK_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = globalThis.fetch;
  let row: Record<string, any> | null = makeInitialRow();
  let readCount = 0;
  let releaseReads!: () => void;
  const readBarrier = new Promise<void>((resolve) => { releaseReads = resolve; });
  let releaseFreshPatch!: () => void;
  const freshPatchCommitted = new Promise<void>((resolve) => { releaseFreshPatch = resolve; });
  const requests: Array<{ method: string; url: string }> = [];

  process.env.TIBO_WEBHOOK_SECRET = "test-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const method = request.method;
    requests.push({ method, url: request.url });
    if (!url.pathname.endsWith("/tibo_heartbeat")) {
      return new Response("[]", { status: 200 });
    }

    if (method === "GET") {
      const snapshot = row ? structuredClone(row) : null;
      readCount += 1;
      if (readCount <= 2) {
        if (readCount === 2) releaseReads();
        await readBarrier;
      }
      if (!snapshot) {
        return new Response(JSON.stringify({
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
        }), { status: 406, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "PATCH") {
      const payload = await request.json() as Record<string, any>;
      const expectedUpdatedAt = url.searchParams.get("updated_at")?.replace(/^eq\./, "");
      const incomingStamp = payload.last_scan_summary?.heartbeatObservedAt;
      if (incomingStamp === oldAt) await freshPatchCommitted;
      if (!row || row.updated_at !== expectedUpdatedAt) {
        return new Response(JSON.stringify({
          code: "PGRST116",
          message: "JSON object requested, no rows returned",
        }), { status: 406, headers: { "content-type": "application/json" } });
      }
      row = { ...row, ...payload };
      if (incomingStamp === freshAt) releaseFreshPatch();
      return new Response(JSON.stringify(row), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("[]", { status: 200 });
  };

  try {
    const [freshResponse, lateResponse] = await Promise.all([
      postTiboHeartbeat(makeRequest(makeBody(freshAt, 0, null))),
      postTiboHeartbeat(makeRequest(makeBody(oldAt, 1, oldAt))),
    ]);

    assert.equal(freshResponse.status, 200);
    assert.equal(lateResponse.status, 200);
    assert.ok(requests.filter((request) => request.method === "PATCH").length >= 2);
    assert.equal(row?.last_scan_summary.timelineDiagnostics.with_replies.scanTimestamp, freshAt);
    assert.equal(row?.last_scan_summary.timelineDiagnostics.with_replies.parseSuccessCount, 0);
    assert.equal(row?.last_successful_parse_at, initialAt);
    assert.equal(row?.last_scan_summary.heartbeatObservedAt, freshAt);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
