import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchPublicCodexRecoveryObservation,
  readCodexRecoveryObservations,
  toCodexRecoveryObservation,
} from "../lib/codexUsageRecoveryStore";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import type { FormalTiboResetSignal } from "../lib/radar/tiboHistory";
import type { CodexRecoveryObservation } from "../lib/codexUsageRecovery";
import type { ResetExecutionEstimate } from "../lib/radar/resetExecution";
import type { ActiveTiboSignal } from "../lib/radar/types";

type RecoveryDbRow = {
  id: string;
  source_key: string;
  observed_at: string;
  previous_observed_at: string;
  previous_used_percent: number | string;
  current_used_percent: number | string;
  previous_resets_at: number;
  current_resets_at: number;
  cycle_hint: string;
  confidence: string;
  status: string;
  matched_tibo_tweet_id: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

type QueryCapture = {
  eq: Record<string, unknown>;
  neq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
};

const OCT20_OBSERVATION_ID = "293e585f-f545-451d-a50c-bfc9f2510685";
const OCT20_RESET_TWEET_ID = "2112432076767289678";
const OCT22_OBSERVATION_ID = "5d099b8b-94e1-4cce-82d8-dd051198ab69";
const OCT22_NOTICE_TWEET_ID = "2113162277688070445";
const OCT22_REPLY_TWEET_ID = "2113162413008884099";
const OCT22_SYNTHETIC_CONFIRMING_TWEET_ID = "test-oct22-completion-post";
const OCT22_RESET_EVENT_KEY = `usage-reset-${OCT22_OBSERVATION_ID}`;
const CALCULATION_NOW = new Date("2026-10-23T12:00:00.000Z");

function recoveryRow(
  id: string,
  observedAt: string,
  options: Partial<RecoveryDbRow> = {},
): RecoveryDbRow {
  const previousObservedAt = new Date(Date.parse(observedAt) - 8 * 60_000).toISOString();
  return {
    id,
    source_key: "local-codex-app-server",
    observed_at: observedAt,
    previous_observed_at: previousObservedAt,
    previous_used_percent: 25,
    current_used_percent: 0,
    previous_resets_at: 1_793_260_007,
    current_resets_at: 1_793_293_753,
    cycle_hint: "unexpected",
    confidence: "strong",
    status: "observed",
    matched_tibo_tweet_id: null,
    confirmed_at: null,
    created_at: observedAt,
    updated_at: observedAt,
    ...options,
  };
}

const oct20Row = recoveryRow(OCT20_OBSERVATION_ID, "2026-10-20T06:34:03.741Z", {
  previous_observed_at: "2026-10-20T06:32:03.403Z",
  previous_used_percent: 97,
  current_used_percent: 0,
  previous_resets_at: 1_792_890_948,
  current_resets_at: 1_793_082_776,
  status: "confirmed",
  matched_tibo_tweet_id: OCT20_RESET_TWEET_ID,
  confirmed_at: "2026-10-20T06:36:06.139Z",
  updated_at: "2026-10-20T06:36:06.139Z",
});

const oct22Row = recoveryRow(OCT22_OBSERVATION_ID, "2026-10-22T17:10:09.430Z", {
  previous_observed_at: "2026-10-22T17:02:09.309Z",
  previous_used_percent: 25,
  current_used_percent: 0,
  previous_resets_at: 1_793_260_007,
  current_resets_at: 1_793_293_753,
});

const inRangeRows = Array.from({ length: 20 }, (_, index) => {
  const hour = String(index).padStart(2, "0");
  return recoveryRow(`padding-${String(index).padStart(2, "0")}`, `2026-10-21T${hour}:00:00.000Z`);
});

const malformedRow = recoveryRow("malformed-observation", "2026-10-19T00:00:00.000Z", {
  previous_observed_at: "2026-10-19T00:08:00.000Z",
  current_used_percent: "not-a-number",
  matched_tibo_tweet_id: "signal-malformed-observation",
});

const unsupportedRows = [
  recoveryRow("rejected-observation", "2026-10-18T00:00:00.000Z", {
    status: "rejected",
    matched_tibo_tweet_id: "signal-rejected-observation",
  }),
  recoveryRow("regular-observation", "2026-10-18T01:00:00.000Z", {
    status: "confirmed",
    cycle_hint: "regular",
    matched_tibo_tweet_id: "signal-regular-observation",
  }),
  recoveryRow("unknown-observation", "2026-10-18T02:00:00.000Z", {
    status: "confirmed",
    cycle_hint: "unknown",
    matched_tibo_tweet_id: "signal-unknown-observation",
  }),
];

function recoveryQueryClient(rows: RecoveryDbRow[]) {
  const captures: QueryCapture[] = [];
  const client = {
    from(table: string) {
      assert.equal(table, "codex_recovery_observations");
      const capture: QueryCapture = { eq: {}, neq: {}, in: {}, order: null, limit: null };
      captures.push(capture);
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        capture.eq[column] = value;
        return builder;
      };
      builder.neq = (column: string, value: unknown) => {
        capture.neq[column] = value;
        return builder;
      };
      builder.in = (column: string, values: unknown[]) => {
        capture.in[column] = values;
        return builder;
      };
      builder.order = (column: string, options: { ascending: boolean }) => {
        capture.order = { column, ascending: options.ascending };
        return builder;
      };
      builder.limit = (value: number) => {
        capture.limit = value;
        return builder;
      };
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) => {
        let result = rows.filter((row) =>
          Object.entries(capture.eq).every(([column, value]) => row[column as keyof RecoveryDbRow] === value) &&
          Object.entries(capture.neq).every(([column, value]) => row[column as keyof RecoveryDbRow] !== value) &&
          Object.entries(capture.in).every(([column, values]) => values.includes(row[column as keyof RecoveryDbRow])),
        );
        if (capture.order) {
          const { column, ascending } = capture.order;
          result = result.sort((left, right) => {
            const leftValue = String(left[column as keyof RecoveryDbRow]);
            const rightValue = String(right[column as keyof RecoveryDbRow]);
            return ascending ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue);
          });
        }
        if (capture.limit !== null) result = result.slice(0, capture.limit);
        return Promise.resolve({ data: result, error: null }).then(resolve, reject);
      };
      return builder;
    },
  };
  return { client, captures };
}

