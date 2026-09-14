"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/radar/types";
import { trackLocaleSwitch, type AnalyticsRoute } from "@/lib/analyticsEvents";

type TrackedLocaleLinkProps = {
  href: string;
  fromLocale: Locale;
  toLocale: Locale;
  route: AnalyticsRoute;
  className?: string;
  children: ReactNode;
};

export function TrackedLocaleLink({
  href,
  fromLocale,
  toLocale,
  route,
  className,
  children,
}: TrackedLocaleLinkProps) {
  return (
    <Link
      className={className}
      href={href}
      onClick={() => trackLocaleSwitch(fromLocale, toLocale, route)}
    >
      {children}
    </Link>
  );
}
