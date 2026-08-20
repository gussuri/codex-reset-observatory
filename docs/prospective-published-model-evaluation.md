# 公開モデルのprospective評価

2026-08-20までは`hazard-elapsed-v1`が公開モデルでした。現在の公開モデルは、`hazard-odds-v4-logit-calibrated-prequential-v2`を2026-08-20に手動採用したものです。採用時点ではprospective gateは未達で、自動公開や過去rowの書き換えは行っていません。

新モデルは`prediction_history.debug_info.experimentalProbabilityForecasts`へ保存される同一originのforecastと比較できます。`hazard-elapsed-v1`は安定フォールバックおよび過去比較用に保持し、`hazard-regime-elapsed-v1`は同じ固定設定のfull regime shadowとして並行保存・評価します。

評価期間の開始日時は固定値ではなく、両方のモデル予測が同じ保存rowに初めて存在した時刻から自動的に決まります。公開前の履歴をbackfillしたり、過去の予測を新モデルとして書き換えたりしません。

正式比較はAsia/Tokyoの日付ごとに最初のforecastを1件だけ選びます。24時間または48時間の観測期間が`asOf`時点で完了していないforecastは採点対象外です。正解イベントは広域・実施済みのランダムリセットだけで、定期リセットは正例になりません。

`hazard-elapsed-v1`、`hazard-regime-elapsed-v1`、校正v2のprior・point-in-time projection・minimum sample設定は固定します。新しいリセットが1件発生したことや、単発の予測が外れたことを理由に再最適化しません。既存のprospective gateは引き続き評価専用で、採用判断を自動化しません。

レポートのgateは手動レビュー専用であり、評価結果から公開モデルを自動変更しません。生成コマンドは次です。

```text
corepack pnpm run evaluate:prospective-published-model
```
