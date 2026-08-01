# Production Correctness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make official-notice behavior internally consistent, expose degraded or stale data honestly, eliminate High production dependency findings, restore meaningful CI gates, and correct the confirmed mobile/accessibility regressions.

**Architecture:** Keep the existing routes and forecast weights, but introduce one normalized official-notice selector and one additive data-health contract. Fetch adapters preserve failure metadata, pure client-state helpers decide stale/degraded/unavailable presentation, and the dashboard consumes those shared decisions instead of inferring source state independently.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript 5, Tailwind CSS, Node test runner through `tsx`, Supabase JS, pnpm 11, GitHub Actions.

## Global Constraints

- Preserve all existing public routes, webhook request fields, Supabase table names, locale URLs, and probability weights.
- Do not add or run a database migration for this change.
- Treat `active_tibo_signals` as typed data; do not add new `any` casts around Tibo signals.
- Never serialize raw exceptions, request URLs containing credentials, service-role keys, or environment-variable values into `RadarData`.
- Keep fallback responses HTTP 200 only when a usable `RadarData` object can still be built.
- Follow red-green-refactor for every behavior change: first observe the named test fail for the expected reason, then write the smallest implementation, then rerun the focused test.
- Run `superpowers:systematic-debugging` before changing code in response to an unexpected failure.
- Do not update forecast weights, recalibrate probabilities, restructure locale routing, remove legacy monitoring scripts, or create the missing Supabase base schema in this implementation.
- Use `corepack pnpm` for every package command. Do not use `npm install` or create a second lockfile.

---

### Task 1: Use one official-notice selector everywhere

**Files:**

- Modify: `lib/radar/types.ts`
- Modify: `lib/radar/probability.ts`
- Modify: `lib/radar.ts`
- Modify: `lib/radarFetch.ts`
- Modify: `tests/probabilityIntegration.test.ts`

- [ ] **Step 1: Add the failing end-to-end regression test**

Extend `tests/probabilityIntegration.test.ts` with a test named `dynamic official notice drives probability, card, reason, and action together`. Build `RadarData` with an accepted `reset_executed` two hours ago and a non-rejected `official_notice` one hour ago, both with future expirations. Assert all of these in the same test:

```ts
assert.strictEqual(viewModel.probability24h, 0.9);
assert.strictEqual(viewModel.probability48h, 0.96);
assert.strictEqual(viewModel.activeWindow.active, true);
assert.strictEqual(viewModel.activeWindow.kind, "official");
assert.strictEqual(viewModel.activeWindow.source, noticeUrl);
assert.strictEqual(viewModel.activeWindow.openedAt, noticeCreatedAt);
assert.strictEqual(viewModel.activeWindow.expectedAt, null);
assert.match(viewModel.reasoningSummary ?? "", /official reset notice/i);
assert.match(viewModel.action, /official reset notice/i);
```

Also add focused selector cases for an expired notice, a rejected notice, and a notice older than the latest accepted reset. Each must return `null` even when its confidence is `0.95` or higher.

- [ ] **Step 2: Run the regression test and confirm the current contradiction**

Run:

```bash
corepack pnpm exec tsx --test --test-name-pattern "dynamic official notice|expired notice|rejected notice|older than" tests/probabilityIntegration.test.ts
```

Expected RED result: the probabilities are `0.90`/`0.96`, but `activeWindow.active` is `false`, the reasoning omits the notice, or the selector export does not yet exist. Do not proceed if the test fails for fixture syntax or an unrelated import error.

- [ ] **Step 3: Type dynamic Tibo signals at the domain boundary**

Move the shared shape into `lib/radar/types.ts` and add it to `RadarData`:

```ts
export type ActiveTiboSignal = {
  tweet_id: string;
  signal_type: "official_notice" | "reset_executed" | "teaser" | "irrelevant";
  text?: string;
  tweet_url?: string;
  tweet_created_at: string;
  detected_at?: string;
  expires_at?: string;
  verification_status?: "auto_unverified" | "confirmed" | "rejected";
  confidence?: number;
  classification_reason?: string;
  is_reply?: boolean;
  is_quote?: boolean;
};

export type RadarData = {
  // existing fields stay unchanged
  active_tibo_signals?: Array<ActiveTiboSignal>;
};
```

Import this type in `lib/radarFetch.ts` and remove its duplicate declaration. Change `getLocalRadarData` from `Array<any>` and the intersection return type to `RadarData["active_tibo_signals"]` and `RadarData`.

- [ ] **Step 4: Implement the normalized selector**

In `lib/radar/probability.ts`, export:

