# Tibo Android Notification Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-cost, notification-driven pipeline that safely publishes explicit Tibo reset notices and completed resets while the operator is asleep.

**Architecture:** The official X Android notification is forwarded by Automate to an authenticated Next.js route. The route triggers a serialized GitHub Actions workflow that applies deterministic rules plus optional Gemini structured classification, updates automation-owned JSON, runs verification, commits to `main`, and lets Vercel deploy the result.

**Tech Stack:** Next.js 15 App Router, TypeScript, Node test runner through `tsx`, GitHub Actions, Gemini Developer API over `fetch`, Automate for Android, static JSON data.

## Global Constraints

- Do not poll or scrape X.
- Do not use the X API.
- Publish only an explicit reset notice or explicit reset completion.
- A missing execution time must not prevent an otherwise explicit notice.
- Gemini may enrich or confirm a classification, but an ambiguous Gemini-only result must not publish.
- Do not infer target scope, reset method, reason, timezone, or exact execution time.
- Do not rewrite TypeScript data files with regular expressions.
- Do not resolve unrelated active observation signals.
- Keep all secrets out of repository files and public workflow logs.
- Keep the existing forecast weights, URLs, SEO, Supabase schema, and manual history records unchanged.
- Use the existing `node:test` and `tsx` test stack; add no test framework.
- Use `gemini-2.5-flash-lite` as the default configurable model because it has a free tier and structured output support.
- Treat free-tier Gemini input as eligible for provider product improvement under Google's free-tier terms.

---

## File Structure

### New files

- `data/tiboAutomation.json`: automation-owned state, signals, provisional reset events, dedupe keys, and review records.
- `lib/tiboAutomation/types.ts`: semantic types shared by classification, persistence, workflow processing, and runtime adapters.
- `lib/tiboAutomation/state.ts`: state parsing, validation, pruning, hashing, and idempotent update helpers.
- `lib/tiboAutomation/classifier.ts`: deterministic Japanese and English classifier plus publication adjudication.
- `lib/tiboAutomation/gemini.ts`: bounded Gemini structured-output client and response parser.
- `lib/tiboAutomation/processor.ts`: converts a validated notification and classification into the next automation state.
- `lib/tiboAutomation/localData.ts`: adapts automation JSON into the radar's signal and reset-history types.
- `lib/tiboAutomation/receiver.ts`: receiver payload validation and GitHub dispatch helper.
- `app/api/tibo-notification/route.ts`: authenticated notification receiver.
- `scripts/process-tibo-notification.ts`: GitHub Actions entry point that classifies and writes JSON.
- `.github/workflows/process-tibo-notification.yml`: event-driven verification, commit, and push workflow.
- `tests/tiboAutomation.test.ts`: state, classifier, processor, Gemini parser, and adapter tests.
- `tests/tiboNotificationReceiver.test.ts`: receiver validation and GitHub dispatch tests.
- `docs/tibo-android-setup.md`: exact Automate, Android, secret, dry-run, and activation steps.

### Modified files

- `package.json`: run all `tests/*.test.ts` files.
- `data/observationSignals.ts`: allow optional semantic display keys on signals.
- `lib/radar/types.ts`: carry semantic display keys and provisional timestamp basis through the view model.
- `lib/radar/i18n.ts`: add fixed translations for automated notice/history text and provisional timestamp labels.
- `lib/radar.ts`: consume combined manual and automated data and display provisional completion time honestly.
- `lib/radar/probability.ts`: use the same combined data for probability, recency, signals, and reasoning.
- `components/RadarDashboard.tsx`: use the provisional reset label supplied by the view model.
- `components/HistoryView.tsx`: use the provisional reset label supplied by the view model.
- `README.md` or `docs/tibo-android-setup.md` only: document required environment variables; do not expose values.

---

### Task 1: Automation State Schema and Safe Persistence

