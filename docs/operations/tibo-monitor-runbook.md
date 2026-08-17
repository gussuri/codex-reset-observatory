# Tibo監視とリセット履歴更新の運用・復旧手順

この手順書は、Tibo氏（`@thsottiaux`）のX投稿を監視し、Codex Reset Observatoryへ保存・反映する現在の運用をまとめたものです。

標準手順は、リポジトリの `extension/tibo-monitor/` にあるChrome Manifest V3拡張機能を使う方法です。`scripts/tibo-monitor.user.js` のTampermonkey版は別実装で、10分ごとのプロフィール自動再読み込みは行いません。

## 1. 自動監視が動く条件

次の条件がすべてそろっている必要があります。

- PCが起動している
- Chromeが起動している
- Tibo氏のプロフィールタブ（`https://x.com/thsottiaux` または `https://twitter.com/thsottiaux`）と、返信タブ（`/with_replies`）を必要に応じて開いている
- PCがスリープしていない
- Xの投稿が翻訳表示ではなく、英語の原文表示になっている
- 拡張機能が有効で、オプションにWebhook Secretと観測所ドメインが設定されている

Chromeの通知ページは投稿スキャンの対象になり得ます。通常運用ではプロフィールと返信の2タブを開いておくと、通常投稿と他ユーザーへの返信を両方監視できます。片方だけでも、開いているタブの監視は継続します。

## 2. 通常の自動処理

1. Service WorkerのChrome Alarmが約10分ごとに動きます。
2. プロフィールと返信の各URLについて、見つかったタブを最大1つずつ再読み込みします。タブを自動で新規作成・閉鎖することはありません。再読み込み後のContent Scriptが、表示中の投稿DOMをスキャンします。
3. 投稿の追加・更新はMutationObserverで検知し、念のため60秒ごとの再スキャンも行います。
4. `@thsottiaux/status/{tweet_id}` の正規URL、本文、`time`要素の投稿日時を取得します。返信タブでは、Xの「Replying to / 返信先 / 回复给」領域、または子側のincoming connectorと直前の親cell側のoutgoing connectorが両方確認できる場合に返信先を復元します。後者では、親cell自身の本文とauthorだけを親文脈として保存します。
5. 投稿はService Workerで直列化・重複排除され、`/api/webhook/tibo`へ送信されます。2xx応答後に処理済みIDがChromeのローカル保存へ追加されます。
6. Webhookはルール分類を行い、`GEMINI_CLASSIFICATION_MODE` が `off` 以外ならGemini分類も1投稿につき最大1回実行します。
7. `primary`（または後方互換の `hybrid`）では、Geminiの有効な成功結果を最終分類に採用し、失敗時だけルール分類へfallbackします。
8. 分類結果と監査列がSupabaseの `tibo_signals` にtweet_id単位でupsertされます。返信は収集・保存・分類の対象ですが、返信であること自体はシグナルを強めず、正式リセット履歴・公開確率へは自動反映しません。
9. 返信でない投稿のうち、条件を満たす `reset_executed` は次回のレーダーデータ取得で正式リセット履歴へ自動統合されます。正式採用は `confirmed` へ自動変更する処理ではなく、`auto_unverified` のままでも採用条件を満たせば反映されます。

正式履歴の採用条件は、返信でないこと、`signal_type=reset_executed`、confidence 0.95以上、`verification_status` が `rejected` ではないことに加え、`classification_source` が `gemini`、`rule`、`shadow`、または `rule_fallback` のいずれかであることです。`verification_status=confirmed` の行でも返信は採用されません。`expires_at` は正式履歴の判定には使いません。

正式履歴は静的な `data/resetHistory.ts` と統合されます。同じtweet_id・URL、または強制リセットの実施時刻が5分以内の重複は1件にまとめられます。Webhook成功後も表示側のキャッシュにより、反映まで最大およそ60秒かかることがあります。

## 3. プロフィールまたは返信タブを閉じていた場合

対象タブが無い場合、その種類の10分アラームはページを再読み込みしません。このとき拡張機能のローカル診断に `sourceTimeline=profile` または `sourceTimeline=with_replies` とともに `monitored_tab_missing` が保存されます。プロフィールが無くても返信タブがあれば、返信タブの監視は継続します。前回の成功した再読み込み時刻は上書きされません。

復旧するには次の順で操作します。

