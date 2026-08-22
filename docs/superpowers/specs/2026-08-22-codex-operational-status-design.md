# Codex Operational Status Display Design

**Date:** 2026-08-22

## Goal

Replace the overly narrow public `Codex関連障害` binary display with a display-only operational status that combines OpenAI Status and Tibo's own Codex operational updates without changing any reset probability model.

Public states:

- `none` — なし
- `investigating` — 問題を調査中
- `active` — 障害発生中
- `recovered` — 復旧直後
- `unknown` — 不明, used only when the required source data is unavailable and no reliable active Tibo operational signal exists

The public label should become `Codex関連状況` rather than `Codex関連障害` because the new state includes non-incident performance degradation and investigation notices.

## Non-goals and isolation

This feature is display-only.

It MUST NOT change:

- the published probability model or its probability values,
- shadow models A/B/C,
- existing OpenAI Status probability multipliers,
- complaint-pressure inputs,
- Tibo reset classification semantics (`official_notice`, `reset_executed`, `teaser`, `irrelevant`),
- teaser-strength semantics,
- reset history or reset target definitions.

Existing conservative OpenAI Status evaluation used by probability models remains intact. The new public operational status is derived through a separate display-only path.

## Tibo operational classification

Extend the existing Gemini Tibo classification response with a second independent axis:

```text
codexOperationalStatus:
  none | investigating | active | recovered | null
codexOperationalConfidence: number | null
codexOperationalEvidenceQuote: string | null
codexOperationalReasonJa: string | null
```

This classification MUST be independent from `signalType` and `teaserStrength`.

Examples:

- "We are investigating worse cache hit rates" -> reset `signalType=irrelevant`, operational `investigating`.
- "Codex is currently degraded / requests are failing" -> operational `active` when Tibo is clearly describing a current user-impacting outage or degradation, not merely saying an issue is being investigated.
- "Fixed now / recovered / back to normal" -> operational `recovered`.
- Product news, ordinary rate-limit discussion, historical incidents, and posts without a current Codex service problem -> operational `none`.

Quoted or reply-parent text may provide context but must never be treated as Tibo's own operational assertion. The evidence quote must come from Tibo's own text.

Gemini failure or invalid output yields `null`, not a guessed operational state.

## Persistence

Add nullable audit columns to `tibo_signals`:

- `codex_operational_status`
- `codex_operational_confidence`
- `codex_operational_evidence_quote`
- `codex_operational_reason_ja`
- `codex_operational_expires_at`

For `investigating`, `active`, and `recovered`, set `codex_operational_expires_at` to exactly 12 hours after `tweet_created_at`.

For `none` or `null`, `codex_operational_expires_at` is null.

Do not reuse the existing reset-signal `expires_at`; reset semantics and operational semantics have independent lifetimes.

Existing webhook state-preservation behavior must be extended so a later weaker/failing reclassification does not accidentally erase a valid operational classification for the same tweet.

## Tibo expiry and succession

A Tibo-derived non-`none` operational state is eligible only while:

```text
now < codex_operational_expires_at
```

At expiry it automatically stops contributing and the display falls back to OpenAI Status or `none`/`unknown`. No cleanup job is required.

A newer Tibo post supersedes an older Tibo operational post for display purposes when both are still eligible. This allows explicit follow-ups to change state immediately:

- `investigating` -> `recovered`
- `investigating` -> `active`
- `active` -> `recovered`

An ordinary newer Tibo post with operational `none` does NOT cancel an earlier still-valid operational signal; only an explicit non-`none` operational update supersedes another non-`none` operational update. This avoids unrelated posts clearing a known problem.

## OpenAI Status display interpretation

The display-only path should inspect raw Codex Status information separately from the probability-model suppression policy.

- Any current non-operational Codex component or unresolved Codex incident -> `active`.
- If no current active issue exists but a Codex incident resolved within the previous 12 hours -> `recovered`.
- Otherwise -> `none`.
- Source fetch failure with no trustworthy usable data -> `unknown`.

The existing probability evaluation may continue to suppress incident text when all Codex components are operational. That suppression MUST NOT erase a Tibo-derived `investigating` state from the public display.

