"use client";

import { track } from "@vercel/analytics";
import type { HistorySourceKind, Locale } from "./radar/types";

export type AnalyticsRoute = "home" | "history" | "faq" | "about";
export type AnalyticsSourceType = "tibo" | "official_status" | "profile" | "other";
export type AnalyticsHeatmapRange = "all" | "last_month";

export const ANALYTICS_EVENT_NAMES = {
  sourceLinkClick: "source_link_click",
  localeSwitch: "locale_switch",
  historyRangeChange: "history_range_change",
} as const;

type AnalyticsEvent =
  | {
      name: typeof ANALYTICS_EVENT_NAMES.sourceLinkClick;
      properties: {
        locale: Locale;
        route: AnalyticsRoute;
        sourceType: AnalyticsSourceType;
      };
    }
  | {
      name: typeof ANALYTICS_EVENT_NAMES.localeSwitch;
      properties: {
        fromLocale: Locale;
        toLocale: Locale;
        route: AnalyticsRoute;
      };
    }
  | {
      name: typeof ANALYTICS_EVENT_NAMES.historyRangeChange;
      properties: {
        locale: Locale;
        range: AnalyticsHeatmapRange;
      };
    };

export function getAnalyticsSourceType(sourceKind: HistorySourceKind | null | undefined): AnalyticsSourceType {
  switch (sourceKind) {
    case "direct_post":
      return "tibo";
    case "official_status":
      return "official_status";
    case "profile":
      return "profile";
    default:
      return "other";
  }
}

export function createSourceLinkClickEvent(
  locale: Locale,
  route: AnalyticsRoute,
  sourceType: AnalyticsSourceType,
): AnalyticsEvent {
  return {
    name: ANALYTICS_EVENT_NAMES.sourceLinkClick,
    properties: { locale, route, sourceType },
  };
}

export function createLocaleSwitchEvent(
  fromLocale: Locale,
  toLocale: Locale,
  route: AnalyticsRoute,
): AnalyticsEvent {
  return {
    name: ANALYTICS_EVENT_NAMES.localeSwitch,
    properties: { fromLocale, toLocale, route },
  };
}

export function createHistoryRangeChangeEvent(
  locale: Locale,
  range: AnalyticsHeatmapRange,
): AnalyticsEvent {
  return {
    name: ANALYTICS_EVENT_NAMES.historyRangeChange,
    properties: { locale, range },
  };
}

function emitAnalyticsEvent(event: AnalyticsEvent) {
  try {
    track(event.name, event.properties);
  } catch {
    // Analytics is best-effort and must never block the user action.
  }
}

export function trackSourceLinkClick(
  locale: Locale,
  route: AnalyticsRoute,
  sourceType: AnalyticsSourceType,
) {
  emitAnalyticsEvent(createSourceLinkClickEvent(locale, route, sourceType));
}

export function trackLocaleSwitch(
  fromLocale: Locale,
  toLocale: Locale,
  route: AnalyticsRoute,
) {
  emitAnalyticsEvent(createLocaleSwitchEvent(fromLocale, toLocale, route));
}

export function trackHistoryRangeChange(
  locale: Locale,
  range: AnalyticsHeatmapRange,
) {
  emitAnalyticsEvent(createHistoryRangeChangeEvent(locale, range));
}
