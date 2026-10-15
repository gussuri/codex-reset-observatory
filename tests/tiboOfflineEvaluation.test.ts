import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildOfflineReport,
  buildRunIdentityHash,
  buildDryRunSummary,
  isCheckpointCompatible,
  normalizeStoredOutcome,
  buildCurrentRunIdentity,
  buildEvaluationCases,
  selectEvaluationCases,
  type OfflineLayerPrediction,
  type OfflineEvaluationCase,
  type OfflineRunIdentity,
  type StoredOfflineOutcome,
} from "../scripts/evaluate-tibo-offline";

const identity: OfflineRunIdentity = {
  fixtureHash: "fixture-a",
  evaluatorHash: "evaluator-a",
  promptHash: "prompt-a",
  schemaHash: "schema-a",
  optionsHash: "options-a",
  commitSha: "commit-a",
  provider: "google",
  model: "gemini-test",
  modelVersion: "version-a",
  inputCondition: "verified-context",
  conditions: ["verified-context"],
  selectionHash: "selection-a",
  serializerMode: "production_baseline",
  serializerHash: "serializer-a",
};

function evaluationCase(id: string, expectedSignalType: OfflineEvaluationCase["gold"]["signalType"], decision: OfflineEvaluationCase["gold"]["decision"] = "classify"): OfflineEvaluationCase {
  return {
    id,
    eventGroupId: `event-${id}`,
    split: "development",
    layer: "classification",
    inputCondition: "verified-context",
    providerInput: { target: { tweetId: id, author: "@author", text: "Reset is planned tomorrow.", createdAt: "2026-10-15T00:00:00Z" }, contextPosts: [] },
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
    rawAi: { availability: "unavailable", signalType: null, resultState: "not_recorded" },
    corrected: signalType === null ? { availability: "unavailable", signalType: null, resultState: "attempted_no_result" } : { availability: "available", signalType, resultState: "available", relatedEventGroupId: `event-${id}` },
    publicOutcome: signalType === null ? { availability: "unavailable", signalType: null, resultState: "attempted_no_result" } : { availability: "available", signalType, resultState: "available", relatedEventGroupId: `event-${id}` },
    latencyMs: null,
    tokenUsage: null,
    rawCaptureState: "not_recorded",
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
  assert.equal(report.rawAi.availability, "not_recorded");
  assert.equal(report.rawAi.successOnlyAccuracy, null);
  assert.equal(report.resources.latencyRecorded, 0);
  assert.equal(report.resources.latencyMissing, 7);
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
  const failed = normalizeStoredOutcome({ id: "only-negative", responseStatus: "timeout", rawCaptureState: "attempt_logged", rawAi: { resultState: "attempted_no_result" }, corrected: { resultState: "attempted_no_result" }, publicOutcome: { resultState: "attempted_no_result" } });
  const failureReport = buildOfflineReport([evaluationCase("only-negative", "irrelevant")], [failed]);
  assert.equal(failureReport.corrected.byClass.official_notice.support, 0);
  assert.equal(failureReport.corrected.byClass.official_notice.f1, null);
  assert.equal(failureReport.corrected.byClass.irrelevant.support, 1);
  assert.equal(failureReport.corrected.byClass.irrelevant.recall, 0);
  assert.equal(failureReport.corrected.byClass.irrelevant.f1, 0);
});

test("raw AI quality stays unavailable when the old wrapper saved no raw responses", () => {
  const report = buildOfflineReport([evaluationCase("legacy", "official_notice")], [outcome("legacy", "success", "official_notice")]);
  assert.equal(report.rawAi.availability, "not_recorded");
  assert.equal(report.rawAi.allRequestAccuracy, null);
});

test("saved response normalization preserves 401, 429, timeout, and invalid JSON as failures", () => {
  for (const status of ["http_401", "http_429", "timeout", "invalid_json"] as const) {
    const result = normalizeStoredOutcome({ id: status, responseStatus: status });
    assert.equal(result.responseStatus, status);
    assert.equal(result.rawAi.resultState, "attempted_no_result");
    assert.equal(result.corrected.availability, "unavailable");
    assert.equal(result.corrected.signalType, null);
  }
});

