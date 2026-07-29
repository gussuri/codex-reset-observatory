# Tibo Android Notification Automation Design

Date: 2026-07-30

## Goal

Use the official X Android app notification for Tibo (`@thsottiaux`) as the
zero-cost event source, then update Codex Reset Observatory automatically while
the operator is asleep.

The automation should publish only an explicit reset announcement or an
explicit reset completion. Ambiguous posts must be retained for review without
changing the public forecast or reset history.

## Non-goals

- Polling or scraping X on a schedule
- Using the X API
- Letting an LLM publish an ambiguous post on its own
- Inferring a target plan, reset method, reason, or exact execution time that
  the post does not state
- Reusing the current regex-based TypeScript source rewriting

## Selected Architecture

```text
X Android notification
  -> Automate notification listener
  -> POST /api/tibo-notification
  -> GitHub repository_dispatch
  -> GitHub Actions classifier and data updater
  -> tests, lint, and build
  -> commit to main
  -> Vercel deployment
```

The phone is only an event sensor. Classification, validation, data updates,
and deployment remain in the repository workflow.

This is preferred over PC notification monitoring because the PC may sleep, and
over server-side X polling because the known free feeds are stale or unstable.

## Android Flow

Automate will listen for notifications from the X Android package and filter
for a title identifying Tibo or `@thsottiaux`. It will send:

- package name
- notification title
- notification message
- notification timestamp
- notification ID
- available notification extras
- a locally generated event timestamp

The flow will not need to wake or unlock the screen. Automate and X must be
excluded from aggressive battery optimization, and background data must be
allowed.

The free Automate limit is 30 running blocks. The planned flow should remain
well below that limit.

Automate does not guarantee that an X post URL is present. The notification
extras will be inspected during rollout. If an exact URL is unavailable, the
automation will use Tibo's X profile URL and will not start an X scraper merely
to recover the post URL.

On an HTTP failure, the flow will retry with bounded backoff and then show a
local failure notification. It must not send an unbounded retry loop.

## Receiver API

Add `POST /api/tibo-notification`.

The route will:

1. Require a dedicated bearer secret.
2. Accept only JSON within a small size limit.
3. Validate and normalize all fields.
4. Require the X package name and a Tibo identity match.
5. Reject stale timestamps and malformed payloads.
6. Build a stable event key from notification ID, timestamp, and content hash.
7. Send a sanitized, encoded payload through GitHub `repository_dispatch`.
8. Return `202 Accepted` after GitHub accepts the dispatch.

The GitHub dispatch credential will be stored only in Vercel environment
variables and limited to this repository with the minimum required permission.
The phone will hold only the receiver bearer secret, not a GitHub token.

The route will not directly edit repository files or update the forecast.

## Classification

Classification uses two layers.

### Deterministic safety layer

The local classifier recognizes explicit Japanese and English statements.

Examples of an upcoming reset:

- `リセットします`
- `リセットを行います`
- `リセットされます`
- `I will reset`
- `we will reset`
- `we'll reset`
- `usage limits will be reset`
- `going to reset`

Examples of a completed reset:

- `リセットしました`
- `リセットされました`
- `I've reset`
- `we have reset`
- `usage limits have been reset`

The classifier must account for negation and quoted or hypothetical language.
The word `reset` by itself is not sufficient.

### Gemini enrichment layer

Gemini may classify and extract structured fields from a relevant notification:

- category: `reset_notice`, `reset_completed`, `incident_hint`,
  `irrelevant`, or `uncertain`
- whether the post contains an explicit reset statement
- temporal wording and any stated time window
- stated target scope
- stated reset method
- stated reason category
- confidence
- a short evidence span from the input

The response must use a strict JSON schema, low temperature, bounded output,
and a configurable model name. The raw notification text is the only factual
source.

Gemini is not the sole publication authority:

- A deterministic explicit match may publish if Gemini is unavailable.
- A high-confidence Gemini result may help with wording or extraction.
- A Gemini-only result still needs a lexical reset/usage-limit gate.
- Conflicting, uncertain, negated, or incomplete results are held for review.
- No field may be filled from general knowledge.

This preserves zero-cost operation under the available Gemini free quota while
allowing the basic path to work during a Gemini outage.

## Publication Rules

### Explicit future reset

Create an active `official_notice`.

