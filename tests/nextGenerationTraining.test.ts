import assert from "node:assert/strict";
import test from "node:test";

import {
  NEXT_GENERATION_A_COMPONENT_VERSIONS,
  NEXT_GENERATION_B_MODEL_VERSION,
  NEXT_GENERATION_FREEZE_AT,
} from "../data/shadowProbabilityConfig";
import {
  loadNextGenerationTrainingState,
  parseNextGenerationTrainingRows,
} from "../lib/radar/nextGenerationTraining";

const componentForecasts = Object.fromEntries(
  NEXT_GENERATION_A_COMPONENT_VERSIONS.map((modelVersion, index) => [modelVersion, {
    modelVersion,
    generatedAt: "2026-08-22T00:00:00.000Z",
    probability24h: 0.1 + index * 0.02,
    probability48h: 0.2 + index * 0.02,
  }]),
);

function historyRow(generatedAt = "2026-08-22T00:00:00.000Z") {
  return {
    logged_hour: generatedAt,
    debug_info: {
      calculated_at: generatedAt,
      experimentalProbabilityForecasts: {
        ...componentForecasts,
        [NEXT_GENERATION_B_MODEL_VERSION]: {
          ...componentForecasts[NEXT_GENERATION_B_MODEL_VERSION],
          modelVersion: NEXT_GENERATION_B_MODEL_VERSION,
          generatedAt,
          rawProbability24h: 0.22,
          rawProbability48h: 0.44,
          probability24h: 0.25,
          probability48h: 0.45,
        },
      },
    },
  };
}

test("training parser excludes pre-freeze rows and labels only random boundaries", () => {
  const rows = parseNextGenerationTrainingRows(
    [
      historyRow("2026-08-21T03:26:00.000Z"),
      historyRow(),
    ],
    {
      asOf: new Date("2026-08-23T01:00:00.000Z"),
      randomEvents: [{ id: "random-1", resetAt: "2026-08-22T12:00:00.000Z" }],
    },
  );

  assert.equal(rows.bRows.length, 1);
  assert.equal(rows.aRows.length, 1);
  assert.equal(rows.bRows[0].rawProbability24h, 0.22);
  assert.equal(rows.bRows[0].actual24h, true);
  assert.equal(rows.bRows[0].actual48h, undefined);
  assert.deepEqual(Object.keys(rows.aRows[0].components), [...NEXT_GENERATION_A_COMPONENT_VERSIONS]);
  assert.equal(rows.skipReasons.pre_freeze, 1);
  assert.equal(rows.backfill, false);
  assert.equal(NEXT_GENERATION_FREEZE_AT < rows.aRows[0].generatedAt, true);
});

test("training parser rejects incomplete A components without weakening B", () => {
  const row = historyRow();
  delete (row.debug_info.experimentalProbabilityForecasts as Record<string, unknown>)[NEXT_GENERATION_A_COMPONENT_VERSIONS[2]];
  const parsed = parseNextGenerationTrainingRows([row], {
    asOf: new Date("2026-08-24T00:00:00.000Z"),
    randomEvents: [],
  });

  assert.equal(parsed.bRows.length, 1);
  assert.equal(parsed.aRows.length, 0);
  assert.equal(parsed.skipReasons.incomplete_a_components, 1);
});

test("training query distinguishes successful empty reads from query failures", async () => {
  const calls: string[] = [];
  const emptyClient = {
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        select(fields: string) {
          calls.push(`select:${fields}`);
          return {
            gte(column: string, value: string) {
              calls.push(`gte:${column}:${value}`);
              return {
                lt(nextColumn: string, nextValue: string) {
                  calls.push(`lt:${nextColumn}:${nextValue}`);
                  return {
                    order(orderColumn: string) {
                      calls.push(`order:${orderColumn}`);
                      return {
                        limit() {
                          return Promise.resolve({ data: [], error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const empty = await loadNextGenerationTrainingState(emptyClient, {
    asOf: new Date("2026-08-24T00:00:00.000Z"),
    randomEvents: [],
  });
  assert.equal(empty.status, "ok");
  assert.equal(empty.bRows.length, 0);
  assert.equal(empty.aRows.length, 0);
  assert.equal(empty.backfill, false);
  assert.deepEqual(calls.slice(0, 3), [
    "from:prediction_history",
    "select:logged_hour,debug_info",
    "gte:logged_hour:2026-08-21T03:00:00.000Z",
  ]);

  const failed = await loadNextGenerationTrainingState({
    from() {
      throw new Error("query failed");
    },
  }, {
    asOf: new Date("2026-08-24T00:00:00.000Z"),
    randomEvents: [],
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.bRows.length, 0);
  assert.equal(failed.aRows.length, 0);
});
