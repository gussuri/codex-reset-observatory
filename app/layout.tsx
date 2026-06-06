import type { Metadata } from "next";
import "./globals.css";

const siteUrl = "https://codex-reset-observatory.vercel.app";
const siteTitle = "Codexリセット観測所";
const siteDescription =
  "Codexのリセット予測、24時間・48時間以内の確率、最新リセット履歴を日本語で確認できる観測サイトです。";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: siteTitle,
  title: {
    default: `${siteTitle} | Codexリセット予測・履歴・最新情報`,
    template: `%s | ${siteTitle}`,
  },
  description: siteDescription,
  keywords: [
    "Codex",
    "リセット",
    "予測",
    "履歴",
    "最新情報",
    "Codex Reset Radar",
  ],
  openGraph: {
    title: `${siteTitle} | Codexリセット予測・履歴・最新情報`,
    description: siteDescription,
    url: siteUrl,
    siteName: siteTitle,
    locale: "ja_JP",
    type: "website",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: siteTitle,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteTitle} | Codexリセット予測・履歴・最新情報`,
    description: siteDescription,
    images: ["/og-image.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
