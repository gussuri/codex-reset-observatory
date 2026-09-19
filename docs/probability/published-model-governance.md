# 公開確率モデルのgovernance記録

この文書は、2026-09-19時点の設定、runtime、prospective evaluation、リポジトリ履歴を照合した現行状態の監査記録です。過去時点のevaluation reportやdesign specは、その時点のスナップショットとして書き換えません。

Canonical model inventory: [model-registry.md](model-registry.md)（machine-readable source: data/probabilityModelRegistry.ts）。

## Current status

| 役割 | model version / value |
| --- | --- |
| 公開モデル（2026-09-19T06:00:00.000Z以後） | `hazard-survival-conditioned-adaptive-h45-tail-h24-v1`（Survival-Conditioned v1） |
| 公開モデル（2026-09-18T06:00:00.000Z〜2026-09-19T06:00:00.000Z） | `hazard-regime-broad-banked-random-continuous-post-reset-age-raw-bw18-tr54-v2`（historical broad-banked random continuous 18/54; fallback/comparison baseline） |
| 公開モデル（2026-09-17T05:45:00.000Z〜2026-09-18T06:00:00.000Z） | `hazard-regime-random-continuous-post-reset-age-raw-bw18-tr54-v1`（historical raw continuous 18/54） |
| 公開モデル（2026-09-10T01:00:00.000Z〜2026-09-11T02:20:00.000Z） | `hazard-regime-random-continuous-selective-calibration-post-reset-age-v3`（historical selective hybrid） |
| 公開モデル（2026-09-11T02:20:00.000Z〜2026-09-17T05:45:00.000Z） | `hazard-odds-v4-logit-calibrated-prequential-v3`（corrective rollback V4） |
| 比較用のprevious model（Survival v1採用後） | `hazard-regime-broad-banked-random-continuous-post-reset-age-raw-bw18-tr54-v2` |
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
| raw 18/54 adoption mode | `manual corrective adoption` |
| raw 18/54 adoption timestamp | `2026-09-17T05:45:00.000Z` |
| raw 18/54 adoption date | `2026-09-17` |
| raw 18/54 freeze timestamp | `2026-09-02T09:00:00.000Z` |
| broad-banked v2 adoption timestamp | `2026-09-18T06:00:00.000Z` |
| broad-banked v2 adoption date | `2026-09-18` |
| broad-banked v2 freeze timestamp | `2026-09-18T03:10:48.666Z` |
| broad-banked v2 regime policy | `broad-banked-boundary-v2` |
| Survival-Conditioned v1 adoption timestamp | `2026-09-19T06:00:00.000Z` |
| Survival-Conditioned v1 adoption date | `2026-09-19` |
| Survival-Conditioned v1 freeze timestamp | `2026-09-18T18:55:00.000Z` |

Model A（`hazard-ensemble-logit-stack-v1`）、Model C（`hazard-contextual-burst-circadian-v1`）、selective hybrid v3、raw 18/54 challengerは、採用期間以外ではshadow/evaluation用です。Survival-Conditioned v1の採用は、新しいfit・retuning・calibrationではなく、凍結済みcandidateの公開切替です。Broad-Banked v2は歴史期間、fallback、comparison baselineとして残し、Survivalのvalidity failureやruntime exception時に既存selector chainから選択します。H45/H24、36件のcompleted-interval support gate、既存のeligibility、signal、official notice、teaser、horizon coherence policyを変更しません。late-age diagnostic arms、context arms、その他のexperiment-only fieldsはpublic selectorへ接続しません。過去のprediction rowとprospective scoreboardはadoption periodを分けて継続します。official notice override、teaser policy、horizon coherence、freezeAt、model versionsは変更しません。

## Gate and manual adoption

`not_met` はprospective evaluationの診断状態であり、`adoption mode = manual` のときに公開モデルを自動的に無効化するruntime switchではありません。gateの結果だけでselective hybrid v3やraw 18/54を自動publishしたり、V4を自動rollbackしたりしません。

