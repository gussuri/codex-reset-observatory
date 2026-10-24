import assert from "node:assert/strict";
import test from "node:test";

import { ensureResetDisplayNameForEvent } from "../lib/radar/resetDisplayNameStore";
import { type MonitorResetCopyEvidence } from "../lib/radar/monitorResetCopyLifecycle";
import {
  hasResetCopyGenerationFailure,
  recordResetCopyGenerationFailure,
} from "../lib/radar/resetCopyGenerationFailures";
import type { ResetDisplayNameRecord, WindowEventLike } from "../lib/radar/types";

const eventKey = "tibo-reset-display-name-store";
const completedAt = "2026-10-22T17:59:00.000Z";
const sourceContext = "[Tibo verified reply parent]\nDay 17 reset notice\n[Tibo verified reply notice]\nLands tomorrow before 10am PST.";
const now = new Date("2026-10-24T12:00:00.000Z");

const monitorEvidence: MonitorResetCopyEvidence = {
  eventKey,
  recoveryObservationId: "recovery-display-name-store",
  recoveryStatus: "confirmed",
  recoveryObservedAt: completedAt,
  recoveryConfirmedAt: "2026-10-22T18:00:00.000Z",
  recoveryMatchedTiboTweetId: "2113162413008884099",
  fingerprint: "a".repeat(64),
};

const item: WindowEventLike = {
  id: eventKey,
  recordKind: "confirmed_global",
  title: "ランダムリセット",
  kind: "reset_completed",
  status: "closed",
  opened_at: completedAt,
  closed_at: completedAt,
  completed_at: completedAt,
  presentation: "notice_backed_recovery",
  recoveryObservationId: monitorEvidence.recoveryObservationId,
  sourceTweetIds: ["2113162413008884099"],
  details: {
    cycleType: "ランダムリセット",
    reasonType: "ご祝儀リセット",
    resetMethod: "強制リセット",
    scope: "全有料プラン",
    noticeToExecution: "",
    noticeType: "公式告知あり",
  },
};

function successRecord(overrides: Partial<ResetDisplayNameRecord> = {}): ResetDisplayNameRecord {
  return {
    event_key: eventKey,
    source_tweet_id: "2113162413008884099",
    manual_name_ja: null,
    manual_name_en: null,
    manual_name_zh: null,
    ai_name_ja: "以前の日本語名",
    ai_name_en: "Previous English name",
    ai_name_zh: "之前的中文名称",
    ai_confidence: 0.99,
    ai_evidence: "Lands tomorrow before 10am PST.",
    ai_reason: "Previously accepted from verified evidence.",
    ai_model: "test-model",
    ai_prompt_version: "previous-prompt-version",
    ai_input_mode: "metadata+source",
    ai_status: "accepted",
    ai_flags: [],
    ai_generated_at: "2026-10-22T18:01:00.000Z",
    input_hash: "previous-success-input-hash",
    created_at: "2026-10-22T18:01:00.000Z",
    updated_at: "2026-10-22T18:01:00.000Z",
    event_reason_type: "詫びリセット",
    event_scope: "全有料プラン",
    event_summary_ja: "以前の日本語要約",
    event_summary_en: "Previous English summary",
    event_summary_zh: "之前的中文摘要",
    event_note_ja: "以前の日本語補足。",
    event_note_en: "Previous English note.",
    event_note_zh: "之前的中文补充。",
    event_metadata_model: "test-model",
    event_metadata_prompt_version: "previous-prompt-version",
    event_metadata_status: "success",
    event_metadata_flags: [],
    event_metadata_generated_at: "2026-10-22T18:01:00.000Z",
    event_metadata_input_hash: "previous-metadata-input-hash",
    ...overrides,
  };
}

