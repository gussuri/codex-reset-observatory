# Automation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rule-backed reset posts usable as formal history and add actionable alerts for CI failures and a stopped Tibo monitor.

**Architecture:** Keep the existing Supabase-backed signal pipeline and treat the classifier source as an audit attribute rather than a hard block when a high-confidence rule result explicitly says a reset was executed. Add a pure heartbeat evaluator, a protected health route, and scheduled GitHub Actions checks; a single workflow-run notifier opens and closes deduplicated GitHub issues for CI or monitor failures.

**Tech Stack:** Next.js App Router, TypeScript, Supabase service-role reads, GitHub Actions, `actions/github-script@v7`, Node test runner via `tsx`.

## Global Constraints

- Preserve existing public routes, webhook payloads, Supabase table names, and probability behavior.
- Formal reset history requires `signal_type=reset_executed`, confidence `>= 0.95`, a valid tweet timestamp, and `verification_status !== rejected`.
- A `confirmed` verification status remains an explicit override for any classification source.
- Rule-backed sources are `rule`, `shadow`, and `rule_fallback`; Gemini remains accepted as before.
- The monitor health check must fail closed when `CRON_SECRET` or Supabase configuration is missing.
- A monitor heartbeat older than 15 minutes, a missing parse timestamp, a scan error, or a non-success page-reload status is unhealthy.
- CI must use a Node version compatible with the pinned `pnpm@11.18.0` toolchain (Node `>=22.13.0`).
- CI must install a Corepack version that recognizes the pinned pnpm signing key before activation.
- Notifications must not include secrets, raw authorization headers, or raw database error messages.

---

### Task 1: Adopt high-confidence rule-backed reset posts as formal history

**Files:**
- Modify: `lib/radar/tiboHistory.ts`
- Test: `tests/tiboFormalHistory.test.ts`
- Modify: `docs/operations/tibo-monitor-runbook.md`

**Interfaces:**
- Consumes: `FormalTiboResetSignal` and existing `isFormalTiboResetSignal` callers.
- Produces: unchanged `isFormalTiboResetSignal(signal): boolean` behavior for Gemini, confirmed, rejected, confidence, and timestamp checks; additionally accepts `rule`, `shadow`, and `rule_fallback` reset classifications when the common high-confidence checks pass.

- [ ] **Step 1: Add failing behavior tests**

Add tests that assert an `auto_unverified` `reset_executed` signal with `classification_source: "rule"` is formally accepted, and that `classification_source: "shadow"` is also accepted as a rule-backed result. Keep a `classification_source: "rule"` signal below `0.95` rejected and keep a rejected signal rejected.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm exec tsx --test tests/tiboFormalHistory.test.ts`

Expected: the new rule-backed acceptance assertions fail because `isFormalTiboResetSignal` currently accepts only Gemini, rule fallback, or confirmed signals.

- [ ] **Step 3: Implement the smallest policy change**

In `lib/radar/tiboHistory.ts`, define a rule-backed source set containing `rule`, `shadow`, and `rule_fallback`, then use it in the final acceptance expression after the existing signal type, confidence, rejection, and timestamp guards. Do not lower the confidence threshold or change conversion/merge behavior.

- [ ] **Step 4: Run the focused and adjacent tests**

Run: `corepack pnpm exec tsx --test tests/tiboFormalHistory.test.ts tests/probabilityIntegration.test.ts`

Expected: all tests pass, including dynamic history merging and probability anchoring.

- [ ] **Step 5: Update the operator runbook**

Update `docs/operations/tibo-monitor-runbook.md` so the formal-history rule lists `gemini`, `rule`, `shadow`, and `rule_fallback` as accepted sources when the confidence and rejection guards pass, and explains that `confirmed` remains an override.

- [ ] **Step 6: Commit**

```bash
git add lib/radar/tiboHistory.ts tests/tiboFormalHistory.test.ts docs/operations/tibo-monitor-runbook.md
git commit -m "fix: accept high-confidence rule reset history"
```

### Task 2: Fix the CI runtime mismatch

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/ciWorkflow.test.ts`

**Interfaces:**
- Consumes: `package.json` `packageManager: "pnpm@11.18.0"`.
- Produces: the same ordered quality-gate commands, executed on Node `22.13.0` or newer.

- [ ] **Step 1: Add a failing workflow contract assertion**

Change the existing workflow test to require `node-version: 22.13.0` instead of Node 20 while keeping the pinned pnpm and command-order assertions unchanged.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm exec tsx --test tests/ciWorkflow.test.ts`

Expected: the test fails because `.github/workflows/ci.yml` still requests Node 20.

- [ ] **Step 3: Update the workflow runtime**

Change the `actions/setup-node` `node-version` value in `.github/workflows/ci.yml` to `22.13.0` and install pinned `corepack@0.35.0` before enabling Corepack. Keep the existing install, lint, typecheck, test, build, and audit command order intact.

- [ ] **Step 4: Run the focused test and local install check**

Run: `corepack pnpm exec tsx --test tests/ciWorkflow.test.ts` and `corepack pnpm install --frozen-lockfile --ignore-scripts`

Expected: both commands exit successfully.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml tests/ciWorkflow.test.ts
git commit -m "fix: run CI on pnpm-compatible Node"
```

