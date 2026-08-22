# Codex Operational Status Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary `Codex関連障害` display with an explicit display-only Codex operational status that combines OpenAI Status and Tibo operational updates, while keeping all reset probability models unchanged.

**Architecture:** Add an isolated `codexOperationalStatus` domain module that owns operational-state parsing, 12-hour expiry, source precedence, and public display derivation. Extend the existing single Gemini Tibo classification call with an independent operational axis, persist it in nullable audit columns, read it through the existing radar fetch path, project a single explicit DTO field, and make the dashboard consume that field directly instead of parsing localized reasoning text.

**Tech Stack:** Next.js 15 App Router, TypeScript, Node test runner, Supabase/Postgres, existing Gemini classifier, React.

**Spec:** `docs/superpowers/specs/2026-08-22-codex-operational-status-design.md`

## Global Constraints

- Public states are exactly `none | investigating | active | recovered | unknown`.
- Japanese labels are exactly `なし | 問題を調査中 | 障害発生中 | 復旧直後 | 不明`.
- Japanese field label becomes `Codex関連状況`.
- Tibo-derived `investigating`, `active`, and `recovered` expire exactly 12 hours after `tweet_created_at`.
- OpenAI Status `recovered` remains visible for exactly 12 hours after resolution.
- New unrelated Tibo posts with operational `none` do not cancel an older unexpired non-`none` Tibo operational signal.
- Newer unexpired non-`none` Tibo operational updates supersede older non-`none` Tibo operational updates.
- Precedence is `active > investigating > recovered > none`; `unknown` is data-availability fallback only.
- OpenAI Status active always wins.
- Tibo operational classification is independent of reset `signalType` and `teaserStrength`.
- Quoted/reply-parent text may provide context but cannot itself become Tibo-owned operational evidence.
- Existing reset probability models, A/B/C shadow models, complaint pressure, OpenAI Status probability multipliers, reset classification, teaser strength, reset history, and target definitions must remain behaviorally unchanged.
- Do not apply the new production Supabase migration or run the one-time production backfill before final merge approval.

---

### Task 1: Operational status domain and Gemini parsing

**Files:**
- Create: `lib/radar/codexOperationalStatus.ts`
- Modify: `lib/radar/geminiClassification.ts`
- Test: `tests/codexOperationalStatus.test.ts`
- Test: `tests/geminiShadowClassification.test.ts`

**Interfaces:**
- Produces `TiboCodexOperationalStatus = "none" | "investigating" | "active" | "recovered"`.
- Produces `PublicCodexOperationalStatus = TiboCodexOperationalStatus | "unknown"`.
- Produces `parseCodexOperationalAssessment(value, authorText)` returning validated status/confidence/evidence/reason fields.
- Produces `getTiboOperationalExpiry(tweetCreatedAt)` returning exactly +12h or `null` for invalid input.
- Extends `GeminiClassificationOutput` with `codexOperationalStatus`, `codexOperationalConfidence`, `codexOperationalEvidenceQuote`, `codexOperationalReasonJa`.

- [ ] **Step 1: Write failing domain-parser tests**

Add tests that require:

```ts
assert.deepEqual(
  parseCodexOperationalAssessment({
    codexOperationalStatus: "investigating",
    codexOperationalConfidence: 0.99,
    codexOperationalEvidenceQuote: "We are investigating",
    codexOperationalReasonJa: "Codexの性能問題を調査中。",
  }, "We are investigating and will have an update tomorrow."),
  {
    status: "investigating",
    confidence: 0.99,
    evidenceQuote: "We are investigating",
    reasonJa: "Codexの性能問題を調査中。",
  },
);
```

