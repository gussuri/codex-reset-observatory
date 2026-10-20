import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCodexUsageRecovery,
  type CodexUsageSnapshot,
} from "../lib/codexUsageRecovery";
import {
  confirmNearestCodexRecoveryObservation,
  findBankedEstimateByExactObservation,
  findFormalTiboResetCluster,
  findLatestBankedGrant,
  findRecentFormalTiboReset,
  getNextUsageMonitorLastBankedGrantAt,
  readResetExecutionEstimates,
  upsertBankedDistributionEstimate,
  upsertResetExecutionEstimate,
} from "../lib/codexUsageRecoveryStore";
import { createTiboFormalReplyAdmissionProof } from "../lib/radar/tiboFormalReplyAdmission";
import type { TiboContextSafetyInput } from "../lib/radar/tiboContextSafety";
import type { TiboEvidenceContext } from "../lib/radar/tiboEvidenceContext";
import type { ResetExecutionEstimate } from "../lib/radar/resetExecution";
import type { UsageMonitorState } from "../lib/codexUsageMonitorCoverage";

const OBSERVED_AT = "2026-08-26T01:15:00.000Z";
const TRUSTED_GRANT_AT = "2026-08-20T00:00:00.000Z";
const REPLY_CONTEXT_REVISION = "a".repeat(64);
const REPLY_TARGET_TEXT = "Done and dusted.";
const REPLY_PARENT_TEXT = "I pressed the forced reset button for all paid users.";

function formalReplySignal(tweetId: string, tweetCreatedAt: string, parentId: string) {
  const tweetUrl = `https://x.com/thsottiaux/status/${tweetId}`;
  const parentUrl = `https://x.com/thsottiaux/status/${parentId}`;
  const parentCreatedAt = new Date(Date.parse(tweetCreatedAt) - 5 * 60_000).toISOString();
  const sourceContext: TiboEvidenceContext = {
    version: "tibo-evidence-context-v1",
    status: "complete",
    target: {
      tweetId,
      tweetUrl,
      authorHandle: "@thsottiaux",
      text: REPLY_TARGET_TEXT,
      createdAt: tweetCreatedAt,
      sourceContextRevisionHashes: [REPLY_CONTEXT_REVISION],
    },
    relatedPosts: [{
      tweetId: parentId,
      tweetUrl: parentUrl,
      authorHandle: "@thsottiaux",
      text: REPLY_PARENT_TEXT,
      createdAt: parentCreatedAt,
    }],
    edges: [{ fromTweetId: tweetId, toTweetId: parentId, relation: "reply" }],
    omissions: [],
    lookupCount: 1,
  };
  const proofInput: TiboContextSafetyInput = {
    authorText: REPLY_TARGET_TEXT,
    isReply: true,
    isQuote: false,
    replyContextText: REPLY_PARENT_TEXT,
    replyParentTweetId: parentId,
    replyParentTweetUrl: parentUrl,
    selectedSignalType: "reset_executed",
    temporalDirection: "completed_now",
    evidenceQuote: REPLY_TARGET_TEXT,
    contextualResetAssessment: "same_global_reset",
    contextualResetTweetId: parentId,
    resetMeaning: {
      method: "forced",
      methodEvidence: { tweetId: parentId, quote: "I pressed the forced reset button" },
      scope: "all_paid_users",
      scopeEvidence: { tweetId: parentId, quote: "for all paid users" },
    },
    targetTweetId: tweetId,
    targetTweetUrl: tweetUrl,
    targetTweetCreatedAt: tweetCreatedAt,
    validatedSourceContext: sourceContext,
  };
  const proof = createTiboFormalReplyAdmissionProof(proofInput, [REPLY_CONTEXT_REVISION], 1);
  assert.ok(proof, "fixture must produce a current v3 formal reply proof");

  return {
    tweet_id: tweetId,
    text: REPLY_TARGET_TEXT,
    tweet_url: tweetUrl,
    tweet_created_at: tweetCreatedAt,
    signal_type: "reset_executed",
    confidence: 0.99,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    ai_signal_type: "reset_executed",
    ai_confidence: 0.99,
    ai_classification_status: "success",
    ai_temporal_direction: "completed_now",
    ai_evidence_quote: REPLY_TARGET_TEXT,
    is_reply: true,
    is_quote: false,
    source_context_revision_hashes: [REPLY_CONTEXT_REVISION],
    source_context_classified_revision_hashes: [REPLY_CONTEXT_REVISION],
    source_context_generation: 1,
    formal_reply_admission_proof: proof,
  };
}

