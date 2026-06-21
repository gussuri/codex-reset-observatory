# Reddit signal research

This is an internal observation experiment for checking whether Reddit posts
about Codex usage limits, capacity, rate limits, resets, or outages tend to
appear before random or compensation resets.

## Collection

Run:

```sh
npm run observe:reddit
```

The script checks:

- r/OpenAI
- r/ChatGPT
- r/codex

It tries Reddit's public JSON search first because JSON can include score and
comment counts. If JSON is blocked, it falls back to Reddit RSS. RSS is useful
for title, URL, subreddit, and post time, but it does not expose score or
comment counts, so those fields are saved as `null`.

The default query is `codex`, and classification then looks for:

- codex
- usage limit
- rate limit
- capacity
- at capacity
- reached capacity
- reset
- limit reset
- high error
- unavailable

## Saved files

- `data/redditSignals.json`: deduplicated post-level internal log.
- `data/redditSignalSummary.json`: latest fetch status and rolling aggregates.

These files are not imported by public pages and are not used by the reset
probability logic.

## Signal types

- `limit_anomaly`
- `capacity`
- `reset_talk`
- `incident_complaint`
- `noise`

`noise` means the post is Codex-related but does not yet look like a reset,
capacity, rate-limit, or outage signal.

## Aggregates

The summary keeps:

- related posts in the past 6 hours
- related posts in the past 24 hours
- total signal score in the past 24 hours
- counts by signal type
- a 14-day baseline excluding the latest 24 hours
- current 24-hour delta from that baseline

This lets us later compare Reddit pressure against actual reset history without
showing Reddit content on the site or changing the public forecast.