selective hybrid v3のProduction adoption boundaryは`2026-09-10T01:00:00.000Z`（UTC）です。`2026-09-01T08:00:00.000Z`以後かつv3 boundary前はv2、その前はB v1を使用しました。v3 boundaryからrollback boundaryまではselective hybrid v3、rollback boundaryからraw boundaryまではcorrective rollback V4、raw boundaryからbroad-banked v2 boundaryまではhistorical raw 18/54を使用します。`2026-09-18T06:00:00.000Z`以後`2026-09-19T06:00:00.000Z`までは、凍結済みbroad-banked v2 challengerを選択しました。`2026-09-19T06:00:00.000Z`以後は、Survival-Conditioned v1の予測が36件以上のcompleted interval support gateを満たし、finite・monotonic・その他のvalidity条件を満たす場合に選択します。各期間は明示boundaryで分離し、無効・例外・非単調な候補はBroad-Banked v2を含む既存fallback chainへ退避します。過去のforecast rowを新しいモデルとして再ラベルしません。

logging cycleでは、同じoriginについてB v1、v2、selective hybrid v3、corrective V4、raw 18/54、Broad-Banked v2、Survival-Conditioned v1を`prediction_history.debug_info.experimentalProbabilityForecasts`へ保存します。prospective evaluatorは採用境界ごとに対象期間を分離し、過去boundary前のrowを現行モデルとして再利用しません。

## 2026-09-18 broad-banked random clock v2 adoption (historical)

- model: `hazard-regime-broad-banked-random-continuous-post-reset-age-raw-bw18-tr54-v2`
- previous public model: `hazard-regime-random-continuous-post-reset-age-raw-bw18-tr54-v1`
- adoption boundary: `2026-09-18T06:00:00.000Z` (UTC), 2026-09-18 15:00 (JST)
- adoption mode: `manual`
- freeze timestamp: `2026-09-18T03:10:48.666Z` (UTC)
- regime policy: `broad-banked-boundary-v2`
- target: broad-scope completed random reset and broad completed banked distribution
- calibration: none; the frozen 18/54 challenger is used as the public base/control arm
- late-age regime diagnostic arms: shadow-only; no late-age arm is publicly selected
- refit/retuning: 実施しない
- backfill/relabel: 実施しない
- public API/DTO/UI: diagnostic-only fields are not exposed
- DB schema/migration: 変更なし

The selector used the v2 boundary after the historical raw 18/54 boundary. After the Survival adoption boundary, Broad-Banked v2 remains the fallback and comparison baseline. If a Broad-Banked calculation throws or produces an invalid/non-monotonic prediction while serving as fallback, the existing fallback chain records the v2-specific audit reason. Existing historical rows retain their original model identity and metadata.

## 2026-09-19 Survival-Conditioned v1 adoption

- model: `hazard-survival-conditioned-adaptive-h45-tail-h24-v1`
- previous public model: `hazard-regime-broad-banked-random-continuous-post-reset-age-raw-bw18-tr54-v2`
- adoption boundary: `2026-09-19T06:00:00.000Z` (UTC), 2026-09-19 15:00 (JST)
- adoption mode: `manual`
- freeze timestamp: `2026-09-18T18:55:00.000Z` (UTC)
- minimum completed intervals: `36`
- support gate: `completedIntervalCount >= 36`, `historySupportValid === true`, and the existing finite/monotonic validity checks
- calibration: none; H45 recency weighting, adaptive smoothing, and H24 tail remain frozen
- training: completed broad-banked intervals only; `liveIntervalIncludedInTraining === false`
- refit/retuning: 実施しない
- backfill/relabel: 実施しない
- fallback: invalid, non-monotonic, unsupported, or exceptional Survival results use the existing Broad-Banked v2 fallback/comparison baseline
- public API/DTO/UI: `public-v1` and the existing public shape are unchanged; diagnostic audit fields are not exposed
- DB schema/migration: 変更なし

