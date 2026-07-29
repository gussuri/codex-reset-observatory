import type { WindowEventLike } from "../lib/radar/types";

export const LOCAL_MODEL_UPDATED_AT = "2026-07-29T13:09:00+09:00";
export const HISTORY_LIMIT = 5;
export const MANUAL_LAST_REGULAR_RESET_AT = null;
export const MANUAL_NEXT_REGULAR_RESET_AT = null;
export const MANUAL_NEXT_REGULAR_RESET_TIME_CONFIRMED = false;
export const MANUAL_SCHEDULE_ANCHOR_AT = null;

/**
 * 単一の信頼できる情報源 (Single Source of Truth)
 * 全27件のリセットイベント履歴（全体強制リセット・定期リセット・任意リセット権配布含む）
 * details.resetMethod 属性によって予測エンジンの起算点フィルター等に使用されます。
 */
export const LOCAL_RESET_HISTORY: Array<WindowEventLike> = [
  {
    "id": "local-codex-gpt56-sol-efficiency-reset-2026-07-29",
    "title": "GPT-5.6 Sol利用効率改善リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-28T14:00:00+09:00",
    "closed_at": "2026-07-29T13:09:00+09:00",
    "completed_at": "2026-07-29T13:09:00+09:00",
    "window_minutes": 1389,
    "scope": "全有料プラン",
    "summary": "Tibo氏よりGPT-5.6 Solモデルの消費効率改善（利用持続力約18%向上）の発表とともに、全ChatGPT WorkおよびCodexユーザーの利用上限が即時強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "詫びリセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "23時間9分",
      "noticeType": "匂わせ投稿あり",
      "note": "Tibo氏よりGPT-5.6 Solモデルの消費効率改善（利用持続力約18%向上）の発表とともに、全ChatGPT WorkおよびCodexユーザーの利用上限が即時強制リセットされました。"
    }
  },
  {
    "id": "local-codex-chatgpt-work-adoption-reset-2026-07-28",
    "title": "ChatGPT Work急速採用記念リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-28T09:27:00+09:00",
    "closed_at": "2026-07-28T12:09:00+09:00",
    "completed_at": "2026-07-28T12:09:00+09:00",
    "window_minutes": 162,
    "scope": "全有料プラン",
    "summary": "ChatGPT Workの急速な普及とチームの努力を祝し、CodexとChatGPT Work全体の利用上限が強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "2時間42分",
      "noticeType": "告知投稿あり",
      "note": "ChatGPT Workの急速な普及とチームの努力を祝し、CodexとChatGPT Work全体の利用上限が強制リセットされました。"
    }
  },
  {
    "id": "local-codex-outage-compensation-reset-2026-07-26",
    "title": "大規模障害に伴う詫びリセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-26T04:17:00+09:00",
    "closed_at": "2026-07-26T04:17:00+09:00",
    "completed_at": "2026-07-26T04:17:00+09:00",
    "window_minutes": 0,
    "scope": "全有料プラン",
    "summary": "世界規模で発生したシステム障害の復旧に伴い、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "詫びリセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "0分",
      "noticeType": "なし",
      "note": "世界規模で発生したシステム障害の復旧に伴い、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。"
    }
  },
  {
    "id": "local-codex-10m-users-reset-2026-07-22",
    "title": "1000万人アクティブユーザー記念リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-22T01:49:00+09:00",
    "closed_at": "2026-07-22T02:05:00+09:00",
    "completed_at": "2026-07-22T02:05:00+09:00",
    "window_minutes": 16,
    "scope": "全有料プラン",
    "summary": "アクティブユーザー数1000万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "16分",
      "noticeType": "告知投稿あり",
      "note": "アクティブユーザー数1000万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。"
    }
  },
  {
    "id": "local-codex-gpt-5-6-sol-release-reset-4-2026-07-18",
    "title": "GPT-5.6 Solリリース記念リセット（4回目）",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-18T12:31:00+09:00",
    "closed_at": "2026-07-18T12:31:00+09:00",
    "completed_at": "2026-07-18T12:31:00+09:00",
    "window_minutes": 0,
    "scope": "全有料プラン",
    "summary": "GPT-5.6 Solの追加調査・改善に伴い、ChatGPT WorkとCodex全体の利用上限が4回目に強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "0分",
      "noticeType": "なし",
      "note": "GPT-5.6 Solの追加調査・改善に伴い、ChatGPT WorkとCodex全体の利用上限が4回目に強制リセットされました。"
    }
  },
  {
    "id": "local-codex-9m-users-reset-2026-07-16",
    "title": "900万人アクティブユーザー記念リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-15T15:00:00+09:00",
    "closed_at": "2026-07-16T13:15:00+09:00",
    "completed_at": "2026-07-16T13:15:00+09:00",
    "window_minutes": 1335,
    "scope": "全有料プラン",
    "summary": "アクティブユーザー数900万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "22時間15分",
      "noticeType": "告知投稿あり",
      "note": "アクティブユーザー数900万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。"
    }
  },
  {
    "id": "local-codex-8m-users-reset-2026-07-15",
    "title": "800万人アクティブユーザー記念リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-15T04:34:00+09:00",
    "closed_at": "2026-07-15T05:45:00+09:00",
    "completed_at": "2026-07-15T05:45:00+09:00",
    "window_minutes": 71,
    "scope": "全有料プラン",
    "summary": "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "1時間11分",
      "noticeType": "告知投稿あり",
      "note": "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。"
    }
  },
  {
    "id": "personal-tibo-7m-users-banked-reset-2026-07-14",
    "title": "700万人アクティブユーザー記念任意リセット配布",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-13T07:00:00+09:00",
    "closed_at": "2026-07-14T03:40:00+09:00",
    "completed_at": "2026-07-14T03:40:00+09:00",
    "window_minutes": 0,
    "scope": "全有料プラン",
    "summary": "アクティブユーザー数700万人到達を記念し、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "任意リセット権1回配布",
      "scope": "全有料プラン",
      "noticeToExecution": "20時間40分",
      "noticeType": "告知投稿あり",
      "note": "アクティブユーザー数700万人到達を記念し、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。"
    }
  },
  {
    "id": "personal-tibo-500k-compensation-reset-2026-07-13",
    "title": "Web/モバイル機能不具合補償任意リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-13T07:00:00+09:00",
    "closed_at": "2026-07-13T07:00:00+09:00",
    "completed_at": "2026-07-13T07:00:00+09:00",
    "window_minutes": 0,
    "scope": "不具合対象ユーザー（約50万人）",
    "summary": "Web/モバイルからの任意リセット機能リリース時に、ボタンを押しても適用されなかった一部ユーザー（約50万人）に対して任意リセット（マニュアルリセット）1回分が補償配布されました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "詫びリセット",
      "resetMethod": "任意リセット権1回配布",
      "scope": "不具合対象ユーザー（約50万人）",
      "noticeToExecution": "0分",
      "noticeType": "なし",
      "note": "Web/モバイルからの任意リセット機能リリース時に、ボタンを押しても適用されなかった一部ユーザー（約50万人）に対して任意リセット（マニュアルリセット）1回分が補償配布されました。"
    }
  },
  {
    "id": "local-codex-6m-users-reset-2026-07-13",
    "title": "600万人アクティブユーザー記念リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-13T03:00:00+09:00",
    "closed_at": "2026-07-13T03:30:00+09:00",
    "completed_at": "2026-07-13T03:30:00+09:00",
    "window_minutes": 30,
    "scope": "全有料プラン",
    "summary": "アクティブユーザー数600万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "30分",
      "noticeType": "告知投稿あり",
      "note": "アクティブユーザー数600万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。"
    }
  },
  {
    "id": "local-codex-gpt-5-6-sol-release-reset-3-2026-07-11",
    "title": "GPT-5.6 Solリリース記念リセット（3回目）",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-11T00:00:00+09:00",
    "closed_at": "2026-07-11T15:00:00+09:00",
    "completed_at": "2026-07-11T15:00:00+09:00",
    "window_minutes": 900,
    "scope": "全有料プラン",
    "summary": "GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が3回目に強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "15時間",
      "noticeType": "告知投稿あり",
      "note": "GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が3回目に強制リセットされました。"
    }
  },
  {
    "id": "local-codex-gpt-5-6-sol-release-reset-2-2026-07-11",
    "title": "GPT-5.6 Solリリース記念リセット（2回目）",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-10T14:30:00+09:00",
    "closed_at": "2026-07-11T03:26:00+09:00",
    "completed_at": "2026-07-11T03:26:00+09:00",
    "window_minutes": 776,
    "scope": "全有料プラン",
    "summary": "GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が2回目に強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "12時間56分",
      "noticeType": "告知投稿あり",
      "note": "GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が2回目に強制リセットされました。"
    }
  },
  {
    "id": "local-codex-gpt-5-6-release-reset-2026-07-10",
    "title": "GPT-5.6リリース記念リセット",
    "kind": "window_closed",
    "status": "closed",
    "opened_at": "2026-07-10T04:09:00+09:00",
    "closed_at": "2026-07-10T07:00:00+09:00",
    "completed_at": "2026-07-10T07:00:00+09:00",
    "window_minutes": 171,
    "scope": "全有料プラン",
    "summary": "GPT-5.6のリリース記念として、全有料プランのCodex利用上限が強制的にリセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "3時間",
      "noticeType": "告知投稿あり",
      "note": "GPT-5.6のリリース記念として、全有料プランのCodex利用上限が強制的にリセットされました。"
    }
  },
  {
    "id": "local-codex-regular-reset-2026-07-07",
    "title": "定期リセット",
    "kind": "window_closed",
    "status": "closed",
    "opened_at": "2026-07-07T09:30:00+09:00",
    "closed_at": "2026-07-07T09:30:00+09:00",
    "completed_at": "2026-07-07T09:30:00+09:00",
    "window_minutes": 0,
    "window_human": "定期実施",
    "scope": "任意リセットを使っていないアカウント",
    "summary": "通常の1週間サイクルのタイミングで、有料プランのCodex利用上限リセットが実施されました。ただし、任意リセットを使用したアカウントは対象外となります。",
    "source_url": null,
    "details": {
      "cycleType": "定期リセット",
      "reasonType": "",
      "resetMethod": "強制リセット",
      "scope": "任意リセットを使っていないアカウント",
      "noticeToExecution": "定期",
      "note": "前回のリセットからこのタイミングまでに任意リセットを使用したアカウントは対象外で、使用したタイミングから1週間後にそれぞれリセットされます。"
    }
  },
  {
    "id": "personal-codex-reset-button-aie-2026-07-02",
    "title": "Codex reset button 配布 (AIE World's Fair 記念)",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-07-02T04:50:00+09:00",
    "closed_at": "2026-07-02T05:50:00+09:00",
    "completed_at": "2026-07-02T05:50:00+09:00",
    "window_minutes": 0,
    "scope": "全有料プラン",
    "summary": "AI Engineer World's Fair のデモにおいて Codex reset button が押され、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。",
    "source_url": "https://x.com/dkundel",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "ご祝儀リセット",
      "resetMethod": "任意リセット権1回配布",
      "scope": "全有料プラン",
      "noticeToExecution": "1時間",
      "noticeType": "告知投稿あり",
      "note": "AI Engineer World's Fair のデモにおいて Codex reset button が押され、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。"
    }
  },
  {
    "id": "local-codex-forced-reset-2026-06-30",
    "title": "臨時リセット",
    "kind": "window_closed",
    "status": "closed",
    "opened_at": "2026-06-30T08:50:00+09:00",
    "closed_at": "2026-06-30T09:30:00+09:00",
    "completed_at": "2026-06-30T09:30:00+09:00",
    "window_minutes": 40,
    "scope": "全有料プラン",
    "summary": "Tibo氏が1時間以内の再フルリセットを告知し、利用制限の過剰消費問題への補償対応として全有料プランのCodex利用制限が強制リセットされました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "詫びリセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "40分",
      "noticeType": "告知投稿あり",
      "note": "Tibo氏が1時間以内の再フルリセットを告知し、利用制限の過剰消費問題への補償対応として全有料プランのCodex利用制限が強制リセットされました。"
    }
  },
  {
    "id": "local-codex-forced-comp-reset-2026-06-29",
    "title": "過剰消費バグ調査・強制補償リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-06-29T09:00:00+09:00",
    "closed_at": "2026-06-29T09:00:00+09:00",
    "completed_at": "2026-06-29T09:00:00+09:00",
    "window_minutes": 0,
    "window_human": "強制実施 (即時)",
    "scope": "全有料プラン",
    "summary": "一部のユーザーでCodexの使用制限が過剰に消費される不具合が発生したため、その調査に伴い全ユーザーの利用制限が強制的にリセット（クリア）されました。",
    "source_url": "https://x.com/thsottiaux/status/2067711440019483321",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "詫びリセット",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "0分",
      "noticeType": "なし",
      "note": "一部のユーザーでCodexの使用制限が過剰に消費される不具合が発生したため、その調査に伴い全ユーザーの利用制限が強制的にリセット（クリア）されました。"
    }
  },
  {
    "id": "personal-compensation-reset-credit-2026-06-27",
    "title": "能力退化・過剰消費補償任意リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-06-27T08:41:00+09:00",
    "closed_at": "2026-06-27T12:00:00+09:00",
    "completed_at": "2026-06-27T12:00:00+09:00",
    "window_minutes": 0,
    "scope": "全有料プラン",
    "summary": "モデルの能力退化および過剰な利用制限消費不具合に対する補償として、全有料プランに任意リセット（マニュアルリセット）1回分が配布されました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "詫びリセット",
      "resetMethod": "任意リセット権1回配布",
      "scope": "全有料プラン",
      "noticeToExecution": "不明",
      "noticeType": "なし",
      "note": "モデルの能力退化および過剰な利用制限消費不具合に対する補償として、全有料プランに任意リセット（マニュアルリセット）1回分が配布されました。"
    }
  },
  {
    "id": "local-codex-regular-reset-2026-06-25",
    "title": "定期リセット",
    "kind": "window_closed",
    "status": "closed",
    "opened_at": "2026-06-22T13:27:58+09:00",
    "closed_at": "2026-06-25T07:01:00+09:00",
    "completed_at": "2026-06-25T07:01:00+09:00",
    "window_minutes": 3933,
    "window_human": "定期実施",
    "scope": "全有料プラン",
    "summary": "2026/06/25 07:01 JST に、通常の1週間サイクルとして全有料プランのCodex利用上限リセットが実施されました。",
    "source_url": null,
    "details": {
      "cycleType": "定期リセット",
      "reasonType": "",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "定期",
      "note": "通常の1週間サイクルのタイミングで、Codexの利用上限リセットが実施されました。"
    }
  },
  {
    "id": "local-codex-rate-limit-reset-notice-2026-06-17",
    "title": "定期リセット",
    "kind": "window_closed",
    "status": "closed",
    "opened_at": "2026-06-17T04:30:00+09:00",
    "closed_at": "2026-06-18T07:00:00+09:00",
    "completed_at": "2026-06-18T07:00:00+09:00",
    "window_minutes": 1590,
    "window_human": "定期実施",
    "scope": "全有料プラン",
    "summary": "通常の1週間サイクルのタイミングで、Codexの利用上限リセットが実施されました。あわせて、Codexの信頼性に影響する不具合への補償として任意リセット1回分も配布されました。",
    "source_url": "https://x.com/thsottiaux/status/2066956441173323943",
    "details": {
      "cycleType": "定期リセット",
      "reasonType": "",
      "resetMethod": "強制リセット",
      "scope": "全有料プラン",
      "noticeToExecution": "定期",
      "note": "通常の1週間サイクルのタイミングで、Codexの利用上限リセットが実施されました。"
    }
  },
  {
    "id": "personal-compensation-reset-credit-2026-06-18",
    "title": "Codex信頼性障害補償任意リセット",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-06-18T07:00:00+09:00",
    "closed_at": "2026-06-18T07:00:00+09:00",
    "completed_at": "2026-06-18T07:00:00+09:00",
    "window_minutes": 0,
    "scope": "全有料プラン",
    "summary": "Codexの信頼性に影響する不具合の補償として、全アカウントに対して任意リセット（マニュアルリセット）1回分が配布されました。",
    "source_url": "https://x.com/thsottiaux/status/2066956441173323943",
    "details": {
      "cycleType": "ランダムリセット",
      "reasonType": "詫びリセット",
      "resetMethod": "任意リセット権1回配布",
      "scope": "全有料プラン",
      "noticeToExecution": "0分",
      "noticeType": "なし",
      "note": "Codexの信頼性に影響する不具合の補償として、全アカウントに対して任意リセット（マニュアルリセット）1回分が配布されました。"
    }
  },
  {
    "id": "personal-reset-credit-2026-06-11",
    "title": "任意リセット配布",
    "kind": "reset_completed",
    "status": "closed",
    "opened_at": "2026-06-11T09:47:00+09:00",
    "closed_at": "2026-06-11T09:47:00+09:00",
    "completed_at": "2026-06-11T09:47:00+09:00",
    "window_minutes": 0,
    "scope": "全有料プラン",
    "summary": "招待特典または個人の利用制限の更新として、任意リセットが配布されました。",
    "source_url": "https://x.com/thsottiaux",
    "details": {
      "cycleType": "定期リセット",
      "reasonType": "",
      "resetMethod": "任意リセット権1回配布",
      "scope": "全有料プラン",
      "noticeToExecution": "不明",
      "note": "定期リセットが強制リセットから任意リセット権1回配布に変更されました。"
    }
  },
  {
    "id": "local-codex-reliability-compensation-2026-06-04",
    "title": "Codex 可靠性事故补偿重置",
    "kind": "reset_completed",
    "opened_at": "2026-06-04T08:25:58+08:00",
    "closed_at": "2026-06-04T08:25:58+08:00",
    "window_minutes": 0,
    "window_human": "无窗",
    "scope": "所有付费计划",
    "summary": "Tibo 表示过去 24 小时内有三次影响 Codex 可靠性的小事故，并已为所有付费计划重置 Codex 使用限制。",
    "source_url": "https://x.com/thsottiaux/status/2062329981548802523"
  },
  {
    "id": "local-5m-users-celebration-2026-05-31",
    "title": "500 万用户庆祝重置",
    "kind": "window_closed",
    "opened_at": "2026-05-31T13:59:10+08:00",
    "closed_at": "2026-05-31T23:25:06+08:00",
    "window_minutes": 565,
    "window_human": "9小时25分",
    "scope": "所有付费计划",
    "summary": "Tibo 将这次重置解释为庆祝 Codex 达到 500 万用户；随后确认所有付费 ChatGPT 订阅的周额度和 5 小时额度都已恢复到 100%。",
    "source_url": "https://x.com/thsottiaux/status/2061106703446450392"
  },
  {
    "id": "local-long-session-compression-compensation-2026-05-24",
    "title": "长会话压缩耗额异常补偿重置",
    "kind": "window_closed",
    "opened_at": "2026-05-23T08:21:33+08:00",
    "closed_at": "2026-05-24T04:14:35+08:00",
    "window_minutes": 1193,
    "window_human": "19小时53分",
    "scope": "Codex 用户",
    "summary": "Tibo 表示 Codex 长会话压缩的 cache hit rate 受回滚优化影响，导致限制消耗更快；修复后已为所有账号重置使用限制。",
    "source_url": "https://x.com/thsottiaux/status/2058280452851638313"
  },
  {
    "id": "local-sam-like-promise-reset-2026-05-20",
    "title": "Sam 点赞承诺速率限制重置",
    "kind": "window_closed",
    "opened_at": "2026-05-20T02:31:00+08:00",
    "closed_at": "2026-05-20T02:39:18+08:00",
    "window_minutes": 8,
    "window_human": "8分钟",
    "scope": "Codex 用户",
    "summary": "Sam 发文称推文获 1 个赞后 Tibo 会重置 Codex 速率限制，随后社区在数分钟内反馈重置完成。",
    "source_url": "https://x.com/bossnayamoss/status/2056806923391877438"
  },
  {
    "id": "local-gpt-55-degradation-compensation-2026-05-17",
    "title": "GPT-5.5 能力退化补偿重置",
    "kind": "window_closed",
    "opened_at": "2026-05-16T08:31:00+08:00",
    "closed_at": "2026-05-17T01:51:00+08:00",
    "window_minutes": 1040,
    "window_human": "17小时20分",
    "scope": "所有付费计划",
    "summary": "Tibo 表示两个 GPT-5.5 能力退化问题已修复后，付费计划的使用限制完成重置。",
    "source_url": "https://x.com/thsottiaux/status/2055707616605835333"
  }
];

/**
 * 後方互換用の参照（空配列または非互換対策）
 */
export const LOCAL_PERSONAL_RESET_HISTORY: Array<any> = [];
