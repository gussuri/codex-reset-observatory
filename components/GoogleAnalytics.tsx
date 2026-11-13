"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import {
  buildGa4InitializationScript,
  isAnalyticsHostAllowed,
  isAnalyticsOptedOut,
  isValidGa4MeasurementId,
} from "@/lib/sponsorAnalytics";

export function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  const [clientAllowed, setClientAllowed] = useState(false);

  useEffect(() => {
    const hostAllowed = isAnalyticsHostAllowed(window.location.hostname, vercelEnv);
    let optedOut = false;
    try {
      optedOut = isAnalyticsOptedOut(window.localStorage);
    } catch {
      optedOut = false;
    }
    setClientAllowed(hostAllowed && !optedOut);
  }, [vercelEnv]);

  if (!clientAllowed || !isValidGa4MeasurementId(measurementId)) {
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
