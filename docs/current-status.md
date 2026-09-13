# Current Status

この文書は、Codex Reset Observatoryの現在位置、Production状態、重要な仕様・不変条件、未解決事項を引き継ぐための現在地の正本です。完全なコード仕様書、DB仕様書、変更履歴の代替ではありません。作業開始時に読み、SHAとProduction状態は実際のGit/GitHub/Vercelで再確認してください。

更新時点: 2026-09-13 (Asia/Tokyo)

## Repository and Production

| Item | Current value |
| --- | --- |
| Repository | `gussuri/codex-reset-observatory` |
| `main` | `9b6f20690502831e5063f251bf5f6aacf29bf63a` |
| `origin/main` | `9b6f20690502831e5063f251bf5f6aacf29bf63a` |
| Production domain | `https://codex.gussuriworks.com` |
| Production deployment | `3hTYwjJXbRwaW3sTPEuVMPkeAYoZ` |
| Production deployed SHA | `9b6f20690502831e5063f251bf5f6aacf29bf63a` |
| Deployment URL | `https://codex-reset-observatory-bj146sdo9-gussuris-projects.vercel.app` |
| Deployed at | `2026-09-13T01:59:42Z` |

Read-only smoke verification at this snapshot:

- `/`, `/en`, `/zh`: HTTP 200.
- `/api/current?locale=ja|en|zh`: HTTP 200, schema `public-v1`, `dataHealth.overall=ok`.
- `/api/reset-marker`: HTTP 200.
- Public probabilities were finite and monotonic: `12h <= 24h <= 48h <= 72h`.
- Observed values were `18.6567% / 33.8327% / 59.7833% / 74.4959%` for 12h/24h/48h/72h.
- No active notice window was present. No DB write, migration, backfill, or manual correction was performed during this check.

## Public Probability Model

The active Production selector at this snapshot is the existing calibrated V4 because the corrective rollback boundary is active:

`hazard-odds-v4-logit-calibrated-prequential-v3`

The repository's next-generation alias remains the selective hybrid V3 identity, but it is not the active public selection after the rollback boundary:

`hazard-regime-random-continuous-selective-calibration-post-reset-age-v3`

The rollback boundary is `2026-09-11T02:20:00.000Z`. The adoption gate remains `not_met`; this is a manual corrective rollback, not a claim that a statistical gate was passed. V3/B1/B2 experimental forecasts and V3 feature snapshots remain shadow artifacts; historical rows are not relabeled.

The public horizon contract is:

| Horizon | Meaning |
| --- | --- |
| 12h | Derived from the public 24h probability |
| 24h | Published 24h forecast |
| 48h | Published 48h forecast |
| 72h | Derived from the public 48h probability |

Horizon coherence is maintained. Official-notice overrides are not retained after execution is confirmed. The overdue official-notice policy is 0.90 at 24h and 0.96 at 48h; a generic time range is not treated as a deadline-overdue notice.

## Temporal and Schedule Rules

- Temporal resolver version: `tibo-temporal-v5`.
- Source timezone: `America/Los_Angeles`.
- Named clocks are deterministic: `noon` is 12:00 and `midnight` is 00:00.
- In a deadline such as `by midnight today`, midnight is the end boundary of the named local day. The deadline range starts at the tweet instant and ends at the resolved local deadline.
- A deadline already in the past is unresolved/fail-safe.
- A public official-notice schedule is shown only when `temporalResolutionStatus === "resolved"`. Unresolved, rejected, or missing status hides stale expected timestamps. Public UI does not show `時刻未定`, `time not specified`, or `时间未定` as a schedule.
- The three-hour overdue grace is applied by the existing temporal/public policy.

## Canonical History Normalization

Source facts and canonical history are separate layers. A source post is normalized independently into identity, chronology/execution time, cycle, reason, method, scope, notice, display name, and note/summary. A word in a post is not copied directly into a canonical field.

In particular, the audience addressed by a post is not the reset applicability scope. `Hi Astra users` alone does not make the reset scope `Astra users`.

| Field | Canonical meaning |
| --- | --- |
| `recordKind` | The kind of event record, such as a canonical reset or a distribution record. |
| `cycleType` | Existing values: `ランダムリセット`, `定期リセット`, `個人別リセット`. |
| `reasonType` | Existing values: `ご祝儀リセット`, `詫びリセット`, `定期更新`; do not use cycle type as a reason. |
| `resetMethod` | The normalized method, for example `強制リセット`, `任意リセット権配布`, `利用上限更新`, or `リセット実施`. |
| `scope` | Internal applicability scope. A normal global random reset is normally `全有料プラン`. |
| `noticeType` | Whether and what kind of official notice is associated. |
| execution time | The authoritative chronology/execution instant, independent of display name, reason, and notice time. |
| display name | Presentation only; a name must not rewrite cycle, reason, scope, identity, or chronology. |
| note/summary | Human-readable context, not a substitute for canonical fields. |

Reason normalization:

- `詫びリセット` covers incident, defect, quality degradation, incorrect limits, compensation, and similar remediation.
- `ご祝儀リセット` covers milestones, commemorations, celebrations, campaigns, and service initiatives.
- `定期更新` covers the ordinary weekly/regular cycle.
- When evidence is insufficient, do not fall back to `ご祝儀リセット` merely because the post mentions users or a reset. An unsupported reason may be unknown or omitted from the public row.

Scope normalization is evidence-based. `全有料プラン` is selected only when the reset or credit applicability is explicitly tied to all paid users. Audience greetings do not count. Conflicting narrow and broad evidence uses the conservative fallback rather than silently broadening the scope. Internally the default global scope is retained, but the public UI hides the default `全有料プラン` target row; only special scopes such as affected users or unused-bank accounts are shown.

A short completion post may use a related official notice as evidence for missing scope/reason/method, but the notice is normalized rather than copied into the canonical fields. Evidence is interpreted with the existing implementation, broadly ordered as authoritative execution/confirmed execution, completion post, related official notice, AI interpretation, and generic fallback; this list is a conceptual guide, not permission to invent a stricter ranking absent in code.

Identity and chronology are immutable under presentation correction: do not change the canonical event key, execution timestamp, duplicate identity, source tweet identity, or random-reset chronology boundary merely to improve wording.

### BANKED and Conditional Events

Normal global random reset, BANKED distribution, conditional compensation, and account-specific reset are different semantics. A conditional or narrow distribution must not be promoted into a broad random reset. In particular, the compensation event `2097752790177370535` is a `banked_distribution` with `randomResetTargetScope = conditional` and is not eligible as a broad random-reset probability target.

### Current Canonical Example

`local-codex-sweet-dreams-reset-2026-09-12` is the current global reset example:

| Layer | Value |
| --- | --- |
| record | confirmed global random reset |
| cycle | `ランダムリセット` |
| reason | `詫びリセット` |
| method | `強制リセット` |
| internal scope | `全有料プラン` (hidden as the default public target row) |
| execution | `2026-09-12T08:09:17Z` (`2026-09-12 17:09 JST`) |
| JA | `品質問題修正に伴う詫びリセット` |
| EN | `Compensation Reset Following Quality Fixes` |
| ZH | `质量问题修复补偿重置` |

The phrase `Sweet dreams` is provenance/display context, not a reason or scope. The localized summaries describe a quality-issue response for Codex and ChatGPT Work and a forced usage-limit reset.

## History Presentation and Range Filters

- The last-month range is a rolling 30-day window.
- The reset-time graph includes random reset events whose event timestamp is in the selected window.
- For `range === "lastMonth"`, a random-reset interval is included only when both `interval.startAt >= startTime` and `interval.endAt <= now`. Both endpoints must be selected-period random reset events.
- `range === "all"` keeps the all-time consecutive-random-reset behavior.
- Invalid, future, duplicate, and non-positive intervals remain excluded.
- Commit `9b6f20690502831e5063f251bf5f6aacf29bf63a` is the interval-boundary fix. Production verification showed no 10-day-plus interval in last-month view (longest about 4.3 days); all-time view retained one (longest about 13.9 days).

## Open Investigation

Before changing code, audit whether the all-time approximately 13.9-day interval is correct:

1. Identify both endpoint reset events and their authoritative execution timestamps.
2. Verify that both endpoints are broad random-reset eligible events.
3. Confirm the heatmap uses execution time, not notice/opened time.
4. Exclude duplicate representations, regular resets, BANKED/conditional distributions, and narrow-scope events.
5. Confirm the interval population matches the population used by probability calculations.

If the interval is valid, make no code change. Do not hardcode or special-case a particular event ID.

## Invariants

- Display execution text is not a replacement for the canonical chronology boundary.
- Audience/greeting is not reset scope.
- Cycle, reason, method, and scope remain separate fields.
- BANKED conditional/narrow events never become broad random-reset targets without explicit evidence.
- Event identity, source identity, execution chronology, and duplicate reconciliation remain stable.
- Manual corrections are not overwritten without valid evidence.
- No point-in-time leakage: future signals, estimates, names, or metadata must not inform an earlier forecast.
- No historical backfill, relabel, or prediction-row rewrite.
- Context Safety Guard may demote or suppress; it must not promote an irrelevant/none signal to a stronger reset signal.
- Deployment state and model adoption state are separate facts.
- Do not modify Production data, schema, or migrations without an explicit request.

## Verification Baseline

The last verified main baseline for the current code line was:

- Full test suite: `1885/1885 PASS`.
- Typecheck: PASS.
- Lint: PASS.
- Build: PASS.
- `git diff --check`: PASS.

This is a status snapshot, not a promise that every future branch has the same result; rerun the checks after relevant changes.

## Maintenance Rule

Update this document after an important merge, Production behavior/model change, major investigation, or next-action change. Do not turn it into a per-commit changelog. Keep it focused on the current state.

**Next action:** audit the all-time 13.9-day random reset interval before making any code change.
