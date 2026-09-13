import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureResetEventMetadataForEvent,
  hashResetEventMetadataInput,
} from "../lib/radar/resetEventMetadataStore";
import type { ResetDisplayNameRecord, WindowEventLike } from "../lib/radar/types";

const eventKey = "tibo-reset-event-metadata-store";
const completedAt = "2026-09-13T00:00:00.000Z";
const sourceContext = [
  "[Tibo post 1 | tweet_id=notice-1]",
  "We fixed a quality issue and will reset limits for all paid plans tonight.",
  "[End Tibo post 1]",
  "",
  "[Tibo post 2 | tweet_id=completion-1]",
  "Reset complete.",
  "[End Tibo post 2]",
].join("\n");

const item: WindowEventLike = {
  id: eventKey,
  recordKind: "confirmed_global",
  title: "ランダムリセット",
  kind: "reset_completed",
  status: "closed",
  opened_at: completedAt,
  closed_at: completedAt,
  completed_at: completedAt,
  sourceTweetIds: ["notice-1", "completion-1"],
  details: {
    cycleType: "ランダムリセット",
    reasonType: "詫びリセット",
    resetMethod: "強制リセット",
    scope: "全有料プラン",
    noticeToExecution: "",
    noticeType: "公式告知あり",
  },
};

const generated = {
  reasonType: "詫びリセット" as const,
  scope: "全有料プラン" as const,
  summaryJa: "品質問題修正に伴うリセット",
  summaryEn: "Reset following a quality fix",
  summaryZh: "质量问题修复后的重置",
  noteJa: "品質問題の修正が根拠です。",
  noteEn: "The quality fix is the recorded reason.",
  noteZh: "记录的原因是修复质量问题。",
  reasonJa: "品質問題への対応が明示されています。",
  scopeEvidence: "reset limits for all paid plans tonight",
};

function record(overrides: Partial<ResetDisplayNameRecord> = {}): ResetDisplayNameRecord {
  return {
    event_key: eventKey,
    source_tweet_id: "completion-1",
    manual_name_ja: null,
    manual_name_en: null,
    manual_name_zh: null,
    ai_name_ja: null,
    ai_name_en: null,
    ai_name_zh: null,
    ai_confidence: null,
    ai_evidence: null,
    ai_reason: null,
    ai_model: null,
    ai_prompt_version: null,
    ai_input_mode: null,
    ai_status: null,
    ai_flags: null,
    ai_generated_at: null,
    input_hash: null,
    created_at: "2026-09-13T00:01:00.000Z",
    updated_at: "2026-09-13T00:01:00.000Z",
    ...overrides,
  };
}

