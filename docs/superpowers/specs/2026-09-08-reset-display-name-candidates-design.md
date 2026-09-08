# Reset Display Name Candidate Design

更新日: 2026-09-08

## 目的と非目標

公式リセット予告を検知した時点で、将来のcanonical reset eventがまだ存在しなくても、
リセット名の候補だけを内部保存する。実リセット確認後に既存のcanonical eventへ関連付け、
既存の`reset_display_names`へ安全に再利用する。

候補の保存はcanonical event identityの作成ではない。予告だけでは次のものを作成・更新しない。

- `reset_event_key`
- `reset_execution_estimates`
- canonical history
- `lastRandomResetAt`
- probability input
- public-v1 / `RadarData`

今回の文書作成では、Productionコード、DB、migration、既存データを変更しない。

## 現行経路との境界

- [`lib/radarFetch.ts`](../../../lib/radarFetch.ts) の`getTiboSignalBundle()`が`tibo_signals`からnoticeとformal resetを構成する。
- [`lib/radar/probability.ts`](../../../lib/radar/probability.ts) の`getActiveOfficialNotice()`は公開用の代表noticeを選ぶ。候補作成の唯一の入力にはしない。複数noticeを代表1件へ畳むためである。
- [`app/api/webhook/tibo/route.ts`](../../../app/api/webhook/tibo/route.ts) は現在、formal adoptionとcanonical identity確定後にだけ`ensureResetDisplayNameForEvent()`を呼ぶ。
- [`lib/radar/tiboResetEventIdentity.ts`](../../../lib/radar/tiboResetEventIdentity.ts) の`resolveTiboResetEventIdentity()`、formal adoption ledger、Monitor-backed estimateが実リセットのidentity根拠である。
- [`lib/radar/resetDisplayNameStore.ts`](../../../lib/radar/resetDisplayNameStore.ts) の`reset_display_names.event_key`はcanonical event keyを意味し、primary keyでもある。
- [`lib/radar/resetDisplayNameReconciliation.ts`](../../../lib/radar/resetDisplayNameReconciliation.ts) はcompleted canonical history向けで、現状は予告段階の候補を扱えない。

したがって、候補はwebhookでseedだけを保存し、AI生成・retry・promotionは既存のreset display-name reconciliation系ジョブの候補フェーズで行う。

## 推奨案

`reset_display_name_candidates`を新設する。`reset_display_names`のprovisional拡張や、
`tibo_signals`への生成結果埋め込みは採用しない。

### 最小schema案

候補テーブルはservice-role専用とし、public/anon/authenticatedから読めない。source本文は既存の`tibo_signals`から明示IDで再構成し、候補表へprompt全文を重複保存しない。

```text
candidate_id                 uuid primary key default gen_random_uuid()
notice_dedupe_key            text not null unique
official_notice_tweet_id     text not null
logical_post_id              text null
notice_tweet_ids             text[] not null default '{}'
source_tweet_ids             text[] not null default '{}'
source_snapshot_hash         text not null
input_hash                   text not null
ai_name_ja                   text null
ai_name_en                   text null
ai_name_zh                   text null
ai_confidence                double precision null
ai_evidence                  text null
ai_reason                    text null
ai_model                     text null
ai_prompt_version            text null
ai_status                    text not null
lifecycle_status             text not null
generation_attempts          integer not null default 0
last_generated_at            timestamptz null
promoted_event_key           text null
promoted_at                  timestamptz null
created_at                   timestamptz not null default now()
updated_at                   timestamptz not null default now()
```

`ai_confidence`と`ai_evidence`は監査情報として保持できるが、accepted/promotionの条件にはしない。
候補の受理判定は既存の`assessRandomResetNameResult()`とJA/EN/ZH validatorだけを権威とする。

`ai_status`は既存命名結果の状態を再利用する。少なくとも`pending`、`accepted`、`null`、
`review_required`、`api_error`、`rate_limited`、`invalid_response`を扱う。
`lifecycle_status`は`provisional`、`promoted`、`superseded`、`expired`だけに限定する。

### Stable identityとunique制約

candidateのPKはopaqueな`candidate_id`とし、notice identityやcanonical event keyをPKにしない。
これにより、後からtrusted edit chainが判明してもcandidate rowをrekeyする必要がない。

`notice_dedupe_key`は候補のnotice重複排除用であり、値は次の優先順位で作る。

1. trustedな`logical_post_id`がある場合: `logical-post:<logical_post_id>`
2. ない場合: `official-notice:<officialNoticeTweetId>`

追加で次をpartial unique constraintとして持つ。

- `official_notice_tweet_id`の非null値はunique
- `logical_post_id`の非null値はunique

既存のtweet-key候補へ後からtrustedなlogical identityが付いた場合は、同一edit chainを検証したtransaction内で`notice_dedupe_key`と`logical_post_id`を更新する。別candidateとの衝突やchain不一致は自動mergeせず、保留する。

