import test from "node:test";
import assert from "node:assert";
import { NextRequest } from "next/server";
import { POST as postTiboHeartbeat } from "../app/api/webhook/tibo/heartbeat/route";
import {
  buildHeartbeatRecord,
  isMissingHeartbeatDiagnosticColumn,
  withoutHeartbeatDiagnosticColumns,
  type ExistingHeartbeatRecord,
  type HeartbeatRecord,
  type HeartbeatRequestBody,
} from "../lib/radar/heartbeat";

test("builds the complete same-session record with snake_case reload fields", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const existing: ExistingHeartbeatRecord = {
    id: "main",
    session_id: "test-session-789",
    session_started_at: "2026-07-31T20:00:00.000Z",
    last_heartbeat_at: "2026-07-31T23:55:00.000Z",
    heartbeat_count: 7,
    max_gap_seconds: 120,
  };
  const body: HeartbeatRequestBody = {
    sessionId: "test-session-789",
    lastSuccessfulParseAt: "2026-07-31T23:00:00.000Z",
    lastSeenTweetId: "tweet-789",
    lastScanError: null,
    selectorVersion: "v1.4-extension",
    last_page_reload_at: "2026-07-31T22:30:00.000Z",
    last_page_reload_status: "success",
    last_page_reload_error: null,
    last_scan_summary: null,
  };

  const payload = buildHeartbeatRecord(body, existing, now);

  assert.deepStrictEqual(payload, {
    id: "main",
    session_id: "test-session-789",
    session_started_at: existing.session_started_at,
    last_heartbeat_at: now.toISOString(),
    last_successful_parse_at: "2026-07-31T23:00:00.000Z",
    last_seen_tweet_id: "tweet-789",
    last_scan_error: null,
    selector_version: "v1.4-extension",
    last_page_reload_at: "2026-07-31T22:30:00.000Z",
    last_page_reload_status: "success",
    last_page_reload_error: null,
    last_scan_summary: null,
    heartbeat_count: 8,
    max_gap_seconds: 300,
    last_gap_seconds: 300,
    updated_at: now.toISOString(),
  });
});

test("resets session start, count, and gaps for a new session", () => {
  const now = new Date("2026-08-01T01:00:00.000Z");
  const existing: ExistingHeartbeatRecord = {
    id: "main",
    session_id: "old-session",
    session_started_at: "2026-07-30T20:00:00.000Z",
    last_heartbeat_at: "2026-08-01T00:30:00.000Z",
    heartbeat_count: 99,
    max_gap_seconds: 600,
  };

  const payload = buildHeartbeatRecord({ sessionId: "new-session" }, existing, now);

  assert.deepStrictEqual(payload, {
    id: "main",
    session_id: "new-session",
    session_started_at: now.toISOString(),
    last_heartbeat_at: now.toISOString(),
    last_successful_parse_at: null,
    last_seen_tweet_id: null,
    last_scan_error: null,
    selector_version: "v1",
    last_page_reload_at: null,
    last_page_reload_status: null,
    last_page_reload_error: null,
    last_scan_summary: null,
    heartbeat_count: 1,
    max_gap_seconds: 0,
    last_gap_seconds: 0,
    updated_at: now.toISOString(),
  });
});

test("accepts camelCase reload aliases in the persistence record", () => {
  const now = new Date("2026-08-01T02:00:10.000Z");
  const existing: ExistingHeartbeatRecord = {
    session_id: "camel-session",
    session_started_at: "2026-08-01T01:00:00.000Z",
    last_heartbeat_at: "2026-08-01T02:00:00.000Z",
    heartbeat_count: 2,
    max_gap_seconds: 5,
  };

  const payload = buildHeartbeatRecord(
    {
      sessionId: "camel-session",
      lastPageReloadAt: "2026-08-01T01:59:00.000Z",
      lastPageReloadStatus: "success",
      lastPageReloadError: "",
    },
    existing,
    now,
  );

  assert.deepStrictEqual(payload, {
    id: "main",
    session_id: "camel-session",
    session_started_at: "2026-08-01T01:00:00.000Z",
    last_heartbeat_at: now.toISOString(),
    last_successful_parse_at: null,
    last_seen_tweet_id: null,
    last_scan_error: null,
    selector_version: "v1",
    last_page_reload_at: "2026-08-01T01:59:00.000Z",
    last_page_reload_status: "success",
    last_page_reload_error: null,
    last_scan_summary: null,
    heartbeat_count: 3,
    max_gap_seconds: 10,
    last_gap_seconds: 10,
    updated_at: now.toISOString(),
  });
});

