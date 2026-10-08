import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  applyCodexUsageBankedAssociation,
  buildCodexUsageAtomicWritePlan,
  buildBankedDistributionEstimateWrite,
  buildResetExecutionEstimateWrite,
} from "../../lib/codexUsageAtomic";
import { buildBankedGrantAssociationWrite, buildBankedGrantObservationWrite } from "../../lib/codexUsageBankedGrant";
import {
  CODEX_USAGE_SOURCE_KEY,
  type CodexRecoveryObservation,
  type CodexUsageSnapshot,
} from "../../lib/codexUsageRecovery";
import { buildResetExecutionEstimate } from "../../lib/radar/resetExecution";
import type { UsageMonitorState } from "../../lib/codexUsageMonitorCoverage";
import { BANKED_POST_ASSOCIATION_VERSION, type BankedPostAssociationDecision } from "../../lib/radar/resetPostAssociation";
import type { BankedDistributionEstimateInput } from "../../lib/codexUsageRecoveryStore";

const localUrl = process.env.SUPABASE_LOCAL_URL;
const localServiceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
const localIntegrationMarker = process.env.SUPABASE_LOCAL_INTEGRATION === "1";
const localUrlHost = (() => {
  if (!localUrl) return null;
  try {
    return new URL(localUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
})();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const hasAnyLocalConfiguration = Boolean(localUrl || localServiceRoleKey || localIntegrationMarker);
if (hasAnyLocalConfiguration && (
  !localIntegrationMarker ||
  !localUrl ||
  !localServiceRoleKey ||
  !localUrlHost ||
  !loopbackHosts.has(localUrlHost)
)) {
  throw new Error("Atomic database tests require an explicit local integration marker and loopback Supabase URL");
}
const isConfigured = localIntegrationMarker && Boolean(localUrl && localServiceRoleKey);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function clearLocalWebhookData() {
  // These internal tables intentionally do not grant DELETE to service_role.
  // Use an explicit local-only cleanup script so test setup preserves production privileges.
  const cleanupFile = "tests/integration/codexUsageAtomic.cleanup.sql";
  try {
    if (process.platform === "win32") {
      const command = `pnpm exec supabase db query --local --file \"${cleanupFile}\"`;
      execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
        cwd: repositoryRoot,
        stdio: "ignore",
      });
    } else {
      execFileSync("pnpm", ["exec", "supabase", "db", "query", "--local", "--file", cleanupFile], {
        cwd: repositoryRoot,
        stdio: "ignore",
      });
    }
  } catch {
    throw new Error("Failed to clear local Codex usage integration test rows through the local Supabase CLI");
  }
}

function clientOrThrow() {
  if (!localUrl || !localServiceRoleKey) throw new Error("Local Supabase credentials are not configured");
  return createClient(localUrl, localServiceRoleKey, { auth: { persistSession: false } });
}

function assertTimestampEqual(actual: string | null | undefined, expected: string) {
  assert.ok(actual);
  assert.equal(new Date(actual).toISOString(), new Date(expected).toISOString());
}

function baselineSnapshot(): CodexUsageSnapshot {
  return {
    observedAt: "2026-08-30T00:00:00.000Z",
    limitId: "codex",
    planType: "plus",
    usedPercent: 100,
    windowDurationMins: 10080,
    resetsAt: 1_788_000_000,
    bankedResetAvailableCount: 0,
  };
}

function recoverySnapshot(overrides: Partial<CodexUsageSnapshot> = {}): CodexUsageSnapshot {
  return {
    observedAt: "2026-08-30T00:04:00.000Z",
    limitId: "codex",
    planType: "plus",
    usedPercent: 0,
    windowDurationMins: 10080,
    resetsAt: 1_788_604_800,
    bankedResetAvailableCount: 0,
    ...overrides,
  };
}

