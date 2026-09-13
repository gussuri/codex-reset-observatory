import assert from "node:assert/strict";
import test from "node:test";

import {
  RESET_EVENT_METADATA_PROMPT_VERSION,
  buildResetEventMetadataPrompt,
  generateResetEventMetadata,
  parseResetEventMetadataResponse,
} from "../lib/radar/resetEventMetadata";

const sourceContext = [
  "[Tibo post 1 | tweet_id=notice-1]",
  "We found an Astra quality issue. We fixed it and will reset limits for all paid plans tonight.",
  "[End Tibo post 1]",
  "",
  "[Tibo post 2 | tweet_id=completion-1]",
  "Sweet dreams. Reset complete.",
  "[End Tibo post 2]",
].join("\n");

const validPayload = {
  reasonType: "詫びリセット",
  scope: "全有料プラン",
  summaryJa: "Astraの品質問題修正に伴うリセット",
  summaryEn: "Reset following a fix for an Astra quality issue",
  summaryZh: "修复Astra质量问题后的重置",
  noteJa: "予告投稿で品質問題の修正が説明され、完了投稿でリセット実施が確認された。",
  noteEn: "The notice described the quality fix and the completion post confirmed the reset.",
  noteZh: "预告说明了质量问题修复，完成帖确认了重置实施。",
  reasonJa: "関連投稿のうち、完了文面より具体的な品質問題修正を主要文脈として採用。",
};

test("accepts strict event metadata with the two-value public scope", () => {
  const result = parseResetEventMetadataResponse(validPayload, "test-model", 12);

  assert.equal(result.status, "success");
  assert.equal(result.reasonType, "詫びリセット");
  assert.equal(result.scope, "全有料プラン");
  assert.equal(result.summaryJa, validPayload.summaryJa);
  assert.equal(result.summaryEn, validPayload.summaryEn);
  assert.equal(result.summaryZh, validPayload.summaryZh);
  assert.equal(result.noteJa, validPayload.noteJa);
  assert.equal(result.reasonJa, validPayload.reasonJa);
  assert.equal(result.promptVersion, RESET_EVENT_METADATA_PROMPT_VERSION);
});

test("allows unknown scope to stay null instead of guessing a product scope", () => {
  const result = parseResetEventMetadataResponse(
    { ...validPayload, reasonType: "ご祝儀リセット", scope: null },
    "test-model",
  );

  assert.equal(result.status, "success");
  assert.equal(result.reasonType, "ご祝儀リセット");
  assert.equal(result.scope, null);
});

test("rejects retired product-name scope values", () => {
  for (const scope of ["Codex / ChatGPT Work", "Codex", "ChatGPT Work"]) {
    const result = parseResetEventMetadataResponse(
      { ...validPayload, scope },
      "test-model",
    );
    assert.equal(result.status, "invalid_schema", scope);
    assert.equal(result.scope, null, scope);
  }
});

test("requires a non-empty apology-or-celebration reason and localized copy", () => {
  const invalidReason = parseResetEventMetadataResponse(
    { ...validPayload, reasonType: null },
    "test-model",
  );
  assert.equal(invalidReason.status, "invalid_schema");

  const invalidSummary = parseResetEventMetadataResponse(
    { ...validPayload, summaryJa: "" },
    "test-model",
  );
  assert.equal(invalidSummary.status, "invalid_schema");

  const invalidNote = parseResetEventMetadataResponse(
    { ...validPayload, noteEn: "" },
    "test-model",
  );
  assert.equal(invalidNote.status, "invalid_schema");
});

test("prompt treats all canonical related posts as one event and prioritizes specific cause context", () => {
  const prompt = buildResetEventMetadataPrompt({
    completedAt: "2026-09-12T15:00:00.000Z",
    sourceContext,
    fallbackReasonType: "ご祝儀リセット",
    fallbackScope: null,
  });

  assert.match(prompt, /notice-1/);
  assert.match(prompt, /Astra quality issue/);
  assert.match(prompt, /completion-1/);
  assert.match(prompt, /Sweet dreams/);
  assert.match(prompt, /same canonical reset event/i);
  assert.match(prompt, /specific|cause|reason|incident|milestone/i);
  assert.match(prompt, /all paid plans/i);
});

test("generator parses Gemini JSON and never needs to infer scope from product names", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{ text: JSON.stringify({ ...validPayload, scope: null }) }],
      },
    }],
  }), { status: 200 });

  try {
    const result = await generateResetEventMetadata(
      {
        completedAt: "2026-09-12T15:00:00.000Z",
        sourceContext,
        fallbackReasonType: "ご祝儀リセット",
        fallbackScope: null,
      },
      { apiKey: "test-key", model: "test-model", timeoutMs: 1000 },
    );

    assert.equal(result.status, "success");
    assert.equal(result.scope, null);
    assert.equal(result.reasonType, "詫びリセット");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generator returns a safe failure result instead of throwing on upstream errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("upstream failed", { status: 503 });

  try {
    const result = await generateResetEventMetadata(
      {
        completedAt: "2026-09-12T15:00:00.000Z",
        sourceContext,
        fallbackReasonType: "ご祝儀リセット",
        fallbackScope: null,
      },
      { apiKey: "test-key", model: "test-model", timeoutMs: 1000 },
    );

    assert.equal(result.status, "api_error");
    assert.equal(result.reasonType, null);
    assert.equal(result.scope, null);
    assert.equal(result.httpStatus, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});