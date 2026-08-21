# Next-Generation Probability Shadows Design

## Goal

現在の公開モデル `hazard-odds-v4-logit-calibrated-prequential-v3` を変更せず、次の本採用候補として2本のshadow modelを同時に導入する。

- **B / Explainable**: random-reset専用clock、continuous hazard、activity regime、既存signal、prospective calibrationを組み合わせ、予測理由を人間が追跡できるモデル。
- **A / Accuracy-first**: 固定した5本のcomponent forecastを、future-onlyのresolved forecastから学習する強く正則化したlogit ensemble。

両モデルは同一originで `prediction_history.debug_info.experimentalProbabilityForecasts` に保存し、Current public / A / Bを同じfuture dataでprospective比較する。自動本採用は行わない。

## Model versions and preregistration

- B model version: `hazard-regime-random-continuous-calibrated-v1`
- A model version: `hazard-ensemble-logit-stack-v1`
- preregistration/freeze boundary: `2026-08-21T03:27:00.000Z`
- evaluation mode: `prospective`
- backfill: `false`
- auto publish: `false`
- manual review only: `true`

freeze boundaryより前のrowをA/B forecastとして再計算、backfill、relabelしない。A/B v1の仕様、入力モデル、hazard設定、signal設定、calibration rule、ensemble objective、評価labelは単発のresetやmissを理由に変更しない。変更する場合は新しいmodel versionで別freezeを作る。

freeze対象は固定数値だけではなく**学習アルゴリズムそのもの**である。Bのcalibration alphaとAのensemble weightsは、以下に事前定義するfuture-only更新則に従って更新してよい。

## Scope and non-goals

- Current public model、公開UI、public API/DTO、DB schema、Tibo分類、Gemini prompt、regular-reset state logicは変更しない。
- A/Bはshadow-onlyで、公開確率の選択には接続しない。
- 新しい曜日、時刻、release category、milestone、tweet embedding、LLM featureはv1へ追加しない。
- historical scoreを見ながらbandwidth、half-life、regularization、component構成を再最適化しない。
- regular resetはquota recovery/history上の事実として保持するが、A/Bのrandom-reset clockと正解labelをreset/censorしない。

## Shared target definition

A/Bが予測する正例は、既存eligibility policyを通過した**completed broad-scope random reset**である。forced resetsとeligible Banked Reset distributionsを含み、regular reset、narrow-scope distribution、pending/opened-only、rejected、future/invalid、reference recordは正例から除外する。

各originの24h/48h labelは単純に次で定義する。

- originより後、horizon終了以前にeligible random resetが1件以上ある: `true`
- eligible random resetがない: `false`

horizon内にregular resetが先に存在してもlabelをcensorしない。たとえばorigin+8hでregular reset、+15hでrandom resetなら24h labelは`true`。regular resetだけで24hが終了すれば`false`。

これは既存 `getRandomClockOutcome` の「最初のregular boundaryでcensorする」評価とは意図的に分離する。A/B評価ではrandom targetだけを直接見る。

# B: Explainable model

## B architecture

Bは既存 `hazard-regime-random-continuous-v1` のrandom-clock continuous estimatorを基礎にし、ordinary signalsの後へfuture-only calibrationを追加する。

処理順は固定する。

1. latest eligible random resetから `randomElapsedHours` を計算する。
2. random-reset intervalだけからcontinuous hazardを構築する。
3. recent random-reset activity regimeをhazardへ適用する。
4. ordinary Tibo / Status / usage signalsをodds multiplierとして適用する。
5. 24h/48hをprospective logit calibrationする。
6. active official noticeがある場合、最後に既存official-notice timing policyを適用する。
7. 12hはfinal 24h、72hはfinal 48hから既存derive ruleで生成する。

regular resetは `randomElapsedHours` を0へ戻さない。

## B continuous hazard

既存preregistered random-continuous設定をそのまま継承する。

