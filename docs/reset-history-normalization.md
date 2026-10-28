# リセット履歴のcanonical normalization

この文書は、リセット履歴を source facts から canonical history と公開表示へ変換する際の正本です。コードとテストにある挙動と、レビューで明示された不変条件を整理します。この変更では、Day N 見出しの時間解釈と、検証済みの同一 global reset へ reply で結び付く完了投稿だけを正式履歴へ加える狭い経路を記録します。

## 読み方と監査範囲

「現在の実装」は、現在のコードとテストが実際に固定している挙動です。「正規化原則」は、今後の変更で守る境界です。現在の実装に互換性のための例外や保守的な fallback がある場合は、正規化原則と混同しないように明記します。

主な根拠:

- [`lib/radar/types.ts`](../lib/radar/types.ts): canonical field、record kind、内部/公開型
- [`lib/radar/resetReason.ts`](../lib/radar/resetReason.ts): cycle/reason の分類と legacy normalization
- [`lib/radar/tiboHistory.ts`](../lib/radar/tiboHistory.ts): Tibo signal、notice、execution estimate、BANKED、identity を history へ変換する処理
- [`lib/radar/tiboLogicalProjection.ts`](../lib/radar/tiboLogicalProjection.ts): raw/active/recent/formal signal の read-side projection と edit chain
- [`lib/radar/tiboResetEventIdentity.ts`](../lib/radar/tiboResetEventIdentity.ts): logical post と canonical event key の関連付け
- [`lib/radar/resetEligibility.ts`](../lib/radar/resetEligibility.ts): broad random reset の probability eligibility
- [`lib/radar/resetDisplayNames.ts`](../lib/radar/resetDisplayNames.ts): display name の安全性と locale fallback
- [`components/ResetHistoryDetails.tsx`](../components/ResetHistoryDetails.tsx): canonical scope の公開表示ルール
- [`data/resetHistory.ts`](../data/resetHistory.ts): static history と除外キー
- [`tests/resetReasonTaxonomy.test.ts`](../tests/resetReasonTaxonomy.test.ts)、[`tests/tiboFormalHistory.test.ts`](../tests/tiboFormalHistory.test.ts)、[`tests/tiboCanonicalHistoryIdentity.test.ts`](../tests/tiboCanonicalHistoryIdentity.test.ts)、[`tests/dashboardPresentation.test.ts`](../tests/dashboardPresentation.test.ts)、[`tests/historyDedupe.test.ts`](../tests/historyDedupe.test.ts): taxonomy、identity、dedupe、locale/presentation の回帰条件

## 1. Source facts と canonical history は別物

投稿やAPI rowに現れる単語を、そのまま canonical field へコピーしません。まず source から確認できる事実を分解し、次の各軸を独立に正規化します。

```text
source facts
  -> logical event identity / chronology / cycle / reason / method / scope
  -> notice / display name / note の各 projection
  -> locale-specific public presentation
```

投稿の呼びかけ対象と、リセット対象の scope は別です。たとえば `Hi Astra users` は読者や話題の対象を示すだけであり、それだけを根拠に `scope = Astraユーザー` にはしません。scope は reset の適用対象を明示する evidence から決めます。対象が分からない場合も、audience の文字列を scope の代用品にしません。

## 2. Canonical fields

