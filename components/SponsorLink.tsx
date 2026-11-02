"use client";

import React, { type ReactNode } from "react";
import type { Locale } from "@/lib/radar/types";
import {
  GITHUB_SPONSORS_URL,
  trackSponsorClick,
  type SponsorPageType,
  type SponsorPlacement,
} from "@/lib/sponsorAnalytics";

type SponsorLinkProps = {
  locale: Locale;
  pageType: SponsorPageType;
  placement: SponsorPlacement;
  className?: string;
  children: ReactNode;
};

export function SponsorLink({
  locale,
  pageType,
  placement,
  className,
  children,
}: SponsorLinkProps) {
  return (
    <a
      className={className}
      href={GITHUB_SPONSORS_URL}
      onClick={() => trackSponsorClick(placement, locale, pageType)}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
