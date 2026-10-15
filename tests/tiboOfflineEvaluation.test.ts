import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfflineReport,
  buildRunIdentityHash,
  buildDryRunSummary,
  isCheckpointCompatible,
  normalizeStoredOutcome,
  type OfflineEvaluationCase,
  type OfflineRunIdentity,
  type StoredOfflineOutcome,
} from "../scripts/evaluate-tibo-offline";

const identity: OfflineRunIdentity = {
  fixtureHash: "fixture-a",
  promptHash: "prompt-a",
  schemaHash: "schema-a",
  optionsHash: "options-a",
  commitSha: "commit-a",
  provider: "google",
  model: "gemini-test",
  modelVersion: "version-a",
  inputCondition: "verified-context",
};

function evaluationCase(id: string, expectedSignalType: OfflineEvaluationCase["gold"]["signalType"], decision: OfflineEvaluationCase["gold"]["decision"] = "classify"): OfflineEvaluationCase {
  return {
    id,
    eventGroupId: `event-${id}`,
    split: "development",
    layer: "classification",
    inputCondition: "verified-context",
    gold: { decision, signalType: expectedSignalType, rationale: "fixture gold" },
  };
}

function outcome(
  id: string,
  responseStatus: StoredOfflineOutcome["responseStatus"],
  signalType: StoredOfflineOutcome["corrected"]["signalType"],
): StoredOfflineOutcome {
  return {
    id,
    responseStatus,
    rawAi: { availability: "unavailable", signalType: null },
    corrected: { availability: "available", signalType },
    publicOutcome: { availability: "available", signalType },
    latencyMs: null,
    tokenUsage: null,
  };
}

test("offline metrics separate all-request and successful-response accuracy and accept safe abstention", () => {
  const cases = [
    evaluationCase("correct", "official_notice"),
    evaluationCase("wrong", "reset_executed"),
    evaluationCase("safe-hold", null, "abstain"),
    evaluationCase("unauthorized", "teaser"),
    evaluationCase("rate-limited", "irrelevant"),
    evaluationCase("timeout", "reset_executed"),
    evaluationCase("invalid-json", "irrelevant"),
  ];
  const outcomes = [
    outcome("correct", "success", "official_notice"),
    outcome("wrong", "success", "irrelevant"),
    outcome("safe-hold", "success", "abstain"),
    outcome("unauthorized", "http_401", null),
    outcome("rate-limited", "http_429", null),
    outcome("timeout", "timeout", null),
    outcome("invalid-json", "invalid_json", null),
  ];

  const report = buildOfflineReport(cases, outcomes);
  assert.equal(report.totalCases, 7);
  assert.equal(report.corrected.allRequestAccuracy, 2 / 7);
  assert.equal(report.corrected.successOnlyAccuracy, 2 / 3);
  assert.equal(report.corrected.correctAbstentions, 1);
  assert.equal(report.responseStatus.http_401, 1);
  assert.equal(report.responseStatus.http_429, 1);
  assert.equal(report.responseStatus.timeout, 1);
  assert.equal(report.responseStatus.invalid_json, 1);
  assert.equal(report.corrected.confusion.reset_executed.no_valid_prediction, 1);
  assert.equal(report.rawAi.availability, "unavailable");
});

test("zero-support class metrics use null values rather than fabricated zeros", () => {
  const report = buildOfflineReport(
    [evaluationCase("only-negative", "irrelevant")],
    [outcome("only-negative", "success", "irrelevant")],
  );
  assert.equal(report.corrected.byClass.official_notice.support, 0);
  assert.equal(report.corrected.byClass.official_notice.precision, null);
  assert.equal(report.corrected.byClass.official_notice.recall, null);
  assert.equal(report.corrected.byClass.official_notice.f1, null);
});

test("raw AI quality stays unavailable when the old wrapper saved no raw responses", () => {
  const report = buildOfflineReport([evaluationCase("legacy", "official_notice")], [outcome("legacy", "success", "official_notice")]);
  assert.equal(report.rawAi.availability, "unavailable");
  assert.equal(report.rawAi.allRequestAccuracy, null);
});

test("saved response normalization preserves 401, 429, timeout, and invalid JSON as failures", () => {
  for (const status of ["http_401", "http_429", "timeout", "invalid_json"] as const) {
    const result = normalizeStoredOutcome({ id: status, responseStatus: status });
    assert.equal(result.responseStatus, status);
    assert.equal(result.corrected.availability, "unavailable");
    assert.equal(result.corrected.signalType, null);
  }
});

test("checkpoint identity hashes every experiment-defining field and rejects mismatches", () => {
  const checkpoint = { identityHash: buildRunIdentityHash(identity) };
  assert.equal(isCheckpointCompatible(identity, checkpoint), true);
  for (const field of Object.keys(identity) as Array<keyof OfflineRunIdentity>) {
    const changed = { ...identity, [field]: `${identity[field]}-changed` };
    assert.equal(isCheckpointCompatible(changed, checkpoint), false, `${field} must invalidate resume`);
  }
});

test("dry-run reports the selected scope and next-stage cap without enabling API calls", () => {
  const summary = buildDryRunSummary({ fixtureCaseCount: 220, selectedCaseCount: 12 });
  assert.equal(summary.currentApiCalls, 0);
  assert.equal(summary.currentDbWrites, 0);
  assert.equal(summary.nextStageBaseCalls, 48);
  assert.equal(summary.nextStageMaxHttpAttempts, 60);
  assert.match(summary.text, /current network: none/i);
});
