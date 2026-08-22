import test from "node:test";
import assert from "node:assert/strict";

import { TIBO_GEMINI_SYSTEM_PROMPT } from "../lib/radar/geminiClassification";
import {
  deriveCodexOperationalStatus,
  getTiboOperationalExpiry,
  parseCodexOperationalAssessment,
  TIBO_OPERATIONAL_TTL_MS,
} from "../lib/radar/codexOperationalStatus";

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: "codex-incident",
    title: "Codex incident",
    status: "investigating",
    impact: "minor",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    resolvedAt: null,
    source: "openai_status" as const,
    url: "https://status.openai.com/incidents/codex-incident",
    ...overrides,
  };
}

function tiboOperational(
  status: "none" | "investigating" | "active" | "recovered",
  createdAt: string,
  expiresAt: string | null,
) {
  return {
    tweet_id: `tweet-${status}-${createdAt}`,
    tweet_created_at: createdAt,
    verification_status: "auto_unverified" as const,
    codex_operational_status: status,
    codex_operational_expires_at: expiresAt,
  };
}

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

test("OpenAI active incident or affected component yields active", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const fromIncident = deriveCodexOperationalStatus({
    openAIStatusHistory: [incident()],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 0,
    tiboSignals: [],
    now,
  });
  assert.equal(fromIncident.status, "active");
  assert.equal(fromIncident.source, "openai_status");

  const fromComponent = deriveCodexOperationalStatus({
    openAIStatusHistory: [],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 1,
    tiboSignals: [],
    now,
  });
  assert.equal(fromComponent.status, "active");
});

test("OpenAI recovery is visible strictly less than 12 hours", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const recent = deriveCodexOperationalStatus({
    openAIStatusHistory: [incident({
      status: "resolved",
      resolvedAt: "2026-08-22T00:01:00.000Z",
      updatedAt: "2026-08-22T00:01:00.000Z",
    })],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 0,
    tiboSignals: [],
    now,
  });
  assert.equal(recent.status, "recovered");

  const exactBoundary = deriveCodexOperationalStatus({
    openAIStatusHistory: [incident({
      status: "resolved",
      resolvedAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    })],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 0,
    tiboSignals: [],
    now,
  });
  assert.equal(exactBoundary.status, "none");
});

test("Tibo investigating is eligible strictly before its 12-hour expiry", () => {
  const beforeExpiry = deriveCodexOperationalStatus({
    openAIStatusHistory: [],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 0,
    tiboSignals: [tiboOperational(
      "investigating",
      "2026-08-22T00:00:00.000Z",
      "2026-08-22T12:00:00.000Z",
    )],
    now: new Date("2026-08-22T11:59:59.999Z"),
  });
  assert.equal(beforeExpiry.status, "investigating");

  const atExpiry = deriveCodexOperationalStatus({
    openAIStatusHistory: [],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 0,
    tiboSignals: [tiboOperational(
      "investigating",
      "2026-08-22T00:00:00.000Z",
      "2026-08-22T12:00:00.000Z",
    )],
    now: new Date("2026-08-22T12:00:00.000Z"),
  });
  assert.equal(atExpiry.status, "none");
});

test("newest non-none Tibo update supersedes older state while operational none does not", () => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const recovered = deriveCodexOperationalStatus({
    openAIStatusHistory: [],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 0,
    tiboSignals: [
      tiboOperational("investigating", "2026-08-22T01:00:00.000Z", "2026-08-22T13:00:00.000Z"),
      tiboOperational("recovered", "2026-08-22T09:00:00.000Z", "2026-08-22T21:00:00.000Z"),
    ],
    now,
  });
  assert.equal(recovered.status, "recovered");

  const unrelatedNone = deriveCodexOperationalStatus({
    openAIStatusHistory: [],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 0,
    tiboSignals: [
      tiboOperational("investigating", "2026-08-22T01:00:00.000Z", "2026-08-22T13:00:00.000Z"),
      tiboOperational("none", "2026-08-22T09:30:00.000Z", null),
    ],
    now,
  });
  assert.equal(unrelatedNone.status, "investigating");
});

test("aggregation precedence is active, investigating, recovered, then none", () => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const tiboInvestigating = tiboOperational(
    "investigating",
    "2026-08-22T09:00:00.000Z",
    "2026-08-22T21:00:00.000Z",
  );
  const openAIActive = deriveCodexOperationalStatus({
    openAIStatusHistory: [incident()],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 0,
    tiboSignals: [tiboInvestigating],
    now,
  });
  assert.equal(openAIActive.status, "active");

  const tiboBeatsRecovery = deriveCodexOperationalStatus({
    openAIStatusHistory: [incident({
      status: "resolved",
      resolvedAt: "2026-08-22T08:00:00.000Z",
      updatedAt: "2026-08-22T08:00:00.000Z",
    })],
    openAIStatusHealth: { state: "ok" },
    affectedCodexComponents: 0,
    tiboSignals: [tiboInvestigating],
    now,
  });
  assert.equal(tiboBeatsRecovery.status, "investigating");
});

test("unavailable OpenAI Status falls back to Tibo or unknown", () => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const withTibo = deriveCodexOperationalStatus({
    openAIStatusHistory: [],
    openAIStatusHealth: { state: "degraded" },
    affectedCodexComponents: 0,
    tiboSignals: [tiboOperational(
      "investigating",
      "2026-08-22T09:00:00.000Z",
      "2026-08-22T21:00:00.000Z",
    )],
    now,
  });
  assert.equal(withTibo.status, "investigating");

  const noTibo = deriveCodexOperationalStatus({
    openAIStatusHistory: [],
    openAIStatusHealth: { state: "degraded" },
    affectedCodexComponents: 0,
    tiboSignals: [],
    now,
  });
  assert.equal(noTibo.status, "unknown");
});
