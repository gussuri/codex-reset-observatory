# GitHub Sponsors CTA and optional GA4 plan

1. Add a typed, low-cardinality `sponsor_click` event helper and a shared accessible Sponsors link/panel. Keep click tracking best-effort so native outbound navigation always proceeds.
2. Add an optional GA4 loader that accepts only `G-*` IDs, disables advertising personalization and Google Signals, and is mounted once from each locale root layout.
3. Add localized CTA copy in JA/EN/ZH to the home header, a panel after the current status/forecast block, shared site footers, and About. Add the measurement privacy note and official Google privacy/opt-out links.
4. Add focused tests for event properties, translations, safe links, GA4 ID validation/configuration, and wiring across all required routes. Verify the exact copied spec and review the diff for scope.
5. Run relevant tests, the full test suite, lint, typecheck, production build, model-registry check (if unaffected, verify it), and `git diff --check` in one validation pass.
6. Run the app with a mocked `gtag`/route interception and inspect JA/EN/ZH at 375px and desktop, including keyboard focus, console, sponsor destination/attributes, and horizontal overflow. Save screenshots outside the repository.
7. Report the diff, validation evidence, screenshots, GA4 ID readiness and any release limitations to Sol. Keep the work local for independent review; do not commit or push.
