# Random reset display-name evaluation: round 2

This is a paired, evaluation-only experiment. Condition A uses the Round 1 metadata-only prompt. Condition B appends only the matched raw Tibo post as `source_post_text`. The two requests are independent and use the same model, system prompt, structured response shape, and temperature as Round 1.

No generated name was written to Supabase, the production UI, the public API, event history, or existing classification fields. The Supabase query was read-only.

- Evaluation started: 2026-08-09T02:53:07.616Z
- Local data as of: 2026-08-09T02:53:07.359Z
- Gemini model: gemini-3.5-flash-lite
- Eligible random event candidates: 23
- Direct Tibo URL candidates: 6
- Paired events with a reliable source row: 1
- Maximum paired events: 16
- Request delay: 5000 ms; maximum rate-limit retries: 3

## Conditions and input boundary

A: recorded metadata only. B: the same metadata followed by the exact raw text from the matched Tibo row. Existing display names, event IDs, later interpretations, translations, and web context are not sent to Gemini. Ambiguous duplicate source IDs, non-Tibo URLs, replies, missing text, invalid timestamps, and source posts more than five minutes after completion are excluded from the paired sample. The five-minute bound only absorbs the static fixture's minute-level completion timestamp precision.

## Condition metrics

| condition | requests | success | name | null | review | avg confidence | 429 | other failure |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A metadata only | 1 | 1 | 1 | 0 | 0 | 0.900 | 0 | 0 |
| B metadata + source | 1 | 1 | 1 | 0 | 0 | 0.900 | 0 | 0 |

## Paired comparison

- Successful paired outputs: 1
- Same name: 0
- Changed name: 1
- A null -> B name: 0
- A name -> B null: 0
- Both null: 0
- One-sided failure: 0
- Both failed: 0

## Side-by-side results

Human scoring is intentionally blank for manual review: identifiability, brevity, evidence fidelity, and abstention ability use 0/1/2.

| event | completed at | event facts | A name | A conf | A evidence | B name | B conf | B evidence | A review (I/B/E/A) | B review (I/B/E/A) |
|---|---|---|---|---:|---|---|---:|---|---|---|
| local-luna-100k-threads-efficiency-reset-2026-08-01 | 2026-08-01T03:32:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | Tibo氏によるご祝儀リセット | 0.90 | Tibo氏より今週の利用効率改善を記念し、週末に10万件のLunaスレッドを実行できるようCodexおよびChatGPT Workの利用上限が全ユーザー強制リセットされました。 | Tibo氏による利用効率改善記念の強制リセット | 0.90 | Tibo氏より今週の利用効率改善を記念し、週末に10万件のLunaスレッドを実行できるようCodexおよびChatGPT Workの利用上限が全ユーザー強制リセットされました。 |  |  |

## Per-event details

### local-luna-100k-threads-efficiency-reset-2026-08-01 (2026-08-01T03:32:00.000Z)

- Source URL: https://x.com/thsottiaux/status/2083395449814229287
- Source tweet created at: 2026-08-01T03:32:37+00:00
- Raw Tibo post text used only in B: To celebrate a week of efficiency and let you run 100'000 Luna threads this weekend... that's right... wait for it... I have reset usage limits for Codex and ChatGPT Work.

Enjoy.
- Recorded facts: Tibo氏より今週の利用効率改善を記念し、週末に10万件のLunaスレッドを実行できるようCodexおよびChatGPT Workの利用上限が全ユーザー強制リセットされました。

#### metadata_only

- Status: success
- Attempts: 1; retries: 0
- Name: Tibo氏によるご祝儀リセット
- Confidence: 0.900
- Evidence: Tibo氏より今週の利用効率改善を記念し、週末に10万件のLunaスレッドを実行できるようCodexおよびChatGPT Workの利用上限が全ユーザー強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: イベント概要にTibo氏によるご祝儀リセットであることが明確に記載されているため。
- Review flags: none

#### metadata_plus_source

- Status: success
- Attempts: 1; retries: 0
- Name: Tibo氏による利用効率改善記念の強制リセット
- Confidence: 0.900
- Evidence: Tibo氏より今週の利用効率改善を記念し、週末に10万件のLunaスレッドを実行できるようCodexおよびChatGPT Workの利用上限が全ユーザー強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: 記録されたイベントサマリーに記載されている、リセットの主体と目的（Tibo氏による利用効率改善記念）を簡潔に反映した名称であるため。
- Review flags: none

## Review observations

The script does not automatically conclude that condition B is better. Human review should focus on whether the raw post improves identifiability without adding unsupported facts, whether null is used appropriately, and whether evidence remains a literal supplied substring.

Rows with `needsHumanReview=true` or a non-success status require manual inspection. Suspicious output flags include ungrounded evidence, classification-only names, unprovided model/count terms, and unsupported official claims.