test("checkpoint identity hashes every experiment-defining field and rejects mismatches", () => {
  const checkpoint = { identity, identityHash: buildRunIdentityHash(identity) };
  assert.equal(isCheckpointCompatible(identity, checkpoint), true);
  for (const field of Object.keys(identity) as Array<keyof OfflineRunIdentity>) {
    const changed = { ...identity, [field]: `${identity[field]}-changed` };
    assert.equal(isCheckpointCompatible(changed, checkpoint), false, `${field} must invalidate resume`);
  }
  const graphIdentity = buildCurrentRunIdentity({ inputCondition: "text_only", selectedCaseIds: ["one"], provider: "google", model: "gemini-test", modelVersion: "v1", serializerMode: "verified_graph" });
  const baselineIdentity = buildCurrentRunIdentity({ inputCondition: "text_only", selectedCaseIds: ["one"], provider: "google", model: "gemini-test", modelVersion: "v1", serializerMode: "production_baseline" });
  assert.notEqual(graphIdentity.serializerHash, baselineIdentity.serializerHash);
  assert.notEqual(buildRunIdentityHash(graphIdentity), buildRunIdentityHash(baselineIdentity));
});

test("dry-run reports the selected scope and next-stage cap without enabling API calls", () => {
  const summary = buildDryRunSummary({ fixtureCaseCount: 220, selectedCaseCount: 12 });
  assert.equal(summary.currentApiCalls, 0);
  assert.equal(summary.currentDbWrites, 0);
  assert.equal(summary.nextStageBaseCalls, 48);
  assert.equal(summary.nextStageMaxHttpAttempts, 60);
  assert.match(summary.text, /current network: none/i);
});

test("actual CLI dataset includes old scenarios, real posts, and concrete condition inputs", () => {
  const cases = buildEvaluationCases();
  assert.ok(cases.length >= 220);
  assert.ok(cases.some((item) => item.id === "exec-01"));
  assert.ok(cases.some((item) => item.id === "2110595554036400151::verified-parent"));
  assert.ok(cases.some((item) => item.id === "eval-syn-001"));
  const contextCase = cases.find((item) => item.id === "eval-syn-002");
  assert.ok(contextCase?.providerInput.contextPosts.length);
  assert.equal(cases.find((item) => item.id === "2091412393368945027::text_only")?.gold.temporal?.startAt, "2026-08-23T22:00:00.000Z");
  assert.equal(selectEvaluationCases(cases, { condition: "text_only", split: "regression", limit: 1 }).length, 1);
  assert.throws(() => selectEvaluationCases(cases, { condition: "unknown" }), /Unknown input condition/);
  assert.throws(() => selectEvaluationCases(cases, { condition: "no-match" }), /Unknown input condition/);
});

test("provider failures do not erase corrected fallback or public outcome layers", () => {
  const fallback: OfflineLayerPrediction = { availability: "available", signalType: "official_notice", publicOutcome: { historyCreated: false, activeNotice: true } };
  const saved = normalizeStoredOutcome({ id: "fallback-401", providerStatus: "http_401", rawAi: { resultState: "attempted_no_result" }, corrected: fallback, publicOutcome: fallback });
  assert.equal(saved.rawAi.resultState, "attempted_no_result");
  assert.equal(saved.corrected.signalType, "official_notice");
  assert.equal(saved.publicOutcome.publicOutcome?.activeNotice, true);
  const report = buildOfflineReport([evaluationCase("fallback-401", "official_notice")], [saved]);
  assert.equal(report.corrected.allRequestAccuracy, 1);
  assert.equal(report.publicOutcome.allRequestAccuracy, 1);
});

test("public history contract and missing related-event association are scored independently", () => {
  const item = { ...evaluationCase("public-contract", "official_notice"), gold: { decision: "classify" as const, signalType: "official_notice" as const, rationale: "notice", expectedEventGroupId: "event-public-contract", publicOutcome: { historyCreated: false, activeNotice: true, eventKind: null, resetMethod: null, eventIdentity: "event-public-contract" } } };
  const actual = outcome("public-contract", "http_401", "official_notice");
  actual.corrected = { availability: "available", resultState: "available", signalType: "official_notice", relatedEventGroupId: null };
  actual.publicOutcome = { availability: "available", resultState: "available", signalType: "official_notice", publicOutcome: { historyCreated: true, activeNotice: true, eventKind: "global_reset", resetMethod: "forced_reset", eventIdentity: item.eventGroupId } };
  const report = buildOfflineReport([item], [actual]);
  assert.equal(report.corrected.eventAssociation.errors, 1);
  assert.equal(report.publicOutcome.publicContract.evaluated, 1);
  assert.equal(report.publicOutcome.publicContract.errors, 1);
  assert.equal(report.publicOutcome.allRequestAccuracy, 1);
  assert.equal(report.responseStatus.http_401, 1);
});

