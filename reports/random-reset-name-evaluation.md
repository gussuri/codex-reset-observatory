# Random reset display-name evaluation

This is a local, evaluation-only experiment. No generated name was written to Supabase, production UI, API, event history, or existing classification fields.

- Evaluation started: 2026-08-09T02:15:35.376Z
- Local data as of: 2026-08-09T02:15:35.375Z
- Gemini model: gemini-3.5-flash-lite
- Dataset source: data/resetHistory.ts (LOCAL_RESET_HISTORY)
- Candidate events after the shared random-reset eligibility filter: 20
- Gemini requests completed: 20
- Named results: 14
- Null results: 2
- Flagged results requiring human review: 2
- Status counts: success=16, rate_limited=4

## Safety and input boundary

The shared `isEligibleRandomResetEvent` and `getCompletedResetTimestamp` helpers select completed, broad-scope random events. Existing display titles, IDs, and human-assigned names are intentionally omitted from Gemini input. The local fixture has no raw Tibo post body for these rows, so the prompt explicitly marks post text as unavailable rather than reconstructing it from a URL.

## Summary table

| # | completed at | recorded facts | Gemini name | confidence | evidence | status |
|---:|---|---|---|---:|---|---|
| 1 | 2026-08-01T03:32:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | null | 0.00 |  | success |
| 2 | 2026-07-29T04:09:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | GPT-5.6 Sol消費効率改善ご祝儀リセット | 0.90 | Tibo氏よりGPT-5.6 Solモデルの消費効率改善（利用持続力約18%向上）の発表とともに、全ChatGPT WorkおよびCodexユーザーの利用上限が即時強制リセットされました。 | success |
| 3 | 2026-07-28T03:09:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | ご祝儀強制リセット | 0.90 | Recorded reason type: ご祝儀リセット, Reset delivery method: 強制リセット | success |
| 4 | 2026-07-25T19:17:00.000Z | 詫びリセット / 強制リセット / 全有料プラン | 世界規模システム障害復旧に伴う全体リセット | 0.90 | 世界規模で発生したシステム障害の復旧に伴い、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。 | success |
| 5 | 2026-07-21T17:05:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | アクティブユーザー数1000万人到達記念リセット | 0.95 | アクティブユーザー数1000万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。 | success |
| 6 | 2026-07-18T03:31:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | GPT-5.6 Sol追加調査のご祝儀リセット | 0.90 | GPT-5.6 Solの追加調査・改善に伴い、ChatGPT WorkとCodex全体の利用上限が4回目に強制リセットされました。 | success |
| 7 | 2026-07-16T04:15:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | アクティブユーザー数900万人到達記念リセット | 0.90 | アクティブユーザー数900万人到達を記念し | success |
| 8 | 2026-07-14T20:45:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | アクティブユーザー数800万人到達記念リセット | 0.90 | アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。 | success |
| 9 | 2026-07-13T18:40:00.000Z | ご祝儀リセット / 任意リセット権1回配布 / 全有料プラン | アクティブユーザー数700万人到達記念リセット | 1.00 | アクティブユーザー数700万人到達を記念し、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。 | success |
| 10 | 2026-07-12T18:30:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | 600万人到達記念ご祝儀リセット | 0.95 | アクティブユーザー数600万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。 | success |
| 11 | 2026-07-11T06:00:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | GPT-5.6 Solリリース記念利用上限リセット | 0.95 | Recorded event summary: GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が3回目に強制リセットされました。 | success |
| 12 | 2026-07-10T18:26:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | GPT-5.6 Solリリース記念ご祝儀リセット | 1.00 | GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が2回目に強制リセットされました。 | success |
| 13 | 2026-07-09T22:00:00.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | GPT-5.6リリース記念全有料プラン強制リセット | 0.90 | GPT-5.6のリリース記念として、全有料プランのCodex利用上限が強制的にリセットされました。 | success |
| 14 | 2026-07-01T20:50:00.000Z | ご祝儀リセット / 任意リセット権1回配布 / 全有料プラン | AI Engineer World's Fair ご祝儀リセット | 0.90 | AI Engineer World's Fair のデモにおいて Codex reset button が押され、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。 | success |
| 15 | 2026-06-30T00:30:00.000Z | 詫びリセット / 強制リセット / 全有料プラン | 全有料プラン補償強制リセット | 0.90 | Tibo氏が1時間以内の再フルリセットを告知し、利用制限の過剰消費問題への補償対応として全有料プランのCodex利用制限が強制リセットされました。 | success |
| 16 | 2026-06-29T00:00:00.000Z | 詫びリセット / 強制リセット / 全有料プラン | null | 0.00 |  | success |
| 17 | 2026-06-27T03:00:00.000Z | 詫びリセット / 任意リセット権1回配布 / 全有料プラン | (no valid result) |  |  | rate_limited |
| 18 | 2026-06-17T22:00:00.000Z | 詫びリセット / 任意リセット権1回配布 / 全有料プラン | (no valid result) |  |  | rate_limited |
| 19 | 2026-06-04T00:25:58.000Z | 詫びリセット / 強制リセット / 全有料プラン | (no valid result) |  |  | rate_limited |
| 20 | 2026-05-31T15:25:06.000Z | ご祝儀リセット / 強制リセット / 全有料プラン | (no valid result) |  |  | rate_limited |