function projectedTiboSignalsClient(
  rows: Array<Record<string, unknown>>,
  options: { missingColumn?: string } = {},
) {
  return {
    from(table: string) {
      assert.equal(table, "tibo_signals");
      let projection: string[] = [];
      let rowLimit = Number.MAX_SAFE_INTEGER;
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const orderings: Array<{ column: string; ascending: boolean }> = [];
      const builder: Record<string, any> = {};
      builder.select = (columns: string) => {
        projection = columns.split(",");
        return builder;
      };
      builder.or = (expression: string) => {
        const alternatives = expression.split(",").map((term) => {
          const [column, value] = term.split(".eq.");
          return (row: Record<string, unknown>) => row[column!] === value;
        });
        filters.push((row) => alternatives.some((matches) => matches(row)));
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      };
      builder.neq = (column: string, value: unknown) => {
        filters.push((row) => row[column] !== value);
        return builder;
      };
      builder.in = (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      };
      builder.gte = (column: string, value: string) => {
        filters.push((row) => typeof row[column] === "string" && row[column] >= value);
        return builder;
      };
      builder.lte = (column: string, value: string) => {
        filters.push((row) => typeof row[column] === "string" && row[column] <= value);
        return builder;
      };
      builder.lt = (column: string, value: string) => {
        filters.push((row) => typeof row[column] === "string" && row[column] < value);
        return builder;
      };
      builder.order = (column: string, options?: { ascending?: boolean }) => {
        orderings.push({ column, ascending: options?.ascending ?? true });
        return builder;
      };
      builder.limit = (limit: number) => {
        rowLimit = limit;
        return builder;
      };
      builder.then = (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
        if (options.missingColumn && projection.includes(options.missingColumn)) {
          return Promise.resolve({
            data: null,
            error: {
              code: "42703",
              message: `column ${options.missingColumn} does not exist`,
            },
          }).then(resolve, reject);
        }
        const matchingRows = rows.filter((row) => filters.every((matches) => matches(row)));
        matchingRows.sort((left, right) => {
          for (const { column, ascending } of orderings) {
            const comparison = String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
            if (comparison !== 0) return ascending ? comparison : -comparison;
          }
          return 0;
        });
        const data = matchingRows.slice(0, rowLimit).map((row) => Object.fromEntries(
          projection
            .filter((column) => Object.prototype.hasOwnProperty.call(row, column))
            .map((column) => [column, row[column]]),
        ));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return builder;
    },
  };
}

function unscheduledOfficialNotice(tweetId: string, tweetCreatedAt: string) {
  const text = "Day 13/ Le limit reset";
  return {
    tweet_id: tweetId,
    text,
    tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
    tweet_created_at: tweetCreatedAt,
    signal_type: "official_notice",
    confidence: 0.85,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    ai_signal_type: "official_notice",
    ai_classification_status: "success",
    ai_temporal_direction: "unclear",
    ai_notice_timing_status: "unknown",
    ai_evidence_quote: "Le limit reset",
    ai_notice_to_execution: null,
    ai_temporal_confidence: null,
    ai_temporal_expression: null,
    ai_temporal_kind: null,
    ai_temporal_precision: null,
    ai_temporal_timezone: null,
    temporal_expression: null,
    temporal_kind: null,
    temporal_precision: null,
    temporal_timezone: null,
    temporal_confidence: null,
    temporal_resolution_source: null,
    expected_start_at: null,
    expected_end_at: null,
    temporal_resolution_status: "unresolved",
    is_reply: false,
    is_quote: false,
    expires_at: null,
  };
}

function state(
  count: number | null | undefined,
  lastBankedGrantAt: string | null = null,
): UsageMonitorState {
  return {
    sourceKey: "local-codex-app-server",
    observedAt: "2026-08-26T01:10:00.000Z",
    receivedAt: "2026-08-26T01:10:01.000Z",
    limitId: "codex",
    planType: "plus",
    usedPercent: 80,
    windowDurationMins: 10080,
    resetsAt: 1_788_000_000,
    coverageStartedAt: null,
    ...(count !== undefined ? { bankedResetAvailableCount: count } : {}),
    lastBankedGrantAt,
  };
}

function snapshot(
  count: number | null | undefined,
  overrides: Partial<CodexUsageSnapshot> = {},
): CodexUsageSnapshot {
  return {
    observedAt: OBSERVED_AT,
    limitId: "codex",
    planType: "plus",
    usedPercent: 80,
    windowDurationMins: 10080,
    resetsAt: 1_788_604_800,
    ...(count !== undefined ? { bankedResetAvailableCount: count } : {}),
    ...overrides,
  };
}

test("a 0 to 1 count increase records the current observation as the grant", () => {
  assert.equal(
    getNextUsageMonitorLastBankedGrantAt(state(0), snapshot(1)),
    OBSERVED_AT,
  );
});

test("a 1 to 2 count increase records the current observation as the grant", () => {
  assert.equal(
    getNextUsageMonitorLastBankedGrantAt(state(1), snapshot(2)),
    OBSERVED_AT,
  );
});

test("an unavailable previous count does not become a grant on a positive count", () => {
  assert.equal(getNextUsageMonitorLastBankedGrantAt(state(undefined), snapshot(1)), null);
});

test("a null previous count does not become a grant on a positive count", () => {
  assert.equal(getNextUsageMonitorLastBankedGrantAt(state(null), snapshot(1)), null);
});

test("an unavailable count preserves no prior grant timestamp", () => {
  assert.equal(getNextUsageMonitorLastBankedGrantAt(state(undefined, null), snapshot(1)), null);
});

test("an unavailable count preserves a trusted prior grant timestamp", () => {
  assert.equal(
    getNextUsageMonitorLastBankedGrantAt(state(undefined, TRUSTED_GRANT_AT), snapshot(1)),
    TRUSTED_GRANT_AT,
  );
});

test("the count-change marker cannot invent a grant without a numeric increase", () => {
  assert.equal(
    getNextUsageMonitorLastBankedGrantAt(
      state(undefined),
      snapshot(1, { bankedResetCountChange: true }),
    ),
    null,
  );
});

test("a count decrease without a trusted grant timestamp fails open for an unexpected recovery", () => {
  const decision = evaluateCodexUsageRecovery(
    snapshot(1, { observedAt: "2026-08-26T01:10:00.000Z", resetsAt: 1_788_000_000 }),
    snapshot(0, { usedPercent: 0 }),
    { lastBankedGrantAt: null },
  );

  assert.equal(decision.kind, "recovery");
  assert.equal(decision.isPersonalReset, false);
});

test("a clear 1 to 0 decrease within the trusted window keeps personal-reset suppression", () => {
  const decision = evaluateCodexUsageRecovery(
    snapshot(1, { observedAt: "2026-08-26T01:10:00.000Z", resetsAt: 1_788_000_000 }),
    snapshot(0, { usedPercent: 0 }),
    { lastBankedGrantAt: TRUSTED_GRANT_AT },
  );

  assert.equal(decision.kind, "recovery");
  assert.equal(decision.isPersonalReset, true);
});

test("an execution estimate write error does not return an unsaved estimate", async () => {
  const databaseError = { code: "XX000", message: "estimate write failed" };
  let isWrite = false;
  const client = {
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.neq = () => builder;
      builder.overlaps = () => builder;
      builder.limit = () => builder;
      builder.upsert = () => {
        isWrite = true;
        return builder;
      };
      builder.update = () => {
        isWrite = true;
        return builder;
      };
      builder.maybeSingle = async () => ({
        data: null,
        error: isWrite ? databaseError : null,
      });
      return builder;
    },
  };

  const result = await upsertResetExecutionEstimate(client as never, {
    resetEventKey: "usage-reset-estimate-write-error",
    isMonitorObserved: true,
    usageObservation: {
      id: "recovery-estimate-write-error",
      sourceKey: "local-codex-app-server",
      observedAt: "2026-08-26T01:15:00.000Z",
      previousObservedAt: "2026-08-26T01:10:00.000Z",
      previousUsedPercent: 100,
      currentUsedPercent: 0,
      previousResetsAt: 1_788_000_000,
      currentResetsAt: 1_788_604_800,
      cycleHint: "unexpected",
      confidence: "strong",
      status: "observed",
      matchedTiboTweetId: null,
      confirmedAt: null,
      createdAt: "2026-08-26T01:15:00.000Z",
      updatedAt: "2026-08-26T01:15:00.000Z",
    },
    tiboSourceTweetIds: [],
  });

  assert.equal(result.estimate, null);
  assert.deepEqual(result.error, databaseError);
});

test("a recovery CAS loser rejects confirmation claimed by an unrelated Tibo post", async () => {
  const observed = {
    id: "recovery-cas",
    source_key: "local-codex-app-server",
    observed_at: OBSERVED_AT,
    previous_observed_at: "2026-08-26T01:10:00.000Z",
    previous_used_percent: 100,
    current_used_percent: 0,
    previous_resets_at: 1_788_000_000,
    current_resets_at: 1_788_604_800,
    cycle_hint: "unexpected",
    confidence: "strong",
    status: "observed",
    matched_tibo_tweet_id: null,
    confirmed_at: null,
    created_at: OBSERVED_AT,
    updated_at: OBSERVED_AT,
  };
  const confirmedForOtherPost = {
    ...observed,
    status: "confirmed",
    matched_tibo_tweet_id: "unrelated-tweet",
    confirmed_at: "2026-08-26T01:16:00.000Z",
  };
  let fromCalls = 0;
  const client = {
    from() {
      fromCalls += 1;
      const call = fromCalls;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = () => builder;
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.update = () => builder;
      builder.maybeSingle = async () => ({
        data: call === 2 ? null : confirmedForOtherPost,
        error: null,
      });
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve({
        data: [observed],
        error: null,
      }).then(resolve, reject);
      return builder;
    },
  };

  const result = await confirmNearestCodexRecoveryObservation(
    client as never,
    "current-tweet",
    OBSERVED_AT,
    90 * 60 * 1000,
    "2026-08-26T01:16:00.000Z",
    ["current-tweet"],
  );

  assert.equal(result.matched, false);
  assert.match(String(result.error), /CAS race/);
  assert.equal(result.observation, null);
});

test("does not match an already-confirmed observation for an unrelated tweet by time alone", async () => {
  const confirmedForOtherPost = {
    id: "recovery-confirmed",
    source_key: "local-codex-app-server",
    observed_at: OBSERVED_AT,
    previous_observed_at: "2026-08-26T01:10:00.000Z",
    previous_used_percent: 100,
    current_used_percent: 0,
    previous_resets_at: 1_788_000_000,
    current_resets_at: 1_788_604_800,
    cycle_hint: "unexpected",
    confidence: "strong",
    status: "confirmed",
    matched_tibo_tweet_id: "unrelated-tweet",
    confirmed_at: "2026-08-26T01:16:00.000Z",
    created_at: OBSERVED_AT,
    updated_at: "2026-08-26T01:16:00.000Z",
  };
  let fromCalls = 0;
  const client = {
    from() {
      fromCalls += 1;
      const call = fromCalls;
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = () => builder;
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve({
        data: call === 1 ? [] : [confirmedForOtherPost],
        error: null,
      }).then(resolve, reject);
      return builder;
    },
  };

  const result = await confirmNearestCodexRecoveryObservation(
    client as never,
    "current-tweet",
    OBSERVED_AT,
    90 * 60 * 1000,
    "2026-08-26T01:16:00.000Z",
    ["current-tweet"],
  );

  assert.equal(result.matched, false);
  assert.equal(result.observation, null);
  assert.equal(result.error, null);
});

