import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDiagnosticCells, buildReferenceCells, buildRequestBody, diagnosticShortInstructions, dryRunSummary, estimateCost, assertBudgetPreflight, parseProviderResult, runWithInjectedTransport, manifest, validateDiagnosticManifest, createGeminiHttpAdapter, verifyModelAndBudget, comparisonTable, summarizeComparisonByCondition, buildRequestIdentity, resolveCheckpointPath } from "../scripts/run-tibo-diagnostic";
import { buildEvaluationCases } from "../scripts/evaluate-tibo-offline";

test("all 12 manifest groups expand to 48 matched cells and three concrete reference requests", () => {
  const cells = buildDiagnosticCells();
  const summary = dryRunSummary();
  assert.equal(cells.length, 48);
  assert.equal(new Set(cells.map((cell) => `${cell.groupId}:${cell.condition}`)).size, 48);
  assert.equal(buildReferenceCells().length, 3);
  const completionReference = buildReferenceCells().find((cell) => cell.groupId === "reference:oct15-completion")!;
  assert.equal(completionReference.input.includes("Verified source graph"), false);
  assert.equal(completionReference.input.includes("The reports of my reset button being lost"), false, "production formatter does not serialize the quoted post's parent chain");
  assert.equal(completionReference.comparisonOutputCap, 4096);
  assert.equal(completionReference.productionOutputCap, null);
  assert.deepEqual(completionReference.acceptedSignalTypes, ["irrelevant", "reset_executed"]);
  assert.deepEqual(completionReference.eventGoldSignalTypes, ["reset_executed"]);
  assert.match(String(completionReference.systemLimitation), /omits its Day10 parent/);
  assert.equal(summary.generationAttemptCap, 60);
  assert.equal(summary.countTokensRequestCap, 52);
  assert.equal(summary.modelInfoRequests, 1);
  assert.equal(summary.networkCalls, 0);
  assert.equal(summary.countTokensCalls, 0);
  assert.equal(summary.maxOutputTokens, 4096);
  assert.equal(summary.unverifiedByteBasedEstimateUsd, null);
  assert.match(summary.note, /byte ratio is not a bound/);
  assert.equal(cells.find((cell) => cell.groupId === "banked-delivery" && cell.condition === "D")?.expectedPublicOutcome, "banked_distribution");
});

test("manifest validation rejects duplicate groups, missing case references, and invalid gold labels", () => {
  const cases = new Map(buildEvaluationCases().map((item) => [item.id, item]));
  const duplicate = structuredClone(manifest);
  duplicate.groups[1]!.id = duplicate.groups[0]!.id;
  assert.throws(() => validateDiagnosticManifest(duplicate, cases), /Duplicate or empty group ID/);
  const missing = structuredClone(manifest);
  missing.groups[0]!.textOnlyCase = "missing-case";
  assert.throws(() => validateDiagnosticManifest(missing, cases), /missing case/);
  const invalid = structuredClone(manifest);
  (invalid.groups[0]!.expected as unknown as string[])[0] = "abstain";
  assert.throws(() => validateDiagnosticManifest(invalid, cases), /Invalid accepted label/);
});

test("condition-specific gold maps missing context to successful irrelevant while preserving explicit evidence temporal gold", () => {
  const cells = buildDiagnosticCells();
  for (const group of ["oct15-landing", "oct15-completion", "landing-virtual", "relative-clock"]) {
    for (const condition of ["A", "C"] as const) {
      const cell = cells.find((item) => item.groupId === group && item.condition === condition)!;
      assert.deepEqual(cell.acceptedSignalTypes, ["irrelevant"]);
      assert.equal(cell.temporalGold, null);
    }
    for (const condition of ["B", "D"] as const) {
      const cell = cells.find((item) => item.groupId === group && item.condition === condition)!;
      assert.deepEqual(cell.acceptedSignalTypes, [group === "oct15-completion" ? "reset_executed" : "official_notice"]);
    }
  }
  const landingB = cells.find((item) => item.groupId === "oct15-landing" && item.condition === "B")!;
  assert.deepEqual(landingB.temporalGold, { startAt: "2026-10-15T04:56:07.000Z", endAt: "2026-10-15T06:56:07.000Z", precision: "range", basePostId: "2110595554036400151" });
  const eod = cells.find((item) => item.groupId === "oct10-eod" && item.condition === "B")!;
  assert.deepEqual(eod.temporalGold, { startAt: "2026-10-10T22:16:20.000Z", endAt: "2026-10-11T07:00:00.000Z", precision: "daypart", basePostId: "2109045392684032299" });
  assert.equal(eod.temporalDirectionGold, "future");
  const banked = cells.find((item) => item.groupId === "banked-delivery" && item.condition === "B")!;
  assert.equal(banked.acceptedSignalTypes[0], "irrelevant");
  assert.equal(banked.temporalDirectionGold, "completed_now");
  assert.equal(cells.find((item) => item.groupId === "release-notes-negative" && item.condition === "B")?.temporalDirectionGold, null);
});

