# Supabase Egress Operations

This note records the read-cache changes for Codex Reset Observatory. The
change does not alter the Supabase schema, stored history, prediction model,
public DTO, or database write semantics.

## Cache scopes

| Data | Normal TTL | Invalidation scope | Freshness reason |
| --- | ---: | --- | --- |
| Active and timed Tibo signals | 60 seconds | Tibo event writes | These are the fast path for current notices and deadlines. |
| Canonical Tibo history | 15 minutes | Tibo events and translation repairs | Canonical history changes less often than the active signal window, while explicit invalidation still makes new or corrected rows visible promptly. |
| Regular reset events | 60 seconds | Meaningful Codex usage writes | Routine usage notifications do not invalidate the radar when they do not change a reset or recovery observation. |
| Recovery observations and execution estimates | 30 seconds | Meaningful Codex usage writes and Tibo-derived reconciliation | These sources can affect current recovery and formal reset presentation. |
| Formal adoption ledger | 30 seconds | Tibo-derived reconciliation | Formal adoption and correction must reach the canonical presentation. |
| Reset display names | 1 hour | Display-name reconciliation writes | Names are stable presentation data and have a dedicated write-triggered invalidation. |
| Raw `prediction_history` projection | 15 minutes | A newly inserted prediction row | Stored rows are cached without time-dependent labels; labels are parsed again for each calculation time. |
| Shared radar core | 15 minutes | Any source scope that affects the core | This is the locale-independent Supabase-backed read result shared by the page and API. |
| Public API snapshot | 10-minute calculation bucket, up to 1-hour retention | Shared-core invalidation | All locales reuse one bundle while preserving the existing calculation cadence. |
| Radar page projection | 1-hour calculation bucket | Shared-core invalidation | Page variants reuse the same core and only differ in locale/history/heatmap projection. |

Source cache tags are intentionally separate from the legacy `radar-data` tag.
The shared core is tagged with its known source dependencies, and public
projections are tagged with the core tag. This makes a write invalidate the
smallest source set plus the results that depend on it.

## Invalidation rules

| Write path | Invalidated sources | Not invalidated |
| --- | --- | --- |
| Tibo webhook | Active, canonical, timed Tibo data; Tibo-derived recovery, execution estimates, formal adoption, display names; shared core | Prediction history |
| Codex usage webhook with a meaningful recovery/reset/banked change | Tibo promotion projections, regular reset events, recovery observations, execution estimates; shared core | Display names and prediction history |
| Display-name reconciliation | Display names; shared core | Tibo history and prediction history |
| Translation repair | Active, canonical, and timed Tibo projections; shared core | Display names and prediction history |
| New `prediction_history` row | Prediction-history projection; shared core | Tibo and display-name sources |
| Ordinary usage notification with no meaningful reset/recovery change | Nothing | All radar caches remain warm |

The full invalidation helper remains available for an explicit maintenance
operation, but normal routes use the narrower scopes above. A failed read still
uses the existing degraded-data and stale-cache behavior; no cache change is
treated as permission to replace healthy data with a partial result.

## Prediction-history calculation boundary

The raw, explicitly selected `prediction_history` projection is cached for 15
minutes and invalidated after a successful new-row insert. `asOf`, current
random-reset events, and the calculation-time labels are applied after the raw
projection is read. Therefore a later request does not reuse a probability
label computed at an earlier time, and the stored history is not truncated for
egress savings. A cache miss logs only mode, row count, duration, and health;
it does not log response bodies, prediction values, identifiers, or secrets.

## Seven-day measurement

Measure the change over at least seven days after the deployment:

1. Record the deployment timestamp and the first complete UTC day after it.
2. From the existing Vercel/Supabase observability, record daily Supabase
   egress, request count, fetched row counts, and the cache-miss metrics for
   `radar_core_compute`, `public_snapshot_bundle_compute`, `radar_page_compute`,
   and `prediction_history_projection_fetch`.
3. Compare the daily increase after the change with the same measurement from
   the preceding period. Separate estimated response size from the egress
   value reported by Supabase.
4. Include every project in the Supabase organization when comparing against
   an organization-level budget. The previously observed ~130 MB/day and ~4
   GB/month are historical targets, not current measurements or guarantees.
5. Do not expect the current billing-period cumulative egress to decrease;
   evaluate the post-change rate of increase instead.

Do not claim that the free tier is sufficient until the post-change measured
rate supports that conclusion. This change adds no database migration,
backfill, deletion, paid service, or production test write.
