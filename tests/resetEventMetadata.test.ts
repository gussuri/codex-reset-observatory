import assert from "node:assert/strict";
import test from "node:test";

import {
  RESET_EVENT_METADATA_PROMPT_VERSION,
  RESET_EVENT_METADATA_SYSTEM_PROMPT,
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
  noteJa: "予告投稿で品質問題の修正が説明されています。完了投稿でリセット実施が確認されました。",
  noteEn: "The notice described the quality fix. The completion post confirmed the reset.",
  noteZh: "预告说明了质量问题的修复。完成帖确认了重置已执行。",
  reasonJa: "関連投稿のうち、完了文面より具体的な品質問題修正を主要文脈として採用。",
  scopeEvidence: "will reset limits for all paid plans tonight",
};

test("accepts strict event metadata with the two-value public scope", () => {
  const result = parseResetEventMetadataResponse(
    validPayload,
    "test-model",
    12,
    sourceContext,
  );

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
    { ...validPayload, reasonType: "ご祝儀リセット", scope: null, scopeEvidence: null },
    "test-model",
    0,
    sourceContext,
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

test("accepts one concise factual sentence when the source supports no further note", () => {
  const oneSentence = parseResetEventMetadataResponse(
    {
      ...validPayload,
      noteJa: "完了投稿で利用枠のリセットが確認されました。",
      noteEn: "The completion post confirmed the usage-limit reset.",
      noteZh: "完成帖确认了使用额度已重置。",
    },
    "test-model",
    0,
    sourceContext,
  );
  assert.equal(oneSentence.status, "success");

  const naturalTwoToThreeSentences = parseResetEventMetadataResponse(
    {
      ...validPayload,
      noteJa: "予告投稿で品質問題の修正が説明されています。完了投稿でリセット実施が確認されました。",
    },
    "test-model",
    0,
    sourceContext,
  );
  assert.equal(naturalTwoToThreeSentences.status, "success");
});

test("accepts source quotations with internal punctuation, abbreviations, and decimals", () => {
  const quotedSource = [
    "Tibo noted the v1.5 update and a 3.5-hour window.",
    "The completion post confirmed the usage-limit reset.",
  ].join(" ");
  const result = parseResetEventMetadataResponse(
    {
      ...validPayload,
      scope: null,
      scopeEvidence: null,
      noteJa: "Tibo氏はDay 15のリセット完了を報告しました。",
      noteEn: "Tibo marked Day 15 with “we're still cooking... and reset. Enjoy.” The announcement confirmed the usage-limit reset; the completion post confirmed it had finished, e.g., this was not only a prediction.",
      noteZh: "Tibo报告第15天重置完成。原文保留了烹饪相关的措辞。",
    },
    "test-model",
    0,
    quotedSource,
  );

  assert.equal(result.status, "success");
  assert.equal(result.noteEn, "Tibo marked Day 15 with “we're still cooking... and reset. Enjoy.” The announcement confirmed the usage-limit reset; the completion post confirmed it had finished, e.g., this was not only a prediction.");
});

test("rejects calendar and clock details from public summaries and notes", () => {
  const examples = [
    ["summaryJa", "2026年10月23日にCodexの週間利用枠がリセットされました。"],
    ["summaryEn", "The reset was announced on Friday, October 23, 2026."],
    ["summaryZh", "重置于10月23日星期五完成。"],
    ["summaryJa", "金曜日にCodexの週間利用枠がリセットされました。"],
    ["noteJa", "続く返信では午前10時（PST）前と案内されました。"],
    ["noteJa", "続く返信では午後10時までと案内されました。"],
    ["noteJa", "告知は2時に行われ、Codexの利用枠が回復しました。"],
    ["noteJa", "午前10時にCodexの利用枠が回復しました。"],
    ["noteEn", "The usage limit reset at 10:15."],
    ["noteJa", "Codexの利用枠は10時15分に回復しました。"],
    ["noteEn", "The follow-up said it would happen tomorrow at 10 a.m. PST."],
    ["noteZh", "回复说明下周UTC+9上午10点前完成。"],
  ] as const;

  for (const [field, copy] of examples) {
    const result = parseResetEventMetadataResponse(
      { ...validPayload, [field]: copy },
      "test-model",
      0,
      sourceContext,
    );
    assert.equal(result.status, "invalid_schema", field);
  }
});

test("allows elapsed-duration wording in public metadata", () => {
  const allowedExamples = [
    ["noteJa", "告知から2時間後にCodexの利用枠が回復しました。"],
    ["noteJa", "24時間が経過してからCodexの利用枠が回復しました。"],
    ["noteJa", "告知から2時間半後にCodexの利用枠が回復しました。"],
    ["noteJa", "告知から2時間が経過した後、Codexの利用枠が回復しました。"],
  ] as const;

  for (const [field, copy] of allowedExamples) {
    const result = parseResetEventMetadataResponse(
      { ...validPayload, [field]: copy },
      "test-model",
      0,
      sourceContext,
    );
    assert.equal(result.status, "success", copy);
  }
});

test("does not interpret ordinary Chinese weekly cadence as a weekday", () => {
  const result = parseResetEventMetadataResponse(
    { ...validPayload, noteZh: "每周一次的更新节奏中，Codex使用额度恢复。" },
    "test-model",
    0,
    sourceContext,
  );

  assert.equal(result.status, "success");
});

test("allows Day N series references and a deadline mention without repeating its time", () => {
  const result = parseResetEventMetadataResponse(
    {
      ...validPayload,
      summaryJa: "Day 17の「忘れたと思った？」という冗談に続き、Codexの週間利用枠がリセットされました。",
      summaryEn: "The Day 17 post joked that the reset had not been forgotten.",
      summaryZh: "第17天的帖子开玩笑说，这次重置并没有被忘记。",
      noteJa: "Tibo氏がリセット日だと告知し、続く返信で実施の期限を案内しました。その後、Codexの週間利用枠が回復しました。",
      noteEn: "Tibo announced reset day, then a follow-up reply gave the deadline. The Codex weekly usage allowance was restored afterward.",
      noteZh: "Tibo宣布了重置日，随后在回复中说明了实施期限。之后，Codex每周使用额度恢复。",
    },
    "test-model",
    0,
    sourceContext,
  );

  assert.equal(result.status, "success");
  assert.match(result.summaryJa ?? "", /Day 17/);
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
  assert.match(prompt, /Chronology-only completion timestamp \(do not repeat in public copy\)/i);
});

test("short cooking callbacks get retrospective notes without invented incident or audience details", () => {
  const shortPost = [
    "[Tibo post | tweet_id=2112432076767289678]",
    "Day 15/ Nevermind, we're still cooking... and reset. Enjoy.",
    "[End Tibo post]",
  ].join("\n");
  const prompt = buildResetEventMetadataPrompt({
    completedAt: "2026-10-20T06:33:48.000Z",
    sourceContext: shortPost,
    fallbackReasonType: "ご祝儀リセット",
    fallbackScope: null,
  });

  assert.match(prompt, /we're still cooking.*and reset/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /source-grounded wordplay or callback/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /usage limits returning/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /Do not add facts not supported/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /2–3 short factual sentences as a style target/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /single concise factual sentence is acceptable/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /Do not pad.*or invent facts/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /Do not include calendar dates, weekdays, clock times, time zones, or relative calendar words/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /today, tomorrow, or yesterday/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /deadline without repeating its date or clock time/i);
  assert.match(RESET_EVENT_METADATA_SYSTEM_PROMPT, /If applicability is difficult to determine, return null/i);
  assert.doesNotMatch(prompt, /2112268918681485431/);
});

test("generator parses Gemini JSON and never needs to infer scope from product names", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{ text: JSON.stringify({ ...validPayload, scope: null, scopeEvidence: null }) }],
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

test("Gemini request separates short public event notes from the internal audit rationale", async () => {
  const originalFetch = globalThis.fetch;
  let systemPrompt = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
    };
    systemPrompt = request.contents?.[0]?.parts?.[0]?.text ?? "";
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validPayload) }] } }],
    }), { status: 200 });
  };

  try {
    const result = await generateResetEventMetadata(
      {
        completedAt: "2026-09-12T15:00:00.000Z",
        sourceContext,
        fallbackReasonType: "詫びリセット",
        fallbackScope: "全有料プラン",
      },
      { apiKey: "test-key", model: "test-model", timeoutMs: 1000 },
    );

    assert.equal(result.status, "success");
    assert.match(systemPrompt, /public note[s]? (?:should|must) (?:only )?(?:add|describe).*event/i);
    assert.match(systemPrompt, /2–3 short factual sentences/i);
    assert.match(systemPrompt, /natural retrospective wording/i);
    assert.match(systemPrompt, /usage limits returning/i);
    assert.match(systemPrompt, /Do not.*(?:reasonType|classification rationale)/i);
    assert.match(systemPrompt, /Do not.*(?:classified|processed|explain scope|system interpretation)/i);
    assert.match(systemPrompt, /reasonJa.*internal audit.*reasonType.*scope/i);
    assert.equal(result.reasonJa, validPayload.reasonJa);
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

test("rejects broad scope without exact reset-applicability evidence", () => {
  const result = parseResetEventMetadataResponse(
    {
      ...validPayload,
      scopeEvidence: "all paid users",
    },
    "test-model",
    0,
    "[Tibo post 1]\nHi all paid users. We are investigating an issue.",
  );

  assert.equal(result.status, "invalid_schema");
});

test("rejects scope evidence that is not present in the canonical source context", () => {
  const result = parseResetEventMetadataResponse(
    validPayload,
    "test-model",
    0,
    sourceContext.replace("will reset limits for all paid plans tonight", "will reset limits tonight"),
  );

  assert.equal(result.status, "invalid_schema");
});
