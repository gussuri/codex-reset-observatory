import test from "node:test";
import assert from "node:assert";
import {
  buildHeartbeatRecord,
  type ExistingHeartbeatRecord,
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
    last_page_reload_error: "",
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
    last_page_reload_status: "",
    last_page_reload_error: "snake-error",
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
