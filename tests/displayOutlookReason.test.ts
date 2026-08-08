import assert from "node:assert/strict";
import test from "node:test";

import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import {
  getDisplayProbabilityReason,
  getLocalSignalEvaluation,
  type ActiveOfficialNotice,
} from "../lib/radar/probability";
import { getDueRegularResetEventRows } from "../lib/radar/regularResetSchedule";
import type { RegularResetEventRow } from "../lib/radar/regularResetSchedule";
import { calculateRegimeElapsedProbability } from "../lib/radar/regimeElapsedProbability";

const NOW = new Date("2026-08-04T00:00:00.000Z");

function modelContext(
  regimeMultiplier: number,
  elapsedHours: number,
  source: "shadow" | "legacy-shadow-fallback" | "heuristic-fallback" = "shadow",
) {
  return {
    source,
    shadow: {
      regimeElapsed: {
        elapsedHours,
        regime: { regimeMultiplier },
      },
    },
  } as const;
}

function signal(
  teaserStrength: "strong" | "weak" | "none",
  createdAt = "2026-08-03T12:00:00.000Z",
) {
  return {
    tweet_id: `${teaserStrength}-${createdAt}`,
    signal_type: "irrelevant" as const,
    text: "Tibo signal",
    tweet_created_at: createdAt,
    teaser_strength: teaserStrength,
    verification_status: "auto_unverified" as const,
  };
}

function reasonFor({
  locale = "ja" as const,
  signals = [],
  environment = {},
  statusIncidents = {},
  notice = null,
  multiplier = 1,
  elapsedHours = 48,
  source = "shadow" as const,
  now = NOW,
  regularResetEvents = [],
}: {
  locale?: "ja" | "en" | "zh";
  signals?: ReturnType<typeof signal>[];
  environment?: Record<string, number>;
  statusIncidents?: Record<string, number>;
  notice?: ActiveOfficialNotice | null;
  multiplier?: number;
  elapsedHours?: number;
  source?: "shadow" | "legacy-shadow-fallback" | "heuristic-fallback";
  now?: Date;
  regularResetEvents?: RegularResetEventRow[];
} = {}) {
  const data = getLocalRadarData({
    calculationNow: now,
    activeTiboSignals: signals,
    regularResetEvents,
  });
  const baseEvaluation = getLocalSignalEvaluation(data, now);
  const evaluation = {
    ...baseEvaluation,
    environment: { ...baseEvaluation.environment, ...environment },
    statusIncidents: { ...baseEvaluation.statusIncidents, ...statusIncidents },
  };

  return getDisplayProbabilityReason(
    data,
    0.2,
    0.35,
    locale,
    evaluation,
    notice,
    now,
    modelContext(multiplier, elapsedHours, source),
  );
}

const officialNotice: ActiveOfficialNotice = {
  origin: "local",
  id: "display-outlook-notice",
  title: "Reset notice",
  summary: "A reset notice",
  observedAt: NOW.toISOString(),
  expectedAt: null,
  expectedEndAt: null,
  expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  source: null,
  sourceLabel: "test",
};

test("prioritizes official notice, strong teaser, incident, weak teaser, and anomaly", () => {
  assert.equal(reasonFor({ notice: officialNotice, signals: [signal("strong")] }), "公式のリセット予告があります。");
  assert.equal(reasonFor({ signals: [signal("strong")] }), "リセットを匂わせる投稿があり、見込みが上がっています。");
  assert.equal(reasonFor({ statusIncidents: { activeStatusIncidentCount: 1 } }), "Codexで障害が起きており、リセットの可能性が上がっています。");
  assert.equal(reasonFor({ signals: [signal("weak")] }), "リセットを匂わせる投稿があり、見込みが少し上がっています。");
  assert.equal(reasonFor({ environment: { issue_or_limit_anomalies_24h: 1 } }), "利用上限まわりの異常があり、リセットの可能性が少し上がっています。");
});