1. 通常投稿を確認する場合は `https://x.com/thsottiaux`、返信を確認する場合は `https://x.com/thsottiaux/with_replies` を開く。`twitter.com`側も同じパスで利用できます。
2. 対象投稿までスクロールして、投稿本文を画面上に読み込む。
3. 「翻訳を表示」ではなく「原文を表示」の状態に戻す。
4. 10〜60秒待つ。初回DOMスキャン、MutationObserver、60秒ポーリングのいずれかで送信されます。
5. 投稿が処理済みIDに入っていない場合、Webhookの2xx応答後にSupabaseへ保存されます。両タブに同じ投稿が現れてもtweet_idで1回だけ処理されます。

タブを開くだけでは過去の投稿すべてをAPIから取得する仕組みではありません。画面上に読み込まれていない投稿は、対象位置までスクロールしてください。

## 4. Supabaseでの確認方法

投稿単位の分類・履歴反映は `public.tibo_signals` で確認します。SQL Editorでは次の列を確認します。

```sql
SELECT
  tweet_id,
  signal_type,
  classification_source,
  ai_classification_status,
  ai_model,
  verification_status,
  tweet_created_at,
  is_reply,
  reply_to_handles,
  reply_context_text,
  source_timeline
FROM public.tibo_signals
WHERE tweet_id = '投稿ID'
LIMIT 1;
```

確認する列の意味は次のとおりです。

- `tweet_id`: X投稿のID。Webhookの重複排除・upsertキーです。
- `signal_type`: 最終採用された `reset_executed`、`official_notice`、`teaser`、`irrelevant`。
- `classification_source`: `gemini`、`rule_fallback`、`shadow`、`rule` のいずれか。
- `ai_classification_status`: Geminiの `success`、`timeout`、`rate_limited`、`invalid_json`、`invalid_schema`、`invalid_evidence`、`api_error`、`model_not_configured`、`skipped` など。
- `ai_model`: 実際に呼び出したGeminiモデル名。Geminiを呼ばなかった場合は空です。
- `verification_status`: `auto_unverified`、`confirmed`、`rejected`。自動処理は通常 `auto_unverified` で保存されます。
- `tweet_created_at`: 投稿本文から取得したX投稿時刻。履歴の実施時刻の基準です。
- `is_reply`: Tibo氏自身の返信投稿なら `true`。返信も保存・分類しますが、正式履歴・公開確率には自動反映しません。
- `reply_to_handles`: Xの返信先領域から取得した安全なハンドル配列です。取得できない場合は空です。
- `reply_context_text`: 明示的な返信先領域、またはconnectorで確実に対応付けた親article自身の本文だけが入り、取得できない場合は空です。
- `source_timeline`: `profile` または `with_replies`。どの監視タブで取得したかを示します。
- `is_quote`: Xが同じ記事内に引用投稿を明示した場合に `true` です。引用カードの取得失敗は通常投稿の収集を妨げません。
- `quote_context_text`: 同じ記事内で明確に表示された引用本文だけが入り、取得できない場合は空です。
- `quote_tweet_url` / `quote_author_handle`: 安全なXのstatus URLから取得できた引用元のURLとハンドルです。

監視の稼働状態は `public.tibo_heartbeat` の `id='main'` を確認します。`last_heartbeat_at`、`last_successful_parse_at`、`last_seen_tweet_id`、`last_scan_error`、`last_page_reload_at`、`last_page_reload_status`、`last_page_reload_error` が手掛かりになります。プロフィールと返信のどちらが不足・停滞しているかは、拡張機能オプションのローカル診断ログで `sourceTimeline` と `monitored_tab_missing` / `timeline_stalled` を確認します。

## 5. 監視ヘルスチェックとアラート

本番の監視ヘルスエンドポイントは `GET https://codex.gussuriworks.com/api/monitor/health` です。呼び出しには `Authorization: Bearer <CRON_SECRET>` が必要です。秘密値そのものをIssue、ログ、手順書、チャットへ貼り付けないでください。

正常と判定されるには、`last_heartbeat_at` と `last_successful_parse_at` の両方が現在から15分以内であり、`last_scan_error` がnull、かつ `last_page_reload_status` が `success` またはnullである必要があります。タイムスタンプの欠落・形式不正、15分超過、スキャンエラー、またはそれ以外のページ再読み込みステータスは異常です。正常時だけHTTP 200になり、異常・設定不足・データベース読み取り失敗時はHTTP 503になります。応答には安全な状態と理由だけが含まれ、生のエラー本文は含まれません。