| Field | Canonical meaning | 現在の正規化・根拠 | 公開表示と不変条件 |
| --- | --- | --- | --- |
| `recordKind` | event record の種類 | 型で `confirmed_global`、`banked_distribution`、`reference`、`regular_completed` を持つ。既知値は保持し、`getHistoryRecordKind()` の未知値 fallback は `reference`。 | `recordKind` は cycle/reason の別名ではない。BANKED、reference、regular occurrence の扱いを保つ。 |
| `cycleType` | リセットの周期・イベント種別 | canonical 値は `ランダムリセット`、`定期リセット`、`個人別リセット`。regular context、personal/banked context、または明示値から `inferResetCycleType()` が決める。 | cycle は reason ではない。random であることだけから祝賀理由を作らない。 |
| `reasonType` | なぜ行われたか | canonical 値は `ご祝儀リセット`、`詫びリセット`、`定期更新`。非定期 reset event に明示的な詫び理由がない場合、`ご祝儀リセット` は運用上の既定カテゴリ。 | 既定カテゴリだけから祝賀・milestone・原因を公開文面へ加えない。reset event context 自体がない場合は reason を未設定にできる。 |
| `resetMethod` | どの仕組みで利用枠を変更したか | 既存値は `強制リセット`、`任意リセット権配布`、`利用上限更新`、`リセット実施`。 | forced reset と BANKED credit distribution を混同しない。 |
| `scope` | 実際に reset/credit が適用される対象 | 通常の global random reset は canonical/internal では原則 `全有料プラン`。限定配布は明示された限定対象を保持する。 | `全有料プラン` は default scope としてUIの「対象」行を隠す。特殊 scope だけ表示する。 |
| `noticeType` | notice/teaser の有無と種類 | `公式予告あり`、`公式告知あり`、`告知投稿あり`、`匂わせ投稿あり`、`予告あり`、`予告なし`、`なし` 等の既存値を保持し、presentation では announcement/teaser/none にまとめる。 | notice の存在は execution time や scope の代用品ではない。 |
| execution time | chronology 上の authoritative な実施時刻 | completion post、valid recovery observation、public-valid execution estimate、static history 等の既存入力を使う。notice time、display name、理由とは独立。 | `closed_at`/`completed_at` と display execution の扱いを変えない。pending/opened-only は completed event として扱わない。 |
| event identity / source IDs | 同じ event かを示す安定した identity と provenance | logical post/edit chain、formal adoption、execution estimate、static/dynamic reference の明示 alias を `resolveTiboResetEventIdentity()` と canonical merge が扱う。 | 表示名や reason/scope を直しても event key、source tweet identity、duplicate 判定、chronology boundary を変更しない。 |
| display name | 履歴の見出しという presentation layer | manual localized name、非genericな既存 title、安全性を確認した accepted AI name、locale fallback の順で `resetDisplayNames.ts` が解決する。 | display name から cycle/reason/scope を逆算しない。名前は canonical fields を書き換えない。 |
| note / summary | 人間向けの補足説明 | `summary`/`details.note` は事実の補足。notice-backed recovery では既存の event key 用 summary も使う。 | note は canonical reason、scope、execution time の代用にしない。 |

### 実施時刻と「告知から実施まで」

notice-to-execution は notice と execution の差を人間向けに表す derived presentation です。履歴の canonical execution timestamp そのものではありません。現在の表示処理では notice がない場合、または保存値が `0分` 相当の場合にこの行を空にできます。これによって event identity や execution timestamp を変更してはいけません。

告知の有無と時刻の確度は別に判定します。Gemini が `official_notice`、時制 `unclear`、時刻 `unknown` と分類し、引用 evidence が本文にあり、利用上限リセットへの明示的な話題で、返信・引用・拒否・相殺・履歴・技術的 reset ではない投稿は、信頼度 `0.80` 以上なら unscheduled notice として表示・履歴連携できます。この例外は notice の存在だけを示します。予定時刻、実行時刻、probability teaser、完了済み reset は作らず、開始/終了時刻も公開しません。予定時刻がある通常 notice の `0.95` 閾値と、reset completion の判定は維持します。

### 公開 summary / note の日時

将来生成する summary と note には、年月日、曜日、時計時刻、timezone、閲覧時点で意味が変わる相対日付（today / tomorrow / yesterday 相当）を書きません。告知・実施時刻と deadline は専用の日時欄に任せ、note では「続く返信で実施期限が案内された」のように日時を繰り返さず説明できます。告知から実施までの所要時間も、イベント理解に必要でない限り補足へ加えません。

日時を省く場合も、source-grounded な原因、修正、方法、結果、言葉遊びや callback は残します。`Day 17` / `第17天` はシリーズ上の識別子であり、日付ではないため、文脈に必要なら保持します。生成時の指示に加えて、runtime validation は公開 summary / note に日時表現がある出力を受け入れません。source evidence や内部監査 rationale は原文の根拠保持のため、この公開文面ルールの対象外です。prompt version を更新して将来の生成へ適用し、既存履歴の一括書き換えはしません。

### Legacy scope input の扱い

`convertTiboResetSignalToHistoryEvent()` は、Tibo の completion text や related notice に reset applicability の明示 evidence がない場合、product label を scope として作らず、scope を空にします。`Codex / ChatGPT Work` は canonical scopeではありません。旧partial labelは `normalizeResetScope()` で `一部ユーザー` としてread-side互換処理できますが、新しいcanonical/static/persisted rowは旧labelを出力しません。

定期リセットはこの random/Tibo 用の scope taxonomy とは別です。通常の weekly regular event は、対象が任意リセット未使用アカウントであるという schedule semantics を持つため、canonical scope を `任意リセット未使用アカウント` として保持します。`normalizeRegularResetScope()` はこの値（および既知の旧表現）と `全有料プラン` だけを regular scope として受け付け、`一部ユーザー` や product label へ圧縮しません。例外的に全有料プランへ適用する regular event は `全有料プラン` を保持します。regular の scope を random/Tibo の `一部ユーザー` として保存・生成してはいけません。

## 3. `reasonType` の normalization

`cycleType` と `reasonType` は別軸です。`ランダムリセット` は理由ではありません。

### Canonical meaning

