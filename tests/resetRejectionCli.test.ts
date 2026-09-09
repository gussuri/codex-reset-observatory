import test from "node:test";
import assert from "node:assert/strict";
import {
  parseResetRejectionArgs,
  runResetRejectionCli,
} from "../scripts/reject-reset-event";
import {
  applyResetRejection,
  findResetRejectionTarget,
  validateResetRejectionInput,
  extractObservationUuid,
  invalidateRadarCache,
  REJECTED_RESET_EXECUTION_ESTIMATOR_VERSION,
} from "../lib/radar/resetRejectionStore";
import {
  isPublicRandomResetExecutionEstimate,
  isRejectedResetExecutionEstimate,
  type ResetExecutionEstimate,
} from "../lib/radar/resetExecution";
import {
  findNoticeBackedRecoveryEvents,
  findBankedDistributionEvents,
  combineResetHistory,
} from "../lib/radar/tiboHistory";
import { getLastRandomRecoveryResetAt } from "../lib/radar/recoveryBoundary";
import type { WindowEventLike, RadarData } from "../lib/radar/types";

// Mock Supabase Builder Helper
function createMockSupabase(initialData: {
  estimates?: Record<string, any>[];
  observations?: Record<string, any>[];
}) {
  const estimates = [...(initialData.estimates ?? [])];
  const observations = [...(initialData.observations ?? [])];
  const updateLog: { table: string; payload: any; match: any }[] = [];

  const client = {
    from: (table: string) => {
      let selectedFields = "*";
      let filterCol: string | null = null;
      let filterVal: any = null;
      let updatePayload: any = null;

      const queryBuilder = {
        select: (fields = "*") => {
          selectedFields = fields;
          return queryBuilder;
        },
        eq: (col: string, val: any) => {
          filterCol = col;
          filterVal = val;
          return queryBuilder;
        },
        update: (payload: any) => {
          updatePayload = payload;
          return queryBuilder;
        },
        maybeSingle: async () => {
          if (updatePayload !== null) {
            // Apply update
            updateLog.push({ table, payload: updatePayload, match: { [filterCol!]: filterVal } });
            const list = table === "reset_execution_estimates" ? estimates : observations;
            const target = list.find((item) => item[filterCol!] === filterVal);
            if (target) {
              Object.assign(target, updatePayload);
              return { data: target, error: null };
            }
            return { data: null, error: null };
          }

          // Read single
          const list = table === "reset_execution_estimates" ? estimates : observations;
          const found = list.find((item) => item[filterCol!] === filterVal);
          return { data: found ? { ...found } : null, error: null };
        },
        limit: (n: number) => queryBuilder,
        order: (col: string, opts: any) => queryBuilder,
        then: (resolve: any) => {
          if (updatePayload !== null) {
            updateLog.push({ table, payload: updatePayload, match: { [filterCol!]: filterVal } });
            const list = table === "reset_execution_estimates" ? estimates : observations;
            const target = list.find((item) => item[filterCol!] === filterVal);
            if (target) {
              Object.assign(target, updatePayload);
            }
            return Promise.resolve({ data: target ?? null, error: null }).then(resolve);
          }
          const list = table === "reset_execution_estimates" ? estimates : observations;
          const filtered = filterCol ? list.filter((item) => item[filterCol!] === filterVal) : list;
          return Promise.resolve({ data: filtered, error: null }).then(resolve);
        },
      };

      return queryBuilder;
    },
  };

  return { client: client as any, estimates, observations, updateLog };
}

