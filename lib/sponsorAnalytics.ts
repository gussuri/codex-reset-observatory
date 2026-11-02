import type { Locale } from "./radar/types";

export const GITHUB_SPONSORS_URL = "https://github.com/sponsors/gussuri";
export const GITHUB_SPONSORS_ONE_TIME_URL =
  `${GITHUB_SPONSORS_URL}?frequency=one-time` as const;
export const SPONSOR_CLICK_EVENT_NAME = "sponsor_click" as const;

export type SponsorFrequency = "monthly" | "one-time";

export function getGitHubSponsorsUrl(
  frequency: SponsorFrequency = "monthly",
): string {
  return frequency === "one-time"
    ? GITHUB_SPONSORS_ONE_TIME_URL
    : GITHUB_SPONSORS_URL;
}

export type SponsorPlacement = "header" | "panel" | "footer" | "about";
export type SponsorPageType = "home" | "history" | "faq" | "about";

export type SponsorClickEvent = {
  name: typeof SPONSOR_CLICK_EVENT_NAME;
  properties: {
    placement: SponsorPlacement;
    locale: Locale;
    page_type: SponsorPageType;
  };
};

export type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{10}$/;

export function isValidGa4MeasurementId(
  measurementId: string | undefined,
): measurementId is string {
  return measurementId !== undefined && GA4_MEASUREMENT_ID_PATTERN.test(measurementId);
}

export function buildGa4InitializationScript(
  measurementId: string | undefined,
): string | null {
  if (!isValidGa4MeasurementId(measurementId)) {
    return null;
  }

  return [
    "window.dataLayer = window.dataLayer || [];",
    "window.gtag = window.gtag || function(){window.dataLayer.push(arguments);};",
    "window.gtag('js', new Date());",
    `window.gtag('config', '${measurementId}', {`,
    "  allow_google_signals: false,",
    "  allow_ad_personalization_signals: false,",
    "  page_location: window.location.origin + window.location.pathname",
    "});",
  ].join("\n");
}

export function createSponsorClickEvent(
  placement: SponsorPlacement,
  locale: Locale,
  pageType: SponsorPageType,
): SponsorClickEvent {
  return {
    name: SPONSOR_CLICK_EVENT_NAME,
    properties: { placement, locale, page_type: pageType },
  };
}

export function dispatchSponsorClickEvent(
  event: SponsorClickEvent,
  gtag: Gtag | undefined,
): void {
  try {
    gtag?.("event", event.name, event.properties);
  } catch {
    // Analytics is best-effort; it must never interfere with the anchor navigation.
  }
}

export function trackSponsorClick(
  placement: SponsorPlacement,
  locale: Locale,
  pageType: SponsorPageType,
): void {
  if (typeof window === "undefined") {
    return;
  }

  dispatchSponsorClickEvent(
    createSponsorClickEvent(placement, locale, pageType),
    window.gtag,
  );
}