Also require `active`, `recovered`, `none`, invalid status -> all-null assessment, and evidence not contained in Tibo's own text -> all-null assessment.

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm test -- tests/codexOperationalStatus.test.ts
```

Expected: FAIL because the module/parser does not exist.

- [ ] **Step 3: Implement the minimal domain parser and 12h helper**

Create `lib/radar/codexOperationalStatus.ts` with strict enum validation, `[0,1]` confidence validation, author-text substring validation for evidence, max-length sanitization, and:

```ts
export const TIBO_OPERATIONAL_TTL_MS = 12 * 60 * 60 * 1000;
```

`getTiboOperationalExpiry()` must return `new Date(created + TIBO_OPERATIONAL_TTL_MS).toISOString()` only for finite timestamps.

- [ ] **Step 4: Write failing Gemini integration tests**

Require the Gemini system prompt/schema to include the four operational values, require operational fallback fields to be null on API/parser failure, and require reset `signalType="irrelevant"` to coexist with operational `investigating`.

- [ ] **Step 5: Verify RED**

Run:

```bash
corepack pnpm test -- tests/geminiShadowClassification.test.ts tests/codexOperationalStatus.test.ts
```

Expected: FAIL on missing operational Gemini fields.

- [ ] **Step 6: Extend the existing one-call Gemini classifier**

Update `TIBO_GEMINI_SYSTEM_PROMPT` and the JSON schema with:

```json
"codexOperationalStatus": "none" | "investigating" | "active" | "recovered",
"codexOperationalConfidence": number,
"codexOperationalEvidenceQuote": string | null,
"codexOperationalReasonJa": string | null
```

Semantics:
- `investigating`: Tibo explicitly says a current Codex problem/degradation is being investigated.
- `active`: Tibo explicitly describes a current user-impacting outage/degradation/failure, stronger than merely investigating.
- `recovered`: Tibo explicitly says fixed/resolved/back to normal.
- `none`: no current Codex operational problem assertion.

Parse via `parseCodexOperationalAssessment`; never derive operational status from quoted/parent text without an evidence substring in `input.text`.

- [ ] **Step 7: Verify GREEN**

Run the same focused tests and require PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/radar/codexOperationalStatus.ts lib/radar/geminiClassification.ts tests/codexOperationalStatus.test.ts tests/geminiShadowClassification.test.ts
git commit -m "feat: classify Tibo Codex operational status"
```

---

### Task 2: Persist operational classification safely

**Files:**
- Create: `supabase/migrations/20260822110000_add_tibo_codex_operational_status.sql`
- Modify: `app/api/webhook/tibo/route.ts`
- Modify: `lib/radar/tiboWebhookState.ts`
- Test: `tests/tiboWebhookRoute.test.ts`
- Test: `tests/tiboWebhookState.test.ts`

**Interfaces:**
- New nullable columns: `codex_operational_status`, `codex_operational_confidence`, `codex_operational_evidence_quote`, `codex_operational_reason_ja`, `codex_operational_expires_at`.
- Webhook persists operational fields independently from reset classification fields.

- [ ] **Step 1: Write failing persistence tests**

Require an `investigating` Gemini result to persist:

```ts
codex_operational_status: "investigating"
codex_operational_expires_at: exactly tweet_created_at + 12h
```

Require `none`/null to persist `codex_operational_expires_at: null`.

Require same-tweet reprocessing with Gemini failure/null to preserve an existing valid non-null operational assessment instead of erasing it.

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm test -- tests/tiboWebhookRoute.test.ts tests/tiboWebhookState.test.ts
```

Expected: FAIL because operational columns/preservation do not exist.

- [ ] **Step 3: Add migration**

Migration must use nullable columns and a status check constraint limited to `none`, `investigating`, `active`, `recovered`; confidence check must allow null or `[0,1]`.

- [ ] **Step 4: Extend webhook payload and compatibility fallback**

Use `getTiboOperationalExpiry(createdDate.toISOString())` only for non-`none` successful operational statuses. Extend the optional-column error detector and existing-state select with all five new columns.

Do not alter `signal_type`, teaser handling, temporal reset expiry, formal reset adoption, or probability-related code.

- [ ] **Step 5: Extend webhook state preservation**

Add operational fields to `ExistingTiboWebhookState` and payload typing. If an existing row has a non-null operational status and the incoming operational status is null because classification failed/skipped, keep the existing operational fields. Do not preserve a stale value over a successful explicit `none` for the same tweet.

- [ ] **Step 6: Verify GREEN**

Run the focused tests and require PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260822110000_add_tibo_codex_operational_status.sql app/api/webhook/tibo/route.ts lib/radar/tiboWebhookState.ts tests/tiboWebhookRoute.test.ts tests/tiboWebhookState.test.ts
git commit -m "feat: persist Tibo operational status"
```