- **`詫びリセット`**: 障害、不具合、品質劣化、誤った制限、過剰消費、補償、incident 対応などへの reset。
- **`ご祝儀リセット`**: milestone、記念、祝賀、キャンペーン、サービス施策などが明示された reset。これらの根拠がない非定期 reset event では、別の原因を意味しない運用上の既定カテゴリとして使う。
- **`定期更新`**: 通常の weekly/regular cycle。

### 現在の実装順序

`normalizeResetReasonType()` は概ね次の順序で評価します。

1. regular context または legacy の `通常更新` を `定期更新` にする。
2. canonical な明示 reason を保持する。
3. incident/compensation または usage-limit fix の evidence を `詫びリセット` にする。
4. celebration/milestone 等の明示 evidence を `ご祝儀リセット` にする。
5. それ以外でも、明示 cycle、canonical reset record kind、または reset event の文脈があれば `ご祝儀リセット` を運用上の既定カテゴリとして返す。
6. reset event の文脈もない場合は `undefined` を返す。

明示された legacy input の `reasonType = ランダムリセット` または `その他` も `ご祝儀リセット` へ normalize されます。非定期 reset event に対する既定カテゴリは internal taxonomy と表示ラベルの分類であり、公開 summary/note で祝賀や原因を主張する根拠にはなりません。生成 metadata は source-grounded な説明と内部 audit rationale を分けて保存します。

入力に reset event context がまったくない場合だけ `undefined` を返します。自動生成 Tibo history では、event 自体を保持しながら reset event の文脈がない場合に限り reason を未設定にできます。

## 4. Scope normalization と presentation

canonical/internal data では、通常の global random reset の scope は原則 `全有料プラン` として保持します。これは probability eligibility や chronology に使われる意味データです。

公開UIでは [`ResetHistoryDetails.tsx`](../components/ResetHistoryDetails.tsx) の `ALL_PAID_PLAN_SCOPES` が次の default label を同一視します。

```text
全有料プラン / All paid plans / 所有付费套餐
```

これらは default scope なので「対象」行を表示しません。明示された限定対象は canonical value `一部ユーザー` として表示します。`不具合対象ユーザー` は random/Tibo の旧入力/evidence表現であり、canonical/public scopeとしては保存・出力しません。`任意リセット未使用アカウント` は regular schedule 用の concrete scope であり、下記の regular presentation rule に従います。

regular history は別の presentation rule を使います。`任意リセット未使用アカウント` は具体的な regular target なので「対象」行に表示し、`全有料プラン` は default scope として隠します。regular に不明な scope が渡った場合は broad へ推測せず、対象行を表示しません。`一部ユーザー` は random/Tibo の narrow scope であり、regular scopeの代用品にはしません。

BANKED/conditional distribution では、`一部ユーザー` などの限定 scope を保持し、通常 global random reset の broad scope へ昇格させません。

## 5. Related notice から情報を引き継ぐ場合

completion post が短く、たとえば `Reset all propagated. Sweet dreams.` のように scope/reason を直接書かない場合、同一 event の直前にある official notice を evidence として参照できます。notice の文章を canonical field へコピーするのではなく、確認できる事実を正規化します。

### Sweet dreams の正規化例

Production の 2026-09-12 record では、notice tweet `2098612714704891959` と completion tweet `2098685367058612394` が同一 event の evidence です。notice は `Hi Astra users` という呼びかけと quality issue、reset の予告を含み、completion は `Reset all propagated. Sweet dreams.` です。この場合の仕様上の変換は次のとおりです。

| 段階 | 内容 |
| --- | --- |
| source facts | notice が reset と quality issue を説明し、completion が実施完了を示す。`Astra users` は notice の呼びかけ対象。 |
| canonical fields | `recordKind = confirmed_global`、`cycleType = ランダムリセット`、`reasonType = 詫びリセット`、`resetMethod = 強制リセット`、`scope = 全有料プラン`、notice は公式 notice、execution は authoritative completion/observation。 |
| public presentation | JA は `品質問題修正に伴う詫びリセット`、EN は `Compensation Reset Following Quality Fixes`、ZH は `质量问题修复补偿重置`。reason は `詫びリセット`、method は `強制リセット`、default scope の「対象」行は表示しない。 |

## 6. Evidence priority

レビュー・設計上の evidence の優先順は、概念的には次のように整理します。

1. authoritative execution observation / confirmed execution
2. reset completion post
3. related official notice
4. AI interpretation
5. generic fallback

これは人間が evidence を評価するための優先概念であり、現在のコードにあるすべての処理を一つの総合順位へ置き換えるものではありません。現在実装は用途ごとの helper に委譲しています。