test("gives snake_case reload fields precedence over camelCase aliases", () => {
  const now = new Date("2026-08-01T03:00:20.000Z");
  const existing: ExistingHeartbeatRecord = {
    session_id: "precedence-session",
    session_started_at: "2026-08-01T02:00:00.000Z",
    last_heartbeat_at: "2026-08-01T03:00:00.000Z",
    heartbeat_count: 4,
    max_gap_seconds: 20,
  };

  const payload = buildHeartbeatRecord(
    {
      sessionId: "precedence-session",
      last_page_reload_at: "snake-at",
      lastPageReloadAt: "camel-at",
      last_page_reload_status: "",
      lastPageReloadStatus: "camel-status",
      last_page_reload_error: "snake-error",
      lastPageReloadError: "camel-error",
    },
    existing,
    now,
  );

  assert.deepStrictEqual(payload, {
    id: "main",
    session_id: "precedence-session",
    session_started_at: "2026-08-01T02:00:00.000Z",
    last_heartbeat_at: now.toISOString(),
    last_successful_parse_at: null,
    last_seen_tweet_id: null,
    last_scan_error: null,
    selector_version: "v1",
    last_page_reload_at: "snake-at",
    last_page_reload_status: "error",
    last_page_reload_error: "page_reload_error",
    last_scan_summary: null,
    heartbeat_count: 5,
    max_gap_seconds: 20,
    last_gap_seconds: 20,
    updated_at: now.toISOString(),
  });
});

test("uses default_session before comparing an omitted session id", () => {
  const now = new Date("2026-08-01T04:00:30.000Z");
  const existing: ExistingHeartbeatRecord = {
    session_id: "default_session",
    session_started_at: "2026-08-01T03:00:00.000Z",
    last_heartbeat_at: "2026-08-01T04:00:00.000Z",
    heartbeat_count: 6,
    max_gap_seconds: 30,
  };

  const payload = buildHeartbeatRecord({}, existing, now);

  assert.strictEqual(payload.session_id, "default_session");
  assert.strictEqual(payload.session_started_at, existing.session_started_at);
  assert.strictEqual(payload.heartbeat_count, 7);
  assert.strictEqual(payload.last_gap_seconds, 30);
  assert.strictEqual(payload.max_gap_seconds, 30);
});

test("persists only the safe scan summary and never raw diagnostic content", () => {
  const now = new Date("2026-08-01T05:00:00.000Z");
  const body = {
    sessionId: "summary-session",
    lastScanError: "translated_text_detected",
    lastScanSummary: {
      articleCount: 3,
      timeElementCount: 2,
      tweetTextCount: 2,
      matchingTiboStatusCount: 1,
      translatedTweetCount: 1,
      tweetDatetimeCount: 1,
      parseSuccessCount: 0,
      currentUrl: "https://x.com/thsottiaux",
      selectorVersion: "v1.5-diagnostics",
      scanTimestamp: "2026-08-01T04:59:50.000Z",
      snapshots: ["<article>secret HTML</article>"],
    },
  } as HeartbeatRequestBody;

  const payload = buildHeartbeatRecord(body, null, now) as HeartbeatRecord & {
    last_scan_summary?: Record<string, unknown>;
  };

  assert.deepStrictEqual(payload.last_scan_summary, {
    articleCount: 3,
    timeElementCount: 2,
    tweetTextCount: 2,
    nonEmptyTweetTextCount: 2,
    matchingTiboStatusCount: 1,
    translatedTweetCount: 1,
    tweetDatetimeCount: 1,
    parseSuccessCount: 0,
    currentUrl: "https://x.com/thsottiaux",
    selectorVersion: "v1.5-diagnostics",
    scanTimestamp: "2026-08-01T04:59:50.000Z",
    sessionStartedAt: null,
    documentStartedAt: null,
    scanSequence: 0,
    lastSuccessfulParseAt: null,
  });
  assert.doesNotMatch(JSON.stringify(payload.last_scan_summary), /secret HTML|snapshots/i);
});

