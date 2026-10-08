import assert from "node:assert/strict";
import test from "node:test";

import {
  createBankedGrantAssociationReconciliationDependencies,
  runBankedGrantAssociationReconciliation,
  type BankedGrantAssociationReconciliationObservation,
  type BankedGrantAssociationReconciliationDependencies,
} from "../lib/codexUsageBankedAssociationReconciliation";
import { resolveBankedAssociation } from "../lib/codexUsageBankedAssociation";
import type { ActiveTiboSignal } from "../lib/radar/types";
import type { BankedDistributionEstimateInput } from "../lib/codexUsageRecoveryStore";

const OBSERVED_AT = "2026-10-07T23:12:28.952Z";

function fact(
  index: number,
  overrides: Partial<BankedGrantAssociationReconciliationObservation> = {},
): BankedGrantAssociationReconciliationObservation {
  const observedAt = new Date(Date.parse(OBSERVED_AT) + index * 60_000).toISOString();
  return {
    observation_key: `banked-fact-${index}`,
    reset_event_key: `banked-reset-fact-${index}`,
    source_key: "local-codex-app-server",
    limit_id: "codex",
    plan_type: "plus",
    previous_observed_at: new Date(Date.parse(observedAt) - 5 * 60_000).toISOString(),
    observed_at: observedAt,
    received_at: new Date(Date.parse(observedAt) + 5_000).toISOString(),
    previous_available_count: index,
    current_available_count: index + 1,
    observation_window_start_at: new Date(Date.parse(observedAt) - 5 * 60_000).toISOString(),
    observation_window_end_at: observedAt,
    execution_time_precision: "approximate",
    current_revision: 0,
    current_decision_source: null,
    ...overrides,
  };
}

function notice(overrides: Partial<ActiveTiboSignal> = {}): ActiveTiboSignal {
  return {
    tweet_id: "banked-distribution-notice",
    text: "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users.",
    tweet_url: "https://x.com/thsottiaux/status/banked-distribution-notice",
    tweet_created_at: "2026-10-07T20:00:00.000Z",
    expires_at: "2026-10-09T20:00:00.000Z",
    signal_type: "official_notice",
    confidence: 0.99,
    verification_status: "confirmed",
    is_reply: false,
    is_quote: false,
    ...overrides,
  };
}

test("retries a pending observation against later-arriving claims using its original observed time", async () => {
  const firstFact = fact(0, { observed_at: OBSERVED_AT, observation_window_end_at: OBSERVED_AT });
  let current = firstFact;
  let availableSignals: ActiveTiboSignal[] = [];
  const written: Array<{ fact: BankedGrantAssociationReconciliationObservation; status: string; noticeId: string | null }> = [];
  const invalidations: string[] = [];
  const dependencies: BankedGrantAssociationReconciliationDependencies = {
    async listDue() {
      return { observations: [current], hasMore: false };
    },
    async loadSignals(observations) {
      assert.deepEqual(observations.map((item) => item.observed_at), [OBSERVED_AT]);
      return { signals: availableSignals };
    },
    async persist(observation, decision, _estimate, expectedRevision) {
      assert.equal(expectedRevision, current.current_revision);
      written.push({ fact: observation, status: decision.status, noticeId: decision.noticeTweetId });
      current = { ...current, current_revision: current.current_revision + 1, current_decision_source: "automatic" };
      return {
        status: decision.status,
        publicationChanged: decision.status === "accepted",
      };
    },
    async invalidate() {
      invalidations.push("tibo-event");
    },
  };

  const first = await runBankedGrantAssociationReconciliation(dependencies, { now: new Date("2026-10-08T00:00:00.000Z") });
  assert.equal(first.pending, 1);
  assert.deepEqual(written.map((item) => item.status), ["pending"]);
  assert.deepEqual(invalidations, []);

  availableSignals = [notice()];
  const second = await runBankedGrantAssociationReconciliation(dependencies, { now: new Date("2026-10-08T00:10:00.000Z") });
  assert.equal(second.accepted, 1);
  assert.equal(written[1]?.noticeId, "banked-distribution-notice");
  assert.deepEqual(invalidations, ["tibo-event"]);
});