function monitorStateFromSnapshot(snapshot: CodexUsageSnapshot): UsageMonitorState {
  return {
    sourceKey: CODEX_USAGE_SOURCE_KEY,
    observedAt: snapshot.observedAt,
    receivedAt: snapshot.observedAt,
    limitId: snapshot.limitId,
    planType: snapshot.planType,
    usedPercent: snapshot.usedPercent,
    windowDurationMins: snapshot.windowDurationMins,
    resetsAt: snapshot.resetsAt,
    coverageStartedAt: snapshot.observedAt,
    bankedResetAvailableCount: snapshot.bankedResetAvailableCount ?? null,
    lastBankedGrantAt: null,
  };
}

function recoveryObservation(snapshot: CodexUsageSnapshot, status: "observed" | "confirmed" = "observed"): CodexRecoveryObservation {
  return {
    sourceKey: CODEX_USAGE_SOURCE_KEY,
    observedAt: snapshot.observedAt,
    previousObservedAt: baselineSnapshot().observedAt,
    previousUsedPercent: 100,
    currentUsedPercent: snapshot.usedPercent,
    previousResetsAt: baselineSnapshot().resetsAt,
    currentResetsAt: snapshot.resetsAt,
    cycleHint: "unexpected",
    confidence: "strong",
    status,
    matchedTiboTweetId: status === "confirmed" ? "atomic-deferred-reset" : null,
    confirmedAt: status === "confirmed" ? "2026-08-30T00:04:01.000Z" : null,
  };
}

function estimateWrite(snapshot: CodexUsageSnapshot, observation: CodexRecoveryObservation, key: string) {
  const estimate = buildResetExecutionEstimate({
    resetEventKey: key,
    usageObservation: observation,
    isMonitorObserved: true,
    tiboAnnouncedAt: null,
    tiboPrimaryTweetId: null,
    tiboSourceTweetIds: [],
  });
  if (!estimate) throw new Error("Expected a usage estimate");
  return buildResetExecutionEstimateWrite(estimate, { monitorObserved: true });
}

function recoveryPlan(snapshot: CodexUsageSnapshot, previous: CodexUsageSnapshot, options: {
  observation?: CodexRecoveryObservation;
  estimate?: ReturnType<typeof buildResetExecutionEstimateWrite>;
  banked?: {
    resetEventKey: string;
    displayExecutionAt: string;
    tiboAnnouncedAt: string;
    tiboPrimaryTweetId: string;
    tiboSourceTweetIds: string[];
    officialNoticeTweetId: string;
    officialNoticeAt: string;
  };
  regular?: boolean;
  promotion?: boolean;
  stateSnapshot?: CodexUsageSnapshot;
} = {}) {
  return buildCodexUsageAtomicWritePlan({
    expectedPreviousObservedAt: previous.observedAt,
    snapshot: options.stateSnapshot ?? snapshot,
    receivedAt: "2026-08-30T00:04:01.000Z",
    previousState: monitorStateFromSnapshot(previous),
    observation: options.observation,
    executionEstimate: options.estimate,
    regularReset: options.regular
      ? { scheduledAt: "2026-08-30T00:00:00.000Z", completedAt: snapshot.observedAt }
      : undefined,
    bankedDistribution: options.banked,
    promotion: options.promotion
      ? { tweetId: "atomic-deferred-reset", confidence: 0.98 }
      : undefined,
  });
}

async function apply(client: SupabaseClient<any>, plan: ReturnType<typeof buildCodexUsageAtomicWritePlan>) {
  const result = await client.rpc("apply_codex_usage_webhook_write_v2", { p_plan: plan });
  assert.equal(result.error, null, result.error?.message);
  return result.data as { status: string; retry_required: boolean; observation_id?: string | null };
}

async function count(client: SupabaseClient<any>, table: string, column: string, value: string) {
  const result = await client.from(table).select("*", { count: "exact", head: true }).eq(column, value);
  assert.equal(result.error, null, result.error?.message);
  return result.count ?? 0;
}

async function seedBaseline(client: SupabaseClient<any>) {
  await apply(client, buildCodexUsageAtomicWritePlan({
    expectedPreviousObservedAt: null,
    snapshot: baselineSnapshot(),
    receivedAt: "2026-08-30T00:00:01.000Z",
    previousState: null,
  }));
}