function formalReset(
  tweetId: string,
  createdAt: string,
  text = "Reset is done for all paid users.",
): FormalTiboResetSignal & ActiveTiboSignal {
  return {
    tweet_id: tweetId,
    text,
    tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
    tweet_created_at: createdAt,
    detected_at: createdAt,
    signal_type: "reset_executed",
    confidence: 0.99,
    verification_status: "confirmed",
    classification_source: "manual",
  };
}

function typedObservation(row: RecoveryDbRow) {
  return toCodexRecoveryObservation(row as never);
}

function buildPublicSnapshot(
  observations: CodexRecoveryObservation[],
  confirmedOct22TweetId: string | null = null,
) {
  const oct20Reset = formalReset(
    OCT20_RESET_TWEET_ID,
    "2026-10-20T06:33:48.000Z",
    "Day 15/ Nevermind, we're still cooking... and reset. Enjoy.",
  );
  const oct22Notice: ActiveTiboSignal = {
    tweet_id: OCT22_NOTICE_TWEET_ID,
    text: "Day 17/ Bet you thought we forgot, but no, it’s reset day today.\n\nAlso good time to remind you to get Daybreak Blue access, it only takes 15 mins and you don’t want to have to do it in the middle of an incident.",
    tweet_url: `https://x.com/thsottiaux/status/${OCT22_NOTICE_TWEET_ID}`,
    tweet_created_at: "2026-10-22T06:55:22.000Z",
    signal_type: "official_notice",
    confidence: 0.99,
    verification_status: "confirmed",
    is_reply: false,
  };
  const oct22Estimate: ResetExecutionEstimate = {
    resetEventKey: OCT22_RESET_EVENT_KEY,
    displayExecutionAt: "2026-10-22T17:10:09.430Z",
    executionTimeSource: "usage_observation",
    executionTimeConfidence: "high",
    executionTimePrecision: "approximate",
    executionWindowStartAt: "2026-10-22T17:02:09.309Z",
    executionWindowEndAt: "2026-10-22T17:10:09.430Z",
    recoveryObservationId: OCT22_OBSERVATION_ID,
    recoveryPreviousObservedAt: "2026-10-22T17:02:09.309Z",
    recoveryObservedAt: "2026-10-22T17:10:09.430Z",
    tiboAnnouncedAt: "2026-10-22T06:55:22.000Z",
    tiboPrimaryTweetId: confirmedOct22TweetId,
    tiboSourceTweetIds: [
      OCT22_NOTICE_TWEET_ID,
      OCT22_REPLY_TWEET_ID,
      ...(confirmedOct22TweetId ? [confirmedOct22TweetId] : []),
    ],
    officialNoticeTweetId: OCT22_NOTICE_TWEET_ID,
    officialNoticeAt: "2026-10-22T06:55:22.000Z",
    estimatorVersion: "usage-execution-monitor-v1",
  };

  const invalidFormalSignals = unsupportedRows.map((row) => formalReset(
    `signal-${row.id}`,
    row.observed_at,
  ));
  const malformedFormalSignal = formalReset("signal-malformed-observation", "2026-10-19T00:00:00.000Z");
  const oct22Completion = confirmedOct22TweetId
    ? formalReset(
        confirmedOct22TweetId,
        "2026-10-22T17:12:00.000Z",
        "Global reset is complete for all paid users.",
      )
    : null;
  const signals = [
    oct20Reset,
    oct22Notice,
    ...(oct22Completion ? [oct22Completion] : []),
    ...invalidFormalSignals,
    malformedFormalSignal,
  ];
  const data = getLocalRadarData({
    calculationNow: CALCULATION_NOW,
    activeTiboSignals: signals,
    recentTiboSignals: signals,
    formalTiboResets: [
      oct20Reset,
      ...(oct22Completion ? [oct22Completion] : []),
      ...invalidFormalSignals,
      malformedFormalSignal,
    ],
    codexRecoveryObservations: observations,
    resetExecutionEstimates: [oct22Estimate],
  });
  return toPublicRadarSnapshot(data, "en", {
    calculationNow: CALCULATION_NOW,
    limitHistory: false,
  });
}

