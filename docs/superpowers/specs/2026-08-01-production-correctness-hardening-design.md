# Production Correctness Hardening Design

## Summary

This change hardens the first production-critical layer of Codex Reset Observatory without redesigning the prediction model or database schema. It makes official-notice behavior consistent across probability calculation and presentation, exposes degraded data sources instead of silently presenting them as low risk, removes known production dependency vulnerabilities, restores meaningful quality gates, and fixes the confirmed mobile and accessibility regressions.

## Goals

- A valid dynamic Tibo `official_notice` must drive the probability, notice card, reasoning text, and recommended action consistently.
- Supabase, OpenAI Status, and client-cache failures must be visible to users and machines.
- A failed live refresh must retain useful cached data while clearly marking it stale.
- Production dependency audit findings rated High must be eliminated.
- `lint`, whole-repository TypeScript checking, tests, and production build must all be enforced in CI.
- The English mobile dashboard must show the full outlook and likelihood text.
- Probability metrics must use valid definition-list semantics and accessible progress values.

## Non-goals

- Statistically calibrating the reset forecast or changing its numeric weights.
- Rebuilding the Supabase base schema or changing production tables.
- Reorganizing locale routes to remove request-time rendering.
- Removing the legacy X monitoring scripts.
- Redesigning the visual language of the dashboard.

## Approach

Use a compatibility-preserving implementation. Existing API fields and public routes remain valid. New health metadata is additive, and the existing local static signals continue to work. Shared selectors become the single source of truth for official-notice state, while source-specific fetch functions return typed results that preserve failure information.

## 1. Unified official-notice selection

Introduce a shared selector in the radar domain that accepts `RadarData` and returns a normalized active notice or `null`. It will:

1. Read dynamic `active_tibo_signals` entries classified as `official_notice` with confidence at least `0.95`.
2. Ignore rejected, expired, invalid-date, and pre-reset notices.
3. Read active local `LOCAL_OBSERVATION_SIGNALS` notices.
4. Normalize both sources into one shape containing title, summary text, observed time, expected time range, source URL, and source label.
5. Choose the newest valid notice by observation time.

Probability calculation, `getActiveWindow`, reasoning text, and recommended action will call this selector. No consumer may independently query only local official notices.

Dynamic notices do not currently contain a scheduled execution timestamp. Until that field is added to storage, their expiration time is used only to determine whether they remain active; the UI displays the source post time and omits a fabricated scheduled time.

## 2. Data-health contract

Add an optional `data_health` field to `RadarData`:

```ts
type DataSourceState = "ok" | "degraded" | "misconfigured";

type RadarDataHealth = {
  overall: "ok" | "degraded";
  checkedAt: string;
  sources: {
    supabaseSignals: { state: DataSourceState; detail?: string };
    openAIStatus: { state: DataSourceState; detail?: string };
  };
};
```

`detail` contains a stable, non-secret diagnostic code such as `missing_configuration`, `request_failed`, `invalid_response`, or `database_error`. Raw exception text, URLs containing credentials, and service-role keys are never serialized.

Supabase signal/history reads return a typed result containing both data and health state. OpenAI Status returns the stored fallback data together with a degraded state when both live endpoints fail. `fetchCurrentRadarData` combines these results and sets `overall` to `degraded` when any required source is not `ok`.

The public API continues returning HTTP 200 when usable fallback data exists. The additive health field tells clients that the estimate is incomplete. Unexpected failures that prevent creation of any radar data still return HTTP 500.

## 3. Client stale-data behavior

The dashboard load state gains `isStale` and `refreshError` fields.

- Successful live refresh: save the response, set `isStale=false`, and record the real fetch time.
- Live refresh failure with cached or server-rendered data: retain the data, set `isStale=true`, and show a warning.
- Live refresh failure with no usable data: show an unavailable state instead of a numeric estimate.
- Server response with `data_health.overall="degraded"`: show a source-degradation warning even though the refresh itself succeeded.