test("keeps the first confirmed tweet id when a later edit uses the same recovery observation", async () => {
  const observed = {
    id: "recovery-first-writer",
    source_key: "local-codex-app-server",
    observed_at: OBSERVED_AT,
    previous_observed_at: "2026-08-26T01:10:00.000Z",
    previous_used_percent: 100,
    current_used_percent: 0,
    previous_resets_at: 1_788_000_000,
    current_resets_at: 1_788_604_800,
    cycle_hint: "unexpected",
    confidence: "strong",
    status: "observed",
    matched_tibo_tweet_id: null,
    confirmed_at: null,
    created_at: OBSERVED_AT,
    updated_at: OBSERVED_AT,
  };
  const confirmedByA = {
    ...observed,
    status: "confirmed",
    matched_tibo_tweet_id: "tweet-A",
    confirmed_at: "2026-08-26T01:16:00.000Z",
  };
  let fromCalls = 0;
  const client = {
    from() {
      fromCalls += 1;
      const call = fromCalls;
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = () => builder;
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.update = () => builder;
      builder.maybeSingle = async () => ({
        data: call === 2 ? confirmedByA : null,
        error: null,
      });
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve({
        data: call === 1 ? [observed] : call === 3 ? [] : [confirmedByA],
        error: null,
      }).then(resolve, reject);
      return builder;
    },
  };

  const first = await confirmNearestCodexRecoveryObservation(
    client as never,
    "tweet-A",
    OBSERVED_AT,
    90 * 60 * 1000,
    "2026-08-26T01:16:00.000Z",
    ["tweet-A"],
  );
  const second = await confirmNearestCodexRecoveryObservation(
    client as never,
    "tweet-B",
    OBSERVED_AT,
    90 * 60 * 1000,
    "2026-08-26T01:17:00.000Z",
    ["tweet-A", "tweet-B"],
  );

  assert.equal(first.matched, true);
  assert.equal(first.observation?.matchedTiboTweetId, "tweet-A");
  assert.equal(second.matched, true);
  assert.equal(second.observation?.matchedTiboTweetId, "tweet-A");
});

test("an existing execution estimate keeps its event and primary provenance during edit retry", async () => {
  const existingEstimate = {
    id: "estimate-existing",
    reset_event_key: "tibo-reset-A",
    display_execution_at: "2026-08-31T00:10:00.000Z",
    execution_time_source: "usage_observation",
    execution_time_confidence: "high",
    execution_time_precision: "approximate",
    execution_window_start_at: "2026-08-31T00:09:00.000Z",
    execution_window_end_at: "2026-08-31T00:10:00.000Z",
    recovery_observation_id: "recovery-existing",
    recovery_previous_observed_at: "2026-08-31T00:09:00.000Z",
    recovery_observed_at: "2026-08-31T00:10:00.000Z",
    tibo_announced_at: "2026-08-30T00:00:00.000Z",
    tibo_primary_tweet_id: "tweet-A",
    tibo_source_tweet_ids: ["tweet-A", "notice-old"],
    official_notice_tweet_id: "notice-old",
    official_notice_at: "2026-08-30T00:00:01.000Z",
    estimator_version: "usage-execution-v1",
    manual_override_at: null,
    manual_override_by: null,
    manual_override_reason: null,
    manual_execution_at: null,
    manual_execution_precision: null,
    created_at: "2026-08-31T00:10:00.000Z",
    updated_at: "2026-08-31T00:10:00.000Z",
  };
  let fromCalls = 0;
  let updatePayload: Record<string, unknown> | null = null;
  const client = {
    from() {
      fromCalls += 1;
      const call = fromCalls;
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.neq = () => builder;
      builder.overlaps = () => builder;
      builder.limit = () => builder;
      builder.update = (values: Record<string, unknown>) => {
        updatePayload = values;
        return builder;
      };
      builder.maybeSingle = async () => {
        if (call === 3) return { data: existingEstimate, error: null };
        if (call === 4) return { data: { ...existingEstimate, ...updatePayload }, error: null };
        return { data: null, error: null };
      };
      return builder;
    },
  };

  const result = await upsertResetExecutionEstimate(client as never, {
    resetEventKey: "tibo-reset-B",
    tiboAnnouncedAt: "2026-08-31T00:01:00.000Z",
    tiboPrimaryTweetId: "tweet-B",
    tiboSourceTweetIds: ["tweet-A", "tweet-B"],
    officialNoticeTweetId: "notice-new",
    officialNoticeAt: "2026-08-31T00:01:01.000Z",
    usageObservation: {
      id: "recovery-existing",
      sourceKey: "local-codex-app-server",
      observedAt: "2026-08-31T00:10:00.000Z",
      previousObservedAt: "2026-08-31T00:09:00.000Z",
      previousUsedPercent: 100,
      currentUsedPercent: 0,
      previousResetsAt: 1_788_000_000,
      currentResetsAt: 1_788_604_800,
      cycleHint: "unexpected",
      confidence: "strong",
      status: "confirmed",
      matchedTiboTweetId: "tweet-A",
      confirmedAt: "2026-08-31T00:11:00.000Z",
      createdAt: "2026-08-31T00:10:00.000Z",
      updatedAt: "2026-08-31T00:11:00.000Z",
    },
  });

  assert.equal(result.error, null);
  const persistedEstimate = result.estimate as ResetExecutionEstimate | null;
  assert.equal(persistedEstimate?.resetEventKey, "tibo-reset-A");
  assert.equal(persistedEstimate?.tiboPrimaryTweetId, "tweet-A");
  assert.equal(persistedEstimate?.recoveryObservationId, "recovery-existing");
  assert.equal(persistedEstimate?.displayExecutionAt, "2026-08-31T00:10:00.000Z");
  assert.equal(persistedEstimate?.tiboAnnouncedAt, "2026-08-30T00:00:00.000Z");
  assert.equal(persistedEstimate?.officialNoticeTweetId, "notice-old");
  assert.equal(persistedEstimate?.officialNoticeAt, "2026-08-30T00:00:01.000Z");
  assert.deepEqual(persistedEstimate?.tiboSourceTweetIds, ["tweet-A", "tweet-B", "notice-old"]);
  const persistedUpdatePayload = updatePayload as Record<string, unknown> | null;
  assert.equal(persistedUpdatePayload?.reset_event_key, "tibo-reset-A");
  assert.equal(persistedUpdatePayload?.tibo_primary_tweet_id, "tweet-A");
  assert.equal(persistedUpdatePayload?.recovery_observation_id, "recovery-existing");
  assert.equal(persistedUpdatePayload?.display_execution_at, "2026-08-31T00:10:00.000Z");
  assert.equal(persistedUpdatePayload?.official_notice_tweet_id, "notice-old");
  assert.deepEqual(persistedUpdatePayload?.tibo_source_tweet_ids, ["tweet-A", "tweet-B", "notice-old"]);
});

