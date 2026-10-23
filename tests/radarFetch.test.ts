import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  ACTIVE_TIBO_SIGNAL_TYPES,
  ACTIVE_TIBO_SIGNAL_SELECT_FIELDS,
  applyActiveTiboQueryFilters,
  applyTimedTiboQueryFilters,
  associateTiboNotices,
  buildCanonicalTiboHistoryFilter,
  buildPublicRadarSnapshotBundle,
  getEffectiveRadarCalculationNow,
  getRadarPageCacheDimensions,
  getRandomResetHeatmapCacheDimensions,
  getPublicRadarSnapshotCacheDimensions,
  getPublicRadarSnapshotCalculationBucket,
  fetchResetDisplayNameCandidateNoticeSignals,
  fetchCurrentRadarData,
  RADAR_PAGE_CACHE_TTL_SECONDS,
  PUBLIC_RADAR_SNAPSHOT_BUCKET_SECONDS,
  PUBLIC_RADAR_SNAPSHOT_CACHE_RETENTION_SECONDS,
  RADAR_CORE_CACHE_TTL_SECONDS,
  readTiboHistorySignals,
  splitTiboHistorySignals,
  TIBO_HISTORY_PAGE_SIZE,
  TIBO_HISTORY_SELECT_FIELDS,
  TIBO_RECENT_MAX_ROWS,
  TIBO_RECENT_SELECT_FIELDS,
  TIMED_TIBO_SIGNAL_MAX_ROWS,
  TIMED_TIBO_SIGNAL_SELECT_FIELDS,
  getTimedTiboLimitTelemetry,
  PREDICTION_HISTORY_CACHE_TTL_SECONDS,
  RESET_DISPLAY_NAME_CACHE_TTL_SECONDS,
  TIBO_HISTORY_CACHE_TTL_SECONDS,
} from "../lib/radarFetch";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import type { FormalTiboResetSignal, TiboNoticeSignal } from "../lib/radar/tiboHistory";

function resetSignal(tweetId: string, createdAt: string): FormalTiboResetSignal {
  return {
    tweet_id: tweetId,
    text: "I reset usage limits for Codex.",
    tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
    tweet_created_at: createdAt,
    signal_type: "reset_executed",
    confidence: 0.99,
    verification_status: "auto_unverified",
    classification_source: "gemini",
  };
}

function noticeSignal(tweetId: string, createdAt: string): TiboNoticeSignal {
  return {
    tweet_id: tweetId,
    text: "A reset is coming soon.",
    tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
    tweet_created_at: createdAt,
    signal_type: "official_notice",
    confidence: 0.99,
    verification_status: "auto_unverified",
  };
}

test("shared Radar core uses a fifteen-minute normal cache TTL", () => {
  assert.equal(RADAR_CORE_CACHE_TTL_SECONDS, 15 * 60);
});

test("slow source caches use bounded TTLs while live signal caches stay short", () => {
  assert.equal(TIBO_HISTORY_CACHE_TTL_SECONDS, 15 * 60);
  assert.equal(RESET_DISPLAY_NAME_CACHE_TTL_SECONDS, 60 * 60);
  assert.equal(PREDICTION_HISTORY_CACHE_TTL_SECONDS, 15 * 60);
  assert.ok(TIBO_HISTORY_CACHE_TTL_SECONDS >= RADAR_CORE_CACHE_TTL_SECONDS);
  assert.ok(RESET_DISPLAY_NAME_CACHE_TTL_SECONDS >= TIBO_HISTORY_CACHE_TTL_SECONDS);
});

