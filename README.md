# Codex Reset Observatory (Codex リセット観測所)

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-black?style=flat-square&logo=vercel)](https://vercel.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

OpenAI Codex および ChatGPT Work の利用上限（レートリミット）強制リセット・ご祝儀リセット・障害補償リセットの発生確率をリアルタイムに予測・可視化する観測所ダッシュボードです。

---

## 🌟 主な特徴

- 📊 **確率予測レーダー**: 直近のリセット履歴・経過日数・障害件数・コミュニティの報告量を統合解析し、24時間以内／48時間以内のリセット確率を統計モデルでリアルタイム試算。
- 🤖 **Tibo氏 X (Twitter) 自動監視システム**: OpenAI Codex 開発責任者 Tibo氏 (`@thsottiaux`) の投稿を Twitter Syndication API 経由で15分おきに全自動チェック。
- 🧠 **Gemini AI 自動分類エンジン**: ツイート本文を Gemini AI (`gemini-flash-latest` / `gemini-2.0-flash`) が自動解釈し、「匂わせ投稿 (TEASER_HINT)」「正式告知 (OFFICIAL_NOTICE)」「リセット完了 (RESET_COMPLETED)」を100%の精度で分類・判定。
- ⚡ **フルオートデプロイメント**: 新しい匂わせや正式告知、リセット完了を検知した瞬間、サイトシグナルおよび履歴データに自動書き込みされ、Vercel へ即時デプロイ。
- 🌐 **完全多言語対応**: 日本語 (`ja`)・英語 (`en`)・中国語 (`zh`) に完全対応。時間の自動解釈パーサーを搭載。

---

## 🏗️ 自動監視アーキテクチャ

```mermaid
flowchart TD
    A["X (@thsottiaux) 定期チェック"] -->|15分おき / Cron| B["GitHub Actions (monitor-x.yml)"]
    B -->|Twitter Syndication API| C["ツイート抽出"]
    C -->|Gemini AI (Multi-Model Fallback)| D{AIカテゴリ判定}
    
    D -->|匂わせ / 正式告知| E["data/observationSignals.ts 自動更新"]
    D -->|リセット完了報告| F["data/resetHistory.ts 自動追記 & 旧シグナル自動クリア"]
    D -->|無関係な日常ツイート| G["処理スキップ"]
    
    E --> H["Git Auto Commit & Push"]
    F --> H
    H --> I["Vercel 自動デプロイ (本番反映)"]
```

---

## 🛠️ 技術スタック

- **Framework**: Next.js 15 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS, Lucide Icons
- **AI Engine**: Google Gemini API (`gemini-flash-latest`, `gemini-2.0-flash`)
- **Automation**: GitHub Actions (Cron 15-min interval), Twitter Syndication API
- **Deployment**: Vercel

---

## 📄 ライセンス

This project is open-source under the [MIT License](LICENSE).