```ts
export type ActiveOfficialNotice = {
  origin: "dynamic" | "local";
  id: string;
  title: string | null;
  summary: string | null;
  observedAt: string;
  expectedAt: string | null;
  expectedEndAt: string | null;
  expiresAt: string | null;
  source: string | null;
  sourceLabel: string;
};

export function getActiveOfficialNotice(
  data: RadarData | null,
  latestResetAt: Date | null = getLastGlobalResetAt(data),
  now: Date = new Date(),
): ActiveOfficialNotice | null;
```

The selector must:

- Consider `active_tibo_signals` and `formal_tibo_resets` when finding the latest accepted `reset_executed` (`confidence >= 0.95`, not rejected, valid timestamp).
- Use the later of that execution and `latestResetAt` as the cutoff.
- Accept dynamic notices only when `signal_type === "official_notice"`, `confidence >= 0.95`, verification is not rejected, creation and expiration dates are valid, expiration is after `now`, and creation is after the cutoff.
- Normalize dynamic `text` as `title`/`summary`, `tweet_created_at` as `observedAt`, `tweet_url` as `source`, and use `Tibo (@tibo_maker)` as `sourceLabel`. Do not invent `expectedAt` from `expires_at`.
- Normalize active local official notices with their existing title, observed/expected times, source, and source label.
- Return the newest valid normalized notice by `observedAt`, or `null`.

Extend `getEffectiveSignalStatus(signal, now = new Date())` and `isCurrentLocalSignal(signal, now = new Date())` with an optional clock and pass the selector's `now` through them. Existing callers keep their current behavior, while selector tests remain deterministic.

- [ ] **Step 5: Replace all local-only notice decisions**

Compute the normalized notice once in `getRadarViewModel` using `signalEvaluation.latestResetAt`, and pass it through the probability, expectation, active-window, reasoning, and action paths. Extend internal function signatures rather than recomputing with different clocks:

```ts
const activeOfficialNotice = getActiveOfficialNotice(
  source,
  signalEvaluation.latestResetAt,
);

const probability24h = getProbability(source, "24h", signalEvaluation, activeOfficialNotice);
const activeWindow = getDisplayResetNotice(getActiveWindow(activeOfficialNotice, locale));
```

Extend `getLocalResetProbability` and `getLocalProbabilityReason` with a final parameter whose default is `getActiveOfficialNotice(data, signalEvaluation.latestResetAt)`: `activeOfficialNotice: ActiveOfficialNotice | null`. The probability function enters official-notice mode when it is non-null, and the reason function returns the localized official-notice explanation from the same value. `getLocalExpectationLevel` and the private `getProbability` wrapper must pass that argument through. `getRecommendedAction` must receive the already-built active window and must not call `getActiveWindow` again. Extend `isUSWeekendCalmPeriod(data, now, activeOfficialNotice)` so the already-selected dynamic notice also disables weekend suppression without a second lookup.

Remove `hasOfficialNoticeWithinHours` if it has no remaining caller. Verify with:

```bash
rg -n 'getLatestActiveLocalSignal\("official_notice"\)' lib
```

Expected result: only the normalized selector may inspect local official notices directly.

- [ ] **Step 6: Run focused and adjacent tests**

Run:

```bash
corepack pnpm exec tsx --test tests/probabilityIntegration.test.ts
corepack pnpm exec tsx --test tests/statusIncidentEvaluation.test.ts tests/tiboFormalHistory.test.ts
```

Expected GREEN result: the dynamic notice simultaneously drives `0.90`/`0.96`, the official card, official reasoning, and official action; invalid notices remain inactive; existing static notice behavior still passes.

- [ ] **Step 7: Commit the notice consistency change**

```bash
git add lib/radar/types.ts lib/radar/probability.ts lib/radar.ts lib/radarFetch.ts tests/probabilityIntegration.test.ts
git commit -m "fix: unify official notice state"
```

---

### Task 2: Preserve source failure information in `RadarData`

**Files:**

- Create: `lib/radar/dataHealth.ts`
- Create: `tests/dataHealth.test.ts`
- Create: `tests/openaiStatusHealth.test.ts`
- Modify: `lib/radar/types.ts`
- Modify: `lib/openaiStatus.ts`
- Modify: `lib/radarFetch.ts`
- Modify: `lib/radar.ts`

- [ ] **Step 1: Write failing data-health contract tests**

In `tests/dataHealth.test.ts`, cover all required source states and aggregation rules:

```ts
assert.deepStrictEqual(getRequiredConfigurationHealth([undefined, "key"]), {
  state: "misconfigured",
  detail: "missing_configuration",
});

assert.strictEqual(
  createRadarDataHealth(checkedAt, okHealth, degradedHealth).overall,
  "degraded",
);

assert.strictEqual(
  combineDataSourceHealth(okHealth, misconfiguredHealth).state,
  "misconfigured",
);
```

