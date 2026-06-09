# Codex Reset Observatory

Codexの公式リセット予告、定期リセット、履歴、期待度を表示する Next.js アプリです。

## Setup

```powershell
pnpm install
pnpm dev
```

## DeepL translation for reasoning text

理由文を日本語訳して表示するには、以下の環境変数を設定してください。

- `DEEPL_API_KEY`: DeepL API のキー
- `DEEPL_API_BASE_URL`: 任意。`https://api-free.deepl.com` または `https://api.deepl.com`

設定がない場合は、理由の翻訳はスキップされます。