function bankedAssociationDecision(
  observation: NonNullable<ReturnType<typeof buildBankedGrantObservationWrite>>,
  status: "accepted" | "pending" = "pending",
  noticeTweetId: string | null = null,
): BankedPostAssociationDecision {
  return {
    status,
    reason: status === "accepted" ? "unique_active_distribution_claim" : "no_current_lifecycle_match",
    matcherVersion: BANKED_POST_ASSOCIATION_VERSION,
    observationKey: observation.observation_key,
    resetEventKey: observation.reset_event_key,
    noticeTweetId,
    logicalPostId: noticeTweetId,
    sourceTweetIds: noticeTweetId ? [noticeTweetId] : [],
    eligibleCandidateIds: noticeTweetId ? [noticeTweetId] : [],
    excludedCandidates: [],
  };
}

function bankedEstimateInput(
  observation: NonNullable<ReturnType<typeof buildBankedGrantObservationWrite>>,
  noticeTweetId: string,
): BankedDistributionEstimateInput {
  return {
    resetEventKey: observation.reset_event_key,
    displayExecutionAt: observation.observed_at,
    tiboAnnouncedAt: "2026-08-29T23:00:00.000Z",
    tiboPrimaryTweetId: noticeTweetId,
    tiboSourceTweetIds: [noticeTweetId],
    officialNoticeTweetId: noticeTweetId,
    officialNoticeAt: "2026-08-29T23:00:00.000Z",
  };
}

function bankedObservationPlan(previous: CodexUsageSnapshot, observedAt: string, countValue: number, options: {
  status?: "accepted" | "pending";
  noticeTweetId?: string | null;
} = {}) {
  const snapshot: CodexUsageSnapshot = {
    ...previous,
    observedAt,
    bankedResetAvailableCount: countValue,
    monitorProtocolVersion: 2,
    postReason: "banked_reset_count_change",
  };
  const receivedAt = new Date(Date.parse(observedAt) + 1000).toISOString();
  const fact = buildBankedGrantObservationWrite({
    previousState: monitorStateFromSnapshot(previous),
    snapshot,
    receivedAt,
  });
  if (!fact) throw new Error("Expected a BANKED grant observation fixture");
  const decision = bankedAssociationDecision(fact, options.status ?? "pending", options.noticeTweetId ?? null);
  const estimate = options.status === "accepted" && options.noticeTweetId
    ? bankedEstimateInput(fact, options.noticeTweetId)
    : null;
  const plan = buildCodexUsageAtomicWritePlan({
    expectedPreviousObservedAt: previous.observedAt,
    snapshot,
    receivedAt,
    previousState: monitorStateFromSnapshot(previous),
    bankedGrantObservationWrite: fact,
    bankedPostAssociation: { decision, decidedAt: receivedAt, expectedRevision: 0 },
    bankedDistribution: estimate,
  });
  return { snapshot, receivedAt, fact, decision, estimate, plan };
}

async function applyBankedAssociation(client: SupabaseClient<any>, fact: NonNullable<ReturnType<typeof buildBankedGrantObservationWrite>>, decision: BankedPostAssociationDecision, estimate: BankedDistributionEstimateInput | null, decidedAt: string, expectedRevision: number) {
  return applyCodexUsageBankedAssociation(
    client,
    buildBankedGrantAssociationWrite(decision, decidedAt, expectedRevision),
    estimate ? buildBankedDistributionEstimateWrite(estimate) : null,
  );
}