The precedence must be `misconfigured` over `degraded` over `ok`; `overall` is `degraded` whenever either required source is non-`ok`.

In `tests/openaiStatusHealth.test.ts`, pass a fetch implementation that rejects both status requests. Assert that stored history remains available and health is `{ state: "degraded", detail: "request_failed" }`. Add a non-JSON two-response case with `detail: "invalid_response"`, a one-success/one-failure case with `detail: "partial_response"`, and a two-success case with `state: "ok"`.

- [ ] **Step 2: Run the new tests and confirm the missing contract**

Run:

```bash
corepack pnpm exec tsx --test tests/dataHealth.test.ts tests/openaiStatusHealth.test.ts
```

Expected RED result: the new types/helpers do not exist and `fetchOpenAIStatusSignals` returns data without health.

- [ ] **Step 3: Add the additive health types**

Add to `lib/radar/types.ts`:

```ts
export type DataSourceState = "ok" | "degraded" | "misconfigured";
export type DataSourceDetail =
  | "missing_configuration"
  | "request_failed"
  | "invalid_response"
  | "database_error"
  | "partial_response";

export type DataSourceHealth = {
  state: DataSourceState;
  detail?: DataSourceDetail;
};

export type DataFetchResult<T> = {
  data: T;
  health: DataSourceHealth;
};

export type RadarDataHealth = {
  overall: "ok" | "degraded";
  checkedAt: string;
  sources: {
    supabaseSignals: DataSourceHealth;
    openAIStatus: DataSourceHealth;
  };
};
```

Add `data_health?: RadarDataHealth` to `RadarData`.

- [ ] **Step 4: Implement pure health aggregation**

In `lib/radar/dataHealth.ts`, export these exact helpers:

```ts
export const OK_DATA_SOURCE: DataSourceHealth = { state: "ok" };

export function getRequiredConfigurationHealth(
  values: Array<string | undefined>,
): DataSourceHealth;

export function getDatabaseReadHealth(
  configuration: DataSourceHealth,
  result: { hasData: boolean; hasError: boolean },
): DataSourceHealth;

export function combineDataSourceHealth(
  ...sources: Array<DataSourceHealth>
): DataSourceHealth;

export function createRadarDataHealth(
  checkedAt: string,
  supabaseSignals: DataSourceHealth,
  openAIStatus: DataSourceHealth,
): RadarDataHealth;
```

Return only the stable diagnostic codes declared above. Do not accept arbitrary strings for `detail`.

`getDatabaseReadHealth` returns the configuration error first, then `degraded/database_error` for a query error, `degraded/invalid_response` for a null result without a reported query error, and `ok` for a non-null result (including an intentionally empty array). Cover all four branches in `tests/dataHealth.test.ts`.

- [ ] **Step 5: Make OpenAI Status return data plus health**

Change `fetchOpenAIStatusSignals` to:

```ts
export async function fetchOpenAIStatusSignals(
  options: FetchOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<DataFetchResult<OpenAIStatusSignals>>;
```

Pass `fetchImpl` into `fetchStatusJson` so tests do not replace global `fetch`. Internally distinguish non-2xx/network failure (`request_failed`) from a non-JSON or malformed response (`invalid_response`). Return:

- both live responses usable: live data and `ok`;
- exactly one usable: the best partial live/fallback merge and `degraded/partial_response`;
- neither usable: `getStoredStatusSignals()` and `degraded` with the most specific failure code.

Keep source-specific error context in server logs, but never include raw error messages in the returned health object.

- [ ] **Step 6: Make Supabase reads return data plus health**