test("a successful current cluster replaces stale notice provenance without changing monitor timing", async () => {
  const existingEstimate = {
    id: "estimate-current-reset",
    reset_event_key: "tibo-reset-current-reset",
    display_execution_at: "2026-10-20T06:34:03.741Z",
    execution_time_source: "usage_observation",
    execution_time_confidence: "high",
    execution_time_precision: "approximate",
    execution_window_start_at: "2026-10-20T06:32:03.403Z",
    execution_window_end_at: "2026-10-20T06:34:03.741Z",
    recovery_observation_id: "observation-current-reset",
    recovery_previous_observed_at: "2026-10-20T06:32:03.403Z",
    recovery_observed_at: "2026-10-20T06:34:03.741Z",
    tibo_announced_at: "2026-10-17T16:20:57.000Z",
    tibo_primary_tweet_id: "old-notice",
    tibo_source_tweet_ids: ["old-notice", "current-reset"],
    official_notice_tweet_id: "old-notice",
    official_notice_at: "2026-10-17T16:20:57.000Z",
    estimator_version: "usage-execution-monitor-v1",
    manual_override_at: null,
    manual_override_by: null,
    manual_override_reason: null,
    manual_execution_at: null,
    manual_execution_precision: null,
    created_at: "2026-10-20T06:34:03.741Z",
    updated_at: "2026-10-20T06:34:03.741Z",
  };
  let fromCalls = 0;
  let updatePayload: Record<string, unknown> | null = null;
  const client = {
    from() {
      fromCalls += 1;
      const call = fromCalls;
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.update = (values: Record<string, unknown>) => {
        updatePayload = values;
        return builder;
      };
      builder.maybeSingle = async () => call === 1
        ? { data: existingEstimate, error: null }
        : { data: { ...existingEstimate, ...updatePayload }, error: null };
      return builder;
    },
  };

  const result = await upsertResetExecutionEstimate(client as never, {
    resetEventKey: "tibo-reset-current-reset",
    tiboProvenanceResolved: true,
    tiboAnnouncedAt: "2026-10-20T06:33:48.000Z",
    tiboPrimaryTweetId: "current-reset",
    tiboSourceTweetIds: ["current-reset"],
    officialNoticeTweetId: null,
    officialNoticeAt: null,
    usageObservation: {
      id: "observation-current-reset",
      sourceKey: "local-codex-app-server",
      observedAt: "2026-10-20T06:34:03.741Z",
      previousObservedAt: "2026-10-20T06:32:03.403Z",
      previousUsedPercent: 97,
      currentUsedPercent: 0,
      previousResetsAt: 1_792_468_800,
      currentResetsAt: 1_793_073_600,
      cycleHint: "unexpected",
      confidence: "strong",
      status: "confirmed",
      matchedTiboTweetId: "current-reset",
      confirmedAt: "2026-10-20T06:36:06.139Z",
      createdAt: "2026-10-20T06:34:03.741Z",
      updatedAt: "2026-10-20T06:36:06.139Z",
    },
  });

  assert.equal(result.error, null);
  assert.equal(result.estimate?.resetEventKey, "tibo-reset-current-reset");
  assert.equal(result.estimate?.displayExecutionAt, "2026-10-20T06:34:03.741Z");
  assert.equal(result.estimate?.executionWindowStartAt, "2026-10-20T06:32:03.403Z");
  assert.equal(result.estimate?.executionWindowEndAt, "2026-10-20T06:34:03.741Z");
  assert.equal(result.estimate?.recoveryObservationId, "observation-current-reset");
  assert.equal(result.estimate?.tiboAnnouncedAt, "2026-10-20T06:33:48.000Z");
  assert.equal(result.estimate?.tiboPrimaryTweetId, "current-reset");
  assert.deepEqual(result.estimate?.tiboSourceTweetIds, ["current-reset"]);
  assert.equal(result.estimate?.officialNoticeTweetId, null);
  assert.equal(result.estimate?.officialNoticeAt, null);
  const persistedUpdatePayload = updatePayload as Record<string, unknown> | null;
  assert.deepEqual(persistedUpdatePayload?.tibo_source_tweet_ids, ["current-reset"]);
  assert.equal(persistedUpdatePayload?.official_notice_tweet_id, null);
  assert.equal(persistedUpdatePayload?.official_notice_at, null);
});

test("findLatestBankedGrant includes the legacy Production BANKED estimator version", async () => {
  let estimatorVersions: string[] = [];
  const client = {
    from(table: string) {
      assert.equal(table, "reset_execution_estimates");
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.in = (column: string, values: string[]) => {
        assert.equal(column, "estimator_version");
        estimatorVersions = values;
        return builder;
      };
      builder.lte = () => builder;
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.maybeSingle = async () => ({
        data: {
          reset_event_key: "banked-reset-legacy-production",
          display_execution_at: "2026-09-04T03:34:46.386Z",
          created_at: "2026-09-04T03:34:46.386Z",
        },
        error: null,
      });
      return builder;
    },
  };

  const result = await findLatestBankedGrant(
    client as never,
    "2026-09-05T03:34:46.386Z",
  );

  assert.deepEqual(estimatorVersions, [
    "banked-distribution-observation-v2",
    "usage-execution-banked-v1",
  ]);
  assert.deepEqual(result, {
    resetEventKey: "banked-reset-legacy-production",
    observedAt: "2026-09-04T03:34:46.386Z",
  });
});

test("findBankedEstimateByExactObservation only reuses one kind-compatible exact-time BANKED key", async () => {
  const calls: Array<[string, unknown]> = [];
  const client = {
    from(table: string) {
      assert.equal(table, "reset_execution_estimates");
      const builder: Record<string, any> = {};
      builder.select = (columns: string) => { calls.push(["select", columns]); return builder; };
      builder.in = (column: string, values: string[]) => { calls.push(["in", [column, values]]); return builder; };
      builder.eq = (column: string, value: string) => { calls.push(["eq", [column, value]]); return builder; };
      builder.limit = async (count: number) => {
        calls.push(["limit", count]);
        return {
          data: [{
            reset_event_key: "banked-reset-legacy-exact",
            estimator_version: "usage-execution-banked-v1",
            recovery_observation_id: null,
            execution_time_source: "usage_observation",
            execution_time_precision: "approximate",
            manual_override_at: null,
            manual_execution_at: null,
          }],
          error: null,
        };
      };
      return builder;
    },
  };
  const observedAt = "2026-10-07T23:12:28.952Z";
  const result = await findBankedEstimateByExactObservation(client as never, observedAt);

  assert.deepEqual(result, {
    estimate: {
      resetEventKey: "banked-reset-legacy-exact",
      estimatorVersion: "usage-execution-banked-v1",
    },
    error: null,
  });
  assert.deepEqual(calls.find(([name]) => name === "eq")?.[1], ["display_execution_at", observedAt]);
});

test("readResetExecutionEstimates gates current and legacy BANKED rows linked by exact legacy identity", async () => {
  const requestedKeys: string[] = [];
  const rows = [
    estimateRow("current-published", "banked-current", "banked-distribution-observation-v2"),
    estimateRow("legacy-linked-pending", "banked-legacy-exact", "usage-execution-banked-v1"),
    estimateRow("legacy-unrelated", "old-verified-banked", "usage-execution-banked-v1"),
  ];
  const client = {
    from(table: string) {
      assert.equal(table, "reset_execution_estimates");
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.order = () => builder;
      builder.limit = async () => ({ data: rows, error: null });
      return builder;
    },
    async rpc(name: string, args: { p_reset_event_keys: string[] }) {
      assert.equal(name, "read_banked_reset_publication_state");
      requestedKeys.push(...args.p_reset_event_keys);
      return {
        data: [
          { reset_event_key: "banked-current", published: true },
          { reset_event_key: "banked-legacy-exact", published: false },
        ],
        error: null,
      };
    },
  };

  const result = await readResetExecutionEstimates(client as never);
  assert.deepEqual(requestedKeys, ["banked-current", "banked-legacy-exact", "old-verified-banked"]);
  assert.deepEqual(result.rows.map((row) => row.resetEventKey), ["banked-current", "old-verified-banked"]);
  assert.equal(result.error, null);
});

