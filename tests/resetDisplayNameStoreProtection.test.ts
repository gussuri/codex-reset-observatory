import assert from "node:assert/strict";
import test from "node:test";

import { ensureResetDisplayNameForEvent } from "../lib/radar/resetDisplayNameStore";
import type { ResetDisplayNameRecord, WindowEventLike } from "../lib/radar/types";

const completedAt = "2026-09-12T12:00:00.000Z";
const event: WindowEventLike = {
  id: "tibo-reset-protected-copy",
  recordKind: "confirmed_global",
  title: "ランダムリセット",
  kind: "reset_completed",
  status: "closed",
  opened_at: completedAt,
  closed_at: completedAt,
  completed_at: completedAt,
  source_url: "https://x.com/thsottiaux/status/2095000000000000002",
  sourceTweetIds: ["2095000000000000001", "2095000000000000002"],
  scope: "全有料プラン",
  details: {
    cycleType: "ランダムリセット",
    reasonType: "ご祝儀リセット",
    resetMethod: "強制リセット",
    scope: "全有料プラン",
    noticeToExecution: "0分",
    noticeType: "公式告知あり",
  },
};

function storedRecord(overrides: Partial<ResetDisplayNameRecord> = {}): ResetDisplayNameRecord {
  return {
    event_key: "tibo-reset-protected-copy",
    source_tweet_id: "2095000000000000002",
    manual_name_ja: null,
    manual_name_en: null,
    manual_name_zh: null,
    ai_name_ja: "告知の言葉を生かしたリセット",
    ai_name_en: "A Promise Kept Reset",
    ai_name_zh: "兑现承诺重置",
    ai_confidence: null,
    ai_evidence: null,
    ai_reason: "既存の承認済みデータ",
    ai_model: "gemini-3.5-flash-lite",
    ai_prompt_version: "random-reset-name-v3",
    ai_input_mode: "metadata+source",
    ai_status: "accepted",
    ai_flags: [],
    ai_generated_at: "2026-09-12T12:01:00.000Z",
    input_hash: "previous-input-hash",
    ...overrides,
  };
}

function withStoredRecord(record: ResetDisplayNameRecord) {
  const originalFetch = globalThis.fetch;
  const posts: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/reset_display_names") && method === "GET") {
      return new Response(JSON.stringify([record]), { status: 200 });
    }
    if (method === "POST") posts.push(url);
    return new Response("[]", { status: 200 });
  };
  return {
    posts,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("preserves accepted v3 localized name despite changed prompt input and avoids Gemini", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const mock = withStoredRecord(storedRecord());
  try {
    const result = await ensureResetDisplayNameForEvent(event, {
      canonicalEventKey: "tibo-reset-protected-copy",
      sourcePostText: "Newly enriched role and timestamp context.",
      apiKey: "test-gemini-key",
    });
    assert.equal(result.status, "preserved_legacy_accepted");
    assert.equal(result.displayName, "告知の言葉を生かしたリセット");
    assert.equal(mock.posts.length, 0);
  } finally {
    mock.restore();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("manual name in any locale prevents automated replacement", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const mock = withStoredRecord(storedRecord({
    ai_status: "api_error",
    ai_name_ja: null,
    ai_name_en: null,
    ai_name_zh: null,
    manual_name_ja: null,
    manual_name_en: "User-approved event title",
  }));
  try {
    const result = await ensureResetDisplayNameForEvent(event, {
      canonicalEventKey: "tibo-reset-protected-copy",
      sourcePostText: "Distinctive post text.",
      apiKey: "test-gemini-key",
    });
    assert.equal(result.status, "manual");
    assert.equal(result.displayName, null);
    assert.equal(mock.posts.length, 0);
  } finally {
    mock.restore();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
