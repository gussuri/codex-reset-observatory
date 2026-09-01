# 公開モデルのprospective評価

2026-08-20までは`hazard-elapsed-v1`、その後2026-08-23T02:04:00.000Zまでは`hazard-odds-v4-logit-calibrated-prequential-v3`が公開モデルでした。2026-08-23T02:04:00.000Zに`hazard-regime-random-continuous-calibrated-v1`（Model B）がmanualで採用され、`2026-09-01T08:00:00.000Z`（UTC）を境界として`hazard-regime-random-continuous-calibrated-post-reset-age-v2`へ切り替えます。boundary前のpublic modelは旧B v1、boundary以後はv2です。採用時点のprospective gateは`not_met`でした。gate未達でも、manual governanceは自動publish/rollbackを行わず、過去rowを書き換えません。

v2は、`prediction_history.debug_info.experimentalProbabilityForecasts`に旧B v1と同じoriginで保存される比較forecastを使ってprospectiveに評価します。v2のProduction boundary前のrowは評価対象にせず、v2の公開実績へ再分類しません。boundary以後はv2をactive、旧B v1をbaselineとして扱います。v2はpost-reset ageのregime attenuationだけを変更し、旧B v1のprequential calibration training rows、calibration、signal policyを継承します。`hazard-elapsed-v1`は安定fallback、`hazard-regime-elapsed-v1`は固定設定のfull regime shadowとして保持します。Model AとCはshadow/evaluation用です。

評価期間は、`2026-09-01T08:00:00.000Z`以後に両方のモデル予測が同じ保存rowに存在するところから始まります。boundary前のforecastをbackfillしたり、過去の予測を新モデルとして書き換えたりしません。

正式比較はAsia/Tokyoの日付ごとに最初のforecastを1件だけ選びます。24時間または48時間の観測期間が`asOf`時点で完了していないforecastは採点対象外です。正解イベントは広域・実施済みのランダムリセットだけで、定期リセットは正例になりません。

`hazard-elapsed-v1`、`hazard-regime-elapsed-v1`、校正v2/v3のprior・point-in-time projection・minimum sample設定は固定します。新しいリセットが1件発生したことや、単発の予測が外れたことを理由に再最適化しません。既存のprospective gateは引き続き評価専用で、採用判断を自動化しません。`prediction_history`は`logged_hour`ごとに最初のrowを保持し、後続実行で過去forecastを上書きしません。

レポートのgateは手動レビュー専用であり、評価結果から公開モデルを自動変更しません。生成コマンドは次です。

```text
corepack pnpm run evaluate:prospective-published-model
```
