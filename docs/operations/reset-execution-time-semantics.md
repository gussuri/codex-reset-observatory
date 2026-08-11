# Reset execution time semantics

The history UI keeps the user-facing label `Executed` (or its localized
equivalent) intentionally simple. The displayed timestamp is a presentation
value and is separate from the canonical reset timestamp used by probability,
hazard, regime, elapsed-time, history-training, and prospective evaluation
logic.

## Display precedence

For a formal Tibo reset cluster, the display decision uses this order:

1. A complete manual override with a timestamp, precision, reason, and audit
   timestamp.
2. A confirmed Codex usage recovery observation matched to one of the cluster's
   Tibo posts.
3. The first trusted Tibo completion announcement as a fallback.

The matching uses the existing 90-minute reconciliation. Unconfirmed,
rejected, stale, invalid, or differently matched observations are not display
evidence.

## Usage observation windows

The monitor observes snapshots by polling, so a recovery observation identifies
an interval rather than an exact instant. The previous snapshot timestamp is
stored as `execution_window_start_at`; the first confirmed recovery snapshot is
stored as `execution_window_end_at`. The public display uses the window end and
marks the time as approximate (`around` / `頃` / `约`). It does not use a midpoint.

The internal `reset_execution_estimates` record preserves the source,
confidence, precision, estimator version, recovery id, Tibo cluster ids, and
manual override provenance. It does not duplicate raw personal usage values.

## Canonical model time

`display_execution_at` is not a model boundary. Canonical reset time remains
the existing trusted Tibo completion time. Display estimates are never fed
into random-reset targets, hazard exposure, regime calculations, elapsed bins,
training history, or prospective evaluation.

## Fallback and manual corrections

When no confirmed matched usage recovery exists, the history keeps the Tibo
announcement time and records `tibo_announcement_fallback` with
`announcement_fallback` precision. A later manual correction has the highest
precedence and must retain its timestamp, precision, reason, and audit actor or
timestamp. Subsequent usage processing must not overwrite a valid manual
override.

The 2026-08-11 event is not backfilled from an operator's approximate memory.
Without a stored usage observation or explicit manual override, it remains on
the Tibo announcement fallback.