test("teaser boundary allows only safe no-claim or teaser without context", () => {
  const cells = buildDiagnosticCells();
  for (const condition of ["A", "C"] as const) {
    const cell = cells.find((item) => item.groupId === "codex-teaser-boundary" && item.condition === condition)!;
    assert.deepEqual(cell.acceptedSignalTypes, ["irrelevant", "teaser"]);
    assert.deepEqual(cell.forbiddenSignalTypes, ["official_notice", "reset_executed"]);
  }
  for (const condition of ["B", "D"] as const) assert.deepEqual(cells.find((item) => item.groupId === "codex-teaser-boundary" && item.condition === condition)?.acceptedSignalTypes, ["teaser"]);
});

test("both prompt variants use the same production two-part user layout and unchanged schema suffix", () => {
  const cells = buildDiagnosticCells();
  const longCell = cells.find((cell) => cell.condition === "A")!;
  const shortCell = cells.find((cell) => cell.condition === "C")!;
  assert.ok(diagnosticShortInstructions().includes("Respond ONLY with a JSON object strictly matching this schema:"));
  const long = buildRequestBody(longCell, false);
  const short = buildRequestBody(shortCell, true);
  assert.equal(long.contents[0]?.role, "user");
  assert.equal(long.contents[0]?.parts.length, 2);
  assert.equal(short.contents[0]?.parts.length, 2);
  assert.equal(long.contents[0]?.parts[1]?.text, longCell.input);
  assert.equal(short.contents[0]?.parts[1]?.text, shortCell.input);
  assert.deepEqual(long.generationConfig, short.generationConfig);
  assert.equal(long.generationConfig.maxOutputTokens, 4096);
  assert.throws(() => buildRequestBody(longCell, true), /does not match cell condition/);
  const conciseText = diagnosticShortInstructions();
  for (const required of ["Evidence quotes must be exact substrings", "new present/future statement", "Acquiring/receiving a reset button", "BANKED replacement/credit", "Service/incident recovery and reset status are separate", "Explicit negation/cancellation defeats", "Teaser never means a confirmed schedule"]) assert.ok(conciseText.includes(required), required);
});

test("paired graph cells preserve target identity/time, exclude preState, and reject future context or false completion edges", () => {
  const cells = buildDiagnosticCells();
  for (const groupId of Array.from(new Set(cells.map((item) => item.groupId)))) {
    const group = cells.filter((item) => item.groupId === groupId);
    const base = group.find((item) => item.condition === "A")!;
    const withEvidence = group.find((item) => item.condition === "B")!;
    assert.equal(base.target.tweetId, withEvidence.target.tweetId, groupId);
    assert.equal(base.target.text, withEvidence.target.text, groupId);
    assert.equal(base.target.createdAt, withEvidence.target.createdAt, groupId);
    for (const cell of group) {
      const graph = JSON.parse(cell.input.slice(cell.input.indexOf("{\n  \"target\"")));
      assert.ok(graph.relatedPosts.every((post: { createdAt: string }) => Date.parse(post.createdAt) <= Date.parse(cell.target.createdAt)));
      assert.equal(cell.input.includes("activeNotice"), false);
      assert.equal(cell.input.includes('"preState"'), false);
    }
  }
  const done = cells.find((cell) => cell.groupId === "oct15-completion" && cell.condition === "B")!;
  const graph = JSON.parse(done.input.slice(done.input.indexOf("{\n  \"target\"")));
  assert.equal(graph.edges.some((edge: any) => edge.fromTweetId === done.target.tweetId && edge.relation === "reply" && edge.toTweetId === "2110595484180214059"), false);
  assert.equal(graph.edges.some((edge: any) => edge.fromTweetId === "2110595554036400151" && edge.relation === "reply" && edge.toTweetId === "2110595484180214059"), true);
  assert.equal(graph.edges.some((edge: any) => edge.relation === "quote" && edge.toTweetId === "2110595554036400151"), true);
});

