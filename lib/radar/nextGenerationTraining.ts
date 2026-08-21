import {
  LOCAL_RESET_HISTORY,
} from "@/data/resetHistory";
import {
  NEXT_GENERATION_A_COMPONENT_VERSIONS,
  NEXT_GENERATION_B_MODEL_VERSION,
  NEXT_GENERATION_FREEZE_AT,
} from "@/data/shadowProbabilityConfig";
import { getActualWithinHorizon } from "./prequentialCalibration";
import type { ShadowResetEvent } from "./shadowProbability";
import {
  getRecoveryResetEvents,
} from "./recoveryBoundary";
import type { RadarData, WindowEventLike } from "./types";
import type { NextGenerationCalibrationRow } from "./nextGenerationProbability";
import type {
  NextGenerationComponentForecast,
  NextGenerationEnsembleTrainingRow,
} from "./nextGenerationEnsemble";

const HOUR_MS = 60 * 60 * 1000;

function getLoggedHourQueryStart() {
  const freezeTime = timestamp(NEXT_GENERATION_FREEZE_AT)!;
  return new Date(Math.floor(freezeTime / HOUR_MS) * HOUR_MS).toISOString();
}

export type NextGenerationTrainingHistoryRow = {
  logged_hour?: string | null;
  debug_info?: unknown;
};

export type NextGenerationTrainingSkipReasons = {
  pre_freeze: number;
  missing_b_forecast: number;
  invalid_b_forecast: number;
  incomplete_a_components: number;
  invalid_generated_at: number;
};

export type NextGenerationTrainingRows = {
  bRows: Array<NextGenerationCalibrationRow>;
  aRows: Array<NextGenerationEnsembleTrainingRow>;
  totalRows: number;
  skipReasons: NextGenerationTrainingSkipReasons;
  backfill: false;
};

export type NextGenerationTrainingState = NextGenerationTrainingRows & {
  status: "ok" | "error";
  reason: string | null;
};