test("atomic webhook success commits observation, regular event, estimate, promotion, and state", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const snapshot = recoverySnapshot();
    await client.from("tibo_signals").insert({
      tweet_id: "atomic-deferred-reset",
      signal_type: "irrelevant",
      text: "A deferred reset signal",
      tweet_url: "https://x.com/thsottiaux/status/atomic-deferred-reset",
      tweet_created_at: snapshot.observedAt,
      expires_at: "2026-09-01T00:00:00.000Z",
      confidence: 0.98,
      verification_status: "auto_unverified",
      is_reply: false,
    });
    const observation = recoveryObservation(snapshot, "confirmed");
    const data = await apply(client, recoveryPlan(snapshot, baselineSnapshot(), {
      observation,
      estimate: estimateWrite(snapshot, observation, "usage-reset-pending"),
      regular: true,
      promotion: true,
    }));
    assert.equal(data.status, "applied");
    assert.equal(await count(client, "codex_recovery_observations", "source_key", CODEX_USAGE_SOURCE_KEY), 1);
    assert.equal(await count(client, "regular_reset_events", "schedule_key", "weekly-regular-reset:2026-08-30T00:00:00.000Z"), 1);
    assert.equal(await count(client, "reset_execution_estimates", "reset_event_key", `usage-reset-${data.observation_id}`), 1);
    const state = await client.from("codex_usage_monitor_state").select("observed_at").eq("source_key", CODEX_USAGE_SOURCE_KEY).single();
    assert.equal(state.error, null, state.error?.message);
    assertTimestampEqual(state.data?.observed_at, snapshot.observedAt);
    const promoted = await client.from("tibo_signals").select("signal_type").eq("tweet_id", "atomic-deferred-reset").single();
    assert.equal(promoted.data?.signal_type, "reset_executed");
  } finally {
    await clearLocalWebhookData();
  }
});
test("a later write failure rolls back observation, regular event, estimate, and state", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const snapshot = recoverySnapshot();
    const observation = recoveryObservation(snapshot);
    const invalidEstimate = {
      ...estimateWrite(snapshot, observation, "atomic-rollback-estimate"),
      execution_time_source: "invalid_source" as never,
    };
    const result = await client.rpc("apply_codex_usage_webhook_write", {
      p_plan: recoveryPlan(snapshot, baselineSnapshot(), {
        observation,
        estimate: invalidEstimate,
        regular: true,
      }),
    });
    assert.notEqual(result.error, null);
    assert.equal(await count(client, "codex_recovery_observations", "source_key", CODEX_USAGE_SOURCE_KEY), 0);
    assert.equal(await count(client, "regular_reset_events", "schedule_key", "weekly-regular-reset:2026-08-30T00:00:00.000Z"), 0);
    assert.equal(await count(client, "reset_execution_estimates", "reset_event_key", "atomic-rollback-estimate"), 0);
    const state = await client.from("codex_usage_monitor_state").select("observed_at").eq("source_key", CODEX_USAGE_SOURCE_KEY).single();
    assertTimestampEqual(state.data?.observed_at, baselineSnapshot().observedAt);
  } finally {
    await clearLocalWebhookData();
  }
});

test("resending one plan is idempotent and does not duplicate rows", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const snapshot = recoverySnapshot();
    const observation = recoveryObservation(snapshot);
    const plan = recoveryPlan(snapshot, baselineSnapshot(), {
      observation,
      estimate: estimateWrite(snapshot, observation, "atomic-idempotent-estimate"),
    });
    const first = await apply(client, plan);
    const second = await apply(client, plan);
    assert.equal(first.status, "applied");
    assert.equal(second.status, "stale");
    assert.equal(second.retry_required, false);
    assert.equal(await count(client, "codex_recovery_observations", "source_key", CODEX_USAGE_SOURCE_KEY), 1);
    assert.ok(first.observation_id);
    assert.equal(await count(client, "reset_execution_estimates", "reset_event_key", `usage-reset-${first.observation_id}`), 1);
  } finally {
    await clearLocalWebhookData();
  }
});

test("a stale compare-and-swap plan performs no side writes or state regression", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const snapshot = recoverySnapshot({ observedAt: "2026-08-30T00:05:00.000Z" });
    const observation = recoveryObservation(snapshot);
    const stalePlan = buildCodexUsageAtomicWritePlan({
      expectedPreviousObservedAt: null,
      snapshot,
      receivedAt: "2026-08-30T00:05:01.000Z",
      previousState: null,
      observation,
      executionEstimate: estimateWrite(snapshot, observation, "atomic-stale-estimate"),
    });
    const result = await apply(client, stalePlan);
    assert.equal(result.status, "stale");
    assert.equal(result.retry_required, true);
    assert.equal(await count(client, "codex_recovery_observations", "source_key", CODEX_USAGE_SOURCE_KEY), 0);
    const state = await client.from("codex_usage_monitor_state").select("observed_at").eq("source_key", CODEX_USAGE_SOURCE_KEY).single();
    assertTimestampEqual(state.data?.observed_at, baselineSnapshot().observedAt);
  } finally {
    await clearLocalWebhookData();
  }
});

