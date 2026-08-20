# 公開モデルのprospective評価

2026-08-20までは`hazard-elapsed-v1`が公開モデルでした。現在の公開モデルは、`hazard-odds-v4-logit-calibrated-prequential-v3`を2026-08-20T11:30:00Zに手動採用する境界として記録したものです。採用時点ではprospective gateは未達で、自動公開や過去rowの書き換えは行いません。

v3は、v2と同じ校正・prequential仕様を使い、teaserStrengthを反映したraw forecastとhorizon-awareな公式予告処理を持ちます。v2の旧手動採用時刻`2026-08-20T09:28:17Z`は履歴metadataとして保持します。v3の採用境界以後は、`prediction_history.debug_info.experimentalProbabilityForecasts`へv3と旧v2のforecastを同一originで保存し、v3を公開モデル、v2を比較用baselineとして評価できます。境界前のv2 forecastは保持し、v3の公開実績へ再分類しません。`hazard-elapsed-v1`は安定フォールバックおよび過去比較用に保持し、`hazard-regime-elapsed-v1`は同じ固定設定のfull regime shadowとして並行保存・評価します。

採用境界以後の評価期間の開始日時は、両方のモデル予測が同じ保存rowに初めて存在した時刻から自動的に決まります。公開前の履歴をbackfillしたり、過去の予測を新モデルとして書き換えたりしません。

正式比較はAsia/Tokyoの日付ごとに最初のforecastを1件だけ選びます。24時間または48時間の観測期間が`asOf`時点で完了していないforecastは採点対象外です。正解イベントは広域・実施済みのランダムリセットだけで、定期リセットは正例になりません。

`hazard-elapsed-v1`、`hazard-regime-elapsed-v1`、校正v2/v3のprior・point-in-time projection・minimum sample設定は固定します。新しいリセットが1件発生したことや、単発の予測が外れたことを理由に再最適化しません。既存のprospective gateは引き続き評価専用で、採用判断を自動化しません。`prediction_history`は`logged_hour`ごとに最初のrowを保持し、後続実行で過去forecastを上書きしません。

レポートのgateは手動レビュー専用であり、評価結果から公開モデルを自動変更しません。生成コマンドは次です。

```text
corepack pnpm run evaluate:prospective-published-model
```
