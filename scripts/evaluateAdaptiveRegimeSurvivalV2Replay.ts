import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
} from "../data/shadowProbabilityConfig";
import {
  calculateAdaptiveRegimeBaseline,
  getAdaptiveRegimeRandomBoundaries,
} from "../lib/radar/adaptiveRegimeSurvivalProbability";
import {
  buildSurvivalConditionedHazard,
  integrateSurvivalConditionedHazard,
} from "../lib/radar/survivalConditionedProbability";
import type { RecoveryBoundaryAudit } from "../lib/radar/recoveryBoundary";
import { applyOddsMultiplier, type ShadowProbabilityHorizons } from "../lib/radar/shadowProbability";
import {
  applyTimedTeaserProbabilityReallocationFromAudit,
  type TimedTeaserReallocationAudit,
} from "../lib/radar/timedTeaserProbability";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const V1_KEY = SURVIVAL_CONDITIONED_MODEL_VERSION;
const BURST_KEY = "hazard-survival-conditioned-context-burst-v1";
const OLD_REGIME_KEY = "hazard-survival-conditioned-context-old-regime-v1";
const FORECAST_POLICY = "teaser-temporal-reallocation-v2";
const TEEZER_POLICY = "teaser-temporal-reallocation-v2";
const REPLAY_TOLERANCE = 1e-9;

type SavedAuditRow = [number, number, number, number[], Array<[number, number]>];
type ForecastRow = {
  id: number;
  generated_at: string;
  official_notice: boolean;
  saved_forecasts: Record<string, Record<string, unknown>>;
  probability_24h: number;
  probability_48h: number;
};
type Evidence = {
  asOf: string;
  campaignStart: string;
  forecasts: ForecastRow[];
  boundaryAudit: { boundaries: Array<{
    id: string;
    resetAt: string;
    included: boolean;
    randomEligible: boolean;
  }> };
};
type ReplayRow = {
  id: number;
  originMs: number;
  officialNotice: boolean;
  ageHours: number;
  auditRow: SavedAuditRow;
  v1: ShadowProbabilityHorizons;
  v2: ShadowProbabilityHorizons;
  v1ReplayMaxError: number;
  v1BaselineMaxError: number;
  hazardRateError: number;
  ageErrorHours: number;
};
type ScoreRow = { p: number; y: number; originMs: number; resetCycle: string };

const HORIZONS = [12, 24, 48, 72] as const;

function number(value: unknown, label: string) {
  assert.equal(typeof value, "number", `${label} must be numeric`);
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  return value as number;
}

function closeEnough(left: number, right: number, tolerance = REPLAY_TOLERANCE) {
  return Math.abs(left - right) <= tolerance;
}

function auditBoundaries(row: SavedAuditRow): RecoveryBoundaryAudit[] {
  return row[4].map(([time, flags], index) => ({
    id: `saved-boundary-${index}`,
    resetAt: new Date(time).toISOString(),
    included: true,
    randomEligible: (flags & 1) !== 0,
    regularEligible: (flags & 2) !== 0,
    reason: (flags & 1) !== 0 ? "random_boundary" : "regular_boundary",
  }));
}

function horizonValues(values: number[]): ShadowProbabilityHorizons {
  return {
    probability12h: values[0],
    probability24h: values[1],
    probability48h: values[2],
    probability72h: values[3],
  };
}

function savedTeaserAudit(values: number[]): TimedTeaserReallocationAudit | null {
  const weight = values[18];
  const cdfValues = values.slice(19, 23);
  if (weight === null || weight === undefined || !cdfValues.every(Number.isFinite)) return null;
  return {
    policyVersion: TEEZER_POLICY,
    applied: true,
    contextDependence: null,
    timedEvidenceClass: null,
    reallocationWeight: weight,
    temporalPrecision: null,
    cdf: horizonValues(cdfValues),
  };
}