`promoted_event_key`は実リセット確認後にだけ設定する。複数noticeが同じcanonical eventへ対応する可能性があるため、これをuniqueにはしない。ただし1つのcandidateについて、nullから最初のcanonical keyへ設定した後、別keyへの変更は拒否する。

## Candidate lifecycle

```text
                 seed
                   |
                   v
             provisional
              /   |   \
             /    |    \
        accepted  error  expired
             |      |       ^
             |      +-------+
             |   cooldown/retry
             v
          promoted -----> superseded
```

- `provisional`: noticeは確定しているが、canonical eventは未確定。AI結果がacceptedでもこの状態を維持する。
- `pending`: `ai_status`上の生成中状態。プロセス停止時は`updated_at`を使ってstale判定し、専用lease列は追加しない。
- `accepted`: V3のschema・suffix・flags等を通過したlocalized結果。confidence/evidenceの有無は条件にしない。
- `null` / `review_required` / transient error: candidateはprovisionalのまま。existing reconcilerのcooldownとbounded retryに従う。
- `expired`: noticeが終了・rejected・historical-onlyになり、実行へ進む根拠がなくなった状態。削除しない。
- `promoted`: canonical event keyへの関連付けが完了した状態。既存canonical nameを再利用した場合もこの状態にする。
- `superseded`:複数noticeのうち別candidateがcanonical eventの代表候補になった状態。source provenanceは保持する。

自動再生成は`lifecycle_status=provisional`の間だけ許可する。`promoted`後はsource情報が増えても自動命名・自動上書きをしない。改善はmanual name overrideに委ねる。

## Notice側の処理

Tibo webhookは次の順で処理する。

1. 現行どおりclassification、context safety、temporal resolution、`tibo_signals` upsertを行う。
2. final effective signalがexecution-bearingな`official_notice`で、reply/rejected/historical-onlyでない場合だけseedを作る。
3. `isOngoingBankedDistribution`だけのpresentation policyや、具体的な将来distribution intentを持たないpersistent policyはcandidate対象外にする。
4. `officialNoticeTweetId`、trusted `logical_post_id`、explicit source tweet IDs、temporal metadataをseedへ保存する。future canonical `event_key`は作らない。
5. seed write失敗はnotice response、formal adoption、history、probabilityへ伝播させず、次回jobで再試行できる診断状態にする。
6. Gemini call、retry、promotionはwebhook内で行わない。

候補列挙は`getActiveOfficialNotice()`だけに依存せず、確定した`tibo_signals`のnotice入力から行う。代表notice selectorのselection semanticsを変えず、複数のexecution-bearing noticeを候補として保持する。

## 10分reconcilerの処理順

既存のcompleted canonical reconciliationを候補生成で飢えさせないよう、completed eventを優先する。

1. read-onlyで候補、Tibo source rows、formal adoption、`reset_execution_estimates`、canonical history、既存`reset_display_names`を取得する。
2. rejected/expired/presentation-only候補を`expired`へ整理し、同一noticeのseedを`notice_dedupe_key`で統合する。
3. existing canonical reconcilerを先に実行する。既存の最大Gemini回数、adoption boundary、manual/accepted保護は変更しない。
4. provisional candidateについて、trusted edit chainとexplicit source IDsから`source_snapshot_hash`とV3用`input_hash`を計算する。nearby tweet、時刻近似、本文類似は使わない。
5. 同一hash・同一model・同一prompt versionのaccepted/null/review結果は再利用する。`api_error`/`invalid_response`等は既存cooldown中なら呼ばない。
6. 実行evidenceがまだない候補を、候補用のbounded budget内で順次生成する。candidate処理はbest effortで、失敗してもnotice/historyは成功扱いのままにする。
7. 実行evidenceが既にあるprovisional candidateだけ、canonical eventとの明示的associationを解決する。post-execution sourceが新しく、かつ候補がまだprovisionalの場合に限り、限定1回の再生成を許可する。
8. `resolveTiboResetEventIdentity()`でcanonical keyが確定済みのcandidateだけをpromotion transactionへ渡す。
9. canonical name rowを再読し、manual name、accepted AI name、legacy accepted nameを優先してcandidateで上書きしない。
10. 実際にcanonical display nameが新規作成・更新された場合だけ`radar-data`をinvalidateする。candidate seed/resultだけではpublic cacheをinvalidateしない。

生成claimは専用lease/retry tableを追加せず、`ai_status=pending`、`input_hash`、`updated_at`のconditional updateを使う。現行reconcilerのbounded sequential workerとcooldownを前提にし、同じhashのpending rowを別workerが取得した場合はskipする。stale pendingだけを既存cooldown相当の時間後に再試行する。

## Promotion transactionとidempotency

