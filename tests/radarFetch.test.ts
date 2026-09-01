import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_TIBO_SIGNAL_TYPES,
  applyActiveTiboQueryFilters,
  associateTiboNotices,
  getRandomResetHeatmapCacheDimensions,
  getPublicRadarSnapshotCacheDimensions,
  getPublicRadarSnapshotCalculationBucket,
  PUBLIC_RADAR_SNAPSHOT_CACHE_TTL_SECONDS,
  RADAR_CORE_CACHE_TTL_SECONDS,
} from "../lib/radarFetch";
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

test("public snapshot cache keys use locale, ten-minute bucket, and history limit", () => {
  const start = Date.parse("2026-09-01T00:00:00.000Z");
  const beforeBoundary = start + PUBLIC_RADAR_SNAPSHOT_CACHE_TTL_SECONDS * 1000 - 1;
  const nextBucket = start + PUBLIC_RADAR_SNAPSHOT_CACHE_TTL_SECONDS * 1000;

  assert.equal(
    getPublicRadarSnapshotCalculationBucket(start),
    getPublicRadarSnapshotCalculationBucket(beforeBoundary),
  );
  assert.notEqual(
    getPublicRadarSnapshotCalculationBucket(start),
    getPublicRadarSnapshotCalculationBucket(nextBucket),
  );
  assert.deepEqual(getPublicRadarSnapshotCacheDimensions("ja", start), {
    locale: "ja",
    calculationBucket: getPublicRadarSnapshotCalculationBucket(start),
    limitHistory: true,
  });
  assert.deepEqual(getPublicRadarSnapshotCacheDimensions("en", start, false), {
    locale: "en",
    calculationBucket: getPublicRadarSnapshotCalculationBucket(start),
    limitHistory: false,
  });
});

test("homepage snapshot and heatmap share the calculation bucket contract", () => {
  const start = Date.parse("2026-09-01T00:00:00.000Z");
  const sameBucket = start + 5 * 60 * 1000;
  const nextBucket = start + PUBLIC_RADAR_SNAPSHOT_CACHE_TTL_SECONDS * 1000;

  assert.deepEqual(
    getRandomResetHeatmapCacheDimensions(start),
    getRandomResetHeatmapCacheDimensions(sameBucket),
  );
  assert.notDeepEqual(
    getRandomResetHeatmapCacheDimensions(start),
    getRandomResetHeatmapCacheDimensions(nextBucket),
  );
  assert.equal(
    getPublicRadarSnapshotCacheDimensions("ja", start).calculationBucket,
    getRandomResetHeatmapCacheDimensions(start).calculationBucket,
  );
  for (const locale of ["en", "zh"] as const) {
    assert.equal(
      getPublicRadarSnapshotCacheDimensions(locale, start).calculationBucket,
      getRandomResetHeatmapCacheDimensions(start).calculationBucket,
    );
  }
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
