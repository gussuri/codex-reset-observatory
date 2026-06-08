import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const siteUrl = "https://codex-reset-observatory.vercel.app";
const siteTitle = "Codexリセット観測所";
const siteDescription =
  "Codexのランダムリセット、臨時リセット、補償リセットの予告・期待度・履歴を日本語で確認できる非公式観測サイトです。";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: siteTitle,
  title: {
    default: `${siteTitle} | Codexランダムリセット予告・履歴・期待度`,
    template: `%s | ${siteTitle}`,
  },
  description: siteDescription,
  keywords: [
    "Codex",
    "リセット",
    "ランダムリセット",
    "臨時リセット",
    "補償リセット",
    "予測",
    "履歴",
    "最新情報",
    "Codex Reset Radar",
  ],
  openGraph: {
    title: `${siteTitle} | Codexランダムリセット予告・履歴・期待度`,
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
    title: `${siteTitle} | Codexランダムリセット予告・履歴・期待度`,
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
        {children}
        <Analytics />
      </body>
    </html>
  );
}
