import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteJsonLd } from "@/components/SiteJsonLd";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { getRootMetadata } from "@/lib/siteMetadata";
import "../globals.css";

export const metadata: Metadata = getRootMetadata("zh");

export default function ChineseRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <SiteJsonLd locale="zh" />
        {children}
        <GoogleAnalytics />
      </body>
    </html>
  );
}