**Files:**
- Create: `data/tiboAutomation.json`
- Create: `lib/tiboAutomation/types.ts`
- Create: `lib/tiboAutomation/state.ts`
- Create: `tests/tiboAutomation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `TiboNotificationPayload`, `RuleClassification`, `GeminiClassification`, `PublicationDecision`, `TiboAutomationState`
- Produces: `parseTiboAutomationState(value)`, `buildTiboEventKey(payload)`, `pruneTiboAutomationState(state)`
- Consumes: no application runtime state

- [ ] **Step 1: Expand the test script and write failing schema tests**

Change the test script to:

```json
"test": "tsx --test tests/*.test.ts"
```

Create tests covering the initial state, malformed entries, deterministic event
keys, and bounded arrays:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTiboEventKey,
  parseTiboAutomationState,
  pruneTiboAutomationState,
} from "../lib/tiboAutomation/state";
import type { TiboNotificationPayload } from "../lib/tiboAutomation/types";

const payload: TiboNotificationPayload = {
  packageName: "com.twitter.android",
  title: "Tibo (@thsottiaux)",
  message: "I will reset Codex usage limits.",
  notificationId: "42",
  notificationWhen: "2026-07-30T15:00:00.000Z",
  receivedAt: "2026-07-30T15:00:05.000Z",
  extras: {},
};

test("creates the empty versioned state", () => {
  const state = parseTiboAutomationState({
    schemaVersion: 1,
    processedEvents: [],
    signals: [],
    resetEvents: [],
    pendingReviews: [],
  });

  assert.equal(state.schemaVersion, 1);
});

test("builds a stable event key", () => {
  assert.equal(buildTiboEventKey(payload), buildTiboEventKey(payload));
  assert.notEqual(
    buildTiboEventKey(payload),
    buildTiboEventKey({ ...payload, message: "Different message" }),
  );
});

test("bounds processed and pending records", () => {
  const state = parseTiboAutomationState({
    schemaVersion: 1,
    processedEvents: Array.from({ length: 250 }, (_, index) => ({
      eventKey: `event-${index}`,
      processedAt: "2026-07-30T15:00:00.000Z",
    })),
    signals: [],
    resetEvents: [],
    pendingReviews: Array.from({ length: 80 }, (_, index) => ({
      eventKey: `pending-${index}`,
      observedAt: "2026-07-30T15:00:00.000Z",
      category: "uncertain",
      reason: "test",
      title: "Tibo",
      message: "test",
    })),
  });

  const pruned = pruneTiboAutomationState(state);
  assert.equal(pruned.processedEvents.length, 200);
  assert.equal(pruned.pendingReviews.length, 50);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm test
```

Expected: FAIL because the automation modules and expanded test target do not
exist.

- [ ] **Step 3: Define semantic types**

Define these discriminated values and records in
`lib/tiboAutomation/types.ts`:

```ts
export type TiboClassificationCategory =
  | "reset_notice"
  | "reset_completed"
  | "incident_hint"
  | "irrelevant"
  | "uncertain";

export type TiboScope =
  | "all_paid_plans"
  | "all_users"
  | "specific_users"
  | "unknown";

export type TiboResetMethod =
  | "forced"
  | "banked_reset"
  | "unknown";

export type TiboResetReason =
  | "compensation"
  | "celebration"
  | "regular"
  | "other"
  | "unknown";

export type TiboNotificationPayload = {
  packageName: string;
  title: string;
  message: string;
  notificationId: string;
  notificationWhen: string;
  receivedAt: string;
  extras: Record<string, unknown>;
};

export type RuleClassification = {
  category: TiboClassificationCategory;
  explicitResetStatement: boolean;
  lexicalGatePassed: boolean;
  negatedOrHypothetical: boolean;
  temporalText: string | null;
  expectedAt: string | null;
  expectedEndAt: string | null;
  evidence: string | null;
};

export type GeminiClassification = RuleClassification & {
  confidence: number;
  scope: TiboScope;
  resetMethod: TiboResetMethod;
  reason: TiboResetReason;
};

export type PublicationDecision = {
  action: "publish_notice" | "publish_completion" | "hold" | "ignore";
  category: TiboClassificationCategory;
  reason: string;
  temporalText: string | null;
  expectedAt: string | null;
  expectedEndAt: string | null;
  scope: TiboScope;
  resetMethod: TiboResetMethod;
  resetReason: TiboResetReason;
  confidence: number;
};
```

Define `TiboAutomationState` with `schemaVersion: 1`, arrays named exactly
`processedEvents`, `signals`, `resetEvents`, and `pendingReviews`, plus stable
`sourceEventKey` fields on signals and resets. Completed resets must include:

```ts
effectiveAt: string;
timeBasis: "exact" | "announcement_upper_bound";
```

- [ ] **Step 4: Implement state parsing, hashing, and pruning**

Use `node:crypto` SHA-256 over normalized stable fields:

```ts
const raw = [
  payload.packageName,
  payload.notificationId,
  payload.notificationWhen,
  payload.title.normalize("NFC"),
  payload.message.normalize("NFC"),
].join("\n");

return createHash("sha256").update(raw).digest("hex");
```

Reject invalid schema versions and invalid required ISO dates. Preserve unknown
optional fields only inside the raw `extras` object. Prune to:

```ts
const MAX_PROCESSED_EVENTS = 200;
const MAX_PENDING_REVIEWS = 50;
const MAX_AUTOMATED_SIGNALS = 50;
const MAX_AUTOMATED_RESETS = 100;
```

Create `data/tiboAutomation.json`:

```json
{
  "schemaVersion": 1,
  "processedEvents": [],
  "signals": [],
  "resetEvents": [],
  "pendingReviews": []
}
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
pnpm test
```

Expected: PASS for the new state tests and all existing tests.

- [ ] **Step 6: Commit the schema**

```bash
git add package.json data/tiboAutomation.json lib/tiboAutomation/types.ts lib/tiboAutomation/state.ts tests/tiboAutomation.test.ts
git commit -m "feat: add Tibo automation state schema"
```

---

### Task 2: Deterministic Japanese and English Classifier