The current build-time-backed manual review timestamp is removed from the dashboard. The status area displays the actual successful fetch time and labels cached data as stale.

Warnings use localized Japanese, English, and Chinese copy. They do not expose internal errors or configuration names to ordinary users.

## 4. Dependency and package-manager hardening

- Upgrade `next` and `eslint-config-next` to a patched compatible release in the existing Next.js 15 line.
- Resolve vulnerable Sharp/libvips and PostCSS transitive versions with versions accepted by the updated Next.js release or explicit package-manager overrides.
- Pin the pnpm major/minor version through `packageManager` so local and CI installs use the same override semantics.
- Store pnpm overrides in the location supported by that pinned version and verify the resolved dependency tree, not only `package.json` ranges.
- Regenerate `pnpm-lock.yaml` with the pinned package manager.

Acceptance requires `pnpm audit --prod` to report zero High vulnerabilities. Moderate findings may remain only if no compatible patch exists; any such exception must be named in the implementation handoff.

## 5. Honest tests and CI

Replace the Heartbeat test's live DNS request with a pure payload-construction seam or injected persistence dependency. The test must assert the exact Supabase payload for the three page-reload fields and must fail if any field is omitted or renamed.

Fix the existing test type errors by using the actual `WindowEventLike` fields and by narrowing nullable reasoning text before string assertions. Add a `typecheck` package script using `tsc --noEmit`.

Add `.github/workflows/ci.yml` for pushes and pull requests with these ordered checks:

1. Frozen pnpm install using the pinned package-manager version.
2. Lint.
3. Whole-repository typecheck.
4. Test suite.
5. Production build.
6. Production dependency audit with High severity as the failure threshold.

Add regression tests proving that a dynamic official notice produces an active notice card, matching reasoning, and official-notice recommended action at the same time as the 90%/96% forecast.

## 6. Mobile and accessibility corrections

Remove the shared two-line clamp from the two dashboard headings that contain critical state:

- Current outlook and likelihood.
- Latest reset title.

Long recent-history titles may retain a bounded clamp because their full details are available on the history page.

Render the two probability metrics inside a `<dl>`. Each visual bar receives `role="progressbar"`, an accessible label, `aria-valuemin="0"`, `aria-valuemax="100"`, and the current percentage through `aria-valuenow`. Unknown probability omits `aria-valuenow` and uses an accessible unknown-state label.

## Error handling and observability

- Server logs retain actionable source-specific error context.
- API responses and browser warnings expose only stable diagnostic codes.
- Cache fallback never changes a source failure into an `ok` health state.
- A successful fallback response remains renderable and preserves the last known forecast.
- No secret values are read or printed by tests.

## Compatibility

- Existing API consumers can ignore `data_health`.
- Existing static signal data remains supported.
- Routes, locale URLs, Supabase tables, webhook request shapes, and prediction weights do not change.
- The change does not require a production database migration.

## Verification

Automated verification:

- Regression tests for unified dynamic notice behavior.
- Unit tests for healthy, failed, and misconfigured source health states.
- Client-state tests where practical for stale fallback decisions.
- Exact Heartbeat persistence-payload assertions without network access.
- i18n completeness checks for new warning copy.
- `pnpm lint`.
- `pnpm typecheck`.
- `pnpm test`.
- `pnpm build`.
- `pnpm audit --prod`.

Rendered verification:

- Japanese desktop dashboard loads without console errors.
- Header English navigation reaches `/en` with the correct title and document language.
- At a 390 x 844 viewport, current outlook, likelihood, and latest reset title are not clipped.
- Degraded and stale warnings are visible and do not displace the primary metrics beyond the first useful viewport.
- The page has no horizontal overflow.

## Delivery boundary

This implementation is complete when all acceptance checks above pass and the working tree contains only the intended source, test, configuration, documentation, and lockfile changes. Statistical calibration, base-schema migrations, route-group restructuring, and legacy-monitor removal remain separate follow-up projects.