test("continues bounded reconciliation batches so later due observations are not starved", async () => {
  const remaining = Array.from({ length: 5 }, (_, index) => fact(index));
  const persisted: string[] = [];
  let listCalls = 0;
  const result = await runBankedGrantAssociationReconciliation({
    async listDue(_now, limit) {
      listCalls += 1;
      const observations = remaining.splice(0, limit);
      return { observations, hasMore: remaining.length > 0 };
    },
    async loadSignals() {
      return { signals: [] };
    },
    async persist(observation, decision) {
      persisted.push(observation.observation_key);
      assert.equal(decision.status, "pending");
      return { status: "pending", publicationChanged: false };
    },
    async invalidate() {
      assert.fail("A withheld pending observation must not invalidate public cache");
    },
  }, { now: new Date("2026-10-08T00:00:00.000Z"), batchSize: 2, maxBatches: 3 });

  assert.equal(listCalls, 3);
  assert.equal(result.scanned, 5);
  assert.equal(result.pending, 5);
  assert.equal(result.hasMore, false);
  assert.deepEqual(persisted, ["banked-fact-0", "banked-fact-1", "banked-fact-2", "banked-fact-3", "banked-fact-4"]);
});

test("a stale association revision never invalidates public history", async () => {
  let invalidated = false;
  const result = await runBankedGrantAssociationReconciliation({
    async listDue() {
      return { observations: [fact(0, { observed_at: OBSERVED_AT, observation_window_end_at: OBSERVED_AT })], hasMore: false };
    },
    async loadSignals() {
      return { signals: [notice()] };
    },
    async persist() {
      return { status: "stale", publicationChanged: false };
    },
    async invalidate() {
      invalidated = true;
    },
  }, { now: new Date("2026-10-08T00:00:00.000Z") });

  assert.equal(result.stale, 1);
  assert.equal(result.accepted, 0);
  assert.equal(invalidated, false);
});

test("candidate lookup failures persist a retryable pending decision without losing the fact", async () => {
  let persistedReason: string | null = null;
  const result = await runBankedGrantAssociationReconciliation({
    async listDue() {
      return { observations: [fact(0)], hasMore: false };
    },
    async loadSignals() {
      return { signals: [], error: new Error("temporary read failure") };
    },
    async persist(observation, decision) {
      assert.equal(observation.observation_key, "banked-fact-0");
      persistedReason = decision.reason;
      return { status: "pending", publicationChanged: false };
    },
    async invalidate() {
      assert.fail("A lookup failure must not publish or invalidate");
    },
  }, { now: new Date("2026-10-08T00:00:00.000Z") });

  assert.equal(result.pending, 1);
  assert.equal(persistedReason, "candidate_lookup_failed");
});

test("an unresolved legacy occurrence identity stays pending when exact-row lookup fails", async () => {
  const unresolved = { ...fact(0), legacy_identity_status: "unresolved" as const };
  let persistedDecision: { reason: string; status: string } | null = null;
  let persistedEstimate: { resetEventKey: string } | null = null;
  const result = await runBankedGrantAssociationReconciliation({
    async listDue() {
      return { observations: [unresolved], hasMore: false };
    },
    async resolveLegacyIdentity() {
      return { status: "unresolved", error: new Error("temporary exact-row lookup failure") };
    },
    async loadSignals() {
      return { signals: [notice()] };
    },
    async persist(_observation, decision, estimate) {
      persistedDecision = { reason: decision.reason, status: decision.status };
      persistedEstimate = estimate ? { resetEventKey: estimate.resetEventKey } : null;
      return { status: decision.status, publicationChanged: false };
    },
    async invalidate() {
      assert.fail("Unverified legacy identity must not publish");
    },
  }, { now: new Date("2026-10-08T00:00:00.000Z") });

  assert.equal(result.pending, 1);
  assert.deepEqual(persistedDecision, {
    reason: "exact_legacy_estimate_lookup_failed",
    status: "pending",
  });
  assert.equal(persistedEstimate, null);
});