The selector chooses Survival-Conditioned v1 only at or after the explicit boundary and only when its frozen validity gate passes. The Broad-Banked v2 period ends at the same boundary, so the historical periods remain separate. Experimental logging and prospective comparison continue for both identities; no historical forecast row is rewritten.

## 2026-09-17 raw 18/54 corrective adoption

- model: `hazard-regime-random-continuous-post-reset-age-raw-bw18-tr54-v1`
- previous public model: `hazard-odds-v4-logit-calibrated-prequential-v3`
- adoption boundary: `2026-09-17T05:45:00.000Z` (UTC)
- adoption date: `2026-09-17`
- adoption mode: `manual corrective adoption`
- freeze timestamp: `2026-09-02T09:00:00.000Z` (UTC)
- freeze policy: `A single reset, miss, or new observation must not trigger retuning.`
- calibration: none; the raw challenger is used as frozen
- refit/retuning: 実施しない
- backfill/relabel: 実施しない
- public selector: boundary以後だけchallengerを選択し、invalid/exception/non-monotonic時はV4へfallbackする
- uncertainty: bandwidth/truncation challengerのprospective sampleは継続監視し、単一イベントや小標本で再調整しない

この採用はModel Bの新規fitでも、prospective gate達成による自動promotionでもありません。旧selective v3、V4 rollback、raw 18/54の期間はadoption boundaryで分離し、同じmodelVersion文字列だけで結合しません。B1/v2/v3/V4/A/C/C2/context-awareを含むexperimental forecast loggingは継続し、historical prediction rowは変更しません。

採用理由は、既存のproduction-sized read-only比較で観測された長いreset age帯の粗いbinningと校正による過度な平滑化を、既に事前登録・凍結済みの18/54 challengerで是正するmanual corrective decisionです。18/54が統計的に最適、または全面的に優越すると証明したものではありません。prospective sample、Brier、log loss、calibration、age-band behaviorを継続監視し、小標本や単一イベントを理由に再fit・retuneしません。

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

## Corrective rollback support (installed; rollback scheduled)

The read-only audit recommends a **corrective rollback to old V4** with **confidence: medium-low**. This is a manual corrective action; it is **not a universal superiority claim** and not a new model fit.

- support status: installed; manual corrective rollback scheduled
- rollback boundary: `2026-09-11T02:20:00.000Z` (UTC)
- rollout setting: `PUBLISHED_PROBABILITY_V4_ROLLBACK_AT`
- 2026-09-01 onward same-origin daily-first: resolved 24h=10, 48h=9
- current selective v3: 24h Brier `0.2337`, 48h Brier `0.3601`
- old V4: 24h Brier `0.2133`, 48h Brier `0.3186`
- leave-one-origin-out: V4's advantage direction is retained
- episode leave-out: the 48h advantage is not fully stable

At the scheduled boundary, the periods remain separate: historical V4 before B v1 and corrective-rollback V4 after the boundary are never combined by `modelVersion` alone. The v3 experimental forecasts, `featureSnapshot`, and prospective scoreboard continue during a V4 rollback. `V4-24/C-48` is not implemented, Model C is not added to the public selector, and the official-notice 0.90/0.96 policy is unchanged. The prospective gate remains `not_met`; no historical row, report snapshot, or canonical history is rewritten.

## Source of truth

model constant、adoption timestamp、boundary status、mode、gate status、calibration training sourceの原値は`data/shadowProbabilityConfig.ts`が保持し、model identityとpublic deployment periodのcanonical inventoryは`data/probabilityModelRegistry.ts`です。runtimeの選択とfallbackは`lib/radar/publishedProbability.ts`、同一origin loggingは`lib/nextGenerationLogging.ts`、prospective reportの生成は`lib/radar/prospectivePublishedModelEvaluation.ts`が担います。この文書はそれらの意味と監査履歴を補足するもので、新しいDB schemaや公開DTOを追加しません。
