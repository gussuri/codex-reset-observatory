# Contextual Burst Hazard Shadow Model Design

## Goal

現在の公開モデル `hazard-odds-v4-logit-calibrated-prequential-v3`、既存shadow B `hazard-regime-random-continuous-calibrated-v1`、既存shadow A `hazard-ensemble-logit-stack-v1` を変更せず、探索で有望だった短期クラスタリングとPacific Timeの時刻効果を検証する第3のshadow model Cを追加する。

仮のmodel versionは次とする。

- **C / Contextual Burst Hazard**: `hazard-contextual-burst-circadian-v1`
- preregistration/freeze boundary: `2026-08-22T06:15:00.000Z`
- evaluation mode: `prospective`
- backfill: `false`
- auto publish: `false`
- manual review only: `true`

C v1の目的は「現在Productionより必ず高精度になること」を主張することではない。Bのcontinuous random-reset hazardを土台に、次の2仮説がfuture dataでも予測改善に寄与するかを検証する。

1. eligible random resetは短期間にclusterしやすく、直近72時間の発生密度と直前intervalに情報がある。
2. eligible random resetはPacific Timeの時刻に依存し、人間の活動時間帯に偏る可能性がある。

## Exploratory motivation

Cの着想にはfreeze前の探索結果を使用しているため、以下は**仮説生成データ**であり、C採用の検証データとして再利用しない。

- broad-scope eligible random resetをPacific Timeへ変換すると、探索時点では 00:00–08:00 に観測イベントがなく、08:00以降へ偏っていた。
- 直近72時間の過去random reset数が多いほど、次のrandom resetまでのintervalが短い傾向があった。
- 直前intervalが短い場合、次のintervalも短い傾向があった。
- 曜日、単純なTibo投稿量、過去3interval平均、粗い前回reason分類は現時点では優先度が低かった。

これらの探索結果から具体的な倍率を手作業で設定しない。C v1ではアルゴリズムと正則化方針をfreezeし、context係数は各forecast originで利用可能な過去データだけからpoint-in-timeで推定する。

## Scope and non-goals

- public selector、`/api/current`、公開DTO、UIは変更しない。
- A v1 / B v1のmodel definition、freeze、component set、評価履歴を変更しない。
- C v1をA v1のcomponentへ追加しない。将来追加する場合はA v2として別versionを作る。
- DB schemaは増やさず、既存 `prediction_history.debug_info.experimentalProbabilityForecasts` に保存する。
- regular resetはrandom clockを戻さず、Cのtarget eventにも入れない。
- 曜日、weekend、Tibo投稿数、前回reason、release category、milestone、tweet embedding、LLM feature、Product Activity RegimeはC v1へ入れない。
- freeze前データを使ってCのprospective forecastをbackfillしない。
- 探索結果を見ながらcontext multiplier cap、ridge prior、feature definitionを都度変更しない。変更はC v2とする。

## Shared target definition

Cの正例はA/Bと同じく、既存eligibility policyを通過した**completed broad-scope random reset**とする。

含む:

- broad-scope forced random resets
- broad-scope eligible Banked Reset distributions

除外:

- regular reset
- narrow-scope distribution
- pending / opened-only
- rejected Tibo signal
- future / invalid timestamp
- reference record

24h / 48h labelもA/Bと同じ定義を使う。originより後、horizon終了以前にeligible random resetが1件以上あればpositive。regular resetはlabelをcensorしない。

training / evaluation rowはhorizon全体が経過した後だけresolvedにする。positive eventの早期発生だけでearly resolveしない。

## High-level architecture

C v1の処理順を固定する。

1. latest eligible random resetから `randomElapsedHours` を計算する。
2. Bと同じrandom-reset-only Gaussian continuous hazard estimatorでbase hazardを構築する。
3. base hazardをoffsetとして、過去だけから推定した**context block**を適用する。
4. context blockは短期burst featuresとPacific Time circadian featuresだけを持つ。
5. B v1と同じordinary semantic signalsをodds multiplierとして適用する。
6. 24h / 48hをC専用future-only logit calibrationする。
7. horizon coherenceを適用する。
8. active official noticeがある場合、最後に `official-notice-window-v3` policyを適用する。
9. final pairを検証し、12h / 72hは既存derive policyで生成する。

概念式は次の通り。

`lambda_C(age, context) = lambda_continuous(age) * M_context(context)`

`M_context = exp(beta_count72 * x_count72 + beta_prev_interval * x_prev_interval + beta_hour_sin * sin(hour_PT) + beta_hour_cos * cos(hour_PT))`

