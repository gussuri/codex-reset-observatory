import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteJsonLd } from "@/components/SiteJsonLd";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { getRootMetadata } from "@/lib/siteMetadata";
import "../globals.css";

export const metadata: Metadata = getRootMetadata("en");

export default function EnglishRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteJsonLd locale="en" />
        {children}
        <GoogleAnalytics />
      </body>
    </html>
  );
}