test("parseResetRejectionArgs validates required flags and options", () => {
  // Valid args
  const parsed = parseResetRejectionArgs([
    "--event-key", "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec",
    "--reason", "False positive by monitor",
    "--by", "ops-team",
    "--apply",
    "--format", "json",
  ]);
  assert.equal(parsed.apply, true);
  assert.equal(parsed.format, "json");
  assert.equal(parsed.input.eventKey, "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec");
  assert.equal(parsed.input.reason, "False positive by monitor");
  assert.equal(parsed.input.by, "ops-team");

  // Aliases -e and -r
  const aliasParsed = parseResetRejectionArgs([
    "-e", "test-key",
    "-r", "rejection reason",
  ]);
  assert.equal(aliasParsed.apply, false);
  assert.equal(aliasParsed.input.eventKey, "test-key");
  assert.equal(aliasParsed.input.reason, "rejection reason");
  assert.equal(aliasParsed.input.by, "operator");

  // Missing --event-key throws
  assert.throws(() => {
    parseResetRejectionArgs(["--reason", "some reason"]);
  }, /--event-key is required/);

  // Missing --reason throws
  assert.throws(() => {
    parseResetRejectionArgs(["--event-key", "key-123"]);
  }, /--reason is required/);

  // Empty reason throws
  assert.throws(() => {
    parseResetRejectionArgs(["--event-key", "key-123", "--reason", "   "]);
  }, /--reason is required and cannot be empty/);

  // Duplicate flag throws
  assert.throws(() => {
    parseResetRejectionArgs(["--event-key", "k1", "--event-key", "k2", "--reason", "r"]);
  }, /may only be specified once/);

  // Duplicate --apply throws
  assert.throws(() => {
    parseResetRejectionArgs(["--event-key", "k1", "--reason", "r", "--apply", "--apply"]);
  }, /--apply may only be specified once/);
});

test("extractObservationUuid extracts valid UUID from event key", () => {
  const uuid = "512a8b31-e43e-4f91-b5e6-7023b87e80ec";
  assert.equal(extractObservationUuid(uuid), uuid);
  assert.equal(extractObservationUuid(`usage-reset-${uuid}`), uuid);
  assert.equal(extractObservationUuid("not-a-uuid"), null);
  assert.equal(extractObservationUuid("usage-reset-non-uuid"), null);
});

test("dry-run does NOT perform database writes and returns target details and proposed mutations", async () => {
  const mockDb = createMockSupabase({
    estimates: [
      {
        reset_event_key: "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec",
        recovery_observation_id: "512a8b31-e43e-4f91-b5e6-7023b87e80ec",
        display_execution_at: "2026-09-09T17:41:53.654Z",
        execution_time_source: "usage_observation",
        execution_time_confidence: "high",
        execution_time_precision: "approximate",
        execution_window_start_at: "2026-09-09T16:00:00.000Z",
        execution_window_end_at: "2026-09-09T17:41:53.654Z",
        estimator_version: "usage-execution-monitor-v1",
      },
    ],
    observations: [
      {
        id: "512a8b31-e43e-4f91-b5e6-7023b87e80ec",
        status: "observed",
        observed_at: "2026-09-09T17:41:53.654Z",
        confidence: "strong",
        cycle_hint: "irregular",
      },
    ],
  });

  const result = await applyResetRejection(
    mockDb.client,
    {
      eventKey: "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec",
      reason: "Monitor false positive on usage metric spike",
      by: "audit-operator",
    },
    { apply: false },
  );

  assert.equal(result.status, "dry_run");
  assert.equal(result.apply, false);
  assert.equal(mockDb.updateLog.length, 0); // ZERO DB WRITES
  assert.ok(result.target);
  assert.equal(result.target.canonicalEventKey, "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec");
  assert.equal(result.target.overallStatus, "active");
  assert.ok(result.proposedMutation);
  assert.equal(
    result.proposedMutation.resetExecutionEstimates?.update.estimator_version,
    REJECTED_RESET_EXECUTION_ESTIMATOR_VERSION,
  );
  assert.equal(
    result.proposedMutation.codexRecoveryObservations?.update.status,
    "rejected",
  );
  assert.equal(
    result.proposedMutation.resetExecutionEstimates?.update.manual_override_reason,
    "Monitor false positive on usage metric spike",
  );
  assert.equal(
    result.proposedMutation.resetExecutionEstimates?.update.manual_override_by,
    "audit-operator",
  );
});

