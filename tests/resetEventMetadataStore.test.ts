import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ensureResetEventMetadataForEvent,
  hashResetEventMetadataInput,
} from "../lib/radar/resetEventMetadataStore";
import { RESET_EVENT_METADATA_PROMPT_VERSION } from "../lib/radar/resetEventMetadata";
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
const now = new Date("2026-10-24T12:00:00.000Z");
const monitorEvidence = {
  eventKey,
  recoveryObservationId: "recovery-metadata-store",
  recoveryStatus: "confirmed" as const,
  recoveryObservedAt: completedAt,
  recoveryConfirmedAt: "2026-09-13T00:02:00.000Z",
  fingerprint: "a".repeat(64),
};

const item: WindowEventLike = {
  id: eventKey,
  recordKind: "confirmed_global",
  title: "Quality issue reset restored usage",
  kind: "reset_completed",
  status: "closed",
  opened_at: completedAt,
  closed_at: completedAt,
  completed_at: completedAt,
  presentation: "notice_backed_recovery",
  recoveryObservationId: monitorEvidence.recoveryObservationId,
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
  let stored = initial ? { ...initial } : null;
  const writes: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/reset_display_names") && method === "GET") {
      return new Response(JSON.stringify(stored ? [stored] : []), { status: 200 });
    }
    if (url.includes("/reset_display_names") && (method === "POST" || method === "PATCH")) {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push(payload);
      const params = new URL(url).searchParams;
      if (method === "POST") {
        if (stored) return new Response("[]", { status: 409 });
        stored = payload as unknown as ResetDisplayNameRecord;
      } else {
        const expectedUpdatedAt = params.get("updated_at");
        const matches = stored && (expectedUpdatedAt === "is.null"
          ? stored.updated_at === null || stored.updated_at === undefined
          : expectedUpdatedAt === `eq.${stored.updated_at}`);
        if (!matches) return new Response("[]", { status: 200 });
        stored = { ...stored, ...payload } as ResetDisplayNameRecord;
      }
      return new Response(JSON.stringify([stored]), { status: method === "POST" ? 201 : 200 });
    }
    return new Response("[]", { status: 200 });
  };
  return {
    writes,
    storedRow: () => stored ? { ...stored } : null,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function ensureMetadata(
  event: WindowEventLike,
  options: Omit<Parameters<typeof ensureResetEventMetadataForEvent>[1], "now">,
) {
  return ensureResetEventMetadataForEvent(event, {
    ...options,
    monitorEvidence: options.monitorEvidence ?? monitorEvidence,
    now,
    model: options.model ?? "test-model",
  });
}

function hashMetadataValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function autoCopyFlags(values: Record<string, unknown>) {
  const hashes = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, hashMetadataValue(value)]));
  return [`auto-copy-hashes-v1:${JSON.stringify(hashes)}`];
}

