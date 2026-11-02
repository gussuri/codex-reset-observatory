# Sponsors One-Time Support and Survival v1 Restoration Implementation Plan

> **For agentic workers:** Execute inline in this worktree; no new chat or subagent. Use TDD for each behavior change. Publication remains on hold for Sol's review.

**Goal:** Add a clear one-time Sponsors option beside monthly support and prospectively restore the frozen Survival-Conditioned v1 public model without relabeling any prior forecast.

**Architecture:** Reuse the existing typed SponsorLink and the frozen `calculateSurvivalConditionedProbability` path. Give the restoration its own public period ID and forward boundary, while preserving the original v1 and v2 period boundaries and the existing public DTO shape. Carry the selected internal period into audit construction so the same v1 model identity can report the correct origin metadata.

**Tech Stack:** Next.js/React, TypeScript, Node test runner, Playwright, the existing generated probability-model registry.

**Spec:** `C:/Users/Yura/.codex/visualizations/2026/10/01/01a0f4fb-964b-74a2-a7ab-1884d0adfa92/sponsors-and-survival-20261103/spec.md`

## Global Constraints

- Monthly Sponsors tiers remain $2/$5/$10; the external one-time tiers are owned by Sol and are $2/$5/$10.
- The default SponsorLink URL remains `https://github.com/sponsors/gussuri`; one-time links use only `https://github.com/sponsors/gussuri?frequency=one-time`.
- Preserve the existing `sponsor_click` event and its `placement`, `locale`, and `page_type` properties; do not add analytics dimensions, dependencies, paid events, server writes, or arbitrary destinations.
- The original Survival v1 boundary stays `2026-09-19T06:00:00.000Z`; Adaptive v2 stays `2026-10-29T12:20:00.000Z`. Restoration starts at `2026-11-02T15:30:00.000Z` (2026-11-03 00:30 JST), the next 10-minute public calculation boundary after this task began.
- Keep the frozen v1 formula, support gate, official notice, ordinary/timed teaser policy, horizon coherence, BANKED eligibility, and reset clocks unchanged. Do not run model research or tune parameters.
- Do not rewrite snapshots, forecasts, canonical history, or old adoption metadata. Keep the public-v1 API shape unchanged; no database, schema, migration, new query, or forecast backfill.
- Do not commit, push, or publish until Sol completes the review and gives the release instruction.

## Review Focus

- A timestamp before, exactly at, or after the new boundary maps to the correct separate public period.
- A null restoration override continues the v2 period; malformed timestamps fail closed consistently.
- The restored public path does not call the v2 calculator and returns the frozen v1 calculation with its existing support and horizon rules.
- Historical v1 and v2 rows keep their original model identity, adoption time, previous model, and period.
- One-time and monthly Sponsor links use only the two fixed URLs, emit one unchanged low-cardinality event, and keep native navigation at 320px/375px.

---

### Task 1: One-time Sponsors links

**Files:**
- Modify: `components/SponsorLink.tsx`
- Modify: `components/SponsorSupportPanel.tsx`
- Modify: `components/AboutView.tsx`
- Modify: `lib/radar/i18n.ts`
- Test: `tests/sponsorLinks.test.ts`
- Test: `e2e/sponsor-support.spec.ts`

**Interfaces:**
- `SponsorLink` accepts only an optional typed `frequency` selecting `monthly` or `one-time`; omitted frequency preserves the current canonical URL.
- Translation keys distinguish the existing monthly primary CTA from the new one-time secondary CTA in JA/EN/ZH.

- [x] Write failing tests for exact monthly/one-time URLs, localized one-time copy, one event per link click, new-tab navigation, keyboard activation, and 320px/375px fit.
- [x] Run the focused tests and confirm failures are specifically due to the missing one-time option.
- [x] Add a fixed URL mapping in `SponsorLink`; add the one-time secondary link and concise one-time/monthly explanation in the panel and About page.
- [x] Run focused unit and Playwright tests; capture localized mobile/desktop screenshots outside the repository.

### Task 2: Prospective Survival v1 restoration

**Files:**
- Modify: `data/shadowProbabilityConfig.ts`
- Modify: `lib/radar/publishedProbability.ts`
- Modify: `lib/radar/prospectivePublishedModelEvaluation.ts`
- Test: `tests/publishedProbability.test.ts`
- Test: `tests/prospectivePublishedModelEvaluation.test.ts`

**Interfaces:**
- Add `survival-conditioned-v1-restored` as a separate `PublishedProbabilityPeriod`.
- Add `publishedSurvivalConditionedRestorationAt?: string | null`; omitted uses the committed boundary, `null` disables restoration.
- Preserve the existing `calculateSurvivalConditionedProbability` function and validity/fallback chain.

- [x] Add failing tests for before/at/after classification, null and invalid boundary behavior, historical boundary invariance, restored-v1 numerical parity, horizon coherence, and v2-calculator non-invocation after restoration.
- [x] Run the focused tests and confirm the new-period and selector assertions fail before implementation.
- [x] Add the forward boundary and current/previous model aliases; gate v2 to its original period and select v1 for the restored period.
- [x] Add the internal selected period to calculation results and make prospective evaluation start at the restoration boundary with v2 as its baseline.
- [x] Run focused probability, fallback, official-notice, teaser, and prospective-evaluation tests.

### Task 3: Registry and audit metadata

**Files:**
- Modify: `data/probabilityModelRegistry.ts`
- Modify: `lib/logProbability.ts`
- Modify: `docs/probability/published-model-governance.md`
- Modify: `docs/probability/next-generation-shadow-models.md`
- Generate: `docs/probability/model-registry.md`
- Test: `tests/probabilityModelRegistry.test.ts`
- Test: `tests/probabilityAudit.test.ts`
- Test: `tests/publishedModelGovernance.test.ts`
- Update: tests asserting the current/previous model pointers.

**Interfaces:**
- The original `survival-conditioned-v1` period ends at the unchanged Adaptive v2 boundary; v2 ends at restoration; the new restored-v1 period begins at restoration and is open-ended.
- V1 is the current public identity with its original and restored periods; v2 is the previous historical identity.
- Audit fields for an original v1 origin retain the September boundary and Broad-Banked v2 previous model. Restored-v1 origins use the new boundary and Adaptive v2 previous model.

- [x] Add failing registry and audit tests for disjoint v1 periods, v2 historical status, current/previous pointers, original-v2 metadata, restored-v1 metadata, and unchanged DTO keys.
- [x] Run the focused tests and confirm expected failures.
- [x] Update registry source, period notes, audit metadata, prospective governance narrative, and generated registry documentation.
- [x] Run registry generation/check and the focused model-governance tests.

### Task 4: Verification and review handoff

- [x] Run focused tests, then `pnpm test`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, `pnpm run models:registry:check`, and `git diff --check` in that order.
- [x] Review the full diff for historical adoption-boundary changes, added dependencies, API/DB scope drift, and event-property changes.
- [x] Report the worktree, branch, exact boundary in UTC/JST, changed files, tests, and screenshots to Sol; leave commit/push/release pending Sol's instruction.