function v1Replay(row: SavedAuditRow, origin: Date, override: boolean) {
  const saved = row[3];
  const multipliers = { probability24h: saved[11], probability48h: saved[12] };
  const boundaryAudit = auditBoundaries(row);
  const randomBoundaries = getAdaptiveRegimeRandomBoundaries(boundaryAudit, origin);
  const hazard = buildSurvivalConditionedHazard(randomBoundaries, origin);
  const randomElapsedHours = randomBoundaries.length === 0
    ? 0
    : Math.max(0, (origin.getTime() - Date.parse(randomBoundaries.at(-1)!.resetAt)) / HOUR_MS);
  const baseline = {
    probability12h: integrateSurvivalConditionedHazard(hazard, randomElapsedHours, 12),
    probability24h: integrateSurvivalConditionedHazard(hazard, randomElapsedHours, 24),
    probability48h: integrateSurvivalConditionedHazard(hazard, randomElapsedHours, 48),
    probability72h: integrateSurvivalConditionedHazard(hazard, randomElapsedHours, 72),
  };
  const ordinary = {
    probability12h: applyOddsMultiplier(baseline.probability12h, multipliers.probability24h),
    probability24h: applyOddsMultiplier(baseline.probability24h, multipliers.probability24h),
    probability48h: applyOddsMultiplier(baseline.probability48h, multipliers.probability48h),
    probability72h: applyOddsMultiplier(baseline.probability72h, multipliers.probability48h),
  };
  const replayed = applyTimedTeaserProbabilityReallocationFromAudit(
    ordinary,
    savedTeaserAudit(saved),
  ).predictions;
  const published = horizonValues(saved.slice(14, 18));
  return {
    hazard,
    boundaryAudit,
    randomElapsedHours,
    baseline,
    predictions: override ? published : replayed,
    published,
  };
}

function v2Replay(row: SavedAuditRow, origin: Date, base: ReturnType<typeof v1Replay>, override: boolean) {
  const adaptive = calculateAdaptiveRegimeBaseline(
    base.hazard,
    base.randomElapsedHours,
    base.boundaryAudit,
    origin,
  );
  if (!adaptive.baseline) return null;
  const saved = row[3];
  const ordinary = {
    probability12h: applyOddsMultiplier(adaptive.baseline.probability12h, saved[11]),
    probability24h: applyOddsMultiplier(adaptive.baseline.probability24h, saved[11]),
    probability48h: applyOddsMultiplier(adaptive.baseline.probability48h, saved[12]),
    probability72h: applyOddsMultiplier(adaptive.baseline.probability72h, saved[12]),
  };
  const adjusted = applyTimedTeaserProbabilityReallocationFromAudit(
    ordinary,
    savedTeaserAudit(saved),
  ).predictions;
  return {
    predictions: override ? horizonValues(saved.slice(14, 18)) : adjusted,
    baseline: adaptive.baseline,
    rateState: adaptive.state,
  };
}

function maxError(left: ShadowProbabilityHorizons, right: ShadowProbabilityHorizons) {
  return Math.max(...HORIZONS.map((horizon) =>
    Math.abs(left[`probability${horizon}h`] - right[`probability${horizon}h`]),
  ));
}

function score(rows: ScoreRow[]) {
  if (rows.length === 0) return { n: 0, positive: 0, mean: null, rate: null, brier: null, logLoss: null };
  const n = rows.length;
  const positive = rows.reduce((sum, row) => sum + row.y, 0);
  return {
    n,
    positive,
    mean: rows.reduce((sum, row) => sum + row.p, 0) / n,
    rate: positive / n,
    brier: rows.reduce((sum, row) => sum + (row.p - row.y) ** 2, 0) / n,
    logLoss: -rows.reduce((sum, row) =>
      sum + row.y * Math.log(Math.max(1e-12, row.p))
        + (1 - row.y) * Math.log(Math.max(1e-12, 1 - row.p)), 0) / n,
  };
}