- formal history admission は `isFormalTiboResetSignal()` が signal type、confidence、verification、reply、classification source を確認する。
- `reset_executed` の自動分類は、投稿者本文にreset実施またはCodex/ChatGPT Workの利用枠復旧を示す根拠を必要とする。`confirmed`、`landed`、`applied across all accounts` のような一般的な完了表現だけでは、全体resetの実施として採用しない。BANKED配布完了は専用のdistribution pathで別扱いする。この要件は将来予告・teaserの分類へ一律に適用しない。
- notice-backed recovery は public-valid execution estimate と recovery observation を確認し、notice は provenance/説明の evidence として使う。
- `resolveTiboResetEventIdentity()` の identity evidence は、ledger、estimate、static history、dynamic event を照合する。resolver 内の match priority は概ね ledger `500`、estimate `400/300`、static history `200`、dynamic `100` であり、これは event key の関連付け用で、reason の総合証拠順位ではない。
- AI の display name や reason-like text は canonical event key や execution time を単独で決めない。
- generic fallback は未分類を confirmed history に昇格させない。unknown record は `reference` のままにする。reset event context が存在するときの運用上の既定 reason は `ご祝儀リセット` だが、context がない場合は未設定にする。

新しい処理では、AI 解釈だけを authoritative execution の代用にしないこと、notice だけで completed event を作らないことを守ります。

### 強制・ランダムリセット完了履歴の monitor gate

新しく採用する Tibo の強制リセット投稿は、投稿の分類・verification・正式採用台帳だけでは completed history になりません。`lib/radar/tiboHistory.ts` は、次のいずれかを要求します。

- recovery observation の `matchedTiboTweetId` が投稿の tweet ID / logical post / trusted edit alias に一致する。
- `reset_execution_estimates` の public-valid estimate が、同じ回復観測 ID と前後時刻を持つ実体のある観測に結び付き、estimate の Tibo source ID が投稿の identity alias に一致する。

正式な monitor 回復観測は、除外されていない ID、`strong` confidence、`unexpected` cycle、`observed` または `confirmed` status、順序の正しい比較時刻、10 分以内の比較間隔、1 ポイント以上の使用率低下、1 時間以上の `resets_at` 前進を満たします。個人 BANKED 消費は保存時に `rejected` となり、regular / unknown cycle と rejected observation は採用されません。baseline、restart/rebase、gap、no-difference は有効な比較観測にならないため、履歴を作りません。

monitor observation の `matchedTiboTweetId` は、実行済み投稿との一致を表します。これは notice の関連付け欄ではありません。matched ID がなくても、public-valid estimate に authoritative observation と同じ Tibo source IDs が記録されていれば、notice-backed または monitor-only event を復元できます。notice は provenance を説明しますが、execution の根拠を代替しません。

AI confidence、`verification_status = confirmed`、manual execution-time override、adoption ledger、完了を示す投稿文だけではこの gate を通過しません。手動 estimate は monitor observation がない限り公開 completed history・確率境界へ入りません。invalid estimate の重複が先に届いても、後続の valid copy を捨てず、retry/duplicate delivery の順序で canonical event を変えません。

### Notice-backed recovery のイベント分離

Usage Monitor が recovery に結び付ける notice は、その実行窓に対して同一イベントと確認できる候補だけです。schedule による関連付けには、開始・終了の両時刻が有効で順序が正しい解決済み窓を使います。窓の重なり、同一投稿ID、または検証済みの将来reply関係を根拠にできます。時刻の欠落・逆転を「一致」とみなして複数告知を束ねません。開始と終了が同じ正確な時刻の点窓は有効です。

one-shot notice は、前回の forced recovery の実行境界・実行窓に既存の temporal consumption 判定を適用します。前回の実行時点で予定時刻より前にあり、まだ消費されていない将来予定は次の recovery 用に残します。前回までの recovery で消費済みの notice や未解決の古い one-shot notice は、後続イベントへ再利用しません。既存の通常・早期 grace を維持し、persistent notice の扱いは明示 policy に従います。

estimate に保存された official-notice ID と時刻は、元の signal row が読み込めない場合の provenance fallback に使えます。対応する現在の signal row がある場合は、その現在の分類・verification・本文が優先されます。rejected、irrelevant、BANKED、または履歴対象外の row を保存メタデータだけで official notice に戻しません。notice 時刻が実行時刻より後なら、その完了イベントを「公式予告あり」と表示しません。

この gate は formal history の生成前に適用し、history 表示だけでなく共通 canonical history を使う probability boundary と public recovery projection に反映します。既存の `data/resetHistory.ts` にある static archive は legacy authority として維持し、遡及的な backfill / rewrite は行いません。static archive に入っていない legacy AI-confirmed signal を、AI確認済みという理由だけで例外扱いしません。regular reset と BANKED distribution はそれぞれ既存の専用経路を維持します。

