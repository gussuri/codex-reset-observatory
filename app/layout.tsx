import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { getDocumentLocale } from "@/lib/locale";
import "./globals.css";

const siteUrl = "https://codex-reset-observatory.vercel.app";
const siteTitle = "Codexリセット観測所";
const siteDescription =
  "Codexの制限解除タイミング、使用量・利用上限リセットの履歴と期待度を整理。公式予告、補償リセット、次回参考日を確認できます。";
const siteOgDescription =
  "Codexの使用量リセット、利用上限リセット、制限解除タイミングを追うサイト。リセット履歴、公式予告、補償リセット、期待度をまとめています。";
const structuredSiteName = "Codex Reset Observatory";
const structuredAlternateNames = [
  "Codex\u30ea\u30bb\u30c3\u30c8\u89b3\u6e2c\u6240",
  "codex-reset-observatory.vercel.app",
];
const siteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${siteUrl}/#website`,
  name: structuredSiteName,
  alternateName: structuredAlternateNames,
  url: `${siteUrl}/`,
  description: siteDescription,
  inLanguage: "ja-JP",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: siteTitle,
  title: {
    default: "Codex制限解除・使用量リセット情報 | 利用上限リセット履歴",
    template: `%s | ${siteTitle}`,
  },
  description: siteDescription,
  alternates: {
    canonical: "/",
  },
  keywords: [
    "Codex",
    "リセット",
    "Codex リセット",
    "Codex リセット いつ",
    "Codex リセット タイミング",
    "Codex 制限",
    "Codex 制限 解除",
    "Codex トークン リセット",
    "Codex 使用量",
    "Codex 使用量 リセット",
    "Codex 利用上限 リセット",
    "Codex 制限 リセット",
    "Codex 制限解除",
    "Codex レート制限",
    "Codex レート リセット",
    "Codex CLI リセット",
    "Codex コンテキスト リセット",
    "ランダムリセット",
    "臨時リセット",
    "障害対応リセット",
    "補償リセット",
    "定期リセット",
    "任意リセット",
    "予測",
    "履歴",
    "最新情報",
    "OpenAI Status",
  ],
  openGraph: {
    title: "Codex制限解除・使用量リセット情報 | 利用上限リセット履歴",
    description: siteOgDescription,
    url: siteUrl,
    siteName: structuredSiteName,
    locale: "ja_JP",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: siteTitle,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex制限解除・使用量リセット情報 | 利用上限リセット履歴",
    description: siteOgDescription,
    images: ["/og-image.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const locale = getDocumentLocale(requestHeaders.get("x-codex-pathname") ?? "/");

  return (
    <html lang={locale}>
      <body>
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
