# リセット履歴のcanonical normalization

この文書は、リセット履歴を source facts から canonical history と公開表示へ変換する際の正本です。コードとテストに既にある挙動を根拠にしつつ、レビューで明示された不変条件を整理します。ここに書かれた仕様は、履歴データ、分類、Gemini prompt、公開UIをこの変更で更新するという意味ではありません。

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
| `reasonType` | なぜ行われたか | canonical 値は `ご祝儀リセット`、`詫びリセット`、`定期更新`。`normalizeResetReasonType()` の意味は後述。 | reason が未確認なら空/unknown 相当を許容し、reason 表示を省略できる。 |
| `resetMethod` | どの仕組みで利用枠を変更したか | 既存値は `強制リセット`、`任意リセット権配布`、`利用上限更新`、`リセット実施`。 | forced reset と BANKED credit distribution を混同しない。 |
| `scope` | 実際に reset/credit が適用される対象 | 通常の global random reset は canonical/internal では原則 `全有料プラン`。限定配布は明示された限定対象を保持する。 | `全有料プラン` は default scope としてUIの「対象」行を隠す。特殊 scope だけ表示する。 |
| `noticeType` | notice/teaser の有無と種類 | `公式予告あり`、`公式告知あり`、`告知投稿あり`、`匂わせ投稿あり`、`予告あり`、`予告なし`、`なし` 等の既存値を保持し、presentation では announcement/teaser/none にまとめる。 | notice の存在は execution time や scope の代用品ではない。 |
| execution time | chronology 上の authoritative な実施時刻 | completion post、valid recovery observation、public-valid execution estimate、static history 等の既存入力を使う。notice time、display name、理由とは独立。 | `closed_at`/`completed_at` と display execution の扱いを変えない。pending/opened-only は completed event として扱わない。 |
| event identity / source IDs | 同じ event かを示す安定した identity と provenance | logical post/edit chain、formal adoption、execution estimate、static/dynamic reference の明示 alias を `resolveTiboResetEventIdentity()` と canonical merge が扱う。 | 表示名や reason/scope を直しても event key、source tweet identity、duplicate 判定、chronology boundary を変更しない。 |
| display name | 履歴の見出しという presentation layer | manual localized name、非genericな既存 title、安全性を確認した accepted AI name、locale fallback の順で `resetDisplayNames.ts` が解決する。 | display name から cycle/reason/scope を逆算しない。名前は canonical fields を書き換えない。 |
| note / summary | 人間向けの補足説明 | `summary`/`details.note` は事実の補足。notice-backed recovery では既存の event key 用 summary も使う。 | note は canonical reason、scope、execution time の代用にしない。 |

### 実施時刻と「告知から実施まで」

notice-to-execution は notice と execution の差を人間向けに表す derived presentation です。履歴の canonical execution timestamp そのものではありません。現在の表示処理では notice がない場合、または保存値が `0分` 相当の場合にこの行を空にできます。これによって event identity や execution timestamp を変更してはいけません。

### 現在実装にある保守的な scope fallback

`convertTiboResetSignalToHistoryEvent()` は、Tibo の completion text に broad scope が明示されていない場合、raw text から無理に `全有料プラン` と断定せず、現在は `Codex / ChatGPT Work` を保守的な scope として作ることがあります。この挙動は `tests/tiboFormalHistory.test.ts` で固定されています。static history や notice-backed canonical event で `全有料プラン` が確認済みの場合とは分けて扱います。

## 3. `reasonType` の normalization

`cycleType` と `reasonType` は別軸です。`ランダムリセット` は理由ではありません。

### Canonical meaning

- **`詫びリセット`**: 障害、不具合、品質劣化、誤った制限、過剰消費、補償、incident 対応などへの reset。
- **`ご祝儀リセット`**: milestone、記念、祝賀、キャンペーン、サービス施策などの reset。
- **`定期更新`**: 通常の weekly/regular cycle。

### 現在の実装順序

`normalizeResetReasonType()` は概ね次の順序で評価します。

1. regular context または legacy の `通常更新` を `定期更新` にする。
2. canonical な明示 reason を保持する。
3. incident/compensation または usage-limit fix の evidence を `詫びリセット` にする。
4. celebration/milestone 等の evidence を `ご祝儀リセット` にする。
5. 根拠がなければ `undefined` を返す。

明示された legacy input の `reasonType = ランダムリセット` または `その他` は、既存 compatibility とテストのため現在 `ご祝儀リセット` へ normalize されます。これは「根拠のない reason を常にご祝儀へ fallback する」規則ではありません。新しい分類で根拠不足を埋めるためにこの例外を拡張してはいけません。

根拠不足の場合は、無理に `ご祝儀リセット` を作らず、reason を unknown 相当にして公開 reason 行を省略できる設計にします。自動生成 Tibo history では event 自体を保持しつつ reason が空になる場合があり、`tests/tiboFormalHistory.test.ts` の保守的な scope/reason test がこの境界を示します。

