# Tibo Event Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate safe event-level reset reason, scope, summary, and note from the canonical Tibo source set, while restricting scope to all-paid / partial / blank and keeping reason non-empty for completed non-regular resets.

**Architecture:** Reuse the existing canonical source-context builder after formal adoption. Add a dedicated Gemini event-metadata generator and persist its result on the existing event-keyed `reset_display_names` row. History presentation consumes safe generated metadata only for non-static dynamic events; identity, execution time, adoption, and probability chronology remain unchanged.

**Tech Stack:** Next.js, TypeScript, Node test runner, Supabase/Postgres migrations, Gemini REST API.

**Spec:** `docs/superpowers/specs/2026-09-13-tibo-event-metadata-design.md`

## Global Constraints

- Scope output is exactly `全有料プラン`, `一部ユーザー`, or null.
- `Codex / ChatGPT Work` must never be emitted as a scope fallback.
- Completed non-regular reset reason should resolve to `詫びリセット` or `ご祝儀リセット`; regular reset keeps `定期更新`.
- Unknown scope is hidden from public presentation rather than guessed.
- Existing human/static corrections and manual display names remain authoritative.
- Event identity, execution timestamp, source tweet identity, dedupe, adoption, BANKED semantics, and probability chronology are unchanged.
- AI metadata failure never blocks raw Tibo persistence or formal adoption.
- No production data backfill is part of this change.

---

### Task 1: Canonical scope and reason fallback behavior

**Files:**
- Create: `lib/radar/resetScope.ts`
- Modify: `lib/radar/types.ts`
- Modify: `lib/radar/tiboHistory.ts`
- Modify: `lib/radar.ts`
- Modify: `components/ResetHistoryDetails.tsx`
- Test: `tests/tiboFormalHistory.test.ts`
- Test: `tests/dashboardPresentation.test.ts`

**Interfaces:**
- Produces: `normalizeResetScope(value: string | null | undefined): ResetScopeType | undefined`
- Produces: `ResetScopeType = "全有料プラン" | "一部ユーザー"`
- `convertTiboResetSignalToHistoryEvent()` may leave scope undefined when no applicability evidence exists.

- [ ] **Step 1: Write failing scope/reason tests**

Add regressions proving that an evidence-free completion has no scope, never emits `Codex / ChatGPT Work`, narrow applicability becomes `一部ユーザー`, broad applicability becomes `全有料プラン`, legacy special narrow labels normalize to `一部ユーザー`, and completed non-regular history receives a non-empty reason fallback.

- [ ] **Step 2: Run CI and verify the new tests fail for the intended old behavior**

Expected failures include the current conservative `Codex / ChatGPT Work` fallback and blank reason assertions.

- [ ] **Step 3: Implement the canonical scope normalizer and reason fallback**

`normalizeResetScope()` maps known broad labels to `全有料プラン`, known narrow labels to `一部ユーザー`, returns undefined for `Codex / ChatGPT Work` and unrecognized values, and is used by public history projection. `tiboHistory.getScope()` returns only broad, narrow, or undefined. Completed non-regular presentation falls back to `ご祝儀リセット` only after explicit/static and deterministic apology/celebration evidence has been considered.

- [ ] **Step 4: Re-run CI until the focused behavior is green**

---

### Task 2: Event metadata generator

**Files:**
- Create: `lib/radar/resetEventMetadata.ts`
- Modify: `lib/radar/randomResetNaming.ts`
- Test: `tests/resetEventMetadata.test.ts`
- Test: `tests/randomResetDisplayNames.test.ts`

**Interfaces:**
- Produces: `ResetEventMetadataResult`
- Produces: `generateResetEventMetadata(input, options)`
- Consumes: canonical `sourcePostText`, completion timestamp, reset method, and event key.

- [ ] **Step 1: Write failing parser/prompt tests**

