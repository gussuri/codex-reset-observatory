# Tibo Reply Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Tibo monitoring to collect @thsottiaux authored replies from the profile and `with_replies` timelines with explicit metadata, while preserving the existing webhook, Gemini, Supabase, deduplication, and public prediction boundaries.

**Architecture:** Add pure URL/DOM metadata helpers to the extension scan utility, pass optional validated metadata through the existing webhook into rule/Gemini classification and nullable Supabase columns, and add a reply filter at the internal signal/history fetch boundary. The service worker reloads at most one tab per timeline and retains the legacy profile/notifications behavior.

**Tech Stack:** Chrome Manifest V3 JavaScript, Next.js App Router route handlers, TypeScript classification/fetch modules, Supabase SQL migrations, Node `tsx --test` tests.

## Global Constraints

- Keep `https://x.com/thsottiaux` and `https://x.com/thsottiaux/with_replies` as user-opened monitoring tabs; do not create or close tabs.
- Keep old webhook payloads valid and use explicit reply metadata only when supplied.
- Do not change public probability, public DTO, dashboard UI, formal adoption thresholds, or existing classification results for ordinary posts.
- Do not send raw HTML, secrets, API keys, or Authorization values to the server or Supabase.
- Add only nullable metadata columns and do not rewrite existing rows.
- Run `corepack pnpm test`, `corepack pnpm run check`, `corepack pnpm run lint`, `corepack pnpm run typecheck`, and `corepack pnpm run build` before commit and push.

---

### Task 1: Define the reply metadata contract and diagnostics timeline labels

**Files:**
- Create: `lib/radar/tiboReplyMetadata.ts`
- Modify: `extension/tibo-monitor/diagnostics.js`
- Test: `tests/tiboReplyMetadata.test.ts`, `tests/tiboDiagnostics.test.ts`

**Interfaces:**
- `parseTiboReplyMetadata(body: Record<string, unknown>)` returns a safe normalized optional metadata object or a validation failure without exposing request contents.
- `getTimelineSource(url: string)` returns `"profile" | "with_replies" | null`.
- `extractReplyMetadata(article: Element)` returns `{ isReply: boolean; replyToHandles: string[]; replyContextText: string | null }`.
- Diagnostic summaries retain legacy fields and add optional `sourceTimeline: "profile" | "with_replies" | null`.

- [ ] **Step 1: Write failing parser, URL, DOM, and diagnostic tests**

Assert safe handle normalization/caps, invalid metadata rejection, old-field omission compatibility, profile/replies URL recognition for both hosts, explicit Replying-to detection, parent text only when nested, normal posts returning false, and timeline-aware diagnostic fingerprints.

- [ ] **Step 2: Run targeted tests and verify the expected missing-interface failures**

Run:

```text
corepack pnpm test tests/tiboReplyMetadata.test.ts tests/tiboDiagnostics.test.ts
```

Expected: failures because the new parser/helper exports and timeline field do not exist yet.

- [ ] **Step 3: Implement the pure metadata parser and extension helpers**

Use strict `@?[A-Za-z0-9_]{1,15}` handles, a maximum of 20 handles, a maximum of 1000 characters for parent context, explicit reply marker selectors only, and safe defaults for old payloads. Include `sourceTimeline` in the diagnostic fingerprint so profile and replies failures are distinguishable.

- [ ] **Step 4: Run the targeted tests to green**

Run the same command and confirm all parser/helper/diagnostic tests pass.

### Task 2: Add explicit metadata to extension collection and reload both timelines

**Files:**
- Modify: `extension/tibo-monitor/scan-utils.js`
- Modify: `extension/tibo-monitor/content.js`
- Modify: `extension/tibo-monitor/service-worker.js`
- Test: `tests/extensionAutoReload.test.ts`, `tests/tiboReplyMetadata.test.ts`

**Interfaces:**
- `content.js` sends optional `isReply`, `replyToHandles`, `replyContextText`, and `sourceTimeline` alongside the existing tweet fields.
- `service-worker.js` reloads at most one profile and one with-replies tab and preserves the existing queue/dedup behavior.

- [ ] **Step 1: Write failing extension tests**

Add tests for both timeline URLs, reloading one tab per timeline, continuing when only one timeline tab exists, preserving the legacy no-tab status, and ensuring the same tweet ID is queued only once.

- [ ] **Step 2: Run the extension tests and verify they fail on current profile-only reload behavior**

Run:

```text
corepack pnpm test tests/extensionAutoReload.test.ts
```

Expected: the with-replies reload test fails because the current service worker recognizes only `/thsottiaux`.

- [ ] **Step 3: Implement timeline-aware URL handling and reload state**

Recognize `/thsottiaux` as `profile` and `/thsottiaux/with_replies` as `with_replies` on x.com and twitter.com. Reload the first tab of each available timeline, record per-timeline local status/diagnostics, and keep the legacy general status successful when at least one monitored tab reloads. Keep notifications pages as collection-compatible but never as automatic reload targets.

- [ ] **Step 4: Add explicit reply metadata to scan payloads**

Use the scan utility helpers from content.js, keep strict Tibo status-link matching and translation exclusion, and send `sourceTimeline: "profile"` for the profile/legacy notifications path. Do not infer replies from leading `@` or the word `reply` in new payloads.

- [ ] **Step 5: Run extension and metadata tests to green**