function setupStore(initial: ResetDisplayNameRecord) {
  const originalFetch = globalThis.fetch;
  let stored = { ...initial };
  const writes: Record<string, unknown>[] = [];
  let geminiCalls = 0;

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return new Response("upstream unavailable", { status: 503 });
    }
    if (url.includes("/reset_display_names") && method === "GET") {
      return new Response(JSON.stringify([stored]), { status: 200 });
    }
    if (url.includes("/reset_display_names") && method === "PATCH") {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push(payload);
      const expectedUpdatedAt = new URL(url).searchParams.get("updated_at");
      if (expectedUpdatedAt !== `eq.${stored.updated_at}`) {
        return new Response("[]", { status: 200 });
      }
      stored = { ...stored, ...payload } as ResetDisplayNameRecord;
      return new Response(JSON.stringify([stored]), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };

  return {
    writes,
    storedRow: () => ({ ...stored }),
    geminiCallCount: () => geminiCalls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("failure attempt hashes keep only the latest bounded set", () => {
  const hashes = Array.from({ length: 10 }, (_, index) => (index + 1).toString(16).padStart(64, "0"));
  const flags = hashes.reduce<string[]>((current, hash) =>
    recordResetCopyGenerationFailure(current, hash),
  []);
  const marker = flags.find((flag) => flag.startsWith("generation-failure-input-hashes-v1:"));
  assert.ok(marker);
  assert.deepEqual(JSON.parse(marker!.slice("generation-failure-input-hashes-v1:".length)), hashes.slice(-8));
  assert.equal(hasResetCopyGenerationFailure(flags, hashes[9]!), true);
  assert.equal(hasResetCopyGenerationFailure(flags, hashes[0]!), false);
});

test("preserves accepted names after a new-evidence failure and retries only when evidence changes", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const oldRecord = successRecord();
  const mock = setupStore(oldRecord);

  try {
    const first = await ensureResetDisplayNameForEvent(item, {
      canonicalEventKey: eventKey,
      sourcePostText: sourceContext,
      sourceTweetId: "2113162413008884099",
      monitorEvidence,
      now,
      apiKey: "test-gemini-key",
      model: "test-model",
    });
    assert.equal(first.displayName, oldRecord.ai_name_ja);
    assert.equal(first.skipped, true);
    assert.equal(mock.geminiCallCount(), 1);
    let afterFailure = mock.storedRow();
    assert.equal(afterFailure.ai_status, "accepted");
    assert.equal(afterFailure.input_hash, oldRecord.input_hash);
    assert.equal(afterFailure.ai_name_ja, oldRecord.ai_name_ja);
    assert.equal(afterFailure.ai_name_en, oldRecord.ai_name_en);
    assert.equal(afterFailure.ai_name_zh, oldRecord.ai_name_zh);
    assert.equal(afterFailure.event_metadata_status, oldRecord.event_metadata_status);
    assert.equal(afterFailure.event_metadata_input_hash, oldRecord.event_metadata_input_hash);
    assert.equal(afterFailure.event_summary_ja, oldRecord.event_summary_ja);
    assert.equal(afterFailure.event_summary_en, oldRecord.event_summary_en);
    assert.equal(afterFailure.event_summary_zh, oldRecord.event_summary_zh);
    assert.equal(afterFailure.event_note_ja, oldRecord.event_note_ja);
    assert.equal(afterFailure.event_note_en, oldRecord.event_note_en);
    assert.equal(afterFailure.event_note_zh, oldRecord.event_note_zh);
    assert.deepEqual(Object.keys(mock.writes[0]!).sort(), ["event_metadata_flags", "updated_at"]);
    assert.deepEqual(afterFailure.ai_flags, oldRecord.ai_flags, "the successful name's model flags remain unchanged");

    const repeat = await ensureResetDisplayNameForEvent(item, {
      canonicalEventKey: eventKey,
      sourcePostText: sourceContext,
      sourceTweetId: "2113162413008884099",
      monitorEvidence,
      now,
      apiKey: "test-gemini-key",
      model: "test-model",
    });
    assert.equal(repeat.status, "previous_failure_preserved");
    assert.equal(mock.geminiCallCount(), 1, "the same evidence and prompt contract do not call Gemini twice");
    assert.equal(mock.writes.length, 1);

    const changedEvidence = { ...monitorEvidence, fingerprint: "b".repeat(64) };
    const changed = await ensureResetDisplayNameForEvent(item, {
      canonicalEventKey: eventKey,
      sourcePostText: sourceContext,
      sourceTweetId: "2113162413008884099",
      monitorEvidence: changedEvidence,
      now,
      apiKey: "test-gemini-key",
      model: "test-model",
    });
    assert.equal(changed.skipped, true);
    assert.equal(mock.geminiCallCount(), 2, "a changed evidence fingerprint permits a new evaluation");
    afterFailure = mock.storedRow();
    assert.equal(afterFailure.ai_status, "accepted");
    assert.equal(afterFailure.input_hash, oldRecord.input_hash);
  } finally {
    mock.restore();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