**Files:**
- Create: `lib/tiboAutomation/classifier.ts`
- Modify: `tests/tiboAutomation.test.ts`

**Interfaces:**
- Consumes: `TiboNotificationPayload`, `GeminiClassification`
- Produces: `classifyTiboNotification(payload, now?)`
- Produces: `decideTiboPublication(rule, gemini)`
- Produces: `normalizeNotificationText(value)`

- [ ] **Step 1: Write failing explicit, negative, and no-time tests**

Add table-driven cases:

```ts
test("classifies explicit reset notices without requiring a time", () => {
  for (const message of [
    "Codexの利用上限をリセットします。",
    "Codexの利用上限リセットを行います。",
    "Codex usage limits will be reset.",
    "We will reset Codex usage limits.",
  ]) {
    const result = classifyTiboNotification({ ...payload, message });
    assert.equal(result.category, "reset_notice", message);
    assert.equal(result.explicitResetStatement, true, message);
  }
});

test("classifies explicit completed resets", () => {
  for (const message of [
    "Codexの利用上限をリセットしました。",
    "I've reset usage limits for all Codex users.",
    "Codex usage limits have been reset.",
  ]) {
    assert.equal(
      classifyTiboNotification({ ...payload, message }).category,
      "reset_completed",
    );
  }
});

test("does not publish negated or hypothetical reset language", () => {
  for (const message of [
    "We will not reset usage limits.",
    "We are not planning a reset.",
    "リセットは行いません。",
    "We might reset limits if the issue continues.",
  ]) {
    const result = classifyTiboNotification({ ...payload, message });
    assert.equal(result.explicitResetStatement, false, message);
  }
});

test("does not treat the word reset alone as an announcement", () => {
  const result = classifyTiboNotification({
    ...payload,
    message: "Here is an explanation of how usage limit reset works.",
  });
  assert.notEqual(result.category, "reset_notice");
});
```

