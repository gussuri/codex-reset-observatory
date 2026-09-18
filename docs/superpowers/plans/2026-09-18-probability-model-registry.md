# Probability model registry implementation plan

> **Execution note:** Use superpowers:executing-plans to execute this plan task-by-task with verification checkpoints.

**Goal:** Add a typed central registry for every real probability-model identity and a separate public-period timeline, while preserving all probability calculations, selector behavior, public DTOs/UI, logging, database state, and history.

**Branch:** chore/probability-model-registry

**Base:** fa68290e68e4f53054b70ac38babd57947fa542d

## Design constraints

- data/shadowProbabilityConfig.ts remains independent of the new registry; the registry may import existing constants/arrays, but config must not import the registry.
- Never move or rename existing model-version constants. In particular, import PROBABILITY_MODEL_VERSION from data/predictionWeights.ts and register it as heuristic/time-consistent/v2.
- Do not alter calculatePublishedProbability, getLocalProbabilityCalculation, getPublishedProbabilityPeriodAt, model eligibility, adoption timestamps, freeze timestamps, model strings, logging, API/UI, DB schema/migrations, prediction rows, backfills, or relabels.
- Do not infer parent/difference metadata when the code or documentation does not establish it. Avoid broad source-string scraping that could mistake non-model "hazard-..." text for an identity.

## Tasks

### 1. Establish explicit model identity inventory and registry types

- [ ] Inspect all existing *_MODEL_VERSION exports, model-version arrays, and actual diagnostic/evaluator model-version arrays in data/shadowProbabilityConfig.ts, plus PROBABILITY_MODEL_VERSION in data/predictionWeights.ts.
- [ ] Define typed unions/interfaces for model kind, public status, lifecycle status, role, calibration, registry entries, and public-period entries.
- [ ] Add data/probabilityModelRegistry.ts with one entry per unique runtime model identity, using imported constants or existing array members rather than duplicate model-version literals.
- [ ] Register the heuristic fallback exactly as:
  - key heuristic/time-consistent/v2
  - imported PROBABILITY_MODEL_VERSION
  - display name Heuristic Time-Consistent v2
  - family heuristic, variant time-consistent, revision v2
  - kind forecast, publicStatus never, status active, roles fallback
  - all optional lineage/eligibility/regime/bandwidth/freeze fields null, calibration none
  - no speculative parent difference, with the requested fallback note.
- [ ] Include the explicit legacy, recency, calibrated, elapsed/regime, random-clock, next-generation, bandwidth, context-aware, late-age diagnostic, and broad-banked model identities required by the specification without inventing identities or duplicating aliases.
- [ ] Add pure lookup helpers: by version, by key, current public model, by family, by role, public periods, and current public period.
- [ ] Add PROBABILITY_MODEL_POINTERS using existing published/stable-fallback constants only; do not make runtime code consume this pointer view.

### 2. Add the separate public probability-period registry

- [ ] Define PUBLIC_PROBABILITY_PERIOD_REGISTRY in the same module with the eight existing period ids, using existing adoption constants for all boundaries and no duplicated timestamps.
- [ ] Preserve the existing selector timeline exactly: nullable initial start, contiguous ends/starts, raw continuous 2026-09-17T05:45:00.000Z adoption boundary, and broad-banked v2 2026-09-18T06:00:00.000Z boundary.
- [ ] Set the current open-ended period to broad-banked-v2; keep the heuristic model out of this registry.

### 3. Add generated documentation and read-only CLI

- [ ] Add a pure formatter/generator helper and scripts/generate-probability-model-registry.ts that writes docs/probability/model-registry.md deterministically from the registry.
- [ ] Add a check mode/script that exits nonzero when generated documentation is stale.
- [ ] Add a read-only scripts/list-probability-models.ts CLI and package scripts models:list, models:registry:generate, and models:registry:check; support --json without network or DB access.
- [ ] Organize the document/CLI output into current public, public history, active/shadow, diagnostics, and archived/legacy sections, always showing both key and modelVersion.
- [ ] Update only existing governance/next-generation docs as needed to link to the generated registry, without maintaining duplicate model ledgers.

### 4. Write tests first for identity coverage and timeline governance

- [ ] Add tests/probabilityModelRegistry.test.ts covering unique keys/model versions, exactly one current public model, pointer references, parent/baseline references, period uniqueness/contiguity/open-endedness, and current period/model agreement.
- [ ] Build coverage from an explicit inventory of *_MODEL_VERSION exports and known model-version arrays/property members, not an unrestricted "hazard-..." string regex. Add a separate exact assertion that PROBABILITY_MODEL_VERSION is present in the registry.
- [ ] Assert broad-banked late-age diagnostic models are never public and cannot be current.
- [ ] Add boundary tests comparing registry-derived periods to the unchanged getPublishedProbabilityPeriodAt at one millisecond before, exactly at, and one millisecond after every adoption boundary, including raw and broad-banked boundaries.
- [ ] Add a generated-doc synchronization test.
- [ ] Add a regression guard for representative public probability outputs so registry-only changes cannot alter P12/P24/P48/P72 or source/fallback behavior.

### 5. Implement the registry and documentation/CLI against the tests

- [ ] Implement the smallest code needed to make the focused tests pass, keeping all existing calculation and selector imports/paths unchanged.
- [ ] Generate and review docs/probability/model-registry.md; ensure heuristic appears in model inventory but not public timeline.
- [ ] Run pnpm models:list and pnpm models:list --json and verify they are read-only and deterministic.

### 6. Validate, review, commit, and push

- [ ] Run focused registry/governance/adoption/next-generation logging tests.
- [ ] Run full tests, typecheck, lint, build, pnpm models:registry:check, and git diff --check.
- [ ] Confirm git diff contains no changes to calculation/selector behavior, public API/UI, DB/migrations, model identity constants, freeze/adoption values, logging, or history writes.
- [ ] Confirm representative public probability outputs are unchanged.
- [ ] Commit exactly chore: add probability model registry without amend/rebase/squash.
- [ ] Push only chore/probability-model-registry to origin; never merge main.
- [ ] Report commit SHA, registry counts/families, current/previous public entries, period timeline, shadow/diagnostic/archived counts, test results, docs, runtime/API/UI/DB/history invariants, push result, and final git status.