test("a verified exact legacy occurrence key is reused instead of publishing a generated duplicate", async () => {
  const unresolved = { ...fact(0), legacy_identity_status: "unresolved" as const };
  const persistedObservations: BankedGrantAssociationReconciliationObservation[] = [];
  const persistedEstimates: BankedDistributionEstimateInput[] = [];
  const result = await runBankedGrantAssociationReconciliation({
    async listDue() {
      return { observations: [unresolved], hasMore: false };
    },
    async resolveLegacyIdentity() {
      return { status: "legacy_exact", legacyResetEventKey: "banked-reset-existing-exact-occurrence" };
    },
    async loadSignals() {
      return { signals: [notice()] };
    },
    async persist(observation, decision, estimate) {
      persistedObservations.push(observation);
      if (estimate) persistedEstimates.push(estimate);
      assert.equal(decision.status, "accepted");
      assert.equal(decision.legacy_reset_event_key, "banked-reset-existing-exact-occurrence");
      return { status: decision.status, publicationChanged: true };
    },
    async invalidate() {},
  }, { now: new Date("2026-10-08T00:00:00.000Z") });

  assert.equal(result.accepted, 1);
  assert.equal(persistedObservations[0]?.legacy_reset_event_key, "banked-reset-existing-exact-occurrence");
  assert.equal(persistedEstimates[0]?.resetEventKey, "banked-reset-existing-exact-occurrence");
  assert.equal(persistedObservations[0]?.reset_event_key, unresolved.reset_event_key);
});

test("database candidate loading includes and applies a latest edit that cancels an earlier BANKED notice", async () => {
  const original = databaseNoticeRow("2000000000000000001", "official_notice", "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users.");
  const edited = databaseNoticeRow("2000000000000000002", "irrelevant", "Correction: the BANKED reset will not be distributed.");
  original.classification_source = "gemini";
  edited.tweet_created_at = "2026-10-08T00:12:28.952Z";
  edited.verification_status = "rejected";
  edited.classification_source = "manual";
  const history = [original.tweet_id, edited.tweet_id];
  original.logical_post_id = history[0];
  // Older stored versions can have a stale, one-item chain. The later row is
  // the authoritative source for the complete logical-post membership.
  original.edit_history_tweet_ids = [original.tweet_id];
  original.edit_version = 1;
  original.edit_metadata_source = "x_api";
  edited.logical_post_id = history[0];
  edited.edit_history_tweet_ids = history;
  edited.edit_version = 2;
  edited.edit_metadata_source = "x_api";
  const client = fakeTiboQueryClient([original], [edited]);
  const dependencies = createBankedGrantAssociationReconciliationDependencies(client as never);
  const observation = fact(0, {
    observed_at: OBSERVED_AT,
    observation_window_end_at: OBSERVED_AT,
  });

  const loaded = await dependencies.loadSignals([observation]);

  assert.equal(loaded.error, undefined);
  assert.deepEqual(client.logicalPostIdQueries, [original.logical_post_id]);
  assert.deepEqual(loaded.signals.map((signal) => signal.tweet_id).sort(), [original.tweet_id, edited.tweet_id].sort());
  const result = resolveBankedAssociation(observation, loaded.signals, { observedAt: OBSERVED_AT });
  assert.equal(result.decision.status, "pending");
  assert.equal(result.decision.noticeTweetId, null);
});

test("database candidate loading fails closed when a trusted logical-post expansion cannot be read", async () => {
  const original = databaseNoticeRow("2000000000000000003", "official_notice", "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users.");
  original.logical_post_id = original.tweet_id;
  original.edit_history_tweet_ids = [original.tweet_id];
  original.edit_version = 1;
  original.edit_metadata_source = "x_api";
  const dependencies = createBankedGrantAssociationReconciliationDependencies(
    fakeTiboQueryClient([original], [], { logicalPostExpansionError: true }) as never,
  );

  const loaded = await dependencies.loadSignals([fact(0, {
    observed_at: OBSERVED_AT,
    observation_window_end_at: OBSERVED_AT,
  })]);

  assert.ok(loaded.error);
  assert.deepEqual(loaded.signals, []);
});