Add tests for invisible BiDi characters, repeated whitespace, `within 24 hours`,
and a future timestamp being rejected when it is more than seven days from the
notification time.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm test
```

Expected: FAIL because classifier exports do not exist.

- [ ] **Step 3: Implement normalization and lexical gates**

Normalize with:

```ts
export function normalizeNotificationText(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
```

Require both a reset expression and a Codex/usage-limit context expression.
Check negation and hypothetical markers before future/completed patterns.
Keep pattern groups named and short; do not build a single opaque expression.

- [ ] **Step 4: Implement bounded temporal extraction**

Parse only:

- `within N hours` / `N時間以内`
- an ISO timestamp with an explicit `Z` or numeric offset
- a Gemini-provided exact timestamp later in Task 3

For `within N hours`, set only `expectedEndAt` to notification time plus `N`
hours. For `today`, `later today`, `tomorrow`, and their Japanese equivalents,
store only `temporalText`; do not invent a timezone or exact timestamp.

- [ ] **Step 5: Implement publication adjudication**

Use these rules:

```ts
if (rule.explicitResetStatement && !rule.negatedOrHypothetical) {
  return rule.category === "reset_completed"
    ? explicitCompletionDecision
    : explicitNoticeDecision;
}

if (
  gemini &&
  gemini.explicitResetStatement &&
  gemini.lexicalGatePassed &&
  !gemini.negatedOrHypothetical &&
  gemini.confidence >= 0.95 &&
  gemini.evidence &&
  normalizedInput.includes(normalizeNotificationText(gemini.evidence))
) {
  return gemini.category === "reset_completed"
    ? geminiCompletionDecision
    : gemini.category === "reset_notice"
      ? geminiNoticeDecision
      : heldDecision;
}

return heldOrIgnoredDecision;
```

Gemini may add scope, method, reason, and temporal fields to an already explicit
rule result, but it must not change `reset_notice` into `reset_completed` or the
reverse when the rule layer is explicit.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 7: Commit the deterministic classifier**

```bash
git add lib/tiboAutomation/classifier.ts tests/tiboAutomation.test.ts
git commit -m "feat: classify explicit Tibo reset posts"
```

---

### Task 3: Gemini Structured Classification

**Files:**
- Create: `lib/tiboAutomation/gemini.ts`
- Modify: `tests/tiboAutomation.test.ts`

**Interfaces:**
- Consumes: validated `TiboNotificationPayload`
- Produces: `classifyTiboWithGemini(payload, options)`
- Produces: `parseGeminiClassification(value, payload)`
- Uses: injected `fetch` for tests

- [ ] **Step 1: Write failing Gemini response tests**

Cover valid JSON, invalid JSON, HTTP 429, timeout, evidence not present in the
input, confidence outside `0..1`, and an unsupported enum:

```ts
test("parses a bounded Gemini classification", () => {
  const result = parseGeminiClassification(
    {
      category: "reset_notice",
      explicitResetStatement: true,
      lexicalGatePassed: true,
      negatedOrHypothetical: false,
      temporalText: null,
      expectedAt: null,
      expectedEndAt: null,
      evidence: "will reset Codex usage limits",
      confidence: 0.98,
      scope: "unknown",
      resetMethod: "unknown",
      reason: "unknown",
    },
    { ...payload, message: "We will reset Codex usage limits." },
  );

  assert.equal(result.category, "reset_notice");
  assert.equal(result.confidence, 0.98);
});

test("returns null for malformed Gemini output", () => {
  assert.equal(parseGeminiClassification({ category: "invented" }, payload), null);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test
```

Expected: FAIL because the Gemini module does not exist.

- [ ] **Step 3: Implement the Gemini request**

Call:

```text
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

Use the `x-goog-api-key` header so the key is not placed in the URL. Default:

```ts
const model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
```

Use `responseMimeType: "application/json"` and a response schema containing
only the fields in `GeminiClassification`. Set temperature to `0`, cap output,
and apply a 10-second abort timeout.

The prompt must state:

```text
Classify only the notification text supplied below.
Do not use outside knowledge.
Do not infer a reset, target, method, reason, timezone, or exact time.
An explicit future reset and an explicit completed reset are different.
Return uncertain when the statement is negated, hypothetical, quoted, or incomplete.
The evidence must be a short exact substring of the notification.
```

- [ ] **Step 4: Fail closed without breaking explicit rule matches**

Return `null` for missing keys, HTTP errors, timeouts, blocked output, malformed
JSON, schema violations, or evidence not present in the normalized input. Do not
retry across multiple model names. The caller will retain the deterministic
result.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit Gemini enrichment**

```bash
git add lib/tiboAutomation/gemini.ts tests/tiboAutomation.test.ts
git commit -m "feat: add guarded Gemini Tibo classification"
```

---

### Task 4: Idempotent Notification Processor

**Files:**
- Create: `lib/tiboAutomation/processor.ts`
- Modify: `tests/tiboAutomation.test.ts`

**Interfaces:**
- Consumes: `processTiboNotification({ payload, state, gemini, now, publish })`
- Produces: `{ state, decision, changed }`
- Uses: state helpers and classifier from Tasks 1-3

- [ ] **Step 1: Write failing processor tests**

Add tests asserting:

```ts
test("publishes a no-time explicit notice", () => {
  const result = processTiboNotification({
    payload: { ...payload, message: "We will reset Codex usage limits." },
    state: emptyState(),
    gemini: null,
    now: new Date("2026-07-30T15:00:05.000Z"),
    publish: true,
  });

  assert.equal(result.decision.action, "publish_notice");
  assert.equal(result.state.signals.length, 1);
  assert.equal(result.state.signals[0].expectedAt, null);
  assert.equal(
    result.state.signals[0].expiresAt,
    "2026-08-01T03:00:00.000Z",
  );
});

test("publishes a provisional completion without inventing details", () => {
  const result = processTiboNotification({
    payload: { ...payload, message: "I've reset Codex usage limits." },
    state: emptyState(),
    gemini: null,
    now: new Date("2026-07-30T15:00:05.000Z"),
    publish: true,
  });

  const reset = result.state.resetEvents[0];
  assert.equal(reset.timeBasis, "announcement_upper_bound");
  assert.equal(reset.scope, "unknown");
  assert.equal(reset.resetMethod, "unknown");
  assert.equal(reset.reason, "unknown");
});

test("resolves only the linked active notice", () => {
  const firstNoticePayload = {
    ...payload,
    notificationId: "notice-1",
    notificationWhen: "2026-07-30T13:00:00.000Z",
    message: "We will reset Codex usage limits.",
  };
  const secondNoticePayload = {
    ...payload,
    notificationId: "notice-2",
    notificationWhen: "2026-07-30T14:00:00.000Z",
    message: "We will reset Codex usage limits again.",
  };
  const completionPayload = {
    ...payload,
    notificationId: "completion-1",
    notificationWhen: "2026-07-30T15:00:00.000Z",
    message: "I've reset Codex usage limits.",
  };

  const first = processTiboNotification({
    payload: firstNoticePayload,
    state: emptyState(),
    gemini: null,
    now: new Date("2026-07-30T13:00:05.000Z"),
    publish: true,
  });
  const second = processTiboNotification({
    payload: secondNoticePayload,
    state: first.state,
    gemini: null,
    now: new Date("2026-07-30T14:00:05.000Z"),
    publish: true,
  });
  const completed = processTiboNotification({
    payload: completionPayload,
    state: second.state,
    gemini: null,
    now: new Date("2026-07-30T15:00:05.000Z"),
    publish: true,
  });

  assert.equal(completed.state.signals.length, 2);
  assert.equal(completed.state.signals[0].status, "active");
  assert.equal(completed.state.signals[1].status, "resolved");
  assert.equal(
    completed.state.resetEvents[0].linkedNoticeId,
    completed.state.signals[1].id,
  );
});

test("does not publish the same notification twice", () => {
  const first = processTiboNotification({
    payload,
    state: emptyState(),
    gemini: null,
    now: new Date("2026-07-30T15:00:05.000Z"),
    publish: true,
  });
  const duplicate = processTiboNotification({
    payload,
    state: first.state,
    gemini: null,
    now: new Date("2026-07-30T15:01:00.000Z"),
    publish: true,
  });

  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.state.signals.length, first.state.signals.length);
  assert.equal(
    duplicate.state.processedEvents.length,
    first.state.processedEvents.length,
  );
});

test("holds explicit output while dry-run mode is enabled", () => {
  const result = processTiboNotification({
    payload,
    state: emptyState(),
    gemini: null,
    now: new Date("2026-07-30T15:00:05.000Z"),
    publish: false,
  });

  assert.equal(result.state.signals.length, 0);
  assert.equal(result.state.resetEvents.length, 0);
  assert.equal(result.state.pendingReviews.length, 1);
  assert.equal(result.state.pendingReviews[0].category, "reset_notice");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test
```

Expected: FAIL because processor exports do not exist.

- [ ] **Step 3: Implement notice publication**

Create an automated signal with:

```ts
{
  id: `auto-tibo-notice-${eventKey.slice(0, 12)}`,
  sourceEventKey: eventKey,
  observedAt: payload.notificationWhen,
  expectedAt: decision.expectedAt,
  expectedEndAt: decision.expectedEndAt,
  expiresAt: decision.expectedEndAt ?? addHours(payload.notificationWhen, 36),
  status: "active",
  sourceUrl: extractSafeXUrl(payload.extras) ?? "https://x.com/thsottiaux",
  temporalText: decision.temporalText,
}
```

Only accept `https://x.com/thsottiaux/status/...` or
`https://twitter.com/thsottiaux/status/...` from extras. Otherwise use the
profile URL.

- [ ] **Step 4: Implement completion publication**

Set `effectiveAt` to the notification/post timestamp and
`timeBasis: "announcement_upper_bound"` unless a trusted exact time was
explicitly present. Link completion to the newest automation notice whose
source lineage or normalized announcement context matches; never alter manual
signals or unrelated automated signals.

Add a processed key after every handled notification. Add uncertain and
irrelevant events to bounded `pendingReviews`; mark irrelevant records with
category `irrelevant`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit the processor**

```bash
git add lib/tiboAutomation/processor.ts tests/tiboAutomation.test.ts
git commit -m "feat: process Tibo notification decisions"
```

---

### Task 5: Merge Automated Data into Forecast and History

**Files:**
- Create: `lib/tiboAutomation/localData.ts`
- Modify: `data/observationSignals.ts`
- Modify: `lib/radar/types.ts`
- Modify: `lib/radar/i18n.ts`
- Modify: `lib/radar.ts`
- Modify: `lib/radar/probability.ts`
- Modify: `components/RadarDashboard.tsx`
- Modify: `components/HistoryView.tsx`
- Modify: `tests/tiboAutomation.test.ts`
- Modify: `tests/statusIncidentEvaluation.test.ts`

**Interfaces:**
- Produces: `ALL_LOCAL_OBSERVATION_SIGNALS`
- Produces: `ALL_LOCAL_RESET_HISTORY`
- Produces: semantic-key-aware view-model fields
- Consumes: validated `data/tiboAutomation.json`

- [ ] **Step 1: Write failing adapter and forecast tests**

Test an automated notice adapter:

```ts
test("adapts an automated notice without localized source text", () => {
  const signals = getAutomatedObservationSignals(stateWithNotice);
  assert.equal(signals[0].type, "official_notice");
  assert.equal(signals[0].titleKey, "automatedTiboResetNoticeTitle");
  assert.equal(signals[0].expectedAt, undefined);
});
```

Test an automated completion adapter:

```ts
test("adapts a provisional reset for probability without claiming exact time", () => {
  const history = getAutomatedResetHistory(stateWithCompletion);
  assert.equal(history[0].completed_at, "2026-07-30T15:00:00.000Z");
  assert.equal(history[0].resetTimeBasis, "announcement_upper_bound");
  assert.equal(history[0].details?.scope, "不明");
  assert.equal(history[0].details?.resetMethod, "不明");
});
```

Add a probability regression test proving an automated completion becomes the
latest global reset anchor, and a regression test proving an automated active
notice is the same notice used by probability and reason text.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test
```

Expected: FAIL because combined data exports do not exist.

- [ ] **Step 3: Implement the JSON adapter and combined lists**

In `lib/tiboAutomation/localData.ts`, import and validate the static JSON once:

```ts
import rawAutomationState from "@/data/tiboAutomation.json";
import { LOCAL_OBSERVATION_SIGNALS } from "@/data/observationSignals";
import { LOCAL_RESET_HISTORY } from "@/data/resetHistory";

const automationState = parseTiboAutomationState(rawAutomationState);

export const ALL_LOCAL_OBSERVATION_SIGNALS = [
  ...LOCAL_OBSERVATION_SIGNALS,
  ...getAutomatedObservationSignals(automationState),
];

export const ALL_LOCAL_RESET_HISTORY = [
  ...LOCAL_RESET_HISTORY,
  ...getAutomatedResetHistory(automationState),
];
```

Map semantic unknown values to the existing canonical short labels (`不明`,
`全有料プラン`, `強制リセット`, and so on) only in this adapter. Do not store
those localized labels in JSON.

- [ ] **Step 4: Add semantic display keys**

Add optional fields:

```ts
titleKey?: keyof typeof UI_TRANSLATIONS;
summaryKey?: keyof typeof UI_TRANSLATIONS;
sourceLabelKey?: keyof typeof UI_TRANSLATIONS;
resetTimeBasis?: "exact" | "announcement_upper_bound";
```

Avoid an import cycle by exporting a `UITranslationKey` type from
`lib/radar/i18n.ts` or by defining the finite automation display-key union in
`lib/radar/types.ts`.

Add fixed translations:

```ts
automatedTiboResetNoticeTitle: {
  ja: "Tibo氏によるCodexリセット予告",
  en: "Codex reset notice from Tibo",
  zh: "Tibo 发布的 Codex 重置预告",
},
automatedTiboResetCompletedTitle: {
  ja: "Codex利用上限リセット",
  en: "Codex usage limits reset",
  zh: "Codex 使用限制重置",
},
announcementUpperBoundResetLabel: {
  ja: "発表時点までに実施",
  en: "Completed by announcement time",
  zh: "截至公告时已执行",
},
```

Add equally short semantic summary and source-label keys.

- [ ] **Step 5: Replace direct manual-array reads**

In `lib/radar.ts` and `lib/radar/probability.ts`, replace every operational
read of `LOCAL_OBSERVATION_SIGNALS` and `LOCAL_RESET_HISTORY` with
`ALL_LOCAL_OBSERVATION_SIGNALS` and `ALL_LOCAL_RESET_HISTORY`.

This includes:

- latest active notice
- event boosts
- signal environment counts
- model-updated timestamp
- recent seven-day reset count
- last global reset
- combined history
- active hint and reason text
- latest regular or forced reset reference

Keep manual exports unchanged for external compatibility.

- [ ] **Step 6: Preserve provisional time semantics in the UI**

When mapping history, select:

```ts
resetLabel:
  item.resetTimeBasis === "announcement_upper_bound"
    ? translateUI("announcementUpperBoundResetLabel", locale)
    : isPendingNotice
      ? translateDynamic("実施予定", locale)
      : translateDynamic("実施", locale)
```

`RadarDashboard.tsx` and `HistoryView.tsx` already render `item.resetLabel`;
ensure no component replaces it with a fixed label.

Do not let an unknown automated method/scope update the weekly reference.
Only the existing explicit forced/regular plus all-paid-plan rule may do so.

- [ ] **Step 7: Run unit, lint, and build checks**

Run:

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: all pass.

- [ ] **Step 8: Commit runtime integration**

```bash
git add data/observationSignals.ts lib/tiboAutomation/localData.ts lib/radar/types.ts lib/radar/i18n.ts lib/radar.ts lib/radar/probability.ts components/RadarDashboard.tsx components/HistoryView.tsx tests/tiboAutomation.test.ts tests/statusIncidentEvaluation.test.ts
git commit -m "feat: merge automated Tibo events into radar"
```

---

### Task 6: Authenticated Receiver and GitHub Dispatch

**Files:**
- Create: `lib/tiboAutomation/receiver.ts`
- Create: `app/api/tibo-notification/route.ts`
- Create: `tests/tiboNotificationReceiver.test.ts`

**Interfaces:**
- Produces: `validateTiboReceiverPayload(value, now)`
- Produces: `dispatchTiboNotification(payload, config, fetchImpl)`
- Consumes: `TiboNotificationPayload`

- [ ] **Step 1: Write failing receiver tests**

Cover:

- correct payload
- wrong package
- title without `Tibo` or `@thsottiaux`
- missing message
- body fields over the length limit
- invalid date
- more than 48 hours old
- more than five minutes in the future
- encoded GitHub payload with no raw shell interpolation
- GitHub non-204 response

Example:

```ts
test("rejects notifications not issued by the X Android package", () => {
  assert.throws(
    () =>
      validateTiboReceiverPayload(
        { ...payload, packageName: "example.attacker" },
        new Date("2026-07-30T15:01:00.000Z"),
      ),
    /package/,
  );
});

test("dispatches one encoded client payload field", async () => {
  let requestBody: unknown;
  const fetchImpl: typeof fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(null, { status: 204 });
  };

  await dispatchTiboNotification(payload, config, fetchImpl);
  assert.deepEqual(Object.keys((requestBody as any).client_payload), ["payload"]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test
```

Expected: FAIL because receiver exports do not exist.

- [ ] **Step 3: Implement pure receiver validation**

Set explicit limits:

```ts
const MAX_TITLE_LENGTH = 300;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_EXTRAS_BYTES = 8_000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
```

Require `packageName === "com.twitter.android"` and a normalized title
containing `Tibo` or `@thsottiaux`. Return a newly allocated object containing
only allowed fields.

- [ ] **Step 4: Implement GitHub dispatch**

Require:

```ts
type GitHubDispatchConfig = {
  repository: string;
  token: string;
  eventType: "tibo_notification";
};
```

Send:

```json
{
  "event_type": "tibo_notification",
  "client_payload": {
    "payload": "<base64url-encoded validated JSON>"
  }
}
```

Use `Authorization: Bearer ...`, `Accept: application/vnd.github+json`, and a
fixed API version header. Treat only `204` as success.

- [ ] **Step 5: Implement the App Router endpoint**

The route must:

```ts
export const dynamic = "force-dynamic";
```

Return `401` for a missing/wrong `Authorization: Bearer
${TIBO_NOTIFICATION_SECRET}`, `400` for validation errors, `502` for GitHub
dispatch failures, and `202` with `{ ok: true }` after a successful dispatch.

Require environment variables:

- `TIBO_NOTIFICATION_SECRET`
- `GITHUB_TIBO_DISPATCH_TOKEN`
- `GITHUB_REPOSITORY`

Do not log the authorization header, GitHub token, or full payload.

- [ ] **Step 6: Run tests, lint, and build**

Run:

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: all pass.

- [ ] **Step 7: Commit the receiver**

```bash
git add lib/tiboAutomation/receiver.ts app/api/tibo-notification/route.ts tests/tiboNotificationReceiver.test.ts
git commit -m "feat: receive Android Tibo notifications"
```

---

### Task 7: Event-Driven GitHub Actions Processor

**Files:**
- Create: `scripts/process-tibo-notification.ts`
- Create: `.github/workflows/process-tibo-notification.yml`
- Modify: `tests/tiboAutomation.test.ts`

**Interfaces:**
- Consumes: `TIBO_NOTIFICATION_PAYLOAD_B64`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `TIBO_AUTOMATION_PUBLISH`
- Writes: only `data/tiboAutomation.json`
- Produces: process exit `0` for published, held, ignored, or duplicate valid events; nonzero for malformed input/write failure

- [ ] **Step 1: Add a failing script-level state update test**

Extract and test:

```ts
export async function processEncodedNotification(options: {
  encodedPayload: string;
  state: TiboAutomationState;
  geminiApiKey?: string;
  geminiModel?: string;
  publish: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<ProcessTiboNotificationResult>;
```

Assert invalid base64, oversized decoded input, duplicate events, Gemini
failure with an explicit deterministic notice, and dry-run behavior.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test
```

Expected: FAIL because the script function does not exist.

- [ ] **Step 3: Implement the script**

Read and parse `data/tiboAutomation.json`, call Gemini at most once, adjudicate,
process, prune, and write formatted JSON with a trailing newline only when
`changed` is true:

```ts
await writeFile(
  statePath,
  `${JSON.stringify(nextState, null, 2)}\n`,
  "utf8",
);
```

Print only a small result object:

```ts
{
  action: result.decision.action,
  category: result.decision.category,
  changed: result.changed,
  eventKey: result.eventKey.slice(0, 12),
}
```

Never print notification text or Gemini credentials.

- [ ] **Step 4: Add the repository-dispatch workflow**

Use:

```yaml
name: Process Tibo notification

on:
  repository_dispatch:
    types: [tibo_notification]

permissions:
  contents: write

concurrency:
  group: tibo-notification-main
  cancel-in-progress: false
```

Workflow steps:

1. Checkout `main`.
2. Set up the repository's Node version and pnpm.
3. Run `pnpm install --frozen-lockfile`.
4. Run the processing script with the encoded payload in an environment
   variable.
5. Run `pnpm test`, `pnpm lint`, and `pnpm build`.
6. Check whether `data/tiboAutomation.json` changed.
7. Commit exactly that file as `chore: process Tibo notification`.
8. Pull with rebase and push `main`.

Use:

```yaml
env:
  TIBO_NOTIFICATION_PAYLOAD_B64: ${{ github.event.client_payload.payload }}
  GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  GEMINI_MODEL: ${{ vars.GEMINI_MODEL || 'gemini-2.5-flash-lite' }}
  TIBO_AUTOMATION_PUBLISH: ${{ vars.TIBO_AUTOMATION_PUBLISH || 'false' }}
```

Do not use `set -x`, print the environment, or interpolate decoded text into a
shell command.

- [ ] **Step 5: Run local verification**

Run:

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: all pass.

Inspect the workflow syntax and verify only the default-branch workflow can be
triggered and that public runner logs contain no notification text.

- [ ] **Step 6: Commit workflow automation**

```bash
git add scripts/process-tibo-notification.ts .github/workflows/process-tibo-notification.yml tests/tiboAutomation.test.ts
git commit -m "feat: automate Tibo notification updates"
```

---

### Task 8: Android Setup Guide and Guarded Rollout

**Files:**
- Create: `docs/tibo-android-setup.md`
- Modify: no production code unless verification uncovers a documented payload mismatch

**Interfaces:**
- Consumes: deployed `/api/tibo-notification`
- Produces: operator-run Automate flow and deployment configuration

- [ ] **Step 1: Write the exact environment setup**

Document Vercel variables:

```text
TIBO_NOTIFICATION_SECRET=<random 32-byte value>
GITHUB_TIBO_DISPATCH_TOKEN=<fine-grained token restricted to gussuri/codex-reset-observatory>
GITHUB_REPOSITORY=gussuri/codex-reset-observatory
```

Document GitHub secret and variables:

```text
Secret: GEMINI_API_KEY
Variable: GEMINI_MODEL=gemini-2.5-flash-lite
Variable: TIBO_AUTOMATION_PUBLISH=false
```

State that the Gemini free tier may use submitted content to improve Google
products and that rate limits are account/project specific.

- [ ] **Step 2: Document the Automate flow**

Specify these blocks:

1. `Flow beginning`
2. `Notification posted`
   - Proceed: `When transition`
   - Package: `com.twitter.android`
   - Exclude group-summary notifications
   - Outputs: package, title, message, when timestamp, notification ID, extras
3. `Expression true`
   - normalized title contains `Tibo` or `@thsottiaux`
4. `HTTP request`
   - Method: `POST`
   - URL: `https://codex-reset-observatory.vercel.app/api/tibo-notification`
   - Content type: `application/json`
   - Header: `Authorization: Bearer <TIBO_NOTIFICATION_SECRET>`
   - JSON fields exactly matching `TiboNotificationPayload`
5. Status check for `202`
6. Bounded retry path: 1, 5, and 15 minutes
7. Local failure notification after the third failure
8. Loop back to `Notification posted`

Document how Automate formats its Unix timestamp as an ISO string. If the
device flow cannot format ISO reliably, allow the receiver to accept integer
milliseconds only after adding and testing that explicit schema variant.

- [ ] **Step 3: Document Android reliability settings**

Include:

- follow Tibo in the Android X app
- enable all-post notifications
- grant Automate notification access
- allow background data for X and Automate
- exclude both apps from battery optimization
- allow Automate to keep its required background-service notification
- confirm automatic date/time is enabled
- no screen-unlock or accessibility automation is required

- [ ] **Step 4: Perform a synthetic dry run**

With `TIBO_AUTOMATION_PUBLISH=false`, POST a synthetic payload using a local
command or Automate test block. Confirm:

- endpoint returns `202`
- GitHub Actions run starts
- `pendingReviews` receives one record
- public notice, probability, and history do not change
- a repeated identical payload does not duplicate state
- Vercel deploy succeeds after the state commit

- [ ] **Step 5: Inspect one real Android X notification**

Keep publication disabled until a real X notification shape is observed.
Confirm:

- actual package name
- actual title format
- whether the message is complete or truncated
- notification timestamp unit
- notification ID stability across updates
- whether extras contain an exact safe post URL

Update only the validator fixture and Automate guide if the real shape differs.
Do not add scraping as a fallback.

- [ ] **Step 6: Enable guarded publication**

Set:

```text
TIBO_AUTOMATION_PUBLISH=true
```

Trigger one synthetic explicit notice and verify:

- an active official notice appears
- a missing time displays as unknown
- 24/48-hour probability follows existing official-notice timing rules
- English and Chinese pages use fixed localized text
- no manual signal is changed

Trigger one synthetic completion and verify:

- only the linked notice resolves
- one provisional history item appears
- its time label says it was completed by announcement time
- latest reset probability anchor advances
- weekly reference remains unchanged when method/scope are unknown

Remove synthetic records before production activation.

- [ ] **Step 7: Run final repository verification**

Run:

```bash
pnpm test
pnpm lint
pnpm build
git status --short
```

Expected: tests, lint, and build pass; only the setup guide is uncommitted.

- [ ] **Step 8: Commit rollout documentation**

```bash
git add docs/tibo-android-setup.md
git commit -m "docs: add Tibo Android automation setup"
```

---

## Self-Review

### Spec coverage

- Official Android notification source: Tasks 6-8
- No X polling/API/scraping: global constraint and Task 8
- Explicit notice/completion only: Tasks 2-4
- No-time notice publication: Tasks 2 and 4
- Gemini guarded enrichment: Task 3
- Semantic JSON rather than regex TS rewriting: Tasks 1 and 7
- Shared forecast/history data source: Task 5
- Provisional time honesty: Tasks 4 and 5
- Unknown fields remain unknown: Tasks 1, 4, and 5
- Idempotency and bounded storage: Tasks 1 and 4
- Auth and secret handling: Tasks 6 and 7
- Dry run before publication: Task 8
- Tests, lint, and build: Tasks 5-8

### Placeholder scan

All test examples contain concrete fixtures and assertions. No production step
is deferred.

### Type consistency

The same `TiboNotificationPayload`, classification unions, semantic scope,
method, reason values, `sourceEventKey`, `effectiveAt`, and `timeBasis` fields
flow through Tasks 1-8. Runtime adapters are the only place semantic values are
converted to current radar display labels.