test("token measured budget rejects absent values, model/price mismatch, wrong request count, and over-budget estimate", () => {
  const prices = { model: "gemini-3.5-flash-lite", tier: "Standard", inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5, checkedOn: "2026-10-15", source: "official" } as const;
  assert.equal(estimateCost([100, 120], 4096, 3, prices).totalOutputTokensUpperBound, 12288);
  assert.throws(() => estimateCost([], 4096, 3, prices), /measurements are missing/);
  assert.throws(() => estimateCost([1], 4096, 1, { ...prices, model: "other" }), /mismatched/);
  assert.throws(() => assertBudgetPreflight({ model: prices.model, prices, inputTokenCounts: [], countTokensRequests: 1, outputTokenCap: 4096, attempts: 60, budgetUsd: 1 }), /Missing or incomplete count-token/);
  assert.throws(() => assertBudgetPreflight({ model: prices.model, prices, inputTokenCounts: [100], countTokensRequests: 53, outputTokenCap: 4096, attempts: 51, budgetUsd: 1 }), /request cap/);
  assert.throws(() => assertBudgetPreflight({ model: prices.model, prices, inputTokenCounts: Array(51).fill(100_000), countTokensRequests: 51, outputTokenCap: 4096, attempts: 60, budgetUsd: 1 }), /exceeds/);
});

test("Gemini adapter uses auth header without key in URL and verifies model plus exact unique countTokens", async () => {
  const calls: Array<{ url: string; headers: Headers; method: string; body: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    const response = url.includes(":countTokens")
      ? { totalTokens: 125 }
      : { name: "models/gemini-3.5-flash-lite", inputTokenLimit: 1_048_576, outputTokenLimit: 65_536 };
    return new Response(JSON.stringify(response), { status: 200 });
  };
  const adapter = createGeminiHttpAdapter("fake-test-credential", fetcher);
  const cells = buildDiagnosticCells();
  const references = buildReferenceCells();
  const requestCells = [...cells, ...references];
  const bodies = requestCells.map((cell) => buildRequestBody(cell, cell.condition === "C" || cell.condition === "D", cell.groupId.startsWith("reference:")));
  const preflight = await verifyModelAndBudget(adapter, bodies, { budgetUsd: 100 });
  assert.equal(preflight.countTokensRequests, dryRunSummary().countTokensUniqueBodies);
  assert.equal(calls.filter((call) => call.method === "GET").length, 1);
  assert.equal(calls.filter((call) => call.url.includes(":countTokens")).length, preflight.countTokensRequests);
  assert.ok(calls.every((call) => call.headers.get("x-goog-api-key") === "fake-test-credential"));
  assert.ok(calls.every((call) => !call.url.includes("fake-test-credential") && !call.url.includes("key=")));
  assert.ok(calls.every((call) => !call.body?.includes("activeNotice")));
});

test("MAX_TOKENS is a separate truncation status and never accepted as a successful label", () => {
  const parsed = parseProviderResult({ modelVersion: "test", candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, thoughtsTokenCount: 20 } }, "test", "2026-10-15T00:00:00.000Z");
  assert.equal(parsed.resultStatus, "truncated");
  assert.equal(parsed.raw.signalType, null);
  assert.equal(parsed.usageMetadata?.thoughtsTokenCount, 20);
});