test("history recovery loader includes observed and confirmed rows without widening the presentation-only fetch", async () => {
  const { client, captures } = recoveryQueryClient([
    ...inRangeRows,
    oct20Row,
    oct22Row,
    malformedRow,
    ...unsupportedRows,
  ]);

  const result = await readCodexRecoveryObservations(client as never);

  assert.equal(result.error, null);
  assert.equal(result.rows.length, 23);
  assert.ok(result.rows.some((row) => row.id === OCT20_OBSERVATION_ID));
  assert.ok(result.rows.some((row) => row.id === OCT22_OBSERVATION_ID));
  assert.ok(result.rows.some((row) => row.id === malformedRow.id));
  assert.equal(result.rows.some((row) => row.id === "rejected-observation"), false);
  assert.equal(result.rows.some((row) => row.id === "regular-observation"), false);
  assert.equal(result.rows.some((row) => row.id === "unknown-observation"), false);

  assert.deepEqual(captures[0]?.in.status, ["observed", "confirmed"]);
  assert.equal(captures[0]?.eq.source_key, "local-codex-app-server");
  assert.equal(captures[0]?.eq.confidence, "strong");
  assert.equal(captures[0]?.eq.cycle_hint, "unexpected");
  assert.equal(captures[0]?.order?.column, "observed_at");
  assert.equal(captures[0]?.order?.ascending, false);
  assert.equal(captures[0]?.limit, 2000);

  await fetchPublicCodexRecoveryObservation(client as never, CALCULATION_NOW);
  assert.equal(captures[1]?.eq.status, "observed");
  assert.equal(captures[1]?.in.status, undefined);
});

test("observed-to-confirmed recovery keeps the same Oct20 and Oct22 canonical public history exactly once", async () => {
  const confirmedOct22Row: RecoveryDbRow = {
    ...oct22Row,
    status: "confirmed",
    matched_tibo_tweet_id: OCT22_SYNTHETIC_CONFIRMING_TWEET_ID,
    confirmed_at: "2026-10-22T17:15:00.000Z",
    updated_at: "2026-10-22T17:15:00.000Z",
  };
  const readRows = async (oct22: RecoveryDbRow) => {
    const { client } = recoveryQueryClient([
      ...inRangeRows,
      oct20Row,
      oct22,
      malformedRow,
      ...unsupportedRows,
    ]);
    return readCodexRecoveryObservations(client as never);
  };

  const observedRead = await readRows(oct22Row);
  const confirmedRead = await readRows(confirmedOct22Row);
  assert.equal(observedRead.error, null);
  assert.equal(confirmedRead.error, null);
  assert.equal(observedRead.rows.find((row) => row.id === OCT22_OBSERVATION_ID)?.status, "observed");
  assert.equal(confirmedRead.rows.find((row) => row.id === OCT22_OBSERVATION_ID)?.status, "confirmed");

  const invalidGateRows = unsupportedRows
    .map((row) => typedObservation(row))
    .filter((row): row is CodexRecoveryObservation => Boolean(row));
  const malformedObservation = typedObservation(malformedRow);
  assert.ok(malformedObservation);
  const observedSnapshot = buildPublicSnapshot([
    ...observedRead.rows,
    ...invalidGateRows,
    malformedObservation,
  ]);
  const confirmedSnapshot = buildPublicSnapshot([
    ...confirmedRead.rows,
    ...invalidGateRows,
    malformedObservation,
  ], OCT22_SYNTHETIC_CONFIRMING_TWEET_ID);
  const observedHistory = observedSnapshot.viewModel.recentHistory;
  const confirmedHistory = confirmedSnapshot.viewModel.recentHistory;
  const eventKeys = [
    `tibo-reset-${OCT20_RESET_TWEET_ID}`,
    OCT22_RESET_EVENT_KEY,
  ];

  for (const key of eventKeys) {
    assert.equal(observedHistory.filter((item) => item.key === key).length, 1, `observed history should contain ${key} once`);
    assert.equal(confirmedHistory.filter((item) => item.key === key).length, 1, `confirmed history should contain ${key} once`);
  }
  assert.deepEqual(
    confirmedHistory.filter((item) => eventKeys.includes(item.key)).map((item) => item.key).sort(),
    observedHistory.filter((item) => eventKeys.includes(item.key)).map((item) => item.key).sort(),
  );
  assert.equal(confirmedHistory.some((item) => item.key.includes("rejected-observation")), false);
  assert.equal(confirmedHistory.some((item) => item.key.includes("regular-observation")), false);
  assert.equal(confirmedHistory.some((item) => item.key.includes("unknown-observation")), false);
  assert.equal(confirmedHistory.some((item) => item.key.includes("malformed-observation")), false);
});