test("apply executes logical rejection on both tables, records audit fields, and invalidates cache", async () => {
  const mockDb = createMockSupabase({
    estimates: [
      {
        reset_event_key: "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec",
        recovery_observation_id: "512a8b31-e43e-4f91-b5e6-7023b87e80ec",
        display_execution_at: "2026-09-09T17:41:53.654Z",
        execution_time_source: "usage_observation",
        execution_time_confidence: "high",
        execution_time_precision: "approximate",
        estimator_version: "usage-execution-monitor-v1",
      },
    ],
    observations: [
      {
        id: "512a8b31-e43e-4f91-b5e6-7023b87e80ec",
        status: "observed",
        observed_at: "2026-09-09T17:41:53.654Z",
        confidence: "strong",
      },
    ],
  });

  let cacheInvalidated = false;
  const mockCacheInvalidate = () => {
    cacheInvalidated = true;
    return { tag: "radar-data", revalidated: true };
  };

  const result = await applyResetRejection(
    mockDb.client,
    {
      eventKey: "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec",
      reason: "Monitor false positive confirmed by log review",
      by: "sre-lead",
    },
    { apply: true, invalidateCache: mockCacheInvalidate },
  );

  assert.equal(result.status, "applied");
  assert.equal(result.apply, true);
  assert.equal(cacheInvalidated, true);

  // Check estimates table updated
  assert.equal(mockDb.estimates[0].estimator_version, REJECTED_RESET_EXECUTION_ESTIMATOR_VERSION);
  assert.equal(mockDb.estimates[0].execution_time_confidence, "low");
  assert.equal(mockDb.estimates[0].manual_override_reason, "Monitor false positive confirmed by log review");
  assert.equal(mockDb.estimates[0].manual_override_by, "sre-lead");
  assert.ok(mockDb.estimates[0].manual_override_at);
  assert.ok(mockDb.estimates[0].updated_at);

  // Check recovery observations table updated
  assert.equal(mockDb.observations[0].status, "rejected");
  assert.ok(mockDb.observations[0].updated_at);
});

test("idempotency: re-running on already rejected event does not fail and performs no new writes", async () => {
  const mockDb = createMockSupabase({
    estimates: [
      {
        reset_event_key: "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec",
        recovery_observation_id: "512a8b31-e43e-4f91-b5e6-7023b87e80ec",
        display_execution_at: "2026-09-09T17:41:53.654Z",
        estimator_version: REJECTED_RESET_EXECUTION_ESTIMATOR_VERSION,
        manual_override_reason: "Initial rejection reason",
        manual_override_by: "previous-operator",
        manual_override_at: "2026-09-09T18:00:00.000Z",
      },
    ],
    observations: [
      {
        id: "512a8b31-e43e-4f91-b5e6-7023b87e80ec",
        status: "rejected",
      },
    ],
  });

  const result = await applyResetRejection(
    mockDb.client,
    {
      eventKey: "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec",
      reason: "Second attempt to reject",
      by: "another-operator",
    },
    { apply: true },
  );

  assert.equal(result.status, "already_rejected");
  assert.equal(mockDb.updateLog.length, 0); // No updates performed
  assert.equal(result.audit?.rejectionReason, "Initial rejection reason");
  assert.equal(result.audit?.rejectedBy, "previous-operator");
});

test("returns not_found when neither estimate nor observation exists", async () => {
  const mockDb = createMockSupabase({ estimates: [], observations: [] });

  const result = await applyResetRejection(
    mockDb.client,
    {
      eventKey: "non-existent-event-key",
      reason: "Rejecting ghost event",
    },
    { apply: true },
  );

  assert.equal(result.status, "not_found");
  assert.equal(result.target, null);
});

test("supports flexible event key lookup: finds target by raw observation UUID", async () => {
  const uuid = "512a8b31-e43e-4f91-b5e6-7023b87e80ec";
  const mockDb = createMockSupabase({
    estimates: [
      {
        reset_event_key: `usage-reset-${uuid}`,
        recovery_observation_id: uuid,
        display_execution_at: "2026-09-09T17:41:53.654Z",
        estimator_version: "usage-execution-monitor-v1",
      },
    ],
    observations: [
      {
        id: uuid,
        status: "observed",
      },
    ],
  });

  // Passing raw uuid without 'usage-reset-' prefix
  const result = await applyResetRejection(
    mockDb.client,
    {
      eventKey: uuid,
      reason: "Lookup by raw UUID",
    },
    { apply: false },
  );

  assert.equal(result.status, "dry_run");
  assert.ok(result.target);
  assert.equal(result.target.canonicalEventKey, `usage-reset-${uuid}`);
  assert.equal(result.target.targetEstimate?.resetEventKey, `usage-reset-${uuid}`);
});