test("model text is assembled only from non-thought parts, and non-STOP finish reasons block scoring", () => {
  const target = "Global reset is complete now.";
  const output = JSON.stringify({ signalType: "reset_executed", confidence: 0.99, temporalDirection: "completed_now", evidenceQuote: "Global reset is complete now." });
  const thoughtThenJson = parseProviderResult({ modelVersion: "v1", candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "provider thought placeholder" }, { text: output }] } }] }, target, "2026-10-15T00:00:00.000Z");
  assert.equal(thoughtThenJson.resultStatus, "success");
  assert.equal(thoughtThenJson.modelOutputParts[0]?.thought, true);
  assert.equal(thoughtThenJson.raw.signalType, "reset_executed");
  const safetyWithJson = parseProviderResult({ modelVersion: "v1", candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: output }] } }] }, target, "2026-10-15T00:00:00.000Z");
  assert.equal(safetyWithJson.resultStatus, "blocked");
  assert.equal(safetyWithJson.modelJson?.signalType, "reset_executed", "raw partial JSON remains inspectable locally");
  assert.equal(safetyWithJson.guarded, null);
  assert.equal(safetyWithJson.resolvedTemporal, null);
  const noFinishReason = parseProviderResult({ candidates: [{ content: { parts: [{ text: output }] } }] }, target, "2026-10-15T00:00:00.000Z");
  assert.equal(noFinishReason.resultStatus, "missing_finish_reason");
  assert.equal(noFinishReason.guarded, null);
  assert.equal(noFinishReason.resolvedTemporal, null);
});

test("comparison uses last attempts and scores label, time range, base anchor, direction, and 2x2 denominator separately", () => {
  const cells = buildDiagnosticCells();
  const landing = cells.find((cell) => cell.groupId === "oct15-landing" && cell.condition === "B")!;
  const failed = comparisonTable([landing], [
    { cellId: "oct15-landing:B", finished: true, status: 200, parsed: { resultStatus: "success", raw: { signalType: "official_notice" } } },
    { cellId: "oct15-landing:B", finished: false, status: 503 },
  ])[0]!;
  assert.equal(failed.responseStatus, "http_error");
  assert.equal(failed.lastProviderStatus, 503);
  assert.equal(failed.labelAssessment, "not_scored_response_failure");
  const timeout = comparisonTable([landing], [{ cellId: "oct15-landing:B", finished: false, status: 0, transportFailure: "timeout" }])[0]!;
  assert.equal(timeout.responseStatus, "timeout");
  assert.equal(timeout.labelAssessment, "not_scored_response_failure");
  const notRun = comparisonTable([landing], [])[0]!;
  assert.equal(notRun.responseStatus, "not_run");
  assert.equal(notRun.labelAssessment, "not_run");
  const successRecords = [{
    cellId: "oct15-landing:B", finished: true, status: 200,
    parsed: { resultStatus: "success", raw: { signalType: "official_notice", temporalDirection: "future" }, modelJson: {}, resolvedTemporal: { status: "resolved", expectedStartAt: "2026-10-15T05:00:00.000Z", expectedEndAt: "2026-10-15T06:56:07.000Z", temporalPrecision: "range" } },
  }];
  const scored = comparisonTable([landing], successRecords)[0]!;
  assert.equal(scored.labelAssessment, "accepted");
  assert.equal(scored.temporalAssessment.status, "mismatch");
  assert.deepEqual(scored.temporalAssessment.fields, { startAt: false, endAt: true, precision: true, resolverBasePostId: true });
  assert.equal(scored.temporalDirectionAssessment, "matched");
  assert.equal((scored.temporalAssessment as any).resolverBasePostId, "2110595554036400151");
  assert.equal((scored.temporalAssessment as any).modelDeclaredBasePostId, null);
  assert.equal(scored.publicOutcome, "N/A: publication pipeline not run");
  const summary = summarizeComparisonByCondition([...cells, ...buildReferenceCells()], successRecords);
  assert.ok(summary.byCondition.every((entry) => entry.planned === 12));
  assert.equal(summary.byCondition.find((entry) => entry.condition === "B")?.planned, 12);
  assert.equal(summary.byCondition.find((entry) => entry.condition === "B")?.attempted, 1);
  assert.equal(summary.byCondition.find((entry) => entry.condition === "B")?.successful, 1);
  assert.equal(summary.parentInformationEffect.excludedInputControls.length, 6);
  assert.equal(summary.references.length, 3);
  const completionReferenceCell = buildReferenceCells().find((cell) => cell.groupId === "reference:oct15-completion")!;
  const completionRow = comparisonTable([completionReferenceCell], [{ cellId: "reference:oct15-completion:B", finished: true, status: 200, parsed: { resultStatus: "success", raw: { signalType: "irrelevant" }, modelJson: {} } }])[0]!;
  assert.equal(completionRow.labelAssessment, "accepted");
});