If the post states no time, the notice remains valid and the UI displays an
unknown execution time. A missing time must not block publication.

If the post states an exact time or a bounded window, store only the time
information that can be parsed without guessing a timezone. Preserve the raw
temporal phrase for review.

An undated notice expires after a bounded safety window unless a completion
event resolves it. The initial default is 36 hours after observation.

### Explicit completed reset

Create a provisional completed reset event and resolve only the active notice
linked to the same source or automation lineage.

The notification/post time is an upper bound for when the reset had happened,
not an exact execution time. Store the time basis explicitly. The forecast may
use it as a provisional reset anchor, while the UI must not label it as an exact
execution time.

Do not resolve every active local signal.

### Ambiguous or unrelated post

Store a bounded pending/review record without changing public signals, reset
history, or probabilities. Optionally send an operator notification.

### Unknown fields

Do not default to:

- all paid plans
- forced reset
- compensation reset
- celebration reset

Use semantic unknown values until the operator or an explicit post supplies the
information.

## Data Storage

Add a structured JSON file for automation-owned data instead of rewriting
TypeScript with regular expressions.

The file will contain:

- schema version
- bounded processed-event keys for deduplication
- active or resolved automated signals
- provisional automated reset events
- bounded pending review records
- classification metadata and prompt version

The application will validate and adapt this JSON into its existing signal and
history types. Manual records in `data/observationSignals.ts` and
`data/resetHistory.ts` remain authoritative for manually curated events.

An automated record must have a stable source event key so that a later manual
record can supersede it without producing a duplicate.

No API or UI logic may depend on localized Japanese display text. Automated
records use semantic enum values and locale-specific fixed templates at the
view-model layer.

## GitHub Actions Workflow

Add a workflow triggered only by a dedicated `repository_dispatch` event.

The workflow will:

1. Serialize concurrent Tibo updates without cancelling an earlier event.
2. Check out the current `main` branch.
3. Install dependencies with the lockfile.
4. Decode the sanitized payload without shell evaluation.
5. Run the deterministic and optional Gemini classification.
6. Update only automation-owned JSON data.
7. Run focused tests, lint, and build.
8. Commit and push only when public or review data changed.
9. Report a held, failed, or published result through an optional webhook.

The payload and secrets must not be echoed into public GitHub Actions logs.
The workflow uses its scoped `GITHUB_TOKEN` to commit.

## Reliability and Security

- Dedicated receiver secret, separate from `CRON_SECRET`
- Strict input validation and size limits
- Stable content hashing and idempotent updates
- Bounded state arrays
- No force push
- No broad signal-resolution regex
- No arbitrary file paths or shell interpolation from notification text
- Existing production data stays unchanged when classification is uncertain
- Build failure leaves the currently deployed site unchanged

## Testing

Add focused tests for:

- Japanese and English future reset statements
- Japanese and English completed reset statements
- missing time still producing an official notice
- exact and relative time extraction without timezone invention
- negation, hypothetical wording, and quoted reset text
- irrelevant `reset` mentions
- Gemini unavailable or malformed JSON
- deterministic/Gemini disagreement
- unknown scope, method, and reason remaining unknown
- deduplication across repeated notification updates
- resolving only a linked notice
- provisional completion-time handling
- malformed and stale receiver payloads
- JSON schema validation and bounded state

The implementation must pass the existing test command, lint, and production
build.

## Rollout

### Phase 1: notification capture

Install Automate, enable Tibo notifications in X, grant notification access,
and inspect one real X notification's title, message, timestamp, ID, and extras.
Use a synthetic receiver request first to verify authentication and delivery.

### Phase 2: dry run

Keep public publication disabled. Dispatch and classify captured notifications,
recording only review data. Verify that duplicate notification updates are
ignored.

### Phase 3: guarded publication

Enable publication for explicit future and completed reset statements. Keep
ambiguous posts in review-only mode.

### Phase 4: morning review

Review provisional events and replace or supersede them with curated records
when an exact execution time, scope, method, or reason becomes known.

## Cost

The design avoids the X API and scheduled polling. It uses:

- the free Automate tier within its running-block limit
- the existing Vercel deployment and a low-volume function endpoint
- standard GitHub Actions runners for the public repository
- the available Gemini API free quota, with a deterministic fallback

Under normal Tibo posting volume, no new paid service is expected.