Run:

```text
corepack pnpm test tests/extensionAutoReload.test.ts tests/tiboReplyMetadata.test.ts
```

### Task 3: Thread metadata through classification and webhook storage

**Files:**
- Modify: `lib/radar/classification.ts`
- Modify: `lib/radar/geminiClassification.ts`
- Modify: `app/api/webhook/tibo/route.ts`
- Test: `tests/classification.test.ts`, `tests/geminiShadowClassification.test.ts`, `tests/tiboWebhookRoute.test.ts`

**Interfaces:**
- `classifyTiboTweet(text, url, metadata?)` treats explicit `metadata.isReply` as authoritative and retains the old heuristic only when metadata is absent.
- Gemini input carries `isReply`, `replyToHandles`, `replyContextText`, and `sourceTimeline`, and its prompt states that reply status alone cannot raise a signal.
- Webhook stores normalized `reply_to_handles`, `reply_context_text`, and `source_timeline` while keeping old payloads valid.

- [ ] **Step 1: Write failing classification, prompt, and route tests**

Cover explicit true/false priority, old-payload fallback, reply context in the structured Gemini prompt, old webhook acceptance, new metadata validation, and the exact nullable storage payload.

- [ ] **Step 2: Run targeted tests and confirm the new behavior is absent**

Run:

```text
corepack pnpm test tests/classification.test.ts tests/geminiShadowClassification.test.ts tests/tiboWebhookRoute.test.ts
```

Expected: failures for explicit metadata priority, prompt fields, and route persistence.

- [ ] **Step 3: Implement metadata-aware rule and Gemini classification**

Preserve existing signal keywords, confidence values, thresholds, and formal adoption conditions. Add structured untrusted fields to the Gemini prompt and keep short contextless replies conservative without treating reply status itself as evidence.

- [ ] **Step 4: Implement webhook validation and nullable persistence**

Parse optional metadata before classification, return a safe 400 for invalid supplied metadata, pass normalized metadata into rule/Gemini classification, and include only bounded values in the Supabase upsert. Do not alter state lookup, formal adoption, or response compatibility.

- [ ] **Step 5: Run targeted tests to green**

Run the same targeted command and confirm all classification/prompt/webhook tests pass.

### Task 4: Exclude replies from internal signals and add the additive migration

**Files:**
- Create: `supabase/migrations/20260806_add_tibo_reply_metadata.sql`
- Modify: `lib/radarFetch.ts`
- Modify: `lib/radar/tiboHistory.ts`
- Test: `tests/radarFetch.test.ts`, relevant Tibo history tests

**Interfaces:**
- Existing nullable `is_reply` remains backward compatible: only `true` rows are excluded, while `NULL` legacy rows remain eligible.
- The new columns are nullable and constrained to `profile`/`with_replies` when non-null.

- [ ] **Step 1: Write failing query/history tests**

Assert that active signal and raw Tibo history queries add the `is_reply IS NULL OR is_reply = false` filter and that a reply cannot reach formal reset history while a legacy null row still can.

- [ ] **Step 2: Run the targeted fetch/history tests and verify the filter is absent**

Run:

```text
corepack pnpm test tests/radarFetch.test.ts tests/tiboHistory.test.ts
```

Expected: failures showing the new reply exclusion is not yet applied.

- [ ] **Step 3: Implement the nullable migration and query filters**

Add `reply_to_handles text[]`, `reply_context_text text`, and `source_timeline text` with `IF NOT EXISTS`, plus a nullable allowed-value check. Select/filter `is_reply` without rewriting existing data; keep replies available only for stored observation/classification.

- [ ] **Step 4: Run the targeted fetch/history tests to green**

Run the same command and confirm the query/filter tests pass.

### Task 5: Document two-tab operation and complete verification

**Files:**
- Modify: `docs/operations/tibo-monitor-runbook.md`
- Modify: `extension/tibo-monitor/README.md`
- Modify: `README.md` only if a concise monitor entry is required

**Interfaces:**
- Documentation describes profile and with-replies tabs, per-timeline diagnostics, old-tab compatibility, and no public probability impact.

- [ ] **Step 1: Update the runbook and extension README**

Document the normal two-tab setup, ten-minute per-timeline reload behavior, one-tab operation, `profile`/`with_replies` diagnostic distinction, explicit reply-context limitations, and Supabase nullable fields.

- [ ] **Step 2: Run the full verification suite**

Run:

```text
corepack pnpm test
corepack pnpm run check
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run build
```

Expected: all commands exit successfully; no public DTO, probability, UI, or Supabase runtime changes occur outside the new migration.

- [ ] **Step 3: Inspect the diff and secrets**

Run `git diff --check`, `git diff --stat`, and a tracked-file search for API keys, webhook secrets, raw HTML, and Authorization headers. Confirm `.env.local` is not staged and existing ordinary-post behavior is unchanged.

- [ ] **Step 4: Commit and push main**

Run:

```text
git add AGENTS.md docs/superpowers/specs/2026-08-06-tibo-replies-design.md docs/superpowers/plans/2026-08-06-tibo-replies.md extension lib app supabase tests README.md
git commit -m "feat: monitor Tibo replies"
git push origin main
```

Confirm the final worktree is clean and report the commit SHA, migration path, verification results, and any manual Chrome-tab reload needed.
