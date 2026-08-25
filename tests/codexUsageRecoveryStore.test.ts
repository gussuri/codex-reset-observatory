import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCodexUsageRecovery,
  type CodexUsageSnapshot,
} from "../lib/codexUsageRecovery";
import { getNextUsageMonitorLastBankedGrantAt } from "../lib/codexUsageRecoveryStore";
import type { UsageMonitorState } from "../lib/codexUsageMonitorCoverage";

const OBSERVED_AT = "2026-08-26T01:15:00.000Z";
const TRUSTED_GRANT_AT = "2026-08-20T00:00:00.000Z";

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
