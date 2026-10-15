# Tibo threaded reset notices

## Failure mode

The collector originally relied on a `Replying to` marker or the `with_replies` timeline. X can render a verified self-reply as adjacent tweet cells linked by incoming/outgoing thread connectors, including when the marker is absent. Since the first child delivery may already be deduplicated, the later thread scan must be allowed to send one context-enriched replay.

The Oct 15, 2026 example consists of the parent `The reports of my reset button being lost are greatly exaggerated / Day 10/ Reset` and the same-author child `Landing within the next 2 hours`. The parent expresses the reset offer and remains the official notice. The child supplies its bounded timing window; without verified same-author parent context it is not a reset signal.

## Collection and replay

Only adjacent cells with X's outgoing and incoming thread connectors count as parent-child evidence. The parent must be `@thsottiaux`; quoted posts and unrelated adjacent posts do not qualify. The child keeps its own tweet ID and timestamp. A later scan may resend it once only when it now has trusted parent text. The worker persists that enrichment marker so rescans and reloads do not repeat the delivery.

## Classification and timing

A `Day N / Reset` daily offer is an `official_notice`, including when it follows a joke opener. It does not assert completion. The parent's row is the only published notice. For a verified same-author daily reset parent, a child phrase of the form `Landing within the next N minutes/hours/days` is resolved from the child's creation timestamp and copied onto the parent's notice row. The child remains a reply and does not become a second public notice. The parent update requires exactly one matching official-notice row and skips confirmed or manual parent state.

`within the next N units` denotes a range from the source tweet creation instant to its upper bound. `in N units` remains a point time. The published range is derived from the post creation timestamp, not webhook receipt time. Manual or confirmed temporal decisions on the same tweet ID are preserved on replay, including range bounds and expiry. Original AI fields remain the audit of the model's output. Public summaries for ranges use generic wording so a weekday inferred from one endpoint is not shown as a single scheduled day.