test("candidate notice fetch classifies loading-form BANKED announcement as BANKED without broadening eligibility", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  const announcementText = "We are loading a banked reset into all accounts of our Plus, Pro and Business users.";
  const recurringConditionalText = "We give one banked reset for every day you don't have access to Astra on your paid ChatGPT plan.";
  globalThis.fetch = async () => new Response(JSON.stringify([{
    tweet_id: "banked-loading-notice",
    text: announcementText,
    tweet_url: "https://x.com/thsottiaux/status/banked-loading-notice",
    tweet_created_at: "2026-10-07T16:00:00.000Z",
    detected_at: "2026-10-07T16:01:00.000Z",
    signal_type: "official_notice",
    verification_status: "confirmed",
    is_reply: false,
    logical_post_id: null,
    edit_history_tweet_ids: null,
    edit_metadata_source: null,
    ai_temporal_kind: "none",
    ai_temporal_precision: "unknown",
    temporal_kind: "none",
    temporal_precision: "unknown",
    expected_start_at: null,
    expected_end_at: null,
    ai_reset_type_ja: "任意リセット権配布",
    scope: "全有料プラン",
  }, {
    tweet_id: "banked-recurring-conditional-notice",
    text: recurringConditionalText,
    tweet_url: "https://x.com/thsottiaux/status/banked-recurring-conditional-notice",
    tweet_created_at: "2026-10-07T16:00:00.000Z",
    detected_at: "2026-10-07T16:01:00.000Z",
    signal_type: "official_notice",
    verification_status: "confirmed",
    is_reply: false,
    logical_post_id: null,
    edit_history_tweet_ids: null,
    edit_metadata_source: null,
    ai_temporal_kind: "none",
    ai_temporal_precision: "unknown",
    temporal_kind: "none",
    temporal_precision: "unknown",
    expected_start_at: null,
    expected_end_at: null,
    ai_reset_type_ja: "任意リセット権配布",
    scope: "一部ユーザー",
  }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    const notices = await fetchResetDisplayNameCandidateNoticeSignals({
      mode: "seed",
      adoptionAt: "2026-08-01T00:00:00.000Z",
    });
    const notice = notices.find((candidate) => candidate.officialNoticeTweetId === "banked-loading-notice");
    const recurringNotice = notices.find((candidate) => candidate.officialNoticeTweetId === "banked-recurring-conditional-notice");

    assert.ok(notice);
    assert.equal(notice.candidateEventKind, "banked_distribution");
    assert.equal(notice.isExecutionBearing, true);
    assert.equal(notice.sourceContext, announcementText);
    assert.ok(recurringNotice);
    assert.equal(recurringNotice.candidateEventKind, "banked_distribution");
    assert.equal(recurringNotice.isExecutionBearing, false);
    assert.equal(recurringNotice.sourceContext, recurringConditionalText);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("page projections use a one-hour cache while API snapshots keep a ten-minute bucket and one-hour retention", () => {
  assert.equal(RADAR_PAGE_CACHE_TTL_SECONDS, 60 * 60);
  assert.equal(PUBLIC_RADAR_SNAPSHOT_BUCKET_SECONDS, 10 * 60);
  assert.equal(PUBLIC_RADAR_SNAPSHOT_CACHE_RETENTION_SECONDS, 60 * 60);
  assert.ok(PUBLIC_RADAR_SNAPSHOT_CACHE_RETENTION_SECONDS > PUBLIC_RADAR_SNAPSHOT_BUCKET_SECONDS);

  const source = readFileSync(resolve("lib/radarFetch.ts"), "utf8");
  const pageFetchSource = source.slice(source.indexOf("export async function fetchRadarPageData"));
  const heatmapCacheSource = source.slice(
    source.indexOf("const getCachedRandomResetHeatmapEventTimes = unstable_cache("),
    source.indexOf("const getCachedRadarPageData = unstable_cache("),
  );

  assert.match(source, /getCachedRadarPageData = unstable_cache/);
  assert.match(source, /revalidate: RADAR_PAGE_CACHE_TTL_SECONDS/);
  assert.match(source, /revalidate: PUBLIC_RADAR_SNAPSHOT_CACHE_RETENTION_SECONDS/);
  assert.doesNotMatch(source, /PUBLIC_RADAR_SNAPSHOT_CACHE_TTL_SECONDS/);
  assert.match(heatmapCacheSource, /revalidate: PUBLIC_RADAR_SNAPSHOT_BUCKET_SECONDS/);
  assert.match(source, /tags: \[RADAR_CACHE_TAGS\.core\]/);
  assert.match(pageFetchSource, /getCachedRadarPageData/);
  assert.doesNotMatch(pageFetchSource, /fetchPublicRadarSnapshot|fetchRandomResetHeatmapEventTimes/);
});

test("page cache dimensions use a one-hour bucket and preserve home/history variants", () => {
  const start = Date.parse("2026-09-01T00:00:00.000Z");
  const beforeBoundary = start + RADAR_PAGE_CACHE_TTL_SECONDS * 1000 - 1;
  const nextBucket = start + RADAR_PAGE_CACHE_TTL_SECONDS * 1000;

  assert.deepEqual(
    getRadarPageCacheDimensions("ja", start),
    { locale: "ja", calculationBucket: Math.floor(start / (RADAR_PAGE_CACHE_TTL_SECONDS * 1000)), limitHistory: true, includeHeatmap: true },
  );
  assert.equal(
    getRadarPageCacheDimensions("ja", start).calculationBucket,
    getRadarPageCacheDimensions("ja", beforeBoundary).calculationBucket,
  );
  assert.notEqual(
    getRadarPageCacheDimensions("ja", start).calculationBucket,
    getRadarPageCacheDimensions("ja", nextBucket).calculationBucket,
  );
  assert.deepEqual(
    getRadarPageCacheDimensions("en", start, false, false),
    { locale: "en", calculationBucket: Math.floor(start / (RADAR_PAGE_CACHE_TTL_SECONDS * 1000)), limitHistory: false, includeHeatmap: false },
  );
});

test("public snapshot bundle cache keys use ten-minute bucket and history limit", () => {
  const start = Date.parse("2026-09-01T00:00:00.000Z");
  const beforeBoundary = start + PUBLIC_RADAR_SNAPSHOT_BUCKET_SECONDS * 1000 - 1;
  const nextBucket = start + PUBLIC_RADAR_SNAPSHOT_BUCKET_SECONDS * 1000;

  assert.equal(
    getPublicRadarSnapshotCalculationBucket(start),
    getPublicRadarSnapshotCalculationBucket(beforeBoundary),
  );
  assert.notEqual(
    getPublicRadarSnapshotCalculationBucket(start),
    getPublicRadarSnapshotCalculationBucket(nextBucket),
  );
  assert.deepEqual(getPublicRadarSnapshotCacheDimensions(start), {
    calculationBucket: getPublicRadarSnapshotCalculationBucket(start),
    limitHistory: true,
  });
  assert.deepEqual(getPublicRadarSnapshotCacheDimensions(start, false), {
    calculationBucket: getPublicRadarSnapshotCalculationBucket(start),
    limitHistory: false,
  });
});

test("one public snapshot bundle matches the previous locale-by-locale DTOs", () => {
  const calculationNow = new Date("2026-09-09T01:23:45.000Z");
  const generatedAt = "2026-09-09T01:20:00.000Z";
  const data = getLocalRadarData({ checkedAt: generatedAt, calculationNow });
  const core = { data, generatedAt, stale: false };
  const calculationBucket = getPublicRadarSnapshotCalculationBucket(calculationNow);

  for (const limitHistory of [true, false]) {
    const bundle = buildPublicRadarSnapshotBundle(core, calculationBucket, limitHistory);
    const effectiveCalculationNow = getEffectiveRadarCalculationNow(calculationBucket, generatedAt);

    assert.deepEqual(Object.keys(bundle), ["ja", "en", "zh"]);
    for (const locale of ["ja", "en", "zh"] as const) {
      const expected = toPublicRadarSnapshot(data, locale, {
        stale: false,
        generatedAt,
        limitHistory,
        calculationNow: effectiveCalculationNow,
      });
      assert.equal(JSON.stringify(bundle[locale]), JSON.stringify(expected));
    }
  }
});

test("homepage snapshot and heatmap share the calculation bucket contract", () => {
  const start = Date.parse("2026-09-01T00:00:00.000Z");
  const sameBucket = start + 5 * 60 * 1000;
  const nextBucket = start + PUBLIC_RADAR_SNAPSHOT_BUCKET_SECONDS * 1000;

  assert.deepEqual(
    getRandomResetHeatmapCacheDimensions(start),
    getRandomResetHeatmapCacheDimensions(sameBucket),
  );
  assert.notDeepEqual(
    getRandomResetHeatmapCacheDimensions(start),
    getRandomResetHeatmapCacheDimensions(nextBucket),
  );
  assert.equal(
    getPublicRadarSnapshotCacheDimensions(start).calculationBucket,
    getRandomResetHeatmapCacheDimensions(start).calculationBucket,
  );
  for (const locale of ["en", "zh"] as const) {
    assert.equal(
      getPublicRadarSnapshotCacheDimensions(start).calculationBucket,
      getRandomResetHeatmapCacheDimensions(start).calculationBucket,
    );
  }
});

test("cached projections use refreshed core time within the bucket without changing the cache key", () => {
  const bucketStart = Date.parse("2026-09-01T00:00:00.000Z");
  const bucket = getPublicRadarSnapshotCalculationBucket(bucketStart);

  assert.equal(
    getEffectiveRadarCalculationNow(bucket, "2026-09-01T00:05:00.000Z").toISOString(),
    "2026-09-01T00:05:00.000Z",
  );
  assert.equal(
    getEffectiveRadarCalculationNow(bucket, "2026-08-31T23:59:59.000Z").toISOString(),
    "2026-09-01T00:00:00.000Z",
  );
  assert.equal(
    getEffectiveRadarCalculationNow(bucket, "invalid").toISOString(),
    "2026-09-01T00:00:00.000Z",
  );
  assert.equal(
    getPublicRadarSnapshotCacheDimensions(bucketStart).calculationBucket,
    getPublicRadarSnapshotCacheDimensions(bucketStart + 9 * 60 * 1000).calculationBucket,
  );
});

test("active Tibo filters are applied before ordering and limit", () => {
  const calls: string[] = [];
  const builder = {
    not: () => {
      calls.push("not:expires_at.is.null");
      return builder;
    },
    gt: () => {
      calls.push("gt:expires_at");
      return builder;
    },
    or: () => {
      calls.push(calls.some((call) => call === "or:verification_status") ? "or:is_reply" : "or:verification_status");
      return builder;
    },
    in: (_column: string, values: string[]) => {
      calls.push(`in:signal_type:${values.join(",")}`);
      return builder;
    },
    order: (_column: string, _options: { ascending: boolean }) => {
      calls.push("order");
      return builder;
    },
    limit: async (_count: number) => {
      calls.push("limit");
      return { data: [], error: null };
    },
  };

  applyActiveTiboQueryFilters(builder, "2026-08-04T00:00:00.000Z");
  builder.order("tweet_created_at", { ascending: false });
  void builder.limit(20);

  assert.deepEqual(calls, [
    "not:expires_at.is.null",
    "gt:expires_at",
    "or:verification_status",
    "or:is_reply",
    `in:signal_type:${ACTIVE_TIBO_SIGNAL_TYPES.join(",")}`,
    "order",
    "limit",
  ]);
});

test("timed Tibo query stays narrow and only returns live resolved windows", () => {
  const calls: string[] = [];
  const builder = {
    in: (_column: string, values: string[]) => {
      calls.push(`in:signal_type:${values.join(",")}`);
      return builder;
    },
    eq: (column: string, value: string) => {
      calls.push(`eq:${column}:${value}`);
      return builder;
    },
    gt: (column: string, value: string) => {
      calls.push(`gt:${column}:${value}`);
      return builder;
    },
    lte: (column: string, value: string) => {
      calls.push(`lte:${column}:${value}`);
      return builder;
    },
    or: (filters: string) => {
      calls.push(`or:${filters}`);
      return builder;
    },
    order: (column: string, options: { ascending: boolean }) => {
      calls.push(`order:${column}:${options.ascending}`);
      return builder;
    },
    limit: async (_count: number) => ({ data: [], error: null }),
  };

  applyTimedTiboQueryFilters(builder, "2026-09-19T22:00:00.000Z");

  assert.deepEqual(calls, [
    "in:signal_type:teaser,official_notice",
    "eq:temporal_resolution_status:resolved",
    "gt:expected_end_at:2026-09-19T22:00:00.000Z",
    "lte:tweet_created_at:2026-09-19T22:00:00.000Z",
    "or:verification_status.is.null,verification_status.neq.rejected",
    "order:tweet_created_at:false",
  ]);
  assert.equal(TIMED_TIBO_SIGNAL_MAX_ROWS, 40);
  assert.deepEqual(getTimedTiboLimitTelemetry(39), {
    timedTiboRowCount: 39,
    timedTiboLimitReached: false,
  });
  assert.deepEqual(getTimedTiboLimitTelemetry(40), {
    timedTiboRowCount: 40,
    timedTiboLimitReached: true,
  });
  assert.ok(TIMED_TIBO_SIGNAL_SELECT_FIELDS.split(",").length < ACTIVE_TIBO_SIGNAL_SELECT_FIELDS.split(",").length);
  assert.equal(TIBO_RECENT_MAX_ROWS, 20);
  assert.equal(TIBO_HISTORY_PAGE_SIZE, 1000);
});

test("the legacy split helper keeps reply and canonical views distinct", () => {
  const rows: FormalTiboResetSignal[] = [
    { ...resetSignal("reply", "2026-08-03T10:00:00.000Z"), is_reply: true },
    { ...resetSignal("post", "2026-08-02T10:00:00.000Z"), is_reply: false },
    { ...resetSignal("legacy", "2026-08-01T10:00:00.000Z"), is_reply: null },
  ];

  const split = splitTiboHistorySignals(rows);

  assert.strictEqual(split.withReplies, rows);
  assert.deepEqual(split.withoutReplies, [rows[1], rows[2]]);
  assert.deepEqual(split.withReplies, rows);
});

test("history read starts with one canonical non-reply page below the pagination boundary", async () => {
  const rows: FormalTiboResetSignal[] = [
    { ...resetSignal("post", "2026-08-02T10:00:00.000Z"), is_reply: false },
    { ...resetSignal("legacy", "2026-08-01T10:00:00.000Z"), is_reply: null },
  ];
  const calls: Array<{ fields: string; includeReplies: boolean; cursor?: unknown }> = [];

  const result = await readTiboHistorySignals(
    async (fields, includeReplies, _limit, cursor) => {
      calls.push({ fields, includeReplies, cursor });
      return { data: rows, error: null };
    },
    { state: "ok" },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    fields: TIBO_HISTORY_SELECT_FIELDS,
    includeReplies: false,
    cursor: undefined,
  });
  assert.deepEqual(result.withReplies.data, rows);
  assert.deepEqual(result.withoutReplies.data, rows);
  assert.equal(result.canonicalTiboPageCount, 1);
  assert.equal(result.canonicalTiboPaginationUsed, false);
  assert.equal(result.withReplies.health.state, "ok");
  assert.equal(result.withoutReplies.health.state, "ok");
});

test("canonical history cursor filter keeps non-reply scope and deterministic tweet ordering", () => {
  assert.equal(buildCanonicalTiboHistoryFilter(), "is_reply.is.null,is_reply.eq.false");
  assert.match(
    buildCanonicalTiboHistoryFilter(undefined, true),
    /formal_reply_admission_proof->>version\.eq\.tibo-formal-reply-admission-v3/,
  );
  const filter = buildCanonicalTiboHistoryFilter({
    tweetCreatedAt: "2026-08-02T10:00:00.000Z",
    tweetId: "123",
  });
  assert.match(filter, /is_reply\.is\.null/);
  assert.match(filter, /is_reply\.eq\.false/);
  assert.match(filter, /tweet_created_at\.lt\.2026-08-02T10:00:00\.000Z/);
  assert.match(filter, /tweet_id\.lt\.123/);
});

test("999 canonical rows complete in one page", async () => {
  const rows = Array.from({ length: 999 }, (_, index) => ({
    ...resetSignal("row-" + index, "2026-08-01T00:00:00.000Z"),
    is_reply: false,
  }));
  let calls = 0;
  const result = await readTiboHistorySignals(async () => {
    calls += 1;
    return { data: rows, error: null };
  }, { state: "ok" });

  assert.equal(calls, 1);
  assert.equal(result.withoutReplies.data.length, 999);
  assert.equal(result.canonicalTiboPageCount, 1);
  assert.equal(result.canonicalTiboPaginationUsed, false);
  assert.equal(result.withoutReplies.health.state, "ok");
});

test("1001 canonical rows are returned without duplicate tweet ids", async () => {
  const firstPage = Array.from({ length: TIBO_HISTORY_PAGE_SIZE }, (_, index) => ({
    ...resetSignal("row-" + index, "2026-08-01T00:00:00.000Z"),
    is_reply: false,
  }));
  const secondPage = [{
    ...resetSignal("row-1000", "2026-07-31T23:00:00.000Z"),
    is_reply: null,
  }];
  const result = await readTiboHistorySignals(
    async (_fields, _includeReplies, _limit, cursor) => ({
      data: cursor ? secondPage : firstPage,
      error: null,
    }),
    { state: "ok" },
  );

  const ids = result.withoutReplies.data.map((row) => row.tweet_id);
  assert.equal(ids.length, 1001);
  assert.equal(new Set(ids).size, 1001);
  assert.equal(result.canonicalTiboPageCount, 2);
  assert.equal(result.canonicalTiboPaginationUsed, true);
});

test("a failed second canonical page degrades the partial result", async () => {
  const firstPage = Array.from({ length: TIBO_HISTORY_PAGE_SIZE }, (_, index) => ({
    ...resetSignal("row-" + index, "2026-08-01T00:00:00.000Z"),
    is_reply: false,
  }));
  const result = await readTiboHistorySignals(
    async (_fields, _includeReplies, _limit, cursor) => cursor
      ? { data: null, error: new Error("second page unavailable") }
      : { data: firstPage, error: null },
    { state: "ok" },
  );

  assert.equal(result.withoutReplies.data.length, TIBO_HISTORY_PAGE_SIZE);
  assert.equal(result.withoutReplies.health.state, "degraded");
  assert.equal(result.canonicalTiboPageCount, 2);
  assert.equal(result.canonicalTiboPaginationUsed, true);
});

test("exactly one full canonical page fetches the next page instead of silently truncating", async () => {
  const replyRows = Array.from({ length: 900 }, (_, index) => ({
    ...resetSignal(`reply-${index}`, `2026-08-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`),
    is_reply: true,
  }));
  const canonicalRows = Array.from({ length: TIBO_HISTORY_PAGE_SIZE }, (_, index) => ({
    ...resetSignal(`canonical-${index}`, `2026-07-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`),
    is_reply: false,
  }));
  const formalRows = [resetSignal("older-formal", "2020-01-01T00:00:00.000Z")];
  const sourceRows = [...replyRows, ...canonicalRows, ...formalRows];
  const calls: Array<{ fields: string; includeReplies: boolean }> = [];

  const result = await readTiboHistorySignals(
    async (fields, includeReplies) => {
      calls.push({ fields, includeReplies });
      const canonicalSourceRows = sourceRows.filter((row) => row.is_reply !== true);
      const start = (calls.length - 1) * TIBO_HISTORY_PAGE_SIZE;
      return { data: canonicalSourceRows.slice(start, start + TIBO_HISTORY_PAGE_SIZE), error: null };
    },
    { state: "ok" },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].includeReplies, false);
  assert.equal(calls[1].includeReplies, false);
  assert.equal(result.withReplies.data.length, TIBO_HISTORY_PAGE_SIZE + formalRows.length);
  assert.equal(result.withoutReplies.data.length, TIBO_HISTORY_PAGE_SIZE + formalRows.length);
  assert.equal(result.withoutReplies.data.some((row) => row.is_reply === true), false);
  assert.equal(result.canonicalTiboPageCount, 2);
  assert.equal(result.canonicalTiboPaginationUsed, true);
  assert.equal(result.withoutReplies.health.state, "ok");
});

test("reply-heavy history still returns all canonical rows without truncation", async () => {
  const replyRows = Array.from({ length: 900 }, (_, index) => ({
    ...resetSignal(`reply-${index}`, `2026-08-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`),
    is_reply: true,
  }));
  const canonicalRows = Array.from({ length: TIBO_HISTORY_PAGE_SIZE }, (_, index) => ({
    ...resetSignal(`canonical-${index}`, `2026-07-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`),
    is_reply: false,
  }));
  const formalRows = [
    resetSignal("older-formal", "2020-01-01T00:00:00.000Z"),
    resetSignal("formal-2", "2020-01-02T00:00:00.000Z"),
  ];
  const sourceRows = [...replyRows, ...canonicalRows, ...formalRows];
  let calls = 0;

  const result = await readTiboHistorySignals(
    async (_fields, includeReplies) => {
      calls += 1;
      assert.equal(includeReplies, false);
      const canonicalSourceRows = sourceRows.filter((row) => row.is_reply !== true);
      const start = (calls - 1) * TIBO_HISTORY_PAGE_SIZE;
      return {
        data: canonicalSourceRows.slice(start, start + TIBO_HISTORY_PAGE_SIZE),
        error: null,
      };
    },
    { state: "ok" },
  );

  assert.equal(result.withoutReplies.data.length, TIBO_HISTORY_PAGE_SIZE + formalRows.length);
  assert.equal(result.withoutReplies.data.at(-2)?.tweet_id, "older-formal");
  assert.equal(result.withoutReplies.data.some((row) => row.is_reply === true), false);
  assert.equal(result.canonicalTiboPageCount, 2);
});

test("history schema fallback preserves data health and local reply derivation", async () => {
  const rows: FormalTiboResetSignal[] = [
    { ...resetSignal("reply", "2026-08-03T10:00:00.000Z"), is_reply: true },
    { ...resetSignal("post", "2026-08-02T10:00:00.000Z"), is_reply: false },
  ];
  let calls = 0;

  const result = await readTiboHistorySignals(
    async (_fields, includeReplies) => {
      calls += 1;
      if (calls === 1) {
        return {
          data: null,
          error: { code: "PGRST204", message: "column logical_post_id does not exist" },
        };
      }
      return { data: rows, error: null };
    },
    { state: "ok" },
  );

  assert.equal(calls, 2);
  assert.deepEqual(result.withReplies.data, rows);
  assert.deepEqual(result.withoutReplies.data, rows);
  assert.equal(result.withReplies.health.state, "ok");
  assert.equal(result.withoutReplies.health.state, "ok");
});

test("Tibo radar queries use explicit field lists instead of wildcard reads", () => {
  assert.notEqual(ACTIVE_TIBO_SIGNAL_SELECT_FIELDS, "*");
  assert.notEqual(TIBO_HISTORY_SELECT_FIELDS, "*");
  assert.notEqual(TIMED_TIBO_SIGNAL_SELECT_FIELDS, "*");
  assert.ok(ACTIVE_TIBO_SIGNAL_SELECT_FIELDS.split(",").length > 1);
  assert.ok(TIBO_HISTORY_SELECT_FIELDS.split(",").length > 1);
  assert.ok(TIMED_TIBO_SIGNAL_SELECT_FIELDS.split(",").length > 1);
  assert.doesNotMatch(ACTIVE_TIBO_SIGNAL_SELECT_FIELDS, /(^|,)id(,|$)/);
  assert.match(ACTIVE_TIBO_SIGNAL_SELECT_FIELDS, /(^|,)tweet_id(,|$)/);
  for (const column of [
    "codex_operational_status",
    "codex_operational_confidence",
    "codex_operational_evidence_quote",
    "codex_operational_reason_ja",
    "codex_operational_expires_at",
    "ai_confidence",
    "ai_contextual_reset_assessment",
    "ai_contextual_reset_tweet_id",
    "source_context_snapshot",
    "source_context_revision_hashes",
    "source_context_classified_revision_hashes",
    "source_context_generation",
    "temporal_resolution_version",
  ]) {
    assert.match(ACTIVE_TIBO_SIGNAL_SELECT_FIELDS, new RegExp(`(^|,)${column}(,|$)`));
    assert.match(TIBO_RECENT_SELECT_FIELDS, new RegExp(`(^|,)${column}(,|$)`));
  }
  assert.match(TIBO_HISTORY_SELECT_FIELDS, /(^|,)is_reply(,|$)/);
  assert.doesNotMatch(TIMED_TIBO_SIGNAL_SELECT_FIELDS, /(^|,)(is_secondary_future_signal|parent_tweet_id|primary_event_at)(,|$)/);
});

test("Tibo history keeps canonical rows narrow and bounds the wider recent read", () => {
  const source = readFileSync(resolve("lib/radarFetch.ts"), "utf8");
  assert.match(source, /getRadarCacheKeyParts\("tibo-history-signals-cache-v4"\)/);
  assert.match(source, /RADAR_CACHE_TAGS\.tiboHistory/);
  assert.match(source, /revalidate: TIBO_HISTORY_CACHE_TTL_SECONDS/);
  assert.match(source, /TIBO_HISTORY_SELECT_FIELDS/);
  assert.match(source, /TIBO_RECENT_SELECT_FIELDS/);
  assert.match(source, /TIBO_RECENT_MAX_ROWS/);
  assert.match(source, /TIBO_HISTORY_FALLBACK_SELECT_FIELDS/);
  assert.match(source, /ACTIVE_TIBO_SIGNAL_FALLBACK_SELECT_FIELDS/);
  assert.match(source, /isMissingTiboOptionalColumnError\(result\.error\)/);
  assert.match(source, /TIBO_HISTORY_PAGE_SIZE/);
  assert.doesNotMatch(source, /getCachedTiboRecentSignals/);

  const bundleSource = source.slice(
    source.indexOf("async function getTiboSignalBundle"),
    source.indexOf("export async function fetchFormalTiboResetSignals"),
  );
  assert.equal((bundleSource.match(/fetchRawTiboHistorySignals\(\)/g) ?? []).length, 1);
  assert.match(bundleSource, /historyResult\.withReplies\.data/);
  assert.match(bundleSource, /historyResult\.withoutReplies\.data/);
  assert.doesNotMatch(bundleSource, /fetchRawTiboHistorySignals\(false\)|fetchRawTiboHistorySignals\(true\)/);
});

test("prediction history is cached as a raw projection and parsed against each calculation time", () => {
  const source = readFileSync(resolve("lib/radarFetch.ts"), "utf8");
  assert.match(source, /getCachedPredictionHistoryProjection/);
  assert.match(source, /RADAR_CACHE_TAGS\.predictionHistory/);
  assert.match(source, /revalidate: PREDICTION_HISTORY_CACHE_TTL_SECONDS/);
  assert.match(source, /parseNextGenerationTrainingProjectionRows/);
  assert.match(source, /calculationNow/);
  assert.doesNotMatch(source, /getCachedPredictionHistoryProjection\([^)]*calculationNow/);
});

test("recent Tibo projections preserve reply safety metadata", () => {
  const source = readFileSync(resolve("lib/radarFetch.ts"), "utf8");
  const bundleSource = source.slice(
    source.indexOf("async function getTiboSignalBundle"),
    source.indexOf("export async function fetchFormalTiboResetSignals"),
  );

  assert.match(bundleSource, /classification_source: signal\.classification_source/);
  assert.match(bundleSource, /is_quote: signal\.is_quote/);
  assert.match(source, /const ACTIVE_TIBO_SIGNAL_FALLBACK_SELECT_FIELDS = \[[\s\S]*?"classification_source"/);
});

test("active and recent Tibo fetches share canonical expiry values through the public snapshot", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;
  const calculationNow = new Date("2026-10-11T07:30:00.000Z");
  const targetTweetId = "2109045392684032299";
  const targetUrl = `https://x.com/thsottiaux/status/${targetTweetId}`;
  const targetNotice = {
    tweet_id: targetTweetId,
    signal_type: "official_notice",
    text: "Global reset by EOD. May the tokens do good things for you.",
    tweet_url: targetUrl,
    tweet_created_at: "2026-10-10T22:16:20.000Z",
    detected_at: "2026-10-10T22:16:25.000Z",
    expires_at: "2026-10-11T22:16:20+00:00",
    confidence: 0.98,
    classification_reason: "AUTHOR TEXT announces a global reset by end of day.",
    classification_source: "gemini",
    verification_status: "auto_unverified",
    is_reply: false,
    is_quote: false,
    logical_post_id: targetTweetId,
    edit_history_tweet_ids: [targetTweetId],
    edit_version: 1,
    edit_metadata_source: "none",
    temporal_expression: "by EOD",
    temporal_kind: "daypart",
    temporal_precision: "daypart",
    temporal_timezone: null,
    temporal_resolution_status: "unresolved",
    expected_start_at: null,
    expected_end_at: null,
    secondary_signal: null,
  };
  const resolvedNotice = {
    ...targetNotice,
    tweet_id: "resolved-grace-notice",
    signal_type: "teaser",
    tweet_url: "https://x.com/thsottiaux/status/resolved-grace-notice",
    tweet_created_at: "2026-10-10T22:15:00.000Z",
    expires_at: "2026-10-11T18:00:00+00:00",
    temporal_expression: "tomorrow morning",
    temporal_kind: "relative_day",
    temporal_precision: "daypart",
    temporal_resolution_status: "resolved",
    expected_start_at: "2026-10-11T12:00:00.000Z",
    expected_end_at: "2026-10-11T12:30:00.000Z",
  };
  const tiboRows = [targetNotice, resolvedNotice];
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "status.openai.com") {
      return url.pathname.endsWith("summary.json")
        ? new Response(JSON.stringify({ page: {}, status: { indicator: "none" }, components: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify({ page: {}, incidents: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    }

    if (url.hostname !== "example.supabase.co") {
      throw new Error(`Unexpected test fetch host: ${url.hostname}`);
    }

    if (url.pathname === "/rest/v1/tibo_signals") {
      if (url.searchParams.has("expected_end_at")) return new Response("[]", { status: 200 });
      if (url.searchParams.has("expires_at") && url.searchParams.has("signal_type")) {
        return new Response(JSON.stringify(tiboRows), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.searchParams.get("limit") === String(TIBO_RECENT_MAX_ROWS)) {
        return new Response(JSON.stringify(tiboRows), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "*/0" },
    });
  };

  try {
    const data = await fetchCurrentRadarData({ calculationNow, bypassCache: true });
    const activeTarget = data.active_tibo_signals?.find((signal) => signal.tweet_id === targetTweetId);
    const recentTarget = data.recent_tibo_signals?.find((signal) => signal.tweet_id === targetTweetId);
    const expectedResolvedExpiry = new Date(Date.parse(resolvedNotice.expected_end_at) + 8 * 60 * 60 * 1000).toISOString();
    const activeResolved = data.active_tibo_signals?.find((signal) => signal.tweet_id === resolvedNotice.tweet_id);
    const recentResolved = data.recent_tibo_signals?.find((signal) => signal.tweet_id === resolvedNotice.tweet_id);

    assert.ok(activeTarget);
    assert.ok(recentTarget);
    assert.equal(activeTarget.expires_at, "2026-10-11T22:16:20.000Z");
    assert.equal(recentTarget.expires_at, activeTarget.expires_at);
    assert.ok(activeResolved);
    assert.ok(recentResolved);
    assert.equal(activeResolved.expires_at, expectedResolvedExpiry);
    assert.equal(recentResolved.expires_at, expectedResolvedExpiry);

    for (const locale of ["ja", "en", "zh"] as const) {
      const snapshot = toPublicRadarSnapshot(data, locale, { calculationNow });
      const baseline = toPublicRadarSnapshot({
        ...data,
        active_tibo_signals: [],
        recent_tibo_signals: [],
      }, locale, { calculationNow });

      assert.equal(snapshot.viewModel.activeWindow.active, true);
      assert.equal(snapshot.viewModel.activeWindow.kind, "official");
      assert.equal(snapshot.viewModel.activeWindow.noticeKind, "forced");
      assert.equal(snapshot.viewModel.activeWindow.source, targetUrl);
      assert.equal(snapshot.viewModel.activeWindow.expectedAt, null);
      assert.equal(snapshot.viewModel.activeWindow.expectedEndAt, null);
      assert.ok(snapshot.viewModel.activeWindow.expectedTimeZone == null);
      assert.equal(snapshot.latestTiboActivity?.classification, "official_notice");
      assert.equal(snapshot.latestTiboActivity?.sourceUrl, targetUrl);
      assert.ok(snapshot.latestTiboActivity?.expectedStartAt == null);
      assert.ok(snapshot.latestTiboActivity?.expectedEndAt == null);
      assert.deepEqual(snapshot.viewModel.recentHistory, baseline.viewModel.recentHistory);
      assert.equal(snapshot.lastRandomResetAt, baseline.lastRandomResetAt);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("a recent-only future reply keeps its source proof through the loader and public snapshot", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;
  const calculationNow = new Date("2026-10-22T10:00:00.000Z");
  const parentId = "2113162277688070445";
  const replyId = "2113162413008884099";
  const revision = "a".repeat(64);
  const parentText = "Day 17/ Bet you thought we forgot, but no, it’s reset day today.";
  const replyText = "Lands tomorrow before 10am PST.";
  const replyUrl = `https://x.com/thsottiaux/status/${replyId}`;
  const replyRow = {
    tweet_id: replyId,
    signal_type: "official_notice",
    text: replyText,
    tweet_url: replyUrl,
    tweet_created_at: "2026-10-22T06:55:54.000Z",
    expires_at: "2026-10-23T06:55:54.000Z",
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
    ai_temporal_precision: "range",
    ai_temporal_timezone: "PST",
    ai_contextual_reset_assessment: "same_global_reset",
    ai_contextual_reset_tweet_id: parentId,
    is_reply: true,
    is_quote: false,
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
    temporal_precision: "range",
    temporal_timezone: "PST",
    temporal_confidence: 0.95,
    temporal_resolution_status: "resolved",
    temporal_resolution_version: "tibo-temporal-v9-deadline-start-estimate",
    expected_start_at: "2026-10-22T15:00:00.000Z",
    expected_end_at: "2026-10-22T18:00:00.000Z",
  };
  let recentRows: Array<Record<string, unknown>> = [replyRow];
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "status.openai.com") {
      return url.pathname.endsWith("summary.json")
        ? new Response(JSON.stringify({ page: {}, status: { indicator: "none" }, components: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify({ page: {}, incidents: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    }

    if (url.hostname !== "example.supabase.co") {
      throw new Error(`Unexpected test fetch host: ${url.hostname}`);
    }

    if (url.pathname === "/rest/v1/tibo_signals") {
      if (url.searchParams.has("expected_end_at")) return new Response("[]", { status: 200 });
      if (url.searchParams.has("expires_at")) return new Response("[]", { status: 200 });
      if (url.searchParams.get("limit") === String(TIBO_RECENT_MAX_ROWS)) {
        return new Response(JSON.stringify(recentRows), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "*/0" },
    });
  };

  try {
    const loadSnapshot = async (row: Record<string, unknown>) => {
      recentRows = [row];
      const data = await fetchCurrentRadarData({ calculationNow, bypassCache: true });
      return { data, snapshot: toPublicRadarSnapshot(data, "en", { calculationNow }) };
    };
    const { data, snapshot } = await loadSnapshot(replyRow);
    const recentReply = data.recent_tibo_signals?.find((signal) => signal.tweet_id === replyId);

    assert.equal(data.active_tibo_signals?.some((signal) => signal.tweet_id === replyId), false);
    assert.deepEqual({
      revisionHashes: recentReply?.source_context_revision_hashes,
      classifiedRevisionHashes: recentReply?.source_context_classified_revision_hashes,
      sourceContextSnapshot: recentReply?.source_context_snapshot,
      sourceContextGeneration: recentReply?.source_context_generation,
      aiSignalType: recentReply?.ai_signal_type,
      aiConfidence: recentReply?.ai_confidence,
      aiClassificationStatus: recentReply?.ai_classification_status,
      aiTemporalDirection: recentReply?.ai_temporal_direction,
      aiNoticeTimingStatus: recentReply?.ai_notice_timing_status,
      aiContextualResetAssessment: recentReply?.ai_contextual_reset_assessment,
      aiContextualResetTweetId: recentReply?.ai_contextual_reset_tweet_id,
      aiEvidenceQuote: recentReply?.ai_evidence_quote,
      activeWindowKind: snapshot.viewModel.activeWindow.kind,
      activeWindowSource: snapshot.viewModel.activeWindow.source,
    }, {
      revisionHashes: [revision],
      classifiedRevisionHashes: [revision],
      sourceContextSnapshot: replyRow.source_context_snapshot,
      sourceContextGeneration: 1,
      aiSignalType: "official_notice",
      aiConfidence: 0.98,
      aiClassificationStatus: "success",
      aiTemporalDirection: "future",
      aiNoticeTimingStatus: "known",
      aiContextualResetAssessment: "same_global_reset",
      aiContextualResetTweetId: parentId,
      aiEvidenceQuote: replyText,
      activeWindowKind: "official",
      activeWindowSource: replyUrl,
    });

    for (const locale of ["ja", "en", "zh"] as const) {
      const localized = toPublicRadarSnapshot(data, locale, { calculationNow });
      const baseline = toPublicRadarSnapshot({
        ...data,
        active_tibo_signals: [],
        recent_tibo_signals: [],
      }, locale, { calculationNow });
      const publicActivity = localized.latestTiboActivity;

      assert.equal(localized.viewModel.activeWindow.active, true);
      assert.equal(localized.viewModel.activeWindow.kind, "official");
      assert.equal(localized.viewModel.activeWindow.source, replyUrl);
      assert.equal(localized.viewModel.activeWindow.expectedAt, "2026-10-22T15:00:00.000Z");
      assert.equal(localized.viewModel.activeWindow.expectedEndAt, "2026-10-22T18:00:00.000Z");
      assert.equal(
        Date.parse(localized.viewModel.activeWindow.expectedEndAt!) -
          Date.parse(localized.viewModel.activeWindow.expectedAt!),
        3 * 60 * 60 * 1000,
      );
      assert.equal(publicActivity?.classification, "official_notice");
      assert.equal(publicActivity?.sourceUrl, replyUrl);
      assert.equal(publicActivity?.expectedStartAt, "2026-10-22T15:00:00.000Z");
      assert.equal(publicActivity?.expectedEndAt, "2026-10-22T18:00:00.000Z");
      assert.deepEqual(localized.viewModel.recentHistory, baseline.viewModel.recentHistory);
      assert.equal(localized.lastRandomResetAt, baseline.lastRandomResetAt);
      assert.doesNotMatch(
        JSON.stringify(localized),
        /source_context_(?:snapshot|revision_hashes|classified_revision_hashes|generation)|sourceContext(?:Snapshot|RevisionHashes|ClassifiedRevisionHashes|Generation)|ai_(?:signal_type|confidence|classification_status|temporal_direction|notice_timing_status|contextual_reset_assessment|contextual_reset_tweet_id|evidence_quote)|ai(?:SignalType|Confidence|ClassificationStatus|TemporalDirection|NoticeTimingStatus|ContextualResetAssessment|ContextualResetTweetId|EvidenceQuote)|quote_(?:context_text|tweet_url|author_handle)|quote(?:ContextText|TweetUrl|AuthorHandle)/,
      );
    }

    const withoutField = (field: string) => {
      const row = { ...replyRow } as Record<string, unknown>;
      delete row[field];
      return row;
    };
    const invalidRows: Array<{ label: string; row: Record<string, unknown> }> = [
      {
        label: "empty classified revision marker",
        row: { ...replyRow, source_context_classified_revision_hashes: [] },
      },
      {
        label: "revision mismatch",
        row: { ...replyRow, source_context_classified_revision_hashes: ["b".repeat(64)] },
      },
      {
        label: "contextual parent mismatch",
        row: { ...replyRow, ai_contextual_reset_tweet_id: "2113162277688070446" },
      },
      {
        label: "third-party parent",
        row: {
          ...replyRow,
          ai_contextual_reset_tweet_id: "2113162277688070411",
          reply_to_handles: ["@thirdparty"],
          reply_context_text: "A reset is planned for third-party users.",
          source_context_snapshot: {
            parent: {
              tweetId: "2113162277688070411",
              tweetUrl: "https://x.com/thirdparty/status/2113162277688070411",
              authorHandle: "@thirdparty",
              text: "A reset is planned for third-party users.",
            },
          },
        },
      },
      {
        label: "quote provenance",
        row: {
          ...replyRow,
          quote_context_text: "A quote with unrelated context.",
          quote_tweet_url: "https://x.com/thirdparty/status/2113162277688070411",
          quote_author_handle: "@thirdparty",
        },
      },
      { label: "missing AI evidence quote", row: withoutField("ai_evidence_quote") },
      { label: "missing source context snapshot", row: withoutField("source_context_snapshot") },
    ];

    for (const { label, row } of invalidRows) {
      const { snapshot: invalidSnapshot } = await loadSnapshot(row);
      assert.notEqual(invalidSnapshot.viewModel.activeWindow.source, replyUrl, label);
      assert.notEqual(invalidSnapshot.latestTiboActivity?.sourceUrl, replyUrl, label);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("Tibo reset notice association scans resets chronologically and preserves display order", () => {
  const resets = [
    resetSignal("reset-2", "2026-08-02T10:00:00.000Z"),
    resetSignal("reset-1", "2026-08-01T10:00:00.000Z"),
  ];
  const notices = [
    noticeSignal("notice-2", "2026-08-02T08:00:00.000Z"),
    noticeSignal("notice-1", "2026-08-01T08:00:00.000Z"),
  ];

  const associated = associateTiboNotices(resets, notices);

  assert.deepEqual(associated.map((signal) => signal.tweet_id), ["reset-2", "reset-1"]);
  assert.equal(associated[0].related_notice?.tweet_id, "notice-2");
  assert.equal(associated[1].related_notice?.tweet_id, "notice-1");
});
