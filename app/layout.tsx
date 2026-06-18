import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const siteUrl = "https://codex-reset-observatory.vercel.app";
const siteTitle = "Codexリセット観測所";
const siteDescription =
  "Codexの利用上限リセット、制限解除、障害対応・補償リセットの予告と履歴を整理。次回参考日やランダムリセット期待度も確認できます。";
const siteOgDescription =
  "Codexの利用上限がいつ戻るかを確認する非公式サイト。公式予告、障害対応・補償リセット履歴、次回参考日、リセット期待度をまとめています。";
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
    default: "Codex利用上限リセット情報 | 制限解除・補償リセット履歴",
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
    "Codex トークン リセット",
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
    title: "Codex利用上限リセット情報 | 制限解除・補償リセット履歴",
    description: siteOgDescription,
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
    title: "Codex利用上限リセット情報 | 制限解除・補償リセット履歴",
    description: siteOgDescription,
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