## Per-event details

### Event 1 (2026-08-01T03:32:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 匂わせ投稿あり / 22時間42分
- Summary: Tibo氏より今週の利用効率改善を記念し、週末に10万件のLunaスレッドを実行できるようCodexおよびChatGPT Workの利用上限が全ユーザー強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux/status/2083395449814229287
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: null
- Confidence: 0.000
- Evidence: null
- Evidence grounded in supplied fields: n/a
- Reason: 提供された記録には固有の固有名詞や識別可能な名称が含まれておらず、分類ラベルのみであるため名称を生成できません。
- Review flags: none

### Event 2 (2026-07-29T04:09:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 匂わせ投稿あり / 23時間9分
- Summary: Tibo氏よりGPT-5.6 Solモデルの消費効率改善（利用持続力約18%向上）の発表とともに、全ChatGPT WorkおよびCodexユーザーの利用上限が即時強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: GPT-5.6 Sol消費効率改善ご祝儀リセット
- Confidence: 0.900
- Evidence: Tibo氏よりGPT-5.6 Solモデルの消費効率改善（利用持続力約18%向上）の発表とともに、全ChatGPT WorkおよびCodexユーザーの利用上限が即時強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: イベント概要に記載されたモデル名、改善内容、ご祝儀リセットの事実に基づいて簡潔に命名しました。
- Review flags: none

### Event 3 (2026-07-28T03:09:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 匂わせ投稿あり / 2時間42分
- Summary: ChatGPT Workの急速な普及とチームの努力を祝し、CodexとChatGPT Work全体の利用上限が強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: ご祝儀強制リセット
- Confidence: 0.900
- Evidence: Recorded reason type: ご祝儀リセット, Reset delivery method: 強制リセット
- Evidence grounded in supplied fields: no
- Reason: 記録された理由と配信方法の事実に基づき、特徴を簡潔に表す名称としました。
- Review flags: ungrounded_evidence

### Event 4 (2026-07-25T19:17:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: 詫びリセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: なし / 0分
- Summary: 世界規模で発生したシステム障害の復旧に伴い、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: 世界規模システム障害復旧に伴う全体リセット
- Confidence: 0.900
- Evidence: 世界規模で発生したシステム障害の復旧に伴い、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: 記録されたイベントサマリーに記載されている発生事由とリセット対象を簡潔にまとめています。
- Review flags: none

### Event 5 (2026-07-21T17:05:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: なし / 0分
- Summary: アクティブユーザー数1000万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: アクティブユーザー数1000万人到達記念リセット
- Confidence: 0.950
- Evidence: アクティブユーザー数1000万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: 記録されたイベント概要に「アクティブユーザー数1000万人到達を記念し」と明記されているため、これを基に識別しやすい名称を作成しました。
- Review flags: none

### Event 6 (2026-07-18T03:31:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: なし / 0分
- Summary: GPT-5.6 Solの追加調査・改善に伴い、ChatGPT WorkとCodex全体の利用上限が4回目に強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: GPT-5.6 Sol追加調査のご祝儀リセット
- Confidence: 0.900
- Evidence: GPT-5.6 Solの追加調査・改善に伴い、ChatGPT WorkとCodex全体の利用上限が4回目に強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: イベント概要に記載されているGPT-5.6 Solの追加調査とご祝儀リセットの事実に基づき、履歴一覧で識別しやすい簡潔な名称を作成しました。
- Review flags: none