test("renders all nine regime and elapsed outlook buckets", () => {
  const cases = [
    [0.8, 12, "前回のリセットからまだ時間が浅く、最近のリセットも少なめです。"],
    [0.8, 48, "最近はリセットが少なく、見込みは低めです。"],
    [0.8, 96, "前回のリセットから時間はたっていますが、最近のリセットは少なめです。"],
    [1, 12, "前回のリセットからまだ時間が浅く、短期の見込みは低めです。"],
    [1, 48, "前回のリセットから少し時間がたち、リセット直後より起こりやすくなっています。"],
    [1, 96, "前回のリセットから時間がたっており、リセットの見込みは上がっています。"],
    [1.3, 12, "最近はリセットが続いていますが、前回のリセットからまだ時間が浅い状態です。"],
    [1.3, 48, "最近はリセットが続いており、いつもより起こりやすい状態です。"],
    [1.3, 96, "最近はリセットが続いており、リセットの見込みは高めです。"],
  ] as const;

  for (const [multiplier, elapsedHours, expected] of cases) {
    assert.equal(reasonFor({ multiplier, elapsedHours }), expected);
  }
});

test("uses the same outlook buckets in English and Chinese", () => {
  assert.equal(
    reasonFor({ locale: "en", multiplier: 1, elapsedHours: 48 }),
    "Some time has passed since the last reset, making a reset more likely than just after a reset.",
  );
  assert.equal(
    reasonFor({ locale: "zh", multiplier: 1, elapsedHours: 48 }),
    "距离上次重置已有一段时间，比重置刚结束时更容易发生。",
  );
});

test("does not use regime diagnostics when the published model falls back", () => {
  assert.equal(
    reasonFor({ source: "legacy-shadow-fallback", multiplier: 1.5, elapsedHours: 96 }),
    "現在、大きな変化は確認されていません。",
  );
});

test("returns an unavailable explanation when radar data is missing", () => {
  assert.equal(
    getDisplayProbabilityReason(null, undefined, undefined, "ja", undefined, null, NOW),
    "現在の見込みを確認できません。",
  );
});

test("a completed regular boundary consumes an earlier teaser without becoming a random event", () => {
  const regularAt = "2026-08-08T03:32:00.000Z";
  const regularReset = getDueRegularResetEventRows(new Date(regularAt))[0];
  const now = new Date("2026-08-08T04:00:00.000Z");

  assert.equal(
    reasonFor({
      now,
      regularResetEvents: [regularReset],
      signals: [signal("strong", "2026-08-08T02:00:00.000Z")],
      multiplier: 0.8,
      elapsedHours: 0.5,
    }),
    "前回のリセットからまだ時間が浅く、最近のリセットも少なめです。",
  );
});

test("regular recovery boundaries do not increase the random event count", () => {
  const regularAt = "2026-08-08T03:32:00.000Z";
  const regularReset = getDueRegularResetEventRows(new Date(regularAt))[0];
  const now = new Date("2026-08-08T04:00:00.000Z");
  const withoutRegular = calculateRegimeElapsedProbability(
    getLocalRadarData({ calculationNow: now }),
    { now },
  );
  const withRegular = calculateRegimeElapsedProbability(
    getLocalRadarData({ calculationNow: now, regularResetEvents: [regularReset] }),
    { now },
  );

  assert.equal(
    withRegular.regimeElapsed.randomBoundaryCount,
    withoutRegular.regimeElapsed.randomBoundaryCount,
  );
  assert.ok(
    withRegular.regimeElapsed.regularBoundaryCount >=
      withoutRegular.regimeElapsed.regularBoundaryCount,
  );
});

test("display reasoning does not change public probabilities", () => {
  const data = getLocalRadarData({ calculationNow: NOW });
  const before = getRadarViewModel(data, "ja", false, undefined, NOW);

  getDisplayProbabilityReason(
    data,
    before.probability24h,
    before.probability48h,
    "ja",
    getLocalSignalEvaluation(data, NOW),
    null,
    NOW,
    modelContext(0.8, 12),
  );

  const after = getRadarViewModel(data, "ja", false, undefined, NOW);

  assert.deepEqual(
    {
      probability12h: after.probability12h,
      probability24h: after.probability24h,
      probability48h: after.probability48h,
      probability72h: after.probability72h,
    },
    {
      probability12h: before.probability12h,
      probability24h: before.probability24h,
      probability48h: before.probability48h,
      probability72h: before.probability72h,
    },
  );
});