reset title/summary/note の生成は formal Tibo completion の admission とは別の gate です。既に保存された canonical monitor event、execution estimate、`observed` または `confirmed` の recovery observation が整合する場合に生成できます。`observed` は観測済みという意味で、`confirmedAt` や matched Tibo completion ID を要求しません。これだけで Tibo 投稿を formal completion へ昇格させることはありません。厳密に検証され、execution window と重なる将来の verified reply notice は source context として含められます。通常 reply、quote、古い proof、別 event の投稿は含めません。BANKED title/metadata は canonical grant-backed event とその official notice を別の authority として使い、global reset の monitor gate を置き換えません。

monitor gate 導入前に公開済みだった announcement-fallback 履歴のうち、健康かつ非staleの公開API snapshot（`checkedAt=2026-10-23T11:00:01.004Z`）に存在し、従来の `data/resetHistory.ts` に含まれていなかった次の3件だけを、元のevent keyと公開内容を保つ static archive row として追加します。時刻は公開済みの announcement fallback のまま `executionTimePrecision = announcement_fallback` とし、monitor観測時刻へ読み替えません。各行の notice/completion tweet ID、元の signal/window、source URL、空のscope、JA/EN/ZHのtitle・summary・noteを同snapshotに固定します。

| Canonical event key | signal / fallback time (UTC) | notice / completion tweet IDs |
| --- | --- | --- |
| `tibo-reset-2109873287853707513` | `2026-10-13T01:03:59Z` / `2026-10-13T05:06:06Z` | `2109812360596865224` / `2109873287853707513` |
| `tibo-reset-2110618732666257557` | `2026-10-15T04:55:51Z` / `2026-10-15T06:28:13Z` | `2110595484180214059` / `2110618732666257557` |
| `tibo-reset-2111566005684289735` | `2026-10-17T16:20:57Z` / `2026-10-17T21:12:21Z` | `2111492673890824348` / `2111566005684289735` |

これらは過去に公開された3つの表示・履歴値を保つための限定的な固定データです。monitor evidence が存在したことを示すものではなく、static archive にないAI-only投稿、adoption ledger、手動確認済み投稿へ例外を広げません。以後の新しいdynamic eventは引き続き有効なmonitor gateを通過する必要があります。

## 7. Identity / chronology invariant

`buildTiboReadSideProjection()` は active/recent/formal の重複を read-side で整理し、trusted edit chain を logical post として扱います。formal reset は `isFormalTiboResetSignal()` の条件と、上記 monitor recovery gate の両方を通過したものだけが新規 formal history になります。

`resolveTiboResetEventIdentity()` と canonical history merge は、明示された logical identity、edit alias、adoption ledger、execution estimate、static/dynamic event provenance を使います。conflict、missing authoritative tail、manual conflict は fail-safe に扱います。異なる cycle type の記録を時間だけでまとめず、stable identity がない legacy compatibility のみ限定された近接判定を使います。

表示の修正は次を変更してはいけません。

- canonical event key
- execution timestamp と random-reset chronology boundary
- duplicate identity / dedupe 結果
- source tweet identity と provenance alias
- logical post/edit chain

name、reason、scope、note の presentation correction と event identity/chronology は別の変更です。

## 8. BANKED / conditional / account-specific reset

BANKED は global forced reset と別の delivery method です。現在の [`lib/radar/bankedReset.ts`](../lib/radar/bankedReset.ts) と Tibo history path では、明示的な BANKED/reset-credit term、配布/付与/available 等の distribution evidence、audience、official notice、execution estimate などを組み合わせて `banked_distribution` を作ります。個人の「自分が使った」「使い方」の文脈だけでは broad distribution にはしません。

次の境界を維持します。

- broad BANKED distribution は `recordKind = banked_distribution` として history に入ることがある。
- conditional/narrow distribution は `randomResetTargetScope = conditional` を持ち得る。
- `isEligibleRandomResetEvent()` は conditional、narrow、regular、rejected、reference を broad random-reset probability target から除外する。
- account-specific reset、補償 credit、BANKED の配布は、通常の全体 forced reset の `scope` や `resetMethod` へ昇格しない。
- BANKED distribution と同じ notice を引用する global forced reset があっても、`isSameReset()` は BANKED record を別 event として保持する。

### BANKED observation と投稿の関連付け

新しい Usage Monitor 経路では、確認された BANKED count increase を、Tibo告知の有無に依存しない耐久 observation として保存します。observation identity は通知IDや投稿IDではなく、Monitor source・元の `observed_at`・BANKED kind に基づき、同一観測の再送は同じ実績になります。各観測には元の時間区間とcount transitionを保持し、同じ告知が後日の複数回配布を支えても各回は別eventです。