function metricRows(
  rows: ReplayRow[],
  horizon: number,
  asOfMs: number,
  boundaries: Evidence["boundaryAudit"]["boundaries"],
  target: "broad" | "forced-only" = "broad",
): Array<ScoreRow & { v1: number; v2: number; officialNotice: boolean; ageHours: number }> {
  const key = `probability${horizon}h` as keyof ShadowProbabilityHorizons;
  const randomBoundaries = boundaries
    .filter((boundary) => boundary.included && boundary.randomEligible)
    .map((boundary) => ({ boundary, time: Date.parse(boundary.resetAt) }))
    .sort((left, right) => left.time - right.time);
  return rows.flatMap((row) => {
    if (row.originMs + horizon * HOUR_MS > asOfMs) return [];
    const end = row.originMs + horizon * HOUR_MS;
    const occurred = randomBoundaries.some(({ boundary, time }) => {
      if (target === "forced-only" && boundary.id.startsWith("banked-reset-")) return false;
      return time > row.originMs && time <= end;
    });
    const nextReset = randomBoundaries.find(({ time }) => time > row.originMs);
    const resetCycle = nextReset?.boundary.id ?? "right-censored-tail";
    return [{
      p: row.v1[key],
      y: occurred ? 1 : 0,
      originMs: row.originMs,
      resetCycle,
      v1: row.v1[key],
      v2: row.v2[key],
      officialNotice: row.officialNotice,
      ageHours: row.ageHours,
    }];
  });
}

function scorePair(rows: Array<ScoreRow & { v1: number; v2: number }>) {
  return { v1: score(rows.map((row) => ({ ...row, p: row.v1 }))), v2: score(rows.map((row) => ({ ...row, p: row.v2 }))) };
}

function sliceRows(
  rows: Array<ScoreRow & { v1: number; v2: number; officialNotice: boolean; ageHours: number }>,
  name: string,
  campaignMs: number,
  recent7Ms: number,
) {
  switch (name) {
    case "campaign": return rows.filter((row) => row.originMs >= campaignMs);
    case "preCampaign": return rows.filter((row) => row.originMs < campaignMs);
    case "recent7": return rows.filter((row) => row.originMs >= recent7Ms);
    case "noNotice": return rows.filter((row) => !row.officialNotice);
    case "ageUnder24h": return rows.filter((row) => row.ageHours < 24);
    default: return rows;
  }
}

function pairedDifference(rows: Array<ScoreRow & { v1: number; v2: number }>) {
  if (rows.length === 0) return null;
  return rows.reduce((sum, row) => sum + ((row.v2 - row.y) ** 2 - (row.v1 - row.y) ** 2), 0) / rows.length;
}

function cycleBootstrap(rows: Array<ScoreRow & { v1: number; v2: number }>, seed: number) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = groups.get(row.resetCycle) ?? [];
    group.push(row);
    groups.set(row.resetCycle, group);
  }
  const blocks = Array.from(groups.values());
  if (blocks.length === 0) return { groups: 0, draws: 0, deltaBrier: null, ci95: null, pV2Better: null };
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const values: number[] = [];
  for (let draw = 0; draw < 2000; draw += 1) {
    const sample: typeof rows = [];
    for (let index = 0; index < blocks.length; index += 1) {
      sample.push(...blocks[Math.floor(random() * blocks.length)]);
    }
    const delta = pairedDifference(sample);
    if (delta !== null) values.push(delta);
  }
  values.sort((a, b) => a - b);
  return {
    groups: blocks.length,
    draws: values.length,
    deltaBrier: pairedDifference(rows),
    ci95: [values[Math.floor(values.length * 0.025)], values[Math.min(values.length - 1, Math.floor(values.length * 0.975))]],
    pV2Better: values.filter((value) => value < 0).length / values.length,
  };
}

function nonoverlapRows(rows: Array<ScoreRow & { v1: number; v2: number }>, horizon: number) {
  const selected: typeof rows = [];
  let nextAvailable = Number.NEGATIVE_INFINITY;
  for (const row of [...rows].sort((left, right) => left.originMs - right.originMs)) {
    if (row.originMs < nextAvailable) continue;
    selected.push(row);
    nextAvailable = row.originMs + horizon * HOUR_MS;
  }
  return selected;
}

