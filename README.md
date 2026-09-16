# Codex Reset Observatory

Track and explain signals around Codex usage-limit resets.

This dashboard collects reset signals related to OpenAI Codex and ChatGPT Work usage limits, then combines them with reset history and status information to estimate and visualize reset probabilities.

[**Open the live observatory →**](https://codex.gussuriworks.com/en)

## Features

- 📊 **Reset probability estimates**: Estimate the probability of a reset within 24 or 48 hours by combining recent reset history, elapsed time, incident counts, and the volume of community reports.
- 📝 **Official signal monitoring**: Collect posts by Tibo (`@thsottiaux`) through a Chrome extension and webhook, then store classification results and audit information.
- 🌐 **Multilingual dashboard**: Supports Japanese (`ja`), English (`en`), and Chinese (`zh`), including automatic interpretation of time expressions.

## LLM-assisted classification

Posts by Tibo (`@thsottiaux`) are processed with rule-based classification, which always runs, and optionally with Gemini classification when configured.

- `off`: Rule-based classification only; Gemini is not called.
- `shadow`: Use the rule-based classification as the final result and save the Gemini result in the audit columns.
- `primary`: Use a valid successful Gemini result; fall back to rule-based classification when Gemini times out, is rate-limited, returns an invalid response, or encounters an API error.
- `hybrid`: Behaves the same as `primary`; retained as a backward-compatible name.

Gemini is called at most once per post, and automatic model fallback is not used. For configuration examples and details about saved classification statuses, see [Gemini classification modes and environment variables (Japanese)](docs/gemini-classification.md).

## Tech stack

- **Framework**: Next.js 15 (App Router), React 18, TypeScript
- **Data**: Supabase (PostgreSQL / RLS)
- **Monitoring**: Chrome Manifest V3 extension
- **Deployment**: Vercel

## Data flow

```text
Tibo's X profile
  → Manifest V3 monitoring extension
  → /api/webhook/tibo
  → Rule-based classification + optional Gemini classification
  → Supabase tibo_signals
  → Radar aggregation with reset history and status information
  → Next.js dashboard
```

## Local development

Prepare Node.js and pnpm (`package.json` specifies pnpm 11.18.0 through `packageManager`).

```bash
pnpm install
pnpm dev
```

The development server normally starts at `http://localhost:3000`. To try dynamic monitoring and classification, configure the Supabase, webhook, and Gemini environment variables outside the repository. See [Operations and recovery runbook (Japanese)](docs/operations/tibo-monitor-runbook.md) and [Gemini classification modes and environment variables (Japanese)](docs/gemini-classification.md).

## Detailed documentation

- [Gemini classification modes and environment variables (Japanese)](docs/gemini-classification.md)
- [AI classification comparison and audit SQL (Japanese)](docs/ai-classification-audit.md)
- [Tibo monitoring and reset history operations and recovery runbook (Japanese)](docs/operations/tibo-monitor-runbook.md)
- [Tibo X feed research (Japanese)](docs/tibo-x-feed-research.md)
- [Monitoring extension README (Japanese)](extension/tibo-monitor/README.md)

## Developer

I share development and personal project updates on X.

[Follow the developer on X](https://x.com/gussuri_s)

## 📄 License

This project is open-source under the [MIT License](LICENSE).
