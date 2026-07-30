# 📡 Tibo Real-Time Monitor (Chrome Extension - Manifest V3)

Tampermonkeyに依存しない自分専用のChrome Manifest V3拡張機能です。  
X (旧Twitter) 上で Tibo 氏（`@thsottiaux`）の投稿をリアルタイムで検知し、Codex Reset Observatory の Webhook API へ安全に送信します。

---

## 🔒 セキュリティアーキテクチャ

* **完全分離構成**: DOMを解析する `content.js` は秘密鍵を持ちません。
* **背景通信**: 投稿を検知すると `chrome.runtime.sendMessage` で `service-worker.js` へ投稿情報のみを渡します。
* **暗号化保管**: `service-worker.js` が `chrome.storage.local` から `TIBO_WEBHOOK_SECRET` を読み出し、Vercel API へ送信します。ソースコードや Git リポジトリに秘密鍵が含まれることは一切ありません。

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
4. **`Observatory Domain`**: `https://codex-reset-observatory.vercel.app` (デフォルト)
5. **「保存」** ボタンをクリックします。
6. **「接続テスト」** ボタンをクリックし、`✅ 接続テスト成功！` と表示されることを確認してください。

---

## 🧪 3. 動作確認方法

1. X（旧Twitter）で `@thsottiaux` のプロフィールページ（`https://x.com/thsottiaux`）または通知ページ（`https://x.com/notifications`）を開きます。
2. F12 キーを押して Chrome デベロッパー ツール（コンソール）を開きます。
3. `[Tibo Extension] Content script initialized with Leader Lock & Background Service Worker.` というログが表示されていることを確認します。
4. 5分ごとに `[Tibo Extension] Heartbeat sent successfully by leader tab.` が出力され、新しい投稿が検知されると自動的に Webhook 送信が行われます。