---

### Task 3: Read and aggregate OpenAI Status + Tibo display state

**Files:**
- Modify: `lib/radar/types.ts`
- Modify: `lib/radarFetch.ts`
- Modify: `lib/radar/codexOperationalStatus.ts`
- Test: `tests/codexOperationalStatus.test.ts`
- Test: `tests/radarFetch.test.ts` or the existing radar-fetch contract test that covers selected Tibo fields

**Interfaces:**
- `ActiveTiboSignal` gains nullable operational audit fields.
- Produces `deriveCodexOperationalStatus({ openAIStatusHistory, openAIStatusHealth, affectedCodexComponents, tiboSignals, now })`.
- Returns `{ status, source, observedAt, expiresAt }` internally; only `status` crosses the public DTO.

- [ ] **Step 1: Write failing aggregation tests**

Cover exactly:

```text
OpenAI unresolved Codex incident -> active
OpenAI affected Codex component -> active
OpenAI resolved 11h59m ago -> recovered
OpenAI resolved exactly 12h ago -> none
Tibo investigating 11h59m old -> investigating
Tibo investigating exactly 12h old -> expired
newer Tibo recovered supersedes older investigating
newer operational none does not cancel older investigating
OpenAI active beats Tibo investigating/recovered
Tibo investigating beats OpenAI recovered
OpenAI source unavailable + no eligible Tibo -> unknown
OpenAI source unavailable + eligible Tibo investigating -> investigating
```

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm test -- tests/codexOperationalStatus.test.ts
```

Expected: FAIL because aggregation does not exist.

- [ ] **Step 3: Implement aggregation in the isolated domain module**

Use strict `now < expiresAt` eligibility. Ignore rejected signals and future/invalid timestamps. For Tibo, consider only non-`none` operational statuses; sort by `tweet_created_at` descending and take the newest eligible non-`none` update.

For OpenAI Status, trust it only when source health is `ok`; unresolved history or affected components => `active`, otherwise most recent valid resolution strictly younger than 12h => `recovered`, otherwise `none`. If source health is not `ok`, use Tibo if available, else `unknown`.

- [ ] **Step 4: Write failing fetch-projection tests**

Require radar history select/mapping to carry the five operational fields into `recent_tibo_signals` while preserving the existing optional-column fallback behavior.

- [ ] **Step 5: Verify RED**

Run the focused radar-fetch test.

- [ ] **Step 6: Extend radar fetch/types**

Add the five fields to the rich history select and recent-signal mapping. Extend `isMissingTiboOptionalColumnError` so a pre-migration database falls back to the legacy select rather than failing the whole radar fetch.

- [ ] **Step 7: Verify GREEN**

Run focused tests and require PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/radar/types.ts lib/radarFetch.ts lib/radar/codexOperationalStatus.ts tests/codexOperationalStatus.test.ts tests/radarFetch*.test.ts
git commit -m "feat: derive Codex operational display state"
```

---

### Task 4: Public DTO, localized labels, and dashboard direct consumption

**Files:**
- Modify: `lib/radar/types.ts`
- Modify: `lib/radar/publicDto.ts`
- Modify: `lib/radar/i18n.ts`
- Modify: `components/RadarDashboard.tsx`
- Test: `tests/dashboardPresentation.test.ts`
- Test: `tests/publicDto.test.ts` or existing public DTO contract test

**Interfaces:**
- `PublicRadarSnapshot.codexOperationalStatus` is explicit and always one of the five public states.
- Dashboard no longer calls `getIncidentStatusFromReason()` or parses `displayReasoningSummary` for operational state.

- [ ] **Step 1: Write failing DTO/UI tests**

Require public snapshot to expose `codexOperationalStatus` and dashboard to render:

```text
Codex関連状況 / なし
Codex関連状況 / 問題を調査中
Codex関連状況 / 障害発生中
Codex関連状況 / 復旧直後
Codex関連状況 / 不明
```

Also require a reasoning summary containing old incident phrases to have no effect when the explicit DTO field is `none`.

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm test -- tests/dashboardPresentation.test.ts tests/publicDto.test.ts
```

Use the actual existing DTO test file if its filename differs.

- [ ] **Step 3: Project the explicit state**

In `toPublicRadarSnapshot`, call `deriveCodexOperationalStatus` with:
- `internal.openai_status_history`,
- `internal.data_health?.sources.openAIStatus`,
- `internal.codex_environment?.openai_status_affected_codex_components`,
- `internal.recent_tibo_signals ?? internal.active_tibo_signals`,
- `calculationNow`.

Expose only `.status` publicly.

- [ ] **Step 4: Replace UI phrase parsing**

Delete `IncidentStatus`, `getIncidentStatusFromReason`, and the old phrase lists. Map the explicit DTO value through i18n. Change Japanese label to `Codex関連状況`; update EN/ZH counterparts consistently.

- [ ] **Step 5: Verify GREEN**

Run focused UI/DTO tests and require PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/radar/types.ts lib/radar/publicDto.ts lib/radar/i18n.ts components/RadarDashboard.tsx tests/dashboardPresentation.test.ts tests/*public*Dto*.test.ts
git commit -m "feat: show Codex operational status"
```

---

### Task 5: One-time recent-row backfill tooling

**Files:**
- Create: `scripts/backfill-tibo-codex-operational-status.ts`
- Modify: `package.json`
- Test: `tests/tiboOperationalBackfill.test.ts`

**Interfaces:**
- Script reads only rows with `tweet_created_at >= now - 12h`.
- Script invokes the same Gemini classifier but writes only the five operational columns.
- Script never modifies reset `signal_type`, confidence, reset classification audit fields, teaser fields, or temporal fields.

- [ ] **Step 1: Write failing pure-helper tests**

Factor selection/update-payload helpers so tests can require that:
- exactly-12h-old rows are excluded,
- recent rows are included,
- update payload contains only operational columns,
- `investigating/active/recovered` get exactly +12h expiry,
- `none` gets null expiry.

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm test -- tests/tiboOperationalBackfill.test.ts
```

- [ ] **Step 3: Implement script and package command**

Add:

```json
"backfill:tibo-operational-status": "tsx scripts/backfill-tibo-codex-operational-status.ts"
```

The script must fail closed when Supabase service configuration or Gemini configuration is missing and must log counts without printing secrets.

- [ ] **Step 4: Verify GREEN**

Run focused test and `corepack pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-tibo-codex-operational-status.ts package.json tests/tiboOperationalBackfill.test.ts
git commit -m "feat: add Tibo operational status backfill"
```

---

### Task 6: Isolation audit, full verification, PR

**Files:**
- Modify only if tests reveal defects.
- Test: existing probability/model contract tests.

**Interfaces:**
- Published and shadow probability code must have zero behavior changes.

- [ ] **Step 1: Add or strengthen isolation contract test if needed**

The test must compare identical probability inputs with/without operational display metadata and assert unchanged published probability outputs. It must also assert no C/A/B model configuration changed.

- [ ] **Step 2: Run full verification**

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm audit --prod --audit-level high
git diff --check
```

All must pass.

- [ ] **Step 3: Diff audit against `main`**

Verify no changes to:
- published probability selector/model configuration,
- A/B/C model definitions,
- probability weights,
- complaint-pressure behavior,
- reset target definitions.

- [ ] **Step 4: Push branch and open Draft PR**

PR summary must state:
- display-only operational status,
- OpenAI Status + Tibo sources,
- 12h Tibo/recovery expiry,
- no probability impact,
- migration/backfill intentionally not applied to Production before merge approval.

- [ ] **Step 5: Verify GitHub Actions and Vercel Preview**

Require CI success and Preview READY before declaring implementation complete.

- [ ] **Step 6: Stop before Production DB mutation and merge**

Do not merge the PR, apply the production migration, or run the production backfill without explicit final approval.
