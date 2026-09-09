# 次世代確率モデルの運用と公開状態

公開モデルは、`2026-09-01T08:00:00.000Z`（UTC）までは `hazard-regime-random-continuous-calibrated-v1`（Model B v1）、その後`2026-09-09T23:00:00.000Z`までは `hazard-regime-random-continuous-calibrated-post-reset-age-v2`（Model B v2）、それ以後は `hazard-regime-random-continuous-selective-calibration-post-reset-age-v3`（selective hybrid v3）です。prospective gateは`not_met`ですが、manual governanceでは診断状態であり、自動publish/rollbackのswitchではありません。Model A/Cはshadowとして観測します。

- B v1: `hazard-regime-random-continuous-calibrated-v1`（2026-08-23T02:04:00.000Z以後のhistorical public model）
- B v2: `hazard-regime-random-continuous-calibrated-post-reset-age-v2`（2026-09-01T08:00:00.000Z以後、v3 boundary前のpublic model）
- selective hybrid v3: `hazard-regime-random-continuous-selective-calibration-post-reset-age-v3`（2026-09-09T23:00:00.000Z以後のruntime/public model、24h diagnostic-only / 48h apply）
- A: `hazard-ensemble-logit-stack-v1`（shadow）
- C: `hazard-contextual-burst-circadian-v1`（shadow）
- A/B freeze: `2026-08-21T03:27:00.000Z`
- C freeze: `2026-08-22T06:15:00.000Z`
- mode: prospective only
- backfill: false
- adoption mode: manual
- gate status: not_met
- auto publish: false（gateはmanual review only）
- v2 adoption boundary: `2026-09-01T08:00:00.000Z`（historical `production_boundary_set`）
- selective hybrid v3 adoption boundary: `2026-09-09T23:00:00.000Z`（`production_boundary_set`）
- v2 calibration training source: B v1
- backfill: false

## 保存経路

B v1の公開forecastは公開確率pathで計算されます。logging cycleでは同一originについてB v1、B v2、selective hybrid v3を`prediction_history.debug_info.experimentalProbabilityForecasts`へ保存し、それぞれのProduction boundaryを分離して比較できるようにします。A/Cは`/api/log-probability`のlogging cycleでのみ計算・保存されるshadowです。`/api/current`、公開DTO、UIではA/Cのsolverや学習を実行しません。DB schemaも追加しません。

B v2の差分は0–24h post-reset ageに対するregime multiplier attenuationだけです。selective hybrid v3はこの計算を継承し、24hのcalibrationをdiagnostic-only、48hのcalibrationをapplyします。prequential calibration rows、alpha、sample count、signal policy、official notice/teaser policyはB v1から継承し、過去training rowやprediction rowを再ラベルしません。prospective evaluatorは各明示boundary以後に生成された同一originの対象モデルだけを比較します。

prediction historyはlogging cycleで1回だけreadし、Bのraw forecast calibration、Aのensemble training、Cのfuture-only calibrationで共有する。Cのcontext係数自体はprediction historyから学習するのではなく、各origin時点までに利用可能なeligible random-reset履歴からpoint-in-timeで推定する。

DB queryが失敗した場合はBとCをalpha=0のuncalibrated状態として監査情報付きで保存し、Aは保存しない。既存のfirst-writer-winsを維持し、保存済みrowを更新しない。

## targetと評価

targetはcompleted broad-scope eligible random resetだけ。regular resetはrandom clockを戻さず、A/B/Cのlabelをcensorしない。origin後の24h/48h終了時刻が評価のas-of以前になった場合だけ、そのhorizonをresolvedとして使う。

BとAの正式比較は同一originに公開モデル・A・Bが実際に保存されたrowのうち、Asia/Tokyo各日の最初のrowを使う。Brier、log loss、calibration、availability、non-overlap、skip reasonをレポートし、Gateを満たしても自動採用や自動rollbackはしません。

```text
corepack pnpm run evaluate:prospective-next-generation
```

レポートは `reports/prospective-next-generation-model-evaluation.json` と `.md` に出力される。対象rowが不足している間は `insufficient_data` とし、精度の優劣を結論づけない。

