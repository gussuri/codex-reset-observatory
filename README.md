# Codex Reset Observatory

Track and explain signals around Codex usage-limit resets.

This dashboard collects reset signals related to OpenAI Codex and ChatGPT Work usage limits, then combines them with reset history and status information to estimate and visualize reset probabilities.

[**Open the live observatory →**](https://codex.gussuriworks.com/en)

## Features

- 📊 **Reset probability estimates**: Estimate the probability of a reset within 24 or 48 hours by combining recent reset history, elapsed time, incident counts, and the volume of community reports.
- 📝 **Official signal monitoring**: Collect posts by Tibo (`@thsottiaux`) through a Chrome extension and webhook, then store classification results and audit information.
- 🌐 **Multilingual dashboard**: Supports Japanese (`ja`), English (`en`), and Chinese (`zh`), including automatic interpretation of time expressions.

## Public API

The observatory provides a read-only endpoint for the current reset status and probability estimates:

```text
GET https://codex.gussuriworks.com/api/current
```

Pass a locale when you want localized labels in the response:

```text
GET https://codex.gussuriworks.com/api/current?locale=en
```

`locale` supports `ja`, `en`, and `zh`. If it is omitted or unsupported, the response falls back to Japanese.

### Response

The response uses `schemaVersion: "public-v1"`. This is the API response schema version, not a forecast model version.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Version of the public response shape. |
| `checkedAt` | When the current data was checked. |
| `dataHealth` | Health and freshness information for the data sources. |
| `viewModel.probability12h` | Estimated probability within the next 12 hours. |
| `viewModel.probability24h` | Estimated probability within the next 24 hours. |
| `viewModel.probability48h` | Estimated probability within the next 48 hours. |
| `viewModel.probability72h` | Estimated probability within the next 72 hours. |

Probability values are numbers from `0.0` to `1.0`, not percentages. For example, `0.25` means `25%`.

### Example

Request:

```bash
curl "https://codex.gussuriworks.com/api/current?locale=en"
```

The following is an illustrative example only. The numbers are not a fixed or guaranteed forecast:

```json
{
  "schemaVersion": "public-v1",
  "checkedAt": "...",
  "dataHealth": { "overall": "ok" },
  "viewModel": {
    "probability12h": 0.03,
    "probability24h": 0.06,
    "probability48h": 0.19,
    "probability72h": 0.42
  }
}
```

### Caching and compatibility

The service uses a 10-minute shared calculation/cache cadence. Polling at intervals of 10 minutes or more is recommended; polling more often will normally not produce a newer forecast.

Clients should use `schemaVersion` and ignore unknown fields. Additive fields may be introduced over time.

### CORS

Server-side applications and native clients can consume the endpoint normally. Direct browser requests from another origin may be blocked by the browser because cross-origin access is not currently enabled.

This is an unofficial API. Forecasts are statistical estimates, not guarantees. Data may be delayed or temporarily unavailable. The service is provided on a best-effort basis without an SLA.

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

Install Node.js and pnpm (`package.json` specifies pnpm 11.18.0 through `packageManager`).

```bash
pnpm install
pnpm dev
```

The development server normally starts at `http://localhost:3000`. To try dynamic monitoring and classification, configure the Supabase, webhook, and Gemini environment variables outside the repository. See [Operations and recovery runbook (Japanese)](docs/operations/tibo-monitor-runbook.md) and [Gemini classification modes and environment variables (Japanese)](docs/gemini-classification.md).

## ビルド費用を抑える開発・公開方針

通常の修正はローカルで必要なテスト・lint・型確認・ビルドを完了し、関連する変更をまとめてpushします。細かい途中経過ごとのpushや、理由のない再デプロイを避けます。障害修正・誤情報の訂正・速報対応は遅らせません。

- 作業ブランチへのpushでPreview、mainへの反映でProductionのビルドが発生するため、両方を含めて公開回数を管理します。Previewは画面・連携・実行環境の確認が必要な変更で活用します。
- README・ドキュメント・テスト・オフライン評価だけの変更では、公開成果物やビルドへの依存がないことを確認し、不要なデプロイを省く対象とします。ファイル名だけで一律に除外しません。
- 文書のみの保存依頼では、差分確認までを行い、その保存のためだけに自動push・再デプロイしません。ユーザーがpush・公開を明示した場合はその指示を優先します。
- 自動ビルドの除外条件やPreviewの設定は、この方針を記載しただけでは変更されません。実際に設定する際は、本番コード・依存関係・設定の変更が正しくデプロイされることを確認します。
- コスト削減を理由に必要な品質確認を省略しません。APIのキャッシュは既存の共有処理・同時実行制御を確認し、実測した重複計算や不要なDB取得から改善します。速報の鮮度を保ちます。
- Vercel UsageでビルドCPU時間、実行時CPU・メモリ、転送量を別々に確認します。ビルドCPU時間は経過時間と異なり、付属クレジット消費額は追加請求額とは限りません。Supabaseの転送量・料金も別途確認します。

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