test("persists generated metadata when a useful title already exists", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const mock = setupStoreFetch();
  let generatedCalls = 0;

  try {
    const result = await ensureMetadata(item, {
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
      evidenceFingerprint: monitorEvidence.fingerprint,
      model: "test-model",
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
    evidenceFingerprint: monitorEvidence.fingerprint,
    model: "test-model",
  });
  const mock = setupStoreFetch(record({
    event_metadata_status: "success",
    event_metadata_input_hash: inputHash,
    event_metadata_prompt_version: RESET_EVENT_METADATA_PROMPT_VERSION,
  }));
  let generatedCalls = 0;

  try {
    const result = await ensureMetadata(item, {
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

test("reuses same-input successful metadata across prompt versions to protect corrected summaries and notes", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const inputHash = hashResetEventMetadataInput({
    completedAt,
    sourceContext,
    fallbackReasonType: "詫びリセット",
    fallbackScope: "全有料プラン",
    evidenceFingerprint: monitorEvidence.fingerprint,
    model: "test-model",
  });
  const existing = record({
    event_metadata_status: "success",
    event_metadata_input_hash: inputHash,
    event_metadata_prompt_version: "reset-event-metadata-v2",
    manual_name_ja: "手動名を維持",
    event_summary_ja: "手動修正した日本語の要約",
    event_summary_en: "Manually corrected English summary",
    event_summary_zh: "手动修正的中文摘要",
    event_note_ja: "手動で整えた日本語の補足。",
    event_note_en: "Manually polished English note.",
    event_note_zh: "手动润色的中文补充。",
  });
  const mock = setupStoreFetch(existing);
  let generatedCalls = 0;

  try {
    const result = await ensureMetadata(item, {
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
          promptVersion: RESET_EVENT_METADATA_PROMPT_VERSION,
          latencyMs: 0,
          httpStatus: 200,
          retryAfterSeconds: null,
        };
      },
    });

    assert.equal(result.status, "reused");
    assert.equal(result.wrote, false);
    assert.equal(result.skipped, true);
    assert.equal(generatedCalls, 0);
    assert.equal(mock.writes.length, 0);
    assert.equal(existing.event_summary_ja, "手動修正した日本語の要約");
    assert.equal(existing.event_note_en, "Manually polished English note.");
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
    const result = await ensureMetadata(item, {
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
    const result = await ensureMetadata(nonMetadataEvent, {
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
  let generatedCalls = 0;

  try {
    const result = await ensureMetadata(bankedItem, {
      sourcePostText: sourceContext.replace(
        "all paid plans",
        "affected users",
      ),
      sourceTweetId: "completion-1",
      apiKey: "test-gemini-key",
      generate: async (input) => {
        generatedCalls += 1;
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

    assert.equal(result.status, "skipped");
    assert.equal(result.wrote, false);
    assert.equal(bankedItem.recordKind, "banked_distribution");
    assert.equal(bankedItem.details?.scope, "一部ユーザー");
    assert.equal(capturedFallbackScope, undefined);
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

test("does not overwrite display names when metadata columns are missing in DB", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  const originalFetch = globalThis.fetch;
  const initialRow = record({
    ai_name_ja: "保護されたAI名",
    manual_name_ja: "保護された手動名",
  });
  let patchCount = 0;

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/reset_display_names") && method === "GET") {
      return new Response(JSON.stringify([initialRow]), { status: 200 });
    }
    if (url.includes("/reset_display_names") && method === "PATCH") {
      patchCount += 1;
      return new Response(
        JSON.stringify({
          code: "PGRST204",
          message: "Could not find the 'event_metadata_status' column of 'reset_display_names' in the schema cache",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("[]", { status: 200 });
  };

  try {
    const result = await ensureMetadata(item, {
      sourcePostText: sourceContext,
      sourceTweetId: "completion-1",
      apiKey: "test-gemini-key",
      generate: async () => ({
        ...generated,
        status: "success" as const,
        flags: [],
        model: "test-model",
        promptVersion: "reset-event-metadata-v1",
        latencyMs: 0,
        httpStatus: 200,
        retryAfterSeconds: null,
      }),
    });

    assert.equal(result.status, "schema_unavailable");
    assert.equal(result.wrote, false);
    assert.equal(result.skipped, true);
    assert.equal(result.record?.ai_name_ja, "保護されたAI名");
    assert.equal(result.record?.manual_name_ja, "保護された手動名");
    assert.equal(patchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("re-reads fresh row after Gemini generation so concurrent name updates are preserved", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  const originalFetch = globalThis.fetch;
  let serverRow = record({
    ai_name_ja: null,
    manual_name_ja: null,
  });
  const writes: Record<string, unknown>[] = [];

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/reset_display_names") && method === "GET") {
      return new Response(JSON.stringify([serverRow]), { status: 200 });
    }
    if (url.includes("/reset_display_names") && method === "PATCH") {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push(payload);
      serverRow = { ...serverRow, ...payload };
      return new Response(JSON.stringify([{ event_key: eventKey }]), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };

  try {
    const result = await ensureMetadata(item, {
      sourcePostText: sourceContext,
      sourceTweetId: "completion-1",
      apiKey: "test-gemini-key",
      generate: async () => {
        serverRow = {
          ...serverRow,
          ai_name_ja: "並行書き込みAI名",
          manual_name_en: "Concurrent Manual EN",
          updated_at: "2026-09-13T00:03:00.000Z",
        };
        return {
          ...generated,
          status: "success" as const,
          flags: [],
          model: "test-model",
          promptVersion: "reset-event-metadata-v1",
          latencyMs: 10,
          httpStatus: 200,
          retryAfterSeconds: null,
        };
      },
    });

    assert.equal(result.status, "success");
    assert.equal(result.wrote, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.ai_name_ja, "並行書き込みAI名");
    assert.equal(writes[0]?.manual_name_en, "Concurrent Manual EN");
    assert.equal(writes[0]?.event_reason_type, "詫びリセット");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("refreshes auto-generated fields after evidence changes but preserves human-edited and legacy fields", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const oldAutoSummary = "Prior generated summary";
  const humanEditedSummary = "Human corrected summary";
  const legacyNote = "Legacy note without an auto marker";
  const initial = record({
    event_metadata_status: "success",
    event_metadata_input_hash: "b".repeat(64),
    event_summary_ja: oldAutoSummary,
    event_summary_en: humanEditedSummary,
    event_note_ja: legacyNote,
    event_metadata_flags: autoCopyFlags({
      event_summary_ja: oldAutoSummary,
      event_summary_en: "Value before a human edit",
    }),
  });
  const mock = setupStoreFetch(initial);
  const changedEvidence = { ...monitorEvidence, fingerprint: "c".repeat(64) };

  try {
    const result = await ensureMetadata(item, {
      sourcePostText: sourceContext,
      sourceTweetId: "completion-1",
      monitorEvidence: changedEvidence,
      apiKey: "test-gemini-key",
      generate: async () => ({
        ...generated,
        summaryJa: "Updated summary from new evidence",
        status: "success" as const,
        flags: [],
        model: "test-model",
        promptVersion: RESET_EVENT_METADATA_PROMPT_VERSION,
        latencyMs: 1,
        httpStatus: 200,
        retryAfterSeconds: null,
      }),
    });

    assert.equal(result.status, "success");
    assert.equal(result.wrote, true);
    const write = mock.writes[0]!;
    assert.equal(write.event_summary_ja, "Updated summary from new evidence");
    assert.equal(write.event_summary_en, humanEditedSummary);
    assert.equal(write.event_note_ja, legacyNote);
    const marker = String((write.event_metadata_flags as string[]).find((flag) => flag.startsWith("auto-copy-hashes-v1:")));
    const hashes = JSON.parse(marker.slice("auto-copy-hashes-v1:".length)) as Record<string, string>;
    assert.equal(hashes.event_summary_ja, hashMetadataValue("Updated summary from new evidence"));
    assert.equal(hashes.event_summary_en, undefined);
    assert.equal(hashes.event_note_ja, undefined);
  } finally {
    mock.restore();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("keeps prior successful metadata when regeneration fails", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const existing = record({
    event_metadata_status: "success",
    event_metadata_input_hash: "d".repeat(64),
    event_summary_ja: "Previously generated summary",
    event_metadata_flags: autoCopyFlags({ event_summary_ja: "Previously generated summary" }),
  });
  const mock = setupStoreFetch(existing);

  try {
    const result = await ensureMetadata(item, {
      sourcePostText: sourceContext,
      sourceTweetId: "completion-1",
      monitorEvidence: { ...monitorEvidence, fingerprint: "e".repeat(64) },
      apiKey: "test-gemini-key",
      generate: async () => ({
        ...generated,
        status: "api_error" as const,
        summaryJa: null,
        flags: ["upstream_unavailable"],
        model: "test-model",
        promptVersion: RESET_EVENT_METADATA_PROMPT_VERSION,
        latencyMs: 1,
        httpStatus: 503,
        retryAfterSeconds: null,
      }),
    });

    assert.equal(result.status, "generation_failed_preserved");
    assert.equal(result.wrote, false);
    assert.equal(mock.writes.length, 0);
    assert.equal(mock.storedRow()?.event_summary_ja, "Previously generated summary");
  } finally {
    mock.restore();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("a manual edit after the CAS reread wins over the generated metadata write", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  let serverRow = record({ event_summary_ja: "Existing summary" });
  const writes: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/reset_display_names") && method === "GET") {
      return new Response(JSON.stringify([serverRow]), { status: 200 });
    }
    if (url.includes("/reset_display_names") && method === "PATCH") {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push(payload);
      serverRow = {
        ...serverRow,
        event_summary_ja: "Human edit made after read",
        updated_at: "2026-09-13T00:04:00.000Z",
      };
      return new Response("[]", { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };

  try {
    const result = await ensureMetadata(item, {
      sourcePostText: sourceContext,
      sourceTweetId: "completion-1",
      apiKey: "test-gemini-key",
      generate: async () => ({
        ...generated,
        status: "success" as const,
        flags: [],
        model: "test-model",
        promptVersion: RESET_EVENT_METADATA_PROMPT_VERSION,
        latencyMs: 1,
        httpStatus: 200,
        retryAfterSeconds: null,
      }),
    });

    assert.equal(result.status, "write_conflict");
    assert.equal(result.wrote, false);
    assert.equal(writes.length, 1);
    assert.equal(serverRow.event_summary_ja, "Human edit made after read");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
