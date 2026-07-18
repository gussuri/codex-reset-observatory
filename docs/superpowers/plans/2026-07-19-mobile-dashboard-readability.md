# Mobile Dashboard Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the mobile dashboard header and top reset-history cards while preserving the desktop layout and all forecast behavior.

**Architecture:** Keep the existing `RadarDashboard` data flow and responsive breakpoint. Add mobile-only utility classes and a mobile summary presentation for dashboard history items; leave the full History page and desktop styles unchanged.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, existing Playwright CLI workflow.

## Global Constraints

- Apply visual changes below the existing `sm` breakpoint only.
- Keep the current routes, data model, forecast values, and history page unchanged.
- Keep seven history entries visible on mobile and the existing desktop count/presentation.
- Do not add dependencies or change the prediction logic.

### Task 1: Compact the mobile dashboard header

**Files:**
- Modify: `components/RadarDashboard.tsx` header classes only

**Steps:**

- Reduce only the base mobile padding, logo size, title size, and description spacing; retain the existing `sm:` and larger layout values.
- Keep the title on one line where it fits and allow the description to occupy at most two compact lines without horizontal overflow.
- Keep language links accessible below the identity block on narrow screens.
- Inspect the rendered header at 320px, 360px, and 390px widths for clipping and unintended PC changes.

### Task 2: Improve mobile top-history separation

**Files:**
- Modify: `components/RadarDashboard.tsx` dashboard history item markup/classes
- Modify: `components/ResetHistoryDetails.tsx` only if the dashboard summary needs a mobile-only detail switch

**Steps:**

- Keep the existing seven dashboard entries and full detail data.
- On mobile, give each repeated item a subtle background, border, and left accent with consistent internal padding.
- Separate the timestamp/source block from the detail block on mobile so the execution time is easy to scan.
- Hide only low-priority scope metadata in the dashboard mobile summary if needed; do not change the full History page output.
- Restore the existing unmodified presentation at `sm` and above with explicit responsive classes.

### Task 3: Verify the responsive result

**Files:**
- No additional source files

**Steps:**

- Run `npm test`, `npm run lint`, and `npm run build`.
- Start the local Next.js server and inspect `/` at 320x720, 360x800, 390x844, and 1280x720.
- Confirm the mobile header has no horizontal overflow, the history items are visually separated, and seven entries are present on mobile.
- Confirm the desktop header and existing three-entry presentation remain unchanged.
- Confirm `/history` still renders scope, notice-to-execution, and note details.
- Run `git diff --check` and report any known development-only console warnings separately.
