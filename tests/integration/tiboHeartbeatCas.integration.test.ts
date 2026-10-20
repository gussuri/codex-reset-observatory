import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { POST as postTiboHeartbeat } from "../../app/api/webhook/tibo/heartbeat/route";
import type {
  HeartbeatTimelineDiagnostic,
  HeartbeatTimelineDiagnostics,
} from "../../lib/radar/heartbeat";

const localUrl = process.env.SUPABASE_LOCAL_URL;
const localServiceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
const localIntegrationMarker = process.env.SUPABASE_LOCAL_INTEGRATION === "1";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const localUrlHost = (() => {
  if (!localUrl) return null;
  try {
    return new URL(localUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
})();
const hasAnyLocalConfiguration = Boolean(localUrl || localServiceRoleKey || localIntegrationMarker);
if (hasAnyLocalConfiguration && (
  !localIntegrationMarker ||
  !localUrl ||
  !localServiceRoleKey ||
  !localUrlHost ||
  !loopbackHosts.has(localUrlHost) ||
  new URL(localUrl).protocol !== "http:"
)) {
  throw new Error("Tibo heartbeat CAS tests require an explicit local integration marker and HTTP loopback Supabase URL");
}
const isConfigured = localIntegrationMarker && Boolean(localUrl && localServiceRoleKey);

const WEBHOOK_SECRET = "local-heartbeat-integration-test-only";
const SELECTOR_VERSION = "v1.14-current-timeline-diagnostics";
const TIMELINE_SESSION_STARTED_AT = new Date(Date.now() - 10 * 60_000).toISOString();
const TIMELINE_DOCUMENT_STARTED_AT = new Date(Date.parse(TIMELINE_SESSION_STARTED_AT) + 1_000).toISOString();
const LOOPBACK_TABLE_PATH = "/rest/v1/tibo_heartbeat";

type HeartbeatRow = Record<string, any> & {
  id: string;
  last_heartbeat_at: string;
  updated_at: string;
  last_scan_summary: Record<string, any> | null;
};

function makeTimelineSlot(
  sourceTimeline: "profile" | "with_replies",
  observedAt: string,
  scanSequence: number,
  parseSuccessCount: number,
): HeartbeatTimelineDiagnostic {
  return {
    sourceTimeline,
    status: parseSuccessCount > 0 ? "healthy" : "empty",
    observedAt,
    scanTimestamp: observedAt,
    lastSuccessfulParseAt: parseSuccessCount > 0 ? observedAt : null,
    sessionStartedAt: TIMELINE_SESSION_STARTED_AT,
    documentStartedAt: TIMELINE_DOCUMENT_STARTED_AT,
    scanSequence,
    articleCount: sourceTimeline === "profile" ? 8 : 1,
    matchingTiboStatusCount: parseSuccessCount,
    parseSuccessCount,
    selectorVersion: SELECTOR_VERSION,
    recoveryStatus: "not_attempted",
    recoveryMoveCount: 0,
    recoveryMaxMoves: 4,
  };
}

function makeCurrentBody(observedAt: string, scanSequence: number, replyParseCount: number) {
  const timelineDiagnostics: HeartbeatTimelineDiagnostics = {
    formatVersion: 2,
    profile: makeTimelineSlot("profile", observedAt, scanSequence, 8),
    with_replies: makeTimelineSlot("with_replies", observedAt, scanSequence, replyParseCount),
  };
  const lastScanSummary = {
    articleCount: 1,
    timeElementCount: 1,
    tweetTextCount: 1,
    nonEmptyTweetTextCount: 1,
    matchingTiboStatusCount: replyParseCount,
    translatedTweetCount: 0,
    tweetDatetimeCount: 1,
    parseSuccessCount: replyParseCount,
    currentUrl: "https://x.com/thsottiaux/with_replies",
    selectorVersion: SELECTOR_VERSION,
    scanTimestamp: observedAt,
    sessionStartedAt: TIMELINE_SESSION_STARTED_AT,
    documentStartedAt: TIMELINE_DOCUMENT_STARTED_AT,
    scanSequence,
    lastSuccessfulParseAt: replyParseCount > 0 ? observedAt : null,
    heartbeatObservedAt: observedAt,
    timelineDiagnostics,
  };
  return {
    sessionId: "current-extension-session",
    lastSuccessfulParseAt: replyParseCount > 0 ? observedAt : null,
    lastSeenTweetId: "2119999000000000001",
    newestSeenTweetCreatedAt: observedAt,
    lastScanError: null,
    lastScanSummary,
    timelineDiagnostics,
    heartbeatObservedAt: observedAt,
    selectorVersion: SELECTOR_VERSION,
  };
}

function makeLegacyBody(sessionId: string, lastSuccessfulParseAt: string) {
  return {
    sessionId,
    lastSuccessfulParseAt,
    selectorVersion: "v1.12",
    lastScanSummary: null,
  };
}

function makeRouteRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/webhook/tibo/heartbeat", {
    method: "POST",
    headers: {
      authorization: `Bearer ${WEBHOOK_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function waitFor(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

test("legacy heartbeats stay live, migrate to timeline diagnostics, and retry updated_at CAS through local PostgREST", {
  skip: !isConfigured,
}, async () => {
  assert.ok(localUrl);
  assert.ok(localServiceRoleKey);
  const supabaseUrl = new URL(localUrl);
  assert.ok(loopbackHosts.has(supabaseUrl.hostname.toLowerCase()));
  assert.equal(supabaseUrl.protocol, "http:");

  const client = createClient(localUrl, localServiceRoleKey, { auth: { persistSession: false } });
  const savedEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TIBO_WEBHOOK_SECRET: process.env.TIBO_WEBHOOK_SECRET,
  };
  const originalFetch = globalThis.fetch;
  let originalRow: HeartbeatRow | null = null;
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = localServiceRoleKey;
  process.env.TIBO_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const readMainRow = async (): Promise<HeartbeatRow> => {
    const { data, error } = await client.from("tibo_heartbeat").select("*").eq("id", "main").single();
    assert.equal(error, null, error?.message);
    assert.ok(data);
    return data as HeartbeatRow;
  };
  const replaceMainRow = async (row: Record<string, unknown> | null) => {
    const { error: deleteError } = await client.from("tibo_heartbeat").delete().eq("id", "main");
    assert.equal(deleteError, null, deleteError?.message);
    if (row) {
      const { error: insertError } = await client.from("tibo_heartbeat").insert(row);
      assert.equal(insertError, null, insertError?.message);
    }
  };
  const post = (body: unknown) => postTiboHeartbeat(makeRouteRequest(body));

  try {
    const { data: priorRow, error: priorRowError } = await client
      .from("tibo_heartbeat")
      .select("*")
      .eq("id", "main")
      .maybeSingle();
    assert.equal(priorRowError, null, priorRowError?.message);
    originalRow = priorRow as HeartbeatRow | null;

    const seedAt = new Date(Date.now() - 60_000).toISOString();
    await replaceMainRow({
      id: "main",
      session_id: "legacy-extension-session",
      session_started_at: seedAt,
      last_heartbeat_at: seedAt,
      last_successful_parse_at: seedAt,
      last_seen_tweet_id: "2119999000000000000",
      last_scan_error: null,
      selector_version: "v1.12",
      last_page_reload_at: null,
      last_page_reload_status: "success",
      last_page_reload_error: null,
      last_scan_summary: null,
      newest_seen_tweet_created_at: null,
      heartbeat_count: 3,
      max_gap_seconds: 300,
      last_gap_seconds: 60,
      updated_at: seedAt,
    });

    const legacyResponse = await post(makeLegacyBody("legacy-extension-session", seedAt));
    assert.equal(legacyResponse.status, 200);
    assert.equal((await legacyResponse.json()).stale, undefined);
    const afterLegacy = await readMainRow();
    assert.ok(Date.parse(afterLegacy.last_heartbeat_at) > Date.parse(seedAt));
    assert.ok(Date.parse(afterLegacy.updated_at) > Date.parse(seedAt));
    assert.equal(afterLegacy.last_scan_summary, null);

    await waitFor(25);
    const migrationAt = new Date().toISOString();
    const migrationResponse = await post(makeCurrentBody(migrationAt, 10, 2));
    assert.equal(migrationResponse.status, 200);
    const migratedRow = await readMainRow();
    assert.equal(migratedRow.last_scan_summary?.timelineDiagnostics?.formatVersion, 2);
    assert.equal(migratedRow.last_scan_summary?.timelineDiagnostics?.with_replies?.scanSequence, 10);

    await waitFor(25);
    const beforeLegacyOnCurrentRow = await readMainRow();
    const legacyOnCurrentResponse = await post(makeLegacyBody(
      beforeLegacyOnCurrentRow.session_id,
      seedAt,
    ));
    assert.equal(legacyOnCurrentResponse.status, 200);
    assert.equal((await legacyOnCurrentResponse.json()).stale, undefined);
    const afterLegacyOnCurrentRow = await readMainRow();
    assert.ok(Date.parse(afterLegacyOnCurrentRow.last_heartbeat_at) > Date.parse(beforeLegacyOnCurrentRow.last_heartbeat_at));
    assert.deepEqual(
      afterLegacyOnCurrentRow.last_scan_summary?.timelineDiagnostics,
      beforeLegacyOnCurrentRow.last_scan_summary?.timelineDiagnostics,
      "legacy telemetry must keep the latest per-lane diagnostics intact",
    );
    assert.equal(
      afterLegacyOnCurrentRow.last_scan_summary?.heartbeatObservedAt,
      beforeLegacyOnCurrentRow.last_scan_summary?.heartbeatObservedAt,
      "legacy telemetry must not replace the latest modern observation time",
    );

    const malformedCurrentBody = makeCurrentBody(new Date().toISOString(), 11, 0);
    assert.equal(Reflect.deleteProperty(malformedCurrentBody, "heartbeatObservedAt"), true);
    assert.equal(Reflect.deleteProperty(malformedCurrentBody.lastScanSummary, "heartbeatObservedAt"), true);
    const beforeMalformed = await readMainRow();
    const malformedResponse = await post(malformedCurrentBody);
    assert.equal(malformedResponse.status, 400);
    assert.equal((await malformedResponse.json()).error, "Invalid heartbeat observation timestamp.");
    assert.equal((await readMainRow()).updated_at, beforeMalformed.updated_at);

    const storedObservationAt = Date.parse(afterLegacyOnCurrentRow.last_scan_summary?.heartbeatObservedAt);
    const waitMs = Math.max(0, storedObservationAt + 2_000 - Date.now());
    if (waitMs > 0) await waitFor(waitMs);
    const freshAt = new Date().toISOString();
    const delayedAt = new Date(Date.parse(freshAt) - 1_000).toISOString();
    assert.ok(Date.parse(delayedAt) > storedObservationAt);

    let routeGetResponses = 0;
    let initialReadResponses = 0;
    let releaseInitialReads!: () => void;
    const initialReadsReleased = new Promise<void>((resolve) => { releaseInitialReads = resolve; });
    let releaseFreshPatch!: () => void;
    const freshPatchCommitted = new Promise<void>((resolve) => { releaseFreshPatch = resolve; });
    const conditionalPatchUrls: URL[] = [];
    const barrierTimeout = setTimeout(() => {
      releaseInitialReads();
      releaseFreshPatch();
    }, 10_000);

    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const isHeartbeatTable = url.origin === supabaseUrl.origin && url.pathname === LOOPBACK_TABLE_PATH;
      if (!isHeartbeatTable) return originalFetch(request);

      if (request.method === "GET") {
        const response = await originalFetch(request);
        if (url.searchParams.get("id") === "eq.main") routeGetResponses += 1;
        if (url.searchParams.get("id") === "eq.main" && initialReadResponses < 2) {
          initialReadResponses += 1;
          if (initialReadResponses === 2) releaseInitialReads();
          await initialReadsReleased;
        }
        return response;
      }

      if (request.method === "PATCH") {
        const payload = await request.clone().json() as {
          last_scan_summary?: { heartbeatObservedAt?: string | null };
        };
        const observationAt = payload.last_scan_summary?.heartbeatObservedAt;
        if (url.searchParams.get("id") === "eq.main" && url.searchParams.has("updated_at")) {
          conditionalPatchUrls.push(url);
        }
        if (observationAt === delayedAt) await freshPatchCommitted;
        const response = await originalFetch(request);
        if (observationAt === freshAt && response.ok) releaseFreshPatch();
        return response;
      }

      return originalFetch(request);
    };

    let freshResponse: Response;
    let delayedResponse: Response;
    try {
      [freshResponse, delayedResponse] = await Promise.all([
        post(makeCurrentBody(freshAt, 12, 0)),
        post(makeCurrentBody(delayedAt, 11, 1)),
      ]);
    } finally {
      clearTimeout(barrierTimeout);
      releaseInitialReads();
      releaseFreshPatch();
      globalThis.fetch = originalFetch;
    }

    assert.equal(initialReadResponses, 2, "both route requests must read the same actual PostgREST row before writing");
    assert.ok(routeGetResponses >= 3, "the CAS loser must re-read PostgREST state before retrying");
    assert.ok(conditionalPatchUrls.length >= 2, "each competing update must use an updated_at equality filter");
    assert.ok(conditionalPatchUrls.every((url) => url.searchParams.get("updated_at")?.startsWith("eq.")));
    assert.equal(freshResponse.status, 200);
    assert.equal((await freshResponse.json()).success, true);
    assert.equal(delayedResponse.status, 200);
    assert.equal((await delayedResponse.json()).stale, true);

    const finalRow = await readMainRow();
    assert.equal(finalRow.last_scan_summary?.heartbeatObservedAt, freshAt);
    assert.equal(finalRow.last_scan_summary?.timelineDiagnostics?.with_replies?.scanTimestamp, freshAt);
    assert.equal(finalRow.last_scan_summary?.timelineDiagnostics?.with_replies?.scanSequence, 12);
    assert.equal(finalRow.last_scan_summary?.timelineDiagnostics?.with_replies?.parseSuccessCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await replaceMainRow(originalRow);
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
});
