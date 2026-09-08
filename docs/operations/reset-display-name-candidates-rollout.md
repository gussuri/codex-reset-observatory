# Reset Display Name Candidates Rollout

This runbook describes the staged activation of reset display-name candidates. Candidate data is internal and is never added to `RadarData`, public-v1, public history, probability inputs, or cache dimensions.

## Safety rules

- Apply the candidate migration only in local or staging validation environments first. Do not apply it to Production as part of this implementation.
- The default candidate mode is `off`. An invalid mode or invalid adoption cutoff is fail-closed as `off`.
- The adoption cutoff is the persisted `tibo_signals.tweet_created_at` boundary. Signals created before the cutoff are not self-healed.
- Candidate generation and promotion are auxiliary. Their failures must not roll back or suppress canonical history, adoption, execution estimates, or probability state.
- Candidate writes and candidate-only results do not invalidate the radar cache. Cache invalidation is reserved for an actual canonical display-name write.

## Stage 0: read-only shadow inspection

Run `scripts/inspect-reset-display-name-candidates.ts` with `RESET_DISPLAY_NAME_CANDIDATE_MODE=off`.

The inspection must report:

```text
geminiCalls = 0
writes = 0
```

In this mode the inspection does not read `reset_display_name_candidates`. It reads only the normal radar data needed to establish the current baseline. The inspection has no upsert, promotion RPC, Gemini, or cache invalidation path.

For a configured `seed` or `full` inspection, the script reads eligible Tibo notices, existing candidate rows, canonical history, formal adoption evidence, execution estimates, and canonical display-name rows. It computes and prints counts only:

- eligible notice count
- existing candidate count
- missing seed count
- ambiguous identity count
- promotion-ready count
- Gemini calls and writes, both zero

Review missing seeds, identity conflicts, excluded ongoing-policy notices, and candidate-to-canonical associations before enabling seed persistence.

## Stage 1: seed-only activation

After the read-only review, set:

```text
RESET_DISPLAY_NAME_CANDIDATE_MODE=seed
RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT=<reviewed ISO timestamp>
```

In `seed` mode, the webhook and the ten-minute reconciler may persist or self-heal identity-only seeds. They must not call Gemini, claim generation, or promote a candidate. Re-run the read-only inspection and verify that seed counts change only for notices at or after the immutable cutoff.

The seed contains notice identity, trusted logical identity, and explicit notice/source tweet IDs only. Temporal metadata and future canonical event keys are rehydrated from persisted source data later; they are not copied into the candidate row.

## Stage 2: full candidate workflow

Enable `full` only after a separate review of Stage 1:

```text
RESET_DISPLAY_NAME_CANDIDATE_MODE=full
RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT=<same reviewed ISO timestamp>
```

The reconciler always processes completed canonical display-name work first. Candidate generation may use only the remaining run-wide Gemini request cap and respects the candidate retry cooldown, including provider retry timing. A candidate with persisted authoritative execution evidence is not sent to Gemini; the completed canonical reconciler owns that path.

Promotion requires an existing canonical event identity backed by persisted authoritative execution evidence. Notice-only, new, ambiguous, static-history-only, and dynamic-only identities cannot be promoted. Promotion is atomic and idempotent, preserves manual or accepted canonical names, and cannot write history, adoption, execution estimates, probability, or reset boundaries.

Once a candidate is promoted, its precomputed accepted name is immutable to automatic candidate regeneration. Later improvements require a manual name change. There is no automatic post-execution candidate regeneration in v1.

## Production activation boundary

Production migration application, scheduler activation, and data writes are separate release actions. Before those actions, confirm the migration in a non-Production environment, review shadow counts, verify the adoption cutoff, and confirm that public-v1 and public history remain unchanged. Do not enable `full` as part of this implementation or without an explicit operational approval.