test("adapter timeout survives runner checkpoint and comparison; generic transport error stays distinct", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tibo-diag-timeout-"));
  const cell = buildDiagnosticCells().find((item) => item.groupId === "oct15-day10" && item.condition === "B")!;
  for (const [name, errorName, expected] of [["timeout", "TimeoutError", "timeout"], ["generic", "Error", "transport_error"]] as const) {
    const adapter = createGeminiHttpAdapter("fake", async () => { const error = new Error("fake transport"); error.name = errorName; throw error; });
    const outputPath = path.join(dir, `${name}.json`);
    const result = await runWithInjectedTransport({ cells: [cell], transport: adapter.generate, outputPath, model: "gemini-3.5-flash-lite", optionsHash: name, maxAttempts: 1 });
    assert.equal(result.records[0]?.transportFailure, expected);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).records[0].transportFailure, expected);
    assert.equal(result.comparison[0]?.responseStatus, expected);
  }
  const thrownPath = path.join(dir, "thrown-timeout.json");
  const thrown = await runWithInjectedTransport({ cells: [cell], outputPath: thrownPath, model: "gemini-3.5-flash-lite", optionsHash: "thrown-timeout", maxAttempts: 1, transport: async () => { const error = new Error("fake timeout"); error.name = "TimeoutError"; throw error; } });
  assert.equal(thrown.records[0]?.transportFailure, "timeout");
  assert.equal(thrown.comparison[0]?.responseStatus, "timeout");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("pending attempts are checkpointed before send, resume as unknown outcome, and count against cap", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tibo-diag-pending-"));
  const outputPath = path.join(dir, "new.json");
  const cell = buildDiagnosticCells()[0]!;
  const selected = resolveCheckpointPath(dir, ["--new-run"]);
  assert.match(path.basename(selected), /^checkpoint-\d+\.json$/);
  assert.equal(resolveCheckpointPath(dir, ["--resume", "--checkpoint=new.json"]), path.resolve(dir, "scratch/tibo-diagnostic/new.json"));
  assert.throws(() => resolveCheckpointPath(dir, ["--resume", "--new-run"]), /either/);
  let calls = 0;
  let observedPreSendState: unknown;
  await runWithInjectedTransport({ cells: [cell], outputPath, model: "gemini-3.5-flash-lite", optionsHash: "pending", maxAttempts: 1, transport: async () => {
    calls += 1;
    const saved = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    observedPreSendState = saved.records[0].attemptState;
    throw new Error("simulated interruption");
  } });
  assert.equal(observedPreSendState, "in_flight");
  const pending = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(pending.records[0].attemptState, "completed");
  pending.records[0].attemptState = "in_flight"; pending.records[0].status = "pending";
  fs.writeFileSync(outputPath, JSON.stringify(pending));
  await assert.rejects(runWithInjectedTransport({ cells: [cell], outputPath, resume: true, model: "gemini-3.5-flash-lite", optionsHash: "pending", maxAttempts: 1, transport: async () => { calls += 1; return { status: 200, json: {}, latencyMs: 1 }; } }), /attempt cap/);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).records[0].attemptState, "unknown_outcome");
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).comparison.rows[0].responseStatus, "unknown_outcome");
  const unknownRow = comparisonTable([cell], [{ cellId: `${cell.groupId}:A`, status: "pending", attemptState: "unknown_outcome", finished: false }])[0]!;
  assert.equal(unknownRow.responseStatus, "unknown_outcome");
  assert.equal(unknownRow.attempts, 1);
  assert.equal(unknownRow.labelAssessment, "not_scored_response_failure");
  const summary = summarizeComparisonByCondition([cell], [{ cellId: `${cell.groupId}:A`, status: "pending", attemptState: "unknown_outcome", finished: false }]);
  const byA = summary.byCondition.find((item) => item.condition === "A")!;
  assert.equal(byA.attempted, 1);
  assert.equal(byA.successful, 0);
  assert.equal(byA.successfulAttempts, 0);
  assert.equal(comparisonTable([cell], [{ cellId: `${cell.groupId}:A`, status: "pending", attemptState: "in_flight", finished: false }])[0]?.responseStatus, "in_flight");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Day 10 raw temporal extraction rejects fabricated clocks independently of resolver output", () => {
  const cell = buildDiagnosticCells().find((item) => item.groupId === "oct15-day10" && item.condition === "B")!;
  const row = (modelJson: any, resolvedTemporal: any) => comparisonTable([cell], [{ cellId: `${cell.groupId}:B`, finished: true, status: 200, parsed: { resultStatus: "success", modelJson, raw: { temporalDirection: "future" }, resolvedTemporal } }])[0]!;
  const hallucinated = row({ explicitTimeParts: { hour: 10, minute: 30 }, temporalPrecision: "day" }, { status: "unresolved" });
  assert.equal(hallucinated.temporalAssessment.status, "not_applicable");
  assert.equal(hallucinated.noInventedClockAssessment, "fabricated_clock");
  const midnight = row({ explicitTimeParts: { hour: 0, minute: 0 }, temporalPrecision: "unknown" }, null);
  assert.equal(midnight.noInventedClockAssessment, "fabricated_clock");
  const futureClock = row({ explicitTimeParts: null, temporalPrecision: "day", futureSignal: { explicitTimeParts: { hour: 9, minute: 0 }, temporalPrecision: "day" } }, null);
  assert.equal(futureClock.noInventedClockAssessment, "fabricated_clock");
  const accepted = row({ explicitTimeParts: null, temporalPrecision: "day" }, { status: "resolved", temporalPrecision: "day" });
  assert.equal(accepted.noInventedClockAssessment, "no_fabricated_clock");
  assert.equal(accepted.noInventedClockResolverAssessment, "no_fabricated_clock");
  const resolverInventedClock = row({ explicitTimeParts: null, temporalPrecision: "day" }, { status: "resolved", temporalPrecision: "exact_time" });
  assert.equal(resolverInventedClock.noInventedClockAssessment, "no_fabricated_clock");
  assert.equal(resolverInventedClock.noInventedClockResolverAssessment, "fabricated_clock");
  const summary = summarizeComparisonByCondition([cell], [
    { cellId: `${cell.groupId}:B`, finished: true, status: 200, parsed: { resultStatus: "success", modelJson: { explicitTimeParts: { hour: 10, minute: 30 }, temporalPrecision: "exact_time" }, raw: {}, resolvedTemporal: null } },
  ]);
  assert.equal(summary.byCondition.find((item) => item.condition === "B")?.fabricatedClock, 1);
  assert.equal(summary.byCondition.find((item) => item.condition === "B")?.resolverFabricatedClock, 0);
});

