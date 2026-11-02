# Subtle Sponsors Presentation Implementation Plan

> **For agentic workers:** Execute inline in this worktree; no new chat or subagent. Use TDD for behavior changes. Sol reviews before release.

**Goal:** Replace the prominent and repeated sponsor CTAs with one neutral, clearly labeled GitHub Sponsors text link per support section.

**Architecture:** Keep the existing SponsorLink and click-tracking path, narrowed to the canonical Sponsors URL. Update localized copy and presentation in the home panel, About section, home header, and existing footers; preserve privacy disclosures and native outbound navigation.

**Tech Stack:** Next.js, React, TypeScript, Node test runner, Playwright.

**Spec:** `C:/Users/Yura/.codex/visualizations/2026/10/01/01a0f4fb-964b-74a2-a7ab-1884d0adfa92/sponsors-subtle-20261103/spec.md`

## Global Constraints

- Use only `https://github.com/sponsors/gussuri`; GitHub owns one-time and monthly tier selection.
- The home support section and About support section each contain one ordinary underlined text link.
- Remove the home header sponsor button; keep locale controls.
- Home support copy is factual and neutral, with exact Japanese title/body/link from the spec and concise equivalent English and Chinese.
- Existing sponsor click event, properties, optional GA behavior, privacy disclosures, and `_blank`/`noopener noreferrer` navigation remain intact.
- Footer sponsor links may stay but use the same weight and color treatment as adjacent footer links.
- Do not change tiers, model behavior, history, database/API behavior, dependencies, or GA registration.
- Do not commit, push, create a PR, or publish before Sol's review.

## Review Focus

- At 320px and 375px, the single link and copy fit without horizontal overflow.
- Home has no sponsor link in its header, and exactly one sponsor link in the panel.
- About has exactly one sponsor link in its support section.
- Sponsor navigation still works by keyboard and new tab when GA is absent or throws.
- Sponsor event properties and Google privacy destinations remain unchanged.

---

### Task 1: Make sponsor surfaces subtle and singular

**Files:**
- Modify: `components/RadarDashboard.tsx`
- Modify: `components/SponsorSupportPanel.tsx`
- Modify: `components/AboutView.tsx`
- Modify: `components/HistoryView.tsx`
- Modify: `components/FaqView.tsx`
- Modify: `components/SponsorLink.tsx`
- Modify: `lib/sponsorAnalytics.ts`
- Modify: `lib/radar/i18n.ts`
- Test: `tests/sponsorLinks.test.ts`
- Test: `e2e/sponsor-support.spec.ts`

**Interfaces:**
- `SponsorLink` uses the fixed `GITHUB_SPONSORS_URL`; callers cannot choose another frequency or destination.
- `trackSponsorClick(placement, locale, pageType)` remains unchanged.

- [x] Update unit assertions for exact JA/EN/ZH neutral copy, one canonical URL, no header CTA, and one link in each support section.
- [x] Update E2E assertions for one link, missing header CTA, localized copy, mobile fit, keyboard/new-tab navigation, unchanged events, and privacy links.
- [x] Run the focused unit and sponsor E2E tests and confirm failures are caused by the requested presentation change.
- [x] Remove frequency selection and stale one-time/header copy; implement neutral support cards, one underlined link, remove the home header CTA, and normalize footer link styles.
- [x] Run focused unit tests and sponsor E2E against the production server; save JA/EN/ZH home/About screenshots outside the repository at `C:/Users/Yura/.codex/visualizations/2026/11/03/sponsors-subtle-20261103/screenshots`.

### Task 2: Full local verification and handoff

- [x] Run `corepack pnpm test`, `corepack pnpm run lint`, `corepack pnpm run typecheck`, `corepack pnpm build`, `corepack pnpm run models:registry:check`, and `git diff --check` in that order; run the production E2E after build and before registry check.
- [x] Review the diff for unwanted changes to models, tiers, API/DB behavior, dependencies, GA, privacy copy, and analytics properties.
- [x] Report the worktree, branch, base commit, changed files, test results, and screenshots to Sol; leave release to Sol.