In `lib/radarFetch.ts`, change both cached raw readers to return `DataFetchResult<Array<...>>` and use `getRequiredConfigurationHealth` plus `getDatabaseReadHealth` for the normal/query-error paths. Missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` returns an empty array with `misconfigured/missing_configuration`. A Supabase query error returns `degraded/database_error`; a null result without an error returns `degraded/invalid_response`; a thrown request failure returns `degraded/request_failed`.

Create one internal bundle function so `fetchCurrentRadarData` consumes the recent and history snapshots once:

```ts
type TiboSignalBundle = {
  activeSignals: Array<ActiveTiboSignal>;
  formalResets: Array<FormalTiboResetSignal>;
  rejectedResets: Array<RejectedTiboResetSignal>;
  health: DataSourceHealth;
};
```

Keep the existing exported array-returning helpers compatible by extracting `.data` from the bundle. Dynamic expiration filtering stays outside `unstable_cache`.

- [ ] **Step 7: Attach health to the API model**

Extend `getLocalRadarData` with `checkedAt?: string` and `dataHealth?: RadarDataHealth`; default `checkedAt` to a new ISO timestamp when direct callers omit it. In `fetchCurrentRadarData`, create one `checkedAt` value, use it for both `RadarData.checked_at` and `RadarDataHealth.checkedAt`, combine Supabase and OpenAI health via `createRadarDataHealth`, and pass both arguments into `getLocalRadarData`. The returned object must include `data_health` without removing or renaming existing fields.

- [ ] **Step 8: Run focused tests and an API model smoke test**

Run:

```bash
corepack pnpm exec tsx --test tests/dataHealth.test.ts tests/openaiStatusHealth.test.ts
corepack pnpm exec tsx --test tests/statusIncidentEvaluation.test.ts tests/tiboFormalHistory.test.ts
```

Expected result: all focused and adjacent tests pass, fallback history is retained, and health never becomes `ok` after a failed live read.

- [ ] **Step 9: Commit the server health contract**

```bash
git add lib/radar/dataHealth.ts lib/radar/types.ts lib/openaiStatus.ts lib/radarFetch.ts lib/radar.ts tests/dataHealth.test.ts tests/openaiStatusHealth.test.ts
git commit -m "feat: expose radar data health"
```

---

### Task 3: Make stale, degraded, and unavailable states visible

**Files:**

- Create: `lib/radar/clientState.ts`
- Create: `tests/clientState.test.ts`
- Modify: `components/RadarDashboard.tsx`
- Modify: `lib/radar/i18n.ts`
- Modify: `tests/i18nCompleteness.test.ts`
- Delete: `data/manualReviewStatus.ts`

- [ ] **Step 1: Write failing pure state-transition tests**

In `tests/clientState.test.ts`, define and test this public client-state seam:

```ts
export type RadarLoadState = {
  data: RadarData | null;
  fetchedAt: string | null;
  isStale: boolean;
  refreshError: "request_failed" | null;
};

export type DashboardDataState = "ready" | "degraded" | "stale" | "unavailable";
```

Test that `applyRefreshSuccess(data, fetchedAt)` clears stale/error state; `applyRefreshFailure(current, cached)` retains current server-rendered data ahead of an older cache, falls back to cached data only when current data is absent, and marks the result stale; failure without any data is unavailable; and presentation precedence is `unavailable` → `stale` → `degraded` → `ready`.

- [ ] **Step 2: Run the client-state tests and confirm the seam is absent**

Run:

```bash
corepack pnpm exec tsx --test tests/clientState.test.ts
```

Expected RED result: `lib/radar/clientState.ts` and its exports do not exist.

- [ ] **Step 3: Implement the pure state helpers**

Create `lib/radar/clientState.ts` with:

```ts
export function applyRefreshSuccess(
  data: RadarData,
  fetchedAt: string,
): RadarLoadState;

export function applyRefreshFailure(
  current: RadarLoadState,
  cached: CachedRadarData | null,
): RadarLoadState;

