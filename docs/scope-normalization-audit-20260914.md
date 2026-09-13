# Canonical Scope Normalization Audit

監査日: 2026-09-14 (Asia/Tokyo)

この監査は、Production DB、static history、read-side projection、scope
consumerを確認し、canonical scopeだけを正規化するための変換計画です。
Tibo原文、source/evidence text、tweet ID、event identity、時刻、reason、
reset method、BANKED/conditional semanticsは変換対象にしません。

## Canonical values

正規化後にcanonical/derived scopeとして許可する値は次の3つです。

- `全有料プラン`
- `一部ユーザー`
- `NULL`

`Codex / ChatGPT Work`、`Codex`、`ChatGPT Work`、model/product名、
greeting/audienceだけの文字列はscope evidenceではありません。

## Production inventory

| 保存場所 | 件数/値 | 層 | UI到達性 | 変換計画 | 根拠 | confidence |
| --- | --- | --- | --- | --- | --- | --- |
| `reset_display_names.event_scope` | 91 rows: all `NULL` | canonical metadata | success metadata経由で到達可能 | 変更なし | 現時点で旧値なし。既存check constraintも許可値を限定 | high |
| `regular_reset_events.scope` | 3 rows: `任意リセット未使用アカウント` | persisted derived regular scope | regular history/detailsへ到達可能 | `一部ユーザー` | weekly regular resetの未使用アカウント限定という明示されたsubset | high |
| `tibo_signals` | scope columnなし | raw source/classification evidence | raw textはhistory logicへ到達 | 変更なし | scope-like語は原文/evidenceでありcanonical fieldではない | high |
| `prediction_history.debug_info` | 748 rows中366 rowsにscopeという文字列を含むが、canonical `scope` keyは0 rows | audit/artifact text | public DTOには到達しない | 変更なし | 過去artifactのJSON/textをrewriteしない | high |

### Persisted regular rows

| event key / schedule key | current | new | evidence | source tweet IDs | reason | confidence |
| --- | --- | --- | --- | --- | --- | --- |
| `weekly-regular-reset:2026-08-20T03:34:43.341Z` | `任意リセット未使用アカウント` | `一部ユーザー` | `record_kind=regular_completed`, `cycle_type=定期リセット`; weekly reset excludes accounts that used a manual reset | none in this table | explicit limited applicability | high |
| `weekly-regular-reset:2026-08-15T03:32:00.000Z` | `任意リセット未使用アカウント` | `一部ユーザー` | same persisted schedule definition; row status is `voided` | none in this table | explicit limited applicability | high |
| `weekly-regular-reset:2026-08-08T03:32:00.000Z` | `任意リセット未使用アカウント` | `一部ユーザー` | same persisted schedule definition | none in this table | explicit limited applicability | high |

The three rows are the only Production canonical scope rows requiring a data
change. The migration is conditional on the exact legacy values, so an already
normalized database is a no-op. It does not update all 91 display-name rows.

## Static/read-side inventory

The static history has three records with legacy narrow canonical fields:

- `local-codex-regular-reset-2026-08-08`
- `personal-tibo-500k-compensation-reset-2026-07-13`
- `local-codex-regular-reset-2026-07-07`

Their source/summary/note text remains unchanged. Only their canonical `scope`
and `details.scope` fields become `一部ユーザー`. The regular schedule default
and its read-side fallback use the same canonical value. The legacy strings
remain accepted as input aliases by `normalizeResetScope()` for old rows, but
are never emitted as canonical/public scope values.

The old product label `Codex / ChatGPT Work` is rejected by the normalizer and
is not used as a fallback by Tibo history. Explicit applicability such as
`all paid users` still maps to `全有料プラン`; explicit affected/selected or
conditional applicability maps to `一部ユーザー`; ambiguous or product-only
evidence maps to `NULL`.

## Invariants

- Raw Tibo/source/evidence text and audit artifacts are not rewritten.
- Event identity, source IDs, chronology, execution estimates, notice links,
  reason, reset method, BANKED, conditional, and probability eligibility stay
  unchanged.
- `全有料プラン` remains the internal default scope and remains hidden by the
  existing public presentation rule.
- Only `一部ユーザー` is rendered as the public special scope label.