test("BANKED estimate and state roll back together when the later state write fails", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const snapshot = recoverySnapshot({ usedPercent: 100, bankedResetAvailableCount: 1 });
    const invalidState = recoverySnapshot({ usedPercent: 101, bankedResetAvailableCount: 1 });
    const plan = recoveryPlan(snapshot, baselineSnapshot(), {
      stateSnapshot: invalidState,
      banked: {
        resetEventKey: "atomic-banked-rollback",
        displayExecutionAt: snapshot.observedAt,
        tiboAnnouncedAt: "2026-08-29T23:00:00.000Z",
        tiboPrimaryTweetId: "atomic-banked-notice",
        tiboSourceTweetIds: ["atomic-banked-notice"],
        officialNoticeTweetId: "atomic-banked-notice",
        officialNoticeAt: "2026-08-29T23:00:00.000Z",
      },
    });
    const result = await client.rpc("apply_codex_usage_webhook_write", { p_plan: plan });
    assert.notEqual(result.error, null);
    assert.equal(await count(client, "reset_execution_estimates", "reset_event_key", "atomic-banked-rollback"), 0);
    const state = await client.from("codex_usage_monitor_state").select("observed_at,used_percent").eq("source_key", CODEX_USAGE_SOURCE_KEY).single();
    assertTimestampEqual(state.data?.observed_at, baselineSnapshot().observedAt);
    assert.equal(state.data?.used_percent, 100);
  } finally {
    await clearLocalWebhookData();
  }
});

test("v2 persists a notice-free BANKED fact atomically, exact retry is idempotent, and conflicting retry fails closed", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const scenario = bankedObservationPlan(baselineSnapshot(), "2026-08-30T00:04:00.000Z", 1);
    const first = await apply(client, scenario.plan);
    assert.equal(first.status, "applied");
    assert.ok(first.observation_id);
    const pending = await applyBankedAssociation(
      client,
      scenario.fact,
      scenario.decision,
      null,
      scenario.receivedAt,
      0,
    );
    assert.equal(pending.error, null);
    assert.equal(pending.status, "pending");
    assert.equal(await count(client, "codex_banked_grant_observations", "observation_key", scenario.fact.observation_key), 1);
    assert.equal(await count(client, "codex_banked_post_association_decisions", "observation_id", first.observation_id!), 1);
    assert.equal(await count(client, "reset_execution_estimates", "reset_event_key", scenario.fact.reset_event_key), 0);

    const immutableColumns = "observation_key,reset_event_key,source_key,limit_id,plan_type,previous_observed_at,observed_at,received_at,previous_available_count,current_available_count,observation_window_start_at,observation_window_end_at,execution_time_precision";
    const factBeforeReevaluation = await client
      .from("codex_banked_grant_observations")
      .select(immutableColumns)
      .eq("observation_key", scenario.fact.observation_key)
      .single();
    assert.equal(factBeforeReevaluation.error, null, factBeforeReevaluation.error?.message);

    const reeval = await applyBankedAssociation(
      client,
      scenario.fact,
      { ...scenario.decision, reason: "reconciliation_retry" },
      null,
      new Date(Date.parse(scenario.receivedAt) + 60_000).toISOString(),
      1,
    );
    assert.equal(reeval.error, null);
    assert.equal(reeval.status, "pending");
    const factAfterReevaluation = await client
      .from("codex_banked_grant_observations")
      .select(immutableColumns)
      .eq("observation_key", scenario.fact.observation_key)
      .single();
    assert.equal(factAfterReevaluation.error, null, factAfterReevaluation.error?.message);
    assert.deepEqual(factAfterReevaluation.data, factBeforeReevaluation.data);

    const exactRetry = await apply(client, scenario.plan);
    assert.equal(exactRetry.status, "stale");
    assert.equal(await count(client, "codex_banked_grant_observations", "observation_key", scenario.fact.observation_key), 1);

    const conflictingPlan = {
      ...scenario.plan,
      banked_grant_observation: {
        ...scenario.fact,
        plan_type: "pro",
      },
    };
    const conflictingRetry = await client.rpc("apply_codex_usage_webhook_write_v2", { p_plan: conflictingPlan });
    assert.notEqual(conflictingRetry.error, null);
    assert.equal(await count(client, "codex_banked_grant_observations", "observation_key", scenario.fact.observation_key), 1);
    const state = await client.from("codex_usage_monitor_state").select("observed_at").eq("source_key", CODEX_USAGE_SOURCE_KEY).single();
    assertTimestampEqual(state.data?.observed_at, scenario.snapshot.observedAt);
  } finally {
    await clearLocalWebhookData();
  }
});

