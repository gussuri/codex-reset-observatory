import type { Metadata } from "next";
import { RadarDashboard } from "@/components/RadarDashboard";
import { fetchCurrentRadarData } from "@/lib/radarFetch";
import {
  HOME_DESCRIPTION_ZH,
  HOME_TITLE_ZH,
  SITE_NAME,
  SITE_OG_IMAGE_URL,
  siteUrl,
} from "@/lib/siteMetadata";

export const revalidate = 300;

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  title: { absolute: HOME_TITLE_ZH },
  description: HOME_DESCRIPTION_ZH,
  alternates: {
    canonical: siteUrl("/zh"),
    languages: {
      ja: siteUrl("/"),
      en: siteUrl("/en"),
      zh: siteUrl("/zh"),
    },
  },
  openGraph: {
    title: HOME_TITLE_ZH,
    description: HOME_DESCRIPTION_ZH,
    url: siteUrl("/zh"),
    siteName: SITE_NAME,
    type: "website",
    locale: "zh_CN",
    alternateLocale: ["ja_JP", "en_US"],
    images: [
      {
        url: SITE_OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE_ZH,
    description: HOME_DESCRIPTION_ZH,
    images: [SITE_OG_IMAGE_URL],
  },
};

export default async function ChineseHome() {
  const initialData = await fetchCurrentRadarData({ revalidate });
  const initialFetchedAt = initialData ? new Date().toISOString() : null;

  return (
    <RadarDashboard
      initialData={initialData}
      initialFetchedAt={initialFetchedAt}
      locale="zh"
    />
  );
}
