# Tibo Communication Regime Shadow Study

## Goal

既存のeligible broad-scope random reset履歴を、`formal_notice`、`teaser`、`silent` の研究用通信タイプに正規化し、時系列構造・実行タイミング差・将来予測への追加情報をProductionへ接続せず評価する。

## Scope and constraints

- Productionのpublished probability、expectation、UI、public API/DTO、DB schema、Gemini prompt、Tibo分類、安全ガードは変更しない。
- Supabaseはread-only queryだけを使う。書き込み、backfill、既存行の更新は行わない。
- 対象イベントは既存の`isEligibleRandomResetEvent`で選び、regular、narrow、future、duplicate、rejectedは除外する。
- static historyとdynamic DB dataは既存の`combineResetHistory`に通し、Productionと同じdedupe・notice-backed recovery処理を使う。
- 予測時点より後のsignal、reset event、通信タイプラベルをfeatureへ使わない。signalの利用可能時刻は`detected_at`、なければ`tweet_created_at`とする。

## Architecture

### Research helper

`lib/radar/communicationRegime.ts`にProductionから独立した純粋関数を置く。

- `CommunicationType`: `formal_notice | teaser | silent`
- valid pre-reset signalの抽出、rejected/reply/post-reset除外、confidence閾値の適用
- `formal_notice > teaser > silent` のprimary分類
- eventごとの前回random reset、elapsed hours、reasonType、local hourの派生
- timestampとseedを受け取る再現可能な遷移/permutation補助
- origin時点で利用可能なsignalだけを返すpoint-in-time投影
- 過去eventだけからrolling regime候補を生成する

このhelperはpublished calculationから呼び出さない。

### Analysis script

`scripts/analyze-tibo-communication-regime.ts`をread-only研究入口とする。

1. `.env.local`からSupabase接続設定を読み込む。
2. `tibo_signals`、`regular_reset_events`、`codex_recovery_observations`、`reset_execution_estimates`を必要列だけ取得する。
3. DB signalを研究用入力へ正規化し、`LOCAL_RESET_HISTORY`、`combineResetHistory`、`isEligibleRandomResetEvent`を使ってcanonical historyを作る。
4. eligible random resetをcompleted time順に並べ、pre-reset communication typeとavailability auditを作る。
5. exploratory metrics、100,000 permutation、coverage audit、prequential/LOO shadow評価を出力する。

### Output

作業中の出力は`scratch/communication-regime-study/`だけに保存する。

- `report.json`: 全集計、監査メタデータ、リーク監査、限界事項
- `report.md`: 人間向け要約、表、結論
- `events.csv`: eventごとの正規化入力とprimary type
- `transition.csv`: transition matrix
- `permutation.json`: seed、回数、観測値、empirical p-values
- `shadow-evaluation.json`: baseline/shadowのrolling、LOO、coverage別指標

## Communication classification

eventのcompleted timeより前、かつ前回eligible random resetより後のsignalだけを候補にする。

- `official_notice`でconfidenceが0.95以上、rejectedでなく、replyでないものが1件以上なら`formal_notice`
- formal noticeがなく、`teaser`でconfidenceが0.80以上、rejectedでなく、replyでないものが1件以上なら`teaser`
- それ以外は`silent`

実行後の`reset_executed`投稿はpre-reset communicationに数えない。複数signalは同じeventで一度だけ数え、formal noticeがteaserを優先する。source coverageが完全でないため、`silent`は自動的に「真の無言」と解釈せず、coverage confidenceを別に報告する。

## Point-in-time and leakage policy

- signal featureのavailableAtは`detected_at ?? tweet_created_at`。
- event labelはそのeventのcompleted time以後にのみ利用可能で、未来eventはoriginのhistory・regime・targetへ入れない。
- notice/teaserのevent分類は、completed time時点で利用可能なsignalだけから再計算する。
- `reset_execution_estimates`の`created_at`/`updated_at`とrecovery observationの`created_at`/`observed_at`を監査列として保持し、後から補完された行を過去originのfeatureに流用しない。
- current snapshotのdynamic historyは「現在のcanonical research input」として記録するが、過去originのreplayではavailability cutoffを適用する。
- current eventの未来のcommunication typeを、そのevent前のprediction featureへ渡さない。

## Analyses

- N、type share、chronological sequence、runs、transition matrix、formal-teaser direct transitions
- 100,000回seed固定permutationによるadjacency、longest run、transition entropy、formal↔teaser遷移のempirical p-value
- previous-random-resetからのelapsed（mean/median/min/max/Q1/Q3）、`<=72h` 2x2、Fisherまたはexact permutation、連続値のpermutation差
- reasonType cross table、teaser×ご祝儀のFisher/risk ratio/odds ratio（0セル補正は明記）
- JST/Pacificのlocal hour、AM/PM、12:00/10:00境界、event table優先の時刻比較
- signal-to-execution durationとformal/teaser差
- event index/dateを先に可視化したうえでのearly/middle/recent、軽量なchange-point候補
- Laplace平滑化した全体share baselineとfirst-order Markovのprequential/LOO比較
- Tibo signal coverageが信頼できる期間でのnon-reset exposureとstate別24h/48h実績、Wilson/Beta区間
- elapsed-only baselineと、current signal / prior communication regimeを加えた研究専用shadow候補のBrier、log loss、calibration、補助的discrimination。insufficient dataなら数値を捏造しない。
- last-3 majority、last-5 majority、EWMAの少なくとも3つのcommunication regime定義を比較する。

## Tests

`tests/communicationRegime.test.ts`で以下を固定する。

- formal noticeがteaserより優先される
- 実行後reset投稿だけではsilentになる
- rejected/reply/未来signalは除外される
- duplicate signalは一度だけ数える
- eligibility helperの結果を再利用する
- point-in-time cutoffより後のsignalを使わない
- rolling regimeが現在event自身を参照しない
- seeded permutationが同じ結果を再現する
- regular resetはrandom targetへ混入しない

## Delivery

研究コード追加時は`research: analyze Tibo communication regimes`でcommitし、mainへpushする。検証は`corepack pnpm test`、`corepack pnpm run check`、`corepack pnpm run build`、`git diff --check`を実行する。Production公開挙動に変更がないことをAPI smoke checkで確認し、研究結果が弱い場合は明確に「面白いが予測には使えない」と報告する。