Cover the Sweet-dreams style multi-post case, explicit partial audience, greeting-only scope ambiguity, required two-way reason classification, exact scope evidence validation, localized summary/note length bounds, and unsupported named-token/number rejection.

- [ ] **Step 2: Run CI and verify the tests fail because the generator does not exist**

- [ ] **Step 3: Implement `reset-event-metadata-v1`**

The prompt requires `reasonType` (`ご祝儀リセット` or `詫びリセット`), optional canonical scope, exact scope evidence for any non-null scope, localized summary/note, and a short Japanese audit reason. Parser validation rejects unsupported scope, invalid evidence, overlong text, unsupported named entities, and unsupported numbers.

- [ ] **Step 4: Tighten the existing display-name prompt**

Add an explicit priority rule: causal/incident/milestone facts from any canonical source post outrank low-information completion phrases or closing mood text when choosing the event name.

- [ ] **Step 5: Re-run CI**

---

### Task 3: Persist generated event metadata on the event-keyed row

**Files:**
- Create: `supabase/migrations/20260913000100_add_reset_event_metadata.sql`
- Create: `lib/radar/resetEventMetadataStore.ts`
- Modify: `lib/radar/types.ts`
- Modify: `lib/radar/resetDisplayNameStore.ts`
- Test: `tests/resetEventMetadataStore.test.ts`
- Test: `tests/resetDisplayNameReadProjection.test.ts`

**Interfaces:**
- Produces: `ensureResetEventMetadataForEvent(item, options)`
- Extends: `ResetDisplayNameRecord` with event metadata columns.

- [ ] **Step 1: Write failing persistence/read-compatibility tests**

Verify event-keyed upsert payloads, input-hash reuse, safe status handling, and fallback reads when the new columns are unavailable during schema propagation.

- [ ] **Step 2: Run CI and verify red**

- [ ] **Step 3: Add migration and store implementation**

Add constrained `event_reason_type` / `event_scope`, localized summary/note columns, model/version/status/flags/timestamps/hash. Reuse the same event key and source tweet provenance as reset display names.

- [ ] **Step 4: Re-run CI**

---

### Task 4: Webhook integration and history projection

**Files:**
- Modify: `app/api/webhook/tibo/route.ts`
- Modify: `lib/radarFetch.ts`
- Modify: `lib/radar.ts`
- Test: `tests/tiboWebhookRoute.test.ts`
- Test: `tests/tiboFormalHistory.test.ts`
- Test: `tests/dashboardPresentation.test.ts`

**Interfaces:**
- Webhook calls `ensureResetEventMetadataForEvent()` only after canonical event identity and source provenance are available.
- Public history reads safe event metadata from `reset_display_names` without exposing audit columns in public DTOs.

- [ ] **Step 1: Write failing integration tests**

Prove canonical source context is passed to metadata generation, generator failure is best-effort, static/manual history wins, dynamic metadata supplies reason/scope/summary/note, all-paid and null scope rows stay hidden, and partial scope is shown.

- [ ] **Step 2: Run CI and verify red**

- [ ] **Step 3: Wire the webhook and read projection**

Call metadata generation next to display-name generation after formal enrichment. Apply safe generated metadata only to non-static dynamic events. Keep event identity and execution-time code untouched.

- [ ] **Step 4: Re-run CI**

---

### Task 5: Canonical documentation and full verification

**Files:**
- Modify: `docs/reset-history-normalization.md`

- [ ] **Step 1: Update canonical normalization rules**

Replace the legacy conservative `Codex / ChatGPT Work` scope fallback with broad / partial / unknown. Document the low-stakes non-regular reason fallback and event-level AI metadata precedence.

- [ ] **Step 2: Run the full CI workflow**

Required commands via GitHub Actions: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and production dependency audit.

- [ ] **Step 3: Inspect the final diff**

Confirm no event-key, execution-time, identity, adoption, or probability-target logic changed outside scope normalization/presentation semantics.

- [ ] **Step 4: Merge the verified branch to `main`**