test("transient 5xx retries stay within the configured shared attempt cap", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tibo-diag-retry-"));
  let calls = 0;
  const result = await runWithInjectedTransport({
    cells: [buildDiagnosticCells()[0]!], outputPath: path.join(dir, "checkpoint.json"),
    model: "gemini-3.5-flash-lite", optionsHash: "retry", maxAttempts: 2,
    transport: async () => { calls += 1; return { status: 503, json: { error: "omitted" }, latencyMs: 2 }; },
  });
  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.records.length, 2);
  assert.equal(JSON.stringify(result.records).includes("omitted"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fake transport saves safe checkpoint, stops on 401/429, and resume requires matching identity", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tibo-diag-test-"));
  const outputPath = path.join(dir, "checkpoint.json");
  const cell = buildDiagnosticCells()[0]!;
  let calls = 0;
  const failureTransport = async () => { calls += 1; return { status: 429, json: { error: { message: "redacted" } }, latencyMs: 12 }; };
  await assert.rejects(runWithInjectedTransport({ cells: [cell], transport: failureTransport, outputPath, model: "gemini-3.5-flash-lite", optionsHash: "same" }), /HTTP 429/);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).records[0].status, 429);
  const unauthorizedPath = path.join(dir, "unauthorized.json");
  await assert.rejects(runWithInjectedTransport({ cells: [cell], transport: async () => ({ status: 401, json: { error: { message: "must not be persisted" } }, latencyMs: 3 }), outputPath: unauthorizedPath, model: "gemini-3.5-flash-lite", optionsHash: "same" }), /HTTP 401/);
  const unauthorizedRecord = JSON.parse(fs.readFileSync(unauthorizedPath, "utf8")).records[0];
  assert.equal(unauthorizedRecord.status, 401);
  assert.equal(JSON.stringify(unauthorizedRecord).includes("must not be persisted"), false);
  await assert.rejects(runWithInjectedTransport({ cells: [cell], transport: failureTransport, outputPath, resume: true, model: "gemini-3.5-flash-lite", optionsHash: "changed" }), /checkpoint identity mismatch/);
  const successTransport = async () => ({
    status: 200,
    json: {
      modelVersion: "fake",
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ signalType: "irrelevant", confidence: 0.99, temporalDirection: "unclear", evidenceQuote: null }) }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
    },
    latencyMs: 8,
  });
  const successPath = path.join(dir, "success.json");
  const preflight = { status: "verified", tokenCounts: [125], priceSource: "official" };
  const result = await runWithInjectedTransport({ cells: [cell], transport: successTransport, outputPath: successPath, model: "gemini-3.5-flash-lite", optionsHash: "stable", preflight });
  assert.equal(result.records[0]?.parsed?.raw?.signalType, "irrelevant");
  assert.match(result.comparison[0]?.publicOutcome ?? "", /N\/A/);
  const saved = JSON.parse(fs.readFileSync(successPath, "utf8"));
  assert.deepEqual(saved.preflight, preflight);
  assert.ok(saved.sourceHashes["scripts/run-tibo-diagnostic.ts"]);
  assert.ok(saved.sourceHashes["scripts/evaluate-tibo-offline.ts"]);
  assert.ok(saved.sourceHashes["tests/fixtures/tibo-real-posts-v1.json"]);
  assert.notEqual(buildRequestIdentity([cell], "gemini-3.5-flash-lite", "stable-changed", 0).requestIdentity, saved.requestIdentity);
  await assert.rejects(runWithInjectedTransport({ cells: [cell], transport: successTransport, outputPath: successPath, model: "gemini-3.5-flash-lite", optionsHash: "stable", preflight }), /Output already exists/);
  await assert.rejects(runWithInjectedTransport({ cells: [cell], transport: successTransport, outputPath: successPath, resume: true, model: "gemini-3.5-flash-lite", optionsHash: "changed", preflight }), /identity mismatch/);
  await assert.rejects(runWithInjectedTransport({ cells: [cell], transport: successTransport, outputPath: successPath, resume: true, model: "different-model", optionsHash: "stable", preflight }), /Model mismatch/);
  let resumeCalls = 0;
  await runWithInjectedTransport({ cells: [cell], transport: async () => { resumeCalls += 1; return { status: 500, json: null, latencyMs: 1 }; }, outputPath: successPath, resume: true, model: "gemini-3.5-flash-lite", optionsHash: "stable", preflight });
  assert.equal(resumeCalls, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("modelVersion drift is checkpointed, stops the run, and cannot be resumed into a mixed result", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tibo-diag-model-version-"));
  const cells = buildDiagnosticCells().slice(0, 2);
  let version = 0;
  const transport = async () => ({
    status: 200, latencyMs: 1,
    json: { modelVersion: `v${++version}`, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ signalType: "irrelevant", confidence: 0.99, temporalDirection: "unclear", evidenceQuote: null }) }] } }] },
  });
  const outputPath = path.join(dir, "checkpoint.json");
  await assert.rejects(runWithInjectedTransport({ cells, transport, outputPath, model: "gemini-3.5-flash-lite", optionsHash: "same" }), /modelVersion changed/);
  const checkpoint = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(checkpoint.modelVersionMismatch, true);
  assert.equal(checkpoint.records.length, 2);
  await assert.rejects(runWithInjectedTransport({ cells, transport, outputPath, resume: true, model: "gemini-3.5-flash-lite", optionsHash: "same" }), /modelVersion drift/);
  fs.rmSync(dir, { recursive: true, force: true });
});