## 4. Scope normalization と presentation

canonical/internal data では、通常の global random reset の scope は原則 `全有料プラン` として保持します。これは probability eligibility や chronology に使われる意味データです。

公開UIでは [`ResetHistoryDetails.tsx`](../components/ResetHistoryDetails.tsx) の `ALL_PAID_PLAN_SCOPES` が次の default label を同一視します。

```text
全有料プラン / All paid plans / 所有付费套餐
```

これらは default scope なので「対象」行を表示しません。`不具合対象ユーザー`、`任意リセット未使用アカウント`、その他明示された限定対象のような特殊 scope は表示します。表示しないことは内部 scope を削除することではありません。

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
- notice-backed recovery は public-valid execution estimate と recovery observation を確認し、notice は provenance/説明の evidence として使う。
- `resolveTiboResetEventIdentity()` の identity evidence は、ledger、estimate、static history、dynamic event を照合する。resolver 内の match priority は概ね ledger `500`、estimate `400/300`、static history `200`、dynamic `100` であり、これは event key の関連付け用で、reason の総合証拠順位ではない。
- AI の display name や reason-like text は canonical event key や execution time を単独で決めない。
- generic fallback は未分類を confirmed history に昇格させない。unknown record は `reference`、reason 不足は undefined となる既存 fallback を維持する。

新しい処理では、AI 解釈だけを authoritative execution の代用にしないこと、notice だけで completed event を作らないことを守ります。

## 7. Identity / chronology invariant

`buildTiboReadSideProjection()` は active/recent/formal の重複を read-side で整理し、trusted edit chain を logical post として扱います。formal reset は `isFormalTiboResetSignal()` の条件を通過したものだけが formal history の候補になります。

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
- **Canonical fields**: `recordKind = reference`、`cycleType = 定期リセット`、`reasonType = 定期更新`、`resetMethod = 強制リセット`、scope は `任意リセット未使用アカウント`。
- **Public presentation**: 定期リセットとして表示し、weekly schedule の note と限定 scope を表示する。regular reference は broad random-reset probability event として扱わない。

### 5. BANKED/個別対象の補償配布

- **Source facts**: [`tests/bankedAffectedUserCompensation.test.ts`](../tests/bankedAffectedUserCompensation.test.ts) の tweet `2097752790177370535` は、影響時間帯に BANKED reset を使ったユーザーへ replacement を配布する。test fixture は official notice と banked distribution execution estimate を持つ。
- **Canonical fields**: `recordKind = banked_distribution`、`cycleType = ランダムリセット`、`reasonType = 詫びリセット`、`resetMethod = 任意リセット権配布`、`scope = 一部ユーザー`、`randomResetTargetScope = conditional`。
- **Public presentation**: JA/EN/ZH の補償配布名、限定 scope、詫び reason、BANKED method/note を表示する。internal の `randomResetTargetScope` は public DTO/history item へ露出しない。`isEligibleRandomResetEvent()` は false のまま。

## 10. やってはいけないこと

- `Hi Astra users` だけを根拠に `scope = Astraユーザー` とする。
- completion tweet に reason がないから自動で `ご祝儀リセット` にする。
- AI display name から `reasonType`、`cycleType`、scope を逆算する。
- note/summary の文章を canonical reason として扱う。
- default scope `全有料プラン` を毎回公開UIに表示する。内部値を消すことも同様に誤り。
- `reasonType = ランダムリセット` を canonical reason として保存/公開する。
- presentation correction のついでに execution time、event key、source tweet、duplicate 判定を変更する。
- BANKED/conditional/account-specific distribution を broad random reset の probability target へ入れる。
- reply、rejected signal、reference record、pending/opened-only を completed global reset として扱う。
- 別の notice や近い時刻、似た文章だけで event identity を fuzzy merge する。

## 11. 既存実装との境界と今回変更しない項目

現行コードには、legacy input normalization、unknown record の `reference` fallback、completion text の保守的な scope fallback、static history の個別 correction など、互換性を守るための個別ルールがあります。これらは一つの理想的な evidence order に置き換えず、各 helper と既存テストを正本として扱います。

今回この文書を追加しても、次は変更しません。

- Production data、Supabase、DB schema、migration
- Tibo classification、reason inference、scope inference、current history event
- BANKED/conditional semantics、event identity、execution estimate
- public UI の既存表示挙動
- Gemini prompt と AI audit fields
- probability model、history/adoption、public-v1 DTO
- 過去履歴の backfill、relabel、rewrite

今後この領域を変更する場合は、まずこの文書と列挙した実装・テストを読み、変更が source normalization、canonical identity/chronology、または presentation のどの層に属するかを明示してください。
