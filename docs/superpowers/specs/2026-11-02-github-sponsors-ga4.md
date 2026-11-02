# GitHub Sponsors conversion and free GA4 measurement

Human request: implement the proposed sponsor links and free GA4 click measurement, with more visibility because continued funding matters. Sol owns design, Google/Vercel setup and independent review; existing Luna7 owns repository implementation. No additional chat/subagent. Human says GA4 has not been created.

## Product
- Direct fixed destination https://github.com/sponsors/gussuri (verified active, monthly tiers exist). Preserve separate repository-development link.
- Home: visible heart/support button in header, compact but prominent support panel immediately after main current-status/forecast block, and footer support link. Retain official notice/forecast prominence and readable mobile flow. No modal, floating overlay, countdown, repeated animation or obstruction.
- About: explain personal operation and voluntary support for collection/history/forecast improvements, with direct support button. History/FAQ footers also get a support link. JA/EN/simplified ZH equivalent intent, natural wording.
- Suggested JA panel title: 「無料公開の継続を応援してください」. Body: 「リセット情報の収集・履歴の整理・予測の改善を続けるため、GitHub Sponsorsでの支援を募集しています。少額からの継続支援が、開発・運営の支えになります。」 Button: 「GitHub Sponsorsで支援する」. Header: 「♡ 運営を支援」. Brief voluntary-support text if space allows.
- Do not disclose personal finances, promise shutdown dates, invent expenses/goals/perks or promise future free availability. Do not imply a sponsor can influence forecasts or buy privileged data. Do not hardcode minimum dollar tier.
- Reuse current slate/teal design with a distinct warm pink/fuchsia support accent; do not give support a data-warning/official-notice alert role. Keyboard focus, touch targets >=44px for primary CTA, no horizontal overflow at 320/375px or long localized labels.

## Measurement
- Optional environment `NEXT_PUBLIC_GA_MEASUREMENT_ID`; only valid G-* measurement IDs load GA. Root will create/check free GA4 configuration. Real ID not committed. Missing/invalid ID must preserve working links and avoid broken network/script markup.
- Minimal reusable GA4 loader mounted once in each existing locale root layout, afterInteractive via next/script. No new dependencies, DB/API endpoints, polling, cron, server-side click writes or paid Vercel custom events.
- `sponsor_click` event once per activated support link. Low-cardinality props `placement` (header/panel/footer/about), `locale` (ja/en/zh), `page_type` (home/history/faq/about). No personal ID, tweet text, email, free-form URL/query/hash. Normal target=_blank rel=noopener noreferrer navigation must work even if analytics missing, blocked or throws; no preventDefault/wait-for-tracker.
- Native enhanced outbound `click` may coexist; sponsor report counts `sponsor_click`, not their sum. Avoid double listener/dispatch. Disable Google Signals and ad personalization; no ads features or user identification. Keep page location free of query/hash in explicit config.
- Add a short accurate About measurement note with official Google privacy/opt-out information; no unsupported legal-compliance claims or invented consent promises. If region/consent issue requires product choice, report to Sol rather than silently adding a heavy consent platform.

## Ownership and execution
- Fresh managed isolated worktree/branch from latest origin/main (known 2d4ab474be9605c00e0030eeb780b276fee1088b; verify). Protect primary C:/Users/Yura/Documents/codex-reset-observatory, running monitor worktree and old dirty worktrees. Others may work in repo: don't revert their changes.
- Luna owns support components/copy, minimal analytics module and loader, locale layouts/views, .env.example placeholder/docs, relevant tests. No reset/model/history/extension changes. Root owns GA4 external configuration and Production env, and merge/release review.
- Write a short checked implementation plan in docs/superpowers/plans/2026-11-02-github-sponsors-ga4.md, copying this spec into docs/superpowers/specs/2026-11-02-github-sponsors-ga4.md.
- Test useful behavior: direct links/correct placement and locale, event exactly once/props, disabled/error tracker still navigates, safe/missing ID/script duplication, layouts preserved. Use mock gtag/route interception for local QA to avoid contaminating real analytics. Browser plugin absent; use installed Playwright for rendered verification. Inspect 375px/desktop, 3 locales, keyboard and console; capture screenshots.
- Relevant tests -> full test -> lint/typecheck/build/registry if affected -> diffcheck. Avoid repeated unnecessary builds; one batched branch push/Preview then Production after Sol review. No push/PR until Sol review and GA4 environment readiness; if UI is ready while root setting up GA4, report rather than wait indefinitely.
- Questions/completion via normal chat to Sol 01a0f4fb-964b-74a2-a7ab-1884d0adfa92 host local; no user question forms. Explicit human authorization for existing Luna work and callback persists. Report worktree/diff, test evidence, screenshots, limitations and readiness.