function setupStoreFetch(initial: ResetDisplayNameRecord | null = null) {
  const originalFetch = globalThis.fetch;
  const stored = initial ? { ...initial } : null;
  const writes: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/reset_display_names") && method === "GET") {
      return new Response(JSON.stringify(stored ? [stored] : []), { status: 200 });
    }
    if (url.includes("/reset_display_names") && method === "POST") {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push(payload);
      Object.assign(stored ?? {}, payload);
      return new Response("[]", { status: 201 });
    }
    return new Response("[]", { status: 200 });
  };
  return {
    writes,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("persists generated metadata on the existing event-keyed row", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const mock = setupStoreFetch();
  let generatedCalls = 0;

  try {
    const result = await ensureResetEventMetadataForEvent(item, {
      sourcePostText: sourceContext,
      sourceTweetId: "completion-1",
      apiKey: "test-gemini-key",
      generate: async () => {
        generatedCalls += 1;
        return {
          ...generated,
          status: "success" as const,
          flags: [],
          model: "test-model",
          promptVersion: "reset-event-metadata-v1",
          latencyMs: 4,
          httpStatus: 200,
          retryAfterSeconds: null,
        };
      },
      generatedAt: "2026-09-13T00:02:00.000Z",
    });

    assert.equal(result.status, "success");
    assert.equal(result.wrote, true);
    assert.equal(generatedCalls, 1);
    assert.equal(mock.writes.length, 1);
    assert.equal(mock.writes[0]?.event_key, eventKey);
    assert.equal(mock.writes[0]?.event_metadata_status, "success");
    assert.equal(mock.writes[0]?.event_reason_type, "詫びリセット");
    assert.equal(mock.writes[0]?.event_scope, "全有料プラン");
    assert.equal(mock.writes[0]?.event_metadata_input_hash, hashResetEventMetadataInput({
      completedAt,
      sourceContext,
      fallbackReasonType: "詫びリセット",
      fallbackScope: "全有料プラン",
    }));
  } finally {
    mock.restore();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("reuses a successful same-input row without a duplicate metadata generation", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const inputHash = hashResetEventMetadataInput({
    completedAt,
    sourceContext,
    fallbackReasonType: "詫びリセット",
    fallbackScope: "全有料プラン",
  });
  const mock = setupStoreFetch(record({
    event_metadata_status: "success",
    event_metadata_input_hash: inputHash,
  }));
  let generatedCalls = 0;

  try {
    const result = await ensureResetEventMetadataForEvent(item, {
      sourcePostText: sourceContext,
      sourceTweetId: "completion-1",
      apiKey: "test-gemini-key",
      generate: async () => {
        generatedCalls += 1;
        return {
          ...generated,
          status: "success" as const,
          flags: [],
          model: "test-model",
          promptVersion: "reset-event-metadata-v1",
          latencyMs: 0,
          httpStatus: 200,
          retryAfterSeconds: null,
        };
      },
    });

    assert.equal(result.status, "reused");
    assert.equal(result.wrote, false);
    assert.equal(generatedCalls, 0);
    assert.equal(mock.writes.length, 0);
  } finally {
    mock.restore();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("stores a failure audit without blocking callers or losing the event key", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const mock = setupStoreFetch();

  try {
    const result = await ensureResetEventMetadataForEvent(item, {
      sourcePostText: sourceContext,
      sourceTweetId: "completion-1",
      apiKey: "test-gemini-key",
      generate: async () => ({
        reasonType: null,
        scope: null,
        summaryJa: null,
        summaryEn: null,
        summaryZh: null,
        noteJa: null,
        noteEn: null,
        noteZh: null,
        reasonJa: null,
        scopeEvidence: null,
        status: "api_error" as const,
        flags: ["upstream_unavailable"],
        model: "test-model",
        promptVersion: "reset-event-metadata-v1",
        latencyMs: 8,
        httpStatus: 503,
        retryAfterSeconds: null,
      }),
    });

    assert.equal(result.eventKey, eventKey);
    assert.equal(result.status, "api_error");
    assert.equal(result.wrote, true);
    assert.equal(mock.writes[0]?.event_metadata_status, "api_error");
    assert.equal(mock.writes[0]?.event_reason_type, null);
  } finally {
    mock.restore();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("does not generate metadata for reference or regular history records", async () => {
  let generatedCalls = 0;
  const nonMetadataEvents: WindowEventLike[] = [
    {
      ...item,
      recordKind: "reference",
    },
    {
      ...item,
      recordKind: "regular_completed",
      details: {
        ...item.details!,
        cycleType: "定期リセット",
      },
    },
  ];

  for (const nonMetadataEvent of nonMetadataEvents) {
    const result = await ensureResetEventMetadataForEvent(nonMetadataEvent, {
      sourcePostText: sourceContext,
      apiKey: "test-gemini-key",
      generate: async () => {
        generatedCalls += 1;
        return {
          ...generated,
          status: "success" as const,
          flags: [],
          model: "test-model",
          promptVersion: "reset-event-metadata-v1",
          latencyMs: 0,
          httpStatus: 200,
          retryAfterSeconds: null,
        };
      },
    });

    assert.equal(result.status, "skipped");
    assert.equal(result.wrote, false);
    assert.equal(result.skipped, true);
  }

  assert.equal(generatedCalls, 0);
});

test("preserves BANKED conditional scope without changing its event kind", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const mock = setupStoreFetch();
  const bankedItem: WindowEventLike = {
    ...item,
    recordKind: "banked_distribution",
    scope: "一部ユーザー",
    details: {
      ...item.details!,
      scope: "一部ユーザー",
    },
  };
  let capturedFallbackScope: string | null | undefined;

  try {
    const result = await ensureResetEventMetadataForEvent(bankedItem, {
      sourcePostText: sourceContext.replace(
        "all paid plans",
        "affected users",
      ),
      sourceTweetId: "completion-1",
      apiKey: "test-gemini-key",
      generate: async (input) => {
        capturedFallbackScope = input.fallbackScope;
        return {
          ...generated,
          scope: "一部ユーザー" as const,
          scopeEvidence: "reset limits for affected users tonight",
          status: "success" as const,
          flags: [],
          model: "test-model",
          promptVersion: "reset-event-metadata-v1",
          latencyMs: 0,
          httpStatus: 200,
          retryAfterSeconds: null,
        };
      },
    });

    assert.equal(result.status, "success");
    assert.equal(bankedItem.recordKind, "banked_distribution");
    assert.equal(bankedItem.details?.scope, "一部ユーザー");
    assert.equal(capturedFallbackScope, "一部ユーザー");
    assert.equal(mock.writes[0]?.event_scope, "一部ユーザー");
  } finally {
    mock.restore();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
