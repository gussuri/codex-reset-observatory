"use client";

import React, { type ReactNode } from "react";
import type { Locale } from "@/lib/radar/types";
import {
  getGitHubSponsorsUrl,
  trackSponsorClick,
  type SponsorFrequency,
  type SponsorPageType,
  type SponsorPlacement,
} from "@/lib/sponsorAnalytics";

type SponsorLinkProps = {
  locale: Locale;
  pageType: SponsorPageType;
  placement: SponsorPlacement;
  frequency?: SponsorFrequency;
  className?: string;
  children: ReactNode;
};

export function SponsorLink({
  locale,
  pageType,
  placement,
  frequency = "monthly",
  className,
  children,
}: SponsorLinkProps) {
  return (
    <a
      className={className}
      href={getGitHubSponsorsUrl(frequency)}
      onClick={() => trackSponsorClick(placement, locale, pageType)}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