その後にordinary semantic signalを既存のodds multiplierとして適用する。

## Base continuous hazard

C v1のbase hazardはB v1のcontinuous estimatorと同じ構造・固定値を使う。ただしBの3-day activity regime multiplierは適用しない。Cでは短期activityをcontext blockで扱い、B regimeとの二重計上を避ける。

- random-reset-only clock
- Gaussian kernel
- bandwidth: 24h
- exposure grid: 1h
- kernel truncation: ±72h
- local prior exposure: 2d
- local prior window: 48h
- integration step: 10m
- global prior event count: 1
- global prior exposure: 10d
- minimum implied daily probability: 1%
- maximum implied daily probability: 35%

regular resetはbase hazardのclockをresetしない。

## Context block

### Burst features

C v1は短期クラスタリングを1つのfeature groupとして扱うが、監査のため2つのraw featureを保持する。

1. `randomResetCount72h`
   - origin直前72時間に完了したeligible random reset数。
   - origin自身や未来イベントは含めない。
   - transform前の整数値もauditへ保存する。

2. `previousRandomIntervalHours`
   - latest eligible random resetと、その1つ前のeligible random resetのinterval。
   - 十分な過去イベントがない場合はmissingとして扱い、0埋めで「短いinterval」と誤解させない。

fitではskewを抑えるため `log1p` 系transformを使用し、past-only training exposure上で標準化する。標準化の平均・分散もoriginより後のデータを使わない。

この2featureは相関し得るため、独立した手作業倍率を掛けない。1つのregularized context fitの中で同時に推定し、group ablationでは両方まとめて `burst` として落とす。

### Circadian features

Pacific Timeの時刻は `America/Los_Angeles` を使い、DSTをIANA time zoneとして扱う。固定UTC offsetを使わない。

24時間周期を滑らかに表現するため、カテゴリhourや「08時境界」のstep functionは使わない。

- `hourSin = sin(2π * localHour / 24)`
- `hourCos = cos(2π * localHour / 24)`

`localHour` は分・秒を含む連続値としてよい。

曜日・平日週末はC v1へ入れない。

## Point-in-time context fitting

Cのcontext係数は、base hazardをoffsetにした**強く正則化したdiscrete-time hazard fit**として推定する。

推奨実装は1時間exposure cellを使うridge-regularized logisticまたはPoisson approximationとし、どちらを採用するかはimplementation planで既存コードとの整合を見て最終決定する。ただし以下の意味は固定する。

- response: そのexposure cell内にeligible random resetが発生したか
- offset/base: そのcellのrandom elapsed ageに対するC base continuous hazard
- features: `randomResetCount72h`, `previousRandomIntervalHours`, `hourSin`, `hourCos`
- training data: forecast originより前のexposureとeventsのみ
- future information: 使用禁止
- coefficient prior center: 0
- strong L2 / Gaussian shrinkageを必須とする
- context multiplierは極端値を防ぐため最終的に `0.5x–2.0x` へclampする

実装時にsolverやprior strengthを決めたらC v1のversioned constantsとしてfreezeする。探索データ上の最高scoreになるようgrid searchで選ばない。既存の数値安定性・サンプル数を基準に保守的な既定値を選ぶ。

fit不能、データ不足、solver failureの場合はcontext係数を0として `M_context = 1` にfallbackし、C forecast自体はbase continuous + semantic signalsで生成できるようにする。fallback reasonをauditへ保存する。

## Ordinary semantic signals

C v1のordinary signal policyはB v1と同じversioned policyを使う。

含む:

- formal teaser
- teaser strength
- Status signal
- official incident hint
- official update
- community signal
- usage-limit anomaly
- complaint pressure

B v1と同じく、formal teaser有効時はteaser strengthの二重計上を避ける。recent-reset momentumとregular-reset proximityはrandom-reset oddsへ追加しない。

単純なTibo投稿数・投稿頻度はC v1へ入れない。

official noticeはordinary signalへ混ぜず、calibration / coherence後に専用policyを1回だけ適用する。

## C prospective calibration

C calibrationはC freeze以後に実際に保存されたC raw forecastだけを使う。historical reset historyからC用alphaをbackfitしない。

- 24h / 48hを別fit
- JST daily-first row
- strict horizon resolution
- minimum samples: 10
- alpha prior standard deviation: 0.5
- MAP logit-intercept calibration
- samples < 10: `alpha = 0`
- calibration input: context + ordinary signals適用後、coherence / official notice前の保存済みraw probability

calibrated final probabilityを次回calibration inputとして再利用しない。