test("publication-state fallback resolves current and legacy keys without hiding unrelated old BANKED history", async () => {
  const estimates = [
    estimateRow("legacy-linked", "banked-legacy-exact", "usage-execution-banked-v1"),
    estimateRow("legacy-unrelated", "old-verified-banked", "usage-execution-banked-v1"),
  ];
  const tableCalls: string[] = [];
  let fallbackFilter = "";
  const client = {
    from(table: string) {
      tableCalls.push(table);
      const filters: Record<string, unknown> = {};
      const builder: Record<string, any> = {};
      for (const method of ["select", "order", "limit", "eq"]) {
        builder[method] = (...args: unknown[]) => {
          if (method === "eq") filters[String(args[0])] = args[1];
          return builder;
        };
      }
      builder.or = (value: string) => { fallbackFilter = value; return builder; };
      builder.in = (column: string, values: string[]) => { filters[column] = values; return builder; };
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        const data = table === "reset_execution_estimates"
          ? estimates
          : table === "codex_banked_grant_observations"
            ? [{ id: "observation-1", reset_event_key: "new-fact-key", legacy_reset_event_key: "banked-legacy-exact" }]
            : [{ observation_id: "observation-1", status: "pending", publication_status: "withheld", is_current: true }];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return builder;
    },
    async rpc() {
      return { data: null, error: { message: "rpc unavailable" } };
    },
  };

  const result = await readResetExecutionEstimates(client as never);
  assert.match(fallbackFilter, /reset_event_key\.in\./);
  assert.match(fallbackFilter, /legacy_reset_event_key\.in\./);
  assert.deepEqual(tableCalls, [
    "reset_execution_estimates",
    "codex_banked_grant_observations",
    "codex_banked_post_association_decisions",
  ]);
  assert.deepEqual(result.rows.map((row) => row.resetEventKey), ["old-verified-banked"]);
  assert.ok(result.error);
});

function estimateRow(id: string, resetEventKey: string, estimatorVersion: string) {
  return {
    id,
    reset_event_key: resetEventKey,
    display_execution_at: "2026-10-07T23:12:28.952Z",
    execution_time_source: "usage_observation",
    execution_time_confidence: "high",
    execution_time_precision: "approximate",
    execution_window_start_at: null,
    execution_window_end_at: null,
    recovery_observation_id: null,
    recovery_previous_observed_at: null,
    recovery_observed_at: null,
    tibo_announced_at: null,
    tibo_primary_tweet_id: null,
    tibo_source_tweet_ids: [],
    official_notice_tweet_id: null,
    official_notice_at: null,
    estimator_version: estimatorVersion,
    manual_override_at: null,
    manual_override_by: null,
    manual_override_reason: null,
    manual_execution_at: null,
    manual_execution_precision: null,
    created_at: "2026-10-07T23:12:28.952Z",
    updated_at: "2026-10-07T23:12:28.952Z",
  };
}

test("does not reuse an exact-time manual BANKED estimate as monitor-observation identity", async () => {
  const client = {
    from() {
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.in = () => builder;
      builder.eq = () => builder;
      builder.limit = async () => ({
        data: [{
          reset_event_key: "manual-banked-event",
          estimator_version: "banked-distribution-observation-v2",
          recovery_observation_id: null,
          execution_time_source: "manual_correction",
          execution_time_precision: "approximate",
          manual_override_at: "2026-10-01T00:00:00.000Z",
          manual_execution_at: "2026-10-07T23:12:28.952Z",
        }],
        error: null,
      });
      return builder;
    },
  };

  const result = await findBankedEstimateByExactObservation(client as never, "2026-10-07T23:12:28.952Z");
  assert.equal(result.estimate, null);
  assert.ok(result.error);
});

test("findRecentFormalTiboReset skips rows with manual classification source", async () => {
  const client = {
    from() {
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.or = () => builder;
      builder.eq = () => builder;
      builder.neq = () => builder;
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.order = () => builder;
      builder.limit = async () => ({
        data: [{
          tweet_id: "manual-irrelevant-tweet",
          text: "I have reset usage limits for everyone.",
          tweet_created_at: OBSERVED_AT,
          signal_type: "irrelevant",
          confidence: 0.99,
          verification_status: "confirmed",
          classification_source: "manual",
          ai_signal_type: "reset_executed",
          ai_confidence: 0.99,
          rule_signal_type: "reset_executed",
          rule_confidence: 0.99,
          is_reply: false,
        }],
        error: null,
      });
      return builder;
    },
  };

  const result = await findRecentFormalTiboReset(client as never, OBSERVED_AT, 60_000);
  assert.equal(result.tweetId, null);
  assert.equal(result.needsPromotion, false);
});

test("findRecentFormalTiboReset retains a current v3 reply proof through the SELECT projection", async () => {
  const tweetId = "2115000000000000951";
  const tweetCreatedAt = "2026-10-20T10:00:00.000Z";
  const reply = formalReplySignal(tweetId, tweetCreatedAt, "2115000000000000950");

  const result = await findRecentFormalTiboReset(
    projectedTiboSignalsClient([reply]) as never,
    tweetCreatedAt,
    60_000,
  );

  assert.equal(result.tweetId, tweetId);
});

test("findFormalTiboResetCluster keeps a current v3 reply as the reset anchor through the SELECT projection", async () => {
  const tweetId = "2115000000000000961";
  const tweetCreatedAt = "2026-10-20T10:00:00.000Z";
  const reply = formalReplySignal(tweetId, tweetCreatedAt, "2115000000000000960");

  const result = await findFormalTiboResetCluster(
    projectedTiboSignalsClient([reply]) as never,
    "cluster-fallback-id",
    tweetCreatedAt,
  );

  assert.equal(result.primaryTweetId, tweetId);
});

test("findFormalTiboResetCluster uses a prior formal reply generation as the notice boundary", async () => {
  const currentResetAt = "2026-10-20T10:00:00.000Z";
  const previousResetAt = "2026-10-20T09:00:00.000Z";
  const currentReset = {
    tweet_id: "2115000000000000971",
    text: "I reset usage limits for everyone.",
    tweet_url: "https://x.com/thsottiaux/status/2115000000000000971",
    tweet_created_at: currentResetAt,
    signal_type: "reset_executed",
    confidence: 0.99,
    verification_status: "confirmed",
    classification_source: "gemini",
    is_reply: false,
    is_quote: false,
  };
  const previousReply = formalReplySignal(
    "2115000000000000972",
    previousResetAt,
    "2115000000000000973",
  );
  const notice = {
    ...unscheduledOfficialNotice("2115000000000000974", "2026-10-20T08:45:00.000Z"),
    confidence: 0.95,
  };

  const result = await findFormalTiboResetCluster(
    projectedTiboSignalsClient([currentReset, previousReply, notice]) as never,
    currentReset.tweet_id,
    currentResetAt,
  );

  assert.equal(result.representativeNoticeId, null);
  assert.equal(result.announcedAt, currentResetAt);
});

test("findFormalTiboResetCluster associates an accepted .85 unresolved Gemini official notice", async () => {
  const currentResetAt = "2026-10-20T10:00:00.000Z";
  const currentReset = {
    tweet_id: "2115000000000000981",
    text: "I reset usage limits for everyone.",
    tweet_url: "https://x.com/thsottiaux/status/2115000000000000981",
    tweet_created_at: currentResetAt,
    signal_type: "reset_executed",
    confidence: 0.99,
    verification_status: "confirmed",
    classification_source: "gemini",
    is_reply: false,
    is_quote: false,
  };
  const notice = unscheduledOfficialNotice("2115000000000000982", "2026-10-20T09:30:00.000Z");

  const result = await findFormalTiboResetCluster(
    projectedTiboSignalsClient([currentReset, notice]) as never,
    currentReset.tweet_id,
    currentResetAt,
  );

  assert.equal(result.representativeNoticeId, notice.tweet_id);
  assert.equal(result.representativeNoticeAt, notice.tweet_created_at);
});

