# EOD Reset Notices Implementation Plan

> **For agentic workers:** This plan is executed by the primary agent in the current session; Sol reviews the finished PR. The user requested no subagents.

**Goal:** Resolve clear reset-by-EOD notices from their source text and carry them through classification, webhook storage, and the existing public notice presentation without per-post exceptions.

**Architecture:** Add a narrowly scoped rule-classification fallback for explicit reset deadlines, and extend the existing deterministic temporal candidate parser to recognize only `by EOD`, `by end of day`, and `by end of the day`. Reuse the existing local-day resolver and public presentation path; preserve Gemini audit values and make ambiguous or contradictory schedules unresolved.

**Tech Stack:** TypeScript, Node test runner via `tsx`, Next.js webhook, existing temporal and public DTO helpers.

**Spec:** User-approved implementation request in the 2026-10-12 delegated message; `docs/reset-history-normalization.md`.

## Global Constraints

- Use the tweet creation instant and its source-local date; default timezone only when the source has none is `America/Los_Angeles`.
- EOD means next local midnight, never a business-hour time; do not add COB as a synonym.
- Invalid explicit timezones, conflicting schedules, and ambiguous source candidates remain unresolved.
- Keep Gemini classification/raw audit values separate from effective classification and resolved temporal fields.
- Do not alter event identity, scope, history count, execution time, production data, or prior completed notice state.
- Do not make live AI calls or update production/DB records.

## Review Focus

- A valid AI schedule that omits daypart must inherit the complete unambiguous source EOD candidate without changing raw audit fields.
- Missing or failed AI must still classify and resolve the explicit reset deadline through the existing rule fallback.
- Negated, hypothetical, historical, quoted-only, registration-only, cache/server, BANKED, multi-schedule, and OR alternatives must not become a global reset schedule.
- Explicit supported timezones must resolve as a single date/timezone/window tuple; invalid timezones must not fall back to Los Angeles.
- Only the unresolved-to-resolved notice path may affect notice visibility; already completed or consumed notices and their event identity remain unchanged.

---

### Task 1: Narrow EOD notice classification

**Files:**
- Modify: `lib/radar/classification.ts`
- Test: `tests/classification.test.ts`, `tests/tiboClassificationSafety.test.ts`

- [ ] Add tests for `Global reset by EOD.` as `official_notice`, including the existing negation, hypothetical, historical, non-usage, and BANKED boundaries.
- [ ] Run the focused tests and confirm the new EOD rule fails before implementation.
- [ ] Add only an explicit reset-execution-deadline rule path; retain normal Gemini-primary selection for successful AI classification.
- [ ] Run focused classification tests.

### Task 2: Deterministic EOD schedule candidate

**Files:**
- Modify: `lib/radar/tiboTemporal.ts`
- Test: `tests/tiboTemporal.test.ts`

- [ ] Add failing resolver tests for the supplied 2026-10-10T22:16:20Z sample across AI-complete, AI-daypart-missing, and AI-unavailable inputs; expect 2026-10-10T22:16:20Z through 2026-10-11T07:00:00Z in America/Los_Angeles.
- [ ] Add failing negative tests for invalid timezone, negative/hypothetical/past/quoted/registration-only/cross-sentence schedules, multiple deadlines and OR alternatives, cache/server reset, and BANKED completion.
- [ ] Implement source candidate extraction and strict candidate selection. Reject conflicting AI schedule fields rather than combining unrelated fields. Preserve unsupported explicit timezone text so resolution remains unresolved.
- [ ] Advance `TIBO_TEMPORAL_RESOLUTION_VERSION` to the next unused version and verify v7 history retains its existing interpretation.
- [ ] Run temporal resolver tests.

### Task 3: Webhook persistence and public presentation

**Files:**
- Modify only if needed: `app/api/webhook/tibo/route.ts`, public DTO/presentation modules.
- Test: `tests/tiboWebhookRoute.test.ts`, `tests/codexUsageMonitorAlone.test.ts` or the owning public snapshot suite.

- [ ] Add a failing webhook test for rule fallback and Gemini detail omission; assert effective classification, unchanged AI audit fields, resolved schedule fields/version, and midnight-based expiry.
- [ ] Verify the public snapshot shows an active official notice with its expected window and that a related completion consumes it; keep completed notice/event identity unchanged.
- [ ] Implement only missing integration behavior; reuse existing public presentation if it already meets the contract.
- [ ] Add/verify JA, EN, and ZH notice schedule summaries.

### Task 4: Verify and submit

**Files:**
- Review the complete diff; no production data or generated artifact changes.

- [ ] Run relevant focused suites, then `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
- [ ] Commit and push the finished feature branch; create and attach a separate PR.
- [ ] Report the PR/head SHA, verification, remaining risks, version decision, and unchanged Production state to Sol.