## Horizon coherence and official notice

C v1はBと同じpolicyを使う。

- 24h / 48hを0–1へclamp
- `p48 < p24` の場合だけ `p48 = p24`
- adjustment有無をauditへ保存
- official noticeはその後に `official-notice-window-v3` で適用
- 最終的に `0 <= p24 <= p48 <= 1` を検証

## Audit payload

Cは将来「どのfactorが効いたか」をprospectiveに評価できることを重要な目的とする。最低限、次を保存する。

- `modelVersion`
- `generatedAt`
- `freezeAt`
- `probability12h/24h/48h/72h`
- `rawProbability24h/48h`
- `randomElapsedHours`
- `latestRandomResetAt`
- base `instantaneousHazardPerHour`
- base 24h / 48h probability
- `randomResetCount72h`
- `previousRandomIntervalHours`
- `hourSin`
- `hourCos`
- fitted context coefficients
- context training event count / exposure cell count
- context multiplier audit for 24h / 48h integration
- context fit fallback flag / reason
- ordinary signal multiplier audit
- calibration alpha / sample counts / last resolved origins
- horizon coherence flag
- official notice override flag / timing policy version

### Prospective ablation audit

Cの各forecast originで、追加DB rowを作らず同じexperimental forecast audit内に次の**raw ablation probabilities**も保存する。

- `baseOnly`: continuous elapsed hazardのみ
- `noBurst`: circadian contextのみ（burst coefficientsを0として再計算）
- `noCircadian`: burst contextのみ（hour sin/cos coefficientsを0として再計算）
- `fullContext`: burst + circadian
- `fullRaw`: fullContext + ordinary semantic signals

official noticeとprospective calibrationはfeature importanceを混ぜるためablation raw値へ入れない。

これによりfuture outcome解決後、同じoriginで「burstを外したとき」「circadianを外したとき」にLog Loss / Brierがどれだけ悪化したかを直接比較できる。

## Evaluation

Cの正式な評価はfreeze後に実際に保存されたforecastだけを使う。

比較対象:

- Production current: `hazard-odds-v4-logit-calibrated-prequential-v3`
- B: `hazard-regime-random-continuous-calibrated-v1`
- A: `hazard-ensemble-logit-stack-v1`
- C: `hazard-contextual-burst-circadian-v1`

A v1のcomponent setは変更しない。

正式比較はCが存在するcommon originへ制限し、既存A/Bと同様にJST daily-first、strict horizon resolutionで行う。

報告するもの:

- 24h / 48h Brier score
- 24h / 48h log loss
- calibration summary
- availability / skipped origin
- positive / negative counts
- current vs B vs A vs C
- C ablation: burst contribution / circadian contribution / semantic signal contribution
- ablation rankingのbootstrapまたはleave-one-reset-out安定度（十分なresolved sampleがある場合）

Cは1件のreset、miss、または短期scoreの優劣だけでProductionへ採用しない。既存A/B gate相当の十分なprospective sampleが貯まるまで `insufficient_data` とする。

## Relationship to existing models

### Current public

Currentはbinned/random-inclusive hazard + ordinary signals + prequential calibrationを中心とするProduction baseline。CはProduction selectorを変更しない。

### B / Explainable

Bはrandom-only continuous hazard + 3-day activity regime + ordinary signals + prospective calibration。

CはBと同じcontinuous hazardとsemantic signal思想を使うが、Bの3-day activity regimeを使わず、次へ置き換える。

- short-horizon burst block: 72h count + previous interval
- Pacific Time circadian block: sin/cos

したがってBはより単純で説明しやすいbaseline、Cは人間の実行行動と短期clusterを追加したcontextual candidateと位置づける。

### A / Accuracy-first ensemble

A v1は固定5componentのlogit ensembleであり、Cとは別系列。C v1をA v1へ追加しない。

将来Cがprospectiveに有用なら、A v2のcomponent候補としてCを追加する余地がある。その場合もA v1の履歴やfreezeを変更せず、新versionとしてpreregisterする。

## Success criteria

C v1の最初の成功条件は「Productionをすぐ上回ること」ではなく次の3点とする。

1. point-in-timeで未来情報を使わず安定してforecastを保存できる。
2. burst / circadian / semantic signalの寄与をprospective ablationで監査できる。
3. 十分なresolved sample後に、Bよりcontext追加が本当に予測改善へ寄与したかをLog Loss / Brierで判断できる。

CがBより悪ければ、context仮説を棄却または縮小する。良ければCを単体Production候補または将来A v2 componentとして再検討する。