- kernel: Gaussian
- bandwidth: 24h
- exposure grid: 1h
- kernel truncation: ±72h
- local prior exposure: 2d
- local prior window: 48h
- integration step: 10m
- global prior、daily probability floor/cap: 現行random-continuous implementationを継承

B導入を理由にこれらを再fitしない。

## B activity regime

既存full regime設定を継承する。

- recent-rate half-life: 3d
- ratio exponent: 1
- multiplier clamp: 0.5–2.0
- prior exposure: 2d

recent rateとlong-term rateのevent countはeligible random resetだけを使う。regular resetはregime event countへ入れない。

## B ordinary signals

v1では既存の監査可能なsignal slotだけを使用する。

- formal Tibo teaser
- teaser strength
- OpenAI Status signal
- official incident hint
- official update
- community signal
- usage-limit anomaly
- complaint pressure

既存odds multiplierとcombined capを再利用する。recent-reset momentumとregular-reset proximityがrandom-reset oddsを変えない現行policyも維持する。formal teaserとteaser strengthの二重計上防止も維持する。

official noticeはordinary multiplierへ混ぜず、calibration後に既存timing-aware override/policyを適用する。

## B prospective calibration

BのcalibrationはB freeze以後に**実際に保存されたB raw forecast**だけを使う。historical reset historyからB用alphaをbackfitしない。

24h/48hを別々にfitする。各horizonで、現在originより前に保存され、かつそのhorizonが完全にresolvedしているJST daily-first rowだけを使用する。

- minimum samples: 10
- alpha prior standard deviation: 0.5
- method: existing MAP logit-intercept calibration
- samples < 10: `alpha = 0`
- input probability: 保存済み `rawProbability24h` / `rawProbability48h`
- teacher label: shared random-reset target definition

calibration済みfinal probabilityを次回のcalibration inputへ再利用しない。これにより自己再校正feedback loopを防ぐ。

Bのcalibration fit cutoff、sample count、positive count、last resolved originを保存する。

## B audit payload

最低限、以下をexperimental forecastへ保存する。

- `modelVersion`
- `generatedAt`
- `probability12h/24h/48h/72h`
- `rawProbability24h/48h`
- `randomElapsedHours`
- `latestRandomResetAt`
- `latestRecoveryResetAt`
- `instantaneousHazardPerHour`
- `instantaneousDailyProbability`
- `regimeMultiplier`
- `recentRatePerDay`
- `longTermRatePerDay`
- signal multiplier audit
- `alpha24h/48h`
- `calibrationSampleCount24h/48h`
- `positiveCalibrationCount24h/48h`
- `lastResolvedOrigin24h/48h`
- `officialNoticeOverride`
- `freezeAt`
- `freezePolicy`

# A: Accuracy-first ensemble

## A fixed component set

A v1は次の**exact model versions**のみをcomponentとする。`current public`のようなaliasは使わない。

1. `hazard-odds-v4-logit-calibrated-prequential-v3`
2. `hazard-regime-random-continuous-calibrated-v1` (B)
3. `hazard-regime-elapsed-v1`
4. `hazard-regime-random-elapsed-v1`
5. `hazard-odds-v3-recency-bayes-h30-r3`

将来public modelが変更されてもA v1のcomponent 1はv3のままshadow計算・保存する。

## A prediction equation

24h/48hを独立にfitする。component probabilityをepsilon clampしてlogitへ変換し、次で合成する。

`z_A = alpha + Σ_i w_i * logit(p_i)`

`p_A = sigmoid(z_A)`

制約は固定する。

- `w_i >= 0`
- `Σ_i w_i = 1`
- 24h/48hで別weights
- 12hはfinal 24hから導出
- 72hはfinal 48hから導出

## A training rows

A freeze以後に同一originで5componentすべてが実際に保存されたrowだけを候補とする。historical recomputationで欠けたcomponentを埋めない。

各horizonで、現在originより前かつhorizonが完全にresolvedしたJST daily-first rowだけをtrainingへ使う。24hと48hのtraining setは独立にresolve判定する。

current origin自身をfitへ含めない。