test("findRecentFormalTiboReset excludes legacy rows with unknown reply state", async () => {
  const client = {
    from() {
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.or = () => builder;
      builder.neq = () => builder;
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.order = () => builder;
      builder.limit = async () => ({
        data: [{
          tweet_id: "unknown-reply-state",
          text: "I have reset usage limits for everyone.",
          tweet_created_at: OBSERVED_AT,
          signal_type: "reset_executed",
          confidence: 0.99,
          verification_status: "confirmed",
          classification_source: "gemini",
          is_reply: null,
        }],
        error: null,
      });
      return builder;
    },
  };

  const result = await findRecentFormalTiboReset(client as never, OBSERVED_AT, 60_000);
  assert.equal(result.tweetId, null);
});

test("findRecentFormalTiboReset preserves a trusted edit identity for monitor promotion", async () => {
  const rootId = "2112432076767289678";
  const editId = "2112432076767289679";
  const client = {
    from() {
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.or = () => builder;
      builder.eq = () => builder;
      builder.neq = () => builder;
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.order = () => builder;
      builder.limit = async () => ({
        data: [{
          tweet_id: editId,
          text: "Reset all propagated. Enjoy.",
          tweet_created_at: OBSERVED_AT,
          signal_type: "irrelevant",
          confidence: 0.99,
          verification_status: "auto_unverified",
          classification_source: "gemini",
          ai_signal_type: "reset_executed",
          ai_confidence: 0.99,
          rule_signal_type: null,
          rule_confidence: null,
          is_reply: false,
          logical_post_id: rootId,
          edit_history_tweet_ids: [rootId, editId],
          edit_version: 2,
          edit_metadata_source: "x_api",
        }],
        error: null,
      });
      return builder;
    },
  };

  const result = await findRecentFormalTiboReset(client as never, OBSERVED_AT, 60_000);

  assert.equal(result.tweetId, editId);
  assert.equal(result.needsPromotion, true);
  assert.deepEqual(result.trustedEditIdentity, {
    logical_post_id: rootId,
    edit_history_tweet_ids: [rootId, editId],
    edit_version: 2,
    edit_metadata_source: "x_api",
  });
});

test("findRecentFormalTiboReset skips rows failing context safety guard", async () => {
  const client = {
    from() {
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.or = () => builder;
      builder.eq = () => builder;
      builder.neq = () => builder;
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.order = () => builder;
      builder.limit = async () => ({
        data: [{
          tweet_id: "receipt-context-tweet",
          text: "I received this new special item package today.",
          tweet_created_at: OBSERVED_AT,
          signal_type: "reset_executed",
          confidence: 0.99,
          verification_status: "confirmed",
          classification_source: "gemini",
          ai_signal_type: "reset_executed",
          ai_confidence: 0.99,
          rule_signal_type: "reset_executed",
          rule_confidence: 0.99,
          is_reply: false,
        }],
        error: null,
      });
      return builder;
    },
  };

  const result = await findRecentFormalTiboReset(client as never, OBSERVED_AT, 60_000);
  assert.equal(result.tweetId, null);
});

test("upsertResetExecutionEstimate and upsertBankedDistributionEstimate filter overlaps query by estimator_version", async () => {
  const filters: Array<{ method: string; column: string; value: unknown }> = [];
  const client = {
    from() {
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        filters.push({ method: "eq", column, value });
        return builder;
      };
      builder.neq = (column: string, value: unknown) => {
        filters.push({ method: "neq", column, value });
        return builder;
      };
      builder.overlaps = (column: string, value: unknown) => {
        filters.push({ method: "overlaps", column, value });
        return builder;
      };
      builder.limit = () => builder;
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.upsert = () => builder;
      return builder;
    },
  };

  filters.length = 0;
  await upsertResetExecutionEstimate(client as never, {
    resetEventKey: "forced-event-key",
    tiboPrimaryTweetId: "reset-123",
    tiboSourceTweetIds: ["notice-123", "reset-123"],
    isMonitorObserved: true,
    usageObservation: {
      id: "obs-1",
      sourceKey: "local-codex-app-server",
      observedAt: OBSERVED_AT,
      previousObservedAt: "2026-08-26T01:10:00.000Z",
      previousUsedPercent: 100,
      currentUsedPercent: 0,
      previousResetsAt: 1_788_000_000,
      currentResetsAt: 1_788_604_800,
      cycleHint: "unexpected",
      confidence: "strong",
      status: "observed",
    },
  });

  const forcedNeqFilter = filters.find(
    (f) => f.method === "neq" && f.column === "estimator_version" && f.value === "banked-distribution-observation-v2",
  );
  assert.ok(forcedNeqFilter, "upsertResetExecutionEstimate must filter neq banked-distribution-observation-v2");
  assert.deepEqual(
    filters.find((f) => f.method === "overlaps" && f.column === "tibo_source_tweet_ids")?.value,
    ["reset-123"],
    "estimate identity lookup must not match by an official notice ID",
  );

  filters.length = 0;
  await upsertBankedDistributionEstimate(client as never, {
    resetEventKey: "banked-event-key",
    displayExecutionAt: OBSERVED_AT,
    tiboAnnouncedAt: OBSERVED_AT,
    tiboPrimaryTweetId: "notice-123",
    tiboSourceTweetIds: ["notice-123"],
    officialNoticeTweetId: "notice-123",
    officialNoticeAt: OBSERVED_AT,
  });

  const bankedEqFilter = filters.find(
    (f) => f.method === "eq" && f.column === "estimator_version" && f.value === "banked-distribution-observation-v2",
  );
  assert.ok(bankedEqFilter, "upsertBankedDistributionEstimate must filter eq banked-distribution-observation-v2");
});

test("findFormalTiboResetCluster queries notice candidates with a 72-hour lookback window", async () => {
  const gteCalls: Array<{ column: string; value: string }> = [];
  const inCalls: Array<{ column: string; values: string[] }> = [];

  const tweetCreatedAt = "2026-08-26T12:00:00.000Z";
  const expectedLookbackGte = new Date(Date.parse(tweetCreatedAt) - 72 * 60 * 60 * 1000).toISOString();

  const client = {
    from() {
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.neq = () => builder;
      builder.in = (column: string, values: string[]) => {
        inCalls.push({ column, values });
        return builder;
      };
      builder.gte = (column: string, value: string) => {
        gteCalls.push({ column, value });
        return builder;
      };
      builder.lte = () => builder;
      builder.lt = () => builder;
      builder.order = () => builder;
      builder.limit = async () => ({
        data: [
          {
            tweet_id: "notice-within-72h",
            text: "Usage limits will reset soon.",
            tweet_url: "https://x.com/thsottiaux/status/notice-within-72h",
            tweet_created_at: "2026-08-24T12:00:00.000Z",
            signal_type: "official_notice",
            confidence: 0.95,
            verification_status: "auto_unverified",
            is_reply: false,
            expires_at: null,
          },
        ],
        error: null,
      });
      return builder;
    },
  };

  const cluster = await findFormalTiboResetCluster(client as never, "reset-tweet-1", tweetCreatedAt);

  const noticeGte = gteCalls.find(
    (call) => call.column === "tweet_created_at" && call.value === expectedLookbackGte,
  );
  assert.ok(noticeGte, "Notice query must query tweet_created_at gte exactly 72 hours prior");
  assert.equal(noticeGte.value, "2026-08-23T12:00:00.000Z");
  assert.equal(cluster.representativeNoticeId, "notice-within-72h");
  assert.ok(cluster.sourceTweetIds.includes("notice-within-72h"));
});

