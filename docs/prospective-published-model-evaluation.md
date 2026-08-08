# 公開モデルのprospective評価

`hazard-regime-elapsed-v1`は、公開後に`prediction_history.debug_info.experimentalProbabilityForecasts`へ保存された予測だけを使って、`hazard-odds-v3-recency-bayes-h30-r3`と比較します。

評価期間の開始日時は固定値ではなく、両方のモデル予測が同じ保存rowに初めて存在した時刻から自動的に決まります。公開前の履歴をbackfillしたり、過去の予測を新モデルとして書き換えたりしません。

正式比較はAsia/Tokyoの日付ごとに最初のforecastを1件だけ選びます。24時間または48時間の観測期間が`asOf`時点で完了していないforecastは採点対象外です。正解イベントは広域・実施済みのランダムリセットだけで、定期リセットは正例になりません。

`hazard-regime-elapsed-v1`のbin、prior、regime half-life、exponent、signal multiplierは、prospectiveデータが十分に蓄積されるまで固定します。新しいリセットが1件発生したことや、単発の予測が外れたことを理由に再最適化しません。

レポートのgateは手動レビュー専用であり、評価結果から公開モデルを自動変更しません。生成コマンドは次です。

```text
corepack pnpm run evaluate:prospective-published-model
```
