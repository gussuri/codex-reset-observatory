import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codexリセット観測所",
  description: "Codex Reset Radar の情報を日本語で整理して表示します。",
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