test("findFormalTiboResetCluster excludes notices consumed by the previous formal reset", async () => {
  const currentResetAt = "2026-10-20T06:33:48.000Z";
  const previousResetAt = "2026-10-17T17:00:00.000Z";
  const oldNoticeAt = "2026-10-17T16:20:00.000Z";
  const queries: Array<{
    signalTypes: string[];
    lower?: string;
    upper?: string;
    upperOperator?: "lt" | "lte";
  }> = [];

  const client = {
    from(table: string) {
      assert.equal(table, "tibo_signals");
      const query = {
        signalTypes: [] as string[],
        lower: undefined as string | undefined,
        upper: undefined as string | undefined,
        upperOperator: undefined as "lt" | "lte" | undefined,
      };
      queries.push(query);
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: string) => {
        if (column === "signal_type") query.signalTypes = [value];
        return builder;
      };
      builder.neq = () => builder;
      builder.in = (column: string, values: string[]) => {
        if (column === "signal_type") query.signalTypes = values;
        return builder;
      };
      builder.gte = (_column: string, value: string) => {
        query.lower = value;
        return builder;
      };
      builder.lt = (_column: string, value: string) => {
        query.upper = value;
        query.upperOperator = "lt";
        return builder;
      };
      builder.lte = (_column: string, value: string) => {
        query.upper = value;
        query.upperOperator = "lte";
        return builder;
      };
      builder.order = () => builder;
      builder.limit = async () => {
        if (query.signalTypes.includes("official_notice")) {
          return {
            data: [{
              tweet_id: "day-13-notice",
              text: "Usage limits reset soon.",
              tweet_url: "https://x.com/thsottiaux/status/day-13-notice",
              tweet_created_at: oldNoticeAt,
              signal_type: "official_notice",
              confidence: 0.98,
              verification_status: "confirmed",
              is_reply: false,
              expires_at: null,
            }],
            error: null,
          };
        }
        if (query.signalTypes.includes("reset_executed") && query.upperOperator === "lte") {
          return {
            data: [{
              tweet_id: "day-15-reset",
              tweet_created_at: currentResetAt,
              signal_type: "reset_executed",
              confidence: 0.99,
              verification_status: "confirmed",
              is_reply: false,
            }],
            error: null,
          };
        }
        return {
          data: [{
            tweet_id: "day-13-reset",
            text: "Day 13/ Reset all propagated. Enjoy.",
            tweet_url: "https://x.com/thsottiaux/status/day-13-reset",
            tweet_created_at: previousResetAt,
            signal_type: "reset_executed",
            confidence: 0.99,
            verification_status: "confirmed",
            classification_source: "rule",
            is_reply: false,
          }],
          error: null,
        };
      };
      return builder;
    },
  };

  const cluster = await findFormalTiboResetCluster(
    client as never,
    "day-15-reset",
    currentResetAt,
  );

  assert.equal(cluster.error, null);
  assert.equal(cluster.representativeNoticeId, null);
  assert.equal(cluster.representativeNoticeAt, null);
  assert.equal(cluster.announcedAt, currentResetAt);
  assert.deepEqual(cluster.sourceTweetIds, ["day-15-reset"]);
  assert.ok(queries.some((query) =>
    query.signalTypes.includes("reset_executed") &&
    query.upperOperator === "lt" &&
    query.upper === currentResetAt,
  ));
});

test("findFormalTiboResetCluster treats a trusted edit root as the current event anchor", async () => {
  const rootId = "2112432076767289678";
  const editId = "2112432076767289679";
  const noticeId = "2112432076767289670";
  const rootAt = "2026-10-20T06:33:48.000Z";
  const editAt = "2026-10-20T06:43:48.000Z";
  const noticeAt = "2026-10-20T06:00:00.000Z";
  const common = {
    text: "Reset all propagated. Enjoy.",
    signal_type: "reset_executed",
    confidence: 1,
    verification_status: "confirmed",
    classification_source: "gemini",
    is_reply: false,
    logical_post_id: rootId,
    edit_history_tweet_ids: [rootId, editId],
    edit_metadata_source: "x_api",
  };
  const root = {
    ...common,
    tweet_id: rootId,
    tweet_created_at: rootAt,
    tweet_url: `https://x.com/thsottiaux/status/${rootId}`,
    edit_version: 1,
  };
  const edit = {
    ...common,
    tweet_id: editId,
    tweet_created_at: editAt,
    tweet_url: `https://x.com/thsottiaux/status/${editId}`,
    edit_version: 2,
  };
  const notice = {
    tweet_id: noticeId,
    text: "Usage limits reset soon.",
    tweet_url: `https://x.com/thsottiaux/status/${noticeId}`,
    tweet_created_at: noticeAt,
    signal_type: "official_notice",
    confidence: 1,
    verification_status: "confirmed",
    is_reply: false,
    expires_at: "2026-10-21T06:00:00.000Z",
  };
  const client = {
    from() {
      let signalType = "";
      let upperOperator = "";
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: string) => {
        if (column === "signal_type") signalType = value;
        return builder;
      };
      builder.in = (column: string) => {
        if (column === "signal_type") signalType = "notices";
        return builder;
      };
      builder.neq = () => builder;
      builder.gte = () => builder;
      builder.lt = () => {
        upperOperator = "lt";
        return builder;
      };
      builder.lte = () => {
        upperOperator = "lte";
        return builder;
      };
      builder.order = () => builder;
      builder.limit = async () => ({
        data: signalType === "notices"
          ? [notice]
          : upperOperator === "lt"
            ? [root]
            : [edit],
        error: null,
      });
      return builder;
    },
  };

  const cluster = await findFormalTiboResetCluster(client as never, editId, editAt);

  assert.equal(cluster.error, null);
  assert.equal(cluster.primaryTweetId, rootId);
  assert.equal(cluster.representativeNoticeId, noticeId);
  assert.equal(cluster.representativeNoticeAt, noticeAt);
  assert.equal(cluster.announcedAt, noticeAt);
  assert.deepEqual(cluster.sourceTweetIds, [noticeId, rootId, editId]);
});

test("findFormalTiboResetCluster honors trusted edit metadata passed by monitor promotion", async () => {
  const rootId = "2112432076767289678";
  const editId = "2112432076767289679";
  const noticeId = "2112432076767289670";
  const rootAt = "2026-10-20T06:33:48.000Z";
  const editAt = "2026-10-20T06:43:48.000Z";
  const noticeAt = "2026-10-20T06:00:00.000Z";
  const common = {
    text: "Reset all propagated. Enjoy.",
    logical_post_id: rootId,
    edit_history_tweet_ids: [rootId, editId],
    edit_metadata_source: "x_api",
  };
  const root = {
    ...common,
    tweet_id: rootId,
    tweet_created_at: rootAt,
    tweet_url: `https://x.com/thsottiaux/status/${rootId}`,
    edit_version: 1,
    signal_type: "reset_executed",
    confidence: 1,
    verification_status: "confirmed",
    classification_source: "gemini",
    is_reply: false,
  };
  const edit = {
    ...common,
    tweet_id: editId,
    tweet_created_at: editAt,
    tweet_url: `https://x.com/thsottiaux/status/${editId}`,
    edit_version: 2,
    signal_type: "irrelevant",
    confidence: 0.99,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    ai_signal_type: "reset_executed",
    ai_confidence: 0.99,
    is_reply: false,
  };
  const notice = {
    tweet_id: noticeId,
    text: "Usage limits reset soon.",
    tweet_url: `https://x.com/thsottiaux/status/${noticeId}`,
    tweet_created_at: noticeAt,
    signal_type: "official_notice",
    confidence: 1,
    verification_status: "confirmed",
    is_reply: false,
    expires_at: "2026-10-21T06:00:00.000Z",
  };
  let queryIndex = 0;
  const client = {
    from() {
      const index = queryIndex++;
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.or = () => builder;
      builder.eq = () => builder;
      builder.neq = () => builder;
      builder.in = () => builder;
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.lt = () => builder;
      builder.order = () => builder;
      builder.limit = async () => ({
        data: index === 0
          ? [edit]
          : index === 1
            ? []
            : index === 2
              ? [root]
              : [notice],
        error: null,
      });
      return builder;
    },
  };

  const matching = await findRecentFormalTiboReset(client as never, editAt, 60_000);
  assert.equal(matching.tweetId, editId);
  assert.ok(matching.trustedEditIdentity);
  const cluster = await findFormalTiboResetCluster(
    client as never,
    editId,
    editAt,
    undefined,
    { tweet_id: editId, tweet_created_at: editAt, confidence: matching.confidence ?? 0.95 },
    matching.trustedEditIdentity,
  );

  assert.equal(cluster.error, null);
  assert.equal(cluster.primaryTweetId, rootId);
  assert.equal(cluster.representativeNoticeId, noticeId);
  assert.equal(cluster.announcedAt, noticeAt);
  assert.deepEqual(cluster.sourceTweetIds, [noticeId, rootId, editId]);
});

