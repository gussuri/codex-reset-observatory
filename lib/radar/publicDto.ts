import { getRadarViewModel } from "@/lib/radar";
import { translateTiboPostText } from "./i18n";
import type {
  Locale,
  PublicDataHealth,
  PublicRadarSnapshot,
  PublicRadarViewModel,
  PublicTiboActivity,
  RadarData,
  RadarDataHealth,
} from "./types";

export type PublicRadarSnapshotOptions = {
  stale?: boolean;
  generatedAt?: string;
  limitHistory?: boolean;
  calculationNow?: Date;
};

function safeHttpUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

const PUBLIC_TIBO_CLASSIFICATIONS = new Set<PublicTiboActivity["classification"]>([
  "official_notice",
  "reset_executed",
  "teaser",
  "irrelevant",
]);

function normalizePublicPostText(value: string | null | undefined) {
  const normalized = value?.replace(/\r\n?/g, "\n").trim();
  return normalized || null;
}

function getLocalizedTiboPostText(
  signal: NonNullable<RadarData["recent_tibo_signals"]>[number],
  locale: Locale,
) {
  const storedTranslation =
    locale === "ja" ? signal.translated_text_ja : locale === "zh" ? signal.translated_text_zh : null;
  if (typeof storedTranslation === "string" && storedTranslation.trim()) {
    return storedTranslation;
  }

  return translateTiboPostText(signal.text, locale);
}

/**
 * Projects the newest stored Tibo signal to the small public activity card.
 * Audit fields and the raw tweet identifier never cross the public boundary.
 */
export function toPublicTiboActivity(
  internal: RadarData,
  now: Date = new Date(),
  locale: Locale = "ja",
): PublicTiboActivity | null {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return null;

  const recentSignals = internal.recent_tibo_signals;
  const candidates = (recentSignals ?? internal.active_tibo_signals ?? [])
    .filter((signal) => {
      if (!PUBLIC_TIBO_CLASSIFICATIONS.has(signal.signal_type as PublicTiboActivity["classification"])) {
        return false;
      }
      if (signal.verification_status === "rejected") return false;

      const createdAt = Date.parse(signal.tweet_created_at);
      if (!Number.isFinite(createdAt) || createdAt > nowTime) return false;

      if (recentSignals === undefined && signal.expires_at) {
        const expiresAt = Date.parse(signal.expires_at);
        if (Number.isFinite(expiresAt) && expiresAt <= nowTime) return false;
      }

      return true;
    })
    .sort(
      (left, right) =>
        Date.parse(right.tweet_created_at) - Date.parse(left.tweet_created_at),
    );

  const latest = candidates[0];
  if (!latest) return null;

  return {
    classification: latest.signal_type as PublicTiboActivity["classification"],
    text: normalizePublicPostText(getLocalizedTiboPostText(latest, locale)),
    createdAt: latest.tweet_created_at,
    sourceUrl: safeHttpUrl(latest.tweet_url),
  };
}

function copySourceHealth(
  health: RadarDataHealth["sources"][keyof RadarDataHealth["sources"]] | undefined,
) {
  return {
    state: health?.state ?? "ok",
    ...(health?.detail ? { detail: health.detail } : {}),
  } as PublicDataHealth["sources"][keyof PublicDataHealth["sources"]];
}

