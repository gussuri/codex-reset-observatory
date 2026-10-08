import assert from "node:assert/strict";
import test from "node:test";

import { buildBankedGrantObservationWrite } from "../lib/codexUsageBankedGrant";
import type { CodexUsageSnapshot } from "../lib/codexUsageRecovery";
import type { UsageMonitorState } from "../lib/codexUsageMonitorCoverage";

const previous: UsageMonitorState = {
  sourceKey: "local-codex-app-server",
  observedAt: "2026-10-07T19:10:00.000Z",
  receivedAt: "2026-10-07T19:10:02.000Z",
  limitId: "codex",
  planType: "plus",
  usedPercent: 50,
  windowDurationMins: 10080,
  resetsAt: 1_791_047_405,
  coverageStartedAt: "2026-10-01T00:00:00.000Z",
  bankedResetAvailableCount: 0,
  lastBankedGrantAt: null,
};

const current: CodexUsageSnapshot = {
  observedAt: "2026-10-07T23:12:28.952Z",
  limitId: "codex",
  planType: "plus",
  usedPercent: 50,
  windowDurationMins: 10080,
  resetsAt: 1_791_047_405,
  bankedResetAvailableCount: 1,
};

test("builds a notice-independent stable BANKED grant fact with original interval", () => {
  const first = buildBankedGrantObservationWrite({ previousState: previous, snapshot: current, receivedAt: "2026-10-07T23:12:30.000Z" });
  const retry = buildBankedGrantObservationWrite({ previousState: previous, snapshot: current, receivedAt: "2026-10-08T00:00:00.000Z" });

  assert.deepEqual(first, {
    observation_key: "local-codex-app-server:codex:2026-10-07T23:12:28.952Z",
    reset_event_key: "banked-reset-local-codex-app-server-observation-20261007T231228952Z",
    source_key: "local-codex-app-server",
    limit_id: "codex",
    plan_type: "plus",
    previous_observed_at: previous.observedAt,
    observed_at: current.observedAt,
    received_at: "2026-10-07T23:12:30.000Z",
    previous_available_count: 0,
    current_available_count: 1,
    observation_window_start_at: previous.observedAt,
    observation_window_end_at: current.observedAt,
    execution_time_precision: "approximate",
  });
  assert.equal(retry?.observation_key, first?.observation_key);
  assert.equal(retry?.reset_event_key, first?.reset_event_key);
});

test("does not infer a grant from an initial positive count or unknown previous count", () => {
  assert.equal(buildBankedGrantObservationWrite({ previousState: null, snapshot: current, receivedAt: current.observedAt }), null);
  assert.equal(buildBankedGrantObservationWrite({
    previousState: { ...previous, bankedResetAvailableCount: null },
    snapshot: current,
    receivedAt: current.observedAt,
  }), null);
});

test("does not infer a grant from a decrease or a structural plan change", () => {
  assert.equal(buildBankedGrantObservationWrite({
    previousState: { ...previous, bankedResetAvailableCount: 2 },
    snapshot: current,
    receivedAt: current.observedAt,
  }), null);
  assert.equal(buildBankedGrantObservationWrite({
    previousState: { ...previous, planType: "pro" },
    snapshot: current,
    receivedAt: current.observedAt,
  }), null);
});

test("does not turn initial or structure-change protocol posts into grant facts", () => {
  for (const postReason of ["initial", "structure_change"] as const) {
    assert.equal(buildBankedGrantObservationWrite({
      previousState: previous,
      snapshot: {
        ...current,
        monitorProtocolVersion: 2,
        postReason,
        bankedResetCountChange: true,
      },
      receivedAt: current.observedAt,
    }), null);
  }
});

test("does not infer a grant from invalid or non-increasing timestamps", () => {
  assert.equal(buildBankedGrantObservationWrite({
    previousState: { ...previous, observedAt: current.observedAt },
    snapshot: current,
    receivedAt: current.observedAt,
  }), null);
});