### Task 3: Add monitor health checks and workflow-failure notifications

**Files:**
- Create: `lib/radar/monitorHealth.ts`
- Create: `app/api/monitor/health/route.ts`
- Create: `.github/workflows/tibo-monitor-health.yml`
- Create: `.github/workflows/notify-workflow-failures.yml`
- Test: `tests/monitorHealth.test.ts`
- Test: `tests/monitorWorkflow.test.ts`
- Modify: `docs/operations/tibo-monitor-runbook.md`

**Interfaces:**
- Consumes: `tibo_heartbeat` row with `last_heartbeat_at`, `last_successful_parse_at`, `last_scan_error`, `last_page_reload_status`, and `last_page_reload_error`.
- Produces: `evaluateTiboHeartbeat(snapshot, now): MonitorHealthResult`, protected `GET /api/monitor/health`, a 10-minute scheduled monitor workflow, and deduplicated GitHub issue notifications for failed `CI` or `Tibo monitor health` runs.

- [ ] **Step 1: Write failing pure evaluator tests**

Add tests for healthy recent heartbeat, stale heartbeat, missing heartbeat/parse timestamp, scan error, and non-success page reload status. Assert the result contains only safe status/detail fields and an age in seconds where applicable.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `corepack pnpm exec tsx --test tests/monitorHealth.test.ts`

Expected: the test fails because `lib/radar/monitorHealth.ts` does not exist.

- [ ] **Step 3: Implement the pure evaluator**

Create `lib/radar/monitorHealth.ts` with a 900-second threshold and typed statuses. Return unhealthy for missing/invalid timestamps, stale heartbeat or parse time, a non-null scan error, or page reload status other than `success`/`null`; never return raw error text in the public detail.

- [ ] **Step 4: Add the protected health route**

Create `app/api/monitor/health/route.ts` that requires `Authorization: Bearer ${CRON_SECRET}`, reads `tibo_heartbeat` with the Supabase service client, evaluates the row, and returns HTTP 200 only when healthy. Return 401 for bad credentials, 503 for missing configuration/database failure/unhealthy state, and generic safe JSON details.

- [ ] **Step 5: Add scheduled health workflow**

Create `.github/workflows/tibo-monitor-health.yml` with `schedule: "*/10 * * * *"` and `workflow_dispatch`. Call the production health route with `secrets.CRON_SECRET`, print only the safe response body, and exit nonzero for any status other than 200.

- [ ] **Step 6: Add deduplicated failure notifications**

Create `.github/workflows/notify-workflow-failures.yml` triggered by completed runs of `CI` and `Tibo monitor health` on `main`. Grant only `actions: read`, `contents: read`, and `issues: write`. Use `actions/github-script@v7` to create one open issue per workflow name on failure/cancellation, leave later duplicate failures quiet, and close the matching issue with a recovery comment after a successful run. Include only workflow name, conclusion, branch, commit, and run URL.

- [ ] **Step 7: Add workflow contract tests**

In `tests/monitorWorkflow.test.ts`, assert the health workflow has the 10-minute schedule, manual dispatch, production endpoint, and `CRON_SECRET`; assert the notifier listens to both workflow names, has `issues: write`, and contains create/close logic. These tests must inspect real workflow text and must not rely on mocks.

- [ ] **Step 8: Update the runbook**

Document the 15-minute health threshold, the endpoint authentication, the scheduled workflow, and the GitHub issue lifecycle for failure and recovery.

- [ ] **Step 9: Run focused and full verification**

Run: `corepack pnpm exec tsx --test tests/monitorHealth.test.ts tests/monitorWorkflow.test.ts tests/heartbeatApiReloadFields.test.ts`, then `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm test`, and `corepack pnpm build`.

- [ ] **Step 10: Commit**

```bash
git add lib/radar/monitorHealth.ts app/api/monitor/health/route.ts .github/workflows/tibo-monitor-health.yml .github/workflows/notify-workflow-failures.yml tests/monitorHealth.test.ts tests/monitorWorkflow.test.ts docs/operations/tibo-monitor-runbook.md
git commit -m "feat: alert on CI and Tibo monitor failures"
```

### Final verification

- [ ] Confirm the working tree contains only the files listed above.
- [ ] Run the full local quality suite after all task commits.
- [ ] Inspect the final workflow diff for secret leakage and verify no raw error messages or authorization headers are emitted.
- [ ] Push the branch and confirm the CI workflow is queued on Node 22.13.0 or newer; the scheduled monitor workflow can be manually dispatched once `CRON_SECRET` is available.