function run() {
  const evidencePath = resolve(process.argv[2] ?? "");
  const auditPath = resolve(process.argv[3] ?? "");
  assert.ok(process.argv[2] && process.argv[3], "Usage: tsx scripts/evaluateAdaptiveRegimeSurvivalV2Replay.ts <evidence.json> <pit-audit.json>");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Evidence;
  const auditRows = JSON.parse(readFileSync(auditPath, "utf8")) as SavedAuditRow[];
  const auditById = new Map(auditRows.map((row) => [row[0], row]));
  const asOfMs = Date.parse(evidence.asOf);
  const campaignMs = Date.parse(evidence.campaignStart);
  const eligible = evidence.forecasts.filter((row) =>
    [V1_KEY, BURST_KEY, OLD_REGIME_KEY].every((model) =>
      row.saved_forecasts[model]?.forecastPolicyVersion === FORECAST_POLICY
      && row.saved_forecasts[model]?.generatedAt === row.generated_at,
    ),
  ).sort((left, right) => Date.parse(left.generated_at) - Date.parse(right.generated_at));
  const buckets = new Map<number, ForecastRow>();
  for (const row of eligible) {
    const bucket = Math.floor(Date.parse(row.generated_at) / (6 * HOUR_MS));
    if (!buckets.has(bucket)) buckets.set(bucket, row);
  }
  const origins = Array.from(buckets.values());
  assert.equal(evidence.forecasts.length, 139);
  assert.equal(eligible.length, 136);
  assert.equal(origins.length, 127);

  const compatible: ReplayRow[] = [];
  const incompatible: Array<{ id: number; reasons: string[]; v1ReplayMaxError: number | null; v1BaselineMaxError: number | null }> = [];
  for (const forecast of origins) {
    const auditRow = auditById.get(forecast.id);
    if (!auditRow) {
      incompatible.push({ id: forecast.id, reasons: ["missing_compact_saved_audit"], v1ReplayMaxError: null, v1BaselineMaxError: null });
      continue;
    }
    const originMs = Date.parse(forecast.generated_at);
    const origin = new Date(originMs);
    const saved = auditRow[3];
    const ageHours = number(saved[8], `row ${forecast.id} age`);
    const override = saved[13] === 1;
    const base = v1Replay(auditRow, origin, override);
    const v2 = v2Replay(auditRow, origin, base, override);
    if (!v2) {
      incompatible.push({ id: forecast.id, reasons: ["invalid_v2_baseline"], v1ReplayMaxError: null, v1BaselineMaxError: null });
      continue;
    }
    const savedForecast = (override ? saved.slice(14, 18) : saved.slice(0, 4)) as number[];
    const savedBaseline = saved.slice(4, 8) as number[];
    const replayError = maxError(base.predictions, horizonValues(savedForecast));
    const baselineError = maxError(base.baseline, horizonValues(savedBaseline));
    const hazardRateError = Math.abs(base.hazard.longTermHazardPerHour - number(saved[9], `row ${forecast.id} long-term hazard`));
    const ageErrorHours = Math.abs(base.randomElapsedHours - ageHours);
    const reasons: string[] = [];
    if (replayError > REPLAY_TOLERANCE) reasons.push("saved_v1_forecast_mismatch");
    if (baselineError > REPLAY_TOLERANCE) reasons.push("saved_v1_baseline_mismatch");
    if (hazardRateError > REPLAY_TOLERANCE) reasons.push("saved_v1_long_term_hazard_mismatch");
    if (ageErrorHours > 1e-9) reasons.push("saved_v1_random_age_mismatch");
    if (base.hazard.completedIntervalCount !== number(saved[10], `row ${forecast.id} completed intervals`)) {
      reasons.push("saved_v1_interval_count_mismatch");
    }
    if (reasons.length > 0) {
      incompatible.push({ id: forecast.id, reasons, v1ReplayMaxError: replayError, v1BaselineMaxError: baselineError });
      continue;
    }
    compatible.push({
      id: forecast.id,
      originMs,
      officialNotice: forecast.official_notice,
      ageHours,
      auditRow,
      v1: base.predictions,
      v2: v2.predictions,
      v1ReplayMaxError: replayError,
      v1BaselineMaxError: baselineError,
      hazardRateError,
      ageErrorHours,
    });
  }

  const periods = ["all", "campaign", "preCampaign", "recent7", "noNotice", "ageUnder24h"] as const;
  const scored: Record<string, unknown> = {};
  const scoredRowsByHorizon = new Map<number, ReturnType<typeof metricRows>>();
  for (const horizon of HORIZONS) {
    const all = metricRows(compatible, horizon, asOfMs, evidence.boundaryAudit.boundaries);
    scoredRowsByHorizon.set(horizon, all);
    const periodResults: Record<string, unknown> = {};
    for (const period of periods) {
      const rows = sliceRows(all, period, campaignMs, asOfMs - 7 * DAY_MS);
      periodResults[period] = scorePair(rows);
    }
    const forcedRows = metricRows(compatible, horizon, asOfMs, evidence.boundaryAudit.boundaries, "forced-only");
    periodResults.forcedOnlySensitivity = scorePair(forcedRows);
    const nonoverlap = nonoverlapRows(all, horizon);
    periodResults.nonoverlap = scorePair(nonoverlap);
    periodResults.nonoverlapCount = nonoverlap.length;
    scored[String(horizon)] = periodResults;
  }

  const bootstrap: Record<string, unknown> = {};
  for (const horizon of [24, 48]) {
    const rows = scoredRowsByHorizon.get(horizon)!;
    bootstrap[String(horizon)] = Object.fromEntries(["all", "campaign", "noNotice"].map((period, index) => {
      const sliced = sliceRows(rows, period, campaignMs, asOfMs - 7 * DAY_MS);
      return [period, cycleBootstrap(sliced, 0x5eed2026 + horizon * 100 + index)];
    }));
  }

  const h24 = scored["24"] as Record<string, any>;
  const h48 = scored["48"] as Record<string, any>;
  const gateChecks = {
    fullBrierImproves24h: (h24.all.v2.brier as number) < (h24.all.v1.brier as number),
    fullBrierImproves48h: (h48.all.v2.brier as number) < (h48.all.v1.brier as number),
    campaignBrierImproves24h: (h24.campaign.v2.brier as number) < (h24.campaign.v1.brier as number),
    campaignBrierImproves48h: (h48.campaign.v2.brier as number) < (h48.campaign.v1.brier as number),
    noNoticeBrierImproves24h: (h24.noNotice.v2.brier as number) < (h24.noNotice.v1.brier as number),
    noNoticeBrierImproves48h: (h48.noNotice.v2.brier as number) < (h48.noNotice.v1.brier as number),
    preCampaignDegradation24hWithin005: (h24.preCampaign.v2.brier as number) - (h24.preCampaign.v1.brier as number) <= 0.005,
    preCampaignDegradation48hWithin005: (h48.preCampaign.v2.brier as number) - (h48.preCampaign.v1.brier as number) <= 0.005,
    campaignLogLossImproves24h: (h24.campaign.v2.logLoss as number) < (h24.campaign.v1.logLoss as number),
    campaignLogLossImproves48h: (h48.campaign.v2.logLoss as number) < (h48.campaign.v1.logLoss as number),
    fullLogLossNoWorse24h: (h24.all.v2.logLoss as number) <= (h24.all.v1.logLoss as number),
    fullLogLossNoWorse48h: (h48.all.v2.logLoss as number) <= (h48.all.v1.logLoss as number),
  };
  const allGatesPass = Object.values(gateChecks).every(Boolean);
  const report = {
    schemaVersion: "adaptive-regime-survival-v2-pit-replay-v1",
    modelVersion: ADAPTIVE_REGIME_SURVIVAL_MODEL_VERSION,
    evaluationMode: "retrospective-point-in-time-replay",
    prospective: false,
    sourceEvidence: basename(evidencePath),
    compactAuditRows: auditRows.length,
    rawForecastRows: evidence.forecasts.length,
    policyMatchedRows: eligible.length,
    sixHourOrigins: origins.length,
    compatibleOrigins: compatible.length,
    incompatibleOrigins: incompatible,
    asOf: evidence.asOf,
    campaignStart: evidence.campaignStart,
    canonicalRandomEventCount: evidence.boundaryAudit.boundaries.filter((event) => event.included && event.randomEligible).length,
    v1Replay: {
      tolerance: REPLAY_TOLERANCE,
      maxForecastError: Math.max(0, ...compatible.map((row) => row.v1ReplayMaxError)),
      maxBaselineError: Math.max(0, ...compatible.map((row) => row.v1BaselineMaxError)),
      maxLongTermHazardError: Math.max(0, ...compatible.map((row) => row.hazardRateError)),
      maxRandomAgeErrorHours: Math.max(0, ...compatible.map((row) => row.ageErrorHours)),
      passed: incompatible.length === 0 && compatible.length === origins.length,
    },
    metrics: scored,
    resetCycleBootstrap: { draws: 2000, groupDefinition: "first canonical random boundary after each origin; censored tail grouped separately", results: bootstrap },
    publicationGate: { checks: gateChecks, passed: allGatesPass },
    sensitivities: {
      forcedOnly: "Scored separately by excluding banked-reset-* outcomes; broad target remains primary.",
      manualSept26: "Not recomputed: the frozen evidence contains only aggregate v1 sensitivity metrics, not the manual event timestamp needed to score new v2 origins. It remains excluded from the primary gate.",
      recent7: "Descriptive only; it is not an independent holdout.",
    },
    limitations: [
      "Rows are retrospective PIT replays from saved v1 boundary and policy audits, not saved v2 forecasts or prospective evidence.",
      "The canonical reset audit may omit unobserved real-world events; overlapping six-hour origins are dependent.",
      "Reset-cycle bootstrap uncertainty does not remove model-selection uncertainty.",
    ],
  };

  const outputDir = resolve("reports/probability");
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = resolve(outputDir, "adaptive-regime-survival-v2-pit-replay.json");
  const markdownPath = resolve(outputDir, "adaptive-regime-survival-v2-pit-replay.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  const lines = [
    "# Adaptive Regime Survival v2 point-in-time replay",
    "",
    `- Mode: retrospective PIT replay, not prospective or saved v2 forecasts` ,
    `- Origins: ${compatible.length}/${origins.length}; mature rows are horizon-specific`,
    `- v1 replay: ${report.v1Replay.passed ? "passed" : "failed"}; max final error ${report.v1Replay.maxForecastError}; max baseline error ${report.v1Replay.maxBaselineError}`,
    `- Publication gate: ${allGatesPass ? "passed" : "failed"}`,
    "",
    "| Horizon | Slice | n v1/v2 | Brier v1 | Brier v2 | Log loss v1 | Log loss v2 |",
    "|---:|---|---:|---:|---:|---:|---:|",
  ];
  for (const horizon of HORIZONS) {
    const slices = scored[String(horizon)] as Record<string, any>;
    for (const period of ["all", "campaign", "preCampaign", "recent7", "noNotice", "ageUnder24h", "forcedOnlySensitivity", "nonoverlap"]) {
      const pair = slices[period];
      if (!pair?.v1 || !pair?.v2) continue;
      lines.push(`| ${horizon}h | ${period} | ${pair.v1.n}/${pair.v2.n} | ${pair.v1.brier?.toFixed(6) ?? "n/a"} | ${pair.v2.brier?.toFixed(6) ?? "n/a"} | ${pair.v1.logLoss?.toFixed(6) ?? "n/a"} | ${pair.v2.logLoss?.toFixed(6) ?? "n/a"} |`);
    }
  }
  lines.push("", "## Gate checks", "", ...Object.entries(gateChecks).map(([name, passed]) => `- ${passed ? "PASS" : "FAIL"}: ${name}`), "", "## Reset-cycle bootstrap", "", "```json", JSON.stringify(bootstrap, null, 2), "```", "", "## Limitations", "", ...report.limitations.map((item) => `- ${item}`), "");
  writeFileSync(markdownPath, lines.join("\n"), "utf8");
  console.log(JSON.stringify({ jsonPath, markdownPath, compatibleOrigins: compatible.length, incompatibleOrigins: incompatible.length, v1Replay: report.v1Replay, publicationGate: report.publicationGate, primary: { h24: h24.all, h48: h48.all } }, null, 2));
}

run();