componentのどれかが欠損、NaN、範囲外、model version mismatchなら、そのcurrent originではA forecastを生成・保存しない。残りcomponentでweightを再正規化するfallbackはv1では行わない。

## A cold start

resolved daily-first samplesが10未満のhorizonではfitしない。

- weights: `0.2, 0.2, 0.2, 0.2, 0.2`
- alpha: `0`
- training mode: `equal`

10件以上で `fitted` modeへ移行する。

## A regularized fit

Aのfitted modeは、simplex上のconvex penalized logistic objectiveを最小化する。

各training row `j` のcomponent logit vectorを `z_j`、labelを `y_j`、equal-weight vectorを `u=(0.2,...,0.2)` とする。

`eta_j = alpha + z_j · w`

目的関数:

`J(alpha,w) = Σ_j logloss(y_j, sigmoid(eta_j)) + alpha^2 / (2 * 0.5^2) + Σ_i (w_i - 0.2)^2 / (2 * 0.15^2)`

subject to:

- `w_i >= 0`
- `Σ_i w_i = 1`

固定prior:

- alpha prior SD: 0.5
- weight shrinkage SD around equal weight: 0.15

この正則化強度はv1 preregistrationの一部で、historical scoreによる再選択をしない。optimizerはrandom initializationを使わない決定論的convex solverとし、同じinputで同じ解を返す。実装はsimplex projection等を用いてよいが、objectiveとconstraintsを変更しない。

## A audit payload

最低限、以下を保存する。

- `modelVersion`
- `generatedAt`
- `probability12h/24h/48h/72h`
- exact component model versions
- component probabilities 24h/48h
- weights 24h/48h
- `alpha24h/48h`
- `trainingMode24h/48h`: `equal | fitted`
- `trainingSampleCount24h/48h`
- `positiveTrainingCount24h/48h`
- `fitCutoff24h/48h`
- regularization constants
- `freezeAt`
- `freezePolicy`

# Online data flow

A/B shadow calculationはpublic request pathへ追加しない。`prediction_history`へforecastを保存する既存logging flow内で行う。

forecast生成前に、A/B freeze以後かつcurrent originより前の `prediction_history` からtrainingに必要な `logged_hour` と `debug_info.experimentalProbabilityForecasts` をread-only取得する。JST daily-first selection、horizon resolution、model-version validationはapplication codeで行う。

- public dashboard/APIのための追加DB readを発生させない。
- 1回のlogging cycleでB calibrationとA fitが同じloaded training rowsを共有する。
- queryは必要列だけに限定する。
- training history queryが失敗した場合、Bはalpha=0の安全なuncalibrated shadowを保存してよい。Aはtraining stateを正しく再構成できないため保存しない。
- 保存済みforecast rowを後から更新しない。

既存 `prediction_history` のfirst-writer-wins / immutable origin policyを維持する。

# Prospective evaluation

## Three-way comparison

Current public / A / Bの3モデルが同一rowに存在するoriginだけを正式比較へ使う。

primary metrics:

- 24h Brier score
- 48h Brier score
- 24h log loss
- 48h log loss

primary sampling:

- Asia/Tokyo各日のfirst comparable forecastを1件

secondary diagnostics:

- mean prediction vs actual rate
- calibration buckets
- positive count
- unique target random reset count
- non-overlapping 24h
- non-overlapping 48h
- A/B/Public pairwise differences

regular resetはA/B labelをcensorしない。評価はeligible random resetの有無だけで決める。

## Gate 1: sufficient data for manual review

既存prospective published gateと同じ最低量を使う。

- target random resets >= 5
- resolved daily 24h >= 20
- resolved daily 48h >= 15

未達ならstatusは `insufficient_data`。

## Gate 2: candidate eligibility vs current public

AとBをそれぞれCurrent publicと同じorigin集合で比較する。候補がmanual adoption reviewへ進む条件は次のすべて。

- 24h Brier <= Current public
- 48h Brier <= Current public
- 24h log-loss worsening <= 0.05
- 48h log-loss worsening <= 0.05
- Gate 1を満たす