投稿との関連付けは、Webhook取込と後続reconciliationで同じversioned matcher（`banked-post-association-v1`）を使います。matcherは投稿のBANKED distribution claim、audience/scope、claim lifecycle、投稿時点で有効なschedule、trusted edit identityを、受信時刻ではなく観測時刻に照らして評価します。候補がない、複数候補、読み取り不完全、条件不一致などはpending/conflictとして監査可能に残し、BANKED estimateや公開履歴を作りません。後日投稿の到着・分類訂正があれば、bounded reconciliationが元の観測時刻で再評価します。

関連付けがacceptedになった観測だけが、正規の `banked-distribution-observation-v2` estimateおよび公開 `banked_distribution` historyへ投影されます。未解決の観測は公開履歴・実行estimate・random-reset boundaryへ影響しません。現行およびlegacy `usage-execution-banked-v1` の読み取り互換は維持します。既存の履歴やestimateはそのidentity・時刻・手動訂正を保ち、近接時刻やsource IDの重なりだけで自動backfill/再関連付けしません。

先行する Tibo teaser を既存の BANKED execution に表示上関連付ける場合は、非reply/非quote、strong なreset関連性、投稿時点で解決済みの時間窓、実測時刻が窓と有効期限内にあること、scope 矛盾がないことをすべて要求します。複数teaser/複数eventが候補になる場合、既存のmanual provenanceがある場合、または窓内に競合するexecutionがある場合は自動追加しません。自動関連付けは既存source tweet IDを含むcanonical history projectionで決定的に導出し、`recordKind`、execution時刻、`officialNoticeTweetId`、scope、reset method、確率境界は変更しません。曖昧な場合は未関連のままにします。

### BANKED公式告知の表示名候補

将来の BANKED 配布を明示する公式告知は、実際の配布観測より前に表示名候補を告知の正確な tweet ID（trusted edit chain があればその logical post identity）へ結び付けて生成できます。候補は `candidate_event_kind = banked_distribution` として保存し、provisional のまま保持します。告知だけでは履歴イベントを作成せず、canonical display name にも昇格しません。

モニターが BANKED 利用可能数の持続的な増加を確認し、正規の `banked-distribution-observation-v2` estimate を保存した後に限り候補を昇格できます。昇格には、identity resolver が既存の canonical BANKED event key と同じ authoritative estimate を返すことに加え、estimate の `officialNoticeTweetId` が候補の official notice ID と完全一致し、同じ ID が estimate の `tiboSourceTweetIds` に存在することを要求します。通常の近接時刻、同じ論理投稿の別イベント、似た本文だけでは結び付けません。BANKED候補はこのestimate以外のformal adoption/forced-reset evidenceでは昇格できません。current/legacy の forced-reset estimate、別 BANKED notice の estimate はこの条件を満たしません。

昇格するのは localized display name だけです。event key、`recordKind = banked_distribution`、`resetMethod = 任意リセット権配布`、scope、実測時刻、BANKED identity、global random reset clock、probability input は変更しません。manual または既に accepted の canonical display name は既存の保護規則どおり保持します。候補と estimate のIDが一致しない、resolver が conflict/blocked/new を返す、または estimate が不正・legacy/別種別の場合は候補を昇格せず保留します。

## 9. Worked examples

次の例は static data または既存 test fixture に基づきます。各例を `source facts -> canonical fields -> public presentation` の順に読むことができます。

### 1. 2026-09-12 の notice-backed global reset

- **Source facts**: [`data/resetHistory.ts`](../data/resetHistory.ts) の `local-codex-sweet-dreams-reset-2026-09-12` は、official notice `2098612714704891959` と completion `2098685367058612394` を provenance として保持する。Astra は呼びかけ対象であり、reset scope の証拠ではない。completion の表示上の句は `Sweet dreams` だが、canonical reason は related notice の quality issue evidence から得る。
- **Canonical fields**: `recordKind = confirmed_global`、`cycleType = ランダムリセット`、`reasonType = 詫びリセット`、`resetMethod = 強制リセット`、`scope = 全有料プラン`。execution は `2026-09-12T08:09:17.000Z` の completion time、notice は `officialNoticeTweetId` として保持する。
- **Public presentation**: JA `品質問題修正に伴う詫びリセット`、EN `Compensation Reset Following Quality Fixes`、ZH `质量问题修复补偿重置`。reason と method を表示し、default scope row は非表示。

### 2. 障害対応の `詫びリセット`

