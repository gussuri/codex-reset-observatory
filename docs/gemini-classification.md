# Gemini分類モードと環境変数

Tibo氏（`@thsottiaux`）のX投稿分類では、ルールベース分類を常に実行し、必要な場合だけGemini APIによる分類を追加できます。Geminiは分類を補助・監査するための仕組みであり、完全自律のエージェントとして動作するものではありません。

## 分類モード

`GEMINI_CLASSIFICATION_MODE` で動作を選択します。

| モード | 最終分類 | Geminiの扱い |
| --- | --- | --- |
| `off` | ルール分類 | Geminiを呼び出さない |
| `shadow` | ルール分類 | Geminiの結果を監査列へ保存 |
| `primary` | Geminiの有効な成功結果。失敗時はルール分類へfallback | Geminiを最終分類候補として利用 |
| `hybrid` | `primary` と同じ | `primary` の後方互換名 |

`primary` では、Geminiのタイムアウト・レート制限・不正なJSON・スキーマ不一致・証拠引用の不一致・APIエラー・モデル未設定などが発生した場合、投稿全体を失敗にせずルール分類を保存します。`shadow` ではGeminiが失敗してもルール分類が最終結果です。

## 環境変数

```bash
# off: ルールのみ / shadow: ルールを採用してAIを監査保存 /
# primary: 成功時はAIを採用し、失敗時はルールへfallback
GEMINI_CLASSIFICATION_MODE=primary

# 利用するモデルの例
GEMINI_MODEL=gemini-3.5-flash-lite

# Google AI Studio APIキー。実際の値はリポジトリ外の環境変数へ設定する
GEMINI_API_KEY=<set outside this repository>
```

`GEMINI_MODEL` は呼び出すモデル名、`GEMINI_API_KEY` はGoogle AI Studioの認証情報です。APIキーをREADME、ドキュメント、Issue、ログ、コミットへ記載しないでください。

## 実行上の制約と保存内容

- 1投稿あたりのGemini API呼び出しは最大1回です。
- モデルの自動フォールバックは行いません。Geminiが失敗した場合の最終結果のfallbackは、`primary`／`hybrid` の分類選択処理でルール分類へ戻します。
- Geminiの応答は、4種類のシグナル種別、信頼度、時間方向、本文内に存在する証拠引用などを検証してから利用します。
- ルール分類、Gemini分類、モデル名、分類ステータス、分類元はSupabaseの `public.tibo_signals` に監査情報として保存されます。

分類ステータスには `success`、`skipped`、`timeout`、`rate_limited`、`invalid_json`、`invalid_schema`、`invalid_evidence`、`api_error`、`model_not_configured` などがあります。

比較用SQLと監査列の確認方法は、[AI分類の比較・監査用SQL](ai-classification-audit.md)を参照してください。監視全体の運用・復旧手順は、[Tibo監視とリセット履歴更新の運用・復旧手順](operations/tibo-monitor-runbook.md)にあります。
