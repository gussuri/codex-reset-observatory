# Reset Reason Taxonomy

## Goal

Keep reset cycle (`cycleType`) separate from the public reason category (`reasonType`) and ensure public history exposes only the canonical reason values.

## Scope

- Add a small domain helper for canonical reason types and legacy normalization.
- Apply it to history presentation and Tibo/notice-backed history construction.
- Keep `ai_reset_type_ja`, persistence, probability, detection, API shape, and layout unchanged.
- Add regression coverage for the known Monday event, milestone, compensation, regular, unknown, and localized history cases.

## Verification

- Focused taxonomy and history tests.
- Full `corepack pnpm run check` and `corepack pnpm run build`.
- `git diff --check`.
- Public `/api/current` audit for the three allowed localized reason values.