test("persists only the two safe timeline diagnostics inside the existing JSON summary", () => {
  const payload = buildHeartbeatRecord(
    {
      lastScanSummary: {
        articleCount: 1,
        timeElementCount: 1,
        tweetTextCount: 1,
        matchingTiboStatusCount: 1,
        translatedTweetCount: 0,
        tweetDatetimeCount: 1,
        parseSuccessCount: 1,
        currentUrl: "https://x.com/thsottiaux",
        selectorVersion: "v1.14-current-timeline-diagnostics",
        scanTimestamp: "2026-08-01T04:59:50.000Z",
        snapshots: ["private text must not survive"],
      },
      timelineDiagnostics: {
        formatVersion: 2,
        profile: {
          sourceTimeline: "profile",
          status: "healthy",
          observedAt: "2026-08-01T04:59:50.000Z",
          scanTimestamp: "2026-08-01T04:59:50.000Z",
          lastSuccessfulParseAt: "2026-08-01T04:59:50.000Z",
          sessionStartedAt: "2026-08-01T04:00:00.000Z",
          documentStartedAt: "2026-08-01T04:00:01.000Z",
          scanSequence: 20,
          articleCount: 4,
          matchingTiboStatusCount: 1,
          parseSuccessCount: 1,
          selectorVersion: "v1.14-current-timeline-diagnostics",
          recoveryStatus: "target_found",
          recoveryMoveCount: 99,
          recoveryMaxMoves: 99,
          text: "private text must not survive",
        },
        with_replies: {
          sourceTimeline: "with_replies",
          status: "not_open",
          observedAt: "2026-08-01T04:59:50.000Z",
          scanTimestamp: null,
          lastSuccessfulParseAt: null,
          sessionStartedAt: "2026-08-01T04:00:00.000Z",
          documentStartedAt: "2026-08-01T04:00:01.000Z",
          scanSequence: 0,
          text: "private",
        },
        other: { text: "drop this" },
      },
    },
    null,
    new Date("2026-08-01T05:00:00.000Z"),
  );

  assert.deepStrictEqual(payload.last_scan_summary?.timelineDiagnostics, {
    formatVersion: 2,
    profile: {
      sourceTimeline: "profile",
      status: "healthy",
      observedAt: "2026-08-01T04:59:50.000Z",
      scanTimestamp: "2026-08-01T04:59:50.000Z",
      lastSuccessfulParseAt: "2026-08-01T04:59:50.000Z",
      sessionStartedAt: "2026-08-01T04:00:00.000Z",
      documentStartedAt: "2026-08-01T04:00:01.000Z",
      scanSequence: 20,
      articleCount: 4,
      matchingTiboStatusCount: 1,
      parseSuccessCount: 1,
      selectorVersion: "v1.14-current-timeline-diagnostics",
      recoveryStatus: "target_found",
      recoveryMoveCount: 4,
      recoveryMaxMoves: 4,
    },
    with_replies: {
      sourceTimeline: "with_replies",
      status: "not_open",
      observedAt: "2026-08-01T04:59:50.000Z",
      scanTimestamp: null,
      lastSuccessfulParseAt: null,
      sessionStartedAt: "2026-08-01T04:00:00.000Z",
      documentStartedAt: "2026-08-01T04:00:01.000Z",
      scanSequence: 0,
      articleCount: 0,
      matchingTiboStatusCount: 0,
      parseSuccessCount: 0,
      selectorVersion: "unknown",
      recoveryStatus: "not_attempted",
      recoveryMoveCount: 0,
      recoveryMaxMoves: 0,
    },
  });
  assert.doesNotMatch(JSON.stringify(payload.last_scan_summary), /private text|drop this|snapshots/i);
});

test("current timeline diagnostics survive heartbeats that omit a new scan summary", () => {
  const existing = {
    session_id: "timeline-session",
    session_started_at: "2026-08-01T04:00:00.000Z",
    last_heartbeat_at: "2026-08-01T04:59:00.000Z",
    last_scan_summary: {
      articleCount: 0,
      timeElementCount: 0,
      tweetTextCount: 0,
      matchingTiboStatusCount: 0,
      translatedTweetCount: 0,
      tweetDatetimeCount: 0,
      parseSuccessCount: 0,
      currentUrl: "https://x.com/thsottiaux",
      selectorVersion: "v1.14-current-timeline-diagnostics",
      scanTimestamp: "2026-08-01T04:59:00.000Z",
      timelineDiagnostics: {
        formatVersion: 2,
        profile: {
          sourceTimeline: "profile",
          status: "healthy",
          observedAt: "2026-08-01T04:59:00.000Z",
          scanTimestamp: "2026-08-01T04:59:00.000Z",
          lastSuccessfulParseAt: "2026-08-01T04:59:00.000Z",
          sessionStartedAt: "2026-08-01T04:00:00.000Z",
          documentStartedAt: "2026-08-01T04:00:01.000Z",
          scanSequence: 60,
          parseSuccessCount: 2,
        },
        with_replies: {
          sourceTimeline: "with_replies",
          status: "empty",
          observedAt: "2026-08-01T04:59:00.000Z",
          scanTimestamp: "2026-08-01T04:58:00.000Z",
          lastSuccessfulParseAt: "2026-08-01T04:50:00.000Z",
          sessionStartedAt: "2026-08-01T04:00:00.000Z",
          documentStartedAt: "2026-08-01T04:00:02.000Z",
          scanSequence: 50,
          parseSuccessCount: 0,
        },
      },
    },
  };
  const payload = buildHeartbeatRecord(
    { sessionId: "timeline-session" },
    existing,
    new Date("2026-08-01T05:00:00.000Z"),
  );

  assert.equal(payload.last_scan_summary?.timelineDiagnostics?.with_replies.status, "empty");
});

