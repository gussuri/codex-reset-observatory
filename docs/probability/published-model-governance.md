# 公開確率モデルのgovernance記録

この文書は、2026-09-10時点の設定、runtime、prospective evaluation、リポジトリ履歴を照合した現行状態の監査記録です。過去時点のevaluation reportやdesign specは、その時点のスナップショットとして書き換えません。

## Current status

| 役割 | model version / value |
| --- | --- |
| 公開モデル（2026-09-10T01:00:00.000Z以後） | `hazard-regime-random-continuous-selective-calibration-post-reset-age-v3`（selective hybrid） |
| 比較用のprevious model | `hazard-regime-random-continuous-calibrated-post-reset-age-v2`（Model B v2） |
| v2より前のhistorical model | `hazard-regime-random-continuous-calibrated-v1`（Model B v1） |
| 安定fallback | `hazard-elapsed-v1` |
| adoption mode | `manual` |
| selective hybrid adoption date | `2026-09-10` |
| selective hybrid adoption timestamp | `2026-09-10T01:00:00.000Z` |
| previous v2 adoption timestamp | `2026-09-01T08:00:00.000Z` |
| previous B v1 adoption timestamp | `2026-08-23T02:04:00.000Z` |
| prospective gate status | `not_met` |
| current boundary status | `production_boundary_set` |
| v2 calibration training source | `hazard-regime-random-continuous-calibrated-v1` |

Model A（`hazard-ensemble-logit-stack-v1`）とModel C（`hazard-contextual-burst-circadian-v1`）はshadow/evaluation用です。selective hybrid v3は既存のpost-reset age計算を使い、24hのcalibrationをdiagnostic-only、48hのcalibrationを適用します。official notice override、teaser policy、horizon coherence、B v1由来のcalibration training identityは変更しません。

## Gate and manual adoption

`not_met` はprospective evaluationの診断状態であり、`adoption mode = manual` のときに公開モデルを自動的に無効化するruntime switchではありません。gateの結果だけでselective hybrid v3を自動publishしたり、v2を自動rollbackしたりしません。

selective hybrid v3のProduction adoption boundaryは`2026-09-10T01:00:00.000Z`（UTC）に設定しています。これは採用判断・同期・検証・Production反映予定より後ろに置いた将来境界です。`2026-09-01T08:00:00.000Z`以後かつ現行boundary前はv2、その前はB v1を使用します。現行boundary以後はselective hybrid v3の予測が有効な場合に選択します。無効・例外の場合は従来どおりのfallback chainへ退避し、過去のforecast rowを新しいモデルとして再ラベルしません。

logging cycleでは、同じoriginについてB v1、v2、selective hybrid v3を`prediction_history.debug_info.experimentalProbabilityForecasts`へ保存します。prospective evaluatorは採用境界ごとに対象期間を分離し、過去boundary前のrowを現行モデルとして再利用しません。

## 2026-09-01 previous v2 adoption record

- adoption timestamp: `2026-09-01T08:00:00.000Z`
- adopted model: `hazard-regime-random-continuous-calibrated-post-reset-age-v2`
- previous model: `hazard-regime-random-continuous-calibrated-v1`
- adoption mode: `manual`
- gate status at adoption: `not_met`
- backfill: 実施しない
- auto-publish: 実施しない

この記録はselective hybrid v3より前の公開期間を表します。過去のv2 reportやprediction rowを現行hybridの実績へ混ぜません。

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

Productionの採用判定に使うruntime evaluationはprospective-onlyです。selective hybrid v3は0–24h post-reset ageの既存計算を継承し、24hはcalibrationをdiagnostic-only、48hはv2と同じcalibrationを適用します。既存のgate条件はtarget reset数、resolved daily 24h/48h数、Brier、log lossを使うmanual-review用の診断です。gateを満たしても公開モデルは自動変更されません。

採用根拠の監査用に、保存済みv2 artifactから構成した別の `saved-artifact retrospective counterfactual` を追加しています。`reports/prospective-published-hybrid-counterfactual-corrected-20260910.json` と `.md` は、現行canonical reset truth（誤っていた `usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec` を含めない）に対するv2とselective hybridの比較です。このcounterfactualはprospective成績、gate、auto-publish判定ではありません。

このcorrected artifactでは、24hのBrierが `0.209685` から `0.152611`、log lossが `0.578715` から `0.461204` へ低下し、48hはv2とhybridが同じ `0.218133` / `0.637355` でした。これは全面的な性能向上の主張ではなく、24h calibrationのmaterial regressionだけを除去し、48h calibrationを維持するmanual corrective adoptionの限定的根拠です。resolved daily sampleは24h 9件、48h 8件、canonical target resetは3件であり、gate=`not_met`は変更しません。

過去のnext-generation evaluation reportやpublished-model reportはhistorical snapshotとして保持します。これらの過去値をselective hybrid v3やv2の実績へ混ぜたり、prediction historyを遡及して書き換えたりしません。現行hybridの性能差は、明示的なProduction boundary以後に同一originで保存されたhybrid/v2のprospective dataが十分に蓄積されてから評価します。

## Rollback criteria

rollbackは自動化せず、既存のprospective evaluationとmanual reviewで判断します。少なくとも次のいずれかを確認した場合は、selective hybrid v3とv2の比較を再確認します。

- material calibration regression
- runtime or model failure
- v2に対して明らかに悪いprospective performance

これは運用上の判断条件であり、未承認の新しい数値thresholdを追加するものではありません。十分なresolved sampleが得られた後は、既存gateと比較指標、runtimeの安定性、point-in-time境界をまとめてレビューします。rollbackを行う場合も、過去のevaluation reportやprediction historyを遡って書き換えません。

## Corrective rollback support (not activated)

The read-only audit recommends a **corrective rollback to old V4** with **confidence: medium-low**. This is a manual corrective action; it is **not a universal superiority claim** and not a new model fit.

- rollback boundary: `null` (support exists but is not activated)
- rollout setting: `PUBLISHED_PROBABILITY_V4_ROLLBACK_AT`
- 2026-09-01 onward same-origin daily-first: resolved 24h=10, 48h=9
- current selective v3: 24h Brier `0.2337`, 48h Brier `0.3601`
- old V4: 24h Brier `0.2133`, 48h Brier `0.3186`
- leave-one-origin-out: V4's advantage direction is retained
- episode leave-out: the 48h advantage is not fully stable

If a future rollout sets a boundary, the periods remain separate: historical V4 before B v1 and corrective-rollback V4 after the boundary are never combined by `modelVersion` alone. The v3 experimental forecasts, `featureSnapshot`, and prospective scoreboard continue during a V4 rollback. `V4-24/C-48` is not implemented, Model C is not added to the public selector, and the official-notice 0.90/0.96 policy is unchanged. The prospective gate remains `not_met`; no historical row, report snapshot, or canonical history is rewritten.

## Source of truth

model version、adoption timestamp、boundary status、mode、gate status、calibration training sourceの機械可読なsource of truthは`data/shadowProbabilityConfig.ts`です。runtimeの選択とfallbackは`lib/radar/publishedProbability.ts`、同一origin loggingは`lib/nextGenerationLogging.ts`、prospective reportの生成は`lib/radar/prospectivePublishedModelEvaluation.ts`が担います。この文書はそれらの意味と監査履歴を補足するもので、新しいDB schemaや公開DTOを追加しません。