### Event 7 (2026-07-16T04:15:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 匂わせ投稿あり / 22時間15分
- Summary: アクティブユーザー数900万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: アクティブユーザー数900万人到達記念リセット
- Confidence: 0.900
- Evidence: アクティブユーザー数900万人到達を記念し
- Evidence grounded in supplied fields: yes
- Reason: 記録されたイベント概要にユーザー数到達の記念であることが明記されているため。
- Review flags: none

### Event 8 (2026-07-14T20:45:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 匂わせ投稿あり / 14時間53分
- Summary: アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: アクティブユーザー数800万人到達記念リセット
- Confidence: 0.900
- Evidence: アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: 記録されたイベントサマリーにアクティブユーザー数800万人到達を記念したリセットであることが明記されているため。
- Review flags: none

### Event 9 (2026-07-13T18:40:00.000Z)

Recorded facts sent to Gemini:

- Classification: banked_distribution
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 任意リセット権1回配布
- Scope: 全有料プラン
- Notice: なし / 0分
- Summary: アクティブユーザー数700万人到達を記念し、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: アクティブユーザー数700万人到達記念リセット
- Confidence: 1.000
- Evidence: アクティブユーザー数700万人到達を記念し、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。
- Evidence grounded in supplied fields: yes
- Reason: イベントの直接的な事実であるアクティブユーザー数700万人到達を記念したリセットであることが明記されているため。
- Review flags: none

### Event 10 (2026-07-12T18:30:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: なし / 0分
- Summary: アクティブユーザー数600万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: 600万人到達記念ご祝儀リセット
- Confidence: 0.950
- Evidence: アクティブユーザー数600万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: 記録されたイベント概要に「アクティブユーザー数600万人到達」と「ご祝儀リセット」の事実が含まれており、それらを組み合わせて簡潔な表示名を作成できるため。
- Review flags: none

### Event 11 (2026-07-11T06:00:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 告知投稿あり / 24時間30分
- Summary: GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が3回目に強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: GPT-5.6 Solリリース記念利用上限リセット
- Confidence: 0.950
- Evidence: Recorded event summary: GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が3回目に強制リセットされました。
- Evidence grounded in supplied fields: no
- Reason: 記録されたイベント概要にGPT-5.6 Solのリリース記念によるリセットであることが明記されているため。
- Review flags: ungrounded_evidence

### Event 12 (2026-07-10T18:26:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 告知投稿あり / 12時間56分
- Summary: GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が2回目に強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: GPT-5.6 Solリリース記念ご祝儀リセット
- Confidence: 1.000
- Evidence: GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が2回目に強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: イベント概要に記載されているGPT-5.6 Solのリリース記念およびご祝儀リセットの事実に基づき、履歴一覧に適した短い名称を生成しました。
- Review flags: none

### Event 13 (2026-07-09T22:00:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 告知投稿あり / 1時間
- Summary: GPT-5.6のリリース記念として、全有料プランのCodex利用上限が強制的にリセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: GPT-5.6リリース記念全有料プラン強制リセット
- Confidence: 0.900
- Evidence: GPT-5.6のリリース記念として、全有料プランのCodex利用上限が強制的にリセットされました。
- Evidence grounded in supplied fields: yes
- Reason: 提供されたイベント概要に基き、リセットの目的と対象を簡潔に表す名称を作成しました。
- Review flags: none

### Event 14 (2026-07-01T20:50:00.000Z)

Recorded facts sent to Gemini:

- Classification: banked_distribution
- Status: closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 任意リセット権1回配布
- Scope: 全有料プラン
- Notice: 告知投稿あり / 1時間
- Summary: AI Engineer World's Fair のデモにおいて Codex reset button が押され、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。
- Source URL metadata: https://x.com/dkundel
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: AI Engineer World's Fair ご祝儀リセット
- Confidence: 0.900
- Evidence: AI Engineer World's Fair のデモにおいて Codex reset button が押され、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。
- Evidence grounded in supplied fields: yes
- Reason: イベント名とご祝儀リセットの理由が明確に記録されているため。
- Review flags: none