export type NextGenerationTrainingQueryOptions = {
  asOf: Date;
  randomEvents: Array<ShadowResetEvent>;
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseDebugInfo(value: unknown) {
  if (typeof value !== "string") return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function isProbability(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

function isStoredAt(value: unknown, generatedAt: string) {
  return typeof value === "string"
    && timestamp(value) === timestamp(generatedAt);
}

function createSkipReasons(): NextGenerationTrainingSkipReasons {
  return {
    pre_freeze: 0,
    missing_b_forecast: 0,
    invalid_b_forecast: 0,
    incomplete_a_components: 0,
    invalid_generated_at: 0,
  };
}

function getActualLabel(
  randomEvents: Array<ShadowResetEvent>,
  generatedAt: string,
  asOfTime: number,
  horizonHours: 24 | 48,
) {
  const generatedTime = timestamp(generatedAt);
  if (generatedTime === null || generatedTime + horizonHours * HOUR_MS > asOfTime) {
    return undefined;
  }
  return getActualWithinHorizon(randomEvents, generatedAt, horizonHours);
}

export function parseNextGenerationTrainingRows(
  rows: Array<NextGenerationTrainingHistoryRow>,
  options: NextGenerationTrainingQueryOptions,
): NextGenerationTrainingRows {
  const asOfTime = options.asOf.getTime();
  const freezeTime = timestamp(NEXT_GENERATION_FREEZE_AT)!;
  const bRows: Array<NextGenerationCalibrationRow> = [];
  const aRows: Array<NextGenerationEnsembleTrainingRow> = [];
  const skipReasons = createSkipReasons();

  for (const row of rows) {
    const debugInfo = parseDebugInfo(row.debug_info);
    const forecasts = asRecord(debugInfo?.experimentalProbabilityForecasts);
    const bForecast = asRecord(forecasts?.[NEXT_GENERATION_B_MODEL_VERSION]);
    const generatedAt = typeof bForecast?.generatedAt === "string"
      ? bForecast.generatedAt
      : null;
    const generatedTime = timestamp(generatedAt);

    if (generatedAt === null || generatedTime === null || !Number.isFinite(asOfTime)) {
      skipReasons.invalid_generated_at += 1;
      continue;
    }
    if (generatedTime < freezeTime) {
      skipReasons.pre_freeze += 1;
      continue;
    }
    if (generatedTime >= asOfTime) continue;
    if (!bForecast) {
      skipReasons.missing_b_forecast += 1;
      continue;
    }
    if (
      bForecast.modelVersion !== NEXT_GENERATION_B_MODEL_VERSION
      || !isProbability(bForecast.rawProbability24h)
      || !isProbability(bForecast.rawProbability48h)
    ) {
      skipReasons.invalid_b_forecast += 1;
      continue;
    }

    bRows.push({
      generatedAt,
      modelVersion: NEXT_GENERATION_B_MODEL_VERSION,
      rawProbability24h: bForecast.rawProbability24h,
      rawProbability48h: bForecast.rawProbability48h,
      actual24h: getActualLabel(options.randomEvents, generatedAt, asOfTime, 24),
      actual48h: getActualLabel(options.randomEvents, generatedAt, asOfTime, 48),
    });

    const components: Record<string, NextGenerationComponentForecast> = {};
    let complete = true;
    for (const modelVersion of NEXT_GENERATION_A_COMPONENT_VERSIONS) {
      const component = asRecord(forecasts?.[modelVersion]);
      if (
        !component
        || component.modelVersion !== modelVersion
        || !isStoredAt(component.generatedAt, generatedAt)
        || !isProbability(component.probability24h)
        || !isProbability(component.probability48h)
      ) {
        complete = false;
        break;
      }
      components[modelVersion] = {
        modelVersion,
        probability24h: component.probability24h,
        probability48h: component.probability48h,
      };
    }
    if (!complete) {
      skipReasons.incomplete_a_components += 1;
      continue;
    }
    aRows.push({
      generatedAt,
      components,
      actual24h: getActualLabel(options.randomEvents, generatedAt, asOfTime, 24),
      actual48h: getActualLabel(options.randomEvents, generatedAt, asOfTime, 48),
    });
  }

  return {
    bRows,
    aRows,
    totalRows: rows.length,
    skipReasons,
    backfill: false,
  };
}

export function getNextGenerationRandomTargetEvents(
  data: RadarData | null,
  asOf: Date,
  staticHistory: Array<WindowEventLike> = LOCAL_RESET_HISTORY,
): Array<ShadowResetEvent> {
  return getRecoveryResetEvents(data, asOf, staticHistory)
    .filter((boundary) => boundary.isRandom)
    .map((boundary) => ({ id: boundary.id, resetAt: boundary.resetAt }));
}

export async function loadNextGenerationTrainingState(
  client: any,
  options: NextGenerationTrainingQueryOptions,
): Promise<NextGenerationTrainingState> {
  const empty: NextGenerationTrainingRows = {
    bRows: [],
    aRows: [],
    totalRows: 0,
    skipReasons: createSkipReasons(),
    backfill: false,
  };
  const asOfTime = options.asOf.getTime();
  if (!Number.isFinite(asOfTime)) {
    return { ...empty, status: "error", reason: "invalid asOf" };
  }

  try {
    const result = await client
      .from("prediction_history")
      .select("logged_hour,debug_info")
      .gte("logged_hour", getLoggedHourQueryStart())
      .lt("logged_hour", options.asOf.toISOString())
      .order("logged_hour", { ascending: true })
      .limit(10_000);
    if (result?.error) {
      return { ...empty, status: "error", reason: "prediction_history query failed" };
    }
    const parsed = parseNextGenerationTrainingRows(
      (result?.data ?? []) as Array<NextGenerationTrainingHistoryRow>,
      options,
    );
    return { ...parsed, status: "ok", reason: null };
  } catch {
    return { ...empty, status: "error", reason: "prediction_history query failed" };
  }
}
