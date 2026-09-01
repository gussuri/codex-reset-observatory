# 公開確率モデルのgovernance記録

この文書は、2026-09-01時点の設定、runtime、prospective evaluation、リポジトリ履歴を照合した現行状態の監査記録です。過去時点のevaluation reportやdesign specは、その時点のスナップショットとして書き換えません。

## Current status

| 役割 | model version / value |
| --- | --- |
| 公開モデル（boundary以後） | `hazard-regime-random-continuous-calibrated-post-reset-age-v2`（post-reset-age model） |
| boundary前のruntime/public baseline | `hazard-regime-random-continuous-calibrated-v1`（Model B） |
| 比較用のprevious model | `hazard-regime-random-continuous-calibrated-v1`（Model B） |
| 安定fallback | `hazard-elapsed-v1` |
| adoption mode | `manual` |
| v2 adoption date | `2026-09-01` |
| v2 adoption timestamp | `2026-09-01T08:00:00.000Z` |
| previous B adoption timestamp | `2026-08-23T02:04:00.000Z` |
| prospective gate status | `not_met` |
| v2 boundary status | `production_boundary_set` |
| v2 calibration training source | `hazard-regime-random-continuous-calibrated-v1` |

Model A（`hazard-ensemble-logit-stack-v1`）とModel C（`hazard-contextual-burst-circadian-v1`）はshadow/evaluation用です。v2候補はB v1のcalibration training rowsを継承し、post-reset ageのregime attenuationだけを追加します。signal policy、calibration、過去rowのラベルは変更しません。

## Gate and manual adoption

`not_met` はprospective evaluationの診断状態であり、`adoption mode = manual` のときに公開モデルを自動的に無効化するruntime switchではありません。gateの結果だけでv2を自動publishしたり、旧Bを自動rollbackしたりしません。

v2のProduction adoption boundaryは`2026-09-01T08:00:00.000Z`（UTC）に設定しています。boundary前はruntimeが旧B v1を使用し、boundary以後はv2の予測が有効な場合にv2を選択します。無効・例外の場合は従来どおりのfallback chainへ退避し、過去のforecast rowをv2として再ラベルしません。

logging cycleでは、同じoriginについてv2と旧B v1を`prediction_history.debug_info.experimentalProbabilityForecasts`へ保存します。prospective evaluatorは`2026-09-01T08:00:00.000Z`以後に生成されたforecastだけをv2と旧Bの比較対象にし、boundary前のrowは保持するだけです。

## 2026-08-23 previous B adoption record

- adoption timestamp: `2026-08-23T02:04:00.000Z`
- adopted model: `hazard-regime-random-continuous-calibrated-v1`（Model B）
- previous model: `hazard-odds-v4-logit-calibrated-prequential-v3`
- adoption mode: `manual`
- gate status at adoption: `not_met`
- prospective evaluation: 継続
- backfill: 実施しない
- auto-publish: 実施しない

この記録は旧B v1の過去採用を表します。v2の採用記録ではありません。採用時点の詳細な性能比較や意思決定メモまでは確認できないため、採用理由の詳細は **rationale not fully recorded at adoption time** であり、この節は **retrospective documentation** です。性能改善やgate達成を事後的に断定しません。

## Evaluation status

evaluationはprospective-onlyです。v2のraw model差分は0–24h post-reset ageのregime attenuationだけで、calibrationは旧B v1から継承します。既存のgate条件はtarget reset数、resolved daily 24h/48h数、Brier、log lossを使うmanual-review用の診断です。gateを満たしても公開モデルは自動変更されません。

過去のnext-generation evaluation reportやpublished-model reportはhistorical snapshotとして保持します。これらの過去値をv2の実績へ混ぜたり、prediction historyを遡及して書き換えたりしません。v2の性能差は、明示的なProduction boundary以後に同一originで保存されたv2/旧Bのprospective dataが十分に蓄積されてから評価します。

## Rollback criteria

rollbackは自動化せず、既存のprospective evaluationとmanual reviewで判断します。少なくとも次のいずれかを確認した場合は、v2と旧Bの比較を再確認します。

- material calibration regression
- runtime or model failure
- 旧Bに対して明らかに悪いprospective performance

これは運用上の判断条件であり、未承認の新しい数値thresholdを追加するものではありません。十分なresolved sampleが得られた後は、既存gateと比較指標、runtimeの安定性、point-in-time境界をまとめてレビューします。rollbackを行う場合も、過去のevaluation reportやprediction historyを遡って書き換えません。

## Source of truth

model version、adoption timestamp、boundary status、mode、gate status、calibration training sourceの機械可読なsource of truthは`data/shadowProbabilityConfig.ts`です。runtimeの選択とfallbackは`lib/radar/publishedProbability.ts`、同一origin loggingは`lib/nextGenerationLogging.ts`、prospective reportの生成は`lib/radar/prospectivePublishedModelEvaluation.ts`が担います。この文書はそれらの意味と監査履歴を補足するもので、新しいDB schemaや公開DTOを追加しません。