test("runResetRejectionCli returns 0 on success/dry-run/already_rejected and 1 on not_found", async () => {
  const mockDb = createMockSupabase({
    estimates: [
      {
        reset_event_key: "usage-reset-test-1",
        display_execution_at: "2026-09-09T17:41:53.654Z",
        estimator_version: "usage-execution-monitor-v1",
      },
    ],
  });

  // Dry run
  const codeDryRun = await runResetRejectionCli(
    ["--event-key", "usage-reset-test-1", "--reason", "testing", "--format", "json"],
    { client: mockDb.client },
  );
  assert.equal(codeDryRun, 0);

  // Pretty format
  const codePretty = await runResetRejectionCli(
    ["--event-key", "usage-reset-test-1", "--reason", "testing", "--format", "pretty"],
    { client: mockDb.client },
  );
  assert.equal(codePretty, 0);

  // Not found
  const codeNotFound = await runResetRejectionCli(
    ["--event-key", "unknown-key", "--reason", "testing"],
    { client: mockDb.client },
  );
  assert.equal(codeNotFound, 1);
});

test("data consistency: rejected estimate does NOT affect history, lastRandomResetAt, or probability clock", () => {
  const rejectedEstimate: ResetExecutionEstimate = {
    resetEventKey: "usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec",
    recoveryObservationId: "512a8b31-e43e-4f91-b5e6-7023b87e80ec",
    displayExecutionAt: "2026-09-09T17:41:53.654Z",
    executionTimeSource: "usage_observation",
    executionTimeConfidence: "low",
    executionTimePrecision: "approximate",
    executionWindowStartAt: "2026-09-09T16:00:00.000Z",
    executionWindowEndAt: "2026-09-09T17:41:53.654Z",
    estimatorVersion: REJECTED_RESET_EXECUTION_ESTIMATOR_VERSION,
    manualOverrideReason: "Monitor false positive",
    manualOverrideBy: "operator",
    manualOverrideAt: "2026-09-10T00:00:00.000Z",
    tiboSourceTweetIds: [],
  };

  // 1. isRejectedResetExecutionEstimate recognizes it
  assert.equal(isRejectedResetExecutionEstimate(rejectedEstimate), true);

  // 2. isPublicRandomResetExecutionEstimate rejects it
  assert.equal(isPublicRandomResetExecutionEstimate(rejectedEstimate), false);

  // 3. findNoticeBackedRecoveryEvents completely excludes it
  const noticeBackedEvents = findNoticeBackedRecoveryEvents([], [], [rejectedEstimate]);
  assert.equal(noticeBackedEvents.length, 0);

  // 4. findBankedDistributionEvents excludes it
  const bankedEvents = findBankedDistributionEvents([], [rejectedEstimate]);
  assert.equal(bankedEvents.length, 0);

  // 5. combineResetHistory excludes it from dynamic events
  const history = combineResetHistory(
    [],
    [],
    [],
    [],
    [],
    [],
    [rejectedEstimate],
  );
  assert.equal(history.some((event) => event.id === rejectedEstimate.resetEventKey), false);

  // 6. lastRandomResetAt is NOT changed to the rejected estimate date (stays at prior reset)
  const priorReset: WindowEventLike = {
    id: "legitimate-global-reset-2026-09-08",
    recordKind: "confirmed_global",
    details: {
      cycleType: "ランダムリセット",
      scope: "全有料プラン",
    } as any,
    completed_at: "2026-09-08T03:00:00.000Z",
  };

  const radarData: RadarData = {
    reset_execution_estimates: [rejectedEstimate],
  } as any;

  const lastResetAt = getLastRandomRecoveryResetAt(
    radarData,
    new Date("2026-09-10T12:00:00Z"),
    [priorReset],
  );

  assert.equal(lastResetAt, "2026-09-08T03:00:00.000Z");
  assert.notEqual(lastResetAt, "2026-09-09T17:41:53.654Z");
});
