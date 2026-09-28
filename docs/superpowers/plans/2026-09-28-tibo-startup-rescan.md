# Tibo Startup Rescan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reload already-open Tibo monitoring tabs once when the Chrome profile starts so the existing content-script DOM scan runs without waiting for the next ten-minute alarm.

**Architecture:** Reuse the existing `handleReloadAlarm` tab discovery, URL matching, reload, and diagnostics path. Add a startup trigger that skips pending-post retry, a short in-flight and persisted same-tab dedupe guard shared with alarm reloads, and no new collection path or permissions.

**Tech Stack:** Chrome Manifest V3, service worker JavaScript, Node.js built-in test runner through `tsx`.

**Spec:** User request in the current Codex conversation (Chrome startup early reload for existing Tibo monitoring tabs).

## Global Constraints

- Do not create monitoring tabs automatically.
- Do not add scrolling, cursors, X APIs, server polling, permissions, database columns, or webhook fields.
- Reuse the normal content-script DOM scan and preserve queue, context, translation, timeline, and idempotency behavior.
- Startup must not trigger on ordinary service-worker wakeups.
- This is not a backfill and does not guarantee collection of posts absent from the page DOM.

## Review Focus

- Startup and alarm events close together must not reload the same tab twice.
- A failed recent reload must not suppress the next attempt.
- No-tab startup must keep existing `monitored_tab_missing` diagnostics and must not create a tab.
- Startup must not retry pending tweet delivery or introduce a webhook path.
- Profile and `with_replies` matching and one-tab-per-timeline behavior must remain unchanged.

---

### Task 1: Add startup reload and dedupe regression coverage

**Files:**
- Modify: `tests/extensionAutoReload.test.ts`

**Interfaces:**
- Consume the mocked `runtime.onStartup` listener and existing `handleReloadAlarm` behavior.
- Test browser startup explicitly; service-worker evaluation alone represents an ordinary wake.

- [x] Add tests for startup with profile and `with_replies` tabs, no monitored tabs, ordinary worker initialization, startup/alarm near-duplicate delivery, and no startup webhook/retry.
- [x] Run `pnpm exec tsx --test tests/extensionAutoReload.test.ts`; new startup expectations failed because startup only restored the alarm (3 failures), then passed after implementation.

### Task 2: Implement startup-triggered reuse of the alarm reload path

**Files:**
- Modify: `extension/tibo-monitor/service-worker.js`
- Modify: `tests/extensionAutoReload.test.ts`

**Interfaces:**
- Extend `handleReloadAlarm` with an option to skip pending-post retry for startup.
- Share an in-flight reload promise and skip a same-timeline/same-tab reload when its prior successful reload is within 60 seconds.
- Continue to use existing per-timeline local status and `monitored_tab_missing` diagnostics.

- [x] Register the startup handler synchronously at module scope and invoke the common reload flow only from `runtime.onStartup`.
- [x] Ensure a skipped recent reload does not overwrite successful-reload timestamps or falsely report a missing tab.
- [x] Run focused regression tests; extension-related suite passed 84/84.

### Task 3: Document the behavior and verify the complete change

**Files:**
- Modify: `extension/tibo-monitor/README.md`
- Modify: `docs/operations/tibo-monitor-runbook.md`

- [x] State that Chrome startup reloads existing monitoring tabs, creates no tabs, and is not a historical backfill.
- [x] Verify manifest permissions are unchanged.
- [x] Run focused extension tests, `pnpm test` (2199/2199), lint, typecheck, build, Browser E2E (5/5), and `git diff --check`.
- [x] Review the final diff for webhook, schema, classification, history, and probability changes; none are present.
- [ ] Commit, push, open a PR, wait for required checks, and merge according to repository policy.
