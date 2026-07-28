# Codex Reset Observatory (Codex リセット観測所)

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-black?style=flat-square&logo=vercel)](https://vercel.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-5min_Cron-orange?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

OpenAI Codex および ChatGPT Work の利用上限（レートリミット）強制リセット・ご祝儀リセット・障害補償リセットの発生確率をリアルタイムに予測・可視化する観測所ダッシュボードです。

---

## 🌟 主な特徴

- 📊 **確率予測レーダー**: 直近のリセット履歴・経過日数・障害件数・コミュニティの報告量を統合解析し、24時間以内／48時間以内のリセット確率を統計モデルでリアルタイム試算。
- ⏱️ **Cloudflare Workers 5分タイマー**: 定期的なCron Triggerにより、5分おきに自動監視プロセスを即座に起動。
- 🤖 **Tibo氏 X (Twitter) 自動監視システム**: OpenAI Codex 開発責任者 Tibo氏 (`@thsottiaux`) の投稿を Twitter Syndication API 経由で自動チェック。
- 🧠 **Gemini AI 自動分類エンジン**: ツイート本文を Gemini AI (`gemini-flash-latest` / `gemini-2.0-flash`) が文脈解析し、「匂わせ投稿 (TEASER_HINT)」「正式告知 (OFFICIAL_NOTICE)」「リセット完了 (RESET_COMPLETED)」を分類・判定。
- 🛡️ **マルチモデル自動迂回 (High Availability)**: 5段階の Gemini モデルフォールバック機構により、APIリミットや一次的な応答エラー時も自動で代替モデルに切り替えて高い可用性を確保。
- ⚡ **フルオートデプロイメント**: 新しい匂わせや正式告知、リセット完了を検知した瞬間、サイトシグナルおよび履歴データに自動書き込みされ、Vercel へ即時デプロイ。
- 🌐 **完全多言語対応**: 日本語 (`ja`)・英語 (`en`)・中国語 (`zh`) に完全対応。時間の自動解釈パーサーを搭載。

---

## 🏗️ 全自動監視 ＆ AI判定アーキテクチャ

```mermaid
flowchart TD
    A["Cloudflare Workers (5分おき Cron Trigger)"] -->|API即時呼び出し| B["GitHub Actions (workflow_dispatch)"]
    B -->|Twitter Syndication API| C["@thsottiaux 最新ツイート抽出"]
    C -->|Gemini AI (5段階 Multi-Model Fallback)| D{AIカテゴリ判定}
    
    D -->|匂わせ / 正式告知| E["data/observationSignals.ts 自動更新"]
    D -->|リセット完了報告| F["data/resetHistory.ts 自動追記 & 旧シグナル全クリア"]
    D -->|無関係な日常ツイート| G["処理スキップ (Vercelデプロイなし)"]
    
    E --> H["Git Auto Commit & Push"]
    F --> H
    H --> I["Vercel 自動デプロイ (本番反映)"]
```

---

## 🛠️ 技術スタック

- **Framework**: Next.js 15 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS, Lucide Icons
- **AI Engine**: Google Gemini API (`gemini-flash-latest`, `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-1.5-flash`, `gemini-pro-latest`)
- **Automation / Timer**: Cloudflare Workers (5-min Cron Trigger), GitHub Actions (`workflow_dispatch`), Twitter Syndication API
- **Deployment**: Vercel

---

## 📄 ライセンス

This project is open-source under the [MIT License](LICENSE).
