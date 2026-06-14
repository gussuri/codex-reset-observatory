import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const siteUrl = "https://codex-reset-observatory.vercel.app";
const siteTitle = "Codexリセット観測所";
const siteDescription =
  "Codexのリセット履歴、次回定期リセット、ランダムリセット期待度、任意リセットの扱いを日本語で確認できる非公式サイトです。";
const siteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteTitle,
  url: siteUrl,
  description: siteDescription,
  inLanguage: "ja-JP",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: siteTitle,
  title: {
    default: `${siteTitle} | Codexリセット履歴・定期リセット・期待度`,
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
    "Codex 使用量 リセット",
    "Codex レート制限",
    "ランダムリセット",
    "臨時リセット",
    "補償リセット",
    "定期リセット",
    "任意リセット",
    "予測",
    "履歴",
    "最新情報",
    "OpenAI Status",
  ],
  openGraph: {
    title: `${siteTitle} | Codexリセット履歴・定期リセット・期待度`,
    description: siteDescription,
    url: siteUrl,
    siteName: siteTitle,
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
    title: `${siteTitle} | Codexリセット履歴・定期リセット・期待度`,
    description: siteDescription,
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
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
