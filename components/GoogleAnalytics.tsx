"use client";

import Script from "next/script";
import { buildGa4InitializationScript, isValidGa4MeasurementId } from "@/lib/sponsorAnalytics";

export function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!isValidGa4MeasurementId(measurementId)) {
    return null;
  }

  const initializationScript = buildGa4InitializationScript(measurementId);
  if (!initializationScript) {
    return null;
  }

  return (
    <>
      <Script id="ga4-initialization" strategy="afterInteractive">
        {initializationScript}
      </Script>
      <Script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
    </>
  );
}