export function getDashboardDataState(
  state: RadarLoadState,
): DashboardDataState;
```

`refreshError` is a stable code, never an `Error` object or raw message.
When both current and cached data exist, preserve `current.data` and `current.fetchedAt`; do not replace a server-rendered snapshot with an unversioned localStorage entry.

- [ ] **Step 4: Add complete localized warning copy**

Add Japanese, English, and Chinese values for these keys in `UI_TRANSLATIONS`:

- `staleDataWarning`: live refresh failed; the last successful result is being shown.
- `degradedDataWarning`: some live sources are unavailable; the estimate may be incomplete.
- `dataUnavailable`: live or cached data is unavailable; probability values are hidden.
- `lastSuccessfulRefresh`: label for the real successful fetch timestamp.
- `unknownProbability`: accessible text for an unknown metric.
- `noticePostedAt`: label for a dynamic official notice's source-post time when no execution time is available.

Use this exact copy:

```ts
staleDataWarning: {
  ja: "最新データの取得に失敗したため、最後に取得できた結果を表示しています。",
  en: "Live refresh failed. Showing the last successfully fetched result.",
  zh: "实时更新失败，当前显示上次成功获取的结果。",
},
degradedDataWarning: {
  ja: "一部のライブ情報源を取得できていないため、見積もりが不完全な可能性があります。",
  en: "Some live sources are unavailable, so this estimate may be incomplete.",
  zh: "部分实时数据源暂不可用，因此当前估算可能不完整。",
},
dataUnavailable: {
  ja: "ライブデータも保存済みデータも取得できません。確率表示を一時停止しています。",
  en: "Live and cached data are unavailable. Probability values are temporarily hidden.",
  zh: "实时数据和缓存数据均不可用，概率数值已暂时隐藏。",
},
lastSuccessfulRefresh: {
  ja: "最終取得成功時刻",
  en: "Last successful refresh",
  zh: "上次成功更新时间",
},
unknownProbability: { ja: "不明", en: "Unknown", zh: "未知" },
noticePostedAt: { ja: "予告投稿時刻", en: "Notice posted", zh: "预告发布时间" },
```

Extend `tests/i18nCompleteness.test.ts` to iterate these six keys and assert every locale value is non-empty. English values must contain no Japanese characters.

- [ ] **Step 5: Integrate state transitions and warnings in the dashboard**

Replace the local `LoadState` with `RadarLoadState`. Initialize `isStale: false` and `refreshError: null`. On live success call `applyRefreshSuccess`; on failure call `applyRefreshFailure` using localStorage data.

Compute `dashboardDataState = getDashboardDataState(state)` and render one compact banner before the official-notice card:

- `role="status"` for `stale` and `degraded`;
- `role="alert"` for `unavailable`;
- no banner for `ready`.

When unavailable, pass `undefined` to both probability metrics, display `translateUI("unknownProbability", locale)` as the expectation, and omit the numeric reasoning. Do not let `getRadarViewModel(null)` create apparently live numbers in the visible UI.

Remove the `MANUAL_REVIEW_STATUS` import. Replace the bottom timestamp with `state.fetchedAt` and the `lastSuccessfulRefresh` label. If no fetch ever succeeded, render the existing unknown date behavior rather than the module build time.

Keep cache persistence best-effort: after a successful response, update state with `applyRefreshSuccess` even if `localStorage.setItem` throws. Wrap only the cache write in its own `try`/`catch`; a storage quota/privacy error must not relabel successfully fetched live data as stale.

- [ ] **Step 6: Run client and translation tests**

Run:

```bash
corepack pnpm exec tsx --test tests/clientState.test.ts tests/i18nCompleteness.test.ts
rg -n "MANUAL_REVIEW_STATUS|manualReviewStatus" components lib app data --glob '!data/manualReviewStatus.ts'
```

Expected GREEN result: all state transitions and translations pass, and the `rg` command has no output. Delete `data/manualReviewStatus.ts` after removing its sole dashboard import.

- [ ] **Step 7: Commit the honest client-state behavior**

```bash
git add components/RadarDashboard.tsx lib/radar/clientState.ts lib/radar/i18n.ts tests/clientState.test.ts tests/i18nCompleteness.test.ts data/manualReviewStatus.ts
git commit -m "fix: surface stale and degraded radar data"
```

---

### Task 4: Replace the Heartbeat network illusion with payload tests

**Files:**

- Create: `lib/radar/heartbeat.ts`
- Modify: `app/api/webhook/tibo/heartbeat/route.ts`
- Modify: `tests/heartbeatApiReloadFields.test.ts`

- [ ] **Step 1: Replace the permissive test with exact failing assertions**

Rewrite `tests/heartbeatApiReloadFields.test.ts` to import `buildHeartbeatRecord` rather than `POST`. Assert the complete persistence record for:

- same session: count increments, gap seconds update, max gap is preserved or increased;
- new session: start time/count/gaps reset;
- snake_case reload fields;
- camelCase reload aliases;
- snake_case values winning when both forms are supplied.

The primary assertion must include:

```ts
assert.deepStrictEqual(payload, {
  id: "main",
  session_id: "test-session-789",
  session_started_at: existing.session_started_at,
  last_heartbeat_at: now.toISOString(),
  last_successful_parse_at: "2026-07-31T23:00:00.000Z",
  last_seen_tweet_id: "tweet-789",
  last_scan_error: null,
  selector_version: "v1.4-extension",
  last_page_reload_at: "2026-07-31T22:30:00.000Z",
  last_page_reload_status: "success",
  last_page_reload_error: null,
  heartbeat_count: 8,
  max_gap_seconds: 300,
  last_gap_seconds: 300,
  updated_at: now.toISOString(),
});
```

Do not set `SUPABASE_URL` and do not catch a failed assertion.

- [ ] **Step 2: Run the test and confirm the builder is missing**

Run:

```bash
corepack pnpm exec tsx --test tests/heartbeatApiReloadFields.test.ts
```

Expected RED result: `buildHeartbeatRecord` is not exported because the route currently constructs the payload inline.

- [ ] **Step 3: Extract a pure payload builder**

Create typed `HeartbeatRequestBody`, `ExistingHeartbeatRecord`, and `HeartbeatRecord` interfaces in `lib/radar/heartbeat.ts`. Implement:

```ts
export function buildHeartbeatRecord(
  body: HeartbeatRequestBody,
  existing: ExistingHeartbeatRecord | null,
  now: Date,
): HeartbeatRecord;
```

Preserve the current default values and session/gap behavior exactly. Normalize `sessionId` to `default_session` before comparing it with the existing session. Use nullish checks for reload aliases so an intentional empty string is not replaced accidentally.

Update the route to authenticate and read Supabase as before, call the builder, upsert its return value, and derive response counts from that record. Persistence remains inside the route; construction remains network-free.

- [ ] **Step 4: Run the exact and full test files**

Run:

```bash
corepack pnpm exec tsx --test tests/heartbeatApiReloadFields.test.ts
corepack pnpm test
```

Expected GREEN result: the Heartbeat test completes without DNS access and fails if any reload field is omitted or renamed.

- [ ] **Step 5: Commit the Heartbeat seam**

```bash
git add lib/radar/heartbeat.ts app/api/webhook/tibo/heartbeat/route.ts tests/heartbeatApiReloadFields.test.ts
git commit -m "test: verify heartbeat persistence payload"
```

---

### Task 5: Correct probability semantics and mobile clipping

**Files:**

- Create: `components/ProbabilityMetrics.tsx`
- Create: `tests/dashboardPresentation.test.ts`
- Modify: `components/RadarDashboard.tsx`

- [ ] **Step 1: Write failing semantic-render tests**

In `tests/dashboardPresentation.test.ts`, use `React.createElement` and `renderToStaticMarkup` so the file can remain `.test.ts`. Import `ProbabilityMetrics` and assert:

```ts
assert.match(html, /^<dl\b/);
assert.strictEqual((html.match(/role="progressbar"/g) ?? []).length, 2);
assert.match(html, /aria-label="Within 24 hours"/);
assert.match(html, /aria-valuemin="0"/);
assert.match(html, /aria-valuemax="100"/);
assert.match(html, /aria-valuenow="23"/);
```

Add an unknown-value case asserting that `aria-valuenow` is absent and localized `aria-valuetext` is present.

In the same file, server-render `RadarDashboard` with a valid dynamic notice that has `openedAt` but no scheduled execution time. Assert the rendered English dashboard contains `Notice posted` and does not label the post's expiration as `Estimated reset window`.

- [ ] **Step 2: Run the presentation test and confirm the component is absent**

Run:

```bash
corepack pnpm exec tsx --test tests/dashboardPresentation.test.ts
```

Expected RED result: `components/ProbabilityMetrics.tsx` does not exist.

- [ ] **Step 3: Extract valid metric markup**

Move the metric/tone/bar-width code from `RadarDashboard.tsx` into `components/ProbabilityMetrics.tsx`. Export:

```ts
export function ProbabilityMetrics({
  locale,
  probability24h,
  probability48h,
}: {
  locale: Locale;
  probability24h: number | undefined;
  probability48h: number | undefined;
})
```

Return a `<dl className="mt-5 grid grid-cols-2 gap-3">` containing the two metric groups. Give each visual bar `role="progressbar"`, its translated metric label, min/max 0/100, and rounded percentage via `aria-valuenow`. For an unknown value, omit `aria-valuenow` and set `aria-valuetext={translateUI("unknownProbability", locale)}`.

Replace the dashboard's orphaned `dt`/`dd` markup with this component.

- [ ] **Step 4: Run the dashboard timing test and observe the remaining RED behavior**

Run:

```bash
corepack pnpm exec tsx --test tests/dashboardPresentation.test.ts
```

Expected RED result after the metric extraction: the dynamic notice still renders the scheduled-reset label with an unknown value instead of its source-post time.

- [ ] **Step 5: Render dynamic notice time without fabricating a schedule**

In the official-notice details block in `RadarDashboard.tsx`, use `scheduledResetTime` and `expectedAt` only when `expectedAt` is present. Otherwise use `noticePostedAt` and `openedAt`. Render `expectedEndAt` only in the scheduled-time branch. Keep the existing source row in both branches.

Rerun `tests/dashboardPresentation.test.ts`; expected result is GREEN for definition-list semantics, ARIA values, unknown values, and dynamic notice timing.

- [ ] **Step 6: Record the current mobile clipping as the visual RED check**

Start the development server in a background terminal and inspect `/en` at 390 × 844:

```bash
corepack pnpm dev
```

Measure the two critical headings in the browser. Before the class change, at least one has `scrollHeight > clientHeight`; this reproduces the already observed clipping of `Unscheduled reset probability / Likelihood` and the latest reset title. Stop the server after recording the values.

- [ ] **Step 7: Remove the critical two-line clamps**

Remove `ui-heading` from only these two `<h2>` elements in `RadarDashboard.tsx`:

- the current outlook/likelihood heading;
- the latest reset title.

Keep `ui-heading` on recent-history `<h3>` elements. Set the two critical headings to the exact wrapping classes `leading-tight break-words text-balance`; retain their existing margin, size, weight, and color classes. Do not globally remove the history clamp.

- [ ] **Step 8: Run semantic tests and the visual GREEN check**

Run:

```bash
corepack pnpm exec tsx --test tests/dashboardPresentation.test.ts
corepack pnpm lint
```

Restart `corepack pnpm dev`, reload `/en` at 390 × 844, and verify for both critical headings:

```js
element.scrollHeight === element.clientHeight
```

Also verify `document.documentElement.scrollWidth === document.documentElement.clientWidth` and that the accessibility tree exposes two progressbars with names and current values.
Stop the development server after this check.

- [ ] **Step 9: Commit the mobile/accessibility corrections**

```bash
git add components/ProbabilityMetrics.tsx components/RadarDashboard.tsx tests/dashboardPresentation.test.ts
git commit -m "fix: improve dashboard mobile accessibility"
```

---

### Task 6: Make whole-repository type checking pass

**Files:**

- Modify: `tests/i18nCompleteness.test.ts`
- Modify: `tests/probabilityIntegration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Reproduce the seven known type errors**