`.github/workflows/tibo-monitor-health.yml` は10分ごとと手動実行時に本番エンドポイントを確認します。GitHub Actionsの `CRON_SECRET` は本番環境の `CRON_SECRET` と一致させます。HTTP 200以外はワークフロー失敗として扱います。

`.github/workflows/notify-workflow-failures.yml` はmain上の `CI` と `Tibo monitor health` の完了を監視します。失敗またはキャンセル時は、ワークフロー名ごとに開いているIssueがなければ1件だけ作成します。同じ障害が続く間は追加Issueや重複通知を作りません。後続の成功時は既存Issueへ復旧コメントを追加して閉じます。Issueにはワークフロー名、結論、ブランチ、コミット、実行URLだけを記録します。

## 6. 正常時とfallback時の期待値

本番の推奨設定は `GEMINI_CLASSIFICATION_MODE=primary` です。

| 状態 | `ai_classification_status` | `classification_source` | 最終分類 |
| --- | --- | --- | --- |
| Gemini正常 | `success` | `gemini` | Geminiのsignal_typeとconfidence |
| Gemini失敗 | `timeout`、`rate_limited`、`invalid_json`、`invalid_schema`、`invalid_evidence`、`api_error`、`model_not_configured` など | `rule_fallback` | ルール分類のsignal_typeとconfidence |
| Geminiを無効化 | `skipped` | `rule` | ルール分類 |
| Shadow監査 | 成功または失敗 | `shadow` | ルール分類。Geminiは監査列だけ |

Geminiの失敗で投稿全体を `irrelevant` にすることはありません。`primary` では必ずルール分類を保存します。`reset_executed` が正式履歴に採用されるかは、最終分類のconfidence、verification_status、classification_sourceの組み合わせで決まります。

## 7. 誤判定の修正方法

SupabaseのSQL Editorなど、管理権限のある場所で対象行の `verification_status` を更新します。行自体は削除しません。

### 正式履歴と予測から除外する場合

```sql
UPDATE public.tibo_signals
SET verification_status = 'rejected'
WHERE tweet_id = '投稿ID';
```

`rejected` の行は正式履歴、最新リセット、確率計算から除外されます。監査用の分類結果・本文・時刻は残ります。キャッシュのため、画面から消えるまで最大およそ60秒かかる場合があります。

### 明示的に正式採用する場合

```sql
UPDATE public.tibo_signals
SET verification_status = 'confirmed'
WHERE tweet_id = '投稿ID';
```

`confirmed` は明示的な採用意思を記録します。ただし、正式履歴にするには対象行が `reset_executed` でconfidence 0.95以上である必要があります。

## 8. 手動Webhook送信

自動監視が間に合わなかった投稿は、次のPowerShell例でWebhookへ送信できます。実際の秘密値やAPIキーはコマンド・リポジトリ・手順書へ書きません。

```powershell
$secret = $env:TIBO_WEBHOOK_SECRET
if (-not $secret) {
  $secret = Read-Host "TIBO_WEBHOOK_SECRET"
}

$body = @{
  tweetId        = "投稿ID"
  text           = "投稿本文（原文）"
  tweetUrl       = "https://x.com/thsottiaux/status/投稿ID"
  tweetCreatedAt = "2026-08-01T00:00:00.000Z"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://codex.gussuriworks.com/api/webhook/tibo" `
  -Headers @{ Authorization = "Bearer $secret" } `
  -ContentType "application/json" `
  -Body $body
