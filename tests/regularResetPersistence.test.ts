import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REGULAR_RESET_SCHEDULE,
  getDueRegularResetEventRows,
  toRegularResetHistoryEvent,
} from "../lib/radar/regularResetSchedule";
import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import {
  getLastGlobalResetAt,
  getLastResetBoundaryAt,
} from "../lib/radar/probability";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";

const REPRESENTATIVE_AT = "2026-08-08T03:32:00.000Z";

test("does not persist a regular reset before the representative wave time", () => {
  const rows = getDueRegularResetEventRows(new Date("2026-08-08T03:31:59.000Z"));

  assert.deepEqual(rows, []);
});

test("creates one completed regular event at the representative wave time", () => {
  const rows = getDueRegularResetEventRows(new Date(REPRESENTATIVE_AT));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].schedule_key, `weekly-regular-reset:${REPRESENTATIVE_AT}`);
  assert.equal(rows[0].scheduled_at, REPRESENTATIVE_AT);
  assert.equal(rows[0].completed_at, REPRESENTATIVE_AT);
  assert.equal(rows[0].cycle_type, "定期リセット");
  assert.equal(rows[0].record_kind, "regular_completed");
  assert.equal(rows[0].status, "completed");
});

test("generates each missed weekly occurrence with a stable key", () => {
  const rows = getDueRegularResetEventRows(new Date("2026-08-22T03:32:00.000Z"));

  assert.deepEqual(
    rows.map((row) => row.scheduled_at),
    [
      "2026-08-08T03:32:00.000Z",
      "2026-08-15T03:32:00.000Z",
      "2026-08-22T03:32:00.000Z",
    ],
  );
  assert.equal(new Set(rows.map((row) => row.schedule_key)).size, rows.length);
});

test("a scheduled Banked Reset remains a regular event, not a random event", () => {
  const rows = getDueRegularResetEventRows(new Date(REPRESENTATIVE_AT), {
    ...DEFAULT_REGULAR_RESET_SCHEDULE,
    reset_method: "任意リセット権1回配布",
  });

  const history = toRegularResetHistoryEvent(rows[0]);
  assert.equal(history.recordKind, "regular_completed");
  assert.equal(history.details?.cycleType, "定期リセット");
  assert.equal(history.details?.resetMethod, "任意リセット権1回配布");
});

test("persisted regular reset restarts the elapsed-time boundary without becoming a random target", () => {
  const now = new Date("2026-08-08T05:00:00.000Z");
  const row = getDueRegularResetEventRows(now)[0];
  const data = getLocalRadarData({
    calculationNow: now,
    regularResetEvents: [row],
  });

  assert.equal(getLastResetBoundaryAt(data, now)?.toISOString(), REPRESENTATIVE_AT);
  assert.notEqual(getLastGlobalResetAt(data, now)?.toISOString(), REPRESENTATIVE_AT);

  const viewModel = getRadarViewModel(data, "ja", false, undefined, now);
  assert.equal(viewModel.regularResetForecast.sourceResetAt, REPRESENTATIVE_AT);
  assert.equal(viewModel.regularResetForecast.lastCompletedAt, REPRESENTATIVE_AT);
});

test("a regular boundary consumes earlier teaser strength but allows a later teaser", () => {
  const now = new Date("2026-08-08T05:00:00.000Z");
  const row = getDueRegularResetEventRows(now)[0];
  const baseSignal = {
    tweet_id: "regular-boundary-teaser",
    signal_type: "irrelevant" as const,
    text: "A possible reset",
    tweet_url: "https://x.com/thsottiaux/status/regular-boundary-teaser",
    tweet_created_at: "2026-08-08T03:20:00.000Z",
    verification_status: "auto_unverified" as const,
    teaser_strength: "strong" as const,
    status: "active",
    expectation: "",
    action: "",
  };

  const beforeBoundary = getLocalRadarData({
    calculationNow: now,
    regularResetEvents: [row],
    recentTiboSignals: [baseSignal],
  });
  assert.equal(
    toPublicRadarSnapshot(beforeBoundary, "ja", { calculationNow: now }).resetTeaserStatus,
    "none",
  );

  const afterBoundary = getLocalRadarData({
    calculationNow: now,
    regularResetEvents: [row],
    recentTiboSignals: [{ ...baseSignal, tweet_created_at: "2026-08-08T04:00:00.000Z" }],
  });
  assert.equal(
    toPublicRadarSnapshot(afterBoundary, "ja", { calculationNow: now }).resetTeaserStatus,
    "strong",
  );
});
