import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { DocumentLocale } from "@/components/DocumentLocale";
import { getDocumentLocale } from "@/lib/locale";
import {
  getSiteJsonLd,
  HOME_DESCRIPTION_JA,
  HOME_TITLE_JA,
  SITE_NAME,
  SITE_OG_IMAGE_URL,
  SITE_URL,
  siteUrl,
} from "@/lib/siteMetadata";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: { default: HOME_TITLE_JA, template: "%s | " + SITE_NAME },
  description: HOME_DESCRIPTION_JA,
  alternates: {
    canonical: siteUrl("/"),
    languages: { ja: siteUrl("/"), en: siteUrl("/en"), zh: siteUrl("/zh") },
  },
  openGraph: {
    title: HOME_TITLE_JA,
    description: HOME_DESCRIPTION_JA,
    url: siteUrl("/"),
    siteName: SITE_NAME,
    locale: "ja_JP",
    type: "website",
    images: [{ url: SITE_OG_IMAGE_URL, width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE_JA,
    description: HOME_DESCRIPTION_JA,
    images: [SITE_OG_IMAGE_URL],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const locale = getDocumentLocale(requestHeaders.get("x-codex-pathname") ?? "/");
  const siteJsonLd = getSiteJsonLd(locale);

  return (
    <html lang={locale}>
      <body>
        <DocumentLocale />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