- **Source facts**: [`tests/fixtures/tiboLongFormReset.ts`](../tests/fixtures/tiboLongFormReset.ts) の長文 reset post は、全有料ユーザーの利用上限を reset し、compaction、memory、goals、automations 等の問題を修正した事実を説明する。`tests/tiboFormalHistory.test.ts` では matching recovery observation/estimate も使う。
- **Canonical fields**: `recordKind = confirmed_global`、`cycleType = ランダムリセット`、`reasonType = 詫びリセット`、`resetMethod = 強制リセット`、scope は all-paid evidence に基づく。notice-backed recovery の event key と observed execution time は estimate/recovery 側を使う。
- **Public presentation**: manual display name がある場合はそれを優先し、reason は locale ごとの `詫びリセット` 表示。notice-to-execution は valid notice/execution 差を表示する。

### 3. milestone/祝賀の `ご祝儀リセット`

- **Source facts**: [`tests/resetReasonTaxonomy.test.ts`](../tests/resetReasonTaxonomy.test.ts) の `Usage limits have been reset for all paid ChatGPT Work and Codex users. Happy Monday you all.`。completion は broad reset を明示し、`Happy Monday` が祝賀 evidence になる。
- **Canonical fields**: `recordKind = confirmed_global`、`cycleType = ランダムリセット`、`reasonType = ご祝儀リセット`、`resetMethod = 強制リセット`、`scope = 全有料プラン`。cycle は random のままで、reason は celebration。
- **Public presentation**: JA/EN/ZH で reason が `ご祝儀リセット` / `Celebration reset` / `庆祝重置` に localize される。all-paid scope は内部に残るが対象 row は隠れる。

### 4. regular reset reference

- **Source facts**: [`data/resetHistory.ts`](../data/resetHistory.ts) の `local-codex-regular-reset-2026-08-08` は weekly timing、source URL なし、`任意リセット未使用アカウント` を示す。
- **Canonical fields**: `recordKind = reference`、`cycleType = 定期リセット`、`reasonType = 定期更新`、`resetMethod = 強制リセット`、scope は `任意リセット未使用アカウント`。source/noteの「任意リセット未使用」説明と schedule target は同じ concrete scope を補強する。
- **Public presentation**: 定期リセットとして表示し、weekly schedule の note と `任意リセット未使用アカウント` を表示する。regular reference は broad random-reset probability event として扱わない。

### 5. account-wide completion without reset evidence

- **Source facts**: `Confirmed landed across all accounts. How are we doing so far?` は広範囲への適用完了を述べるが、何が適用されたかを本文で特定せず、resetや利用枠復旧も主張していない。
- **Canonical fields**: AIが `reset_executed` を返しても、source-text safety guard はこの投稿を正式なreset候補にせず `irrelevant` とする。AIの元判定は監査列に保持する。これによりformal adoption、completed history、random-reset chronology boundaryは作られない。
- **Boundary**: `Reset all propagated. Enjoy.`、`Resets all propagated. That will be all.`、明示された利用枠の復旧、現在進行形のusage-limit resetは明示的なreset evidenceとして扱う。teaserやofficial noticeにはこの完了判定ガードを一律適用しない。BANKED distributionは専用のrecord kindとmethodを維持する。

全有料プランへ明示的に適用される regular event は scope を `全有料プラン` として保持するが、default scope presentation により「対象」行は表示しない。BANKED delivery は record kind と reset method を維持し、regular scopeの扱いで global random eventへ変換しない。

### 6. BANKED/個別対象の補償配布

- **Source facts**: [`tests/bankedAffectedUserCompensation.test.ts`](../tests/bankedAffectedUserCompensation.test.ts) の tweet `2097752790177370535` は、影響時間帯に BANKED reset を使ったユーザーへ replacement を配布する。test fixture は official notice と banked distribution execution estimate を持つ。
- **Canonical fields**: `recordKind = banked_distribution`、`cycleType = ランダムリセット`、`reasonType = 詫びリセット`、`resetMethod = 任意リセット権配布`、`scope = 一部ユーザー`、`randomResetTargetScope = conditional`。
- **Public presentation**: JA/EN/ZH の補償配布名、限定 scope、詫び reason、BANKED method/note を表示する。internal の `randomResetTargetScope` は public DTO/history item へ露出しない。`isEligibleRandomResetEvent()` は false のまま。

### 7. Day N 見出しと、検証済み reply 完了投稿