test("findFormalTiboResetCluster keeps an untrusted chain root as a previous reset", async () => {
  const rootId = "2112432076767289678";
  const editId = "2112432076767289679";
  const noticeId = "2112432076767289670";
  const rootAt = "2026-10-20T06:33:48.000Z";
  const editAt = "2026-10-20T06:43:48.000Z";
  const root = {
    tweet_id: rootId,
    tweet_created_at: rootAt,
    tweet_url: `https://x.com/thsottiaux/status/${rootId}`,
    text: "Reset all propagated. Enjoy.",
    signal_type: "reset_executed",
    confidence: 1,
    verification_status: "confirmed",
    classification_source: "gemini",
    is_reply: false,
    logical_post_id: rootId,
    edit_history_tweet_ids: [rootId, editId],
    edit_version: 1,
    edit_metadata_source: "none",
  };
  const edit = {
    ...root,
    tweet_id: editId,
    tweet_created_at: editAt,
    tweet_url: `https://x.com/thsottiaux/status/${editId}`,
    edit_version: 2,
  };
  const notice = {
    tweet_id: noticeId,
    text: "Usage limits reset soon.",
    tweet_url: `https://x.com/thsottiaux/status/${noticeId}`,
    tweet_created_at: "2026-10-20T06:00:00.000Z",
    signal_type: "official_notice",
    confidence: 1,
    verification_status: "confirmed",
    is_reply: false,
    expires_at: "2026-10-21T06:00:00.000Z",
  };
  const client = {
    from() {
      let signalType = "";
      let upperOperator = "";
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: string) => {
        if (column === "signal_type") signalType = value;
        return builder;
      };
      builder.in = (column: string) => {
        if (column === "signal_type") signalType = "notices";
        return builder;
      };
      builder.neq = () => builder;
      builder.gte = () => builder;
      builder.lt = () => {
        upperOperator = "lt";
        return builder;
      };
      builder.lte = () => {
        upperOperator = "lte";
        return builder;
      };
      builder.order = () => builder;
      builder.limit = async () => ({
        data: signalType === "notices"
          ? [notice]
          : upperOperator === "lt"
            ? [root]
            : [edit],
        error: null,
      });
      return builder;
    },
  };

  const cluster = await findFormalTiboResetCluster(client as never, editId, editAt);

  assert.equal(cluster.error, null);
  assert.equal(cluster.primaryTweetId, editId);
  assert.equal(cluster.representativeNoticeId, null);
  assert.deepEqual(cluster.sourceTweetIds, [editId]);
});

test("findFormalTiboResetCluster excludes an expired notice when no earlier completion was loaded", async () => {
  const currentResetAt = "2026-10-20T06:33:48.000Z";
  const queryCalls: Array<{ signalTypes: string[]; upperOperator?: "lt" | "lte" }> = [];
  const client = {
    from() {
      const query = { signalTypes: [] as string[], upperOperator: undefined as "lt" | "lte" | undefined };
      queryCalls.push(query);
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: string) => {
        if (column === "signal_type") query.signalTypes = [value];
        return builder;
      };
      builder.neq = () => builder;
      builder.in = (column: string, values: string[]) => {
        if (column === "signal_type") query.signalTypes = values;
        return builder;
      };
      builder.gte = () => builder;
      builder.lt = () => {
        query.upperOperator = "lt";
        return builder;
      };
      builder.lte = () => {
        query.upperOperator = "lte";
        return builder;
      };
      builder.order = () => builder;
      builder.limit = async () => {
        if (query.signalTypes.includes("official_notice")) {
          return {
            data: [{
              tweet_id: "2111492673890824348",
              text: "Day 13/ Le limit reset",
              tweet_url: "https://x.com/thsottiaux/status/2111492673890824348",
              tweet_created_at: "2026-10-17T16:20:57.000Z",
              signal_type: "official_notice",
              confidence: 1,
              verification_status: "confirmed",
              is_reply: false,
              expires_at: "2026-10-18T16:20:57.000Z",
              temporal_resolution_status: "unresolved",
            }],
            error: null,
          };
        }
        if (query.upperOperator === "lte") {
          return {
            data: [{
              tweet_id: "2112432076767289678",
              tweet_created_at: currentResetAt,
              signal_type: "reset_executed",
              confidence: 0.99,
              verification_status: "confirmed",
              is_reply: false,
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      };
      return builder;
    },
  };

  const cluster = await findFormalTiboResetCluster(
    client as never,
    "2112432076767289678",
    currentResetAt,
  );

  assert.equal(cluster.error, null);
  assert.equal(cluster.representativeNoticeId, null);
  assert.deepEqual(cluster.sourceTweetIds, ["2112432076767289678"]);
  assert.ok(queryCalls.some((query) => query.signalTypes.includes("reset_executed") && query.upperOperator === "lt"));
});

test("findFormalTiboResetCluster fails closed when the previous completion query fails", async () => {
  const currentResetAt = "2026-10-20T06:33:48.000Z";
  const previousQueryError = { code: "XX000", message: "previous reset lookup failed" };
  let resetQueryCount = 0;
  let noticeQueryCount = 0;
  const client = {
    from() {
      const query = { signalType: "", upperOperator: undefined as "lt" | "lte" | undefined };
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: string) => {
        if (column === "signal_type") query.signalType = value;
        return builder;
      };
      builder.neq = () => builder;
      builder.in = () => {
        noticeQueryCount += 1;
        return builder;
      };
      builder.gte = () => builder;
      builder.lt = () => {
        query.upperOperator = "lt";
        return builder;
      };
      builder.lte = () => {
        query.upperOperator = "lte";
        return builder;
      };
      builder.order = () => builder;
      builder.limit = async () => {
        if (query.signalType === "reset_executed") {
          resetQueryCount += 1;
          if (query.upperOperator === "lte") {
            return {
              data: [{
                tweet_id: "2112432076767289678",
                tweet_created_at: currentResetAt,
                signal_type: "reset_executed",
                confidence: 0.99,
                verification_status: "confirmed",
                is_reply: false,
              }],
              error: null,
            };
          }
          return { data: null, error: previousQueryError };
        }
        return { data: [], error: null };
      };
      return builder;
    },
  };

  const cluster = await findFormalTiboResetCluster(
    client as never,
    "2112432076767289678",
    currentResetAt,
  );

  assert.equal(cluster.error, previousQueryError);
  assert.equal(cluster.representativeNoticeId, null);
  assert.deepEqual(cluster.sourceTweetIds, ["2112432076767289678"]);
  assert.equal(resetQueryCount, 2);
  assert.equal(noticeQueryCount, 0);
});