Run the compiler directly without invoking an install:

```bash
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

Expected RED result: four invalid `WindowEventLike.resetAt/note` accesses, one nullable i18n summary use, and two nullable `englishReason` uses.

- [ ] **Step 2: Fix tests against the real types**

In `tests/i18nCompleteness.test.ts`, identify history rows with `history.id ?? history.title`, read dates from `completed_at ?? closed_at ?? opened_at`, and read the note from `history.details?.note`. Narrow nullable strings with `assert.ok(enSummary)` before regex calls.

In `tests/probabilityIntegration.test.ts`, use `assert.ok(englishReason)` before `.includes` assertions. Do not cast nullable values to `string` and do not weaken `strict` compiler settings.

- [ ] **Step 3: Add the package typecheck script**

Add to `package.json`:

```json
"typecheck": "tsc --noEmit --pretty false"
```

- [ ] **Step 4: Run typecheck and the affected tests**

Run:

```bash
corepack pnpm typecheck
corepack pnpm exec tsx --test tests/i18nCompleteness.test.ts tests/probabilityIntegration.test.ts
```

Expected GREEN result: zero TypeScript errors and both test files pass.

- [ ] **Step 5: Commit the type-safety gate**

```bash
git add package.json tests/i18nCompleteness.test.ts tests/probabilityIntegration.test.ts
git commit -m "test: enforce repository type checking"
```

---

### Task 7: Upgrade vulnerable production dependencies with pinned pnpm semantics

**Files:**

- Modify: `package.json`
- Create: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Record the failing production audit**

Run:

```bash
corepack pnpm audit --prod --audit-level high
```

Expected RED result: High findings include vulnerable Next 15.5.18 and Sharp/libvips resolution; the command exits non-zero. Save the package/advisory names in the task notes, not raw environment data.

- [ ] **Step 2: Pin the verified package versions**

Update `package.json` to use the registry-verified versions:

```json
"packageManager": "pnpm@11.18.0",
"dependencies": {
  "next": "15.5.21"
},
"devDependencies": {
  "eslint-config-next": "15.5.21",
  "postcss": "^8.5.18"
}
```

Remove the ignored top-level `pnpm.overrides` object from `package.json`. Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "."

overrides:
  postcss: ^8.5.18
  sharp: 0.35.0
```

