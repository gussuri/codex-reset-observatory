# 📡 Tibo Real-Time Monitor (Chrome Extension - Manifest V3)

Tampermonkeyに依存しない自分専用のChrome Manifest V3拡張機能です。  
X (旧Twitter) 上で Tibo 氏（`@thsottiaux`）の投稿をリアルタイムで検知し、Codex Reset Observatory の Webhook API へ安全に送信します。

---

## ⚠️ 重要：X（旧Twitter）の翻訳設定について

* 本システムの分類エンジン（`lib/radar/classification.ts`）は**英語テキスト前提**で高精度な判定を行います。
* Xのブラウザ自動翻訳が有効化され、日本語訳が表示されている投稿は誤判定を防ぐため**自動的に送信がスキップ**され、監査ログ `last_scan_error` に `translated_text_detected` が記録されます。
* 夜間監視を行うブラウザタブでは、必ず **「原文を表示（View original text）」** の状態にして監視を行ってください。

---

## 🔒 セキュリティアーキテクチャ

* **完全分離構成**: DOMを解析する `content.js` は秘密鍵を持ちません。
* **背景通信**: 投稿を検知すると `chrome.runtime.sendMessage` で `service-worker.js` へ投稿情報のみを渡します。
* **trusted context限定**: `service-worker.js` が `chrome.storage.local` から `TIBO_WEBHOOK_SECRET` を読み出し、拡張機能自身のtrusted contextからのみアクセスできるよう制限したうえでWebhook APIへ送信します。ソースコードやGitリポジトリに秘密鍵が含まれることはありません。

---

## 🛠 1. インストール手順

1. Chrome ブラウザを開き、アドレスバーに `chrome://extensions` と入力してアクセスします。
2. 画面右上にある **「デベロッパー モード」** のトグルスイッチを **ON** にします。
3. 画面左上に表示される **「パッケージ化されていない拡張機能を読み込む」** ボタンをクリックします。
4. ファイル選択ダイアログで、本リポジトリの `extension/tibo-monitor/` フォルダを選択して読み込みます。

---

## ⚙️ 2. 初期設定手順

1. `chrome://extensions` 画面で **「Codex Reset Observatory - Tibo Real-Time Monitor」** の **「詳細」** をクリックします。
2. 画面下の **「拡張機能のオプション」** をクリックします（または拡張機能アイコンの右クリックメニューから「オプション」を選択）。
3. **`TIBO_WEBHOOK_SECRET`**: Vercel の環境変数で設定した秘密鍵を入力します。
4. **`Observatory Domain`**: `https://codex.gussuriworks.com` (デフォルト)
5. **「保存」** ボタンをクリックします。
6. **「接続テスト」** ボタンをクリックし、`✅ 接続テスト成功！` と表示されることを確認してください。

---

## 🧪 3. 動作確認方法

1. X（旧Twitter）で `@thsottiaux` のプロフィールページ（`https://x.com/thsottiaux`）と、返信ページ（`https://x.com/thsottiaux/with_replies`）を開きます。通常投稿だけを監視する場合はプロフィールだけでも動作します。通知ページ（`https://x.com/notifications`）も補助的なスキャン対象です。
2. F12 キーを押して Chrome デベロッパー ツール（コンソール）を開きます。
3. `[Tibo Extension] Content script initialized with Translation Guard & Strict Storage-First InFlight Removal.` というログが表示されていることを確認します。
4. 5分ごとに `[Tibo Extension] Heartbeat sent successfully by leader tab.` が出力され、新しい投稿が検知されると自動的に Webhook 送信が行われます。

## 💬 4. 返信タブの運用

- Service Workerは約10分ごとにプロフィールと返信のタブを最大1つずつ再読み込みします。拡張機能がタブを自動で作成・閉じることはありません。
- 片方のタブを閉じても、もう片方の監視は継続します。返信タブがない、またはスキャンが停滞している場合は、オプション画面のローカル診断ログで `sourceTimeline=with_replies` と `monitored_tab_missing` / `timeline_stalled` を確認します。
- 返信先ハンドルや親文脈は、Xが同じ投稿記事内に明示した情報、または返信タブで子側incoming connectorと直前の親cell側outgoing connectorが両方確認できる場合だけ保存します。親投稿を開く追加取得は行いません。
- 返信は収集・保存・分類しますが、返信であることだけでリセット予告・実施シグナルを強めず、正式履歴や公開確率へ自動反映しません。
