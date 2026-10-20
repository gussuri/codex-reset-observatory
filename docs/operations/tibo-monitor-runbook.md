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

1. Chromeプロファイルの起動時は、すでに開いているプロフィールと返信の監視タブを最大1つずつすぐに再読み込みします。Service Workerが通常の理由で起動しただけでは再読み込みしません。
2. Service WorkerのChrome Alarmは約10分ごとに動きます。起動時再読み込みの直後にalarmも動いた場合、同じtimeline/tabが直前60秒以内に正常再読み込み済みなら二重再読み込みを省きます。
3. 起動時・alarmのどちらも、プロフィールと返信の各URLについて既存タブを最大1つずつ扱います。タブを自動で新規作成・閉鎖することはありません。タブがなければ従来の `monitored_tab_missing` 診断を記録します。再読み込み後のContent Scriptが、表示中の投稿DOMをスキャンします。
4. 投稿の追加・更新はMutationObserverで検知し、念のため60秒ごとの再スキャンも行います。
5. `@thsottiaux/status/{tweet_id}` の正規URL、本文、`time`要素の投稿日時を取得します。返信タブでは、Xの「Replying to / 返信先 / 回复给」領域、または子側のincoming connectorと直前の親cell側のoutgoing connectorが両方確認できる場合に返信と返信先を復元します。返信関係とTibo自身の投稿情報を確認できれば、第三者の親文脈が未取得でも返信本文を通常のWebhookへ送ります。第三者の親本文は自動展開せず、取得できない文脈は後続のsource-context更新に任せます。
6. 投稿はService Workerで直列化・重複排除され、`/api/webhook/tibo`へ送信されます。2xx応答後に処理済みIDがChromeのローカル保存へ追加されます。
7. Webhookはルール分類を行い、`GEMINI_CLASSIFICATION_MODE` が `off` 以外ならGemini分類も1投稿につき最大1回実行します。
8. `primary`（または後方互換の `hybrid`）では、Geminiの有効な成功結果を最終分類に採用し、失敗時だけルール分類へfallbackします。
9. 分類結果と監査列がSupabaseの `tibo_signals` にtweet_id単位でupsertされます。返信であること自体はシグナルを強めません。返信は既定で正式リセット履歴・公開確率へ反映されません。
10. 返信でない投稿のうち、条件を満たす `reset_executed` は次回のレーダーデータ取得で正式リセット履歴へ自動統合されます。返信は、同じglobal resetに至るTibo本人の検証済みreply path（最大2辺）があり、成功したGemini分類が `reset_executed` / confidence `0.95`以上 / `completed_now` で、同じ分類応答の引用が強制方式と全有料または全ユーザー範囲の両方を裏付け、現在のsource-context revisionに結び付くproofを通過した場合に限り採用されます。proofがない・古い・不明な返信は引き続き除外されます。採用されても `confirmed` へ自動変更せず、`auto_unverified` のまま条件を満たせば反映されます。詳細は [`docs/reset-history-normalization.md`](../reset-history-normalization.md) のsection 7を参照してください。

Chrome起動時の再読み込みは通常のContent Script初回DOMスキャンを早く始めるだけです。返信タブでは、画面の大半を占める第三者の親投稿が返信connectorで確認され、Tiboの返信がまだ見えない場合に限り、親投稿の下端まで最大4回・累計4画面分以内、各試行10秒以内でスクロールします。同じ試行の再開には60秒以上の間隔を空け、累計移動量と回数は同じタブセッション内のページ再読み込み後も維持します。ユーザー操作またはページ移動で停止します。第三者投稿の展開、追加タブ、X API、画面外に読み込まれていない投稿の過去取得は行いません。

通常の正式履歴条件は、非返信、`signal_type=reset_executed`、confidence 0.95以上、`verification_status` が `rejected` ではないことに加え、`classification_source` が `gemini`、`rule`、`shadow`、または `rule_fallback` のいずれかであることです。返信は前節の検証済みproof経路を通った場合だけ例外的に採用されます。`verification_status=confirmed` だけでは返信を採用しません。`expires_at` は正式履歴の判定には使いません。