- [ ] **Step 3: Regenerate the lockfile using only the pinned manager**

Run:

```bash
corepack prepare pnpm@11.18.0 --activate
corepack pnpm install --lockfile-only
corepack pnpm install --frozen-lockfile
```

Confirm that install output no longer warns that `pnpm.overrides` is ignored.

- [ ] **Step 4: Verify the resolved dependency tree and audit**

Run:

```bash
corepack pnpm list next eslint-config-next postcss sharp --depth 10
corepack pnpm why postcss
corepack pnpm why sharp
corepack pnpm audit --prod --audit-level high
```

Expected GREEN result: Next resolves to `15.5.21`, PostCSS is at least `8.5.18`, Sharp is `0.35.0`, and the High-threshold production audit exits zero. If the override is incompatible and install/build fails, stop and use `superpowers:systematic-debugging`; do not suppress the advisory or add `--ignore-registry-errors`.

- [ ] **Step 5: Run the post-upgrade quality suite**

Run:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Expected GREEN result: all four commands exit zero on the upgraded tree.

- [ ] **Step 6: Commit package hardening**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "fix: patch production dependencies"
```

---

### Task 8: Add CI gates in the same order used locally

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a failing structural test for the workflow contract**

Create `tests/ciWorkflow.test.ts`. Read `.github/workflows/ci.yml` and assert that it contains push and pull-request triggers plus these commands in this order:

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`
6. `pnpm audit --prod --audit-level high`