## Aggregation precedence

Derive the final display state from current OpenAI Status plus the newest unexpired non-`none` Tibo operational signal.

Precedence:

1. `active`
2. `investigating`
3. `recovered`
4. `none`
5. `unknown` only as a data-availability fallback

More specifically:

- OpenAI Status `active` always wins.
- Tibo `active` also yields `active` while unexpired.
- If nothing is `active`, Tibo `investigating` yields `investigating`.
- If nothing is active/investigating, either source may yield `recovered`.
- If reliable OpenAI Status data says normal and no eligible Tibo operational signal exists, show `none`.
- If OpenAI Status is unavailable and no eligible Tibo operational signal provides a stronger state, show `unknown` rather than falsely claiming `none`.

The result should retain internal provenance (`openai_status`, `tibo`, or combined) and the relevant observed/expiry timestamps for debugging, while the public UI only needs the state label.

## Public DTO and UI

Add a dedicated public field such as:

```ts
codexOperationalStatus: "none" | "investigating" | "active" | "recovered" | "unknown"
```

The dashboard must consume this field directly. Remove the current UI behavior that infers incident state by parsing localized `displayReasoningSummary` phrases.

Localized labels:

| State | Japanese | English | Chinese |
| --- | --- | --- | --- |
| none | なし | None | 无 |
| investigating | 問題を調査中 | Investigating | 正在调查问题 |
| active | 障害発生中 | Incident active | 故障发生中 |
| recovered | 復旧直後 | Recently recovered | 刚刚恢复 |
| unknown | 不明 | Unknown | 未知 |

Japanese field label: `Codex関連状況`.

## Backfill / rollout

New posts use the new Gemini fields immediately after deployment.

To avoid waiting for the next Tibo post, perform a one-time reclassification/backfill only for recent Tibo rows whose `tweet_created_at` is within the previous 12 hours at rollout time. Use the same operational classifier semantics and store the same audit fields. Do not backfill older history because this feature is display-only and does not require historical training data.

The current cache-hit-rate investigation post should therefore become eligible for `investigating` if it is still inside its 12-hour window when rollout occurs.

## Failure handling

- Gemini unavailable: preserve reset webhook success using the existing fallback behavior; operational fields remain null/preserved.
- Optional DB columns temporarily absent during rollout: extend the existing optional-column compatibility path so webhook ingestion does not fail solely because the migration has not propagated yet.
- OpenAI Status unavailable: use an eligible Tibo state if present; otherwise `unknown`.
- Stale Tibo state: ignore it at read time based on `codex_operational_expires_at`.

## Tests

Add coverage for:

1. Gemini parsing: investigating / active / recovered / none and invalid-output fallback.
2. Independence: an `irrelevant` reset classification can simultaneously be `investigating` operationally.
3. Context safety: quoted/parent text cannot create an operational assertion absent Tibo-owned evidence.
4. Webhook persistence and optional-column compatibility.
5. Exact 12-hour expiry for Tibo investigating/active/recovered.
6. Newer non-none Tibo operational update supersedes an older one; unrelated `none` does not clear it.
7. OpenAI Status active -> `active`.
8. Status resolved less than 12h -> `recovered`; 12h or older -> `none`.
9. Tibo investigating remains visible even when all official Codex components are operational.
10. Precedence: active > investigating > recovered > none.
11. Status unavailable + no eligible Tibo state -> `unknown`.
12. Dashboard consumes the explicit DTO field and no longer parses localized reasoning text for incident state.
13. Published and shadow probability outputs remain unchanged for identical probability inputs.

## Acceptance criteria

- The dashboard shows `Codex関連状況` with the five display states above.
- The 2026-08-22 cache-hit-rate investigation pattern is classified as `investigating`, not a reset signal.
- Every Tibo-derived non-none operational state expires after 12 hours unless superseded by a newer non-none operational update.
- Expired Tibo operational states automatically fall back without a cron cleanup.
- OpenAI Status active incidents still produce `障害発生中`.
- Recent recovery produces `復旧直後` for 12 hours on the display-only path.
- No probability model, probability input, reset classification, or shadow model behavior changes.
