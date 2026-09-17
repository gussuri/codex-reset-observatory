import assert from "node:assert/strict";
import test from "node:test";

import { getLocalRadarData, getRadarViewModel } from "../lib/radar";
import {
  getDisplayProbabilityReason,
  getRelativeDisplayHazard,
  getRelativeHazardLevel,
  integrateDisplayHazard,
  getLocalSignalEvaluation,
  type ActiveOfficialNotice,
  type DisplayElapsedDiagnostics,
} from "../lib/radar/probability";
import { ELAPSED_RELATIVE_HAZARD_THRESHOLDS } from "../data/predictionWeights";
import { getDueRegularResetEventRows } from "../lib/radar/regularResetSchedule";
import type { RegularResetEventRow } from "../lib/radar/regularResetSchedule";
import { calculateRegimeElapsedProbability } from "../lib/radar/regimeElapsedProbability";
import { getLastRandomRecoveryResetAt, getLastRecoveryResetAt } from "../lib/radar/recoveryBoundary";
import type { RadarData } from "../lib/radar/types";

const NOW = new Date("2026-08-04T00:00:00.000Z");

function hazardBins(rates: number[]) {
  const boundaries = [0, 24, 48, null] as const;
  return rates.map((posteriorLambdaPerHour, index) => ({
    startHour: boundaries[index],
    endHour: boundaries[index + 1],
    posteriorLambdaPerHour,
  }));
}

function regularResetAt(completedAt: string): RegularResetEventRow {
  const endAt = new Date(new Date(completedAt).getTime() + 15 * 60 * 1000).toISOString();
  return {
    schedule_key: `test:${completedAt}`,
    window_start_at: completedAt,
    window_end_at: endAt,
    representative_at: completedAt,
    scheduled_at: completedAt,
    completed_at: completedAt,
    cycle_type: "定期リセット",
    reset_method: "強制リセット",
    scope: "任意リセット未使用アカウント",
    record_kind: "regular_completed",
    status: "completed",
  };
}

function randomResetAt(completedAt: string): NonNullable<RadarData["formal_tibo_resets"]>[number] {
  return {
    tweet_id: `test-random-${completedAt}`,
    text: "Reset completed",
    tweet_url: "https://x.com/thsottiaux/status/2000000000000000000",
    tweet_created_at: completedAt,
    signal_type: "reset_executed",
    confidence: 1,
    verification_status: "confirmed",
  };
}

