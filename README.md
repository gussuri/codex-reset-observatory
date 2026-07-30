# Codex Reset Observatory (Codex リセット観測所)

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-black?style=flat-square&logo=vercel)](https://vercel.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

OpenAI Codex および ChatGPT Work の利用上限（レートリミット）強制リセット・ご祝儀リセット・障害補償リセットの発生確率をリアルタイムに予測・可視化する観測所ダッシュボードです。

---

## 🌟 主な特徴

- 📊 **確率予測レーダー**: 直近のリセット履歴・経過日数・障害件数・コミュニティの報告量を統合解析し、24時間以内／48時間以内のリセット確率を統計モデルでリアルタイム試算。
- 📝 **公式シグナルのリアルタイム監視**: Chrome拡張機能 / Webhook 経由で Tibo氏（@thsottiaux）の投稿を自動収集。ルールベース分類エンジン＋Gemini AI シャドー分類器で監査・蓄積。
- 🌐 **完全多言語対応**: 日本語 (`ja`)・英語 (`en`)・中国語 (`zh`) に完全対応。時間の自動解釈パーサーを搭載。

---

## 🤖 Gemini AI シャドー分類器（設定・環境変数）

Tibo氏のX投稿分類の精度検証のため、Gemini API による **シャドー分類モード** をサポートしています。

### 環境変数設定例
```bash
# シャドー分類の動作モード (off: 無効 [デフォルト], shadow: AI結果をDB保存するが公開確率へは非反映)
GEMINI_CLASSIFICATION_MODE=off

# 推奨モデル (gemini-3.5-flash-lite)
GEMINI_MODEL=gemini-3.5-flash-lite

# Google AI Studio API キー
GEMINI_API_KEY=your_gemini_api_key_here
```

> **Note**: レート制限遵守のため、1投稿あたり Gemini API 呼び出しは最大1回とし、モデルの自動フォールバックは行いません。API障害やレート超過時は自動的に既存のルール分類へフォールバックします。

---

## 🔍 Supabase AI シャドー分類 比較監査用 SQL

Gemini AI 分類器（シャドーモード）と既存ルール分類の比較・評価を行うための SQL クエリです。

### 1. 全シグナルのルール分類 vs AI分類の比較
```sql
SELECT
  tweet_created_at,
  LEFT(text, 120) AS text,
  rule_signal_type,
  rule_confidence,
  ai_signal_type,
  ai_confidence,
  ai_temporal_direction,
  ai_evidence_quote,
  ai_reason_ja,
  ai_model,
  ai_classification_status
FROM public.tibo_signals
ORDER BY tweet_created_at DESC;
```

### 2. ルール分類とAI分類の不一致ケース抽出
```sql
SELECT
  tweet_created_at,
  LEFT(text, 120) AS text,
  rule_signal_type,
  ai_signal_type,
  rule_confidence,
  ai_confidence,
  ai_reason_ja
FROM public.tibo_signals
WHERE ai_classification_status = 'success'
  AND rule_signal_type IS DISTINCT FROM ai_signal_type
ORDER BY tweet_created_at DESC;
```

---

## 🛠️ 技術スタック

- **Framework**: Next.js 15 (App Router), React 18, TypeScript
- **Database**: Supabase (PostgreSQL / RLS)
- **Deployment**: Vercel

---

## 📄 ライセンス

This project is open-source under the [MIT License](LICENSE).