Also assert `permissions: contents: read` and Node 20. This is a repository-policy test, so direct file inspection is the behavior under test.

- [ ] **Step 2: Run the test and confirm CI is absent**

Run:

```bash
corepack pnpm exec tsx --test tests/ciWorkflow.test.ts
```

Expected RED result: `.github/workflows/ci.yml` does not exist.

- [ ] **Step 3: Create the CI workflow**

Create `.github/workflows/ci.yml` with this structure and command order:

```yaml
name: CI

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Enable pinned pnpm
        run: |
          corepack enable
          corepack prepare pnpm@11.18.0 --activate
      - run: corepack pnpm install --frozen-lockfile
      - run: corepack pnpm lint
      - run: corepack pnpm typecheck
      - run: corepack pnpm test
      - run: corepack pnpm build
      - run: corepack pnpm audit --prod --audit-level high
```

Use the `packageManager` pin; do not install an unpinned global pnpm.

- [ ] **Step 4: Run the policy test and validate YAML through GitHub-compatible parsing**

Run:

```bash
corepack pnpm exec tsx --test tests/ciWorkflow.test.ts
corepack pnpm typecheck
```

Expected GREEN result: the workflow contract test and repository typecheck pass. Inspect the final YAML to ensure the key is written as `pull_request`, not a quoted or misspelled variant.

- [ ] **Step 5: Commit CI**

```bash
git add .github/workflows/ci.yml tests/ciWorkflow.test.ts
git commit -m "ci: enforce production quality gates"
```

---

### Task 9: Verify the complete user-visible story

**Files:**

- Modify only files required to fix failures discovered by the checks below

- [ ] **Step 1: Run every automated acceptance gate from a clean dependency tree**

Run in this order:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm audit --prod --audit-level high
git diff --check
```

Record the test count, build result, and remaining Moderate audit findings, if any. A High finding is a release blocker.

- [ ] **Step 2: Verify notice consistency with the regression fixture**

Rerun:

```bash
corepack pnpm exec tsx --test --test-name-pattern "dynamic official notice drives" tests/probabilityIntegration.test.ts
```

Confirm one dynamic notice produces `0.90`/`0.96`, an official active card, official reasoning, and official recommended action in the same view model.

- [ ] **Step 3: Perform rendered desktop and locale verification**

Start the production server and use the browser verification skill:

```bash
corepack pnpm start
```

Verify the Japanese root loads without console errors. Follow the header English link and confirm the URL is `/en`, the page title is English, and the root content has `lang="en"`.

- [ ] **Step 4: Perform rendered mobile and data-warning verification**

At 390 × 844 on `/en`, verify:

- current outlook and likelihood are fully visible;
- latest reset title is fully visible;
- no horizontal overflow exists;
- two named progressbars expose correct current values;
- a degraded fixture shows the localized degraded banner while retaining metrics;
- a stale cached fixture shows the localized stale banner and the last successful fetch time;
- an unavailable fixture shows no numeric probabilities.

Use browser request interception or a temporary in-memory response fixture; do not edit committed production data merely to trigger these states.

- [ ] **Step 5: Inspect the intended diff only**

Run:

```bash
git status --short
git diff --stat 7c8150d..HEAD
git log --oneline -10
```

Confirm the diff contains only source, tests, workflow, package metadata, lockfile, and the approved design/plan documentation. Do not include screenshots, `.next`, environment files, or local caches.

- [ ] **Step 6: Request code review and apply only verified findings**

Use `superpowers:requesting-code-review` against base commit `7c8150d`. If the active collaboration policy does not allow a reviewer subagent, perform the same review inline. If review finds a concrete defect, reproduce it with a failing test before fixing it. Rerun the full acceptance sequence after any code change.

- [ ] **Step 7: Complete verification before claiming success**

Use `superpowers:verification-before-completion`. Report exact command outcomes, any remaining Moderate-only audit advisories, and the rendered mobile/locale results. Do not claim completion from an earlier run made before the final edit.