### Event 15 (2026-06-30T00:30:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: 詫びリセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 告知投稿あり / 40分
- Summary: Tibo氏が1時間以内の再フルリセットを告知し、利用制限の過剰消費問題への補償対応として全有料プランのCodex利用制限が強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: 全有料プラン補償強制リセット
- Confidence: 0.900
- Evidence: Tibo氏が1時間以内の再フルリセットを告知し、利用制限の過剰消費問題への補償対応として全有料プランのCodex利用制限が強制リセットされました。
- Evidence grounded in supplied fields: yes
- Reason: 利用制限の過剰消費問題に対する補償として全有料プランを対象に行われた強制リセットであることが記録されているため。
- Review flags: none

### Event 16 (2026-06-29T00:00:00.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: 詫びリセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: なし / 0分
- Summary: 一部のユーザーでCodexの使用制限が過剰に消費される不具合が発生したため、その調査に伴い全ユーザーの利用制限が強制的にリセット（クリア）されました。
- Source URL metadata: https://x.com/thsottiaux/status/2067711440019483321
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: success
- Name: null
- Confidence: 0.000
- Evidence: null
- Evidence grounded in supplied fields: n/a
- Reason: 提供された記録された事実に固有の名称や固有名詞が含まれておらず、サポート可能な識別名を作成できないため。
- Review flags: none

### Event 17 (2026-06-27T03:00:00.000Z)

Recorded facts sent to Gemini:

- Classification: banked_distribution
- Status: closed
- Cycle: ランダムリセット
- Reason: 詫びリセット
- Method: 任意リセット権1回配布
- Scope: 全有料プラン
- Notice: 告知投稿あり / 1時間
- Summary: モデルの能力退化および過剰な利用制限消費不具合に対する補償として、全有料プランに任意リセット（マニュアルリセット）1回分が配布されました。
- Source URL metadata: https://x.com/thsottiaux
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: rate_limited
- Name: null
- Confidence: null
- Evidence: null
- Evidence grounded in supplied fields: n/a
- Reason: null
- Review flags: none

### Event 18 (2026-06-17T22:00:00.000Z)

Recorded facts sent to Gemini:

- Classification: banked_distribution
- Status: closed
- Cycle: ランダムリセット
- Reason: 詫びリセット
- Method: 任意リセット権1回配布
- Scope: 全有料プラン
- Notice: なし / 0分
- Summary: Codexの信頼性に影響する不具合の補償として、全アカウントに対して任意リセット（マニュアルリセット）1回分が配布されました。
- Source URL metadata: https://x.com/thsottiaux/status/2066956441173323943
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: rate_limited
- Name: null
- Confidence: null
- Evidence: null
- Evidence grounded in supplied fields: n/a
- Reason: null
- Review flags: none

### Event 19 (2026-06-04T00:25:58.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: closed
- Cycle: ランダムリセット
- Reason: 詫びリセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 告知投稿あり / 0分
- Summary: 過去24時間以内に発生したCodexの信頼性に影響する3件の障害への補償として、全有料プランの利用制限がリセットされました。
- Source URL metadata: https://x.com/thsottiaux/status/2062329981548802523
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: rate_limited
- Name: null
- Confidence: null
- Evidence: null
- Evidence grounded in supplied fields: n/a
- Reason: null
- Review flags: none

### Event 20 (2026-05-31T15:25:06.000Z)

Recorded facts sent to Gemini:

- Classification: confirmed_global
- Status: window_closed
- Cycle: ランダムリセット
- Reason: ご祝儀リセット
- Method: 強制リセット
- Scope: 全有料プラン
- Notice: 告知投稿あり / 9時間25分
- Summary: Codexアクティブユーザー数500万人達成を記念し、全有料ChatGPT/Codexユーザーの利用回数が強制リセットされました。
- Source URL metadata: https://x.com/thsottiaux/status/2061106703446450392
- Raw Tibo post text: unavailable in local fixture

Gemini result:

- Status: rate_limited
- Name: null
- Confidence: null
- Evidence: null
- Evidence grounded in supplied fields: n/a
- Reason: null
- Review flags: none

## Evaluation notes

Review clear-feature events, ambiguous events, and low-information events separately. A generated name that introduces a model, milestone, cause, or official-sounding event not present in the recorded facts should be treated as a hallucination even when the JSON schema is valid.

No production adoption decision is made by this script.
