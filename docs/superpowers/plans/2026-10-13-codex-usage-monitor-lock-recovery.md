# Codex Usage Monitor Lock Recovery Implementation Plan

> **For agentic workers:** This plan is implemented by the primary agent; a fresh Sol review is required before local distribution.

**Goal:** Prevent PID reuse from blocking the local monitor, explain safe lock conflicts in the GUI, restore the existing desktop launch path, and keep the outbox intact.

**Architecture:** Version new process-lock records while retaining schema 1 parsing. Compare a live PID's OS process start identity to the lock record and classify identity uncertainty as busy/fail-closed. Surface lock-conflict reasons through the existing host JSON event and preserve that diagnosis when the host exits normally.

**Tech Stack:** TypeScript/Node.js, Windows PowerShell process metadata, .NET 10 WinForms, Node test runner, dotnet build.

**Spec:** User-approved 2026-10-13 local monitor recovery request and `docs/codex-usage-monitor.md`.

## Global Constraints

- Never read or print usage raw values, API-key or webhook-secret values, or process-lock tokens.
- Never stop unrelated processes or delete/overwrite recovery gates or pending queue data.
- Old schema 1 locks remain readable; unknown process identity, permissions failure, corrupt records, and active recovery gates fail closed.
- Preserve exclusive gate acquisition, atomic canonical lock creation, token-checked release, and real-process race guarantees.
- Do not alter Supabase/Production history; use no website redeploy or DB migration.
- Do not modify PR139 or unrelated checkout changes.

## Review Focus

- Current PID reuse (legacy lock owner created after `acquiredAt`) must recover only when identity is provably different.
- A live original owner, inaccessible identity, malformed lock, and active recovery gate must not mutate the queue or canonical lock.
- Legacy and new lock files behave consistently across Windows and the Node CLI/test platforms.
- A normal host exit after lock conflict must not replace the reason with a generic stopped state; delivery errors keep their existing display.
- Local shortcut must ultimately launch a stable, reviewed GUI/runtime pairing and not a temporary worktree.

## File Map

- `tools/codex-usage-monitor-persistence.ts`: OS process-start identity, lock schema parsing/writing, and owner classification.
- `tests/codexUsageMonitorPersistence.test.ts`: PID reuse, live/unknown identity, legacy/new lock, queue preservation, and real process race regressions.
- `tools/codex-usage-monitor.ts`, `apps/codex-usage-monitor/monitor-host.ts`: structured lock conflict event semantics.
- `apps/codex-usage-monitor/MainForm.cs` and a focused WinForms smoke harness: visible reason and event ordering.
- `docs/codex-usage-monitor.md`: explain lock identity diagnostics and safe recovery behavior if needed.

## Tasks

1. Add tests for synthetic PID reuse, live matching owner, legacy lock compatibility, identity unavailable, malformed records, queue preservation, and host conflict event. Run the persistence test file and verify expected failures before changing production code.
2. Add process-start identity lookup with an injectable provider, validate new schema records, keep schema 1 support, and distinguish reused PID from live owner. Run focused and real-process race tests; verify queue bytes remain unchanged on fail-closed paths.
3. Add GUI status assertions through the real `MainForm` event handler for live-owner and manual-recovery conflict reasons, including the following `stopped` event. Wire conflict events without changing webhook error or process shutdown behavior. Run the WinForms smoke harness and dotnet build.
4. Run focused monitor integration/outbox and C# GUI diagnostics, then full `pnpm test`, lint, typecheck, build, diff check, and Windows GUI build sequentially. Commit and push the reviewed scope in one branch; request Sol review before packaging.
5. After review, publish the GUI and runtime helpers together to the stable repository `dist` path, back up and update the existing desktop shortcut, and verify its resolved target/working directory. Start the reviewed app and verify host/app-server lifecycle, a safe successful webhook send, and latest-state update without synthetic recovery/reset posts.