test("persists the newest valid tweet timestamp without affecting health fields", () => {
  const now = new Date("2026-08-01T06:00:00.000Z");
  const payload = buildHeartbeatRecord(
    {
      sessionId: "tweet-time-session",
      lastSuccessfulParseAt: "2026-08-01T05:59:00.000Z",
      lastSeenTweetId: "tweet-newest",
      newestSeenTweetCreatedAt: "2026-08-01T05:58:00.000Z",
    },
    null,
    now,
  );

  assert.equal(payload.newest_seen_tweet_created_at, "2026-08-01T05:58:00.000Z");
  assert.equal(payload.last_successful_parse_at, "2026-08-01T05:59:00.000Z");
  assert.equal(payload.last_seen_tweet_id, "tweet-newest");
});

test("ignores invalid or too-far-future newest tweet timestamps and keeps the existing value", () => {
  const now = new Date("2026-08-01T06:00:00.000Z");
  const existing: ExistingHeartbeatRecord = {
    session_id: "tweet-time-session",
    session_started_at: "2026-08-01T05:00:00.000Z",
    last_heartbeat_at: "2026-08-01T05:59:00.000Z",
    newest_seen_tweet_created_at: "2026-08-01T05:58:00.000Z",
  };

  const invalid = buildHeartbeatRecord(
    { sessionId: "tweet-time-session", newestSeenTweetCreatedAt: "not-a-date" },
    existing,
    now,
  );
  const future = buildHeartbeatRecord(
    { sessionId: "tweet-time-session", newestSeenTweetCreatedAt: "2026-08-01T06:10:00.000Z" },
    existing,
    now,
  );

  assert.equal(invalid.newest_seen_tweet_created_at, existing.newest_seen_tweet_created_at);
  assert.equal(future.newest_seen_tweet_created_at, existing.newest_seen_tweet_created_at);
});

test("legacy heartbeat retry removes both optional diagnostic columns", () => {
  const payload = buildHeartbeatRecord(
    { newestSeenTweetCreatedAt: "2026-08-01T05:58:00.000Z", lastScanSummary: {} },
    null,
    new Date("2026-08-01T06:00:00.000Z"),
  );
  const legacyPayload = withoutHeartbeatDiagnosticColumns(payload);

  assert.equal("last_scan_summary" in legacyPayload, false);
  assert.equal("newest_seen_tweet_created_at" in legacyPayload, false);
  assert.equal(isMissingHeartbeatDiagnosticColumn({ code: "PGRST204", message: "column missing" }), true);
  assert.equal(
    isMissingHeartbeatDiagnosticColumn({ message: "Could not find newest_seen_tweet_created_at" }),
    true,
  );
});

test("heartbeat route returns 500 when Supabase read returns non-PGRST116 error", async () => {
  const previousEnv = {
    TIBO_WEBHOOK_SECRET: process.env.TIBO_WEBHOOK_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = globalThis.fetch;

  process.env.TIBO_WEBHOOK_SECRET = "test-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("tibo_heartbeat")) {
      return new Response(JSON.stringify({
        code: "57014",
        message: "canceling statement due to statement timeout",
      }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };

  try {
    const req = new NextRequest("http://localhost/api/webhook/tibo/heartbeat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId: "test-session" }),
    });

    const response = await postTiboHeartbeat(req);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "Database error");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, val] of Object.entries(previousEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
});

test("heartbeat route treats PGRST116 error as new session (row does not exist yet)", async () => {
  const previousEnv = {
    TIBO_WEBHOOK_SECRET: process.env.TIBO_WEBHOOK_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = globalThis.fetch;
  const requests: { url: string; method: string }[] = [];

  process.env.TIBO_WEBHOOK_SECRET = "test-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    requests.push({ url, method });

    if (method === "GET" && url.includes("tibo_heartbeat")) {
      return new Response(JSON.stringify({
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
      }), {
        status: 406,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const req = new NextRequest("http://localhost/api/webhook/tibo/heartbeat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId: "new-session" }),
    });

    const response = await postTiboHeartbeat(req);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.heartbeatCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, val] of Object.entries(previousEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
});