test("database candidate loading fails closed when logical-post expansion exceeds its row bound", async () => {
  const original = databaseNoticeRow("2000000000000000004", "official_notice", "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users.");
  original.logical_post_id = original.tweet_id;
  original.edit_history_tweet_ids = [original.tweet_id];
  original.edit_version = 1;
  original.edit_metadata_source = "x_api";
  const laterVersions = Array.from({ length: 5000 }, (_, index) => ({
    ...original,
    tweet_id: String(1_000_000_000_000_000 + index),
  }));
  const dependencies = createBankedGrantAssociationReconciliationDependencies(
    fakeTiboQueryClient([original], laterVersions) as never,
  );

  const loaded = await dependencies.loadSignals([fact(0, {
    observed_at: OBSERVED_AT,
    observation_window_end_at: OBSERVED_AT,
  })]);

  assert.ok(loaded.error);
  assert.deepEqual(loaded.signals, []);
});

function databaseNoticeRow(tweetId: string, signalType: ActiveTiboSignal["signal_type"], text: string): ActiveTiboSignal {
  return {
    tweet_id: tweetId,
    signal_type: signalType,
    text,
    tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
    tweet_created_at: "2026-10-07T21:00:00.000Z",
    detected_at: "2026-10-07T21:00:01.000Z",
    expires_at: "2026-10-09T21:00:00.000Z",
    verification_status: "confirmed",
    confidence: 0.99,
    classification_source: "manual",
    is_reply: false,
    is_quote: false,
    temporal_expression: null,
    temporal_kind: null,
    temporal_precision: null,
    temporal_timezone: null,
    temporal_confidence: null,
    expected_start_at: null,
    expected_end_at: null,
    temporal_resolution_status: "unresolved",
    logical_post_id: null,
    edit_history_tweet_ids: null,
    edit_version: null,
    edit_metadata_source: null,
  };
}

function fakeTiboQueryClient(
  rootRows: unknown[],
  editRows: unknown[],
  options: { logicalPostExpansionError?: boolean } = {},
) {
  const logicalPostIdQueries: string[] = [];
  return {
    logicalPostIdQueries,
    from(table: string) {
      assert.equal(table, "tibo_signals");
      const filters: Record<string, unknown> = {};
      const builder: Record<string, any> = {};
      for (const method of ["select", "eq", "gte", "lte", "order", "limit", "or"]) {
        builder[method] = (...args: unknown[]) => {
          if (method === "eq" || method === "gte" || method === "lte") filters[String(args[0])] = args[1];
          return builder;
        };
      }
      builder.in = (column: string, values: string[]) => {
        filters[column] = values;
        if (column === "logical_post_id") logicalPostIdQueries.push(...values);
        return builder;
      };
      builder.range = (start: number, end: number) => {
        filters.range = [start, end];
        return builder;
      };
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        const ids = filters.tweet_id;
        const logicalPostIds = filters.logical_post_id;
        if (Array.isArray(logicalPostIds) && options.logicalPostExpansionError) {
          return Promise.resolve({ data: null, error: new Error("logical post expansion failed") }).then(resolve, reject);
        }
        let data = Array.isArray(ids)
          ? [...rootRows, ...editRows].filter((row) => ids.includes((row as { tweet_id: string }).tweet_id))
          : Array.isArray(logicalPostIds)
            ? [...rootRows, ...editRows].filter((row) => logicalPostIds.includes((row as { logical_post_id: string }).logical_post_id))
            : rootRows;
        if (Array.isArray(filters.range)) {
          const [start, end] = filters.range as [number, number];
          data = data.slice(start, end + 1);
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return builder;
    },
  };
}