```

`tweetId` は数字の投稿ID、`tweetUrl` はTibo氏のstatus URL、`tweetCreatedAt` はISO 8601形式で指定します。Webhookは投稿時刻が現在より5分を超えて未来の場合、URLがTibo氏のstatus URLでない場合、本文が2000文字を超える場合などを拒否します。送信後はHTTP 2xxとSupabaseの行を確認してください。

## 9. `data/resetHistory.ts`への手動追記

Webhookが使えない緊急時には、`data/resetHistory.ts` へ静的なリセット履歴を手動追記する手段も残っています。ただし通常はWebhook経由を優先します。

手動追記では、既存の履歴イベント形式、実施時刻、分類、対象範囲、ソースURLをそろえ、`npm test` と `npm run build` を実行します。静的履歴とSupabase由来の動的履歴が同じリセットを表す場合は、tweet_id・URL、または強制リセットの実施時刻5分以内という条件で統合されます。二重表示を避けるため、同じイベントを両方へ無計画に追加しないでください。

### 自動反映後に正確な履歴へ直す場合

通常は、まずTibo投稿が自動反映した簡易履歴を速報として表示し、その後に同じ投稿URLを持つ詳細なイベントを `data/resetHistory.ts` へ追加・修正します。

1. Supabaseの行は削除せず、本文・投稿時刻・分類の監査記録として残します。
2. 静的履歴の `source_url` は、必ず `https://x.com/thsottiaux/status/{tweet_id}` の正規URLにします。
3. 同じtweet_id・URLとして統合されると、静的履歴側のタイトル、日時、対象プラン、分類、リセット方法、告知時間、補足が優先されます。
4. 静的履歴で値を指定していない項目だけ、自動履歴の値が補われます。
5. 反映後はデプロイとキャッシュ更新のため、画面に反映されるまで最大およそ60秒待ちます。

`verification_status=confirmed` は、Supabase上の分類結果を正式採用するための状態です。履歴の表示文、実施時刻、リセット方法などを詳しく直す操作ではないため、表示内容の修正には静的履歴の追記・更新を使います。誤判定として除外する場合だけは、前節の `rejected` 更新を使います。

### 過去履歴の投稿URLを補完する場合

過去の静的履歴には、投稿を特定できるstatus URLではなく、プロフィールURLだけが入っている記録があります。これは直ちに一括修正する必要はありません。過去の投稿を確認できたものから、忘れない範囲で1件ずつ補完します。

- 自動監視導入後の新しい履歴は、最初から正規status URLで登録します。
- 過去履歴を補完するときは、投稿本文と実施時刻が履歴と一致することを確認します。
- URLは `https://x.com/thsottiaux/status/{tweet_id}` の形式にします。
- 推測で投稿IDを入力せず、特定できない記録はプロフィールURLのまま残します。
- URL以外の過去履歴の内容は、必要がなければ変更しません。
- 補完後は、同じ投稿の自動履歴と意図どおり1件に統合されることを確認します。

この作業は過去データの保守であり、速報取得のための必須作業ではありません。新しい自動履歴のURL管理を優先します。

## 10. トラブルシューティング

### `monitored_tab_missing`

- プロフィールタブが閉じていないか確認します。
- URLが `x.com/thsottiaux` または `twitter.com/thsottiaux` になっているか確認します。
- Chromeと拡張機能が動作中か、PCがスリープしていないか確認します。
- プロフィールを開いて対象投稿までスクロールし、10〜60秒待ちます。
- SupabaseのHeartbeat行は、次のHeartbeat送信後に更新されます。

### `translated_text_detected`

- Xの投稿を「原文を表示」に戻します。
- 日本語などの翻訳文ではなく、英語原文が表示されていることを確認します。
- 対象投稿を画面上に再表示して、再スキャンを待ちます。

### Webhook Secret未設定

- 拡張機能のオプションでWebhook Secretを設定し、接続テストを実行します。
- サーバー側の `TIBO_WEBHOOK_SECRET` が未設定ならWebhookは503になります。
- 秘密値をコンソール、Issue、手順書、Gitへ貼り付けないでください。

### Gemini失敗時の `rule_fallback`

- `ai_classification_status` と `ai_model` をSupabaseで確認します。
- `primary` ではGemini失敗時もWebhookはルール分類で保存を完了します。
- `classification_source=rule_fallback` なら、最終分類はルール結果です。必要なら本文と監査列を確認してから `confirmed` または `rejected` を設定します。

### Supabaseに行が追加されない場合

1. WebhookのHTTP応答が2xxか確認します。401はSecret不一致、503はサーバー側Secret未設定、400は入力値の形式不正です。
2. 拡張機能のService WorkerコンソールでWebhookエラーを確認します。
3. `tweetId` が数字、URLがTibo氏のstatus URL、本文が原文、投稿日時が有効なISO 8601形式か確認します。
4. 同じtweet_idが既にある場合は新規行ではなくupsertによる更新です。
5. サーバー側のSupabase接続設定と、`tibo_signals` の制約・権限を管理者に確認します。秘密値は表示・共有しません。
6. 保存成功後もレーダー画面はキャッシュ中のことがあるため、最大およそ60秒待って再読み込みします。