test("BANKED estimates cannot link a recovery observation on insert or update", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    const invalidInsert = await client.from("reset_execution_estimates").insert({
      reset_event_key: "banked-with-recovery-insert",
      display_execution_at: "2026-08-30T00:04:00.000Z",
      execution_time_source: "usage_observation",
      execution_time_confidence: "high",
      execution_time_precision: "approximate",
      estimator_version: "banked-distribution-observation-v2",
      recovery_observation_id: "00000000-0000-4000-8000-000000000001",
    });
    assert.match(invalidInsert.error?.message ?? "", /BANKED estimate cannot own a recovery observation/);

    const validInsert = await client.from("reset_execution_estimates").insert({
      reset_event_key: "banked-with-recovery-update",
      display_execution_at: "2026-08-30T00:04:00.000Z",
      execution_time_source: "usage_observation",
      execution_time_confidence: "high",
      execution_time_precision: "approximate",
      estimator_version: "banked-distribution-observation-v2",
      recovery_observation_id: null,
    });
    assert.equal(validInsert.error, null, validInsert.error?.message);
    const invalidUpdate = await client
      .from("reset_execution_estimates")
      .update({ recovery_observation_id: "00000000-0000-4000-8000-000000000001" })
      .eq("reset_event_key", "banked-with-recovery-update");
    assert.match(invalidUpdate.error?.message ?? "", /BANKED estimate cannot own a recovery observation/);
    const persisted = await client
      .from("reset_execution_estimates")
      .select("recovery_observation_id")
      .eq("reset_event_key", "banked-with-recovery-update")
      .single();
    assert.equal(persisted.error, null, persisted.error?.message);
    assert.equal(persisted.data?.recovery_observation_id, null);
  } finally {
    await clearLocalWebhookData();
  }
});

test("accepted association publishes once; CAS loser is inert; accepted-to-pending hides the v2 projection", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const scenario = bankedObservationPlan(
      baselineSnapshot(),
      "2026-08-30T00:04:00.000Z",
      1,
      { status: "accepted", noticeTweetId: "atomic-banked-notice" },
    );
    const applied = await apply(client, scenario.plan);
    assert.equal(applied.status, "applied");
    const accepted = await applyBankedAssociation(
      client,
      scenario.fact,
      scenario.decision,
      scenario.estimate,
      scenario.receivedAt,
      0,
    );
    assert.equal(accepted.error, null);
    assert.equal(accepted.status, "accepted");
    assert.equal(await count(client, "reset_execution_estimates", "reset_event_key", scenario.fact.reset_event_key), 1);
    const visible = await client.rpc("read_banked_reset_publication_state", { p_reset_event_keys: [scenario.fact.reset_event_key] });
    assert.equal(visible.error, null, visible.error?.message);
    assert.deepEqual(visible.data, [{ reset_event_key: scenario.fact.reset_event_key, published: true }]);

    const staleDecision = await applyBankedAssociation(
      client,
      scenario.fact,
      scenario.decision,
      scenario.estimate,
      scenario.receivedAt,
      0,
    );
    assert.equal(staleDecision.error, null);
    assert.equal(staleDecision.status, "stale");
    assert.equal(await count(client, "codex_banked_post_association_decisions", "observation_id", applied.observation_id!), 1);

    const pendingDecision = bankedAssociationDecision(scenario.fact, "pending");
    const pending = await applyBankedAssociation(
      client,
      scenario.fact,
      pendingDecision,
      null,
      "2026-08-30T00:05:00.000Z",
      1,
    );
    assert.equal(pending.error, null);
    assert.equal(pending.status, "pending");
    const hidden = await client.rpc("read_banked_reset_publication_state", { p_reset_event_keys: [scenario.fact.reset_event_key] });
    assert.equal(hidden.error, null, hidden.error?.message);
    assert.deepEqual(hidden.data, [{ reset_event_key: scenario.fact.reset_event_key, published: false }]);
    assert.equal(await count(client, "reset_execution_estimates", "reset_event_key", scenario.fact.reset_event_key), 1);
  } finally {
    await clearLocalWebhookData();
  }
});

