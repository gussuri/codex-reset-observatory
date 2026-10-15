# Tibo Classification Evaluation Implementation Plan

> **For agentic workers:** Execute natively in this task; do not create subagents.

**Goal:** Add a source-auditable offline evaluation dataset and deterministic scorer without changing production classification, ingestion, history, or UI behavior.

**Architecture:** Keep real-post gold data, expanded synthetic contrast cases, and saved model outcomes as separate versioned fixtures. A network-free evaluator validates metadata, rejects incompatible checkpoints, scores raw/corrected/public layers independently, and makes failures, abstentions, and unavailable values explicit.

**Tech Stack:** TypeScript, JSON fixtures, Node test runner, existing pnpm scripts.

**Spec:** `docs/superpowers/specs/2026-10-15-tibo-classification-reliability-design.md`

## Global Constraints

- Work only in the dedicated evaluation worktree based on `934623e6859a7edaa3f75c3c19675ad656c8a39a`.
- Do not edit production classification, Gemini implementation, webhook, extension, Monitor, public UI, schema/migrations, deployment settings, or dependencies.
- Offline and dry-run are the defaults; do not make real AI calls or DB writes.
- Preserve the existing 145 virtual scenarios and do not label any fixture-only result as model quality.
- Split by logical event; all Oct 15 examples are regression data, not unknown holdout data.

## Review Focus

- Missing or incorrect event grouping must fail fixture validation rather than leak across development/holdout.
- Safe abstention on incomplete evidence must be distinguishable from an incorrect classification.
- API failure, malformed response, and unavailable raw output must never count as `irrelevant` or as a successful prediction.
- Checkpoint resume must reject fixture, prompt, schema, options, model, provider, version, input-condition, or commit mismatch.
- Zero-support classes and unavailable time/token/latency fields must render as N/A, never as zero-quality/zero-cost claims.

---

### Task 1: Establish source-auditable real-post and scenario fixtures

**Files:**
- Copy: `docs/superpowers/specs/2026-10-15-tibo-classification-reliability-design.md`
- Create: `tests/fixtures/tibo-real-posts-v1.json`
- Modify: `tests/fixtures/tibo-scenarios.json`
- Create: `tests/tiboEvaluationFixture.test.ts`

**Interfaces:** Each real post carries exact source text, tweet ID/URL/author/createdAt, eventGroup, split, role, source citation, gold label/rationale, and parent/quote IDs with relation verification state. Synthetic cases keep existing IDs and add layer, contrast group, eventGroup, evidence condition, accepted outcomes, and provenance for new entries.

- [ ] Validate unique post IDs, source URL/ID consistency, valid labels, explicit source status, and no logical event split leakage.
- [ ] Verify the Oct 15 and Oct 10–11 required source posts retain exact multiline text and IDs.
- [ ] Retain all 145 existing scenarios; add at least 75 reviewed contrasts to reach 220+, grouped by evaluation layer and not represented as independent real events.

### Task 2: Add an offline scorer and resumable experiment contract

**Files:**
- Create: `scripts/evaluate-tibo-offline.ts`
- Create: `tests/tiboOfflineEvaluation.test.ts`
- Modify: `package.json` only to add a local offline command.

**Interfaces:** Export fixture validation, metadata/hash generation, checkpoint compatibility, normalization of injected/saved result rows, and metric/report builders. Evaluation input layers are `raw_ai`, `corrected`, and `public_outcome`; `raw_ai` may be unavailable. Default dry-run lists cases and the later 12×4/60-attempt experiment cap, and always reports zero calls now.

- [ ] Test correct, wrong, abstain, 401, 429, timeout, invalid JSON, zero support, and all-request versus successful-response denominators.
- [ ] Test resume success only when every run identity field matches, and rejection for every mismatch.
- [ ] Keep fixture-driven mock results clearly labeled as evaluator tests, never AI quality.

### Task 3: Record the evidence inventory and dry-run contract

**Files:**
- Create: `docs/tibo-classification-evaluation.md`
- Create: `reports/tibo-classification-evaluation-dry-run.md`

- [ ] Report verified real-post counts/classes/events/splits/sources and any shortfall from 30 posts / 10 groups.
- [ ] Inventory current prompt size and request shape; mark token count unavailable.
- [ ] Explain old 23-post report limitations, synthetic coverage, scoring denominators, raw-output availability, and future 2×2 design without making model claims.
- [ ] Confirm dry-run has zero network/API/DB calls and list the future call cap only as a proposal.

### Task 4: Verify, commit, push, and open an evaluation-only PR

- [ ] Run focused evaluator tests, then full `pnpm test`, lint, typecheck, build, and `git diff --check`.
- [ ] Confirm only fixtures, evaluation-only code/tests, and docs changed; no dependencies or production behavior.
- [ ] Commit and push once, open/attach an evaluation-only PR, and report the exact worktree/branch/SHA/PR and limitations to Sol.