## B: Explainable Random Continuous

B v1はrandom-reset-only Gaussian continuous hazardを主軸とするhistorical public modelです。B v2はこのB v1を継承した、selective hybrid v3より前のpublic modelです。selective hybrid v3は同じ計算を使い、24hだけcalibrationをdiagnostic-onlyにします。

- Gaussian bandwidth: 24h
- exposure grid: 1h
- truncation: ±72h
- integration step: 10m
- recent activity regime: half-life 3d
- ordinary semantic signals: frozen B v1 policy
- 24h/48h future-only logit calibration
- official notice: `official-notice-window-v3`

B v2ではpost-reset ageが24時間未満のintegration stepだけregime multiplierをattenuateします。24時間以上はB v1と同じregime multiplierへ戻ります。calibrationとsignal policyは変更しません。

Bは「経過時間に対する滑らかなhazard」と「最近のrandom-reset activity regime」を組み合わせる。

## C: Contextual Burst Hazard

CはBと同じrandom-reset-only Gaussian continuous hazardをbaseにするが、**Bの3-day activity regime multiplierは使わない**。短期activityを次のcontext blockで直接扱い、同じ現象の二重計上を避ける。

C v1のfitted featureは次の4つだけにfreezeする。

- standardized `log1p(randomResetCount72h)`
- standardized `log1p(previousRandomIntervalHours)`
- `hourSin`
- `hourCos`

時刻は固定PST/PDT offsetではなくIANA `America/Los_Angeles` で計算する。曜日・weekend・単純なTibo投稿数・前回reason・milestone/release category・embedding・LLM feature・Product Activity RegimeはC v1へ入れない。

context fitは1時間exposure cellを使うridge-regularized complementary-log-log discrete-time hazard model。Gaussian base cumulative hazardをoffsetにし、free interceptは追加しない。係数priorは平均0・SD 0.5、最低15 eligible random events / 720 exposure cells、context multiplierは各integration stepで0.5–2.0倍へclampする。fit不能・データ不足・solver failure時は係数0 / multiplier 1へfallbackする。

24h/48hの積分中もcontextはorigin値で固定しない。Pacific Timeは未来stepへ進み、既知の過去resetは72h rolling windowから自然に抜ける。target resetがまだ起きていないsurvival pathを仮定するため、未来のresetを仮想追加しない。

ordinary semantic signalsはB v1のfreeze済みpolicyをそのまま利用する。その後にC専用future-only calibration、horizon coherence、最後にofficial notice policyを適用する。

### C factor ablation

将来「どのfactorが本当に効いたか」をprospectiveに判定できるよう、各保存forecastにはcalibrationとofficial noticeを除いた次のraw ablationを保存する。

- `baseOnly`
- `noBurst`
- `noCircadian`
- `fullContext`
- `fullRaw`

正式なC比較は同一originにPublic・A・B・Cが存在するrowをAsia/Tokyo daily-firstで比較する。factor contributionはC forecastが存在し、必要なablation auditも揃ったrowだけで別集計する。ablation欠落はC本体のformal forecastを無効化しない。

```text
corepack pnpm run evaluate:prospective-contextual-burst
```

レポートは `reports/prospective-contextual-burst-model-evaluation.json` と `.md` に出力する。`noBurst - fullContext` や `noCircadian - fullContext` のBrier / log loss deltaが正なら、そのfactorを外した方が悪化したことを意味する。ただし十分なresolved sampleが貯まるまではfactor順位を確定扱いしない。

## A v1との関係

A v1のcomponent setはfreeze済みで、Cを追加しない。component 1のv3はBのprevious baselineとして固定された明示的な比較対象であり、現在の公開モデル名を表すaliasではありません。

1. `hazard-odds-v4-logit-calibrated-prequential-v3`
2. `hazard-regime-random-continuous-calibrated-v1`
3. `hazard-regime-elapsed-v1`
4. `hazard-regime-random-elapsed-v1`
5. `hazard-odds-v3-recency-bayes-h30-r3`

将来Cをensemble componentとして採用する場合は、A v1を書き換えず別versionのA v2としてpreregisterする。