test("separate recurring observations supported by the same notice retain distinct BANKED event keys", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const first = bankedObservationPlan(
      baselineSnapshot(),
      "2026-08-30T00:04:00.000Z",
      1,
      { status: "accepted", noticeTweetId: "recurring-bank-grant-notice" },
    );
    await apply(client, first.plan);
    const firstAssociation = await applyBankedAssociation(client, first.fact, first.decision, first.estimate, first.receivedAt, 0);
    assert.equal(firstAssociation.status, "accepted");

    const second = bankedObservationPlan(
      first.snapshot,
      "2026-08-30T00:08:00.000Z",
      2,
      { status: "accepted", noticeTweetId: "recurring-bank-grant-notice" },
    );
    await apply(client, second.plan);
    const secondAssociation = await applyBankedAssociation(client, second.fact, second.decision, second.estimate, second.receivedAt, 0);
    assert.equal(secondAssociation.status, "accepted");
    assert.notEqual(first.fact.reset_event_key, second.fact.reset_event_key);
    assert.equal(await count(client, "codex_banked_grant_observations", "source_key", CODEX_USAGE_SOURCE_KEY), 2);
    assert.equal(await count(client, "reset_execution_estimates", "estimator_version", "banked-distribution-observation-v2"), 2);
  } finally {
    await clearLocalWebhookData();
  }
});

test("concurrent identical v2 submissions create one durable BANKED observation", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const scenario = bankedObservationPlan(baselineSnapshot(), "2026-08-30T00:04:00.000Z", 1);
    const results = await Promise.all([apply(client, scenario.plan), apply(client, scenario.plan)]);
    assert.deepEqual(results.map((result) => result.status).sort(), ["applied", "stale"]);
    assert.equal(await count(client, "codex_banked_grant_observations", "observation_key", scenario.fact.observation_key), 1);
  } finally {
    await clearLocalWebhookData();
  }
});

test("v2 fact and state roll back together when the monitor write is invalid", { skip: !isConfigured }, async () => {
  const client = clientOrThrow();
  await clearLocalWebhookData();
  try {
    await seedBaseline(client);
    const scenario = bankedObservationPlan(baselineSnapshot(), "2026-08-30T00:04:00.000Z", 1);
    const invalidPlan = {
      ...scenario.plan,
      state: { ...scenario.plan.state, used_percent: 101 },
    };
    const result = await client.rpc("apply_codex_usage_webhook_write_v2", { p_plan: invalidPlan });
    assert.notEqual(result.error, null);
    assert.equal(await count(client, "codex_banked_grant_observations", "observation_key", scenario.fact.observation_key), 0);
    const state = await client.from("codex_usage_monitor_state").select("observed_at,used_percent").eq("source_key", CODEX_USAGE_SOURCE_KEY).single();
    assertTimestampEqual(state.data?.observed_at, baselineSnapshot().observedAt);
    assert.equal(state.data?.used_percent, 100);
  } finally {
    await clearLocalWebhookData();
  }
});