test("attempted all-fail and unrecorded raw outputs are distinct; missing temporal values count as misses", () => {
  const temporalCase = { ...evaluationCase("temporal", "official_notice"), gold: { decision: "classify" as const, signalType: "official_notice" as const, rationale: "schedule", temporal: { startAt: "2026-10-16T01:00:00Z", endAt: "2026-10-16T02:00:00Z", precision: "range", basePostId: "temporal" } } };
  const attemptedFailure = normalizeStoredOutcome({ id: "temporal", providerStatus: "timeout", rawAi: { resultState: "attempted_no_result" }, corrected: { resultState: "attempted_no_result" }, publicOutcome: { resultState: "attempted_no_result" } });
  const report = buildOfflineReport([temporalCase], [attemptedFailure]);
  assert.equal(report.rawAi.allRequestAccuracy, 0);
  assert.equal(report.rawAi.byClass.official_notice.recall, 0);
  assert.equal(report.rawAi.temporal.evaluated, 1);
  assert.equal(report.rawAi.temporal.missingPrediction, 1);
  const unrecorded = normalizeStoredOutcome({ id: "temporal", providerStatus: "success", rawCaptureState: "not_recorded", corrected: { resultState: "not_recorded" }, publicOutcome: { resultState: "not_recorded" } });
  const unrecordedReport = buildOfflineReport([temporalCase], [unrecorded]);
  assert.equal(unrecordedReport.rawAi.availability, "not_recorded");
  assert.equal(unrecordedReport.rawAi.allRequestAccuracy, null);
  assert.equal(unrecordedReport.rawAi.byClass.official_notice.recall, null);
  const mixed = buildOfflineReport([{ ...temporalCase, id: "raw-recorded" }, { ...temporalCase, id: "raw-not-run" }], [normalizeStoredOutcome({ id: "raw-recorded", responseStatus: "success", rawCaptureState: "not_recorded", corrected: { resultState: "not_recorded" }, publicOutcome: { resultState: "not_recorded" } })]);
  assert.equal(mixed.rawAi.resultStateCounts.not_recorded, 1);
  assert.equal(mixed.rawAi.resultStateCounts.not_run, 1);
  assert.throws(() => normalizeStoredOutcome({ id: "bad", responseStatus: "success", rawCaptureState: "captured", rawAi: { resultState: "available", signalType: "official_notice", temporal: { startAt: "not-a-time", endAt: null, precision: "range", basePostId: "bad" } } }), /temporal startAt/);
});

test("ambiguous legacy rows are safe-hold scored outside definite-label accuracy; corrected BANKED gold is independent", () => {
  const ambiguous = { ...evaluationCase("ambiguous-legacy", "irrelevant"), gold: { decision: "ambiguous" as const, signalType: null, acceptedSignalTypes: ["abstain" as const], rationale: "Legacy ambiguity; safe hold only." } };
  const wrongCommitment = normalizeStoredOutcome({ id: "ambiguous-legacy", responseStatus: "success", rawCaptureState: "captured", rawAi: { resultState: "available", signalType: "reset_executed" } });
  const ambiguousReport = buildOfflineReport([ambiguous], [wrongCommitment]);
  assert.equal(ambiguousReport.rawAi.allRequestAccuracy, null);
  assert.equal(ambiguousReport.rawAi.safeHoldExpected, 1);
  assert.equal(ambiguousReport.rawAi.safeHoldCorrect, 0);
  const teaserBoundary = buildEvaluationCases().find((item) => item.id === "eval-syn-025")!;
  const permittedTeaser = normalizeStoredOutcome({ id: teaserBoundary.id, responseStatus: "success", rawCaptureState: "captured", rawAi: { resultState: "available", signalType: "teaser" } });
  const boundaryReport = buildOfflineReport([teaserBoundary], [permittedTeaser]);
  assert.equal(boundaryReport.rawAi.allRequestAccuracy, null);
  assert.equal(boundaryReport.rawAi.ambiguousAllowedPredictions, 1);
  assert.equal(boundaryReport.rawAi.ambiguousConstraintErrors, 0);
  const banked = buildEvaluationCases().find((item) => item.id === "eval-syn-033")!;
  const bankedOutcome = normalizeStoredOutcome({ id: banked.id, responseStatus: "success", rawCaptureState: "captured", rawAi: { resultState: "available", signalType: "reset_executed" }, corrected: { resultState: "available", signalType: "irrelevant" }, publicOutcome: { resultState: "available", signalType: "irrelevant", publicOutcome: banked.gold.publicOutcome } });
  const bankedReport = buildOfflineReport([banked], [bankedOutcome]);
  assert.equal(bankedReport.rawAi.allRequestAccuracy, 1);
  assert.equal(bankedReport.corrected.allRequestAccuracy, 1);
  assert.equal(bankedReport.publicOutcome.publicContract.errors, 0);
});