function modelContext(
  regimeMultiplier: number,
  elapsedHours: number,
  source: "shadow" | "legacy-shadow-fallback" | "heuristic-fallback" = "shadow",
  mode?: "full" | "elapsed-only" | "regime-only",
  bins = hazardBins([0.0002, 0.0015, 0.0015]),
  randomElapsedDiagnostics?: DisplayElapsedDiagnostics,
) {
  return {
    source,
    randomElapsedDiagnostics,
    shadow: {
      hazard: {
        globalLambdaPerHour: 0.001,
        bins,
      },
      regimeElapsed: {
        elapsedHours,
        mode: mode ?? "elapsed-only",
        effectiveRegimeMultiplier: mode === "elapsed-only" ? 1 : regimeMultiplier,
        regime: { regimeMultiplier },
        bins,
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
  mode,
  bins,
  probability24h = 0.2,
  probability48h = 0.35,
  now = NOW,
  formalTiboResets = [],
  regularResetEvents = [],
  randomElapsedDiagnostics,
}: {
  locale?: "ja" | "en" | "zh";
  signals?: ReturnType<typeof signal>[];
  environment?: Record<string, number>;
  statusIncidents?: Record<string, number>;
  notice?: ActiveOfficialNotice | null;
  multiplier?: number;
  elapsedHours?: number;
  source?: "shadow" | "legacy-shadow-fallback" | "heuristic-fallback";
  mode?: "full" | "elapsed-only" | "regime-only";
  bins?: ReturnType<typeof hazardBins>;
  probability24h?: number;
  probability48h?: number;
  now?: Date;
  formalTiboResets?: RadarData["formal_tibo_resets"];
  regularResetEvents?: RegularResetEventRow[];
  randomElapsedDiagnostics?: DisplayElapsedDiagnostics;
} = {}) {
  const data = getLocalRadarData({
    calculationNow: now,
    activeTiboSignals: signals,
    formalTiboResets,
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
    probability24h,
    probability48h,
    locale,
    evaluation,
    notice,
    now,
    modelContext(multiplier, elapsedHours, source, mode, bins, randomElapsedDiagnostics),
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
  assert.equal(
    reasonFor({ notice: officialNotice, signals: [signal("strong")] }),
    "公式のリセット予告が確認されています。予告内容を踏まえ、リセットの見込みが高まっています。",
  );
  assert.equal(reasonFor({ signals: [signal("strong")] }), "リセットを示唆する投稿が確認されています。通常時よりリセットの見込みが高まっています。");
  assert.equal(reasonFor({ statusIncidents: { activeStatusIncidentCount: 1 } }), "Codex関連の障害が確認されています。復旧対応などに伴うリセットの可能性も含めて注視しています。");
  assert.equal(reasonFor({ signals: [signal("weak")] }), "弱いリセット匂わせ投稿があります。");
  assert.equal(reasonFor({ environment: { issue_or_limit_anomalies_24h: 1 } }), "利用上限まわりの異常が確認されており、リセットの可能性がやや高まっています。");
});

test("uses a short official-notice outlook in English and Chinese", () => {
  assert.equal(
    reasonFor({ locale: "en", notice: officialNotice }),
    "An official reset notice has been confirmed. Considering the notice, the outlook for a reset is higher.",
  );
  assert.equal(
    reasonFor({ locale: "zh", notice: officialNotice }),
    "已确认有官方重置预告。结合预告内容，重置的可能性有所上升。",
  );
});

test("uses clear English and Chinese wording for teaser strength", () => {
  assert.equal(
    reasonFor({ locale: "en", signals: [signal("strong")] }),
    "A post suggesting a reset has been confirmed. The outlook is higher than usual.",
  );
  assert.equal(
    reasonFor({ locale: "en", signals: [signal("weak")] }),
    "A weak reset hint is present.",
  );
  assert.equal(
    reasonFor({ locale: "zh", signals: [signal("strong")] }),
    "已确认有暗示重置的帖子，重置的可能性高于平时。",
  );
  assert.equal(
    reasonFor({ locale: "zh", signals: [signal("weak")] }),
    "目前有一条较弱的重置暗示。",
  );
});

test("uses neutral elapsed wording even without elapsed diagnostics", () => {
  const expected = "前回のランダムリセットから2日20時間が経過しています。";
  assert.equal(
    reasonFor({ probability24h: 0.1, probability48h: 0.1, source: "legacy-shadow-fallback" }),
    expected,
  );
  assert.equal(
    reasonFor({ probability24h: 0.3, probability48h: 0.4, elapsedHours: 20, source: "legacy-shadow-fallback" }),
    expected,
  );
  assert.equal(
    reasonFor({ probability24h: 0.3, probability48h: 0.7, elapsedHours: 48, source: "legacy-shadow-fallback" }),
    expected,
  );
  assert.equal(
    reasonFor({ probability24h: 0.3, probability48h: 0.93, elapsedHours: 96, source: "legacy-shadow-fallback" }),
    expected,
  );
});

test("uses random-only relative hazard levels when display diagnostics are available", () => {
  const resetAt = new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const diagnostics = {
    bins: [],
    globalLambdaPerHour: 0.001,
    integrateHazard: (startHour: number, horizonHours: number) => {
      const endHour = startHour + horizonHours;
      const overlap = (left: number, right: number) => Math.max(
        0,
        Math.min(endHour, right) - Math.max(startHour, left),
      );
      return overlap(48, 72) * 0.0005 + overlap(72, Number.POSITIVE_INFINITY) * 0.002;
    },
  };

  const ja = reasonFor({
    probability24h: 0.2,
    probability48h: 0.35,
    formalTiboResets: [randomResetAt(resetAt)],
    randomElapsedDiagnostics: diagnostics,
  });
  const en = reasonFor({
    locale: "en",
    probability24h: 0.2,
    probability48h: 0.35,
    formalTiboResets: [randomResetAt(resetAt)],
    randomElapsedDiagnostics: diagnostics,
  });
  const zh = reasonFor({
    locale: "zh",
    probability24h: 0.2,
    probability48h: 0.35,
    formalTiboResets: [randomResetAt(resetAt)],
    randomElapsedDiagnostics: diagnostics,
  });

  assert.equal(
    ja,
    "前回のランダムリセットから2日が経過しています。この経過時間に基づく過去の傾向では、今から24時間以内は低め、48時間以内は中程度です。",
  );
  assert.equal(
    en,
    "It has been 2 days since the last random reset. Based on historical timing patterns at this elapsed time, the relative reset tendency is low over the next 24 hours and moderate over the next 48 hours.",
  );
  assert.equal(
    zh,
    "距离上次随机重置已过去2天。根据这一经过时间对应的历史时间模式，未来24小时的相对重置倾向为较低，未来48小时为处于中等水平。",
  );
});

test("Radar view uses the random reset clock even when a regular boundary is newer", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const randomAt = "2026-08-02T00:00:00.000Z";
  const regularAt = "2026-08-09T00:00:00.000Z";
  assert.ok(new Date(regularAt).getTime() > new Date(randomAt).getTime());
  const withoutRegularData = getLocalRadarData({
    calculationNow: now,
    formalTiboResets: [randomResetAt(randomAt)],
  });
  const withRegularData = getLocalRadarData({
    calculationNow: now,
    formalTiboResets: [randomResetAt(randomAt)],
    regularResetEvents: [regularResetAt(regularAt)],
  });
  const withoutRegular = getRadarViewModel(
    withoutRegularData,
    "ja",
    false,
    undefined,
    now,
  );
  const withRegular = getRadarViewModel(
    withRegularData,
    "ja",
    false,
    undefined,
    now,
  );

  assert.equal(getLastRandomRecoveryResetAt(withRegularData, now), randomAt);
  assert.equal(getLastRecoveryResetAt(withRegularData, now), regularAt);
  assert.match(withoutRegular.displayReasoningSummary ?? "", /この経過時間に基づく過去の傾向では/);
  assert.equal(withRegular.displayReasoningSummary, withoutRegular.displayReasoningSummary);
  assert.match(withRegular.displayReasoningSummary ?? "", /前回のランダムリセットから8日/);
});

test("uses neutral wording when no random reset baseline is available", () => {
  assert.equal(
    reasonFor({
      probability24h: 0.3,
      probability48h: 0.7,
      formalTiboResets: [],
      regularResetEvents: [],
      now: new Date("2020-01-01T00:00:00.000Z"),
    }),
    "現在のリセット状況を表示しています。",
  );
});

test("does not use indirect or technical elapsed-time wording", () => {
  const reason = reasonFor({ multiplier: 0.8, elapsedHours: 12 });

  assert.doesNotMatch(reason ?? "", /時間が浅い|低発生帯|経過時間による抑制/);
});

test("elapsed-only publication uses neutral wording despite raw regime diagnostics", () => {
  const regularResetEvents = [regularResetAt("2026-08-03T04:00:00.000Z")];
  assert.equal(
    reasonFor({ multiplier: 1.5, elapsedHours: 48, mode: "elapsed-only", regularResetEvents }) ?? "",
    "前回のランダムリセットから2日20時間が経過しています。",
  );
  assert.equal(
    reasonFor({ locale: "en", multiplier: 1.5, elapsedHours: 48, mode: "elapsed-only", regularResetEvents }) ?? "",
    "It has been 2 days and 20 hours since the last random reset.",
  );
  assert.equal(
    reasonFor({ locale: "zh", multiplier: 1.5, elapsedHours: 48, mode: "elapsed-only", regularResetEvents }) ?? "",
    "距离上次随机重置已过去2天20小时。",
  );
});

test("uses consistent outlook phrasing across English and Chinese", () => {
  const regularResetEvents = [regularResetAt("2026-08-02T00:00:00.000Z")];
  assert.equal(
    reasonFor({ locale: "en", probability24h: 0.3, probability48h: 0.4, regularResetEvents }),
    "It has been 2 days and 20 hours since the last random reset.",
  );
  assert.equal(
    reasonFor({ locale: "zh", probability24h: 0.3, probability48h: 0.4, regularResetEvents }),
    "距离上次随机重置已过去2天20小时。",
  );
});

test("uses neutral elapsed wording when the published model falls back", () => {
  assert.equal(
    reasonFor({ source: "legacy-shadow-fallback", multiplier: 1.5, elapsedHours: 96 }),
    "前回のランダムリセットから2日20時間が経過しています。",
  );
  assert.equal(
    reasonFor({ locale: "en", source: "legacy-shadow-fallback", multiplier: 1.5, elapsedHours: 96 }),
    "It has been 2 days and 20 hours since the last random reset.",
  );
  assert.equal(
    reasonFor({ locale: "zh", source: "legacy-shadow-fallback", multiplier: 1.5, elapsedHours: 96 }),
    "距离上次随机重置已过去2天20小时。",
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
  const regularReset = getDueRegularResetEventRows(
    new Date(regularAt),
    "2026-08-01T03:32:00.000Z",
  )[0];
  const now = new Date("2026-08-08T04:00:00.000Z");

  assert.equal(
    reasonFor({
      now,
      regularResetEvents: [regularReset],
      signals: [signal("strong", "2026-08-08T02:00:00.000Z")],
      multiplier: 0.8,
      elapsedHours: 0.5,
      probability24h: 0.1,
      probability48h: 0.1,
    }),
    "前回のランダムリセットから7日が経過しています。",
  );
});

test("uses minute precision immediately after a random reset despite a regular boundary", () => {
  const randomResetEvents = [randomResetAt("2026-08-03T23:30:00.000Z")];
  const regularResetEvents = [regularResetAt("2026-08-03T23:30:00.000Z")];
  assert.match(
    reasonFor({
      now: NOW,
      formalTiboResets: randomResetEvents,
      regularResetEvents,
      probability24h: 0.1,
      probability48h: 0.1,
    }) ?? "",
    /前回のランダムリセットから30分が経過しています/,
  );
  assert.match(
    reasonFor({
      now: new Date("2026-08-03T23:59:30.000Z"),
      formalTiboResets: [randomResetAt("2026-08-03T23:59:00.000Z")],
      regularResetEvents: [regularResetAt("2026-08-03T23:59:00.000Z")],
      probability24h: 0.1,
      probability48h: 0.1,
    }) ?? "",
    /前回のランダムリセットから1分未満が経過しています/,
  );
  assert.match(
    reasonFor({
      locale: "en",
      now: new Date("2026-08-03T23:59:30.000Z"),
      formalTiboResets: [randomResetAt("2026-08-03T23:59:00.000Z")],
      regularResetEvents: [regularResetAt("2026-08-03T23:59:00.000Z")],
      probability24h: 0.1,
      probability48h: 0.1,
    }) ?? "",
    /It has been less than 1 minute since the last random reset/,
  );
  const oneMinuteReason = reasonFor({
    locale: "en",
    now: new Date("2026-08-03T23:31:00.000Z"),
    formalTiboResets: randomResetEvents,
    regularResetEvents: [regularResetAt("2026-08-03T23:30:00.000Z")],
    probability24h: 0.1,
    probability48h: 0.1,
  }) ?? "";
  assert.match(oneMinuteReason, /It has been 1 minute since the last random reset/);
  assert.doesNotMatch(oneMinuteReason, /1 minute have passed/);

  const thirtyMinuteReason = reasonFor({
    locale: "en",
    now: new Date("2026-08-04T00:00:00.000Z"),
    formalTiboResets: randomResetEvents,
    regularResetEvents: [regularResetAt("2026-08-03T23:30:00.000Z")],
    probability24h: 0.1,
    probability48h: 0.1,
  }) ?? "";
  assert.match(thirtyMinuteReason, /It has been 30 minutes since the last random reset/);

  const oneHourReason = reasonFor({
    locale: "en",
    now: new Date("2026-08-04T00:30:00.000Z"),
    formalTiboResets: randomResetEvents,
    regularResetEvents: [regularResetAt("2026-08-03T23:30:00.000Z")],
    probability24h: 0.1,
    probability48h: 0.1,
  }) ?? "";
  assert.match(oneHourReason, /It has been 1 hour since the last random reset/);
  assert.doesNotMatch(oneHourReason, /1 hour have passed/);
});

test("uses the displayed elapsed duration for neutral explanations", () => {
  assert.match(
    reasonFor({
      probability24h: 0.3,
      probability48h: 0.7,
      regularResetEvents: [regularResetAt("2026-08-02T00:00:00.000Z")],
    }) ?? "",
    /前回のランダムリセットから2日20時間が経過しています。$/,
  );
  assert.match(
    reasonFor({
      probability24h: 0.3,
      probability48h: 0.4,
      regularResetEvents: [regularResetAt("2026-08-02T21:00:00.000Z")],
    }) ?? "",
    /前回のランダムリセットから2日20時間/,
  );
});

test("does not expose raw regime wording in the normal explanation", () => {
  const reason = reasonFor({ multiplier: 1.8, probability24h: 0.3, probability48h: 0.7 });
  assert.doesNotMatch(reason ?? "", /最近はリセットが多い|regime|倍率|低発生帯|時間が浅い/);
});

test("regular recovery boundaries do not increase the random event count", () => {
  const regularAt = "2026-08-08T03:32:00.000Z";
  const regularReset = getDueRegularResetEventRows(
    new Date(regularAt),
    "2026-08-01T03:32:00.000Z",
  )[0];
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


test("current outlook includes a localized resolved teaser window in all supported locales", () => {
  const now = new Date("2026-08-27T07:21:00.000Z");
  const timedSignal = {
    tweet_id: "timed-outlook-teaser",
    signal_type: "teaser" as const,
    text: "Intrigued to see if I can find the reset button tomorrow.",
    tweet_created_at: "2026-08-27T06:31:31.000Z",
    teaser_strength: "strong" as const,
    confidence: 0.85,
    verification_status: "confirmed" as const,
    is_reply: false,
    temporal_resolution_status: "resolved" as const,
    temporal_precision: "day" as const,
    temporal_confidence: 0.95,
    expected_start_at: "2026-08-27T07:00:00.000Z",
    expected_end_at: "2026-08-28T07:00:00.000Z",
  };
  const data = getLocalRadarData({
    calculationNow: now,
    activeTiboSignals: [timedSignal],
    recentTiboSignals: [timedSignal],
  });
  const evaluation = getLocalSignalEvaluation(data, now);

  const ja = getDisplayProbabilityReason(data, 0.54, 0.79, "ja", evaluation, null, now);
  const en = getDisplayProbabilityReason(data, 0.54, 0.79, "en", evaluation, null, now);
  const zh = getDisplayProbabilityReason(data, 0.54, 0.79, "zh", evaluation, null, now);

  assert.match(ja ?? "", /Tiboがリセットを強く示唆/);
  assert.match(ja ?? "", /示唆された時間帯/);
  assert.match(ja ?? "", /2026\/08\/27/);
  assert.match(en ?? "", /Tibo is strongly hinting at a reset/);
  assert.match(en ?? "", /hinted window/);
  assert.match(en ?? "", /08\/27\/2026/);
  assert.match(zh ?? "", /Tibo 正在强烈暗示/);
  assert.match(zh ?? "", /时间窗口/);
  assert.match(zh ?? "", /2026\/08\/27/);
});


test("current outlook explains the gradual fade during a timed teaser grace period in all locales", () => {
  const now = new Date("2026-08-28T08:30:00.000Z");
  const timedSignal = {
    tweet_id: "timed-grace-outlook",
    signal_type: "teaser" as const,
    text: "Reset button tomorrow.",
    tweet_created_at: "2026-08-27T06:31:31.000Z",
    teaser_strength: "strong" as const,
    confidence: 0.85,
    verification_status: "confirmed" as const,
    is_reply: false,
    temporal_resolution_status: "resolved" as const,
    temporal_precision: "day" as const,
    temporal_confidence: 0.95,
    expected_start_at: "2026-08-27T07:00:00.000Z",
    expected_end_at: "2026-08-28T07:00:00.000Z",
    expires_at: "2026-08-28T10:00:00.000Z",
  };
  const data = getLocalRadarData({
    calculationNow: now,
    activeTiboSignals: [timedSignal],
    recentTiboSignals: [timedSignal],
  });
  const evaluation = getLocalSignalEvaluation(data, now);

  const ja = getDisplayProbabilityReason(data, 0.50, 0.75, "ja", evaluation, null, now);
  const en = getDisplayProbabilityReason(data, 0.50, 0.75, "en", evaluation, null, now);
  const zh = getDisplayProbabilityReason(data, 0.50, 0.75, "zh", evaluation, null, now);

  assert.match(ja ?? "", /まだ通常より高め/);
  assert.match(en ?? "", /still higher than usual/);
  assert.match(zh ?? "", /仍高于平时/);
});


test("strong timed teaser outlook says strength is included in all supported locales", () => {
  const now = new Date("2026-08-27T08:30:00.000Z");
  const timedSignal = {
    tweet_id: "strong-timed-outlook",
    signal_type: "teaser" as const,
    text: "Reset button tomorrow.",
    tweet_created_at: "2026-08-27T06:31:31.000Z",
    teaser_strength: "strong" as const,
    confidence: 0.85,
    verification_status: "confirmed" as const,
    is_reply: false,
    temporal_resolution_status: "resolved" as const,
    temporal_precision: "day" as const,
    temporal_confidence: 0.95,
    expected_start_at: "2026-08-27T07:00:00.000Z",
    expected_end_at: "2026-08-28T07:00:00.000Z",
  };
  const data = getLocalRadarData({
    calculationNow: now,
    activeTiboSignals: [timedSignal],
    recentTiboSignals: [timedSignal],
  });
  const evaluation = getLocalSignalEvaluation(data, now);

  const ja = getDisplayProbabilityReason(data, 0.65, 0.85, "ja", evaluation, null, now);
  const en = getDisplayProbabilityReason(data, 0.65, 0.85, "en", evaluation, null, now);
  const zh = getDisplayProbabilityReason(data, 0.65, 0.85, "zh", evaluation, null, now);

  assert.match(ja ?? "", /Tiboがリセットを強く示唆/);
  assert.match(ja ?? "", /通常よりリセットの可能性が高まっています/);
  assert.match(en ?? "", /Tibo is strongly hinting at a reset/);
  assert.match(en ?? "", /chance of a reset is higher than usual/);
  assert.match(zh ?? "", /Tibo 正在强烈暗示/);
  assert.match(zh ?? "", /重置的可能性高于平时/);
});

test("relative hazard threshold unit tests", () => {
  assert.equal(getRelativeHazardLevel(0), "low");
  assert.equal(getRelativeHazardLevel(0.74), "low");
  assert.equal(getRelativeHazardLevel(0.7499), "low");
  assert.equal(getRelativeHazardLevel(0.75), "medium");
  assert.equal(getRelativeHazardLevel(1.00), "medium");
  assert.equal(getRelativeHazardLevel(1.25), "medium");
  assert.equal(getRelativeHazardLevel(1.2501), "high");
  assert.equal(getRelativeHazardLevel(2.0), "high");
  assert.equal(ELAPSED_RELATIVE_HAZARD_THRESHOLDS.low, 0.75);
  assert.equal(ELAPSED_RELATIVE_HAZARD_THRESHOLDS.high, 1.25);
});

test("relative hazard horizon semantics: 24h is [t, t+24] and 48h is [t, t+48]", () => {
  const bins = [
    { startHour: 0, endHour: 24, posteriorLambdaPerHour: 0.02 },
    { startHour: 24, endHour: 48, posteriorLambdaPerHour: 0.00 },
    { startHour: 48, endHour: null, posteriorLambdaPerHour: 0.00 },
  ];
  const globalLambdaPerHour = 0.01;
  const diagnostics = { bins, globalLambdaPerHour };

  const cum24 = integrateDisplayHazard(bins, 0, 24)!;
  const cum48 = integrateDisplayHazard(bins, 0, 48)!;
  const cumSecondDay = integrateDisplayHazard(bins, 24, 24)!;

  assert.ok(cum24 > 0);
  assert.equal(Math.round((cum24 + cumSecondDay) * 10000), Math.round(cum48 * 10000));
  assert.notEqual(cum48, cumSecondDay);

  const r24 = getRelativeDisplayHazard(diagnostics, 0, 24)!;
  const r48 = getRelativeDisplayHazard(diagnostics, 0, 48)!;
  assert.equal(r24, cum24 / (24 * globalLambdaPerHour));
  assert.equal(r48, cum48 / (48 * globalLambdaPerHour));
});

test("evaluates representative elapsed ages 0h through 168h correctly on V4 model", () => {
  const referenceNow = new Date("2026-09-17T06:00:00.000Z");
  const radarData = getLocalRadarData({ calculationNow: referenceNow });
  const model = calculateRegimeElapsedProbability(radarData, { now: referenceNow });
  const diagnostics = {
    bins: model.hazard.bins,
    globalLambdaPerHour: model.hazard.globalLambdaPerHour,
  };

  const expectedCases: Array<{
    age: number;
    level24: "low" | "medium" | "high";
    level48: "low" | "medium" | "high";
  }> = [
    { age: 0, level24: "medium", level48: "high" },
    { age: 12, level24: "high", level48: "high" },
    { age: 24, level24: "high", level48: "high" },
    { age: 48, level24: "medium", level48: "medium" },
    { age: 72, level24: "medium", level48: "medium" },
    { age: 96, level24: "medium", level48: "medium" },
    { age: 104, level24: "medium", level48: "low" },
    { age: 107, level24: "medium", level48: "low" },
    { age: 110, level24: "medium", level48: "low" },
    { age: 120, level24: "low", level48: "low" },
    { age: 144, level24: "low", level48: "low" },
    { age: 168, level24: "low", level48: "low" },
  ];

  for (const { age, level24, level48 } of expectedCases) {
    const r24 = getRelativeDisplayHazard(diagnostics, age, 24)!;
    const r48 = getRelativeDisplayHazard(diagnostics, age, 48)!;
    assert.equal(getRelativeHazardLevel(r24), level24, `age ${age}h 24h level`);
    assert.equal(getRelativeHazardLevel(r48), level48, `age ${age}h 48h level`);
  }
});

test("formats 107h representative age matching user specification in all locales", () => {
  const referenceNow = new Date("2026-09-17T06:00:00.000Z");
  const resetAt = new Date(referenceNow.getTime() - 107 * 3600 * 1000).toISOString();
  const testData = getLocalRadarData({
    calculationNow: referenceNow,
    formalTiboResets: [
      {
        tweet_id: "reset-107h",
        text: "Reset",
        tweet_url: "https://x.com/thsottiaux/status/107",
        tweet_created_at: resetAt,
        signal_type: "reset_executed",
        confidence: 1,
        verification_status: "confirmed",
      },
    ],
  });
  const model = calculateRegimeElapsedProbability(testData, { now: referenceNow });
  const publishedCalculation = {
    source: "shadow" as const,
    shadow: {
      hazard: {
        bins: model.hazard.bins,
        globalLambdaPerHour: model.hazard.globalLambdaPerHour,
      },
      regimeElapsed: {
        mode: "elapsed-only" as const,
        bins: model.hazard.bins,
      },
    },
  };

  const evaluation = getLocalSignalEvaluation(testData, referenceNow);
  const ja = getDisplayProbabilityReason(testData, 0.2, 0.35, "ja", evaluation, null, referenceNow, publishedCalculation);
  const en = getDisplayProbabilityReason(testData, 0.2, 0.35, "en", evaluation, null, referenceNow, publishedCalculation);
  const zh = getDisplayProbabilityReason(testData, 0.2, 0.35, "zh", evaluation, null, referenceNow, publishedCalculation);

  assert.equal(
    ja,
    "前回のランダムリセットから4日11時間が経過しています。",
  );
  assert.equal(
    en,
    "It has been 4 days and 11 hours since the last random reset.",
  );
  assert.equal(
    zh,
    "距离上次随机重置已过去4天11小时。",
  );
});

test("renders the neutral elapsed template across locales", () => {
  const binsLow = [
    { startHour: 0, endHour: null, posteriorLambdaPerHour: 0.001 },
  ];
  const diagSameLow = {
    source: "shadow" as const,
    shadow: {
      hazard: { bins: binsLow, globalLambdaPerHour: 0.005 },
      regimeElapsed: { mode: "elapsed-only" as const, bins: binsLow },
    },
  };
  const testNow = new Date("2026-08-09T00:00:00.000Z");
  const testData = getLocalRadarData({
    calculationNow: testNow,
    formalTiboResets: [
      {
        tweet_id: "reset-same",
        text: "Reset",
        tweet_url: "https://x.com/thsottiaux/status/same",
        tweet_created_at: new Date(testNow.getTime() - 5 * 24 * 3600 * 1000).toISOString(),
        signal_type: "reset_executed",
        confidence: 1,
        verification_status: "confirmed",
      },
    ],
  });
  const evaluation = getLocalSignalEvaluation(testData, testNow);

  const jaSame = getDisplayProbabilityReason(testData, 0.1, 0.1, "ja", evaluation, null, testNow, diagSameLow);
  const enSame = getDisplayProbabilityReason(testData, 0.1, 0.1, "en", evaluation, null, testNow, diagSameLow);
  const zhSame = getDisplayProbabilityReason(testData, 0.1, 0.1, "zh", evaluation, null, testNow, diagSameLow);

  assert.equal(jaSame, "前回のランダムリセットから5日が経過しています。");
  assert.equal(enSame, "It has been 5 days since the last random reset.");
  assert.equal(zhSame, "距离上次随机重置已过去5天。");
});
