# Random reset display-name v2 experiment

This is a read-only evaluation experiment. No generated name was written to Supabase, `reset_display_names`, production event history, classification, API, UI, or probability data.

- Prompt version: random-reset-name-v2-experiment
- Gemini model: gemini-3.5-flash-lite
- Temperature: 0.3
- Evaluation started: 2026-08-09T12:50:14.013Z
- Source data as of: 2026-08-09T12:50:13.540Z
- Eligible broad random reset candidates: 23
- Direct Tibo URL candidates: 6
- Evaluated cases with original post text: 1
- Request delay: 2500 ms; maximum retries per event: 2

## Input boundary

Gemini received only the exact Tibo post text and the post/completion timestamps. Existing human titles, `manual_name_ja`, `ai_name_ja`, prior generated names, translations, and later interpretations were not sent to Gemini. Each event received one generation request, with retries only for rate limits or temporary API failures.

## Result counts

- Total: 1
- Success: 1
- API failures (including timeout): 0
- HTTP 429 / rate limited: 0
- Invalid JSON: 0
- Invalid schema: 0

## Comparison list

| Case | Date | Gemini generated name | Existing display name | Status |
|---:|---|---|---|---|
| 1 | 2026-08-01T03:32:00.000Z | 爆速仕事ウィーク記念の制限解除リセット | Luna 10万スレッド到達・効率改善記念リセット | success |

### Case 1

日時: 2026-08-01T03:32:00.000Z

tweet_id: 2083395449814229287

source URL: https://x.com/thsottiaux/status/2083395449814229287

reasonType: ご祝儀リセット

resetMethod: 強制リセット

scope: 全有料プラン

Tibo原文:
> To celebrate a week of efficiency and let you run 100'000 Luna threads this weekend... that's right... wait for it... I have reset usage limits for Codex and ChatGPT Work.
>
> Enjoy.

Gemini生成名: **爆速仕事ウィーク記念の制限解除リセット**

Geminiの理由: 1週間の効率化を祝って、週末にLunaスレッドを大量に動かせるよう利用制限をリセットしたため。

既存表示名: Luna 10万スレッド到達・効率改善記念リセット

Status: success; attempts: 1; retries: 0