- `Day 10/ Reset` や `Day 13/ Le limit reset` の `Day N` はシリーズ上の番号として扱い、過去の日付、経過日数、時計時刻、event timestamp に変換しません。時制や schedule の根拠がなければ temporal direction は unresolved のままにします。見出しの後に独立した明示 schedule がある場合は、その引用された時刻だけを解釈できます。
- reply の `reset_executed` は既定では正式履歴から除外します。例外は、成功した Gemini 分類が `reset_executed`、confidence `>= 0.95`、`completed_now` で、同じ global reset と特定した source tweet ID までの完全な検証済みグラフがあり、すべての辺が Tibo 本人の reply である場合だけです。さらに、同一の Gemini 応答が cited source text の exact quote で forced method と全 paid-user または all-user scope の両方を裏付ける必要があります。same-event 判定、reply edge、affected-user 内の “everyone” は method/scope の証拠になりません。グラフは最大2辺とし、target の本文・投稿時刻・URL・完全一致する evidence quote、method/scope quote と各 source text hash、現在の source-context revision hashes、分類完了 marker を同じ proof に束縛します。
- proof は versioned なサーバー生成 JSON で、private な `tibo_signals.formal_reply_admission_proof` に保存します。読み取り時も Gemini audit fields、auto-unverified 状態、evidence quote、method/scope evidence、source-context revision hashes を再検査します。manual/confirmed/rejected、古い revision、失敗・未完了分類、部分・不明・foreign-author・quote path、BANKED distribution、affected-user/personal/unknown scope、proof 欠落は fail closed です。proof は public DTO に含めません。
- `official_notice` は告知の種類であり、実施時刻の確定度とは別に評価します。短い usage-limit reset 見出しが告知として成立しても、信頼できる時刻がなければ `noticeTimingStatus=unknown` と `temporalDirection=unclear` で保存し、日時・実施完了を推定しません。曖昧な時制の official notice はこの timing status が明示されなければ選択時に fail closed です。
- event identity は検証された contextual reset root の tweet ID を使い、その reply path の tweet IDs を provenance に加えます。同じ root を示す複数の reply は同じ event identity に集約します。時刻の近さや似た文面だけでは結びません。
- 対応する migration は [`supabase/migrations/20261020120000_add_tibo_formal_reply_admission.sql`](../supabase/migrations/20261020120000_add_tibo_formal_reply_admission.sql) にあります。この変更では migration を production DB へ適用せず、過去行の backfill もしません。column が未適用の場合、通常の保存は旧schema向けfallbackで proof を保存せず reply を正式履歴から除外します。source-context 分類時の proof 保存は retryable な `503` となり、分類完了 marker は進めません。migration 適用後の再試行でのみ proof admission が可能です。

## 10. やってはいけないこと

- `Hi Astra users` だけを根拠に `scope = Astraユーザー` とする。
- 運用上の既定 `ご祝儀リセット` だけから祝賀、milestone、release との関係、または具体的な原因を公開文面へ書く。
- AI display name から `reasonType`、`cycleType`、scope を逆算する。
- note/summary の文章を canonical reason として扱う。
- default scope `全有料プラン` を毎回公開UIに表示する。内部値を消すことも同様に誤り。
- `reasonType = ランダムリセット` を canonical reason として保存/公開する。
- presentation correction のついでに execution time、event key、source tweet、duplicate 判定を変更する。
- BANKED/conditional/account-specific distribution を broad random reset の probability target へ入れる。
- proof がない、古い、手動確定された、または現在の分類/audit/context と一致しない reply を completed global reset として扱う。
- `Day N` 見出しの番号から日付・時刻・経過時間を作る。
- 別の notice や近い時刻、似た文章だけで event identity を fuzzy merge する。

## 11. 既存実装との境界と今回の変更範囲

現行コードには、legacy input normalization、unknown record の `reference` fallback、static history の個別 correction など、互換性を守るための個別ルールがあります。random/Tibo scope labelは入力互換のために `全有料プラン`、`一部ユーザー`、または空へ正規化し、regular scopeは `全有料プラン`、`任意リセット未使用アカウント`、または空へ正規化します。これらは一つの理想的な evidence order に置き換えず、各 helper と既存テストを正本として扱います。

今回追加するのは、Day N 見出しを時間根拠にしない Gemini 指示と temporal guard、日時を省く将来 summary / note の生成・検証ルール、versioned proof による reply 完了投稿の正式履歴 admission、monitor recovery gate と、非定期 reset event に対する運用上の既定 reason です。migration は repository に含めますが、適用はしません。

次は変更しません。

- Production data、Supabase の本番 DB、過去履歴の backfill/relabel/rewrite
- Tibo classification の既存 safety conditions、明示的な apology/compensation reason inference、proof のない投稿の採否。非定期 reset event の reason fallback は上記のとおり運用既定へ更新します。
- BANKED/conditional semantics と probability eligibility。BANKED/conditional completion は reply proof でも forced-reset 履歴へ変換しない
- public UI の既存フィールド構成、canonical reason/scope の表示ルール、履歴レイアウト（上記の将来 summary / note の日時表記ルールを除く）
- probability formula、public-v1 schema、regular/BANKED の recovery source semantics

今後この領域を変更する場合は、まずこの文書と列挙した実装・テストを読み、変更が source normalization、canonical identity/chronology、または presentation のどの層に属するかを明示してください。
