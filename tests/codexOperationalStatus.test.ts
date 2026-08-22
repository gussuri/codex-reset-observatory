import test from "node:test";
import assert from "node:assert/strict";

import { TIBO_GEMINI_SYSTEM_PROMPT } from "../lib/radar/geminiClassification";
import {
  getTiboOperationalExpiry,
  parseCodexOperationalAssessment,
  TIBO_OPERATIONAL_TTL_MS,
} from "../lib/radar/codexOperationalStatus";

test("parses a Tibo-owned investigating assessment independently", () => {
  const text = "We are investigating and will have an update tomorrow.";
  assert.deepEqual(
    parseCodexOperationalAssessment(
      {
        codexOperationalStatus: "investigating",
        codexOperationalConfidence: 0.99,
        codexOperationalEvidenceQuote: "We are investigating",
        codexOperationalReasonJa: "Codexの性能問題を調査中。",
      },
      text,
    ),
    {
      status: "investigating",
      confidence: 0.99,
      evidenceQuote: "We are investigating",
      reasonJa: "Codexの性能問題を調査中。",
    },
  );
});

test("accepts active, recovered, and none operational states", () => {
  const cases = [
    ["active", "Codex requests are failing for some users."],
    ["recovered", "The issue is fixed now."],
    ["none", "Sharing a normal Codex update."],
  ] as const;

  for (const [status, text] of cases) {
    const result = parseCodexOperationalAssessment(
      {
        codexOperationalStatus: status,
        codexOperationalConfidence: 0.9,
        codexOperationalEvidenceQuote: text,
        codexOperationalReasonJa: "判定理由",
      },
      text,
    );
    assert.equal(result.status, status);
    assert.equal(result.confidence, 0.9);
    assert.equal(result.evidenceQuote, text);
  }
});

test("invalid operational payload remains unknown instead of poisoning reset classification", () => {
  const invalidStatus = parseCodexOperationalAssessment(
    {
      codexOperationalStatus: "maybe",
      codexOperationalConfidence: 0.9,
      codexOperationalEvidenceQuote: "We are investigating",
      codexOperationalReasonJa: "不正な状態",
    },
    "We are investigating a cache issue.",
  );
  assert.deepEqual(invalidStatus, {
    status: null,
    confidence: null,
    evidenceQuote: null,
    reasonJa: null,
  });

  const inventedEvidence = parseCodexOperationalAssessment(
    {
      codexOperationalStatus: "investigating",
      codexOperationalConfidence: 0.9,
      codexOperationalEvidenceQuote: "invented quoted context",
      codexOperationalReasonJa: "親投稿だけを根拠にしている",
    },
    "Maybe.",
  );
  assert.deepEqual(inventedEvidence, {
    status: null,
    confidence: null,
    evidenceQuote: null,
    reasonJa: null,
  });
});

test("Tibo non-none operational state expires exactly 12 hours after the post", () => {
  assert.equal(TIBO_OPERATIONAL_TTL_MS, 12 * 60 * 60 * 1000);
  assert.equal(
    getTiboOperationalExpiry("2026-08-22T05:24:01.000Z"),
    "2026-08-22T17:24:01.000Z",
  );
  assert.equal(getTiboOperationalExpiry("not-a-date"), null);
});

test("Gemini prompt requires an operational axis independent from reset signal type", () => {
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /codexOperationalStatus/);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /investigating/);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /active/);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /recovered/);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /independent/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /cache hit/i);
});