正式履歴は静的な `data/resetHistory.ts` と統合されます。同じtweet_id・URL、または強制リセットの実施時刻が5分以内の重複は1件にまとめられます。Webhook成功後も表示側のキャッシュにより、反映まで最大およそ60秒かかることがあります。

### 返信先文脈の追加保存

返信タブで強い返信先文脈が得られると、初回スキャンですでに文脈がある場合も含め、拡張機能は専用のsource-only Webhookで保存します。これは通常投稿Webhookとは別のHTTPリクエストで、1つの異なる文脈リビジョンにつき最大3回試行します（初回を含む）。分類だけの処理や文脈が変わらない通常ポーリングでは追加リクエストはありません。同じ文脈の再送は抑止され、1投稿あたり最大3つの異なるリビジョン、再送キューは最大50件、ローカル再送台帳は最大100件です。分類は再実行しません。失敗・終端拒否されたリビジョンは保存済み（applied）として扱いません。

このリリースの拡張機能バージョンは `1.0.7`、Content Scriptの診断selector markerは `v1.14-current-timeline-diagnostics` です。監視後の診断にこのmarkerが出ていれば、新しいContent Scriptが実行されたことを確認できます。

返信本文の通常取込とタイムライン診断は既存Webhookと `last_scan_summary` JSONBを使うため、追加migrationはありません。source-context enrichmentの既存migrationは従来どおり [`supabase/migrations/20261018034219_tibo_source_context_enrichment.sql`](../../supabase/migrations/20261018034219_tibo_source_context_enrichment.sql) を参照してください。この手順の変更だけでは本番DBへの適用やデプロイは行われません。

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

監視の稼働状態は `public.tibo_heartbeat` の `id='main'` と `GET /api/monitor/health` を確認します。形式バージョン2の `last_scan_summary.timelineDiagnostics` は `profile` と `with_replies` の固定2スロットを持ちます。最新スキャン時刻と最終成功パース時刻は別々に記録されます。開いていないスロットは `not_open`（任意）、最新スキャンが成功していないスロットは `empty`（warning）、スキャンが15分より古い・現在のタブセッションより前・未来時刻の場合は `stale`（unhealthy）です。最新の空スキャンでも、同じタブセッション内の最後の成功時刻は `lastSuccessfulParseAt` として別に返します。ハートビート異常、スキャンエラー、ページ再読み込みエラーはレーンの結果より優先します。古い形式や不完全な形式は従来の `last_successful_parse_at` 判定に戻ります。各Content Scriptのスキャン要約はService WorkerがChromeローカルへ集約し、5分ごとの既存leader heartbeatだけで送信します。要約には本文、DOM、認証情報、tab/session IDを含めません。

## 5. 監視ヘルスチェックとアラート

本番の監視ヘルスエンドポイントは `GET https://codex.gussuriworks.com/api/monitor/health` です。呼び出しには `Authorization: Bearer <CRON_SECRET>` が必要です。秘密値そのものをIssue、ログ、手順書、チャットへ貼り付けないでください。

形式バージョン2が完全な場合は、開いているtimelineの最新スキャンを基準に判定します。全レーンが最新かつパース成功なら `healthy`、空スキャンがあれば `warning`、古いスキャンがあれば `unhealthy` です。`lastSuccessfulParseAt` とその経過秒数はレーンごとに確認できます。ハートビート時刻がない・不正・未来・15分超過、`last_scan_error`、`last_page_reload_status` の失敗は引き続き `unhealthy` です。旧形式・不完全な形式では `last_successful_parse_at` を使う従来判定に戻ります。閉じているtimelineの `not_open` は任意です。`healthy` と `warning` はHTTP 200、`unhealthy`・設定不足・データベース読み取り失敗はHTTP 503になります。応答には安全な状態と理由だけが含まれ、生のエラー本文は含まれません。

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
