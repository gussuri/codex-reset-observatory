import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteJsonLd } from "@/components/SiteJsonLd";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { getRootMetadata } from "@/lib/siteMetadata";
import "../globals.css";

export const metadata: Metadata = getRootMetadata("ja");

export default function JapaneseRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <SiteJsonLd locale="ja" />
        {children}
        <GoogleAnalytics />
      </body>
    </html>
  );
}