function toPublicViewModel(viewModel: ReturnType<typeof getRadarViewModel>): PublicRadarViewModel {
  return {
    status: viewModel.status,
    expectation: viewModel.expectation,
    probability12h: viewModel.probability12h,
    probability24h: viewModel.probability24h,
    probability48h: viewModel.probability48h,
    probability72h: viewModel.probability72h,
    lastUpdated: viewModel.lastUpdated ?? null,
    regularResetForecast: {
      date: viewModel.regularResetForecast.date,
      time: viewModel.regularResetForecast.time ?? null,
      remaining: viewModel.regularResetForecast.remaining,
      sourceResetAt: viewModel.regularResetForecast.sourceResetAt ?? null,
      expectedAt: viewModel.regularResetForecast.expectedAt ?? null,
      lastCompletedAt: viewModel.regularResetForecast.lastCompletedAt ?? null,
      remainingDays: viewModel.regularResetForecast.remainingDays ?? null,
      isNoticeWindow: viewModel.regularResetForecast.isNoticeWindow,
    },
    activeWindow: {
      active: viewModel.activeWindow.active,
      kind: viewModel.activeWindow.kind,
      label: viewModel.activeWindow.label,
      summary: viewModel.activeWindow.summary,
      openedAt: viewModel.activeWindow.openedAt ?? null,
      expectedAt: viewModel.activeWindow.expectedAt ?? null,
      expectedEndAt: viewModel.activeWindow.expectedEndAt ?? null,
      source: safeHttpUrl(viewModel.activeWindow.source),
      sourceLabel: viewModel.activeWindow.sourceLabel ?? null,
      forecastDate: viewModel.activeWindow.forecastDate,
      forecastTime: viewModel.activeWindow.forecastTime ?? null,
      remaining: viewModel.activeWindow.remaining,
    },
    displayReasoningSummary: viewModel.displayReasoningSummary,
    latestWindow: {
      kind: viewModel.latestWindow.kind,
      recordKind: viewModel.latestWindow.recordKind,
      title: viewModel.latestWindow.title,
      summary: viewModel.latestWindow.summary,
      scopeLabel: viewModel.latestWindow.scopeLabel,
      scope: viewModel.latestWindow.scope,
      openedAt: viewModel.latestWindow.openedAt ?? null,
      closedAt: viewModel.latestWindow.closedAt ?? null,
      windowLabel: viewModel.latestWindow.windowLabel,
      windowLength: viewModel.latestWindow.windowLength,
      source: safeHttpUrl(viewModel.latestWindow.source),
      sourceKind: viewModel.latestWindow.sourceKind,
    },
    recentHistory: viewModel.recentHistory.map((item) => ({
      key: item.key,
      recordKind: item.recordKind,
      title: item.title,
      resetType: item.resetType,
      resetTypes: item.resetTypes ? [...item.resetTypes] : undefined,
      status: item.status,
      details: item.details
        ? {
            cycleType: item.details.cycleType,
            reasonType: item.details.reasonType,
            resetMethod: item.details.resetMethod,
            scope: item.details.scope,
            noticeToExecution: item.details.noticeToExecution,
            noticeType: item.details.noticeType,
            note: item.details.note ?? null,
          }
        : undefined,
      date: item.date ?? null,
      signalAt: item.signalAt ?? null,
      resetAt: item.resetAt ?? null,
      signalLabel: item.signalLabel,
      resetLabel: item.resetLabel,
      scopeLabel: item.scopeLabel,
      scope: item.scope,
      windowLabel: item.windowLabel,
      windowLength: item.windowLength,
      source: safeHttpUrl(item.source),
      sourceKind: item.sourceKind,
      summary: item.summary ?? null,
    })),
  };
}

function toPublicHealth(
  internal: RadarData,
  options: PublicRadarSnapshotOptions,
  checkedAt: string,
): PublicDataHealth {
  const health = internal.data_health;
  return {
    overall: health?.overall ?? "ok",
    stale: options.stale ?? false,
    generatedAt: options.generatedAt ?? checkedAt,
    sources: {
      supabaseSignals: copySourceHealth(health?.sources.supabaseSignals),
      openAIStatus: copySourceHealth(health?.sources.openAIStatus),
    },
  };
}

/**
 * Builds the browser-facing response with an explicit allowlist. Internal
 * RadarData fields are intentionally never spread into this object.
 */
export function toPublicRadarSnapshot(
  internal: RadarData,
  locale: Locale,
  options: PublicRadarSnapshotOptions = {},
): PublicRadarSnapshot {
  const calculationNow = options.calculationNow ?? new Date();
  const checkedAt = internal.checked_at ?? calculationNow.toISOString();
  const viewModel = getRadarViewModel(
    internal,
    locale,
    options.limitHistory ?? true,
    undefined,
    calculationNow,
  );

  return {
    schemaVersion: "public-v1",
    checkedAt,
    updatedAt: internal.updated_at ?? null,
    dataHealth: toPublicHealth(internal, options, checkedAt),
    viewModel: toPublicViewModel(viewModel),
    latestTiboActivity: toPublicTiboActivity(internal, calculationNow, locale),
  };
}