non-overlap metricsとuncertainty diagnosticsはmanual review用でありhard gateにはしない。これらがdaily-first結論と逆方向ならレポートで明示する。

評価結果からpublished modelを自動変更しない。

## A vs B adoption preference

両方がGate 2を通過した場合も自動winnerを決めない。manual reviewでBrier、log loss、calibration、non-overlap、uncertainty、failure rateを比較する。

Aに再現性のある明確な精度優位が確認できなければ、説明可能性と運用単純性のためBを優先する。これは自動thresholdではなくmanual adoption policyである。

# Failure and correctness policy

- A/Bの計算失敗はCurrent publicへ影響させない。
- B raw continuous calculationがinvalidならBを保存しない。
- B calibration training readだけが失敗した場合はalpha=0でBを保存し、auditにfallbackを残す。
- Aは5componentまたはtraining stateの完全性を満たさない場合保存しない。
- probabilityは有限かつ0–1範囲、24h <= 48hを必須とする。
- derived 12h/72hもmonotonic horizon orderを満たす。
- future signal、future reset、future resolution、後日補完metadataを過去originへ漏らさない。
- official notice policyは既存point-in-time availability ruleを維持する。

# Expected implementation boundaries

既存責務を壊さず、次のように分離する。

- B calculation: random-continuousを再利用する専用wrapper/module
- B calibration: saved prospective raw B rowsだけを扱う純粋helper
- A ensemble: component validation、fit、predictionを持つ純粋helper
- training-row loader: logging flow専用read-only adapter
- forecast serialization: 既存 `buildExperimentalProbabilityForecasts` / logging debug payloadを拡張
- evaluation: A/B/Public専用prospective evaluatorとreport script

public `calculatePublishedProbability` のselection/fallback chainにはA/Bを追加しない。

# Tests

最低限、以下を固定する。

### B

- regular reset後もrandomElapsedHoursが変わらない
- existing continuous hazard設定を継承する
- ordinary signals → calibration → official noticeの順序
- freeze前rowをcalibrationへ使わない
- unresolved rowを使わない
- daily-firstだけをcalibrationへ使う
- sample < 10でalpha=0
- saved raw probabilityをfitし、saved final probabilityを再入力しない
- future informationを使わない

### A

- 5 exact versions以外を受け付けない
- 1component欠損でAを生成しない
- freeze前/backfilled rowをtrainingへ使わない
- daily-first / horizon-resolvedのみを使う
- sample < 10でequal weights + alpha0
- fitted weightsがnon-negativeかつsum=1
- deterministic fit
- strong shrinkageがequal-weight priorへ働く
- 24h/48h fitが独立
- current originを自身のfitへ使わない

### Evaluation

- regular-only boundaryはnegativeでありcensorされない
- regularの後にhorizon内random resetがあればpositive
- A/B/Publicの同一originだけを比較する
- Gate 1 threshold
- Gate 2 Brier/log-loss conditions
- auto publishが常にfalse

### Regression

- published model versionとpublic probabilitiesがA/B導入前後で同一fixture上不変
- public API/DTOにA/B internal auditを露出しない
- existing shadow forecastsが引き続き保存される
- `prediction_history` immutable/first-writer-wins policyを維持する

# Verification and delivery

実装時はfocused testsに加え、full test、check、lint、typecheck、build、`git diff --check`を実行する。Production反映後は以下を確認する。

- `/`, `/en`, `/zh`, `/api/current`が正常
- `/api/current`のpublished modelが変更されていない
- first post-freeze `prediction_history` rowにBが保存される
- 5componentが完全ならAも同一originに保存される
- B/A auditにfreeze metadataとtraining cutoffが存在する
- freeze前rowがA/Bとして増えていない
- Vercel runtime errorがない
- shadow追加によるpublic request CPU増加がない

実装は複数commitに分けてもよいが、A/BをProductionで観測開始するcommitではmodel version、freeze policy、evaluation targetのテストを同時に有効化する。