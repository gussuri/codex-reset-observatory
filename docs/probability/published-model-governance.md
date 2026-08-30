# 公開確率モデルのgovernance記録

この文書は、2026-08-30時点の設定、runtime、prospective evaluation、リポジトリ履歴を照合した現行状態の監査記録です。過去時点のevaluation reportやdesign specは、その時点のスナップショットとして書き換えません。

## Current status

| 役割 | model version / value |
| --- | --- |
| 現在の公開モデル | `hazard-regime-random-continuous-calibrated-v1`（Model B） |
| 比較用のprevious model | `hazard-odds-v4-logit-calibrated-prequential-v3` |
| 安定fallback | `hazard-elapsed-v1` |
| adoption mode | `manual` |
| adoption date | `2026-08-23` |
| adoption timestamp | `2026-08-23T02:04:00.000Z` |
| previous adoption timestamp | `2026-08-20T11:21:37.105Z` |
| prospective gate status | `not_met` |

Model A（`hazard-ensemble-logit-stack-v1`）とModel C（`hazard-contextual-burst-circadian-v1`）はshadow/evaluation用です。Bのadoptionは、A/Cの採用やfreeze定義を変更するものではありません。

## Gate and manual adoption

`not_met` はprospective evaluationの診断状態であり、`adoption mode = manual` のときに公開モデルを自動的に無効化するruntime switchではありません。したがって、gate未達のままBを手動採用することは、現在の設計上の矛盾ではありません。gateの結果だけでBを自動rollbackしたり、自動publishしたりしません。

公開計算は、10分単位に丸めた計算時刻がadoption boundaryより前ならv3を選択し、boundary以後ならBの予測が有効な場合にBを選択します。Bの予測が無効・例外の場合は、既存のfallback chainに従ってv3、`hazard-elapsed-v1`、legacy shadow、heuristicへ順に退避します。gate statusはこの選択順を変更しません。

## 2026-08-23 adoption record

- adoption timestamp: `2026-08-23T02:04:00.000Z`
- adopted model: `hazard-regime-random-continuous-calibrated-v1`（Model B）
- previous model: `hazard-odds-v4-logit-calibrated-prequential-v3`
- adoption mode: `manual`
- gate status at adoption: `not_met`
- prospective evaluation: 継続
- backfill: 実施しない
- auto-publish: 実施しない

リポジトリ履歴には、preregistered next-generation Bをpublic probability pathへ昇格し、point-in-time adoption boundaryとshadow evaluation boundaryを維持する変更が記録されています。採用時点の詳細な性能比較や意思決定メモまでは確認できないため、採用理由の詳細は **rationale not fully recorded at adoption time** であり、この節は **retrospective documentation** です。性能改善やgate達成を事後的に断定しません。

## Evaluation status

evaluationはprospective-onlyです。既存のgate条件は、target reset数、resolved daily 24h/48h数、Brier、log lossを使うmanual-review用の診断です。gateを満たしても公開モデルは自動変更されません。

監査時点でrepoに保存されているnext-generation evaluation reportは、2026-08-21生成のadoption前スナップショットで、statusは`insufficient_data`、public/A/B/comparableはすべて0、resolved 24h/48hとtarget reset数も0です。2026-08-13生成のpublished-model reportも、それ以前の公開モデル状態を記録したhistorical snapshotです。これらの過去値は改ざんせず、現行configの状態を表す資料として扱いません。今後のprospective dataが蓄積されるまで、Bとprevious modelの性能差は結論づけません。

## Rollback criteria

rollbackは自動化せず、既存のprospective evaluationとmanual reviewで判断します。少なくとも次のいずれかを確認した場合は、Bとprevious modelの比較を再確認します。

- material calibration regression
- runtime or model failure
- previous modelに対して明らかに悪いprospective performance

これは運用上の判断条件であり、未承認の新しい数値thresholdを追加するものではありません。十分なresolved sampleが得られた後は、既存gateと比較指標、runtimeの安定性、point-in-time境界をまとめてレビューします。rollbackを行う場合は、configのadoption記録と理由を同時に更新し、過去のevaluation reportやprediction historyを遡って書き換えません。

## Source of truth

model version、adoption timestamp、mode、gate statusの機械可読なsource of truthは`data/shadowProbabilityConfig.ts`です。runtimeの選択とfallbackは`lib/radar/publishedProbability.ts`、prospective reportの生成は`lib/radar/prospectivePublishedModelEvaluation.ts`が担います。この文書はそれらの意味と監査履歴を補足するもので、新しいDB schemaや公開DTOを追加しません。
