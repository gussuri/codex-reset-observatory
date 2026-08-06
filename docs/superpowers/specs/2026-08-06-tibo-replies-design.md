# Tibo Reply Monitoring Design

## Goal

Collect posts authored by `@thsottiaux` from both the profile and `with_replies` timelines, preserve the existing webhook/classification/storage path, and keep replies out of public reset prediction inputs.

## Boundaries

- The extension continues to use tabs already opened by the user. It does not create or close tabs.
- The ten-minute reload alarm reloads at most one profile tab and one `with_replies` tab.
- The existing notifications content-script path remains supported as a legacy profile source.
- Tweet IDs are deduplicated in the service-worker queue, so the same post found in both timelines is sent once.
- Only explicit reply UI metadata in the current article is used for reply detection. No parent navigation or extra network request is added.
- Parent context is copied only when a nested tweet article visibly contains the parent text; otherwise it is `null`.
- Webhook metadata is optional for old extensions, validated when present, and stored in nullable columns.
- Replies are stored and classified for observation, but `is_reply = true` rows are excluded from active signals and formal reset history.
- No public DTO, probability model, dashboard UI, or existing classification threshold changes.

## Data flow

1. `scan-utils.js` classifies the current URL and extracts explicit reply metadata from an article.
2. `content.js` adds `isReply`, safe reply handles, optional visible parent context, and `sourceTimeline` to the existing webhook payload.
3. `service-worker.js` reloads each available timeline once per alarm and uses the existing tweet-ID queue for deduplication and retry behavior.
4. `app/api/webhook/tibo/route.ts` validates optional metadata, passes it to rule and Gemini classification, and writes nullable metadata columns without changing formal adoption rules.
5. `lib/radarFetch.ts` excludes reply rows from active signals and Tibo history while retaining legacy rows whose nullable `is_reply` is absent.

## Safety

- Handles are limited to the X username format and count/length caps.
- Parent context and source text are length-limited and remain untrusted model input.
- Diagnostic summaries contain safe counts and timeline labels only; raw DOM stays in local extension diagnostics.
- Existing old payloads continue through the old reply heuristic when explicit metadata is absent.