test("CLI scores selected saved rows by outer case ID and rejects forged run identities", () => {
  const ids = ["eval-syn-001", "2091412393368945027::text_only"];
  const cases = selectEvaluationCases(buildEvaluationCases(), { condition: "text_only", ids });
  const identity = buildCurrentRunIdentity({ inputCondition: "text_only", selectedCaseIds: cases.map((item) => item.id), provider: "google", model: "gemini-test", modelVersion: "v1" });
  const outcomeRecords = cases.map((selectedCase) => {
    const signalType = selectedCase.gold.decision === "abstain" ? "abstain" : selectedCase.gold.signalType;
    const expectedEventGroupId = selectedCase.gold.expectedEventGroupId !== undefined ? selectedCase.gold.expectedEventGroupId : selectedCase.eventGroupId;
    const prediction = (): OfflineLayerPrediction => ({ availability: "available", resultState: "available", signalType, relatedEventGroupId: expectedEventGroupId, temporal: selectedCase.gold.temporal ?? null, publicOutcome: selectedCase.gold.publicOutcome ?? null });
    return { id: selectedCase.id, responseStatus: "success", rawCaptureState: "captured", rawAi: prediction(), corrected: prediction(), publicOutcome: prediction(), latencyMs: 20, tokenUsage: 100 };
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tibo-offline-cli-"));
  const resultPath = path.join(tempDir, "results.json");
  const reportPath = path.join(tempDir, "report.json");
  const cli = path.resolve("scripts/evaluate-tibo-offline.ts");
  const invoke = (saved: { identity: OfflineRunIdentity; identityHash: string; outcomes: unknown[] }, shouldSucceed: boolean) => {
    fs.writeFileSync(resultPath, JSON.stringify(saved));
    fs.rmSync(reportPath, { force: true });
    const result = spawnSync(process.execPath, ["--import", "tsx", cli, "--results", resultPath, "--output", reportPath, "--condition", "text_only", "--ids", ids.join(","), "--provider", "google", "--model", "gemini-test", "--model-version", "v1"], { encoding: "utf8" });
    assert.equal(result.error, undefined);
    assert.equal(result.status === 0, shouldSucceed, result.stderr);
    assert.equal(fs.existsSync(reportPath), shouldSucceed, "CLI report must be newly written only on success");
  };
  try {
    invoke({ identity, identityHash: buildRunIdentityHash(identity), outcomes: outcomeRecords }, true);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as { caseIds: string[]; report: { totalCases: number; corrected: { successfulCorrect: number }; missingOutcomeIds: string[]; rawAi: { temporal: { evaluated: number; exactWindowMatches: number } } } };
    assert.equal(report.report.totalCases, 2);
    assert.equal(report.report.corrected.successfulCorrect, 2);
    assert.equal(report.report.rawAi.temporal.evaluated, 1);
    assert.equal(report.report.rawAi.temporal.exactWindowMatches, 1);
    assert.deepEqual(report.caseIds, ids);
    assert.deepEqual(report.report.missingOutcomeIds, []);
    const forgedFields: Array<keyof OfflineRunIdentity> = ["commitSha", "provider", "model", "modelVersion", "fixtureHash", "evaluatorHash", "promptHash", "schemaHash", "optionsHash"];
    for (const field of forgedFields) {
      const forged = { ...identity, [field]: `${identity[field]}-forged` };
      invoke({ identity: forged, identityHash: buildRunIdentityHash(forged), outcomes: outcomeRecords }, false);
    }
    invoke({ identity, identityHash: buildRunIdentityHash(identity), outcomes: [...outcomeRecords, { ...outcomeRecords[0], id: "extra-case" }] }, false);
    invoke({ identity, identityHash: buildRunIdentityHash(identity), outcomes: [...outcomeRecords, outcomeRecords[0]] }, false);
    assert.throws(() => selectEvaluationCases([...buildEvaluationCases(), evaluationCase("exec-01", "irrelevant")], { condition: "text_only" }), /Duplicate or empty evaluation case id/);
    assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", cli, "--condition", "unknown"], { stdio: "ignore" }));
    const expectCliStatus = (status: number | null, expectedSuccess: boolean) => assert.equal(status === 0, expectedSuccess, "unexpected CLI exit status");
    const intentionallySuccessful = spawnSync(process.execPath, ["--import", "tsx", cli, "--dry-run"], { encoding: "utf8" });
    assert.throws(() => expectCliStatus(intentionallySuccessful.status, false), /unexpected CLI exit status/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
