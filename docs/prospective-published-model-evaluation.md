# 公開モデルのprospective評価

2026-08-20までは`hazard-elapsed-v1`、その後2026-08-23T02:04:00.000Zまでは`hazard-odds-v4-logit-calibrated-prequential-v3`が公開モデルでした。現在の公開モデルは、`hazard-regime-random-continuous-calibrated-v1`（Model B）を2026-08-23T02:04:00.000Zに手動採用したものです。adoption modeは`manual`で、採用時点のprospective gateは`not_met`でした。gate未達でも、手動採用を自動で無効化したり、過去rowを書き換えたりしません。

Bは、`prediction_history.debug_info.experimentalProbabilityForecasts`に保存されるv3との同一origin比較を使ってprospectiveに評価します。Bのadoption後はBを公開モデル、`hazard-odds-v4-logit-calibrated-prequential-v3`を比較用previous baselineとして扱います。境界前のforecastは保持し、Bの公開実績へ再分類しません。`hazard-elapsed-v1`は安定fallback、`hazard-regime-elapsed-v1`は固定設定のfull regime shadowとして保持します。Model AとCはshadow/evaluation用で、Bの公開採用には含めません。

採用境界以後の評価期間の開始日時は、両方のモデル予測が同じ保存rowに初めて存在した時刻から自動的に決まります。公開前の履歴をbackfillしたり、過去の予測を新モデルとして書き換えたりしません。

正式比較はAsia/Tokyoの日付ごとに最初のforecastを1件だけ選びます。24時間または48時間の観測期間が`asOf`時点で完了していないforecastは採点対象外です。正解イベントは広域・実施済みのランダムリセットだけで、定期リセットは正例になりません。

`hazard-elapsed-v1`、`hazard-regime-elapsed-v1`、校正v2/v3のprior・point-in-time projection・minimum sample設定は固定します。新しいリセットが1件発生したことや、単発の予測が外れたことを理由に再最適化しません。既存のprospective gateは引き続き評価専用で、採用判断を自動化しません。`prediction_history`は`logged_hour`ごとに最初のrowを保持し、後続実行で過去forecastを上書きしません。

レポートのgateは手動レビュー専用であり、評価結果から公開モデルを自動変更しません。生成コマンドは次です。

```text
corepack pnpm run evaluate:prospective-published-model
```
