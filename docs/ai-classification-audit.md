# AI分類の比較・監査用SQL

Gemini分類器（`shadow` モードを含む）と既存のルール分類を比較・評価するためのSQLです。SupabaseのSQL Editorなど、管理権限のある環境で実行してください。

## 全シグナルの比較

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

この一覧では、ルール分類とAI分類の種別・信頼度、Geminiのモデル名とステータス、時間方向、証拠引用、理由を投稿時刻の新しい順に確認できます。

## 分類結果が不一致のケース

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

`ai_classification_status = 'success'` かつ種別が異なる投稿だけを抽出します。判定を手動で訂正する場合も行自体は削除せず、運用・復旧手順に従って `verification_status` を更新してください。
