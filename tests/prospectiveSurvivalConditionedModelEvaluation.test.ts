import assert from "node:assert/strict";
import test from "node:test";

import {
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  SURVIVAL_CONDITIONED_FREEZE_AT,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  SURVIVAL_CONTEXT_BURST_MODEL_VERSION,
  SURVIVAL_CONTEXT_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_OLD_REGIME_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_MODEL_VERSION,
} from "@/data/shadowProbabilityConfig";
import {
  evaluateProspectiveSurvivalConditionedModel,
  selectComparableSurvivalOrigins,
  SURVIVAL_PROSPECTIVE_EVALUATION_MODEL_VERSIONS,
} from "@/lib/radar/prospectiveSurvivalConditionedModelEvaluation";
import type { ProspectiveForecastRow } from "@/lib/radar/prospectiveProbabilityEvaluation";
import type { RecoveryResetBoundary } from "@/lib/radar/recoveryBoundary";

const MODEL_VERSIONS = [...SURVIVAL_PROSPECTIVE_EVALUATION_MODEL_VERSIONS];

function makeRow(
  generatedAt: string,
  index: number,
  ageHours: number | null,
): ProspectiveForecastRow {
  const forecasts = Object.fromEntries(MODEL_VERSIONS.map((modelVersion, modelIndex) => [
    modelVersion,
    {
      modelVersion,
      generatedAt,
      probability12h: 0.04 + modelIndex * 0.01 + index * 0.002,
      probability24h: 0.08 + modelIndex * 0.01 + index * 0.002,
      probability48h: 0.16 + modelIndex * 0.01 + index * 0.002,
      survivalConditioned: modelVersion === SURVIVAL_CONDITIONED_MODEL_VERSION
        ? { randomElapsedHours: ageHours }
        : undefined,
    },
  ]));
  return {
    generatedAt,
    forecasts: forecasts as ProspectiveForecastRow["forecasts"],
  };
}

function boundary(id: string, resetAt: string): RecoveryResetBoundary {
  return {
    id,
    resetAt,
    isRandom: true,
    isRegular: false,
    sourceIds: [id],
  };
}

const boundaries = [
  boundary("r0", "2026-09-18T00:00:00.000Z"),
  boundary("r1", "2026-09-19T03:00:00.000Z"),
  boundary("r2", "2026-09-20T12:00:00.000Z"),
  boundary("r3", "2026-09-22T06:00:00.000Z"),
];

test("uses one post-freeze six-hour common origin set for every model", () => {
  const rows = [
    makeRow(SURVIVAL_CONDITIONED_FREEZE_AT, 0, 20),
    makeRow("2026-09-19T00:00:00.000Z", 1, 30),
    makeRow("2026-09-19T01:00:00.000Z", 2, 31),
    makeRow("2026-09-19T06:00:00.000Z", 3, 36),
    makeRow("2026-09-20T00:00:00.000Z", 4, 48),
    makeRow("2026-09-20T18:00:00.000Z", 5, 66),
    makeRow("2026-09-21T00:00:00.000Z", 6, null),
    makeRow("2026-09-25T00:00:00.000Z", 7, 162),
  ];
  const asOf = new Date("2026-09-24T00:00:00.000Z");
  const selected = selectComparableSurvivalOrigins(rows, asOf);

  assert.deepEqual(
    selected.map((row) => row.generatedAt),
    [
      SURVIVAL_CONDITIONED_FREEZE_AT,
      "2026-09-19T00:00:00.000Z",
      "2026-09-19T06:00:00.000Z",
      "2026-09-20T00:00:00.000Z",
      "2026-09-20T18:00:00.000Z",
      "2026-09-21T00:00:00.000Z",
    ],
  );
  assert.equal(selected.some((row) => row.generatedAt === "2026-09-19T01:00:00.000Z"), false);
  assert.equal(selected.some((row) => row.generatedAt === "2026-09-25T00:00:00.000Z"), false);
});

test("reports metrics, saved-age segments, non-overlap references, and block intervals", () => {
  const rows = [
    makeRow("2026-09-19T00:00:00.000Z", 1, 30),
    makeRow("2026-09-19T06:00:00.000Z", 2, 36),
    makeRow("2026-09-20T00:00:00.000Z", 3, 48),
    makeRow("2026-09-20T18:00:00.000Z", 4, 66),
    makeRow("2026-09-21T00:00:00.000Z", 5, null),
  ];
  const report = evaluateProspectiveSurvivalConditionedModel(
    rows,
    boundaries,
    new Date("2026-09-24T00:00:00.000Z"),
  );
  const base = report.models[SURVIVAL_CONDITIONED_MODEL_VERSION];
  const broad = report.models[BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION];

  assert.equal(report.status, "available");
  assert.equal(report.forecastCounts.commonComparable, 5);
  assert.equal(base.comparableOriginCount, broad.comparableOriginCount);
  assert.equal(base.metrics["24h"].count, 5);
  assert.equal(base.metrics["24h"].ageBuckets["unknown"].count, 1);
  assert.equal(base.metrics["24h"].ageBuckets["24-48h"].count, 2);
  assert.ok(base.metrics["24h"].nonOverlapping.count <= base.metrics["24h"].count);
  assert.ok(base.metrics["24h"].blockBootstrap.blockCount >= 2);
  assert.ok(base.metrics["24h"].blockBootstrap.brier !== null);
  assert.equal(base.metrics["12h"].horizonHours, 12);
  assert.equal(base.metrics["48h"].horizonHours, 48);
  assert.equal(
    report.comparisonToBroadBankedV2[SURVIVAL_CONTEXT_BURST_MODEL_VERSION]["24h"].brier !== undefined,
    true,
  );
  assert.match(report.notes.join("\n"), /not treated as IID/);
});

test("does not reconstruct missing survival age from current or generated timestamps", () => {
  const row = makeRow("2026-09-19T00:00:00.000Z", 1, null);
  const report = evaluateProspectiveSurvivalConditionedModel(
    [row],
    boundaries,
    new Date("2026-09-24T00:00:00.000Z"),
  );
  assert.equal(
    report.models[SURVIVAL_CONDITIONED_MODEL_VERSION].metrics["24h"].ageBuckets.unknown.count,
    1,
  );
  assert.equal(
    report.models[SURVIVAL_CONDITIONED_MODEL_VERSION].metrics["24h"].ageBuckets["0-24h"].count,
    0,
  );
});

test("keeps the model inventory limited to the base, five arms, and broad v2", () => {
  assert.deepEqual(MODEL_VERSIONS, [
    SURVIVAL_CONDITIONED_MODEL_VERSION,
    SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_MODEL_VERSION,
    SURVIVAL_CONTEXT_CIRCADIAN_MODEL_VERSION,
    SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_CIRCADIAN_MODEL_VERSION,
    SURVIVAL_CONTEXT_BURST_MODEL_VERSION,
    SURVIVAL_CONTEXT_OLD_REGIME_MODEL_VERSION,
    BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  ]);
});
