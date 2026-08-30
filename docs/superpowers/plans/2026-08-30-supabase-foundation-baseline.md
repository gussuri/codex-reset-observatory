# Supabase Foundation Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository's Supabase migration chain reproducible from an empty local database without changing Production.

**Architecture:** Add only the schema that existed before the first historical ALTER migration as a foundation migration. Keep later migrations incremental, keep the Production-only localized-name migration pending, and validate the complete chain on a local Supabase stack when Docker is available.

**Tech Stack:** Supabase CLI 2.116.0, PostgreSQL, pnpm, PowerShell, Docker Desktop when available.

**Spec:** `C:/Users/Yura/.codex/attachments/ea2d20d7-b321-4258-b769-b0a205145cff/pasted-text.txt`

## Global Constraints

- Production DB, migration history, and data must not be changed.
- Do not run `supabase db push`, `supabase db reset --linked`, or `supabase migration repair`.
- Do not use WSL or Bash.
- Do not commit or push.
- Do not copy Production data into a seed file.
- The foundation must represent the schema immediately before `20260731000000_add_page_reload_to_tibo_heartbeat.sql`.
- Do not put later columns, constraints, indexes, RLS, or grants into the foundation.

### Task 1: Local CLI and configuration

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `supabase/config.toml`
- Create: `.env.example`

- [ ] Add `supabase@2.116.0` as an exact pnpm devDependency.
- [ ] Run the repo-local CLI version and help commands with explicit local-only flags where applicable.
- [ ] Generate and review `supabase/config.toml` without Production credentials or project ref.
- [ ] Add only environment variable names and empty placeholders to `.env.example`, separating required, optional, local monitor, and CI settings.

### Task 2: Foundation schema

**Files:**
- Create: `supabase/migrations/<timestamp-before-20260731000000>_create_initial_observatory_schema.sql`

- [ ] Reconstruct only the pre-existing definitions of `tibo_heartbeat`, `tibo_signals`, and `prediction_history` from the read-only Production catalog and the later migration deltas.
- [ ] Include required UUID/identity dependencies, base keys, base unique constraints, base checks, base indexes, RLS, and final intended base-table grants only when proven to predate the first migration.
- [ ] Keep all columns introduced by later migrations out of this file.

### Task 3: Migration-history comparison

**Files:**
- No Production files or history may be modified.

- [ ] Compare each of the six version-mismatch pairs by SQL intent, schema result, dependency order, and whether a filename-only alignment is safe.
- [ ] Compare the two history-missing schema changes against Production catalog constraints, indexes, foreign keys, RLS, and grants.
- [ ] Record `add_localized_reset_display_names` as a real pending migration because its columns are absent in Production.

### Task 4: Local reset verification

**Files:**
- No additional implementation files unless a failing local migration requires a minimal fix.

- [ ] Start only a local Supabase stack if Docker is available.
- [ ] Run local `supabase db reset` twice without `--linked` and verify both passes.
- [ ] Compare the fresh local catalog against the read-only Production catalog, allowing only the intentional localized-name pending difference and documented sequence ACL difference.

### Task 5: Validation and handoff

**Files:**
- No application-code changes unless directly required by the local schema implementation.

- [ ] Run focused migration/config checks and any required application tests, lint, typecheck, build, and `git diff --check`.
- [ ] Report CLI version, local reset limitations, schema differences, history reconciliation steps, and the exact files for a future commit.
- [ ] Confirm Production was not linked, written, repaired, or reset and leave all changes uncommitted.