promotionはformal adoptionまたはMonitor-backed execution estimateが永続化された後にだけ行う。
history生成と命名promotionを同一transactionへ結合して、命名失敗がhistoryを止める設計にはしない。

最小のtransaction/RPCは次を行う。

1. candidate rowをlockする。
2. `lifecycle_status`が`promoted`で同じkeyならno-op成功にする。
3. 既に別の`promoted_event_key`がある場合はconflictとして終了する。
4. canonical `reset_display_names` rowをlock/readする。
5. manual localized nameがあるlocaleは必ず保持する。
6. accepted canonical AI nameがある場合はそれを保持し、candidateを再適用しない。
7. 保護対象がなくcandidateがacceptedなら、candidateのJA/EN/ZHをcanonical event keyへlocalized mergeする。
8. candidateへ`promoted_event_key`と`promoted_at`を書き、lifecycleを`promoted`へ遷移する。

同じpromotion retryは同一keyへのno-opとなる。複数candidateが同じeventを指す場合は、canonical notice/source identityで代表candidateを一意に選ぶ。複数accepted候補の優先順位がexplicit provenanceから解けない場合は自動選択せず、1件をpromoteして他をsupersedeする処理も行わず保留する。

candidateが`null`、`review_required`、API errorのままでもcanonical historyは通常どおり追加する。後続の既存reconcilerがcanonical eventを直接命名できる余地を残す。

## V3 namingの再利用

[`lib/radar/randomResetNaming.ts`](../../../lib/radar/randomResetNaming.ts) の以下を共有する。

- `RANDOM_RESET_NAME_V3_SYSTEM_PROMPT`
- `generateRandomResetName()`のrequest/response処理
- `assessRandomResetNameResult()`
- JA/EN/ZH suffix、長さ、named-token、flag validator

ただし既存`toRandomResetNameInput()`は`completedAt`を要求するため、予告段階で`expectedEndAt`を完了時刻として渡さない。candidate専用の薄いinput adapterを作り、notice observed timeとexpected windowをcompletion factと区別する。完了event用の既存prompt/input semanticsは変更しない。

## Failure isolation

- candidate seedのDB失敗: official notice、history、probabilityに影響しない
- Gemini timeout/429/invalid response: candidate statusだけを更新し、reset adoptionを失敗させない
- promotion失敗: 既に確定したcanonical historyをrollbackしない。次回reconcilerで再試行する
- source context欠落: candidate生成をskipし、時刻近似や本文類似で補完しない
- manual/accepted canonical name: candidateより常に優先
- public read failure: candidate tableをpublic fetchへ追加しないため、既存public schemaに影響しない

## Focused tests

実装時は次だけを追加する。

1. official notice seedが保存されても`reset_event_key`、history、estimateが作られない。
2. webhook retryが同じ`notice_dedupe_key`で1 candidateになり、Geminiを追加呼び出ししない。
3. trusted logical edit chainは同じcandidateを更新し、未検証の別tweetはmergeしない。
4. identical `input_hash`はV3結果をreuseし、transient errorはcooldown中に再試行しない。
5. `ai_confidence`/`ai_evidence`がnullでも、既存`assessRandomResetNameResult()`とlocalized validatorを通ればacceptedになる。
6. candidate生成の失敗後もofficial notice、formal adoption、canonical historyは成立する。
7. canonical identity確定後、candidateがcanonical `reset_display_names.event_key`へpromotionされる。
8. canonical manual/accepted nameはpromotionで上書きされない。
9. 同一promotion retryは1回のcanonical writeになり、別event keyへの再promotionは拒否される。
10. promotion後はsource snapshotが増えても自動再生成されない。
11. 複数noticeが1 eventに対応する場合、explicit source identityがある候補だけが対象になり、曖昧な候補は保留される。
12. candidate tableが`RadarData`、public-v1、公開historyへ漏れず、candidate-only writeではcache invalidationされない。

## 既存データと2026-09-08の扱い

2026-09-08のリセットは、既存のMonitor/adoption/canonical historyの実例としてのみ参照する。
この機能を後付けで過去noticeへ適用するbackfillは行わない。既存のcanonical display name、history、
event key、probabilityを変更しない。

## 実装の最小段階

1. service-role専用candidate tableとstoreを追加する。
2. Tibo webhookにseed persistenceだけを追加する。AI callは追加しない。
3. 既存reconcilerにprovisional candidate phaseを追加し、V3 validatorと既存cooldownを共有する。
4. canonical identity確定後のpromotion RPC/storeを追加する。
5. focused testsでidentity、idempotency、failure isolation、public非漏洩を固定する。
6. read-only shadowでcandidate数とpromotion候補を確認してからProduction schedulingを有効化する。

この順序なら、候補機能の失敗が公式notice検知、実リセット履歴、probability、既存命名へ波及しない。
