# Codex Reset Observatory (Codex リセット観測所)

Track and explain signals around Codex usage-limit resets.

OpenAI Codex および ChatGPT Work の利用上限（レートリミット）に関するリセットシグナルを集め、リセット履歴やステータス情報とあわせて確率予測・可視化するダッシュボードです。

[**Open the live observatory →**](https://codex-reset-observatory.vercel.app/en)

## 主な機能

- 📊 **確率予測レーダー**: 直近のリセット履歴・経過日数・障害件数・コミュニティの報告量を統合し、12時間以内／24時間以内／48時間以内／72時間以内のリセット確率を試算。
- 📝 **公式シグナルの監視**: Chrome拡張機能とWebhookでTibo氏（@thsottiaux）の投稿を収集し、分類結果と監査情報を保存。
- 🌐 **多言語ダッシュボード**: 日本語 (`ja`)・英語 (`en`)・中国語 (`zh`) に対応し、時間表現の自動解釈も行います。

## LLMを含む技術的な特徴

Tibo氏の投稿は、常に実行されるルールベース分類と、設定時だけ呼び出すGemini分類を組み合わせて処理します。

- `off`: ルール分類のみ。
- `shadow`: ルール分類を最終結果として採用し、Geminiの結果を監査列へ保存。
- `primary`: Geminiの有効な成功結果を採用し、タイムアウト・レート制限・不正応答・APIエラーなどの失敗時はルール分類へfallback。
- `hybrid`: `primary` と同じ動作をする後方互換名。

1投稿あたりのGemini API呼び出しは最大1回で、モデルの自動フォールバックは行いません。設定例と保存される分類ステータスの詳細は、[Gemini分類モードと環境変数](docs/gemini-classification.md)にまとめています。

## 技術スタック

- **Framework**: Next.js 15 (App Router), React 18, TypeScript
- **Data**: Supabase (PostgreSQL / RLS)
- **Monitoring**: Chrome Manifest V3 extension
- **Deployment**: Vercel

## データフロー

```text
Tibo氏のXプロフィール
  → Manifest V3監視拡張
  → /api/webhook/tibo
  → ルール分類 + 任意のGemini分類
  → Supabase の tibo_signals
  → リセット履歴・ステータス情報とのレーダー集約
  → Next.jsダッシュボード
```

## ローカル開発

Node.js と pnpm（`package.json` の `packageManager` は pnpm 11.18.0）を用意してください。

```bash
pnpm install
pnpm dev
```

開発サーバーは通常 `http://localhost:3000` で起動します。動的な監視・分類を試す場合のSupabase、Webhook、Geminiの環境変数はリポジトリ外で設定し、[運用・復旧手順](docs/operations/tibo-monitor-runbook.md)と[Gemini分類モードと環境変数](docs/gemini-classification.md)を参照してください。

## 詳細ドキュメント

- [Gemini分類モードと環境変数](docs/gemini-classification.md)
- [AI分類の比較・監査用SQL](docs/ai-classification-audit.md)
- [Tibo監視とリセット履歴更新の運用・復旧手順](docs/operations/tibo-monitor-runbook.md)
- [TiboのXフィード調査](docs/tibo-x-feed-research.md)
- [監視拡張機能のREADME](extension/tibo-monitor/README.md)

## Developer

開発・運用の記録や個人開発について、Xで発信しています。

[Xで開発者をフォロー](https://x.com/gussuri_s)

## 📄 ライセンス

This project is open-source under the [MIT License](LICENSE).
